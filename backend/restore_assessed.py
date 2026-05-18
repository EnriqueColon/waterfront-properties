#!/usr/bin/env python3
"""One-time script: restore assessed/land/building values from CSV backup."""
import sqlite3, csv, os

DB_PATH  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "miami_waterfront.db")
CSV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assessed_restore.csv")

con = sqlite3.connect(DB_PATH)
cur = con.cursor()
updated = 0

with open(CSV_PATH) as f:
    for folio, assessed, land_value, building_value in csv.reader(f):
        try:
            cur.execute(
                "UPDATE properties SET assessed=?, land_value=?, building_value=?"
                " WHERE folio=? AND (assessed IS NULL OR assessed = 0)",
                (float(assessed), float(land_value), float(building_value), folio)
            )
            updated += cur.rowcount
        except Exception:
            pass

con.commit()
con.close()
print(f"Restored assessed values for {updated} properties.")
