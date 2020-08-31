/* eslint "no-console": "off" */

// Downloads the latest courtdate CSV file and
// rebuilds the database. For best results, load nightly.
const request = require('request');
const cheerio = require('cheerio');
const { Readable } = require('stream');
const csv = require('csv');
const copyFrom = require('pg-copy-streams').from;
const manager = require('./db/manager');
const {HTTPError} = require('./errors')
const CSV_DELIMITER = ',';


// TODO: ???
const csv_headers = {
    criminal_cases: ['date', 'last', 'first', 'room', 'time', 'id', 'type'],
    civil_cases: ['date', 'last', 'first', false, 'room', 'time', 'id', false, 'violation', false]
}

/**
 * Main function that performs the entire load process.
 *
 * @param  {String} dataUrls - list of data urls to load along with an optional
 *   header object key to use on each file.  Format is url|csv_type,...  The default
 *   csv_type is civil_cases. If this parameter is missing, then the
 *   environment variable DATA_URL is used instead.
 * @return {Promise} - resolves to object with file and record count: { files: 2, records: 12171 }
 */
async function loadData(dataUrls) {
    // determine what urls to load and how to extract them
    // example DATA_URL=http://courtrecords.alaska.gov/MAJIC/sandbox/acs_mo_event.csv
    // example DATA_URL=http://courtrecords.../acs_mo_event.csv|civil_cases,http://courtrecords.../acs_cr_event.csv|criminal_cases

    const files = (dataUrls || process.env.DATA_URL).split(',');

    // A single connection is needed for pg-copy-streams and the temp table
    const stream_client = await manager.acquireSingleConnection()
    stream_client.on('end', () => manager.closeConnection(stream_client))

    // Postgres temp tables only last as long as the connection
    // so we need to use one connection for the whole life of the table
    await createTempHearingsTable(stream_client)

    for (let i = 0; i < files.length; i++) {
        const [url, csv_type] = files[i].split('|');
        if (url.trim() == '') continue
        try {
            let htmlString = await getHtml(url);
            let {header, csv} = await htmlToCsv(htmlString);
            await loadCSV(stream_client, header, csv)
        } catch(err) {
            stream_client.end()
            throw(err)
        }
    }
    var count = await copyTemp(stream_client)
    stream_client.end()
    return {files: files.length, records: count}
}

