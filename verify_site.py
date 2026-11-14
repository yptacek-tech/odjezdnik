"""Check every packaged stop file and sample the actual published website."""
import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from urllib.request import Request, urlopen

STOP_FILE = re.compile(r"[0-9a-f]{64}\.json")
SAMPLE_STOPS = ["Dopravní hřiště Vypich", "Albertov", "Anděl", "Dejvická",
                "Palmovka", "Zličín", "Hlavní nádraží"]


def embedded_database(html):
    match = re.search(r"var db=(.*?);\s*\nvar types=", html, re.S)
    if not match:
        raise ValueError("Published board has no timetable database")
    return json.loads(match.group(1))


def check_payload(payload, name):
    if not isinstance(payload.get("rows"), list) or not isinstance(payload.get("services"), dict):
        raise ValueError(f"Invalid stop payload: {name}")
    for row in payload["rows"]:
        if len(row) != 5 or row[1] not in payload["services"]:
            raise ValueError(f"Missing timetable service for {name}")
    if not payload.get("end"):
        raise ValueError(f"Missing timetable validity for {name}")


def verify_package(root):
    html = (root / "index.html").read_text(encoding="utf8")
    db = embedded_database(html)
    catalog = json.loads((root / "data/catalog.json").read_text(encoding="utf8"))
    if db["catalog"] != catalog:
        raise ValueError("Page and catalog reference different timetable files")
    if len(catalog) < 500:
        raise ValueError(f"Prague catalog is incomplete: {len(catalog)} stops")
    for name in SAMPLE_STOPS:
        if name not in catalog:
            raise ValueError(f"Missing stop: {name}")
    seen = set()
    for name, stop in catalog.items():
        filename = stop["file"]
        if not STOP_FILE.fullmatch(filename):
            raise ValueError(f"Invalid timetable filename: {filename}")
        if filename in seen:
            continue
        raw = (root / "data" / filename).read_bytes()
        if hashlib.sha256(raw).hexdigest() + ".json" != filename:
            raise ValueError(f"Wrong timetable contents for {name}")
        check_payload(json.loads(raw), name)
        seen.add(filename)
    modes = {mode for stop in catalog.values() for mode, line in stop["lines"]}
    if not {0, 1, 2, 3, 11} <= modes:
        raise ValueError(f"Missing transport types: {modes}")
    print(f"Verified all {len(catalog)} packaged stops ({len(seen)} timetable files)")
    return html, catalog


def fetch(url):
    req = Request(url, headers={"User-Agent": "Odjezdnik-deployment-check"})
    with urlopen(req, timeout=30) as response:
        return response.read().decode("utf8")


def verify_live(url, expected_html, catalog):
    url = url.rstrip("/") + "/"
    # A fresh HTML request also catches a deployment still serving an older page.
    for attempt in range(4):
        try:
            html = fetch(url + "?verify=" + str(time.time_ns()))
            if html != expected_html:
                raise ValueError("Published page does not match this deployment yet")
            break
        except (OSError, ValueError):
            if attempt == 3:
                raise
            time.sleep(5)
    names = list(SAMPLE_STOPS)
    # Include at least one stop for every available mode, including trolleybus.
    for mode in {mode for item in catalog.values() for mode, line in item["lines"]}:
        name = next(name for name, item in catalog.items() if any(line[0] == mode for line in item["lines"]))
        if name not in names:
            names.append(name)
    for name in names:
        filename = catalog[name]["file"]
        payload = json.loads(fetch(url + "data/" + filename + "?verify=" + str(time.time_ns())))
        check_payload(payload, name)
        print(f"Live stop OK: {name} ({len(payload['rows'])} departures)")
    print(f"Verified published board and {len(names)} live stop downloads")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("--url")
    args = parser.parse_args()
    html, catalog = verify_package(args.directory)
    if args.url:
        verify_live(args.url, html, catalog)
