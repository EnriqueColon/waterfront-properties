"""
Weekly legal status scanner — Miami-Dade Clerk of Courts Official Records API.
Checks every folio in the DB for lis pendens, foreclosures, tax liens, and
other encumbrances. Designed to run every Friday via APScheduler.

Doc types flagged:
  RED    — LP (Lis Pendens), FC/CF (Foreclosure), JL (Judgment Lien)
  ORANGE — TL (Tax Lien), LN (Lien), CL (Code Lien), ML (Mechanics Lien)
  YELLOW — MT (Mortgage — informational only)

Doc types that clear a flag:
  SL (Satisfaction of Lien), RL (Release of Lien), SF (Satisfaction of FC)
"""
import sqlite3
import time
import threading
import os
import requests
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

DB_PATH      = "miami_waterfront.db"
CLERK_URL    = "https://www2.miamidadeclerk.gov/Developers/api/OfficialRecords"
WORKERS      = 8        # conservative — paid API, don't hammer it
BATCH_SIZE   = 50

# Load auth key from .env if not already in environment
_env_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(_env_path):
    for line in open(_env_path):
        k, _, v = line.strip().partition("=")
        if k and v and k not in os.environ:
            os.environ[k] = v

CLERK_AUTH_KEY = os.getenv("CLERK_AUTH_KEY", "")

# Severity mapping by document type
SEVERITY = {
    # Red — active legal action on title
    "LP": "red",   # Lis Pendens
    "FC": "red",   # Foreclosure
    "CF": "red",   # Certificate of Foreclosure
    "JL": "red",   # Judgment Lien
    # Orange — financial encumbrance
    "TL": "orange", # Tax Lien
    "LN": "orange", # Lien
    "CL": "orange", # Code Lien
    "ML": "orange", # Mechanics Lien
    "PL": "orange", # Pending Lien
    # Yellow — informational
    "MT": "yellow", # Mortgage
}

RELEASE_TYPES = {"SL", "RL", "SF", "RC", "RS"}  # satisfaction / release docs
ALERT_TYPES   = set(SEVERITY.keys())


def _fetch_folio(folio, session):
    try:
        r = session.get(CLERK_URL, params={
            "parameter1": folio,
            "parameter2": "FN",
            "authKey":    CLERK_AUTH_KEY,
        }, timeout=20)
        d = r.json()
        if d.get("Status") == "Failed":
            return folio, None, d.get("StatusDesc", "")
        return folio, d.get("OfficialRecordList", []), None
    except Exception as e:
        return folio, None, str(e)


def _upsert_alert(conn, folio, rec):
    doc_type = rec.get("DOC_TYPE", "").strip().upper()
    severity = SEVERITY.get(doc_type)
    if not severity:
        return False

    cfn_year = rec.get("CFN_YEAR") or 0
    cfn_seq  = rec.get("CFN_SEQ")  or 0
    now      = datetime.now().strftime("%Y-%m-%d")

    conn.execute("""
        INSERT INTO property_alerts
            (folio, doc_type, rec_date, doc_date, cfn_year, cfn_seq,
             first_party, second_party, book, page, severity, first_seen, last_seen)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(folio, cfn_year, cfn_seq) DO UPDATE SET
            last_seen = excluded.last_seen,
            severity  = excluded.severity
    """, (
        folio, doc_type,
        (rec.get("REC_DATE") or "")[:10],
        (rec.get("DOC_DATE") or "")[:10],
        cfn_year, cfn_seq,
        (rec.get("FIRST_PARTY")  or "")[:120],
        (rec.get("SECOND_PARTY") or "")[:120],
        rec.get("REC_BOOK"), rec.get("REC_PAGE"),
        severity, now, now,
    ))
    return True


def run_legal_scan(folios=None, log_fn=None):
    """
    Scan folios for legal encumbrances via the MDC Clerk Official Records API.
    If folios is None, scans all properties in the DB.
    log_fn(msg) is called with progress updates if provided.
    Returns (scanned, flagged, errors) counts.
    """
    if not CLERK_AUTH_KEY:
        msg = "CLERK_AUTH_KEY not set — legal scan skipped"
        if log_fn: log_fn(msg)
        else: print(msg)
        return 0, 0, 0

    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    db_lock = threading.Lock()

    if folios is None:
        rows = conn.execute(
            "SELECT folio FROM properties WHERE folio != '0000000000000'"
        ).fetchall()
        folios = [r[0] for r in rows]

    total    = len(folios)
    counters = {"scanned": 0, "flagged": 0, "errors": 0}
    t0 = time.time()

    def _log(msg):
        if log_fn: log_fn(msg)
        else: print(msg, flush=True)

    _log(f"Legal scan starting — {total:,} folios, {WORKERS} workers")

    thread_local = threading.local()

    def init_session():
        thread_local.session = requests.Session()

    def work(folio):
        folio_str, records, err = _fetch_folio(folio, thread_local.session)

        with db_lock:
            counters["scanned"] += 1

            if err:
                counters["errors"] += 1
            elif records is not None:
                newly_flagged = 0
                for rec in records:
                    if _upsert_alert(conn, folio_str, rec):
                        newly_flagged += 1
                if newly_flagged:
                    counters["flagged"] += 1

                if counters["scanned"] % BATCH_SIZE == 0:
                    conn.commit()

            done = counters["scanned"]
            if done % 500 == 0 or done == total:
                elapsed = time.time() - t0
                rate = done / elapsed if elapsed else 0
                eta  = (total - done) / rate if rate else 0
                _log(
                    f"Legal scan: {done}/{total}  flagged={counters['flagged']}  "
                    f"err={counters['errors']}  {rate:.0f}/s  ETA {eta/60:.1f}m"
                )

    with ThreadPoolExecutor(max_workers=WORKERS, initializer=init_session) as ex:
        futures = [ex.submit(work, f) for f in folios]
        for fut in as_completed(futures):
            try:
                fut.result()
            except Exception as e:
                _log(f"Worker error: {e}")

    conn.commit()
    elapsed = time.time() - t0
    _log(
        f"Legal scan complete in {elapsed/60:.1f} min — "
        f"{counters['scanned']:,} scanned, {counters['flagged']:,} with flags, "
        f"{counters['errors']:,} errors"
    )
    conn.close()
    return counters["scanned"], counters["flagged"], counters["errors"]


if __name__ == "__main__":
    run_legal_scan()
