"""
Syncs foreclosure complaints from Google Sheets into the local SQLite DB.
Matches complaints to properties by address using fuzzy matching.

Sheet: https://docs.google.com/spreadsheets/d/1cx-5MHBBWy1a7XGJTOhkQyAj5eMA_v0Qbkr-7xBJPXw
Tab:   Complaints (gid=834595524)

Run manually:  python complaint_syncer.py
Scheduled:     called from ingestor.py every Friday (same slot as legal scan)
"""
import sqlite3
import os
import re
import unicodedata
from difflib import SequenceMatcher
from datetime import datetime

DB_PATH   = os.path.join(os.path.dirname(__file__), "miami_waterfront.db")
SHEET_ID  = "1cx-5MHBBWy1a7XGJTOhkQyAj5eMA_v0Qbkr-7xBJPXw"
KEY_FILE  = os.path.join(os.path.dirname(__file__), "service_account.json")

# All case-insensitive variants that mean Miami-Dade
MIAMI_DADE_TOKENS = {"miami", "dade", "miami-dade"}

COLS = [
    "document_title", "county", "date_filed", "plaintiff",
    "plaintiff_attorney", "plaintiff_attorney_email", "plaintiff_attorney_phone",
    "plaintiff_attorney_firm", "defendant", "property_address", "property_legal",
    "loan_amount", "loan_date", "loan_rate", "maturity_date", "guarantor",
    "default_reason", "default_date", "unpaid_balance", "sum_unpaid_balance",
    "default_rate", "right_to_reinstate", "fannie_freddie", "sba",
    "pdf_link", "meets_criteria",
]


def _is_miami_dade(county: str) -> bool:
    low = county.lower()
    return any(t in low for t in MIAMI_DADE_TOKENS)


def _normalize_address(raw: str) -> str:
    """Uppercase, remove punctuation except numbers, collapse spaces."""
    s = raw.split(",")[0].strip()          # drop city/state/zip
    s = unicodedata.normalize("NFKD", s)
    s = s.upper()
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    # common street-type abbreviations
    abbrevs = {
        r"\bDRIVE\b": "DR", r"\bSTREET\b": "ST", r"\bAVENUE\b": "AVE",
        r"\bBOULEVARD\b": "BLVD", r"\bROAD\b": "RD", r"\bLANE\b": "LN",
        r"\bCOURT\b": "CT", r"\bCIRCLE\b": "CIR", r"\bTERRACE\b": "TER",
        r"\bPLACE\b": "PL", r"\bWAY\b": "WAY", r"\bNORTH\b": "N",
        r"\bSOUTH\b": "S", r"\bEAST\b": "E", r"\bWEST\b": "W",
    }
    for pat, rep in abbrevs.items():
        s = re.sub(pat, rep, s)
    return re.sub(r"\s+", " ", s).strip()


