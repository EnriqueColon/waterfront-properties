#!/usr/bin/env python3
"""
Miami-Dade Waterfront Property Ingestor  v2
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5-stage pipeline:
  1. download  — MDC canals + municipality polygons
  2. filter    — parcels in canal/coastal grid cells
  3. spatial   — shapely intersection + community assignment
  4. enrich    — FEMA flood zones (MDC Layer 35)
  5. store     — SQLite upsert

Flask API on :5050  |  APScheduler auto-refresh every 24 h
"""
import sqlite3, requests, time, threading, math, os
from datetime import datetime
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
from shapely.geometry import shape, Point, MultiLineString
from shapely.ops import unary_union

from flask import Flask, jsonify, request
from flask_cors import CORS
from apscheduler.schedulers.background import BackgroundScheduler
from legal_scanner import run_legal_scan
from complaint_syncer import run_complaint_sync

# ─── Endpoints (all verified live) ────────────────────────────────────────────
MDC_BASE    = "https://gis.miamidade.gov/arcgis/rest/services/MD_LandInformation/MapServer"
PARCELS_URL = f"{MDC_BASE}/26/query"   # parcel polygons + attributes
CANALS_URL  = f"{MDC_BASE}/67/query"   # canal polylines  (1,357 features, has NAME)
STREAMS_URL = f"{MDC_BASE}/68/query"   # stream polylines (river-front)
MUNIC_URL   = f"{MDC_BASE}/77/query"   # municipality polygons (182 features, has NAME)
FEMA_URL    = f"{MDC_BASE}/35/query"   # FEMA flood zones — FZONE, ELEV, ZONESUBTY

# Miami-Dade county envelope WGS-84 [lng_min, lat_min, lng_max, lat_max]
MDC_BBOX = (-80.873, 25.138, -80.031, 25.979)

# Known coastal community bounding boxes for Bay / Ocean / Intracoastal parcels.
# These are derived from the COMMUNITIES data and cover the major coastal corridors.
COASTAL_AREAS = [
    # (wf_type,        lng_min,  lat_min,  lng_max,  lat_max, label)
    ("Ocean",         -80.137,  25.757,   -80.118,  25.970,  "Miami Beach Oceanfront"),
    ("Bay",           -80.199,  25.770,   -80.155,  25.815,  "Biscayne Bay – Central"),
    ("Bay",           -80.255,  25.700,   -80.230,  25.735,  "Coconut Grove Bayfront"),
    ("Bay",           -80.196,  25.750,   -80.185,  25.780,  "Brickell Bayfront"),
    ("Bay",           -80.165,  25.840,   -80.150,  25.860,  "North Bay Village"),
    ("Intracoastal",  -80.153,  25.763,   -80.132,  25.880,  "Intracoastal Waterway"),
    ("Intracoastal",  -80.158,  25.942,   -80.132,  25.972,  "Aventura – ICW"),
    ("Bay/Ocean",     -80.170,  25.680,   -80.150,  25.715,  "Key Biscayne"),
    ("Bay",           -80.145,  25.882,   -80.128,  25.900,  "Bay Harbor Islands"),
    ("Ocean",         -80.132,  25.882,   -80.118,  25.902,  "Bal Harbour"),
]

CANAL_BUFFER_DEG  = 0.00015   # ~15 m buffer around canal/stream lines
GRID_STEP         = 0.05       # 0.05° grid cells for parcel batching (~5 km)
PAGE              = 1000
DB_PATH           = os.path.join(os.path.dirname(os.path.abspath(__file__)), "miami_waterfront.db")
API_PORT          = int(os.environ.get("PORT", 5050))

# ─── Pipeline state ────────────────────────────────────────────────────────────
_state = {"running": False, "stage": "complete", "progress": 100,
          "last_run": None, "log": []}
_lock  = threading.Lock()

def _set(stage, pct, msg=""):
    with _lock:
        _state["stage"]    = stage
        _state["progress"] = pct
        if msg:
            ts = datetime.now().strftime("%H:%M:%S")
            _state["log"].append(f"[{ts}] {msg}")
            print(f"[{ts}] {msg}", flush=True)

def _log(msg): _set(_state["stage"], _state["progress"], msg)

