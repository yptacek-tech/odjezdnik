import csv
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

import build


class PragueFeedTest(unittest.TestCase):
    def test_city_boundary_modes_aliases_and_no_boarding(self):
        tables = {
            "feed_info": [dict(feed_start_date="20261114", feed_end_date="20261115")],
            "calendar": [dict(service_id="daily", start_date="20261114", end_date="20261115",
                              **{day: "1" for day in build.DAYS})],
            "calendar_dates": [dict(service_id="daily", date="20261115", exception_type="2")],
            "stops": [dict(stop_id=stop, stop_name=name, zone_region_type=region, location_type=kind)
                      for stop, name, region, kind in [
                          ("A", "Anděl", "1", "0"), ("B", "Praha hl.n.", "1", "0"),
                          ("C", "Praha hlavní nádraží", "1", "0"), ("D", "Outside", "2", "0"),
                          ("E", "Technical", "0", "0"), ("F", "Station parent", "1", "1")]],
            "routes": [dict(route_id=str(mode), route_short_name=line, route_type=str(mode))
                       for mode, line in [(0, "9"), (1, "C"), (2, "S9"), (3, "123"), (4, "P1"), (7, "LD"), (11, "59")]],
            "trips": [], "stop_times": [],
        }
        for route in tables["routes"]:
            trip = route["route_id"]
            tables["trips"].append(dict(trip_id=trip, route_id=trip, service_id="daily", trip_headsign="Destination"))
            for sequence, stop in enumerate(["A", "B", "C", "D", "E", "F", "A"], 1):
                tables["stop_times"].append(dict(trip_id=trip, stop_id=stop, stop_sequence=str(sequence),
                                               departure_time="25:10:00", pickup_type="0", stop_headsign=""))
        # No-boarding service should not appear in either the timetable or line picker.
        tables["stop_times"][0]["pickup_type"] = "1"
        memory = io.BytesIO()
        with zipfile.ZipFile(memory, "w") as archive:
            for name, records in tables.items():
                stream = io.StringIO()
                writer = csv.DictWriter(stream, fieldnames=list(records[0]))
                writer.writeheader()
                writer.writerows(records)
                archive.writestr(name + ".txt", stream.getvalue())
        with tempfile.TemporaryDirectory() as folder, zipfile.ZipFile(memory) as archive:
            root = Path(folder)
            (root / "board.html.in").write_text("var db=/*TIMETABLE*/null;", encoding="utf8")
            build.build(archive, root)
            catalog = json.loads((root / "data/catalog.json").read_text(encoding="utf8"))
            self.assertEqual(set(catalog), {"Anděl", "Hlavní nádraží"})
            main = json.loads((root / "data" / catalog["Hlavní nádraží"]["file"]).read_text(encoding="utf8"))
            self.assertEqual(len(main["rows"]), 7)  # merged aliases deduplicate rows
            self.assertEqual(main["services"]["daily"], ["20261114"])
            self.assertTrue(all(row[0] == 90600 for row in main["rows"]))
            self.assertEqual({mode for mode, line in catalog["Hlavní nádraží"]["lines"]}, {0, 1, 2, 3, 4, 7, 11})
            andel = json.loads((root / "data" / catalog["Anděl"]["file"]).read_text(encoding="utf8"))
            self.assertEqual(len(andel["rows"]), 6)  # no pickup + final stop excluded
            html = (root / "index.html").read_text(encoding="utf8")
            self.assertNotIn("/*TIMETABLE*/null", html)
            self.assertIn('"catalog":', html)


if __name__ == "__main__":
    unittest.main()
