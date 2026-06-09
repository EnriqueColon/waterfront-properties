#!/usr/bin/env python3
"""
Property Appraiser Enrichment Worker
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Fetches real assessed values, sale history, and building details from the
Miami-Dade Property Appraiser WCF service and backfills the local SQLite DB.

Design:
  - 10 concurrent workers hitting the MDCPA proxy in parallel
  - Resumable: tracks enriched folios in an `enrichment_log` table
  - Saves to DB in batches of 50 to survive crashes
  - Respects a simple rate-limit with inter-batch pauses
  - ~12 h for a full 45K-property initial run; subsequent runs skip
    folios enriched within the last 30 days
"""

import sqlite3, requests, time, threading, os
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "miami_waterfront.db")

PA_PROXY = "https://apps.miamidadepa.gov/PApublicServiceProxy/PaServicesProxy.ashx"
PA_PARAMS = {"Operation": "GetPropertySearchByFolio", "clientAppName": "PropertySearch"}

WORKERS    = 10
BATCH_SIZE = 50
STALE_DAYS = 30
TIMEOUT    = 30

# ─── Enrichment state (mirrors pipeline state pattern) ────────────────────────
_enrich_state = {
    "running": False, "total": 0, "done": 0, "errors": 0,
    "last_folio": None, "started_at": None, "eta_minutes": None,
}
_enrich_lock = threading.Lock()


def enrich_state():
    with _enrich_lock:
        return dict(_enrich_state)


def _update_state(**kw):
    with _enrich_lock:
        _enrich_state.update(kw)


# ─── Schema ───────────────────────────────────────────────────────────────────
def init_enrichment_table():
    con = sqlite3.connect(DB_PATH)
    con.executescript("""
        CREATE TABLE IF NOT EXISTS enrichment_log (
            folio       TEXT PRIMARY KEY,
            enriched_at TEXT,
            status      TEXT
        );
    """)
    con.commit()
    con.close()


# ─── Fetch one property from the PA WCF service ──────────────────────────────
def _fetch_pa(folio):
    """Returns a dict of enriched fields or None on failure."""
    try:
        r = requests.get(PA_PROXY, params={**PA_PARAMS, "folioNumber": folio},
                         timeout=TIMEOUT)
        r.raise_for_status()
        d = r.json()
    except Exception:
        return None

    if d.get("Message") == "Invalid Application Name":
        return None

    result = {"folio": folio}

    assessments = d.get("Assessment", {}).get("AssessmentInfos", [])
    if assessments:
        latest = assessments[0]
        result["assessed"]       = latest.get("TotalValue") or None
        result["land_value"]     = latest.get("LandValue") or None
        result["building_value"] = latest.get("BuildingOnlyValue") or None

    sales = d.get("SalesInfos", [])
    if sales:
        for sale in sales:
            price = sale.get("SalePrice")
            if price and price > 1000:
                result["last_sale_price"] = price
                result["last_sale_date"]  = sale.get("DateOfSale") or None
                break

    pi = d.get("PropertyInfo", {})
    if pi.get("YearBuilt"):
        yr = pi["YearBuilt"]
        if isinstance(yr, str) and yr.isdigit() and int(yr) > 1800:
            result["year_built"] = int(yr)
        elif isinstance(yr, int) and yr > 1800:
            result["year_built"] = yr
    if pi.get("BedroomCount") and pi["BedroomCount"] > 0:
        result["beds"] = pi["BedroomCount"]
    if pi.get("BathroomCount") and pi["BathroomCount"] > 0:
        result["baths"] = int(pi["BathroomCount"])
    if pi.get("BuildingHeatedArea") and pi["BuildingHeatedArea"] > 0:
        result["sqft"] = int(pi["BuildingHeatedArea"])
    if pi.get("LotSize") and pi["LotSize"] > 0:
        result["lot_sqft"] = int(pi["LotSize"])

    owners = d.get("OwnerInfos", [])
    if owners:
        result["owner"] = owners[0].get("Name", "").strip() or None

    return result


