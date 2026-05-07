"""
Backfill missing addresses + last sale price/date for all properties.
- Address: filled from SiteAddress where currently blank
- Sale: most recent qualified (QualifiedFlag='Q') arm's-length sale,
  falling back to most recent any-type sale if no qualified record exists.
"""
import sqlite3
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
import requests

DB_PATH  = "miami_waterfront.db"
PA_URL   = "https://apps.miamidadepa.gov/PApublicServiceProxy/PaServicesProxy.ashx"
WORKERS  = 20
HEADERS  = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Referer":    "https://apps.miamidadepa.gov/propertysearch/",
    "Accept":     "application/json",
}

db_lock      = threading.Lock()
counters     = {"done": 0, "addr_fixed": 0, "sale_found": 0, "no_sale": 0, "error": 0}
batch_buffer = []
BATCH_SIZE   = 100


def parse_sale_date(s):
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except Exception:
            pass
    return None


def best_sale(sales):
    if not sales:
        return None, None
    qualified = [s for s in sales if s.get("QualifiedFlag") == "Q" and s.get("SalePrice", 0) > 1000]
    pool = qualified if qualified else [s for s in sales if s.get("SalePrice", 0) > 1000]
    if not pool:
        return None, None
    pool.sort(key=lambda s: parse_sale_date(s.get("DateOfSale", "")) or datetime.min, reverse=True)
    top = pool[0]
    return top.get("SalePrice"), top.get("DateOfSale")


def fetch_one(folio, current_address, session):
    try:
        r = session.get(PA_URL, params={
            "Operation":     "GetPropertySearchByFolio",
            "FolioNumber":   folio,
            "clientAppName": "PropertySearch",
        }, headers=HEADERS, timeout=15)
        d = r.json()

        # Address
        new_addr = None
        if not current_address:
            sites = d.get("SiteAddress", [])
            if sites and sites[0].get("Address"):
                raw = sites[0]["Address"]
                # Strip zip suffix "City, ST XXXXX-0000" → keep just "123 MAIN ST"
                new_addr = raw.split(",")[0].strip()

        # Sale
        sale_price, sale_date = best_sale(d.get("SalesInfos", []))

        return new_addr, sale_price, sale_date
    except Exception as e:
        return e, None, None


def flush_batch(conn):
    if not batch_buffer:
        return
    conn.executemany(
        """UPDATE properties
           SET address = CASE WHEN ? IS NOT NULL THEN ? ELSE address END,
               last_sale_price = ?,
               last_sale_date  = ?
           WHERE folio = ?""",
        batch_buffer,
    )
    conn.commit()
    batch_buffer.clear()


def main():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    rows = conn.execute(
        "SELECT folio, address FROM properties WHERE folio != '0000000000000'"
    ).fetchall()
    total = len(rows)
    print(f"Processing {total:,} properties ({WORKERS} workers) …", flush=True)
    t0 = time.time()

    thread_local = threading.local()

    def init_session():
        thread_local.session = requests.Session()

    def work(row):
        folio, current_address = row
        result = fetch_one(folio, current_address or "", thread_local.session)
        new_addr, sale_price, sale_date = result

        with db_lock:
            counters["done"] += 1
            if isinstance(new_addr, Exception):
                counters["error"] += 1
                new_addr = None
            else:
                if new_addr:
                    counters["addr_fixed"] += 1
                if sale_price:
                    counters["sale_found"] += 1
                else:
                    counters["no_sale"] += 1

            batch_buffer.append((new_addr, new_addr, sale_price, sale_date, folio))
            if len(batch_buffer) >= BATCH_SIZE:
                flush_batch(conn)

            done = counters["done"]
            if done % 500 == 0 or done == total:
                elapsed = time.time() - t0
                rate = done / elapsed if elapsed else 0
                eta  = (total - done) / rate if rate else 0
                print(
                    f"\r  {done:>6}/{total}  addr+={counters['addr_fixed']}  "
                    f"sales={counters['sale_found']}  no_sale={counters['no_sale']}  "
                    f"err={counters['error']}  {rate:.0f}/s  ETA {eta/60:.1f}m",
                    end="", flush=True,
                )

    with ThreadPoolExecutor(max_workers=WORKERS, initializer=init_session) as ex:
        futures = [ex.submit(work, row) for row in rows]
        for fut in as_completed(futures):
            try:
                fut.result()
            except Exception as e:
                print(f"\nWorker exception: {e}", flush=True)

    with db_lock:
        flush_batch(conn)

    elapsed = time.time() - t0
    print(f"\n\nDone in {elapsed/60:.1f} min — "
          f"{counters['addr_fixed']:,} addresses fixed, "
          f"{counters['sale_found']:,} sales loaded, "
          f"{counters['error']:,} errors", flush=True)
    conn.close()


if __name__ == "__main__":
    main()
