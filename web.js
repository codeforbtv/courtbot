/* eslint "no-console": "off" */
require('dotenv').config();
const MessagingResponse = require('twilio').twiml.MessagingResponse;
const express = require('express');
const cookieSession = require('cookie-session')
const bodyParser = require('body-parser')
const logfmt = require('logfmt');
const db = require('./db');
const rollbar = require('rollbar');
const emojiStrip = require('emoji-strip');
const messages = require('./utils/messages.js');
const moment = require("moment-timezone");
var web_api = require('./web_api/routes');

const app = express();

/* Express Middleware */
app.use(logfmt.requestLogger());
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())
app.use(cookieSession({
    name: 'session',
    secret: process.env.COOKIE_SECRET
}));

/* makes json print nicer for /cases */
app.set('json spaces', 2);

/* Serve testing page on which you can impersonate Twilio
   (but not in production) */
if (app.settings.env === 'development' || app.settings.env === 'test') {
    app.use(express.static('public'));
}

/* Allows CORS */
app.all('*', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'X-Requested-With');
    next();
});

/* Add routes for api access */
app.use('/api', web_api);

/* Enable CORS support for IE8. */
app.get('/proxy.html', (req, res) => {
    res.send('<!DOCTYPE HTML>\n<script src="http://jpillora.com/xdomain/dist/0.6/xdomain.min.js" master="http://www.courtrecords.alaska.gov"></script>');
});

app.get('/', (req, res) => {
    res.status(200).send(messages.iAmCourtBot());
});

/* Fuzzy search that returns cases with a partial name match or
   an exact citation match */
app.get('/cases', (req, res, next) => {
    if (!req.query || !req.query.q) {
        return res.sendStatus(400);
    }

    return db.fuzzySearch(req.query.q)
    .then((data) => {
      if (data) {
        data.forEach((d) => {
            d.readableDate = moment(d.date).format('dddd, MMM Do'); /* eslint "no-param-reassign": "off" */
        });
      }
      return res.json(data);
    })
    .catch(err => next(err));
});

/**
 * Twilio Hook for incoming text messages
 */
app.post('/sms',
    cleanupTextMiddelWare,
    stopMiddleware,
    yesNoMiddleware,
    caseIdMiddleware,
    unservicableRequest
);

/**
 * Strips line feeds, returns, and emojis from string and trims it
 *
 * @param  {String} text incoming message to evaluate
 * @return {String} cleaned up string
 */
function cleanupTextMiddelWare(req,res, next) {
    let text = req.body.Body.replace(/[\r\n|\n].*/g, '');
    req.body.Body = emojiStrip(text).trim().toUpperCase();
    next()
}

/* Middleware functions */
/**
 * Checks for 'STOP' text. Allows user to remove reminders (both matched to a case and not)
 * Currently it removes ALL reminders but only after asking the user to confirm.
 */
function stopMiddleware(req, res, next){
    const text = req.body.Body
    if (text !== 'STOP') return next()

    const twiml = new MessagingResponse();

    if (!req.session.stopconfirmed ) {
        // This should be the first time we heard 'Stop' from the user. Confirm before delete
        db.requestsFor(req.body.From)
        .then(case_ids => {
            if (case_ids.length === 0) {
                twiml.message(messages.youAreNotFollowingAnything())
            } else {
                req.session.stopconfirmed = true
                twiml.message(messages.confirmStop(case_ids))
            }
        res.send(twiml.toString());
        })
    } else {
        // The user has confirmed 'Stop'. Go ahead and delete.
        db.deleteRequestsFor(req.body.From)
        .then(case_ids => {
            if (case_ids.length === 0) {
                twiml.message(messages.youAreNotFollowingAnything())
            } else {
                req.session.stopconfirmed = null
                twiml.message(messages.weWillStopSending(case_ids));
            }
        res.send(twiml.toString());
        })
    }
}

/**
 * Checks for an affirmative response
 *
 * @param  {String} text incoming message to evaluate
 * @return {Boolean} true if the message is an affirmative response
 */
function isResponseYes(text) {
    return (text === 'YES' || text === 'YEA' || text === 'YUP' || text === 'Y');
}

/**
 * Checks for negative or declined response
 *
 * @param  {String} text incoming message to evaluate
 * @return {Boolean} true if the message is a negative response
 */
function isResponseNo(text) {
    return (text === 'NO' || text === 'N');
}

/**
 *  Handles cases when user has send a yes or no text.
 */
function yesNoMiddleware(req, res, next) {
    // Yes or No resonses are only meaningful if we also know the citation ID.
    if (!req.session.case_id) return next()

    const twiml = new MessagingResponse();
    if (isResponseYes(req.body.Body)) {
        db.addRequest({
            case_id: req.session.case_id,
            phone: req.body.From,
            known_case: req.session.known_case
        })
        .then(() => {
            twiml.message(req.session.known_case ? messages.weWillRemindYou() : messages.weWillKeepLooking() );
            req.session.case_id = null;
            req.session.known_case = null;
            res.send(twiml.toString());
        })
        .catch(err => next(err));
    } else if (isResponseNo(req.body.Body)) {
        req.session.case_id = null;
        req.session.known_case = null;
        twiml.message(messages.forMoreInfo());
        res.send(twiml.toString());
    } else{
        next()
    }
}

/**
 * Test message to see if it looks like a case id.
 * Currently alphan-numeric plus '-' between 6 and 25 characters
 * @param {String} text
 */
function possibleCaseID(text) {
    // Case/Citation IDs should be alpha numeric with possible '-'
    // between 6 and 25 characters
    const rx = /^[A-Za-z0-9-]{6,25}$/
    return rx.test(text);
}

/**
 * If input looks like a case number handle it
 *
 */
function caseIdMiddleware(req, res, next){
    const twiml = new MessagingResponse();
    const text = req.body.Body
    if (!possibleCaseID(text)) return next()

    db.findCitation(req.body.Body)
    .then(results => {
        if (!results || results.length === 0){
            // Looks like it could be a citation that we don't know about yet
            twiml.message(messages.notFoundAskToKeepLooking());
            req.session.known_case = false;
            req.session.case_id = text;
        } else {
            // They sent a known citation!
            twiml.message(messages.foundItAskForReminder(results[0]));
            req.session.case_id = text;
            req.session.known_case = true;
        }
        res.send(twiml.toString());
    })
    .catch(err => next(err));
}

/**
 * None of our middleware could figure out what to do with the input
 * [TODO: create a better message to help users use the service]
 */
function unservicableRequest(req, res, next){
    // this would be a good place for some instructions to the user
    const twiml = new MessagingResponse();
    twiml.message(messages.invalidCaseNumber());
    res.send(twiml.toString());
}

/* Error handling Middleware */
app.use((err, req, res, next) => {
    if (!res.headersSent) {
        console.log('Error: ', err.message);
        rollbar.handleError(err, req);

        // during development, return the trace to the client for helpfulness
        if (app.settings.env !== 'production') {
            res.status(500).send(err.stack);
            return;
        }
        res.status(500).send('Sorry, internal server error');
    }
});

/* Send all uncaught exceptions to Rollbar??? */
const options = {
    exitOnUncaughtException: true,
};
rollbar.handleUncaughtExceptionsAndRejections(process.env.ROLLBAR_ACCESS_TOKEN, options);

const port = Number(process.env.PORT || 5000);
app.listen(port, () => {
    console.log('Listening on ', port);
});

module.exports = app;
