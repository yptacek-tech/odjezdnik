"""Serve the Prague board and optionally proxy Golemio predictions. Python 3.10+."""
import base64
import gzip
import hmac
import json
import os
import subprocess
import sys
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, urlopen

from build import STATIONS, station_key

ROOT = Path(__file__).resolve().parent
PASSWORD = os.getenv("BOARD_PASSWORD")
TOKEN = os.getenv("GOLEMIO_API_KEY")


def timestamp(value):
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()*1000)


def departures(station):
    query = urlencode({"names[]": station, "includeMetroTrains": "true", "limit": 1000,
                       "minutesAfter": 180, "minutesBefore": 0, "mode": "departures"})
    req = Request("https://api.golemio.cz/v2/pid/departureboards?" + query,
                  headers={"X-Access-Token": TOKEN, "Accept": "application/json"})
    with urlopen(req, timeout=9) as response:
        data = json.load(response)
    rows = []
    for item in data["departures"]:
        trip = item["trip"]
        last_stop = (item.get("last_stop") or {}).get("name")
        destination = trip.get("headsign") or last_stop or "—"
        if trip.get("is_canceled") or station_key(station) in (station_key(destination), station_key(last_stop)):
            continue
        times = item["departure_timestamp"]
        delay = item.get("delay") or {}
        predicted = bool(times.get("predicted") and delay.get("is_available"))
        at = times.get("predicted") if predicted else times.get("scheduled")
        if at:
            rows.append(dict(at=timestamp(at), predicted=predicted, delay=delay.get("minutes") if predicted else None,
                             type=item["route"]["type"], line=item["route"]["short_name"],
                             dest=trip.get("headsign") or (item.get("last_stop") or {}).get("name") or "â€”"))
    return sorted(rows, key=lambda r: r["at"])


class Board(BaseHTTPRequestHandler):
    def reply(self, code, mime, body, **headers):
        if mime.startswith("text/html") and "gzip" in self.headers.get("Accept-Encoding", ""):
            body = gzip.compress(body, compresslevel=4)
            headers["Content-Encoding"] = "gzip"
            headers["Vary"] = "Accept-Encoding"
        self.send_response(code)
        self.send_header("Content-Type", mime)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        for name, value in headers.items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if PASSWORD:
            expected = b"Basic " + base64.b64encode(("board:" + PASSWORD).encode())
            supplied = self.headers.get("Authorization", "").encode()
            if not hmac.compare_digest(supplied, expected):
                self.reply(401, "text/plain", b"Sign in to your departure board.",
                           **{"WWW-Authenticate": 'Basic realm="Departure board", charset="UTF-8"'})
                return
        target = urlsplit(self.path)
        if target.path in ("/", "/index.html"):
            self.reply(200, "text/html; charset=utf-8", (ROOT / "index.html").read_bytes())
        elif target.path == "/api/departures":
            station = parse_qs(target.query).get("station", [""])[0]
            if station not in STATIONS:
                self.reply(400, "application/json", b'{"error":"Unknown station"}')
                return
            if not TOKEN:
                self.reply(200, "application/json", b'{"rows":null}')
                return
            try:
                payload = json.dumps({"rows": departures(station)}).encode()
            except (OSError, ValueError, KeyError, TypeError):
                self.reply(503, "application/json", b'{"error":"Live feed unavailable"}')
                return
            self.reply(200, "application/json", payload)
        else:
            self.reply(404, "text/plain", b"Page not found")


def refresh_daily():
    while True:
        result = subprocess.run([sys.executable, str(ROOT / "build.py")], timeout=None)
        time.sleep(86400 if result.returncode == 0 else 1800)


if __name__ == "__main__":
    if os.getenv("REFRESH_TIMETABLE") == "1":
        threading.Thread(target=refresh_daily, daemon=True).start()
    ThreadingHTTPServer((os.getenv("HOST", "127.0.0.1"), int(os.getenv("PORT", "8080"))), Board).serve_forever()