function blockToTable(textBlock) {
    let dateRegex = /(?<dayOfWeek>Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+(?<month>[a-zA-Z]{3})\.\s+(?<day>[0-9]{1,2})/gm;
    let timeRegex = /(?<time>[0-9]{1,2}:[0-9]{2})\s+(?<amPm>AM|PM)/gm;
    let docketRegex = /(?<docket>[0-9]{2,4}-[0-9]{1,2}-[0-9]{2})\s+(?<category>.*$)/gm;
    let locationRegex = /(?<location>^.*?(?=\s{2,}))/gm;
    let events = [];
    let dockets = new Set();
    let lines = textBlock.split('\n');
    
    let dayOfWeek = '';
    let day = '';
    let month = '';
    let time = '';
    let amPm = '';
    let docket = '';
    let category = '';
    let location = '';

    let locationFlag = false;

    lines.forEach((line, index) => {
        if (!line) {
            dayOfWeek = day = month = time = amPm = docket = category = location = '';
        }
        if (line.match(dateRegex) !== null) {
            for (let match of line.matchAll(dateRegex)) {
                dayOfWeek = match.groups['dayOfWeek'];
                month = match.groups['month'];
                day = match.groups['day'];
            }
            console.log(dayOfWeek, month, day);
        } 
        if (line.match(timeRegex) !== null) {
            for (let match of line.matchAll(timeRegex)) {
                time = match.groups['time'];
                amPm = match.groups['amPm'];
            }
            console.log(time, amPm);
            locationFlag = true;
        } else if ((line.match(locationRegex) !== null) && locationFlag) {
            for (let match of line.matchAll(locationRegex)) {
                location = match.groups['location']
            }
            console.log('LOCATION: ' + location);
            locationFlag = false;
        }

        if (line.match(docketRegex) !== null) {
            for (let match of line.matchAll(docketRegex)) {
                docket = match.groups['docket'];
                category = match.groups['category'];
            }
            console.log(docket, category)
        }

        if (dayOfWeek && day && month && time && amPm && location && category && docket) {
            if(!dockets.has(docket)) {
                events.push({
                    docket: docket,
                    category: category,
                    location: location,
                    dayOfWeek: dayOfWeek,
                    day: day, 
                    month: month,
                    time: time,
                    amPm: amPm
                });
            }
        }
    });
    return events;
}

async function htmlToCsv(htmlString) {
    
    return new Promise(async (resolve, reject) => {
        try {
            let courtEvents = [];
            let doc = cheerio.load(htmlString);
            doc('pre').each(function(i, elem) {
                courtEvents.push(blockToTable(doc(this).text()));
            })
            courtEvents = courtEvents.flat();
            let header = Object.keys(courtEvents[0]);
            let values = courtEvents.map(o => Object.values(o).join(',')).join('\n');
            resolve({
                header: header,
                csv: values
            });
        } catch(err) {
            reject(err);
        }
        
    })
    
}   


async function getHtml(url) {
    return new Promise(async (resolve, reject) => {
        let html_string = '';
        request.get(url)
        .on('response', function (res, body) {
            if (res.statusCode !== 200) {
              this.emit('error', new HTTPError("Error loading CSV. Return HTTP Status: "+res.statusCode))
            }
        }).on('data', (chunk) => {
            html_string += chunk;
        }).on('end', () => {
            resolve(html_string);
        }).on('error', reject)
    })

}

/**
 * Transforms and loads a streamed csv file into the Postgres table .
 *
 * @param {Client} client - single pg client to use to create temp table and stream into DB
 * @param {string} url - CSV url
 * @param {string} csv_type - key for the csv_headers
 */
function loadCSV(client, header, csvString){
    /* Define transform from delivered csv to unified format suitable for DB */
    // const transformToTable = csv.transform(row => [`${row.date} ${row.time}`, `${row.first} ${row.last}`, row.room, row.id, row.type])
    const csvStream = Readable.from([csvString]);

    const transformToTable = csv.transform(row => [
        `${row.docket}`, 
        `${row.category}`, 
        `${row.dayOfWeek} ${row.month} ${row.day} ${row.time} ${row.amPm}`,
        `${row.location}`])

    /* Use the csv header array to determine which headers describe the csv.
       Default to the original citation headers */
    const parser =  csv.parse({
        delimiter: CSV_DELIMITER,
        // columns: csv_headers[csv_type === 'criminal_cases' ? 'criminal_cases' : 'civil_cases'],
        columns: header,
        trim: true
    })
    return new Promise(async (resolve, reject) => {
        /*  Since we've transformed csv into [date, defendant, room, id] form, we can just pipe it to postgres */
        // const copy_stream = client.query(copyFrom('COPY hearings_temp ("date", "defendant", "room", "case_id", "type") FROM STDIN CSV'));
        const copy_stream = client.query(copyFrom('COPY hearings_temp ("docket", "category", "date", "location") FROM STDIN CSV'));
        copy_stream.on('error', reject)
        copy_stream.on('end',  resolve)

        csvStream.on('error', reject)
        .pipe(parser)
        .on('error', reject)
        .pipe(transformToTable)
        .pipe(csv.stringify())
        .pipe(copy_stream)
    })
}

/**
 * Copy temp table to real table. Enforce unique constraints by ignoring dupes.
 * @param {*} client
 */
async function copyTemp(client){
    await manager.dropTable('hearings')
    await manager.createTable('hearings')
    let resp = await client.query(
        `INSERT INTO hearings (docket, category, date, location)
        SELECT docket, category, date, location from hearings_temp
        ON CONFLICT DO NOTHING;`
    )
    const count = resp.rowCount
    return count
}

/**
 * Temp table to pipe into. This is necessary because Postgres can't configure
 * alternate constraint handling when consuming streams. Duplicates would kill the insert.
 * @param {*} client
 */
async function createTempHearingsTable(client){
    // Need to use the client rather than pooled knex connection
    // becuase pg temp tables are tied to the life of the client.
    await client.query(
        `CREATE TEMP TABLE hearings_temp (
            docket varchar(100),
            category varchar(100),
            date varchar(100),
            location varchar(100)
        )`
    )
    return
}

module.exports = loadData;
