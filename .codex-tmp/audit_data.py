from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse

import pandas as pd

project = Path(r"C:\Users\yangd\projects\jeju-irang")
places = pd.read_csv(project / "data" / "jeju_irang.csv", encoding="utf-8-sig", dtype="string")
bookmarks = pd.read_csv(project / "data" / "bookmarks.csv", encoding="utf-8-sig", dtype="string")

assert places.shape == (24, 29), places.shape
assert bookmarks.shape == (8, 4), bookmarks.shape
assert places["place_id"].notna().all() and places["place_id"].is_unique
assert bookmarks["bookmark_id"].notna().all() and bookmarks["bookmark_id"].is_unique
assert set(bookmarks["place_id"]).issubset(set(places["place_id"]))

boolean_columns = [
    "free_parking", "paid_parking", "has_admission_fee", "has_age_limit", "nursing_room",
    "stroller_rental", "resident_discount", "diaper_changing_table",
]
for column in boolean_columns:
    assert set(places[column].dropna().str.upper()).issubset({"TRUE", "FALSE"}), column

limited = places["has_age_limit"].str.upper().eq("TRUE")
assert places.loc[limited, "minimum_age"].notna().all()
for column in ["website_url", "reservation_url", "photo_url"]:
    assert places[column].dropna().map(lambda value: urlparse(value).scheme in {"http", "https"}).all()

source = (project / "app.py").read_text(encoding="utf-8")
underused = [column for column in places.columns if source.count(f'"{column}"') < 2 and source.count(f"'{column}'") < 2]
assert not underused, f"Columns without an app use beyond schema declaration: {underused}"

print("data audit: OK")
print(f"places={places.shape[0]}x{places.shape[1]} bookmarks={bookmarks.shape[0]}x{bookmarks.shape[1]}")
print("unique_ids=OK bookmark_links=OK booleans=OK urls=OK age_rules=OK all_place_columns_used=OK")
