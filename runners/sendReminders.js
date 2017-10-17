/* eslint "no-console": "off" */

require('dotenv').config(); // needed for local dev when not using Heroku to pull in env vars
const runnerScript = require('../sendReminders.js').sendReminders;
const manager = require('../utils/db/manager')
const {runners, logger} = require('../utils/logger')


runnerScript()
.then(reminders => runners.sent({action: 'send_reminder', data: reminders}))
.then(() => manager.knex.destroy())
.catch((err) => {
    manager.knex.destroy()
    logger.error(err)
});
