'use strict';
require('dotenv').config();
const sr = require("../sendReminders.js");
const sendReminders = sr.sendReminders;
const findReminders = sr.findReminders;
const expect = require("chai").expect;
const sinon = require('sinon')
const manager = require("../utils/db/manager");
const db = require('../db');
const knex = manager.knex;
const messages = require('../utils/messages')
const moment = require('moment-timezone')
const TEST_CASE_ID = "677167760f89d6f6ddf7ed19ccb63c15486a0eab",
      TEST_UTC_DATE = moment("2015-03-27T08:00:00").tz(process.env.TZ).format(),
      TEST_UTC_DATE2 = moment("2015-03-26T08:00:00").tz(process.env.TZ).format();
// todo test that reminders are not sent when notification indicates its already sent

describe("with one reminder that hasn't been sent", function() {
    let messageStub

    beforeEach(function () {
       messageStub = sinon.stub(messages, 'send')
       messageStub.resolves(true)

       return manager.ensureTablesExist()
            .then(clearTable("hearings"))
            .then(clearTable("requests"))
            .then(clearTable("notifications"))
            .then(loadHearings([case1]))
            .then(addTestRequests([request1]))
    });

    afterEach(function() {
        messageStub.restore()
    });

    it("sends the correct info to Twilio and adds a notification", function() {
        var message = `Reminder: It appears you have a court hearing tomorrow at 2:00 PM at NEWROOM. You should confirm your hearing date and time by going to ${process.env.COURT_PUBLIC_URL}. - ${process.env.COURT_NAME}`;
        return knex("hearings").update({date: moment(14, 'HH').tz(process.env.TZ).add(1, 'days'), room: 'NEWROOM' })
        .then(() => sendReminders())
        .then(rows => {
            sinon.assert.calledWith(messageStub, request1.phone, process.env.TWILIO_PHONE_NUMBER, message)

        });
    });

    it("sending reminder adds a notification with the correct case, phone, and time", function(){
        return knex("hearings").update({date: moment(14, 'HH').tz(process.env.TZ).add(1, 'days'), room: 'NEWROOM' })
        .then(() => sendReminders())
        .then(() => knex("notifications").where({ case_id: case1.case_id }).select("*"))
        .then(function (rows) {
            expect(rows.length).to.equal(1);
            expect(rows[0].phone).to.equal(db.encryptPhone(request1.phone))
            expect(moment(rows[0].event_date).tz(process.env.TZ).toISOString()).to.equal(moment(14, 'HH').tz(process.env.TZ).add(1, 'days').toISOString())
        })
    })
});

describe("with three reminders (including one duplicate) that haven't been sent", function () {
    let messageMock

    beforeEach(function () {
        messageMock = sinon.mock(messages)

        return manager.ensureTablesExist()
            .then(clearTable("hearings"))
            .then(clearTable("requests"))
            .then(clearTable("notifications"))
            .then(loadHearings([case1, case2]))
            .then(addTestRequests([request1, request2, request2_dup]))
    });

    afterEach(function() {
        messageMock.restore()
    });

    it("sends the correct info to Twilio, adds notification, and skips duplicate request", function () {
        var message = `Reminder: It appears you have a court hearing tomorrow at 2:00 PM at NEWROOM. You should confirm your hearing date and time by going to ${process.env.COURT_PUBLIC_URL}. - ${process.env.COURT_NAME}`;
        messageMock.expects('send').resolves(true).once().withExactArgs(request1.phone, process.env.TWILIO_PHONE_NUMBER, message)
        messageMock.expects('send').resolves(true).once().withExactArgs(request2.phone, process.env.TWILIO_PHONE_NUMBER, message)

        return knex("hearings").update({ date:  moment(14, 'HH').tz(process.env.TZ).add(1, 'days'), room: 'NEWROOM' })
        .then(() => sendReminders())
        .then(res => knex("notifications").whereIn('case_id', [case1['case_id'], case2['case_id']]).select("*"))
        .then(rows => {
            messageMock.verify()
            expect(rows.length).to.equal(2);
        });
    });
});

