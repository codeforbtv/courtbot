/* eslint "no-console": "off" */

const db = require('./db.js');
const manager = require('./utils/db/manager');
const messages = require('./utils/messages');
const knex = manager.knex;

/**
 * Find all reminders with a case date of tomorrow for which a reminder has not been sent
 *
 * @return {array} Promise to return results
 */
function findReminders() {
    return knex('reminders')
    .where('sent', false)
    .join('cases', 'reminders.case_id', '=', 'cases.id')
    .whereRaw(`tstzrange(TIMESTAMP 'tomorrow', TIMESTAMP 'tomorrow' + interval '1 day') @> cases.date`)
    .select();
}

/**
 * Send court appearance reminder via twilio REST API
 *
 * @param  {array} reminders List of reminders to be sent.
 * @return {Promise}  Promise to send reminders.
 */
function sendReminder(reminder) {
    const phone = db.decryptPhone(reminder.phone);
    return messages.send(phone, process.env.TWILIO_PHONE_NUMBER, messages.reminder(reminder))
    .then(() => reminder);
}

/**
 * Update statuses of reminders that we send messages for.
 *
 * @param  {Object} reminder reminder record that needs to be updated in db.
 * @return {Promise} Promise to update reminder.
 */
function updateReminderStatus(reminder) {
    return knex('reminders')
    .where('reminder_id', '=', reminder.reminder_id)
    .update({ sent: true });
}

/**
 * Main function for executing:
 *   1.)  The retrieval of court date reminders
 *   2.)  Sending reminder messages via twilio
 *   3.)  Updating the status of the court reminder messages
 *
 * @return {Promise} Promise to send messages and update statuses.
 */
function sendReminders() {
    return findReminders()
    .then(resultArray => Promise.all(resultArray.map(r => sendReminder(r))))
    .then(resultArray => Promise.all(resultArray.map(r => updateReminderStatus(r))));
}

module.exports = {
    findReminders,
    sendReminders,
};