# ─── Database ──────────────────────────────────────────────────────────────────
def init_db():
    con = sqlite3.connect(DB_PATH)
    con.executescript("""
        CREATE TABLE IF NOT EXISTS properties (
            folio          TEXT PRIMARY KEY,
            address        TEXT,
            community      TEXT,
            wf_type        TEXT,
            prop_type      TEXT,
            sqft           INTEGER,
            lot_sqft       INTEGER,
            beds           INTEGER,
            baths          INTEGER,
            year_built     INTEGER,
            assessed       REAL,
            land_value     REAL,
            building_value REAL,
            flood_zone     TEXT,
            water_feet     INTEGER,
            owner          TEXT,
            lat            REAL,
            lng            REAL,
            water_body       TEXT,
            last_sale_price  REAL,
            last_sale_date   TEXT,
            updated_at       TEXT
        );
        CREATE TABLE IF NOT EXISTS pipeline_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_at TEXT, source TEXT, total INTEGER,
            inserted INTEGER, updated INTEGER,
            duration_s REAL, status TEXT, error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_wf_type   ON properties(wf_type);
        CREATE INDEX IF NOT EXISTS idx_community ON properties(community);
        CREATE INDEX IF NOT EXISTS idx_flood     ON properties(flood_zone);
        CREATE INDEX IF NOT EXISTS idx_assessed  ON properties(assessed);
    """)
    con.commit()
    con.close()

# ─── ArcGIS REST helpers ────────────────────────────────────────────────────────
def _get(url, params, retries=4):
    for i in range(retries):
        try:
            r = requests.get(url, params=params, timeout=45)
            r.raise_for_status()
            d = r.json()
            if "error" in d:
                raise RuntimeError(d["error"])
            return d
        except Exception as exc:
            if i == retries - 1: raise
            time.sleep(2 ** i)


def fetch_all_features(url, where, fields, out_sr=4326, geom_filter=None, extra=None):
    """Paginate all features from an ArcGIS layer."""
    feats, offset = [], 0
    params = {"where": where, "outFields": fields, "returnGeometry": "true",
              "outSR": out_sr, "f": "json",
              "resultRecordCount": PAGE, "resultOffset": 0}
    if geom_filter: params.update(geom_filter)
    if extra:       params.update(extra)
    while True:
        params["resultOffset"] = offset
        batch = _get(url, params).get("features", [])
        feats.extend(batch)
        if len(batch) < PAGE: break
        offset += PAGE
        time.sleep(0.08)
    return feats


def bbox_query(url, fields, lng0, lat0, lng1, lat1, where="1=1"):
    """Return features inside a bounding box."""
    return fetch_all_features(url, where, fields, geom_filter={
        "geometry":     f"{lng0},{lat0},{lng1},{lat1}",
        "geometryType": "esriGeometryEnvelope",
        "inSR":         "4326",
        "spatialRel":   "esriSpatialRelIntersects",
    })


# ─── Geometry helpers ──────────────────────────────────────────────────────────
def to_shape(geom):
    if not geom: return None
    try:
        if "rings" in geom:
            return shape({"type": "Polygon", "coordinates": geom["rings"]})
        if "paths" in geom:
            coords = geom["paths"]
            if len(coords) == 1:
                return shape({"type": "LineString", "coordinates": coords[0]})
            return shape({"type": "MultiLineString", "coordinates": coords})
        if "x" in geom:
            return Point(geom["x"], geom["y"])
    except Exception:
        pass
    return None


def centroid(geom):
    g = to_shape(geom)
    if g is None: return None, None
    c = g.centroid
    return round(c.y, 6), round(c.x, 6)


def frontage_ft(parcel_shape, water_shape):
    try:
        shared = parcel_shape.boundary.intersection(water_shape.buffer(CANAL_BUFFER_DEG))
        return max(20, int(shared.length * 364_000))
    except Exception:
        return 30


# ─── Property type classification ─────────────────────────────────────────────
# MDC DOR codes are 4-digit; first 2 digits follow the Florida DOR schedule.
_DOR = {"01": "SFH", "02": "Mobile Home", "03": "Multifamily", "04": "Condo",
        "05": "Cooperative", "06": "Retirement", "07": "SFH",
        "08": "Multifamily", "09": "Cooperative"}

def prop_type(dor_code):
    if not dor_code: return "Unknown"
    code = str(dor_code).zfill(4)[:2]
    return _DOR.get(code, "Commercial/Other")


