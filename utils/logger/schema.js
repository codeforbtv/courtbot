const manager = require("../db/manager")
const knex = manager.knex;

/* TODO - what indexes will be needed? */
function checkDBTables(){
    /* create log tables if they don't exist */
    const p1 = knex.schema.createTableIfNotExists('log_request_events', function (table) {
        table.increments();
        table.string('case_id')
        table.string('phone')
        table.string('hearing_date')
        table.string('hearing_location')
        table.enu('action', ['send_reminder', 'schedule_reminder', 'schedule_unmatched', 'send_matched', 'send_expired', 'delete_reminder'])
        table.jsonb('error')
        table.integer('runner_id')
        table.timestamp('date').defaultTo(knex.fn.now())
    })

    const p2 = knex.schema.createTableIfNotExists('log_runners', function (table) {
        table.increments()
        table.enu('runner', ['send_reminder', 'send_expired', 'send_matched','load'])
        table.integer('count')
        table.integer('error_count')
        table.timestamp('date').defaultTo(knex.fn.now())
    })

    const p3 = knex.schema.createTableIfNotExists('log_hits', function(table){
        table.timestamp('time').defaultTo(knex.fn.now()),
        table.string('path'),
        table.string('method'),
        table.string('status_code'),
        table.string('phone'),
        table.string('body'),
        table.string('action')
    })
    return Promise.all([p1, p2, p3])
}

module.exports = {
    checkDBTables
}