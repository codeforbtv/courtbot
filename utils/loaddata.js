/* eslint "no-console": "off" */

// Downloads the latest courtdate CSV file and
// rebuilds the database. For best results, load nightly.

require('dotenv').config();
const request = require('request');
const csv = require('csv');
const copyFrom = require('pg-copy-streams').from;
const CombinedStream = require('combined-stream')
const manager = require('./db/manager');

const CSV_DELIMITER = ',';

const csv_headers = {
    crimal_cases: ['date', 'last', 'first', 'room', 'time', 'id', 'type'],
    civil_cases: ['date', 'last', 'first', false, 'room', 'time', 'id', false, 'violation', false]
}

/**
 * Main function that performs the entire load process.
 *
 * @param  {String} dataUrls - list of data urls to load along with an optional
 *   header object key to use on each file.  Format is url|csv_type,...  The default
 *   csv_type is civil_cases. If this parameter is missing, then the
 *   environment variable DATA_URL is used instead.
 * @return {Promise} - true
 */

function loadData(dataUrls) {
    // determine what urls to load and how to extract them
    // example DATA_URL=http://courtrecords.alaska.gov/MAJIC/sandbox/acs_mo_event.csv
    // example DATA_URL=http://courtrecords.../acs_mo_event.csv|civil_cases,http://courtrecords.../acs_cr_event.csv|criminal_cases

    //const files = (dataUrls || process.env.DATA_URL).split(',');
    const files = ['http://www.photo-mark.com'] // force a parse error

    // Combine streams into one
    const combinedStream = CombinedStream.create();

    // Define transform from delivered csv to unified format suitable for DB
    const transformToTable = csv.transform(row => [`${row.date} ${row.time}`, `${row.first} ${row.last}`, row.room, row.id])

    return new Promise(async (resolve, reject) => {
        files.forEach((item) => {
            const [url, csv_type] = item.split('|');
            if (url.trim() == '') return

            const file_stream = request.get(url)
            .on('error', reject)

            // use the csv header array to determine which headers describe the csv
            // default to the original citation headers
            const parser =  csv.parse({
                delimiter: CSV_DELIMITER,
                columns: csv_headers[csv_type === 'criminal_cases' ? 'criminal_cases' : 'civil_cases'],
                trim: true
            })
            const parsed_stream = file_stream
            .pipe(parser)
            .on('error', reject)
            .pipe(transformToTable)
            .pipe(csv.stringify())

            combinedStream.append(parsed_stream);
        });

        // A 'real' pg connection is needed for pg-copy-streams
        const stream_client = await manager.acquireSingleConnection()

        // Postgres temp tables only last as long as the connection
        // so we need to use one connection for the whole life of the table
        // Happily we just made one above.
        await createTempCasesTable(stream_client)

        // since we've transformed csv into [date, defendant, room, id] form, we can just pipe it to postgres
        const copy_stream = stream_client.query(copyFrom('COPY cases_temp ("date", "defendant", "room", "id") FROM STDIN CSV'));
        copy_stream.on('error', reject)
        copy_stream.on('end', async () => {
            // when csv has been consumed by db, copy temp table to real table
            try {
                await copyTemp(stream_client)
            } catch(err) {
                reject(err)
            }
            resolve(true)
        });
        combinedStream.pipe(copy_stream)
    })
}

async function copyTemp(client){
    await manager.dropTable('cases')
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

module.exports = loadData;
