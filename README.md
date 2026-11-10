# Odjezdník · Prague departure board

Open index.html directly for the self-contained timetable edition. Select a station and transport type. Display mode requests fullscreen and keeps the screen awake when supported. Preferences are stored on that browser.

## Run with live data

Run `python server.py` with Python 3.10 or newer, then visit http://localhost:8080. Set GOLEMIO_API_KEY in the server environment to enable predicted departures. Keys are issued through https://api.golemio.cz/api-keys . The board requests updates every 30 seconds. Services without predictions show their scheduled times.

## Deploy for a phone

Deploy this directory to a Docker-capable web host and enable HTTPS. Set BOARD_PASSWORD in the hosting environment for a private household display. Sign in with username **board** and that password. Leaving the password unset makes the server accessible without login. Set GOLEMIO_API_KEY for live predictions. The container listens on PORT (default 8080) and refreshes the fallback timetable daily. Open the resulting HTTPS address on the phone. Display preferences are per device.

## Updating the standalone file

Run `python build.py` to download the current PID timetable and rebuild index.html. The bundled snapshot covers 10–23 November 2026. Local server users can set REFRESH_TIMETABLE=1 for daily refreshes. Source data: https://pid.cz/en/opendata/ . Live API: https://api.golemio.cz/pid/docs/openapi/ .

## GitHub Pages
Enable GitHub Actions under Settings → Pages. The included workflow refreshes the timetable daily. Use Connect live data on the published page to connect directly to Golemio with your own key for the current tab.
