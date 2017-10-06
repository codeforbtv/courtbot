'use strict';
require('dotenv').config();
const sendUnmatched = require("../sendUnmatched.js").sendUnmatched;
const expect = require("chai").expect;
const assert = require("chai").assert;
const moment = require("moment-timezone")
const manager = require("../utils/db/manager");
const db = require('../db');
const knex = manager.knex;
const sinon = require('sinon')
const messages = require('../utils/messages')

describe("with 2 unmatched requests that now have matching hearings (same case_id / different phone number)", function() {
    let messageMock
    let phone1 = '+12223334444'
    let phone2 = '+12223334445'
    beforeEach(function() {
        messageMock = sinon.mock(messages)

        return manager.ensureTablesExist()
        .then(() => knex('hearings').del())
        .then(() => knex('hearings').insert([turnerData()]))
        .then(() => knex("requests").del())
        .then(() => knex("notifications").del())
        .then(() => db.addRequest({ case_id: "4928456", phone: phone1, known_case: false}))
        .then(() => db.addRequest({ case_id: "4928456", phone: phone2, known_case: false}))
    });

    afterEach(function(){
        messageMock.restore()
    });

    it("sends the correct info to Twilio and updates the known_case to true", function() {
        const number = "+12223334444";
        const message = `Hello from the ${process.env.COURT_NAME}. We found a case for Frederick Turner scheduled on Fri, Mar 27th at 1:00 PM, at CNVCRT. We will send you courtesy reminders the day before future hearings.`;
        messageMock.expects('send').resolves(true).once().withExactArgs(phone1, process.env.TWILIO_PHONE_NUMBER, message)
        messageMock.expects('send').resolves(true).once().withExactArgs(phone2, process.env.TWILIO_PHONE_NUMBER, message)

        return sendUnmatched()
        .then(res => knex("requests").select("*"))
        .then(rows => {
            expect(rows.length).to.equal(2)
            expect(rows[0].known_case).to.equal(true);
            expect(rows[1].known_case).to.equal(true);
            messageMock.verify()
        });
    });
});

describe("with an unmatched request", function() {
    let messageStub
    const number = "+12223334444";
    const case_id = "123"
    beforeEach(function() {
        messageStub = sinon.stub(messages, 'send')
        messageStub.resolves(true)

        return knex('hearings').del()
        .then(() => knex('hearings').insert([turnerData()]))
        .then(() => knex("requests").del())
        .then(() => knex("notifications").del())
        .then(() => db.addRequest({case_id: case_id, phone: number, known_case: false}))
    });

    afterEach(function(){
        messageStub.restore()
    });

    it("doesn't do anything < QUEUE_TTL days", function() {
        return sendUnmatched()
        .then(res =>  knex("requests").select("*"))
        .then(rows => {
            sinon.assert.notCalled(messageStub)
            expect(rows[0].known_case).to.equal(false)
        })
    });

    it("sends a failure sms after QUEUE_TTL days", function() {
        const message = `We haven't been able to find your court case: ${case_id}. You can go to ${process.env.COURT_PUBLIC_URL} for more information. - ${process.env.COURT_NAME}`;
        const mockCreatedDate = moment().tz(process.env.TZ).subtract(parseInt(process.env.QUEUE_TTL_DAYS, 10) + 2, 'days');

        return knex("requests").update({updated_at: mockCreatedDate})
        .then(() => sendUnmatched())
        .then(res =>  knex("requests").select("*"))
        .then(rows => {
            sinon.assert.calledOnce(messageStub)
            sinon.assert.alwaysCalledWithExactly(messageStub, number, process.env.TWILIO_PHONE_NUMBER, message )
            expect(rows.length).to.equal(0)
        });
    });
});

describe("with more than one unmatched request matched on same day requested by the same number", function() {
    let messageMock
    const numbers = ["+12223334444", "+12223334445"] ;
    const case_ids = ["ABC", "123"]
    beforeEach(function() {
        messageMock = sinon.mock(messages)

        return knex('hearings').del()
        .then(() => knex("requests").del())
        .then(() => knex("notifications").del())
        .then(() => knex('hearings').insert([turnerData()]))
        .then(() => db.addRequest({case_id: case_ids[0], phone: numbers[0], known_case: false}))
        .then(() => db.addRequest({case_id: case_ids[1], phone: numbers[0], known_case: false}))
        .then(() => db.addRequest({case_id: case_ids[1], phone: numbers[1], known_case: false}))
    });

    afterEach(function(){
        messageMock.restore()
    });

    it("Should group messages by phone number when subscribed to more than one expiring case_id", function() {
        const message1 = `We haven't been able to find your court cases: ${case_ids[0]}, ${case_ids[1]}. You can go to ${process.env.COURT_PUBLIC_URL} for more information. - ${process.env.COURT_NAME}`;
        const message2 = `We haven't been able to find your court case: ${case_ids[1]}. You can go to ${process.env.COURT_PUBLIC_URL} for more information. - ${process.env.COURT_NAME}`;
        messageMock.expects('send').resolves(true).once().withExactArgs(numbers[0], process.env.TWILIO_PHONE_NUMBER, message1)
        messageMock.expects('send').resolves(true).once().withExactArgs(numbers[1], process.env.TWILIO_PHONE_NUMBER, message2)

        const mockCreatedDate = moment().tz(process.env.TZ).subtract(parseInt(process.env.QUEUE_TTL_DAYS, 10) + 2, 'days');

        return knex("requests").update({updated_at: mockCreatedDate})
        .then(() => sendUnmatched())
        .then(res => knex("requests").select("*"))
        .then(rows => {
            messageMock.verify()
            expect(rows.length).to.equal(0)
        });
    });
});

function turnerData(v) {
    return {
        //date: '27-MAR-15',
        date: '2015-03-27T21:00:00.000Z',
        defendant: 'Frederick Turner',
        room: 'CNVCRT',
        case_id: '4928456'
    }
}
