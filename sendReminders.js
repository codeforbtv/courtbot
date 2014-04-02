var Knex = require('knex');
var twilio = require('twilio');
var client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

var knex = Knex.initialize({
  client: 'pg',
  connection: process.env.DATABASE_URL
});

// Finds reminders for cases happening tomorrow
var findReminders = function() {
  return knex('reminders')
    .where('sent', false)
    .join('cases', 'reminders.citation', '=', 'cases.citation')
    .where('cases.date', 'tomorrow')
    .select()
};

findReminders().exec(function(err, results) {
  if (results.length === 0) {
    console.log('No reminders to send out today.');
    process.exit();
  }

  var count = 0;

  // Send SMS reminder
  results.forEach(function(reminder) {
    client.sendMessage({
      to: reminder.phone,
      from: process.env.TWILIO_PHONE_NUMBER,
      body: 'Reminder: You\'ve got a court case tomorrow at ' + reminder.time + ' in court room ' + reminder.room + '. Call us at (404) 658-6940 with any questions. -Atlanta Municipal Court'

    }, function(err, result) {
      if (err) return console.log(err);
      console.log('Reminder sent to ' + reminder.phone);
      count++;
      if (count === results.length) process.exit();
    });

    // Update table
    knex('reminders')
      .where('reminder_id', '=', reminder.reminder_id)
      .update({'sent': true})
      .exec(function(err, results) {
        if (err) console.log(err);
      });
  })
})