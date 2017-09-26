'use strict';
// setup ENV dependencies
require('dotenv').config();

const fs = require('fs');
const expect = require('chai').expect;
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const Keygrip = require('keygrip');
const app = require('../web');
const session = require('supertest-session');

const db = require('../db.js');
const manager = require('../utils/db/manager');
const dates = require('../utils/dates');
const moment = require('moment-timezone');

const knex = manager.knex;

const TEST_UTC_DATE = "2015-03-27T13:00:00" + dates.timezoneOffset("2015-03-27");
const keys = Keygrip([process.env.COOKIE_SECRET])

let sess;

/**
 * Altered this to do a local read of the expected content to get expected content length because
 * on windows machine the content length was 354 and not the hard-coded 341 (maybe windows character encoding?)
 *
 * It is partly a guess that it is okay to make this change because I am assuming the unit tests
 * only should run where app.settings.env == 'development' (web.js) -- this is what causes public/index.html
 * to be served, rather than "hello I am courtbot..."
 */
describe("GET /", function() {
    beforeEach(function() {
        sess = session(app);
    })
    afterEach(function(){
        sess.destroy();
    })
    it("responds with web form test input", function(done) {
        var expectedContent = fs.readFileSync("public/index.html", "utf8");
        sess.get('/')
        .expect('Content-Length', expectedContent.length.toString())
        .expect(200)
        .end(function(err, res) {
            if (err) return done(err);
            expect(res.text).to.contain("Impersonate Twilio");
            done();
        });
    });
});

describe("GET /cases", function() {
    beforeEach(function() {
        sess = session(app);
    })
    afterEach(function(){
        sess.destroy();
    })
    it("400s when there is no ?q=", function(done) {
        sess.get('/cases')
        .expect(400, done);
    });

    it("200s + empty array when there is ?q=", function(done) {
        sess.get('/cases?q=test')
        .expect(200)
        .end(function(err, res) {
            if (err) return done(err);
            expect(res.text).to.equal("[]");
            done();
        });
    });

    it("finds partial matches of name", function(done) {
        knex('cases').del().then(function() {
        knex('cases').insert([turnerData(1), turnerData(2)]).then(function() {
            sess.get('/cases?q=turner')
            .expect(200)
            .end(function(err, res) {
                if (err) return done(err);
                expect([sortObject(JSON.parse(res.text)[0]),sortObject(JSON.parse(res.text)[1])]).to.deep.equal([turnerDataAsObject(1), turnerDataAsObject(2)]);
                done();
            });
        });
        });
    });

    it("finds exact matches of id", function(done) {
        knex('cases').del()
        .then(() => knex('cases').insert([turnerData()]))
        .then(() => {
            sess.get('/cases?q=4928456')
            .expect(200)
            .end(function(err, res) {
                if (err) return done(err);
                expect(sortObject(JSON.parse(res.text))["0"]).to.deep.equal(turnerDataAsObject());
                done();
            });
        });
    });

    it("finds find id with leading and trailing spaces", function(done) {
        knex('cases').del()
        .then(() =>  knex('cases').insert([turnerData()]))
        .then(() => {
            sess.get('/cases?q=%204928456%20')
            .expect(200)
            .end(function(err, res) {
                if (err) return done(err);
                expect(sortObject(JSON.parse(res.text))["0"]).to.deep.equal(turnerDataAsObject());
                done();
            });
        });
    });

    it("doesnt find partial matches of id", function(done) {
        knex('cases').del()
        .then(() => knex('cases').insert([turnerData()]))
        .then(() => {
            sess.get('/cases?q=492845')
            .expect(200)
            .end(function(err, res) {
                if (err) return done(err);
                expect(JSON.parse(res.text)).to.deep.equal([]);
                done();
            });
        });
    });
});

