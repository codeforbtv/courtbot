const util = require('util')
const manager = require("../db/manager")
const knex = manager.knex;
const crypto = require('crypto');
const cipher = crypto.createCipher('aes256', process.env.PHONE_ENCRYPTION_KEY);
const action_symbol = Symbol();

createDBTables()

/**
 * Creates an entry in the log_runners table and an entries for each request in the log_request_events table
 * @param {Object} loginfo
 * @param {string} loginfo.action - one of the enumerated actions available in log tables
 * @param {Object[]} loginfo.data - array of requests that have been notified, matched, or expired
 * @returns {Promise} resolves when DB is finished saving
 */
function sent({action, data}) {
    if (!action || !data) throw new Error("Cannot log without action and data")
    const {err, sent} = data.reduce((a, c) => (c.error ? a.err += 1 : a.sent += 1, a), {err: 0, sent: 0})
    return knex('log_runners').insert({ runner: action, count: sent, error_count: err })
    .returning('id')
    .then(id => Promise.all(data.map(sent => logSent(action, sent, id[0]))))
    .then(() => console.log(`${action} | Sent: ${sent}, Errors: ${err}`))
}

function logSent(action, data, runner_id) {
    // action must be one fo the enumerated values in log_request_events table
    const insert_data = {
        case_id: data.case_id,
        phone: data.phone,
        hearing_date: data.date,
        hearing_location: data.room,
        action: action,
        error: JSON.stringify(data.error),
        runner_id: runner_id
    }
    return knex('log_request_events').insert(insert_data)
}

/**
 * Adds a log entry when a requests (either matched or unmatched) is scheduled
 * @param {Object} data
 * @param {string} case.id
 * @param {string} phone - encrypted phone number
 * @param {boolen} known_case - whether this case exists in the hearings table
 */
function logRequest({case_id, phone, known_case}){
    const insert_data = {
        case_id: case_id,
        phone: phone,
        action: known_case ? 'schedule_reminder' : 'schedule_unmatched'
    }
    return knex('log_request_events').insert(insert_data)
}

function logDeleteRequest(case_id, phone){
    const insert_data = {
        case_id: case_id,
        phone: phone,
        action: 'delete_reminder'
    }
    return knex('log_request_events').insert(insert_data)
}

/**
 * Adds an entry to log_runners. Should be called when new csv files are loaded
 * @param {Object} param
 * @param {number} param.files - the number of files processed
 * @param {number} param.records - the number of hearings added
 */
function load({files, records}) {
    return knex('log_runners').insert({ runner: 'load', count: records })
    .then(console.log(`Loaded | records: ${records} , csv files: ${files}`))
}

function hitLogger() {
    /* 'this' should be the express response object */
    const cipher = crypto.createCipher('aes256', process.env.PHONE_ENCRYPTION_KEY);
    let phone = this.req.body && this.req.body.From ? cipher.update(this.req.body.From, 'utf8', 'hex') + cipher.final('hex') : undefined
    return knex('log_hits').insert({
        path: this.req.url,
        method: this.req.method,
        status_code: this.statusCode,
        phone: phone,
        body: this.req.body && this.req.body.Body,
        action: this[action_symbol]
    }).then(() =>  console.log("hit: ", this.req.url, this.req.body, this.locals, this.req.method, this.statusCode, this[action_symbol]))
}

/* TODO - what indexes will be needed? */
function createDBTables(){
    /* create log tables if they don't exist */
    knex.schema.createTableIfNotExists('log_request_events', function (table) {
        table.increments();
        table.string('case_id')
        table.string('phone')
        table.string('hearing_date')
        table.string('hearing_location')
        table.enu('action', ['send_reminder', 'schedule_reminder', 'schedule_unmatched', 'send_matched', 'send_expired', 'delete_reminder'])
        table.jsonb('error')
        table.integer('runner_id')
        table.timestamp('date').defaultTo(knex.fn.now())
    }).then(() => console.log("Creating log table for reminder events if needed."))

    knex.schema.createTableIfNotExists('log_runners', function (table) {
        table.increments()
        table.enu('runner', ['send_reminder', 'send_expired', 'send_matched','load'])
        table.integer('count')
        table.integer('error_count')
        table.timestamp('date').defaultTo(knex.fn.now())
    }).then(() => console.log("Creating log table for runners if needed."))

    knex.schema.createTableIfNotExists('log_hits', function(table){
        table.timestamp('time').defaultTo(knex.fn.now()),
        table.string('path'),
        table.string('method'),
        table.string('status_code'),
        table.string('phone'),
        table.string('body'),
        table.string('action')
    }).then(() => console.log("Creating log hits table id needed."))
}

module.exports = {
    sent: sent,
    load: load,
    hits: hitLogger,
    request: logRequest,
    delete: logDeleteRequest,
    action: action_symbol,
}
