/* eslint "no-console": "off" */

const db = require('./db.js');
const manager = require('./utils/db/manager');
const messages = require('./utils/messages');
const knex = manager.knex;

/**
 * Find all reminders with a case date of tomorrow for which a reminder has not been sent for that date/time
 *
 * @return {array} Promise to return results
 */
function findReminders() {
    // much easier than trying to do this with knex functions.
    return knex.raw(`
        SELECT DISTINCT case_id, phone, defendant, date, room FROM requests
        INNER JOIN cases USING (case_id)
        LEFT OUTER JOIN notifications USING (case_id, phone)
        WHERE tstzrange(TIMESTAMP 'tomorrow', TIMESTAMP 'tomorrow' + interval '1 day') @> cases.date
        AND  (notifications.event_date != cases.date OR notifications.event_date IS NULL)
    `)
    .then(result => result.rows)
}

/**
 * Update statuses of reminders that we send messages for.
 *
 * @param  {Object} reminder reminder record that needs to be updated in db.
 * @return {Promise} Promise that resolves to case_id of inserted notification.
 */
function sendReminder(reminder) {
    const phone = db.decryptPhone(reminder.phone);
    return knex.transaction(trx => {
        return trx('notifications')
        .insert({
            case_id: reminder.case_id,
            phone:reminder.phone,
            event_date: reminder.date
        })
        .then(() => messages.send(phone, process.env.TWILIO_PHONE_NUMBER, messages.reminder(reminder)))
    })
    .catch(err => {
        // Catch and log here to allow Promise.all() to send remaining reminders
        console.log("Error sending reminder ", err) // better logging coming
        return ("Send Reminder error")
    })
}

/**
 * Main function for executing:
 *   1.)  The retrieval of court date reminders
 *   2.)  Add notification and Send Status
 *
 * @return {Promise} Promise to send messages and update statuses.
 */
function sendReminders() {
    return findReminders()
    .then(resultArray => Promise.all(resultArray.map(r => sendReminder(r))))
}

module.exports = {
    findReminders,
    sendReminders,
};