describe("POST /sms", function() {
    const  new_date = moment().add(5, 'days');

    beforeEach(function() {
        sess = session(app);
        return knex('cases').del()
        .then(() => knex('reminders').del())
        .then(() => knex('queued').del())
        .then(() =>  knex('cases').insert([turnerData('', new_date)]))
    })
    afterEach(function () {
        sess.destroy();
      });
    context("without session set", function() {
        context("with 1 matching court case", function() {
            const params = { Body: " 4928456 ", From: "+12223334444"};

            beforeEach(function() {
                return knex('cases').del()
                .then(() => knex('cases').insert([turnerData("", new_date)]))
            });

            it("says there is a court case and prompts for reminder", function(done) {
                sess.post('/sms')
                .send(params)
                .expect(200)
                .end(function(err, res) {
                    if (err) return done(err);
                    expect(res.text).to.equal(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>We found a case for Frederick Turner scheduled on ${new_date.format('ddd, MMM Do')} at ${new_date.format('h:mm A')}, at CNVCRT. Would you like a courtesy reminder the day before? (reply YES or NO)</Message></Response>`);
                    done();
                });
            });

            it("strips emojis from a text", function (done) {
                sess.post('/sms')
                .send({
                    Body: '4928456 😁',
                    From: "+12223334444"
                })
                .expect(200)
                .end(function(err, res) {
                    if(err) return done(err);
                    expect(res.text).to.equal(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>We found a case for Frederick Turner scheduled on ${new_date.format('ddd, MMM Do')} at ${new_date.format('h:mm A')}, at CNVCRT. Would you like a courtesy reminder the day before? (reply YES or NO)</Message></Response>`);
                    done();
                });
            });

            it("strips everything after newlines and carriage returns from id", function (done) {
                sess.post('/sms')
                .send({
                    Body: '4928456\r\n-Simon',
                    From: "+12223334444"
                })
                .expect(200)
                .end(function(err, res) {
                    if(err) return done(err);
                    expect(res.text).to.equal(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>We found a case for Frederick Turner scheduled on ${new_date.format('ddd, MMM Do')} at ${new_date.format('h:mm A')}, at CNVCRT. Would you like a courtesy reminder the day before? (reply YES or NO)</Message></Response>`);
                    done();
                });
            });

            it("strips everything after newlines and carriage returns from id", function (done) {
                sess.post('/sms')
                .send({
                    Body: '4928456\n-Simon',
                    From: "+12223334444"
                })
                .expect(200)
                .end(function(err, res) {
                    if(err) return done(err);
                    expect(res.text).to.equal(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>We found a case for Frederick Turner scheduled on ${new_date.format('ddd, MMM Do')} at ${new_date.format('h:mm A')}, at CNVCRT. Would you like a courtesy reminder the day before? (reply YES or NO)</Message></Response>`);
                    done();
                });
            });

            it("sets match and askedReminder on session", function(done) {
                sess.post('/sms')
                .send(params)
                .expect(200)
                .end(function(err, res) {
                    if (err)  return done(err);
                    expect(getConnectCookie().askedQueued).to.equal(false);
                    expect(getConnectCookie().askedReminder).to.equal(true);
                    expect(getConnectCookie().match).to.deep.equal(rawTurnerDataAsObject("", new_date.toISOString()));
                    done();
                });
            });
        });

        context("with 0 matching court cases", function() {
            context("with a citation length between 6-25 inclusive", function() {
                const params = { Body: "123456", From: "+12223334444" };

                it("says we couldn't find their case and prompt for reminder", function(done) {
                    sess.post('/sms')
                    .send(params)
                    .expect(200)
                    .end(function(err, res) {
                        if (err)  return done(err);
                        expect(res.text).to.equal('<?xml version="1.0" encoding="UTF-8"?><Response><Message>Could not find a case with that number. It can take several days for a case to appear in our system. Would you like us to keep checking for the next ' + process.env.QUEUE_TTL_DAYS + ' days and text you if we find it? (reply YES or NO)</Message></Response>');
                        //expect(res.text).to.equal('<?xml version="1.0" encoding="UTF-8"?><Response><Message>(1/2) Could not find a case with that number. It can take several days for a case to appear in our system.</Sms><Sms>(2/2) Would you like us to keep checking for the next ' + process.env.QUEUE_TTL_DAYS + ' days and text you if we find it? (reply YES or NO)</Message></Response>');
                        done();
                    });
                });

                it("sets the askedQueued and citationId cookies", function(done) {
                    sess.post('/sms')
                    .send(params)
                    .expect(200)
                    .end(function(err, res) {
                        if (err) return done(err);
                        expect(getConnectCookie().askedQueued).to.equal(true);
                        expect(getConnectCookie().askedReminder).to.equal(false);
                        expect(getConnectCookie().citationId).to.equal("123456");
                        done();
                    });
                });
            });

            context("the citation length is too short", function() {
                const params = { Body: "12345", From: "+12223334444"  };

                it("says that case id is wrong", function(done) {
                    sess.post('/sms')
                    .send(params)
                    .expect(200)
                    .end(function(err, res) {
                        if (err) return done(err);
                        expect(res.text).to.equal('<?xml version="1.0" encoding="UTF-8"?><Response><Message>Couldn\'t find your case. Case identifier should be 6 to 25 numbers and/or letters in length.</Message></Response>');
                        expect(getConnectCookie().askedQueued).to.equal(undefined);
                        expect(getConnectCookie().askedReminder).to.equal(undefined);
                        expect(getConnectCookie().citationId).to.equal(undefined);
                        done();
                    });
                 });
             });
        });

        context("Same day court case or or case already happened", function() {
            const params = { Body: "4928456", From: "+12223334444"  };

            it("says case is same day", function(done) {
                const caseDate = moment().add(1, "hours")
                knex('cases').del()
                .then(() => knex('cases').insert([turnerData("", caseDate)]))
                .then(() => {
                    sess.post('/sms').send(params)
                    .expect(200)
                    .end(function (err, res) {
                        if (err) return done(err);
                        expect(res.text).to.equal(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>We found a case for Frederick Turner scheduled today at ${caseDate.format('h:mm A')}, at CNVCRT. Would you like a courtesy reminder the day before a future hearing? (reply YES or NO)</Message></Response>`);
                        expect(getConnectCookie().askedQueued).to.equal(false);
                        expect(getConnectCookie().askedReminder).to.equal(true);
                        expect(getConnectCookie().citationId).to.equal(undefined);
                        done();
                    });
                });
            });

            it("says case is already happening (time is now)", function (done) {
                const caseDate = moment()
                knex('cases').del()
                .then(() => knex('cases').insert([turnerData("", caseDate)]))
                .then(() => {
                    sess.post('/sms').send(params)
                    .expect(200)
                    .end(function (err, res) {
                        if (err) return done(err);
                        expect(res.text).to.equal(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>We found a case for Frederick Turner scheduled today at ${caseDate.format('h:mm A')}, at CNVCRT. Would you like a courtesy reminder the day before a future hearing? (reply YES or NO)</Message></Response>`);
                        expect(getConnectCookie().askedQueued).to.equal(false);
                        expect(getConnectCookie().askedReminder).to.equal(true);
                        expect(getConnectCookie().citationId).to.equal(undefined);
                        done();
                    });
                });
            });

            it("says case is already happening (time in the past)", function (done) {
                const caseDate = moment().subtract(2, "hours")
                knex('cases').del()
                .then(() => knex('cases').insert([turnerData("", caseDate)]))
                .then(() => {
                    sess.post('/sms').send(params)
                    .expect(200)
                    .end(function (err, res) {
                        if (err) return done(err);
                        expect(res.text).to.equal(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>We found a case for Frederick Turner scheduled today at ${caseDate.format('h:mm A')}, at CNVCRT. Would you like a courtesy reminder the day before a future hearing? (reply YES or NO)</Message></Response>`);
                        expect(getConnectCookie().askedQueued).to.equal(false);
                        expect(getConnectCookie().askedReminder).to.equal(true);
                        expect(getConnectCookie().citationId).to.equal(undefined);
                        done();
                    });
                });
            });
        });
    });

    context("with session.askedReminder", function() {
        const  new_date = moment().add(5, 'days');
        // Build json object, serialize, sign, encode
        var cookieObj = {match: rawTurnerDataAsObject("", new_date), askedReminder: true};
        var cookieb64 = new Buffer(JSON.stringify(cookieObj)).toString('base64');
        var sig = keys.sign('session='+cookieb64);
        var cookieArr = ['session='+cookieb64 + '; session.sig=' + sig + '; Path=/;'];

        describe("User responding askedReminder session", function() {
            it("YES - creates a reminder and responds appropriately", function (done) {
                const params = { Body: " yEs ", From: "+12223334444" };
                sess.post('/sms').set('Cookie', cookieArr[0]).send(params)
                .expect(200)
                .end(function (err, res) {
                    if (err)  return done(err);

                    expect(res.text).to.equal('<?xml version="1.0" encoding="UTF-8"?><Response><Message>Sounds good. We will attempt to text you a courtesy reminder the day before your hearing date. Note that court schedules frequently change. You should always confirm your hearing date and time by going to http://courts.alaska.gov.</Message></Response>');
                    expect(getConnectCookie().askedReminder).to.equal(false);

                    knex("reminders").select("*").groupBy("reminders.reminder_id").count('* as count')
                    .then((rows) => {
                        const record = rows[0];
                        expect(record.count).to.equal('1');
                        expect(record.phone).to.equal(db.encryptPhone('+12223334444'));
                        expect(record.case_id).to.equal('677167760f89d6f6ddf7ed19ccb63c15486a0eab');
                        expect(record.sent).to.equal(false);
                        expect(record.original_case).to.deep.equal(rawTurnerDataAsObject("", new_date));
                        })
                    .then(done, done)
                });
            });

            it("NO - doesn't create a reminder and responds appropriately", function (done) {
                const params = { Body: " nO ", From: "+12223334444" };
                sess.post('/sms').set('Cookie', cookieArr).send(params)
                .expect(200)
                .end(function (err, res) {
                    if (err) return done(err);
                    expect(res.text).to.equal('<?xml version="1.0" encoding="UTF-8"?><Response><Message>OK. You can always go to ' + process.env.COURT_PUBLIC_URL + ' for more information about your case and contact information.</Message></Response>');
                    expect(getConnectCookie().askedReminder).to.equal(false);
                    knex("reminders").count('* as count')
                    .then((rows) => {
                        expect(rows[0].count).to.equal('0');
                    })
                    .then(done, done)
                });
            });
        });
    });


    context("with askedReminder from Queued trigger", function() {
        beforeEach(function () {
            return knex('cases').del()
            .then(() => knex('reminders').del())
            .then(() => knex('cases').insert([turnerData("", new_date)]))
            .then(() => knex("queued").del())
            .then(() => {
                return knex('queued').insert({
                    citation_id: "4928456",
                    sent: true,
                    phone: db.encryptPhone('+12223334444'),
                    asked_reminder: true,
                    asked_reminder_at: "NOW()",
                    created_at: "NOW()"
                })
            })
        });

        describe("User responding to a queued message", function() {
            const cookieArr = [""];

            it("YES - creates a reminder and responds appropriately", function (done) {
                const params = { Body: " yEs ", From: "+12223334444" };
                sess.post('/sms').set('Cookie', cookieArr[0]).send(params)
                .expect(200)
                .end(function (err, res) {
                    if (err) return done(err);
                    const data = rawTurnerDataAsObject("", new_date)
                    expect(res.text).to.equal('<?xml version="1.0" encoding="UTF-8"?><Response><Message>Sounds good. We will attempt to text you a courtesy reminder the day before your hearing date. Note that court schedules frequently change. You should always confirm your hearing date and time by going to http://courts.alaska.gov.</Message></Response>');
                    expect(getConnectCookie().askedReminder).to.equal(false);
                    knex("reminders").select("*").groupBy("reminders.reminder_id").count('* as count')
                    .then(rows =>  {
                        const record = rows[0];
                        expect(record.count).to.equal('1');
                        expect(record.phone).to.equal(db.encryptPhone('+12223334444'));
                        expect(record.case_id).to.equal('677167760f89d6f6ddf7ed19ccb63c15486a0eab');
                        expect(record.sent).to.equal(false);
                        expect(record.original_case.id).to.equal(data.id);
                        expect(record.original_case.date).to.equal(data.date);
                        expect(record.original_case.defendant).to.equal(data.defendant);
                        })
                    .then(done, done)
                });
            });

            it("NO - doesn't create a reminder and responds appropriately", function (done) {
                const params = { Body: " nO ", From: "+12223334444" };
                sess.post('/sms').set('Cookie', cookieArr[0]).send(params)
                .expect(200)
                .end(function (err, res) {
                    if (err) return done(err);
                    expect(res.text).to.equal('<?xml version="1.0" encoding="UTF-8"?><Response><Message>OK. You can always go to ' + process.env.COURT_PUBLIC_URL + ' for more information about your case and contact information.</Message></Response>');
                    expect(getConnectCookie().askedReminder).to.equal(false);
                    knex("reminders").count('* as count')
                    .then(rows => {
                        expect(rows[0].count).to.equal('0')
                    })
                    .then(done, done)
                })
            });
        });
    });

    context("with old askedReminder from Queued trigger", function() {
        beforeEach(function () {
            return knex('cases').del()
            .then(() => knex('reminders').del())
            .then(() => knex('cases').insert([turnerData()]))
            .then(() => knex("queued").del())
            .then(() => {
                const oldDate = new Date();
                oldDate.setHours(oldDate.getHours() - 5);
                return knex('queued').insert({
                    citation_id: "4928456",
                    sent: true,
                    phone: db.encryptPhone('+12223334444'),
                    asked_reminder: true,
                    asked_reminder_at: oldDate,
                    created_at: "NOW()"
                })
            });
        });

        describe("User responding to an old queued message", function() {
            it("YES - doesn't find citation", function(done) {
                var params = { Body: " yEs ", From: "+12223334444" };
                sess.post('/sms').send(params)
                .expect(200)
                .end(function (err, res) {
                    if (err) return done(err);
                    expect(res.text).to.equal('<?xml version="1.0" encoding="UTF-8"?><Response><Message>Couldn\'t find your case. Case identifier should be 6 to 25 numbers and/or letters in length.</Message></Response>');
                    expect(getConnectCookie().askedQueued).to.equal(undefined);
                    expect(getConnectCookie().askedReminder).to.equal(undefined);
                    expect(getConnectCookie().citationId).to.equal(undefined);
                    done();
                });
            });

            it("NO - doesn't find citation", function(done) {
                var params = { Body: " nO ", From: "+12223334444" };
                sess.post('/sms').send(params)
                .expect(200)
                .end(function (err, res) {
                    if (err) return done(err);
                    expect(res.text).to.equal('<?xml version="1.0" encoding="UTF-8"?><Response><Message>Couldn\'t find your case. Case identifier should be 6 to 25 numbers and/or letters in length.</Message></Response>');
                    expect(getConnectCookie().askedQueued).to.equal(undefined);
                    expect(getConnectCookie().askedReminder).to.equal(undefined);
                    expect(getConnectCookie().citationId).to.equal(undefined);
                    done();
                });
            });
        });
    });


    context("with session.askedQueued", function() {
        var cookieStr = '{"citationId":"123456","askedQueued":true}';
        var cookieb64 = new Buffer(cookieStr).toString('base64');
        var sig = keys.sign('session='+cookieb64);
        var cookieArr = ['session='+cookieb64 + '; session.sig=' + sig + '; Path=/;'];

        describe("the user texts YES", function() {
            var params = { Body: " Y ", From: "+12223334444" };
            it("creates a queued", function(done) {
                sess.post('/sms')
                .set('Cookie', cookieArr)
                .send(params)
                .expect(200)
                .end(function(err, res) {
                    if (err) return done(err);
                    knex("queued").select("*").groupBy("queued.queued_id").count('* as count')
                    .then(rows => {
                        var record = rows[0];
                        expect(record.count).to.equal('1');
                        expect(record.phone).to.equal(db.encryptPhone('+12223334444'));
                        expect(record.citation_id).to.equal('123456');
                        expect(record.sent).to.equal(false);
                    })
                    .then(done, done);
                });
            });

            it("tells the user we'll text them", function(done) {
                sess.post('/sms')
                .set('Cookie', cookieArr)
                .send(params)
                .expect(200)
                .end(function(err, res) {
                    expect(res.text).to.equal('<?xml version="1.0" encoding="UTF-8"?><Response><Message>OK. We will keep checking for up to ' + process.env.QUEUE_TTL_DAYS + ' days. You can always go to ' + process.env.COURT_PUBLIC_URL + ' for more information about your case and contact information.</Message></Response>');
                    expect(getConnectCookie().askedQueued).to.equal(false);
                    done();
                });
            });
        });

        describe("the user texts NO", function() {
            const params = { Body: " No ", From: "+12223334444" };

            it("doesn't create a queued", function(done) {
                sess.post('/sms')
                .set('Cookie', cookieArr)
                .send(params)
                .expect(200)
                .end(function(err, res) {
                    if (err)  return done(err);
                    knex("queued").count('* as count')
                    .then(function(rows) {
                        expect(rows[0].count).to.equal('0');
                        done();
                    })
                    .catch(err => done(err))
                });
            });

            it("tells the user where to get more info", function(done) {
                sess.post('/sms')
                .set('Cookie', cookieArr)
                .send(params)
                .expect(200)
                .end(function(err, res) {
                    expect(res.text).to.equal('<?xml version="1.0" encoding="UTF-8"?><Response><Message>OK. You can always go to ' + process.env.COURT_PUBLIC_URL + ' for more information about your case and contact information.</Message></Response>');
                    expect(getConnectCookie().askedQueued).to.equal(false);
                    done();
                });
            });
        });
    });
});

function turnerData(v,d) {
  return {
    //date: '27-MAR-15',
    date: d||TEST_UTC_DATE,
    defendant: 'Frederick Turner',
    room: 'CNVCRT',
    time: moment.utc(d||TEST_UTC_DATE).format("hh:00:00 A"),
    citations: '[{"id":"4928456","violation":"40-8-76.1","description":"SAFETY BELT VIOLATION","location":"27 DECATUR ST"}]',
    id: '677167760f89d6f6ddf7ed19ccb63c15486a0eab' + (v||"")
  };
}

function turnerDataAsObject(v,d) {
    const data = turnerData(v,d);
    data.date = d||TEST_UTC_DATE;
    data.citations = JSON.parse(data.citations);
    data.readableDate = moment.utc(d||TEST_UTC_DATE).format("dddd, MMM Do");
    return data;
}

function rawTurnerDataAsObject(v,d) {
    const data = turnerData(v,d);
    data.date = moment(d ||TEST_UTC_DATE).tz(process.env.TZ).format();
    data.citations = JSON.parse(data.citations);
    data.today = moment(d).isSame(moment(), 'day')
    data.has_past = moment(d).isBefore(moment())
    return data;
}
function getConnectCookie() {
    if (!sess.cookies) return {}
    const sessionCookie =  sess.cookies.find(cookie => cookie.name === 'session');
    const cookie = sessionCookie && JSON.parse(Buffer.from(sessionCookie['value'], 'base64'));
    return cookie || {}
  }

function sortObject(o) {
    let sorted = {},
        a = [];

    for (let key in o) {
        if (o.hasOwnProperty(key)) {
            a.push(key);
        }
    }

    a.sort();

    for (let key = 0; key < a.length; key++) {
        sorted[a[key]] = o[a[key]];
    }
    return sorted;
}
