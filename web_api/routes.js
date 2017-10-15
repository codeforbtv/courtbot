const express = require('express')
const router = express.Router()
const db = require('./db')
const moment = require('moment-timezone')
/*
router.get('/cases', function(req, res, next){
if (!req.query || !req.query.q) return res.send(400);

db.fuzzySearch(req.query.q)
.then(data => {
  if (data) {
    data.forEach(function (d) {
      d.readableDate = dates.fromUtc(d.date).format('dddd, MMM Do');
    });
  }
  res.send(data);
})
.catch(err => next(err))
})

*/

/* lookup case by id -- not fuzzy */
router.get('/case', function(req, res, next){
if (!req.query || !req.query.q) return res.send(400);

db.findHearing(req.query.q)
.then(data => {
  if (data) {
    data.forEach(function (d) {
      console.log("data: ", d)
      // Replace postgres' [null] with [] is much nicer on the front end
      d.requests = d.requests.filter(r => r)
      d.readableDate = moment(d.date).format('dddd, MMM Do');
    });
  }
  res.send(data);
})
.catch(err => next(err))
})

/* returns a simple object with counts: { scheduled: '3', sent: '10', all: '3' } */
router.get('/request_counts', function(req, res, next){
db.requestCounts()
.then(data => res.send(data))
.catch(err => next(err))
})


/* returns a simple object with counts: { count: '3' } */
router.get('/hearing_counts', function(req, res, next){
db.hearingCount()
.then(data => res.send(data))
.catch(err => next(err))
})

module.exports = router;