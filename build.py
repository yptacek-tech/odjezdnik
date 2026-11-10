"""Build a self-contained departure board from PID's current GTFS archive."""
import csv
import datetime as dt
import io
import json
import re
import unicodedata
from pathlib import Path
import sys
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent
STATIONS = ["Hlavní nádraží", "Florenc", "Muzeum", "I. P. Pavlova", "Vltavská", "Vyšehrad"]
DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def station_key(name):
    plain = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    plain = re.sub(r"^praha[\s,.-]+", "", plain)
    plain = re.sub(r"[^a-z0-9]", "", plain)
    return "hlavninadrazi" if plain in {"hln", "hlnadrazi", "hlavninadr", "hlavninadrazi"} else plain


def build(archive):
    def rows(name):
        with archive.open(name + ".txt") as stream:
            yield from csv.DictReader(io.TextIOWrapper(stream, encoding="utf-8-sig"))
    info = next(rows("feed_info"))
    date = dt.datetime.strptime(info["feed_start_date"], "%Y%m%d").date()
    dates = []
    while date.strftime("%Y%m%d") <= info["feed_end_date"]:
        dates.append((date.strftime("%Y%m%d"), DAYS[date.weekday()]))
        date += dt.timedelta(days=1)
    services = {r["service_id"]: {d for d, day in dates if r["start_date"] <= d <= r["end_date"] and r[day] == "1"} for r in rows("calendar")}
    for r in rows("calendar_dates"):
        days = services.setdefault(r["service_id"], set())
        (days.add if r["exception_type"] == "1" else days.discard)(r["date"])
    stops = {r["stop_id"]: r["stop_name"] for r in rows("stops") if r["stop_name"] in STATIONS}
    for r in rows("stops"):
        if r["stop_name"] in {"Praha hlavní nádraží", "Praha hl.n."}:
            stops[r["stop_id"]] = "Hlavní nádraží"
    routes = {r["route_id"]: (r["route_short_name"], int(r["route_type"])) for r in rows("routes")}
    trips = {r["trip_id"]: (r["service_id"], *routes[r["route_id"]], r["trip_headsign"]) for r in rows("trips")}
    board = {name: [] for name in STATIONS}
    last_sequence = {}
    for r in rows("stop_times"):
        trip = r["trip_id"]
        last_sequence[trip] = max(last_sequence.get(trip, -1), int(r["stop_sequence"]))
    for r in rows("stop_times"):
        station = stops.get(r["stop_id"])
        if station and r["pickup_type"] != "1" and r["departure_time"]:
            h, m, s = map(int, r["departure_time"].split(":"))
            service, line, mode, head = trips[r["trip_id"]]
            if int(r["stop_sequence"]) == last_sequence[r["trip_id"]] or station_key(r["stop_headsign"] or head) == station_key(station):
                continue
            board[station].append([h*3600 + m*60 + s, service, line, mode, r["stop_headsign"] or head])
    data = dict(stations=board, services={k: sorted(v) for k,v in services.items()}, end=info["feed_end_date"])
    html = (ROOT / "board.html.in").read_text(encoding="utf8")
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("<", r"\u003c")
    target = ROOT / "index.html"
    temporary = target.with_suffix(".new")
    temporary.write_text(html.replace("/*TIMETABLE*/null", payload), encoding="utf8")
    temporary.replace(target)


if __name__ == "__main__":
    if len(sys.argv) > 1:
        with zipfile.ZipFile(sys.argv[1]) as archive:
            build(archive)
    else:
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "pid.zip"
            urllib.request.urlretrieve("https://data.pid.cz/PID_GTFS.zip", source)
            with zipfile.ZipFile(source) as archive:
                build(archive)
