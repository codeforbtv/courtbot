const manager = require("../db/manager");
const knex = manager.knex;

/**
 * Creates an entry in the log_runners table and an entries for each request in the log_request_events table
 * @param {Object} loginfo
 * @param {string} loginfo.action - one of the enumerated actions available in log tables
 * @param {Object[]} loginfo.data - array of requests that have been notified, matched, or expired
 * @returns {Promise} resolves when DB is finished saving
 */
function logSendRunner({action, data}) {
    if (!action || !data) throw new Error("Cannot log without action and data")
    const {err, sent} = data.reduce((a, c) => (c.error ? a.err += 1 : a.sent += 1, a), {err: 0, sent: 0})
    return knex('log_runners').insert({ runner: action, count: sent, error_count: err })
    .returning('id')
    .then(id => Promise.all(data.map(sent => logNotification(action, sent, id[0]))))
    .then(() => ({action, err, sent}))
}

/**
 * Adds an entry to log_runners. Should be called when new csv files are loaded
 * @param {Object} param
 * @param {number} param.files - the number of files processed
 * @param {number} param.records - the number of hearings added
 */
function logLoadRunner({files, records}) {
    return knex('log_runners').insert({ runner: 'load', count: records })
    .then(() => ({files, records}))
}

/**
 * logs when individual requests is sent
 * @param {string} action
 * @param {Object} data
 * @param {number} runner_id
 */
function logNotification(action, data, runner_id) {
    // action must be one of the enumerated values in log_request_events table
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

/**
 * Logs when a request is deleted
 * @param {*} case_id
 * @param {*} phone
 */
function logDeleteRequest({case_id, phone}){
    const insert_data = {
        case_id: case_id,
        phone: phone,
        action: 'delete_reminder'
    }
    return knex('log_request_events').insert(insert_data)
}


module.exports = {
    logSendRunner: logSendRunner,
    logLoadRunner: logLoadRunner,
    logNotification: logNotification,
    logDeleteRequest: logDeleteRequest,
    logRequest: logRequest
}