/* eslint "no-console": "off" */

const db = require('./db.js');
const messages = require('./utils/messages');
const manager = require('./utils/db/manager');

const knex = manager.knex;

/**
 * Retrieve array of requests that have sat too long.
 *
 * @return {Promise} Promise that resolves to an array of objects:
 * [{phone: 'encrypted-phone', case_id: [id1, id2, ...]}, ...]
 */
function getExpiredRequests() {
    // We dont delete these all at once even though that's easier, becuase we don't want to
    // delete if there's a tillio(or other) error

    return knex('requests')
    .where('known_case', false)
    .and.whereRaw(`updated_at < CURRENT_DATE - interval '${process.env.QUEUE_TTL_DAYS} day'`)
    .select('phone', knex.raw( `array_agg(case_id) as case_ids`))
    .groupBy('phone')
}

/**
 * Deletes given case_ids and send unable-to-find message
 *
 * @param {*} groupedRequest is an object with a phone and an array of case_ids.
 */
function deleteAndNotify(groupedRequest) {
    const phone = db.decryptPhone(groupedRequest.phone);
    return knex.transaction(trx => {
        return trx('requests')
        .where('phone', groupedRequest.phone)
        .and.whereIn('case_id', groupedRequest.case_ids )
        .del()
        .then(() => messages.send(phone, process.env.TWILIO_PHONE_NUMBER, messages.unableToFindCitationForTooLong(groupedRequest.case_ids)))
    })
    .catch(err => {
        // catch here to allow Promise.all() to send remaining
        console.log("Error sending delete notification", err) // better logging coming
        return ("Delete and Notify error")
    })
}

/**
 * Finds requests that have matched a real citation for the first time
 *
 * @return {Promise} that resolves to case and request information
 */
function discoverNewCitations() {
    return knex.select('*', knex.raw(`CURRENT_DATE = date_trunc('day', date) as today`)).from('requests')
    .innerJoin('cases', {'requests.case_id': 'cases.case_id'})
    .where('requests.known_case', false)
}

/**
 * Inform subscriber that we found this case and will send reminders before future hearings
 *
 * @param {*} request_case object from join of request and case table
 */
function updateAndNotify(request_case) {
    console.log("case: ", request_case)
    const phone = db.decryptPhone(request_case.phone);
    return knex.transaction(trx => {
        return  trx('requests')
        .where('phone', request_case.phone)
        .andWhere('case_id', request_case.case_id )
        .update('known_case', true)
        .then(() => messages.send(phone, process.env.TWILIO_PHONE_NUMBER, messages.foundItWillRemind(true, request_case)))
    })
    .catch(err => {
        // catch here to allow Promise.all() to send remaining
        console.log("Error sending update notification", err) // better logging coming
        return ("Update error")
    })
}

/**
 * Hook for processing all applicable queued messages.
 *
 * @return {Promise} Promise to process all queued messages.
 */

function sendQueued() {
    return discoverNewCitations()
    .then(resultsArray => Promise.all(resultsArray.map(r => updateAndNotify(r))))

    /*
    return getExpiredRequests()
    .then(resultsArray => Promise.all(resultsArray.map(r => deleteAndNotify(r))))
    */
    //.then(resultsArray => Promise.all(resultsArray.map(r => processCitationMessage(r))));
}

module.exports = {
    sendQueued,
    discoverNewCitations,
};