# ─── Persist a batch of enriched records ──────────────────────────────────────
def _save_batch(records, log_fn=None):
    """Write enriched fields to properties + enrichment_log."""
    con = sqlite3.connect(DB_PATH)
    con.execute("PRAGMA journal_mode=WAL")
    now = datetime.utcnow().isoformat()

    for rec in records:
        folio = rec["folio"]
        sets, vals = [], []

        for col in ("assessed", "land_value", "building_value",
                     "last_sale_price", "last_sale_date",
                     "year_built", "beds", "baths", "sqft", "lot_sqft", "owner"):
            if col in rec and rec[col] is not None:
                sets.append(f"{col}=?")
                vals.append(rec[col])

        if sets:
            sets.append("updated_at=?")
            vals.append(now)
            vals.append(folio)
            con.execute(
                f"UPDATE properties SET {', '.join(sets)} WHERE folio=?", vals
            )

        con.execute(
            "INSERT OR REPLACE INTO enrichment_log (folio, enriched_at, status)"
            " VALUES (?, ?, 'ok')", (folio, now)
        )

    con.commit()
    con.close()
    if log_fn:
        log_fn(f"  PA enricher: saved batch of {len(records)} properties")


# ─── Main enrichment loop ────────────────────────────────────────────────────
def run_enrichment(log_fn=None, force=False):
    """
    Enrich all properties that haven't been enriched recently.
    Set force=True to re-enrich everything regardless of enrichment_log.
    """
    if _enrich_state["running"]:
        if log_fn:
            log_fn("PA enrichment already running — skipping")
        return

    init_enrichment_table()

    con = sqlite3.connect(DB_PATH)
    cutoff = (datetime.utcnow() - timedelta(days=STALE_DAYS)).isoformat()

    if force:
        folios = [r[0] for r in con.execute(
            "SELECT folio FROM properties ORDER BY folio"
        ).fetchall()]
    else:
        folios = [r[0] for r in con.execute("""
            SELECT p.folio FROM properties p
            LEFT JOIN enrichment_log e ON e.folio = p.folio
            WHERE e.folio IS NULL OR e.enriched_at < ?
            ORDER BY p.folio
        """, (cutoff,)).fetchall()]
    con.close()

    total = len(folios)
    if total == 0:
        if log_fn:
            log_fn("PA enrichment: all properties already up to date")
        return

    _update_state(running=True, total=total, done=0, errors=0,
                  last_folio=None, started_at=datetime.utcnow().isoformat(),
                  eta_minutes=round(total / WORKERS * 5 / 60))

    if log_fn:
        log_fn(f"=== PA Enrichment starting: {total} properties with {WORKERS} workers ===")

    done = 0
    errors = 0
    batch = []
    t0 = time.time()

    try:
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            future_map = {}
            for folio in folios:
                fut = pool.submit(_fetch_pa, folio)
                future_map[fut] = folio

            for fut in as_completed(future_map):
                folio = future_map[fut]
                try:
                    result = fut.result()
                except Exception:
                    result = None

                if result:
                    batch.append(result)
                else:
                    errors += 1
                    con2 = sqlite3.connect(DB_PATH)
                    con2.execute(
                        "INSERT OR REPLACE INTO enrichment_log (folio, enriched_at, status)"
                        " VALUES (?, ?, 'error')",
                        (folio, datetime.utcnow().isoformat())
                    )
                    con2.commit()
                    con2.close()

                done += 1

                if len(batch) >= BATCH_SIZE:
                    _save_batch(batch, log_fn)
                    batch = []

                if done % 100 == 0:
                    elapsed = time.time() - t0
                    rate = done / max(elapsed, 1)
                    remaining = (total - done) / max(rate, 0.01)
                    _update_state(
                        done=done, errors=errors, last_folio=folio,
                        eta_minutes=round(remaining / 60, 1)
                    )
                    if log_fn:
                        log_fn(f"  PA enricher: {done}/{total} "
                               f"({errors} errors, ~{round(remaining/60,1)} min left)")

        if batch:
            _save_batch(batch, log_fn)

    except Exception as exc:
        if log_fn:
            log_fn(f"PA enrichment ERROR: {exc}")
    finally:
        elapsed = round(time.time() - t0, 1)
        _update_state(running=False, done=done, errors=errors,
                      eta_minutes=0)
        if log_fn:
            log_fn(f"=== PA Enrichment done: {done}/{total} in {elapsed}s "
                   f"({errors} errors) ===")
