require('dotenv').config();

const crypto = require('crypto');
const manager = require("../utils/db/manager");
const knex = manager.knex;

function findHearing(case_id) {
    case_id = case_id.toUpperCase().trim();
    return knex('hearings')
    .select('hearings.case_id', 'hearings.date', 'hearings.room', 'hearings.type', 'hearings.defendant', knex.raw('json_agg(requests) as requests'))
    .leftJoin('requests', 'hearings.case_id', '=', 'requests.case_id')
    .where('hearings.case_id', '=', case_id)
    .groupBy('hearings.case_id', 'hearings.date', 'hearings.room', 'hearings.type', 'hearings.defendant')
    .select();
 };

 function notificationsFromCitation(case_id) {
     return knex('notifications')
     .where('case_id', case_id)
 }

/* returns a simple object with counts: { scheduled: '3', sent: '10', all: '3' } */
function requestCounts() {
    return knex('requests')
    .select(knex.raw('COUNT(*) filter (where known_case = false) as unmatched, COUNT(*) filter (where known_case = true) as matched, count(*) as all'))
    .first()
 }

function hearingCount() {
    return knex('hearings')
    .count('*')
    .first()
 }


 module.exports = {
    findHearing,
    requestCounts,
    hearingCount
 }