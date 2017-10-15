/* eslint "no-console": "off" */

require('dotenv').config(); // needed for local dev when not using Heroku to pull in env vars
const runnerScript = require('../sendUnmatched.js').sendUnmatched;
const rollbar = require('rollbar');
const log = require('../utils/logger');

rollbar.init(process.env.ROLLBAR_ACCESS_TOKEN);

runnerScript()
.then((expired_and_matched) => {
    console.log('Success: ', expired_and_matched);
    return Promise.all([
        log.sent({action:'send_expired', data: expired_and_matched.expired}),
        log.sent({action: 'send_matched', data: expired_and_matched.matched})
        ])
})
.then(() => process.exit(0))
.catch((err) => {
    console.log(err);
    // Using callback for process.exit() so the process does not exit before rollbar
    //    is finished sending error.
    //    Sending null as second arg since there is no
    //    request object
    rollbar.handleError(err, null, () => {
      process.exit(1);
    });
});