def _score(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


_OWNER_NOISE = re.compile(
    r"\b(LLC|INC|CORP|LTD|TRUST|TRUSTEE|ET\s+AL|AND|THE|OF|A|AN|"
    r"ALL\s+TENANTS|UNKNOWN\s+PARTIES|IN\s+POSSESSION|ACTING\s+THROUGH|"
    r"FLORIDA|COUNTY|PARTNERSHIP|ASSOCIATION|ASSN|CO)\b",
    re.IGNORECASE
)

def _normalize_owner(raw: str) -> str:
    """Strip legal noise, punctuation, and collapse spaces for owner comparison."""
    s = unicodedata.normalize("NFKD", raw).upper()
    s = _OWNER_NOISE.sub(" ", s)
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _owner_score(defendant: str, db_owner: str) -> float:
    """Score how well the sheet defendant matches the DB owner field."""
    if not defendant or not db_owner:
        return 0.0
    nd = _normalize_owner(defendant)
    no = _normalize_owner(db_owner)
    if not nd or not no:
        return 0.0
    # Check if any significant word from DB owner appears in defendant
    owner_words = [w for w in no.split() if len(w) >= 4]
    if not owner_words:
        return 0.0
    hits = sum(1 for w in owner_words if w in nd)
    word_score = hits / len(owner_words)
    # Also do a full fuzzy score on the shortest segment
    fuzzy = _score(no[:60], nd[:60])
    return max(word_score, fuzzy)


def build_db_index(db_rows: list[tuple]) -> list[tuple]:
    """Pre-normalize DB addresses once. Returns list of (folio, norm_addr, owner, tokens)."""
    index = []
    for folio, addr, owner in db_rows:
        if not addr:
            continue
        norm = _normalize_address(addr)
        tokens = norm.split()
        index.append((folio, norm, owner or "", tokens))
    return index


def _nums(tokens: list[str]) -> list[str]:
    """All numeric tokens in an address token list."""
    return [t for t in tokens if re.match(r"^\d+", t)]


def _match_folio(norm_sheet: str, db_index: list[tuple], defendant: str = "") -> tuple[str | None, float]:
    """
    Return (folio, score) for best DB property match.
    Rules:
      1. House number must match exactly (fast reject).
      2. All numeric tokens (street ordinals) must match — prevents "129 ST" ↔ "79 ST".
      3. Directional prefix must match if present in both.
      4. Address fuzzy score >= 0.88, OR >= 0.78 + owner confirmation.
    db_index: pre-built from build_db_index()
    """
    tokens_sheet = norm_sheet.split()
    number    = tokens_sheet[0] if tokens_sheet and tokens_sheet[0].isdigit() else None
    direction = tokens_sheet[1] if len(tokens_sheet) > 1 and re.match(r"^(N|S|E|W|NE|NW|SE|SW)$", tokens_sheet[1]) else None
    nums_sheet = _nums(tokens_sheet)

    best_folio, best_score = None, 0.0
    for folio, norm_db, owner, tokens_db in db_index:
        # Rule 1: house number exact match
        if number and (not tokens_db or tokens_db[0] != number):
            continue
        # Rule 2: all numeric tokens must match (catches "129 ST" vs "79 ST")
        nums_db = _nums(tokens_db)
        if nums_sheet != nums_db:
            continue
        # Rule 3: directional prefix
        if direction and len(tokens_db) > 1 and re.match(r"^(N|S|E|W|NE|NW|SE|SW)$", tokens_db[1]):
            if tokens_db[1] != direction:
                continue

        addr_s = _score(norm_sheet, norm_db)

        if addr_s >= 0.88:
            combined = addr_s
        elif addr_s >= 0.78:
            own_s = _owner_score(defendant, owner)
            if own_s < 0.50:
                continue
            combined = (addr_s * 0.6) + (own_s * 0.4)
        else:
            continue

        if combined > best_score:
            best_score = combined
            best_folio = folio

    if best_score >= 0.80:
        return best_folio, round(best_score, 3)
    return None, 0.0


def _ensure_table(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS complaints (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            folio                 TEXT,
            match_score           REAL,
            document_title        TEXT,
            county                TEXT,
            date_filed            TEXT,
            plaintiff             TEXT,
            plaintiff_attorney    TEXT,
            plaintiff_attorney_email TEXT,
            plaintiff_attorney_phone TEXT,
            plaintiff_attorney_firm  TEXT,
            defendant             TEXT,
            property_address      TEXT,
            property_legal        TEXT,
            loan_amount           TEXT,
            loan_date             TEXT,
            loan_rate             TEXT,
            maturity_date         TEXT,
            guarantor             TEXT,
            default_reason        TEXT,
            default_date          TEXT,
            unpaid_balance        TEXT,
            sum_unpaid_balance    TEXT,
            default_rate          TEXT,
            right_to_reinstate    TEXT,
            fannie_freddie        TEXT,
            sba                   TEXT,
            pdf_link              TEXT,
            meets_criteria        TEXT,
            synced_at             TEXT,
            UNIQUE(date_filed, plaintiff, property_address)
        )
    """)
    conn.commit()


def run_complaint_sync(log_fn=None):
    """Pull Complaints sheet → match → upsert into SQLite. Returns (synced, matched, skipped)."""

    def _log(msg):
        if log_fn:
            log_fn(msg)
        else:
            print(msg, flush=True)

    if not os.path.exists(KEY_FILE):
        _log(f"Service account key not found at {KEY_FILE} — complaint sync skipped")
        return 0, 0, 0

    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
    except ImportError:
        _log("google-api-python-client not installed — run: pip install google-auth google-api-python-client")
        return 0, 0, 0

    _log("Complaint sync: authenticating with Google Sheets...")
    creds = service_account.Credentials.from_service_account_file(
        KEY_FILE, scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"]
    )
    service = build("sheets", "v4", credentials=creds)

    _log("Complaint sync: fetching sheet data...")
    result = service.spreadsheets().values().get(
        spreadsheetId=SHEET_ID, range="Complaints!A1:Z"
    ).execute()
    rows = result.get("values", [])
    if not rows:
        _log("Complaint sync: sheet is empty")
        return 0, 0, 0

    data_rows = rows[1:]
    _log(f"Complaint sync: {len(data_rows)} rows fetched")

    # Filter Miami-Dade
    miami_rows = [r for r in data_rows if len(r) > 1 and _is_miami_dade(r[1])]
    _log(f"Complaint sync: {len(miami_rows)} Miami-Dade complaints")

    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    _ensure_table(conn)

    # Load and pre-normalize all DB addresses + owners for two-signal matching
    db_rows = conn.execute("SELECT folio, address, owner FROM properties").fetchall()
    db_index = build_db_index(db_rows)
    _log(f"Complaint sync: indexed {len(db_index):,} property addresses for matching")

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    synced = matched = skipped = 0

    for raw in miami_rows:
        # Pad row to expected length
        row = raw + [""] * (len(COLS) - len(raw))
        rec = dict(zip(COLS, row[:len(COLS)]))

        property_address = rec.get("property_address", "").strip()
        if not property_address:
            skipped += 1
            continue

        norm      = _normalize_address(property_address)
        defendant = rec.get("defendant", "")
        folio, score = _match_folio(norm, db_index, defendant=defendant)
        if folio:
            matched += 1

        try:
            conn.execute("""
                INSERT INTO complaints
                    (folio, match_score, document_title, county, date_filed,
                     plaintiff, plaintiff_attorney, plaintiff_attorney_email,
                     plaintiff_attorney_phone, plaintiff_attorney_firm, defendant,
                     property_address, property_legal, loan_amount, loan_date,
                     loan_rate, maturity_date, guarantor, default_reason,
                     default_date, unpaid_balance, sum_unpaid_balance, default_rate,
                     right_to_reinstate, fannie_freddie, sba, pdf_link,
                     meets_criteria, synced_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(date_filed, plaintiff, property_address) DO UPDATE SET
                    folio         = excluded.folio,
                    match_score   = excluded.match_score,
                    synced_at     = excluded.synced_at
            """, (
                folio, round(score, 3),
                rec["document_title"], rec["county"], rec["date_filed"],
                rec["plaintiff"], rec["plaintiff_attorney"],
                rec["plaintiff_attorney_email"], rec["plaintiff_attorney_phone"],
                rec["plaintiff_attorney_firm"], rec["defendant"],
                property_address, rec["property_legal"],
                rec["loan_amount"], rec["loan_date"], rec["loan_rate"],
                rec["maturity_date"], rec["guarantor"], rec["default_reason"],
                rec["default_date"], rec["unpaid_balance"], rec["sum_unpaid_balance"],
                rec["default_rate"], rec["right_to_reinstate"],
                rec["fannie_freddie"], rec["sba"], rec["pdf_link"],
                rec["meets_criteria"], now,
            ))
            synced += 1
        except Exception as e:
            _log(f"  Insert error ({property_address[:40]}): {e}")
            skipped += 1

    conn.commit()
    conn.close()

    _log(
        f"Complaint sync complete — {synced} upserted, "
        f"{matched} matched to properties, {skipped} skipped"
    )
    return synced, matched, skipped


if __name__ == "__main__":
    run_complaint_sync()
