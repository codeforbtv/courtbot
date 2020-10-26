import requests_html
import datetime
import sys
import os
import re
import csv

# TODO: Add more counties/courts (potentially add function to get all available calendar urls)
COURT_CALENDARS = [
    dict(
        name='chittenden_crim',
        url="http://www.state.vt.us/courts/court_cal/cnd_cal.htm",
    ),
]


def parse_event_block(event_block, court_name):
    event_text = event_block.full_text
    date_regex = r'(?P<day_of_week>Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+' \
                 r'(?P<month>[a-zA-Z]{3})\.\s+(?P<day>[0-9]{1,2})'
    time_regex = r'(?P<time>[0-9]{1,2}:[0-9]{2})\s+(?P<am_pm>AM|PM)'
    docket_regex = r'(?P<docket>[0-9]{2,4}-[0-9]{1,2}-[0-9]{2})\s+(?P<category>.*$)'
    location_regex = r'(?P<location>^.*?(?=\s{2}))'

    events = []
    dockets = set()

    lines = event_text.split('\n')
    location_flag = False

    day_of_week = day = month = time = am_pm = docket = category = location = ''

    for line in lines:
        if not line:
            day_of_week = day = month = time = am_pm = docket = category = location = ''
        if re.match(date_regex, line):
            group_dict = re.match(date_regex, line).groupdict()
            day_of_week = group_dict['day_of_week']
            day = group_dict['day']
            month = group_dict['month']

        if re.match(time_regex, line):
            group_dict = re.match(time_regex, line).groupdict()
            time = group_dict['time']
            am_pm = group_dict['am_pm']
            location_flag = True

        elif re.match(location_regex, line) and location_flag:
            location = re.match(location_regex, line).group('location')
            location_flag = False

        if re.search(docket_regex, line):
            group_dict = re.search(docket_regex, line).groupdict()
            docket = group_dict['docket']
            category = group_dict['category']

        if day_of_week and day and month and time and am_pm and location and category and docket:
            if docket not in dockets:
                events.append(
                    dict(
                        docket=docket,
                        category=category,
                        location=location,
                        day_of_week=day_of_week,
                        day=day,
                        month=month,
                        time=time,
                        am_pm=am_pm,
                        court_name=court_name,
                    )
                )
                dockets.add(docket)

    return events


def parse_court_calendar(calendar, court_name):
    events = []
    event_blocks = calendar.html.find('pre')
    for event_block in event_blocks:
        events = events + parse_event_block(event_block, court_name)

    return events


def main(argv):
    write_dir = argv[0]
    date = datetime.date.today().strftime("%Y-%m-%d")
    for court_cal in COURT_CALENDARS:
        session = requests_html.HTMLSession()
        court_url = court_cal['url']
        court_name = court_cal['name']
        response = session.get(court_url)
        if response.ok:
            court_events = parse_court_calendar(response, court_name)
        else:
            print("ERROR: " + response.status_code + "\n")
            continue
        if not len(court_events):
            print("No data found for " + court_name + " at " + court_url + "\n")
            continue
        else:
            keys = court_events[0].keys()
            write_file = os.path.join(write_dir, court_name + '_' + date + ".csv")
            with open(write_file, 'w') as wf:
                dict_writer = csv.DictWriter(wf, keys)
                dict_writer.writeheader()
                dict_writer.writerows(court_events)


if __name__ == "__main__":
    main(sys.argv[1:])

