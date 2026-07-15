from __future__ import annotations

import csv
import os
import runpy
import tempfile
from pathlib import Path

PROJECT = Path(r"C:\Users\yangd\projects\jeju-irang")
PLACES = PROJECT / "data" / "jeju_irang.csv"
BOOKMARKS = PROJECT / "data" / "bookmarks.csv"


def read_rows(path: Path):
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.reader(handle))


def write_without_column(source: Path, target: Path, column: str):
    rows = read_rows(source)
    index = rows[0].index(column)
    with target.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerows([row[:index] + row[index + 1:] for row in rows])


place_columns = read_rows(PLACES)[0]
bookmark_columns = read_rows(BOOKMARKS)[0]
with tempfile.TemporaryDirectory(prefix="jeju_irang_missing_") as temp_dir:
    temp = Path(temp_dir)
    for column in place_columns:
        variant = temp / f"places_without_{column}.csv"
        write_without_column(PLACES, variant, column)
        os.environ["JEJU_IRANG_PLACES_PATH"] = str(variant)
        os.environ["JEJU_IRANG_BOOKMARKS_PATH"] = str(BOOKMARKS)
        runpy.run_path(str(PROJECT / "app.py"), run_name=f"__place_without_{column}__")
    for column in bookmark_columns:
        variant = temp / f"bookmarks_without_{column}.csv"
        write_without_column(BOOKMARKS, variant, column)
        os.environ["JEJU_IRANG_PLACES_PATH"] = str(PLACES)
        os.environ["JEJU_IRANG_BOOKMARKS_PATH"] = str(variant)
        runpy.run_path(str(PROJECT / "app.py"), run_name=f"__bookmark_without_{column}__")

print(f"missing-column smoke tests passed: {len(place_columns)} places columns + {len(bookmark_columns)} bookmark columns")
