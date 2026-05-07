import { useState } from "react";
import { Pipeline }    from "./components/Pipeline.jsx";
import { Stat }        from "./components/Stat.jsx";
import { Detail }      from "./components/Detail.jsx";
import { Pill }        from "./components/Pill.jsx";
import { SortButton }  from "./components/SortButton.jsx";
import { usePipeline }                       from "./hooks/usePipeline.js";
import { useFilteredProperties, PAGE_SIZE }  from "./hooks/useFilteredProperties.js";
import { usePropertyStats }                  from "./hooks/usePropertyStats.js";
import { useAlerts }                         from "./hooks/useAlerts.js";
import { useFlagged }                        from "./hooks/useFlagged.js";
import { fmtM, fmtN, tc, fc }               from "./utils/format.js";
import { WF_TYPES, PRICE_RANGES, FLOOD_ZONES } from "./constants/index.js";

const TABS = [
  ["records",   "Properties"],
  ["flagged",   "Flagged"],
  ["analytics", "Analytics"],
  ["pipeline",  "Pipeline"],
];

const PIPELINE_STEPS = [
  { n:"01", t:"MDCPA Parcel Download",        c:"#0ea5e9",
    api:"https://gis.miamidade.gov/arcgis/rest/services/MD_LandInformation/MapServer/26/query",
    d:"Downloads all Miami-Dade county parcels from the MDC ArcGIS MapServer. Handles pagination at 1,000 records per request. Fetches parcel polygons with assessed values, property type, owner, and building attributes." },
  { n:"02", t:"Waterfront Flag Filter",        c:"#38bdf8",
    api:"MDC Layer 67 (Canals) + Layer 68 (Streams) + 10 coastal bounding boxes",
    d:"Queries parcels that spatially intersect canal polylines (1,357 canals), stream polylines (3,092 streams), and known coastal corridors for Ocean, Bay, and Intracoastal waterfront. Uses a 0.05° grid for efficient batching." },
  { n:"03", t:"NOAA Coastal Spatial Join",     c:"#a78bfa",
    api:"Shapely point-in-polygon against MDC Layer 77 (182 municipalities)",
    d:"For each waterfront parcel centroid, performs point-in-polygon lookup against the MDC municipality layer to assign community name. Canal type is derived from canal NAME field (e.g., Biscayne Canal, Westbrook Canal)." },
  { n:"04", t:"FEMA Flood Zone Enrichment",    c:"#fbbf24",
    api:"https://gis.miamidade.gov/arcgis/rest/services/MD_LandInformation/MapServer/35/query",
    d:"Fetches all FEMA National Flood Hazard Layer polygons for Miami-Dade in one request, then assigns each parcel its flood zone (VE = coastal wave action, AE = base flood elevation, X = minimal hazard) via Shapely point-in-polygon." },
  { n:"05", t:"Upsert to Database",            c:"#10b981",
    api:"SQLite — INSERT OR REPLACE, re-index wf_type, community, flood_zone, assessed",
    d:"Upserts all records into the local SQLite database. Tracks new vs updated counts. Full run log in the pipeline_runs table. Re-indexes waterfront type, community, flood zone, and assessed value columns after each run." },
];

const CODE_SNIPPET = [
  { c:"#2d5070", t:"# 1. Activate venv and install deps" },
  { c:"#38bdf8", t:"source backend/venv/bin/activate" },
  { c:"#38bdf8", t:"pip install flask flask-cors apscheduler shapely requests" },
  { c:"#2d5070", t:"# 2. Run backend (pipeline fires on startup, then every 24h)" },
  { c:"#38bdf8", t:"python backend/ingestor.py" },
  { c:"#2d5070", t:"# 3. Query the live API" },
  { c:"#10b981", t:"curl 'http://localhost:5050/api/properties?type=Canal&per_page=10'" },
  { c:"#10b981", t:"curl 'http://localhost:5050/api/stats'" },
  { c:"#2d5070", t:"# 4. Force a re-sync" },
  { c:"#a78bfa", t:"curl -X POST http://localhost:5050/api/pipeline/trigger" },
];