# ─── Stage 1 — Download reference layers ──────────────────────────────────────
def stage_download():
    _set("download", 3, "Fetching canal polylines (Layer 67)…")
    canal_feats = fetch_all_features(CANALS_URL, "1=1", "NAME,TYPE")
    _log(f"  {len(canal_feats)} canal features")

    _set("download", 9, "Fetching stream polylines (Layer 68)…")
    stream_feats = fetch_all_features(STREAMS_URL, "1=1", "OBJECTID")
    _log(f"  {len(stream_feats)} stream features")

    _set("download", 14, "Fetching municipality polygons (Layer 77)…")
    munic_feats = fetch_all_features(MUNIC_URL, "1=1", "NAME,MUNICID")
    _log(f"  {len(munic_feats)} municipality polygons")

    # Build shapely objects
    canals = []
    for f in canal_feats:
        g = to_shape(f.get("geometry"))
        name = (f.get("attributes") or {}).get("NAME") or "Canal"
        if g: canals.append((g, name))

    streams = [(to_shape(f.get("geometry")), "Stream")
               for f in stream_feats if to_shape(f.get("geometry"))]

    municipalities = []
    for f in munic_feats:
        g = to_shape(f.get("geometry"))
        name = (f.get("attributes") or {}).get("NAME") or "Miami-Dade"
        if g: municipalities.append((g, name))

    return canals, streams, municipalities


# ─── Stage 2 — Filter: collect waterfront parcels ─────────────────────────────
PARCEL_FIELDS = (
    "FOLIO,TRUE_SITE_ADDR,TRUE_SITE_CITY,TRUE_OWNER1,DOR_CODE_CUR,DOR_DESC,"
    "BEDROOM_COUNT,BATHROOM_COUNT,BUILDING_HEATED_AREA,"
    "LOT_SIZE,YEAR_BUILT,LAND_VAL_CUR,BUILDING_VAL_CUR,TOTAL_VAL_CUR"
)


def _grid_cells_for_shapes(shapes, step=GRID_STEP):
    """Return set of (lng_cell, lat_cell) grid coords that overlap these shapes."""
    cells = set()
    for g, _ in shapes:
        if g is None: continue
        b = g.bounds   # minx, miny, maxx, maxy
        lng0 = math.floor(b[0] / step) * step
        lat0 = math.floor(b[1] / step) * step
        lng1 = math.ceil(b[2]  / step) * step
        lat1 = math.ceil(b[3]  / step) * step
        c_lng = lng0
        while c_lng < lng1:
            c_lat = lat0
            while c_lat < lat1:
                cells.add((round(c_lng, 4), round(c_lat, 4)))
                c_lat += step
            c_lng += step
    return cells


def _query_parcels_in_cell(lng, lat):
    try:
        return bbox_query(PARCELS_URL, PARCEL_FIELDS, lng, lat, lng + GRID_STEP, lat + GRID_STEP)
    except Exception as exc:
        _log(f"  Warning — parcel query failed for cell ({lng:.3f},{lat:.3f}): {exc}")
        return []


