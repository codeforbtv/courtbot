/* eslint "no-console": "off" */

// Downloads the latest courtdate CSV file and
// rebuilds the database. For best results, load nightly.

require('dotenv').config();
const request = require('request');
const csv = require('csv');
//const { Client } = require('pg');
const copyFrom = require('pg-copy-streams').from;
const CombinedStream = require('combined-stream')
const manager = require('./db/manager');

const CSV_DELIMITER = ',';

/*
const client = new Client({
    connectionString:process.env.DATABASE_URL
})
*/

const csv_headers = {
    crimal_cases: ['date', 'last', 'first', 'room', 'time', 'id', 'type'],
    civil_cases: ['date', 'last', 'first', false, 'room', 'time', 'id', false, 'violation', false]
}


/**
 * Main function that performs the entire load process.
 *
 * @param  {String} dataUrls - list of data urls to load along with an optional
 *   extractor to use on each file.  Format is url|extractor,...  The default
 *   extractor is extractCourtData.  If this parameter is missing, then the
 *   environment variable DATA_URL is used instead.
 * @return {Promise} - true
 */

async function loadData(dataUrls) {
    /*
    try {
        await client.connect()
    } catch(err) {
        console.error('connection error', err.stack)
        process.exit(1)
    }
    await client.query(`SET TIME ZONE '${process.env.TZ}'`)
    await createTempCasesTable()
    */
    // determine what urls to load and how to extract them
    // example DATA_URL=http://courtrecords.alaska.gov/MAJIC/sandbox/acs_mo_event.csv
    // example DATA_URL=http://courtrecords.../acs_mo_event.csv|civil_cases,http://courtrecords.../acs_cr_event.csv|criminal_cases

    const files = (dataUrls || process.env.DATA_URL).split(',');

    // queue each file and extraction as a promise
    const queud_streams = [];
    files.forEach((item) => {
        const [url, csv_type] = item.split('|');
        if (url.trim() == '') return

        const file_stream = request.get(url)
        .on('error', handleError)

        // use the specified extractor name to determine which extraction method to use
        // default to the original extraction method

        queud_streams.push(csvStream(file_stream, csv_headers[csv_type === 'criminal_cases' ? 'criminal_cases' : 'civil_cases']));
    });

    return persistCSV(queud_streams)
}

function csvStream(read_stream, columns){
    const parser =  csv.parse({
        delimiter: CSV_DELIMITER,
        columns: columns,
        trim: true
    })
    // Convert input csv to desired format
    const transformToTable = csv.transform(row => [`${row.date} ${row.time}`, `${row.first} ${row.last}`, row.room, row.id])
    const stringifier = csv.stringify()

    // Parse and transform, retuning a stream of transformed csv
    const parsed_stream = read_stream
    .pipe(parser)
    .on('error', handleError)
    .pipe(transformToTable)
    .pipe(stringifier)

    return parsed_stream
}

/* expects an array of readable streams */
function persistCSV(csv_streams){
    // combine streams into single stream
    return new Promise(async (resolve, reject) => {
        const client = await manager.acquireSingleConnection()
        await createTempCasesTable(client)

        const combinedStream = CombinedStream.create();
        csv_streams.forEach(stream => combinedStream.append(stream))

        const copy_stream = client.query(copyFrom('COPY cases_temp ("date", "defendant", "room", "id") FROM STDIN CSV'));
        copy_stream.on('error', handleError);
        copy_stream.on('end', async () => {
            // when csv has been consumed by db, copy temp table to real table
            // maybe this should be in a transaction

            try {
                await copyTemp(client)
            } catch(err) {
                manager.returnConnection(client)
                reject(err)
            }
            resolve(true)
        });

        // Save combinded string to table
        combinedStream
        .pipe(copy_stream)
    })
}

async function copyTemp(client){
    await client.query('DROP TABLE IF EXISTS cases;')
    await manager.createTable('cases')
    await client.query(`
        INSERT INTO cases (date, defendant, room, id)
        SELECT date, defendant, room, id from cases_temp
        ON CONFLICT DO NOTHING;
    `)
    console.log("table created")
    return
}

async function createTempCasesTable(client){
    await client.query(`
        CREATE TEMP TABLE cases_temp (
            date timestamptz,
            defendant varchar(100),
            room varchar(100),
            id varchar(100)
        )
    `)
    return
}

function handleError(err) {
    console.log("Error loading cases: ", err)
    client.end(err => {
        process.exit(1)
    })
}
// Do the thing!

module.exports = loadData;