describe("with notification already set for hearing", function () {
    let messageMock

    beforeEach(function () {
        messageMock = sinon.mock(messages)
        //messageExpectation.resolves(true)

        return manager.ensureTablesExist()
            .then(clearTable("hearings"))
            .then(clearTable("requests"))
            .then(clearTable("notifications"))
            .then(loadHearings([case1, case2]))
            .then(addTestRequests([request1, request2]))
            .then(addTestNotification(notification1))

    });

    afterEach(function() {
        messageMock.restore()
    });

    it("Should only send reminders to requests without existing notifications for same case_id/event time/number", function(){
        var message = `Reminder: It appears you have a court hearing tomorrow at 2:00 PM at NEWROOM. You should confirm your hearing date and time by going to ${process.env.COURT_PUBLIC_URL}. - ${process.env.COURT_NAME}`;
        messageMock.expects('send').resolves(true).once().withExactArgs(request2.phone, process.env.TWILIO_PHONE_NUMBER, message)

        return knex("hearings").update({ date:  moment(14, 'HH').tz(process.env.TZ).add(1, 'days'), room: 'NEWROOM' })
        .then(() => knex("notifications").update({ event_date:  moment(14, 'HH').tz(process.env.TZ).add(1, 'days')}))
        .then(() => sendReminders())
        .then(() => knex("notifications").whereIn('case_id', [case1['case_id'], case2['case_id']]).select("*"))
        .then(rows => {
            messageMock.verify()
            expect(rows.length).to.equal(2)
        })
    })

    it("should send reminder when notification exists for same phone/case_id but at a different date/time", function(){
        var message = `Reminder: It appears you have a court hearing tomorrow at 2:00 PM at NEWROOM. You should confirm your hearing date and time by going to ${process.env.COURT_PUBLIC_URL}. - ${process.env.COURT_NAME}`;
        messageMock.expects('send').resolves(true).once().withExactArgs(request1.phone, process.env.TWILIO_PHONE_NUMBER, message)
        messageMock.expects('send').resolves(true).once().withExactArgs(request2.phone, process.env.TWILIO_PHONE_NUMBER, message)
        return knex("hearings").update({ date:  moment(14, 'HH').tz(process.env.TZ).add(1, 'days'), room: 'NEWROOM' })
        .then(() =>  sendReminders())
        .then(() => messageMock.verify())
    })
})

function loadHearings(hearing) {
    return function() {
        return knex("hearings").insert(hearing);
    }
}

function addTestRequests(requests) {
    return function () {
        return Promise.all(requests.map(function (request) {
            return addTestRequest(request);
        }));
    }
}

function addTestRequest(request) {
    return db.addRequest({
        case_id: request.case_id,
        phone: request.phone,
        known_case: request.known_case
    });
}
function addTestNotification(notification){
    return function(){
        return knex("notifications").insert(notification)
    }
}
function clearTable(table) {
    return function() {
        return knex(table).del()
    };
}

const case1 = {
    //date: '27-MAR-15',
    date: TEST_UTC_DATE,
    defendant: 'TURNER, FREDERICK T',
    room: 'CNVCRT',
    case_id: "4928456"
}

const case2 = {
    //date: '27-MAR-15',
    date: TEST_UTC_DATE,
    defendant: 'SMITH, Bob J',
    room: 'CNVJAIL',
    case_id: "4928457"
}

const request1 = {
    phone: "+12223334444",
    case_id: case1.case_id,
    known_case: true
}

const request2 = {
    case_id: case2.case_id,
    phone: "+12223334445",
    known_case: true
}

const request2_dup = {
    case_id: case2.case_id,
    phone: "+12223334445",
    known_case: true
}

const notification1 = {
    case_id: case1.case_id,
    phone: db.encryptPhone(request1.phone),
    event_date: TEST_UTC_DATE,
    type:'reminder'
}

const notification2 = {
    case_id: case2.case_id,
    phone: db.encryptPhone(request2.phone),
    event_date: TEST_UTC_DATE2,
    type:'reminder'
}