def stage_filter(canals, streams):
    results = {}  # folio → dict

    # ── Canal-front parcels ──────────────────────────────────────────────────
    _set("filter", 20, "Building canal grid cells…")
    canal_union = unary_union([g.buffer(CANAL_BUFFER_DEG) for g, _ in canals])
    canal_cells = _grid_cells_for_shapes(canals)
    _log(f"  {len(canal_cells)} grid cells covering canals")

    for i, (lng, lat) in enumerate(sorted(canal_cells)):
        if i % 25 == 0:
            pct = 20 + int(20 * i / max(len(canal_cells), 1))
            _set("filter", pct, f"  Canal grid {i+1}/{len(canal_cells)} "
                                f"({lng:.3f},{lat:.3f}) — {len(results)} parcels so far")
        feats = _query_parcels_in_cell(lng, lat)
        for f in feats:
            attrs = f.get("attributes") or {}
            folio = attrs.get("FOLIO")
            if not folio: continue
            p_geom = f.get("geometry")
            p_shape = to_shape(p_geom)
            if not p_shape or not p_shape.intersects(canal_union): continue
            lat_, lng_ = centroid(p_geom)
            if lat_ is None: continue
            # Find the specific canal that touches this parcel
            best_name, best_ft = "Canal", 20
            for c_shape, c_name in canals:
                if p_shape.intersects(c_shape.buffer(CANAL_BUFFER_DEG)):
                    ft = frontage_ft(p_shape, c_shape)
                    if ft > best_ft:
                        best_ft, best_name = ft, c_name
            results[folio] = {"folio": folio, "attrs": attrs, "lat": lat_, "lng": lng_,
                              "wf_type": "Canal", "water_body": best_name,
                              "water_feet": best_ft}

    _log(f"  {len(results)} canal-front parcels found")

    # ── River/stream-front parcels ────────────────────────────────────────────
    _set("filter", 44, "Building stream grid cells…")
    if streams:
        stream_union = unary_union([g.buffer(CANAL_BUFFER_DEG * 1.5) for g, _ in streams])
        stream_cells = _grid_cells_for_shapes(streams)
        _log(f"  {len(stream_cells)} grid cells covering streams")
        for i, (lng, lat) in enumerate(sorted(stream_cells)):
            feats = _query_parcels_in_cell(lng, lat)
            for f in feats:
                attrs = f.get("attributes") or {}
                folio = attrs.get("FOLIO")
                if not folio or folio in results: continue
                p_geom = f.get("geometry")
                p_shape = to_shape(p_geom)
                if not p_shape or not p_shape.intersects(stream_union): continue
                lat_, lng_ = centroid(p_geom)
                if lat_ is None: continue
                results[folio] = {"folio": folio, "attrs": attrs, "lat": lat_, "lng": lng_,
                                  "wf_type": "River", "water_body": "Miami River",
                                  "water_feet": 35}
        _log(f"  {len(results)} total after rivers")

    # ── Coastal parcels (Ocean / Bay / Intracoastal) ──────────────────────────
    _set("filter", 50, "Querying coastal bounding boxes…")
    for wf_type, lng0, lat0, lng1, lat1, label in COASTAL_AREAS:
        _log(f"  Coastal area: {label} ({wf_type})")
        try:
            feats = bbox_query(PARCELS_URL, PARCEL_FIELDS, lng0, lat0, lng1, lat1)
        except Exception as exc:
            _log(f"    Warning: {exc}")
            continue
        new_count = 0
        for f in feats:
            attrs = f.get("attributes") or {}
            folio = attrs.get("FOLIO")
            if not folio or folio in results: continue
            p_geom = f.get("geometry")
            lat_, lng_ = centroid(p_geom)
            if lat_ is None: continue
            results[folio] = {"folio": folio, "attrs": attrs, "lat": lat_, "lng": lng_,
                              "wf_type": wf_type, "water_body": label, "water_feet": 40}
            new_count += 1
        _log(f"    {len(feats)} parcels, {new_count} new")

    _log(f"  Total waterfront parcels: {len(results)}")
    return results


# ─── Stage 3 — Spatial: community name from municipality polygons ──────────────
def stage_spatial(parcel_map, municipalities):
    _set("spatial", 62, f"Assigning municipality to {len(parcel_map)} parcels…")
    for i, (folio, p) in enumerate(parcel_map.items()):
        if i % 1000 == 0 and i > 0:
            _set("spatial", 62 + int(4 * i / len(parcel_map)))
        pt = Point(p["lng"], p["lat"])
        name = p["attrs"].get("TRUE_SITE_CITY") or "Miami-Dade"
        for m_shape, m_name in municipalities:
            if m_shape.contains(pt):
                name = m_name.title()
                break
        p["community"] = name
    _log("  Municipality assignment done")
    return parcel_map


# ─── Stage 4 — FEMA flood zone enrichment ─────────────────────────────────────
def stage_enrich_fema(parcel_map):
    _set("enrich", 68, "Fetching FEMA flood zone polygons (Layer 35)…")
    try:
        fema_feats = bbox_query(FEMA_URL, "FZONE,ZONESUBTY,ELEV",
                                *MDC_BBOX)
        _log(f"  {len(fema_feats)} FEMA flood zone polygons")
        flood_zones = []
        for f in fema_feats:
            g = to_shape(f.get("geometry"))
            zone = (f.get("attributes") or {}).get("FZONE") or "X"
            if g: flood_zones.append((g, zone))

        _set("enrich", 76, "Point-in-polygon flood zone assignment…")
        for i, (folio, p) in enumerate(parcel_map.items()):
            if i % 2000 == 0 and i > 0:
                _set("enrich", 76 + int(6 * i / len(parcel_map)))
            pt = Point(p["lng"], p["lat"])
            p["flood_zone"] = "X"
            for fz_geom, fz_code in flood_zones:
                if fz_geom.contains(pt):
                    p["flood_zone"] = fz_code
                    break
    except Exception as exc:
        _log(f"  FEMA enrichment failed: {exc} — defaulting to AE")
        for p in parcel_map.values():
            p["flood_zone"] = "AE"
    return parcel_map


