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
    /* We dont delete these all at once even though that's easier, becuase we only want to
       delete if there's not a tillio (or other) error. */

    return knex('requests')
    .where('known_case', false)
    .and.whereRaw(`updated_at < CURRENT_DATE - interval '${process.env.QUEUE_TTL_DAYS} day'`)
    .whereNotExists(function()  { // should only be neccessary if there's an error in discoverNewCitations
        this.select('*').from('hearings').whereRaw('hearings.case_id = requests.case_id');
    })
    .select('*')
}

/**
 * Deletes given case_ids and sends unable-to-find message
 * Perform both actions inside transaction so if we only update DB if twilio suceeds
 * and don't send to Twilio if delete fails.
 *
 * @param {*} groupedRequest is an object with a phone and an array of case_ids.
 */
function deleteAndNotify(expiredRequest) {
    const phone = db.decryptPhone(expiredRequest.phone);
    return knex.transaction(trx => {
        return trx('requests')
        .where('phone', expiredRequest.phone)
        .and.where('case_id', expiredRequest.case_id )
        .del()
        .then(() => messages.send(phone, process.env.TWILIO_PHONE_NUMBER, messages.unableToFindCitationForTooLong(expiredRequest)))
        .then(() =>  expiredRequest)
    })
    .catch(err => {
        // catch here to allow Promise.all() to send remaining
        // Numbers from which users have sent Twilio a 'STOP' message will end up here
        // with a blacklist error. We should test for this and delete the request.
        // Otherwise it remains in requests and we'll keep attempting to send notifications.
        expiredRequest.error = err
        return expiredRequest;
    })
}

/**
 * Finds requests that have matched a real citation for the first time.
 * These are identified with the 'know_case = false' flag
 * @return {Promise} that resolves to case and request information
 */
function discoverNewCitations() {
    return knex.select('*', knex.raw(`
        CURRENT_DATE = date_trunc('day', date) as today,
        date < CURRENT_TIMESTAMP as has_past`))
    .from('requests')
    .innerJoin('hearings', {'requests.case_id': 'hearings.case_id'})
    .where('requests.known_case', false)
}

/**
 * Inform subscriber that we found this case and will send reminders before future hearings.
 * Perform both actions inside transaction so if we only update DB if twilio suceeds
 * @param {*} request_case object from join of request and case table
 */
function updateAndNotify(request_case) {
    const phone = db.decryptPhone(request_case.phone);
    return knex.transaction(trx => {
        return  trx('requests')
        .where('phone', request_case.phone)
        .andWhere('case_id', request_case.case_id )
        .update({
            'known_case': true,
            'updated_at': knex.fn.now()
        })
        .then(() => messages.send(phone, process.env.TWILIO_PHONE_NUMBER, messages.foundItWillRemind(true, request_case)))
        .then(() => request_case)
    })
    .catch(err => {
        request_case.error = err
        return request_case
    })
}

/**
 * Hook for processing all requests which have not yet been matched to a real case_id.
 *
 * @return {Promise} Promise to process all queued messages.
 */

async function sendUnmatched() {
    const matched = await discoverNewCitations()
    const matched_sent = await Promise.all(matched.map(r => updateAndNotify(r)))

    const expired = await getExpiredRequests()
    const expired_sent =await Promise.all(expired.map((r => deleteAndNotify(r))))

    // returning these results to make it easier to log in one place
    return {expired: expired_sent, matched: matched_sent }
}

module.exports = {
    sendUnmatched,
    getExpiredRequests

};