export default function App() {
  const [tab, setTab] = useState("records");
  const [sel, setSel] = useState(null);

  const pipeline = usePipeline();
  const filters  = useFilteredProperties();
  const stats    = usePropertyStats();
  const { summary: alertSummary } = useAlerts();
  const { flagged, counts: flagCounts, loading: flagLoading, reload: reloadFlagged } = useFlagged();

  // Derive community list from real stats data
  const communityNames = stats.by_comm.map(c => c.community);

  return (
    <div style={{ fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,sans-serif", background:"#070b0f", minHeight:"100vh", color:"#d0d8e4", display:"flex", flexDirection:"column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;height:4px;}
        ::-webkit-scrollbar-track{background:#070b0f;}
        ::-webkit-scrollbar-thumb{background:#1a2535;border-radius:2px;}
        .tr{cursor:pointer;transition:background .12s;}
        .tr:hover{background:#0f1820!important;}
        select,input{background:#0c1018;border:1px solid #1e2d42;color:#d8e2ee;font-family:inherit;font-size:11px;padding:6px 10px;border-radius:3px;outline:none;}
        select:focus,input:focus{border-color:#b88c3c;}
        input::placeholder{color:#4a6080;}
        .tab{background:none;border:none;cursor:pointer;font-family:inherit;font-size:11px;font-weight:500;letter-spacing:0.3px;padding:10px 16px;border-bottom:2px solid transparent;transition:all .18s;color:#5a7090;}
        .tab.on{border-bottom-color:#b88c3c;color:#e0e8f4;}
        .tab:hover:not(.on){color:#8a9eb8;}
        .xbtn{background:none;border:1px solid #1e2d42;color:#5a7090;font-family:inherit;font-size:10px;font-weight:500;padding:5px 12px;border-radius:3px;cursor:pointer;letter-spacing:0.3px;transition:all .18s;}
        .xbtn:hover{border-color:#b88c3c;color:#b88c3c;}
        .xbtn:disabled{opacity:.35;cursor:not-allowed;}
      `}</style>

      {/* ── Header ── */}
      <div style={{ borderBottom:"1px solid #1a2535", padding:"14px 24px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8, background:"#070b0f", position:"sticky", top:0, zIndex:200 }}>
        <div>
          <div style={{ fontSize:14, fontWeight:600, letterSpacing:0.3, color:"#d0d8e4", lineHeight:1 }}>
            Miami-Dade Waterfront
            <span style={{ fontWeight:300, color:"#6a88a8", marginLeft:10, fontSize:12 }}>Asset Intelligence</span>
          </div>
          <div style={{ fontSize:10, color:"#5a7090", letterSpacing:0.5, marginTop:5 }}>
            {stats.total_count.toLocaleString()} properties · MDC Property Appraiser · Live data
          </div>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <span style={{ fontSize:10, fontWeight:500, padding:"4px 10px", borderRadius:2, border:"1px solid #2a7a5230", color:"#2a7a52", background:"#2a7a5210", letterSpacing:0.3 }}>
            {pipeline.pRunning ? "Syncing…" : "Live"}
          </span>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div style={{ borderBottom:"1px solid #1a2535", display:"flex", padding:"0 24px", background:"#070b0f" }}>
        {TABS.map(([t, l]) => (
          <button key={t} className={`tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
            {t === "flagged" && (flagCounts.red + flagCounts.orange + flagCounts.complaint) > 0
              ? <>{l} <span style={{ marginLeft:5, background:"#b8303020", color:"#c44040", border:"1px solid #c4404030", borderRadius:10, fontSize:9, fontWeight:600, padding:"1px 6px" }}>{flagCounts.red + flagCounts.orange + flagCounts.complaint}</span></>
              : l}
          </button>
        ))}
      </div>

      <div style={{ flex:1, padding:"20px 24px", paddingRight:sel ? 316 : 24, overflowY:"auto", transition:"padding-right .3s" }}>

        {/* ══ PROPERTIES ══════════════════════════════════════ */}
        {tab === "records" && <>
          <Pipeline
            stage={pipeline.pStage} progress={pipeline.pProg}
            running={pipeline.pRunning} lastRun={pipeline.lastRun}
            onTrigger={pipeline.triggerPipeline}
          />

          {/* KPI cards */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:8, marginBottom:16 }}>
            <Stat label="Total Properties" value={stats.total_count.toLocaleString()} accent="#4a7fa5" />
            <Stat label="Portfolio Value"  value={fmtM(stats.total_value)}            accent="#b88c3c" />
            <Stat label="Avg Assessed"     value={stats.total_count ? fmtM(stats.total_value / stats.total_count) : "—"} accent="#b88c3c" />
            <Stat label="Highest Assessed" value={fmtM(stats.max_sale)}               accent="#b88c3c" />
            <Stat label="Avg Waterfront"   value={stats.avg_water ? `${stats.avg_water} ft` : "—"} accent="#4a7fa5" />
            <Stat
              label="Flagged"
              value={`${(flagCounts.red||0) + (flagCounts.orange||0) + (flagCounts.complaint||0)} issues`}
              sub={flagCounts.red ? `${flagCounts.red} active legal` : "No active legal"}
              accent="#c44040"
            />
          </div>

          {/* Toolbar */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <span style={{ fontSize:10, color:"#5a7090", fontWeight:500 }}>
              {filters.loading ? "Loading…" : `${filters.total.toLocaleString()} properties`}
              {filters.hasActiveFilters && <span style={{ marginLeft:8, color:"#b88c3c" }}>· filtered</span>}
            </span>
            <div style={{ display:"flex", gap:6 }}>
              {filters.hasActiveFilters && (
                <button className="xbtn" onClick={filters.clearFilters}>Clear Filters</button>
              )}
              <button className="xbtn" onClick={filters.exportCSV} disabled={filters.loading}>Export CSV</button>
            </div>
          </div>

          {/* Table */}
          <div style={{ border:"1px solid #1a2535", borderRadius:3, overflowX:"auto", marginBottom:12, opacity: filters.loading ? 0.6 : 1, transition:"opacity .2s" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
              <thead>
                {/* Column label + sort row */}
                <tr style={{ background:"#0c1018", borderBottom:"1px solid #151e2a" }}>
                  {[
                    { l:"Address",    c: null },
                    { l:"Community",  c: null },
                    { l:"Type",       c: null },
                    { l:"SqFt",       c:"sqft" },
                    { l:"Waterfront", c:"water_feet" },
                    { l:"Bed / Bath", c: null },
                    { l:"Assessed",   c:"assessed" },
                    { l:"Last Sale",  c:"last_sale_price" },
                    { l:"Land",       c: null },
                    { l:"Flood",      c: null },
                    { l:"Built",      c:"year_built" },
                  ].map(({ l, c }) => (
                    <th key={l} style={{ textAlign:"left", padding:"8px 12px 4px", color:"#5a7090", letterSpacing:0.8, textTransform:"uppercase", fontSize:9, fontWeight:600, whiteSpace:"nowrap" }}>
                      {l}{c && <SortButton col={c} sort={filters.sort} order={filters.order} onSort={filters.toggleSort} />}
                    </th>
                  ))}
                </tr>
                {/* Per-column filter row */}
                <tr style={{ background:"#0c1018", borderBottom:"2px solid #1a2535" }}>
                  {/* Address / search */}
                  <td style={{ padding:"4px 8px 8px" }}>
                    <input
                      style={{ width:"100%", minWidth:140, padding:"4px 7px", fontSize:10 }}
                      placeholder="Address, owner, folio…"
                      value={filters.search}
                      onChange={e => filters.setSearch(e.target.value)}
                    />
                  </td>
                  {/* Community */}
                  <td style={{ padding:"4px 8px 8px" }}>
                    <select style={{ width:"100%", minWidth:110, padding:"4px 7px", fontSize:10 }} value={filters.commF} onChange={e => filters.setCommF(e.target.value)}>
                      <option value="">All</option>
                      {communityNames.map(n => <option key={n}>{n}</option>)}
                    </select>
                  </td>
                  {/* Type */}
                  <td style={{ padding:"4px 8px 8px" }}>
                    <select style={{ width:"100%", minWidth:90, padding:"4px 7px", fontSize:10 }} value={filters.typeF} onChange={e => filters.setTypeF(e.target.value)}>
                      <option value="">All</option>
                      {WF_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </td>
                  {/* SqFt min/max */}
                  <td style={{ padding:"4px 8px 8px" }}>
                    <div style={{ display:"flex", gap:3 }}>
                      <input type="number" style={{ width:60, padding:"4px 5px", fontSize:10 }} placeholder="Min" value={filters.sqftMin} onChange={e => filters.setSqftMin(e.target.value)} />
                      <input type="number" style={{ width:60, padding:"4px 5px", fontSize:10 }} placeholder="Max" value={filters.sqftMax} onChange={e => filters.setSqftMax(e.target.value)} />
                    </div>
                  </td>
                  {/* Waterfront min */}
                  <td style={{ padding:"4px 8px 8px" }}>
                    <div style={{ display:"flex", gap:3 }}>
                      <input type="number" style={{ width:55, padding:"4px 5px", fontSize:10 }} placeholder="Min ft" value={filters.waterMin} onChange={e => filters.setWaterMin(e.target.value)} />
                      <input type="number" style={{ width:55, padding:"4px 5px", fontSize:10 }} placeholder="Max ft" value={filters.waterMax} onChange={e => filters.setWaterMax(e.target.value)} />
                    </div>
                  </td>
                  {/* Beds min */}
                  <td style={{ padding:"4px 8px 8px" }}>
                    <input type="number" style={{ width:70, padding:"4px 7px", fontSize:10 }} placeholder="Min beds" value={filters.bedsMin} onChange={e => filters.setBedsMin(e.target.value)} />
                  </td>
                  {/* Assessed (price range) */}
                  <td style={{ padding:"4px 8px 8px" }}>
                    <select style={{ width:"100%", minWidth:110, padding:"4px 7px", fontSize:10 }} value={filters.priceF} onChange={e => filters.setPriceF(+e.target.value)}>
                      {PRICE_RANGES.map((r, i) => <option key={r.label} value={i}>{r.label}</option>)}
                    </select>
                  </td>
                  {/* Last Sale — no filter */}
                  <td style={{ padding:"4px 8px 8px" }} />
                  {/* Land — no filter */}
                  <td style={{ padding:"4px 8px 8px" }} />
                  {/* Flood zone */}
                  <td style={{ padding:"4px 8px 8px" }}>
                    <select style={{ width:"100%", minWidth:80, padding:"4px 7px", fontSize:10 }} value={filters.floodF} onChange={e => filters.setFloodF(e.target.value)}>
                      <option value="">All</option>
                      {FLOOD_ZONES.map(z => <option key={z} value={z}>Zone {z}</option>)}
                    </select>
                  </td>
                  {/* Year built min/max */}
                  <td style={{ padding:"4px 8px 8px" }}>
                    <div style={{ display:"flex", gap:3 }}>
                      <input type="number" style={{ width:52, padding:"4px 5px", fontSize:10 }} placeholder="From" value={filters.yearMin} onChange={e => filters.setYearMin(e.target.value)} />
                      <input type="number" style={{ width:52, padding:"4px 5px", fontSize:10 }} placeholder="To" value={filters.yearMax} onChange={e => filters.setYearMax(e.target.value)} />
                    </div>
                  </td>
                </tr>
              </thead>
              <tbody>
                {filters.data.map((p, i) => (
                  <tr key={p.folio} className="tr"
                    onClick={() => setSel(sel?.folio === p.folio ? null : p)}
                    style={{ borderBottom:"1px solid #111820", background: sel?.folio === p.folio ? "#12202e" : "transparent" }}>
                    <td style={{ padding:"8px 12px" }}>
                      <div style={{ color:"#a8bcd4", fontSize:11, fontWeight:500 }}>{p.address}</div>
                      <div style={{ fontSize:9, color:"#5a7090", marginTop:2 }}>{p.folio}</div>
                    </td>
                    <td style={{ padding:"8px 12px", color:"#8a9eb8", fontSize:10, whiteSpace:"nowrap" }}>{p.community}</td>
                    <td style={{ padding:"8px 12px" }}><Pill label={p.wf_type} color={tc(p.wf_type)} /></td>
                    <td style={{ padding:"8px 12px", color:"#7a90a8", fontSize:10 }}>{p.sqft ? fmtN(p.sqft) : "—"}</td>
                    <td style={{ padding:"8px 12px", color:"#b88c3c", fontWeight:600, fontSize:10 }}>{p.water_feet ? `${p.water_feet} ft` : "—"}</td>
                    <td style={{ padding:"8px 12px", color:"#7a90a8", fontSize:10 }}>{p.beds || p.baths ? `${p.beds ?? "—"} / ${p.baths ?? "—"}` : "—"}</td>
                    <td style={{ padding:"8px 12px", color:"#d0d8e4", fontWeight:600, fontSize:11 }}>{fmtM(p.assessed)}</td>
                    <td style={{ padding:"8px 12px" }}>
                      {p.last_sale_price
                        ? <><div style={{ color:"#b88c3c", fontWeight:600, fontSize:11 }}>{fmtM(p.last_sale_price)}</div>
                            <div style={{ fontSize:9, color:"#5a7090", marginTop:2 }}>{p.last_sale_date}</div></>
                        : <span style={{ color:"#5a7090", fontSize:10 }}>—</span>}
                    </td>
                    <td style={{ padding:"8px 12px", color:"#7a90a8", fontSize:10 }}>{fmtM(p.land_value)}</td>
                    <td style={{ padding:"8px 12px" }}><Pill label={p.flood_zone || "—"} color={fc(p.flood_zone)} /></td>
                    <td style={{ padding:"8px 12px", color:"#7a90a8", fontSize:10 }}>{p.year_built || "—"}</td>
                  </tr>
                ))}
                {!filters.loading && filters.data.length === 0 && (
                  <tr><td colSpan={11} style={{ padding:"40px", textAlign:"center", color:"#5a7090", fontSize:11 }}>
                    {filters.error ? `API error: ${filters.error}` : "No properties match your filters"}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display:"flex", justifyContent:"center", alignItems:"center", gap:10, fontSize:10, marginBottom:4 }}>
            <button className="xbtn" onClick={() => filters.setPage(p => Math.max(0, p - 1))} disabled={filters.page === 0 || filters.loading}>← Previous</button>
            <span style={{ color:"#5a7090", fontWeight:500 }}>
              Page {filters.page + 1} of {Math.max(1, Math.ceil(filters.total / PAGE_SIZE))} · {filters.total.toLocaleString()} properties
            </span>
            <button className="xbtn" onClick={() => filters.setPage(p => p + 1)} disabled={(filters.page + 1) * PAGE_SIZE >= filters.total || filters.loading}>Next →</button>
          </div>
        </>}

        {/* ══ FLAGGED PROPERTIES ══════════════════════════════ */}
        {tab === "flagged" && (() => {
          const SEV_COLOR  = { red: "#c44040", orange: "#c47830", yellow: "#b88c3c", complaint: "#6a5acd" };
          const SEV_LABEL  = { red: "Active Legal Action", orange: "Lien / Encumbrance", yellow: "Mortgage", complaint: "Foreclosure Complaint" };
          const DOC_LABEL  = { LP:"Lis Pendens", FC:"Foreclosure", CF:"Certificate of Foreclosure", JL:"Judgment Lien", TL:"Tax Lien", LN:"Lien", CL:"Code Lien", ML:"Mechanics Lien", PL:"Pending Lien", MT:"Mortgage" };

          return (
            <div>
              {/* Summary row */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:20 }}>
                {[
                  { key:"red",       label:"Active Legal Action",    color:"#c44040" },
                  { key:"orange",    label:"Liens & Encumbrances",   color:"#c47830" },
                  { key:"yellow",    label:"Mortgages",              color:"#b88c3c" },
                  { key:"complaint", label:"Foreclosure Complaints", color:"#6a5acd" },
                ].map(({ key, label, color }) => (
                  <div key={key} style={{ background:"#0c1018", border:"1px solid #1a2535", borderLeft:`2px solid ${color}`, borderRadius:3, padding:"12px 16px" }}>
                    <div style={{ fontSize:22, fontWeight:600, color:"#d0d8e4", lineHeight:1, marginBottom:6 }}>{flagCounts[key] || 0}</div>
                    <div style={{ fontSize:10, color:"#6a88a8", fontWeight:500 }}>{label}</div>
                  </div>
                ))}
              </div>

              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                <div style={{ fontSize:10, color:"#5a7090", fontWeight:500 }}>{flagged.length} flagged properties</div>
                <button className="xbtn" onClick={reloadFlagged} disabled={flagLoading}>Refresh</button>
              </div>

              {flagLoading && <div style={{ color:"#5a7090", fontSize:11, padding:32, textAlign:"center" }}>Loading…</div>}

              {!flagLoading && flagged.length === 0 && (
                <div style={{ color:"#5a7090", fontSize:11, padding:40, textAlign:"center", border:"1px solid #1a2535", borderRadius:3 }}>
                  No flagged properties on record. Run a legal scan or complaint sync to populate.
                </div>
              )}

              {/* Cards */}
              <div style={{ display:"grid", gap:6 }}>
                {flagged.map(prop => {
                  const sev   = prop.worst_severity;
                  const color = SEV_COLOR[sev] || "#7a90a8";
                  return (
                    <div key={prop.folio}
                      style={{ background:"#0c1018", border:"1px solid #1a2535", borderLeft:`2px solid ${color}`, borderRadius:3, padding:"14px 16px", cursor:"pointer", transition:"background .12s" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#0f1820"}
                      onMouseLeave={e => e.currentTarget.style.background = "#0c1018"}
                      onClick={() => { setSel({ folio: prop.folio, address: prop.address, community: prop.community, wf_type: prop.wf_type, assessed: prop.assessed, last_sale_price: prop.last_sale_price, flood_zone: prop.flood_zone, owner: prop.owner }); setTab("records"); }}
                    >
                      {/* Card header */}
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10, flexWrap:"wrap", gap:8 }}>
                        <div>
                          <div style={{ fontSize:9, color, fontWeight:600, letterSpacing:0.8, textTransform:"uppercase", marginBottom:4 }}>{SEV_LABEL[sev]}</div>
                          <div style={{ fontSize:13, color:"#d0d8e4", fontWeight:500 }}>{prop.address || "—"}</div>
                          <div style={{ fontSize:10, color:"#6a88a8", marginTop:3 }}>{prop.community}{prop.wf_type ? ` · ${prop.wf_type}` : ""}</div>
                        </div>
                        <div style={{ textAlign:"right", flexShrink:0 }}>
                          <div style={{ fontSize:16, fontWeight:600, color:"#d0d8e4", lineHeight:1 }}>{fmtM(prop.assessed)}</div>
                          <div style={{ fontSize:9, color:"#5a7090", marginTop:3 }}>Assessed value</div>
                          <div style={{ fontSize:9, color:"#5a7090", marginTop:1 }}>{prop.folio}</div>
                        </div>
                      </div>

                      {/* Legal alert tags */}
                      {prop.alerts.length > 0 && (
                        <div style={{ marginBottom: prop.complaints.length ? 8 : 0 }}>
                          <div style={{ fontSize:9, color:"#5a7090", fontWeight:600, letterSpacing:0.5, textTransform:"uppercase", marginBottom:5 }}>Legal Records</div>
                          <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                            {prop.alerts.map((a, i) => {
                              const ac = SEV_COLOR[a.severity] || "#7a90a8";
                              return (
                                <span key={i} style={{ background:ac+"14", border:`1px solid ${ac}28`, borderRadius:2, padding:"2px 8px", fontSize:9, color:ac, fontWeight:500 }}>
                                  {DOC_LABEL[a.doc_type] || a.doc_type} · {a.rec_date}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Complaint rows */}
                      {prop.complaints.length > 0 && (
                        <div style={{ borderTop: prop.alerts.length ? "1px solid #1a2535" : "none", paddingTop: prop.alerts.length ? 8 : 0 }}>
                          <div style={{ fontSize:9, color:"#5a7090", fontWeight:600, letterSpacing:0.5, textTransform:"uppercase", marginBottom:5 }}>Foreclosure Complaints</div>
                          {prop.complaints.map((c, i) => {
                            const mc     = (c.meets_criteria || "").trim();
                            const mcYes  = /meets criteria/i.test(mc) && !/does not/i.test(mc);
                            const mcNo   = /does not meet/i.test(mc);
                            const mcColor = mcYes ? "#2a7a52" : mcNo ? "#c44040" : "#5a7090";
                            const mcBg    = mcYes ? "#2a7a5218" : mcNo ? "#c4404018" : "#1e2d4220";
                            return (
                              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", padding:"6px 10px", background:"#111820", borderRadius:2, marginBottom:4, flexWrap:"wrap", gap:6 }}>
                                <div>
                                  <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2 }}>
                                    <span style={{ fontSize:11, color:"#a8bcd4", fontWeight:500 }}>{c.plaintiff}</span>
                                    {mc && mc !== "-" && (
                                      <span style={{ fontSize:9, fontWeight:600, padding:"1px 7px", borderRadius:2, border:`1px solid ${mcColor}40`, color:mcColor, background:mcBg, letterSpacing:0.3, whiteSpace:"nowrap" }}>
                                        {mcYes ? "✓ Meets Criteria" : mcNo ? "✗ Does Not Meet" : mc}
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ fontSize:10, color:"#6a88a8" }}>
                                    vs. {(c.defendant || "").split(";")[0].trim().slice(0, 70)}
                                  </div>
                                  {c.pdf_link && c.pdf_link !== "-" && (
                                    <a href={c.pdf_link} target="_blank" rel="noreferrer"
                                      onClick={e => e.stopPropagation()}
                                      style={{ fontSize:9, color:"#4a7fa5", textDecoration:"none", marginTop:4, display:"inline-block", fontWeight:500 }}>
                                      View filing →
                                    </a>
                                  )}
                                </div>
                                <div style={{ textAlign:"right", flexShrink:0 }}>
                                  <div style={{ fontSize:13, color:"#c44040", fontWeight:600 }}>{c.unpaid_balance !== "-" ? c.unpaid_balance : c.loan_amount}</div>
                                  <div style={{ fontSize:9, color:"#5a7090", marginTop:2 }}>{c.date_filed}</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ══ ANALYTICS ══════════════════════════════════════ */}
        {tab === "analytics" && <div style={{ display:"grid", gap:16 }}>

          {stats.loading && <div style={{ color:"#5a7090", fontSize:11, padding:24 }}>Loading…</div>}

          {/* By waterfront type */}
          {stats.by_type.length > 0 && <div>
            <div style={{ fontSize:10, color:"#5a7090", fontWeight:600, letterSpacing:0.8, textTransform:"uppercase", marginBottom:10 }}>By Waterfront Type</div>
            {stats.by_type.map(({ wf_type: t, cnt: count, avg_price, total_value, avg_water }) => {
              const pct = Math.round(count / stats.total_count * 100);
              return (
                <div key={t} style={{ background:"#0c1018", border:"1px solid #1a2535", borderLeft:`2px solid ${tc(t)}`, borderRadius:3, padding:"12px 16px", marginBottom:6 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8, flexWrap:"wrap", gap:6 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:13, fontWeight:600, color:"#d0d8e4" }}>{t}</span>
                      <span style={{ fontSize:10, color:"#5a7090" }}>{count.toLocaleString()} properties</span>
                    </div>
                    <div style={{ display:"flex", gap:16, fontSize:10, flexWrap:"wrap" }}>
                      <span style={{ color:"#8a9eb8" }}>Avg <span style={{ color:"#b88c3c", fontWeight:600 }}>{fmtM(avg_price)}</span></span>
                      <span style={{ color:"#8a9eb8" }}>Total <span style={{ color:"#d0d8e4", fontWeight:600 }}>{fmtM(total_value)}</span></span>
                      <span style={{ color:"#8a9eb8" }}>Frontage <span style={{ color:"#b88c3c", fontWeight:600 }}>{Math.round(avg_water)} ft avg</span></span>
                      <span style={{ color:tc(t), fontWeight:600 }}>{pct}%</span>
                    </div>
                  </div>
                  <div style={{ background:"#111820", borderRadius:2, overflow:"hidden" }}>
                    <div style={{ height:3, width:`${pct}%`, background:tc(t), opacity:0.6 }} />
                  </div>
                </div>
              );
            })}
          </div>}

          {/* Flood + Top 10 */}
          {(stats.by_flood.length > 0 || stats.top10.length > 0) && (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
              <div>
                <div style={{ fontSize:10, color:"#5a7090", fontWeight:600, letterSpacing:0.8, textTransform:"uppercase", marginBottom:10 }}>Flood Zone Exposure</div>
                {stats.by_flood.map(({ flood_zone: z, cnt: count, avg_price }) => (
                  <div key={z} style={{ background:"#0c1018", border:"1px solid #1a2535", borderLeft:`2px solid ${fc(z)}`, borderRadius:3, padding:"12px 16px", marginBottom:6, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div>
                      <div style={{ fontSize:13, fontWeight:600, color:"#d0d8e4" }}>Zone {z}</div>
                      <div style={{ fontSize:10, color:"#5a7090", marginTop:3 }}>
                        {z === "VE" ? "Coastal wave action" : z === "AE" ? "Base flood elevation" : "Minimal hazard"}
                      </div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:16, fontWeight:600, color:"#d0d8e4" }}>{count.toLocaleString()}</div>
                      <div style={{ fontSize:10, color:"#5a7090", marginTop:2 }}>{fmtM(avg_price)} avg</div>
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <div style={{ fontSize:10, color:"#5a7090", fontWeight:600, letterSpacing:0.8, textTransform:"uppercase", marginBottom:10 }}>Top 10 by Assessed Value</div>
                <div style={{ background:"#0c1018", border:"1px solid #1a2535", borderRadius:3, overflow:"hidden" }}>
                  {stats.top10.map((p, i) => (
                    <div key={p.folio}
                      onClick={() => { setSel(p); setTab("records"); }}
                      style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"9px 14px", borderBottom:"1px solid #111820", cursor:"pointer", transition:"background .12s" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#0f1820"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <span style={{ fontSize:10, color:"#5a7090", fontWeight:600, width:16, flexShrink:0 }}>{i + 1}</span>
                        <div>
                          <div style={{ fontSize:11, color:"#a8bcd4", fontWeight:500 }}>{p.address}</div>
                          <div style={{ fontSize:9, color:"#5a7090", marginTop:2 }}>{p.community} · {p.water_feet} ft frontage</div>
                        </div>
                      </div>
                      <div style={{ fontSize:13, color:"#d0d8e4", fontWeight:600, flexShrink:0, marginLeft:8 }}>{fmtM(p.assessed)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Community rankings */}
          {stats.by_comm.length > 0 && <div>
            <div style={{ fontSize:10, color:"#5a7090", fontWeight:600, letterSpacing:0.8, textTransform:"uppercase", marginBottom:10 }}>
              All {stats.by_comm.length} Waterfront Communities
            </div>
            <div style={{ border:"1px solid #1a2535", borderRadius:3, overflow:"hidden" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
                <thead>
                  <tr style={{ background:"#0c1018", borderBottom:"1px solid #1a2535" }}>
                    {["Community","Type","Properties","Avg Value","Peak Value","Flood"].map(h => (
                      <th key={h} style={{ textAlign:"left", padding:"8px 12px", fontSize:9, fontWeight:600, color:"#5a7090", letterSpacing:0.8, textTransform:"uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stats.by_comm.map(({ community: c, wf_type, cnt: count, avg_price, max_price, flood }, i) => (
                    <tr key={c} style={{ borderBottom:"1px solid #111820", background: i % 2 === 0 ? "transparent" : "#0a0e14" }}>
                      <td style={{ padding:"7px 12px", color:"#a8bcd4", fontWeight:500 }}>{c}</td>
                      <td style={{ padding:"7px 12px" }}><Pill label={wf_type} color={tc(wf_type)} /></td>
                      <td style={{ padding:"7px 12px", color:"#7a90a8" }}>{count.toLocaleString()}</td>
                      <td style={{ padding:"7px 12px", color:"#b88c3c", fontWeight:600 }}>{fmtM(avg_price)}</td>
                      <td style={{ padding:"7px 12px", color:"#d0d8e4", fontWeight:600 }}>{fmtM(max_price)}</td>
                      <td style={{ padding:"7px 12px" }}><Pill label={flood || "—"} color={fc(flood)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>}
        </div>}

        {/* ══ PIPELINE ══════════════════════════════════════ */}
        {tab === "pipeline" && <div style={{ display:"grid", gap:10 }}>
          <Pipeline
            stage={pipeline.pStage} progress={pipeline.pProg}
            running={pipeline.pRunning} lastRun={pipeline.lastRun}
            onTrigger={pipeline.triggerPipeline}
          />

          <div style={{ fontSize:10, color:"#5a7090", fontWeight:600, letterSpacing:0.8, textTransform:"uppercase", margin:"6px 0 2px" }}>Data Ingestion Architecture</div>

          {PIPELINE_STEPS.map(({ n, t, c, d, api }) => (
            <div key={n} style={{ background:"#0c1018", border:"1px solid #1a2535", borderLeft:`2px solid ${c}`, borderRadius:3, padding:"12px 16px" }}>
              <div style={{ display:"flex", gap:14 }}>
                <div style={{ fontSize:11, color:c, opacity:.5, flexShrink:0, fontWeight:600, minWidth:22 }}>{n}</div>
                <div>
                  <div style={{ fontSize:12, fontWeight:600, color:"#d0d8e4", marginBottom:5 }}>{t}</div>
                  <div style={{ fontSize:10, color:"#7a90a8", lineHeight:1.7, marginBottom:6 }}>{d}</div>
                  <div style={{ fontSize:9, color:"#5a7090", background:"#070b0f", padding:"4px 8px", borderRadius:2, fontFamily:"'SF Mono','Fira Code',monospace", wordBreak:"break-all" }}>{api}</div>
                </div>
              </div>
            </div>
          ))}

          <div style={{ background:"#0c1018", border:"1px solid #1a2535", borderRadius:3, padding:"14px 16px" }}>
            <div style={{ fontSize:10, color:"#5a7090", fontWeight:600, letterSpacing:0.8, textTransform:"uppercase", marginBottom:10 }}>Quick Start</div>
            {CODE_SNIPPET.map((row, i) => (
              <div key={i} style={{ fontSize:10, color:row.c === "#2d5070" ? "#5a7090" : row.c === "#38bdf8" ? "#4a7fa5" : row.c === "#10b981" ? "#2a7a52" : "#6a5acd", fontFamily:"'SF Mono','Fira Code',monospace", lineHeight:2.1 }}>{row.t}</div>
            ))}
          </div>
        </div>}
      </div>

      <Detail prop={sel} onClose={() => setSel(null)} />
    </div>
  );
}