# ─── Stage 5 — Store ───────────────────────────────────────────────────────────
def stage_store(parcel_map):
    _set("store", 88, f"Upserting {len(parcel_map)} records into SQLite…")
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    inserted = updated = 0
    now = datetime.utcnow().isoformat()

    for folio, p in parcel_map.items():
        a = p["attrs"]
        address    = (a.get("TRUE_SITE_ADDR") or "").strip()
        community  = p.get("community") or a.get("TRUE_SITE_CITY") or "Miami-Dade"
        owner      = (a.get("TRUE_OWNER1") or "").strip()
        sqft       = int(a.get("BUILDING_HEATED_AREA") or 0) or None
        lot_sqft   = int(a.get("LOT_SIZE") or 0) or None
        beds       = int(a.get("BEDROOM_COUNT") or 0) or None
        baths      = int(a.get("BATHROOM_COUNT") or 0) or None
        year_built = int(a.get("YEAR_BUILT") or 0) or None
        assessed   = float(a.get("TOTAL_VAL_CUR") or 0) or None
        land_val   = float(a.get("LAND_VAL_CUR") or 0) or None
        bldg_val   = float(a.get("BUILDING_VAL_CUR") or 0) or None

        cur.execute("SELECT folio FROM properties WHERE folio=?", (folio,))
        if cur.fetchone(): updated += 1
        else:              inserted += 1

        cur.execute("""
            INSERT OR REPLACE INTO properties
              (folio,address,community,wf_type,prop_type,sqft,lot_sqft,beds,baths,
               year_built,assessed,land_value,building_value,flood_zone,
               water_feet,owner,lat,lng,water_body,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (folio, address, community, p["wf_type"], prop_type(a.get("DOR_CODE_CUR")),
              sqft, lot_sqft, beds, baths, year_built, assessed, land_val, bldg_val,
              p.get("flood_zone","X"), p.get("water_feet",25), owner,
              p["lat"], p["lng"], p.get("water_body",""), now))

    con.commit()
    con.close()
    _log(f"  Inserted {inserted} new  ·  Updated {updated} existing")
    return inserted, updated


# ─── Main pipeline ─────────────────────────────────────────────────────────────
def run_pipeline():
    if _state["running"]: return
    with _lock:
        _state["running"] = True
        _state["log"]     = []

    start = time.time()
    status = "ok"
    error = None
    inserted = updated = total = 0

    try:
        _log("=== Miami-Dade Waterfront Ingest ===")

        canals, streams, municipalities = stage_download()
        _set("download", 18, f"Stage 1 done — {len(canals)} canals, "
                             f"{len(streams)} streams, {len(municipalities)} municipalities")

        parcel_map = stage_filter(canals, streams)
        _set("filter", 58, f"Stage 2 done — {len(parcel_map)} waterfront parcels")

        parcel_map = stage_spatial(parcel_map, municipalities)
        _set("spatial", 66, "Stage 3 done — community names assigned")

        parcel_map = stage_enrich_fema(parcel_map)
        _set("enrich", 85, "Stage 4 done — flood zones assigned")

        inserted, updated = stage_store(parcel_map)
        total = inserted + updated
        _set("store", 96, f"Stage 5 done — {total} records in DB")

    except Exception as exc:
        status, error = "error", str(exc)
        _log(f"Pipeline ERROR: {exc}")
        import traceback; traceback.print_exc()

    finally:
        duration = round(time.time() - start, 1)
        run_rec  = {"run_at": datetime.utcnow().isoformat(), "source": "live",
                    "total": total, "inserted": inserted, "updated": updated,
                    "duration_s": duration, "status": status, "error": error}
        try:
            con = sqlite3.connect(DB_PATH)
            con.execute("INSERT INTO pipeline_runs "
                        "(run_at,source,total,inserted,updated,duration_s,status,error)"
                        " VALUES (?,?,?,?,?,?,?,?)",
                        (run_rec["run_at"], "live", total, inserted, updated,
                         duration, status, error))
            con.commit(); con.close()
        except Exception: pass

        with _lock:
            _state.update(running=False, stage="complete",
                          progress=100, last_run=run_rec)
        _log(f"=== Done in {duration}s  ·  {total} properties ===")


# ─── Flask API ──────────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)

@app.route("/api/properties")
def api_properties():
    wf_type   = request.args.get("type")
    community = request.args.get("community")
    flood     = request.args.get("flood_zone")
    price_min = request.args.get("price_min", type=float)
    price_max = request.args.get("price_max", type=float)
    sqft_min  = request.args.get("sqft_min",  type=int)
    sqft_max  = request.args.get("sqft_max",  type=int)
    water_min = request.args.get("water_min", type=int)
    water_max = request.args.get("water_max", type=int)
    year_min  = request.args.get("year_min",  type=int)
    year_max  = request.args.get("year_max",  type=int)
    beds_min  = request.args.get("beds_min",  type=int)
    q         = request.args.get("q")
    sort_col  = request.args.get("sort", "assessed")
    order     = "DESC" if request.args.get("order","desc") == "desc" else "ASC"
    page      = request.args.get("page", 0, type=int)
    per_page  = request.args.get("per_page", 60, type=int)

    SAFE_SORTS = {"assessed","sqft","water_feet","year_built","lat","lng","last_sale_price"}
    if sort_col not in SAFE_SORTS: sort_col = "assessed"

    clauses, vals = [], []
    if wf_type:   clauses.append("wf_type=?");       vals.append(wf_type)
    if community: clauses.append("community=?");      vals.append(community)
    if flood:     clauses.append("flood_zone=?");     vals.append(flood)
    if price_min: clauses.append("assessed>=?");      vals.append(price_min)
    if price_max: clauses.append("assessed<=?");      vals.append(price_max)
    if sqft_min:  clauses.append("sqft>=?");          vals.append(sqft_min)
    if sqft_max:  clauses.append("sqft<=?");          vals.append(sqft_max)
    if water_min: clauses.append("water_feet>=?");    vals.append(water_min)
    if water_max: clauses.append("water_feet<=?");    vals.append(water_max)
    if year_min:  clauses.append("year_built>=?");    vals.append(year_min)
    if year_max:  clauses.append("year_built<=?");    vals.append(year_max)
    if beds_min:  clauses.append("beds>=?");          vals.append(beds_min)
    if q:
        like = f"%{q}%"
        clauses.append("(address LIKE ? OR owner LIKE ? OR folio LIKE ? OR community LIKE ?)")
        vals += [like, like, like, like]

    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    total = con.execute(f"SELECT COUNT(*) FROM properties {where}", vals).fetchone()[0]
    rows  = con.execute(
        f"SELECT * FROM properties {where} ORDER BY {sort_col} {order}"
        f" LIMIT ? OFFSET ?", vals + [per_page, page * per_page]
    ).fetchall()
    con.close()
    return jsonify({"total": total, "page": page, "per_page": per_page,
                    "data": [dict(r) for r in rows]})


@app.route("/api/stats")
def api_stats():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    t = con.execute(
        "SELECT COUNT(*) c, SUM(assessed) tv, MAX(assessed) mx, AVG(water_feet) aw"
        " FROM properties"
    ).fetchone()
    by_type  = [dict(r) for r in con.execute(
        "SELECT wf_type, COUNT(*) cnt, AVG(assessed) avg_price,"
        " SUM(assessed) total_value, AVG(water_feet) avg_water"
        " FROM properties GROUP BY wf_type ORDER BY cnt DESC")]
    by_flood = [dict(r) for r in con.execute(
        "SELECT flood_zone, COUNT(*) cnt, AVG(assessed) avg_price"
        " FROM properties GROUP BY flood_zone")]
    top10    = [dict(r) for r in con.execute(
        "SELECT * FROM properties ORDER BY assessed DESC LIMIT 10")]
    by_comm  = [dict(r) for r in con.execute(
        "SELECT community, wf_type, COUNT(*) cnt,"
        " AVG(assessed) avg_price, MAX(assessed) max_price, flood_zone flood"
        " FROM properties GROUP BY community ORDER BY cnt DESC")]
    last_run = con.execute(
        "SELECT * FROM pipeline_runs ORDER BY id DESC LIMIT 1").fetchone()
    con.close()
    return jsonify({"total_count": t["c"], "total_value": t["tv"] or 0,
                    "max_sale": t["mx"] or 0, "avg_water": round(t["aw"] or 0),
                    "by_type": by_type, "by_flood": by_flood,
                    "top10": top10, "by_comm": by_comm,
                    "last_run": dict(last_run) if last_run else None})


@app.route("/api/pipeline/status")
def api_status():
    with _lock:
        return jsonify({**_state, "log": _state["log"][-60:]})


@app.route("/api/pipeline/trigger", methods=["POST"])
def api_trigger():
    if _state["running"]:
        return jsonify({"ok": False, "msg": "Already running"}), 409
    threading.Thread(target=run_pipeline, daemon=True).start()
    return jsonify({"ok": True, "msg": "Pipeline started"})


@app.route("/api/properties/<folio>")
def api_property(folio):
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    row = con.execute("SELECT * FROM properties WHERE folio=?", (folio,)).fetchone()
    con.close()
    return jsonify(dict(row)) if row else (jsonify({"error": "not found"}), 404)


@app.route("/api/building/<prefix>")
def api_building(prefix):
    """Return all units sharing the same 10-digit folio prefix (same building)."""
    if len(prefix) != 10 or not prefix.isdigit():
        return jsonify({"error": "prefix must be 10 digits"}), 400
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT folio, address, prop_type, assessed, land_value, building_value,"
        " beds, baths, sqft, last_sale_price, last_sale_date, flood_zone, year_built"
        " FROM properties WHERE folio LIKE ? ORDER BY folio",
        (prefix + "%",)
    ).fetchall()
    con.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/alerts")
def api_alerts():
    """Return all active legal encumbrances, optionally filtered by folio."""
    folio    = request.args.get("folio")
    severity = request.args.get("severity")
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    clauses, vals = [], []
    if folio:    clauses.append("a.folio=?");       vals.append(folio)
    if severity: clauses.append("a.severity=?");    vals.append(severity)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    rows = con.execute(f"""
        SELECT a.*, p.address, p.community, p.wf_type, p.assessed
        FROM property_alerts a
        LEFT JOIN properties p ON p.folio = a.folio
        {where}
        ORDER BY
          CASE a.severity WHEN 'red' THEN 0 WHEN 'orange' THEN 1 ELSE 2 END,
          a.rec_date DESC
    """, vals).fetchall()
    # Summary counts
    summary = con.execute("""
        SELECT severity, COUNT(DISTINCT folio) cnt
        FROM property_alerts GROUP BY severity
    """).fetchall()
    con.close()
    return jsonify({
        "alerts":  [dict(r) for r in rows],
        "summary": {r["severity"]: r["cnt"] for r in summary},
        "last_scan": None,
    })


@app.route("/api/alerts/scan", methods=["POST"])
def api_alerts_scan():
    """Trigger an on-demand legal scan (runs in background)."""
    def _scan():
        run_legal_scan(log_fn=_log)
    threading.Thread(target=_scan, daemon=True).start()
    return jsonify({"ok": True, "msg": "Legal scan started"})


@app.route("/api/complaints")
def api_complaints():
    """Return foreclosure complaints, optionally filtered by folio."""
    folio = request.args.get("folio")
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    if folio:
        rows = con.execute(
            "SELECT * FROM complaints WHERE folio=? ORDER BY date_filed DESC",
            (folio,)
        ).fetchall()
    else:
        rows = con.execute("""
            SELECT c.*, p.community, p.wf_type, p.assessed
            FROM complaints c
            LEFT JOIN properties p ON p.folio = c.folio
            WHERE c.folio IS NOT NULL
            ORDER BY c.date_filed DESC
        """).fetchall()
    total    = con.execute("SELECT COUNT(*) FROM complaints").fetchone()[0]
    matched  = con.execute("SELECT COUNT(*) FROM complaints WHERE folio IS NOT NULL").fetchone()[0]
    con.close()
    return jsonify({
        "complaints": [dict(r) for r in rows],
        "total": total,
        "matched": matched,
    })


@app.route("/api/flagged")
def api_flagged():
    """
    Unified flagged-property list: combines legal alerts + foreclosure complaints.
    Returns one entry per property, with severity, alerts list, and complaints list.
    """
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row

    # All properties that have at least one alert or complaint
    alert_rows = con.execute("""
        SELECT a.folio, a.doc_type, a.severity, a.rec_date, a.first_party, a.second_party
        FROM property_alerts a
        ORDER BY CASE a.severity WHEN 'red' THEN 0 WHEN 'orange' THEN 1 ELSE 2 END, a.rec_date DESC
    """).fetchall()

    complaint_rows = con.execute("""
        SELECT folio, date_filed, plaintiff, defendant, loan_amount,
               unpaid_balance, pdf_link, match_score, meets_criteria
        FROM complaints WHERE folio IS NOT NULL
        ORDER BY date_filed DESC
    """).fetchall()

    # Group by folio
    by_folio = {}
    for a in alert_rows:
        f = a["folio"]
        if f not in by_folio:
            by_folio[f] = {"alerts": [], "complaints": []}
        by_folio[f]["alerts"].append(dict(a))

    for c in complaint_rows:
        f = c["folio"]
        if f not in by_folio:
            by_folio[f] = {"alerts": [], "complaints": []}
        by_folio[f]["complaints"].append(dict(c))

    # Enrich with property data
    folios = list(by_folio.keys())
    if folios:
        placeholders = ",".join("?" * len(folios))
        props = con.execute(
            f"SELECT folio, address, community, wf_type, assessed, last_sale_price, flood_zone, owner "
            f"FROM properties WHERE folio IN ({placeholders})",
            folios
        ).fetchall()
        prop_map = {r["folio"]: dict(r) for r in props}
    else:
        prop_map = {}

    SEVER_ORDER = {"red": 0, "orange": 1, "yellow": 2, "complaint": 3}

    result = []
    for folio, data in by_folio.items():
        p = prop_map.get(folio, {})
        severities = [a["severity"] for a in data["alerts"]]
        if data["complaints"]:
            severities.append("complaint")
        worst = min(severities, key=lambda s: SEVER_ORDER.get(s, 9)) if severities else "complaint"
        result.append({
            "folio":           folio,
            "address":         p.get("address", ""),
            "community":       p.get("community", ""),
            "wf_type":         p.get("wf_type", ""),
            "assessed":        p.get("assessed"),
            "last_sale_price": p.get("last_sale_price"),
            "flood_zone":      p.get("flood_zone", ""),
            "owner":           p.get("owner", ""),
            "worst_severity":  worst,
            "alerts":          data["alerts"],
            "complaints":      data["complaints"],
        })

    # Sort: red first, then orange, yellow, complaint-only
    result.sort(key=lambda r: SEVER_ORDER.get(r["worst_severity"], 9))

    counts = {
        "red":        sum(1 for r in result if r["worst_severity"] == "red"),
        "orange":     sum(1 for r in result if r["worst_severity"] == "orange"),
        "yellow":     sum(1 for r in result if r["worst_severity"] == "yellow"),
        "complaint":  sum(1 for r in result if r["worst_severity"] == "complaint"),
    }
    con.close()
    return jsonify({"flagged": result, "counts": counts})


@app.route("/api/complaints/sync", methods=["POST"])
def api_complaints_sync():
    """Trigger an on-demand Google Sheets complaint sync (runs in background)."""
    def _sync():
        run_complaint_sync(log_fn=_log)
    threading.Thread(target=_sync, daemon=True).start()
    return jsonify({"ok": True, "msg": "Complaint sync started"})


@app.route("/")
def index():
    return jsonify({"service": "Miami-Dade Waterfront DB",
                    "routes": ["/api/properties", "/api/stats",
                               "/api/pipeline/status", "/api/pipeline/trigger",
                               "/api/alerts", "/api/alerts/scan",
                               "/api/complaints", "/api/complaints/sync"]})


# ─── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("Initializing DB…")
    init_db()

    con   = sqlite3.connect(DB_PATH)
    count = con.execute("SELECT COUNT(*) FROM properties").fetchone()[0]
    con.close()

    if count == 0:
        print("DB empty — starting initial pipeline run in background…")
        threading.Thread(target=run_pipeline, daemon=True).start()
    else:
        print(f"DB has {count:,} existing records — skipping initial ingest")
        print("POST /api/pipeline/trigger to force a refresh")

    scheduler = BackgroundScheduler()
    scheduler.add_job(run_pipeline,  "interval", hours=24, id="daily_ingest")
    scheduler.add_job(
        lambda: run_legal_scan(log_fn=_log),
        "cron", day_of_week="fri", hour=6, minute=0, id="weekly_legal_scan"
    )
    scheduler.add_job(
        lambda: run_complaint_sync(log_fn=_log),
        "cron", day_of_week="fri", hour=7, minute=0, id="weekly_complaint_sync"
    )
    scheduler.start()
    print("Legal scan scheduled: every Friday at 6:00 AM")
    print("Complaint sync scheduled: every Friday at 7:00 AM")

    print(f"\nAPI:  http://localhost:{API_PORT}")
    print("Docs: /api/properties  /api/stats  /api/pipeline/status\n")
    app.run(host="0.0.0.0", port=API_PORT, debug=False, use_reloader=False)
