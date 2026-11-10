"""Publish only departure data, with the time each station was observed."""
import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from server import STATIONS, departures


def snapshot(station):
    return station, {"observed": int(time.time() * 1000), "rows": departures(station)}


with ThreadPoolExecutor(max_workers=3) as pool:
    stations = dict(pool.map(snapshot, STATIONS))
Path("departures.json").write_text(json.dumps(stations, ensure_ascii=False, separators=(",", ":")), encoding="utf8")
