var runnerScript = require("../sendQueued.js");

runnerScript().then(function(success) {
  console.log("Success: " + success.toString);
  process.exit(0);
}, function(err) {
  console.log("Error: " + err.toString);
  process.exit(1);
});
