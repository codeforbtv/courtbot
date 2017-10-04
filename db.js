require('dotenv').config();
const crypto = require('crypto');
const manager = require('./utils/db/manager');
const knex = manager.knex;

function escapeSQL(val) {
    return val.replace(/[^A-Za-z0-9\-]/g, '');
}

/**
 * encrypts the phone number
 *
 * param {string} phone number to encrypt
 * returns {string} encrypted phone number
 */
function encryptPhone(phone) {
    // Be careful when refactoring this function, the decipher object needs to be created
    //    each time a reminder is sent because the decipher.final() method destroys the object
    //    Reference: https://nodejs.org/api/crypto.html#crypto_decipher_final_output_encoding
    const cipher = crypto.createCipher('aes256', process.env.PHONE_ENCRYPTION_KEY);
    return cipher.update(phone, 'utf8', 'hex') + cipher.final('hex');
}

/**
 * decrypts the phone number
 *
 * param {string} phone number to decrypt
 * returns {string} decrypted phone number
 */
function decryptPhone(phone) {
    // Be careful when refactoring this function, the decipher object needs to be created
    //    each time a reminder is sent because the decipher.final() method destroys the object
    //    Reference: https://nodejs.org/api/crypto.html#crypto_decipher_final_output_encoding
    const decipher = crypto.createDecipher('aes256', process.env.PHONE_ENCRYPTION_KEY);
    return decipher.update(phone, 'hex', 'utf8') + decipher.final('utf8');
}

function findCitation(citation) {
    return knex('cases').where('case_id', citation )
    .select('*', knex.raw(`
        CURRENT_DATE = date_trunc('day', date) as today,
        date < CURRENT_TIMESTAMP as has_past
    `))
}
// Find queued citations that we have asked about adding reminders
function findAskedQueued(phone) {
    // Filter for new ones. If too old, user probably missed the message (same timeframe
    // as Twilio sessions - 4 hours). Return IFF one found. If > 1 found, skip
    return knex('queued')
    .where('phone', encryptPhone(phone)).andWhere('asked_reminder', true)
    .andWhereRaw(`"asked_reminder_at" > CURRENT_TIMESTAMP - interval '4 hours'`)
    .select()
    .then((rows) => {
        if (rows.length === 1) {
            return knex('queued')
            .where('queued_id', rows[0].queued_id)
            .update({ asked_reminder: false })
            .then(() => knex('cases').where('citations', '@>', `[{"id": "${rows[0].citation_id}"}]`));
      }
      return [];
    });
}

function requestsFor(phone) {
    return knex('requests')
    .where('phone', encryptPhone(phone))
    .select('case_id')
}

function deleteRequestsFor(phone){
    return knex('requests')
    .where('phone', encryptPhone(phone))
    .del()
    .returning('case_id')
}

function fuzzySearch(str) {
    const parts = str.trim().toUpperCase().split(' ');

    // Search for Names
    let query = knex('cases').where('defendant', 'ilike', `%${parts[0]}%`);
    if (parts.length > 1) query = query.andWhere('defendant', 'ilike', `%${parts[1]}%`);

    // Search for Citations
    query = query.orWhere('id',parts[0]);

    // Limit to ten results
    query = query.limit(10);
    return query;
}

// If someone tries to add a request that already exists
// for that phone and id, it simply renews it.

function addReminder(data) {
    return knex.raw(`
        INSERT INTO requests
        (case_id, phone, known_case)
        VALUES(:case_id ,:phone, true)
        ON CONFLICT (case_id, phone) DO UPDATE SET created_at = NOW()`,
        {
            case_id: data.case_id,
            phone: encryptPhone(data.phone)
        }
    )
}

function addQueued(data) {
    return knex.raw(`
        INSERT INTO requests
        (case_id, phone, known_case)
        VALUES(:case_id ,:phone, false)
        ON CONFLICT (case_id, phone) DO UPDATE SET created_at = NOW()`,
        {
            case_id: data.case_id,
            phone: encryptPhone(data.phone)
         }
    )
}

module.exports = {
    addReminder,
    addQueued,
    decryptPhone,
    encryptPhone,
    findAskedQueued,
    findCitation,
    fuzzySearch,
    deleteRequestsFor,
    requestsFor,
};
