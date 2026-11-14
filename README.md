# Odjezdník · Prague departure board

Select any active Prague stop from PID's current timetable: metro, tram, bus, trolleybus, train, ferry or funicular where operating. Search accepts names with or without Czech accents. Platforms sharing a stop name are grouped; Praha hl.n. is grouped with Hlavní nádraží.

Choose a stop, then open **All lines** to select its route numbers or letters. **Hide all** lets you start with just the routes you use; **Show all** restores every route for the selected transport type. Filters apply before the board takes the next five departures, so hidden routes leave room for later departures you want. Transport type and hidden lines are saved separately for each stop on the current browser.

Display mode hides the controls, requests fullscreen and keeps the screen awake when supported. The stop header uses a neutral PID marker for every transport type.

## Run with live data

Run `python build.py` once, then `python server.py` with Python 3.10 or newer and visit http://localhost:8080. Set GOLEMIO_API_KEY in the server environment to enable predicted departures for any selected Prague stop. Keys are issued through https://api.golemio.cz/api-keys . The board requests updates every 30 seconds. Services without predictions show their scheduled times.

## Deploy for a phone

Deploy this directory to a Docker-capable web host and enable HTTPS. Set BOARD_PASSWORD in the hosting environment for a private household display. Sign in with username **board** and that password. Leaving the password unset makes the server accessible without login. Set GOLEMIO_API_KEY for live predictions. The container listens on PORT (default 8080) and refreshes the fallback timetable daily. Open the resulting HTTPS address on the phone. Display preferences are per device.

## Updating the standalone file

Run `python build.py` to download the current PID timetable and rebuild index.html plus `data/`. The searchable catalog uses PID's `zone_region_type=1` city boundary and excludes technical waypoints. Each stop's timetable is loaded only when selected; file names are content hashes, preventing stale browser data after updates. Keep `data/` alongside index.html when hosting or copying the board. Opening index.html directly still supports the original six embedded stops; other stops require the hosted board or local server. Local server users can set REFRESH_TIMETABLE=1 for daily refreshes. Source data: https://pid.cz/en/opendata/ . Live API: https://api.golemio.cz/pid/docs/openapi/ .

## GitHub Pages
Enable GitHub Actions under Settings → Pages. The included workflow refreshes all Prague timetables daily and publishes index.html with data/. The live workflow keeps predictions for the original six stations with the GOLEMIO_API_KEY repository secret and publishes only departure data to the live-data branch. Other stops on Pages use scheduled departures; use the Python server with a key for on-demand predictions at all stops. Runs are scheduled every five minutes and may start later. The page shows the observation time and switches to the timetable if the data is older than 15 minutes.

## Checks

Run `python -m unittest discover -s tests` and `node --test tests/board.test.cjs`. Pull requests also build the full current PID feed to verify the stop catalog and generated timetables.

