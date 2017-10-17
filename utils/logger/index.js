const { createLogger, format, transports } = require('winston');
const { combine, timestamp, label, printf, colorize } = format;
const Transport = require('winston-transport');

const action_symbol = Symbol.for('action');
const hits = require('./hit_log');
const {logSendRunner, logLoadRunner, logRequest, logDeleteRequest} = require('./request_log')
const schema = require('./schema')
const Rollbar = require('rollbar');

const rollbar = new Rollbar({
  accessToken: process.env.ROLLBAR_ACCESS_TOKEN,
  captureUncaught: false,
  captureUnhandledRejections: false
});

schema.checkDBTables()

/**
 * Basic log for incoming sms and web requests
 * This function is called by 'on-headers' module in web.js, which
 * sets the value of 'this' to the Express response object
 */
function hitLogger() {
    hits.hit(`${this.req.url} ${this.statusCode} ${this.req.method} ${this.req.body.From} ${this.req.body.Body}  ${this[action_symbol]}`, this)
}

/**
 * Logs load and reminder runners. The reminder runners also log individual notifications sent
 */
const runnerLog = {
    sent({action, data}){
        return logSendRunner({action, data})
        .then((r) => logger.info(`Runner: ${r.action} | sent: ${r.sent} errors: ${r.err} `))
        .catch(logger.error)
    },
    loaded({files, records}){
        return logLoadRunner({files, records})
        .then((r) => logger.info(`Runner: load | files: ${r.files} records: ${r.records} `))
        .catch(logger.error)
    }
}

/**
 * Logs when user adds or deletes a request
 */
const requestLog = {
    add({case_id, phone, known_case}){
        return logRequest({case_id, phone, known_case})
    },
    delete({case_id, phone}){
        return logDeleteRequest({case_id, phone})
    }
}

class rollbarTransport extends Transport {
    constructor(opts) {
      super(opts);
    }
    log(error, callback) {
        setImmediate(() => this.emit('logged', "error"));
        rollbar.error(error, function(err2) {
            if (err2) console.log("error reporting to rollbar: ", err2)
            callback()
        })
    }
  };

const logFormat = printf(info => {
    return `${info.level}: ${info.timestamp} ${info.message}`
});
const logger = createLogger({
    format: combine(
        colorize(),
        timestamp(),
        logFormat
      ),
    transports: [
        new transports.Console(),
        new rollbarTransport({level: 'error'})
    ]
})

module.exports = {
    runners: runnerLog,
    hits: hitLogger,
    request: requestLog,
    logger: logger,
}
