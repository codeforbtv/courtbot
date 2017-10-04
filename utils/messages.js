const twilio = require('twilio');
const moment = require('moment-timezone');
const client = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

/**
 * reduces whitespace to a single space
 *
 * Note: This is useful for reducing the character length of a string
 * when es6 string templates are used.
 *
 * @param  {String} msg the message to normalize
 * @return {String} the msg with whitespace condensed to a single space
 */
function normalizeSpaces(msg) {
    return msg.replace(/\s\s+/g, ' ');
}

/**
 * Change FIRST LAST to First Last
 *
 * @param  {String} name name to manipulate
 * @return {String} propercased name
 */
function cleanupName(name) {
    return name.trim()
    .replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

/**
 * message to go to the site for more information
 *
 * @return {String} message.
 */
function forMoreInfo() {
    return normalizeSpaces(`OK. You can always go to ${process.env.COURT_PUBLIC_URL}
    for more information about your case and contact information.`);
}

/**
 * tell them of the court date, and ask them if they would like a reminder
 *
 * @param  {Boolean} includeSalutation true if we should greet them
 * @param  {string} name Name of cited person/defendant.
 * @param  {moment} datetime moment object containing date and time of court appearance.
 * @param  {string} room room of court appearance.
 * @return {String} message.
 */
function foundItWillRemind(includeSalutation, match) {
    const salutation = `Hello from the ${process.env.COURT_NAME}. `;
    const caseInfo = `We found a case for ${cleanupName(match.defendant)} scheduled
        ${(match.today ? 'today' : `on ${moment(match.date).format('ddd, MMM Do')}`)}
        at ${moment(match.date).format('h:mm A')}, at ${match.room}.`;

    let futureHearing = '';
    if (match.has_past) {
        futureHearing = ' future hearings';
    } else if (match.today) { // Hearing today
        futureHearing = ' future hearings';
    }

    return normalizeSpaces(`${(includeSalutation ? salutation : '')}${caseInfo}
        We will send you a courtesy reminder the day before${futureHearing}`);
}

/**
 * greeting, who i am message
 *
 * @return {String} message.
 */
function iAmCourtBot() {
    return 'Hello, I am Courtbot. I have a heart of justice and a knowledge of court cases.';
}

/**
 * tell them their case number input was invalid
 *
 * @return {String} message.
 */
function invalidCaseNumber() {
    return normalizeSpaces(`Couldn't find your case. Case identifier should be 6 to 25
        numbers and/or letters in length.`);
}

/**
 * tell them we could not find it and ask if they want us to keep looking
 *
 * @return {String} message.
 */
function notFoundAskToKeepLooking() {
    return normalizeSpaces(`Could not find a case with that number. It can take
        several days for a case to appear in our system. Would you like us to keep
        checking for the next ${process.env.QUEUE_TTL_DAYS} days and text you if
        we find it? (reply YES or NO)`);
}

/**
 * Reminder message body
 *
 * @param  {Object} occurrence reminder record.
 * @return {string} message
 */
function reminder(occurrence) {
    return normalizeSpaces(`Reminder: It appears you have a court hearing tomorrow at
        ${moment(occurrence.date).format('h:mm A')} at ${occurrence.room}.
        You should confirm your hearing date and time by going to
        ${process.env.COURT_PUBLIC_URL}.
        - ${process.env.COURT_NAME}`);
}

/**
 * Message to send when we we cannot find a person's court case for too long.
 *
 * @return {string} Not Found Message
 */
function unableToFindCitationForTooLong(case_ids) {
    return normalizeSpaces(`We haven't been able to find your court case${case_ids.length ? 's': ''}: ${case_ids.join(', ')}.
        You can go to ${process.env.COURT_PUBLIC_URL} for more information.
        - ${process.env.COURT_NAME}`);
}

/**
 * tell them we will keep looking for the case they inquired about
 * @param {Array} cases
 * @return {string} message
 */
function weWillKeepLooking() {
    return normalizeSpaces(`OK. We will keep checking for up to ${process.env.QUEUE_TTL_DAYS} days.
        You can always go to ${process.env.COURT_PUBLIC_URL} for more information about
        your case and contact information.`);
}

/**
 * tell them we will try to remind them as requested
 *
 * @return {String} message.
 */
function weWillRemindYou() {
    return normalizeSpaces(`Sounds good. We will attempt to text you a courtesy reminder
        the day before your hearing date. Note that court schedules frequently change.
        You should always confirm your hearing date and time by going
        to ${process.env.COURT_PUBLIC_URL}.`);
}

/**
 * ask for confirmation before stopping reminders
 * @param {Array} cases
 * @return {string} message
 */
function confirmStop(cases){
    return normalizeSpaces(`You are currently scheduled to receive reminders for ${cases.length} case${cases.length > 1 ? 's' :''}
    To stop receiving reminders for these cases send 'STOP' again.
    You can go to ${process.env.COURT_PUBLIC_URL} for more information.
    - ${process.env.COURT_NAME}`);
}

/**
 * tell them we will stop sending reminders about cases
 * @param {Array} cases
 * @return {string} message
 */
function weWillStopSending(cases) {
    return normalizeSpaces(`OK. We will stop sending reminders for the following case number${cases.length > 1 ? 's' :''}:
    ${cases.join(', ')}. If you want to resume reminders you can text these numbers to us again.
    You can go to ${process.env.COURT_PUBLIC_URL} for more information.
    - ${process.env.COURT_NAME}`);
}

/**
 * tell them we don't have any requests in the system for them
 *
 * @return {String} message.
 */
function youAreNotFollowingAnything(){
    return normalizeSpaces(`You are not currently subscribed for any reminders. If you want to be reminded
    about an upcoming hearing, send us the case/citation number. You can go to ${process.env.COURT_PUBLIC_URL} for more information.
    - ${process.env.COURT_NAME}`)
}

/**
 * Send a twilio message
 *
 * @param  {string} to   phone number message will be sent to
 * @param  {string} from who the message is being sent from
 * @param  {string} body message to be sent
 * @param  {function} function for resolving callback
 * @return {Promise} Promise to send message.
 */
function send(to, from, body) {
    return client.messages.create({
        body: body,
        to: to,
        from: from
    })
}

module.exports = {
    forMoreInfo,
    foundItWillRemind,
    iAmCourtBot,
    invalidCaseNumber,
    notFoundAskToKeepLooking,
    weWillKeepLooking,
    weWillRemindYou,
    reminder,
    send,
    unableToFindCitationForTooLong,
    cleanupName,
    weWillStopSending,
    youAreNotFollowingAnything,
    confirmStop,
};
