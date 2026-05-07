"""
Backfill assessed property values from MDCPA public API.
Fetches AssessedValue, LandValue, BuildingOnlyValue for all properties
where assessed IS NULL, using 20 concurrent threads.
"""
import sqlite3
import time
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests

DB_PATH   = "miami_waterfront.db"
PA_URL    = "https://apps.miamidadepa.gov/PApublicServiceProxy/PaServicesProxy.ashx"
WORKERS   = 20
HEADERS   = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Referer":    "https://apps.miamidadepa.gov/propertysearch/",
    "Accept":     "application/json",
}

print_lock   = threading.Lock()
db_lock      = threading.Lock()
counters     = {"done": 0, "success": 0, "no_data": 0, "error": 0}
batch_buffer = []   # (assessed, land, building, folio) tuples
BATCH_SIZE   = 100


def flush_batch(conn):
    if not batch_buffer:
        return
    conn.executemany(
        "UPDATE properties SET assessed=?, land_value=?, building_value=? WHERE folio=?",
        batch_buffer,
    )
    conn.commit()
    batch_buffer.clear()


def fetch_one(folio, session):
    try:
        r = session.get(PA_URL, params={
            "Operation":     "GetPropertySearchByFolio",
            "FolioNumber":   folio,
            "clientAppName": "PropertySearch",
        }, headers=HEADERS, timeout=15)
        d = r.json()
        infos = d.get("Assessment", {}).get("AssessmentInfos", [])
        if infos:
            ai = infos[0]
            return (ai.get("AssessedValue"), ai.get("LandValue"), ai.get("BuildingOnlyValue"))
        return None
    except Exception as e:
        return e


def main():
    # check_same_thread=False required for multi-threaded writes
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    rows = conn.execute(
        "SELECT folio FROM properties WHERE assessed IS NULL AND folio != '0000000000000'"
    ).fetchall()
    folios = [r[0] for r in rows]
    total  = len(folios)

    if total == 0:
        print("Nothing to backfill — all properties already have assessed values.")
        conn.close()
        return

    print(f"Backfilling {total:,} properties with {WORKERS} workers …", flush=True)
    t0 = time.time()

    def work(folio):
        session = thread_local.session
        result  = fetch_one(folio, session)
        with db_lock:
            counters["done"] += 1
            if isinstance(result, Exception):
                counters["error"] += 1
            elif result is None:
                counters["no_data"] += 1
            else:
                assessed, land, bldg = result
                counters["success"] += 1
                batch_buffer.append((assessed, land, bldg, folio))
                if len(batch_buffer) >= BATCH_SIZE:
                    flush_batch(conn)

            done = counters["done"]
            if done % 500 == 0 or done == total:
                elapsed = time.time() - t0
                rate    = done / elapsed if elapsed else 0
                eta     = (total - done) / rate if rate else 0
                print(
                    f"\r  {done:>6}/{total}  ok={counters['success']}  "
                    f"skip={counters['no_data']}  err={counters['error']}  "
                    f"{rate:.1f}/s  ETA {eta/60:.1f}m",
                    end="", flush=True,
                )
        return folio

    thread_local = threading.local()

    def init_session():
        thread_local.session = requests.Session()

    with ThreadPoolExecutor(max_workers=WORKERS, initializer=init_session) as ex:
        futures = {ex.submit(work, f): f for f in folios}
        for fut in as_completed(futures):
            try:
                fut.result()
            except Exception as e:
                print(f"\nWorker exception: {e}", flush=True)

    with db_lock:
        flush_batch(conn)

    elapsed = time.time() - t0
    print(f"\n\nDone in {elapsed/60:.1f} min — "
          f"{counters['success']:,} updated, "
          f"{counters['no_data']:,} no data, "
          f"{counters['error']:,} errors", flush=True)
    conn.close()


if __name__ == "__main__":
    main()
