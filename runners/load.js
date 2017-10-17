/* eslint "no-console": "off" */

require('dotenv').config(); // needed for local dev when not using Heroku to pull in env vars
const runnerScript = require('../utils/loaddata.js');
const manager = require('../utils/db/manager')
const {runners, logger} = require('../utils/logger')

runnerScript()
.then((r) => runners.loaded(r))
.then(() => manager.knex.destroy())
.catch((err) => {
    manager.knex.destroy()
    logger.error(err)
});
