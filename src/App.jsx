import { useState } from "react";
import { Pipeline }    from "./components/Pipeline.jsx";
import { Stat }        from "./components/Stat.jsx";
import { Detail }      from "./components/Detail.jsx";
import { Pill }        from "./components/Pill.jsx";
import { SortButton }  from "./components/SortButton.jsx";
import { usePipeline }                       from "./hooks/usePipeline.js";
import { useFilteredProperties, PAGE_SIZE }  from "./hooks/useFilteredProperties.js";
import { usePropertyStats }                  from "./hooks/usePropertyStats.js";
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
  const stats    = usePropertyStats(pipeline.pRunning);
  const { flagged, counts: flagCounts, loading: flagLoading, reload: reloadFlagged } = useFlagged(tab);

  // Derive community list from real stats data
  const communityNames = stats.by_comm.map(c => c.community);

  return (
    <div style={{ fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,sans-serif", background:"#f1f5f9", minHeight:"100vh", color:"#0f172a", display:"flex", flexDirection:"column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;height:4px;}
        ::-webkit-scrollbar-track{background:#f1f5f9;}
        ::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:2px;}
        .tr{cursor:pointer;transition:background .12s;}
        .tr:hover{background:#f1f5f9!important;}
        select,input{background:#fff;border:1px solid #cbd5e1;color:#1e293b;font-family:inherit;font-size:12px;padding:6px 10px;border-radius:4px;outline:none;}
        select:focus,input:focus{border-color:#b88c3c;}
        input::placeholder{color:#94a3b8;}
        .tab{background:none;border:none;cursor:pointer;font-family:inherit;font-size:12px;font-weight:500;letter-spacing:0.3px;padding:10px 16px;border-bottom:2px solid transparent;transition:all .18s;color:#64748b;}
        .tab.on{border-bottom-color:#b88c3c;color:#0f172a;}
        .tab:hover:not(.on){color:#334155;}
        .xbtn{background:none;border:1px solid #cbd5e1;color:#64748b;font-family:inherit;font-size:11px;font-weight:500;padding:5px 12px;border-radius:4px;cursor:pointer;letter-spacing:0.3px;transition:all .18s;}
        .xbtn:hover{border-color:#b88c3c;color:#b88c3c;}
        .xbtn:disabled{opacity:.35;cursor:not-allowed;}
      `}</style>

      {/* ── Header ── */}
      <div style={{ borderBottom:"1px solid #e2e8f0", padding:"14px 24px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8, background:"#ffffff", position:"sticky", top:0, zIndex:200, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
        <div>
          <div style={{ fontSize:14, fontWeight:600, letterSpacing:0.3, color:"#0f172a", lineHeight:1 }}>
            Miami-Dade Waterfront
            <span style={{ fontWeight:300, color:"#64748b", marginLeft:10, fontSize:12 }}>Asset Intelligence</span>
          </div>
          <div style={{ fontSize:10, color:"#94a3b8", letterSpacing:0.5, marginTop:5 }}>
            {stats.error ? "Backend unavailable · " : stats.total_count > 0 ? `${stats.total_count.toLocaleString()} properties · ` : "Connecting… · "}
            MDC Property Appraiser · Live data
          </div>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <span style={{ fontSize:10, fontWeight:500, padding:"4px 10px", borderRadius:2, border:"1px solid #2a7a5230", color:"#2a7a52", background:"#2a7a5210", letterSpacing:0.3 }}>
            {pipeline.pRunning ? "Syncing…" : "Live"}
          </span>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div style={{ borderBottom:"1px solid #e2e8f0", display:"flex", padding:"0 24px", background:"#ffffff" }}>
        {TABS.map(([t, l]) => (
          <button key={t} className={`tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
            {t === "flagged" && (flagCounts.red + flagCounts.orange + flagCounts.complaint) > 0
              ? <>{l} <span style={{ marginLeft:5, background:"#fee2e2", color:"#c44040", border:"1px solid #fca5a5", borderRadius:10, fontSize:9, fontWeight:600, padding:"1px 6px" }}>{flagCounts.red + flagCounts.orange + flagCounts.complaint}</span></>
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
            enrichment={pipeline.enrichment}
            onTriggerEnrichment={pipeline.triggerEnrichment}
          />

          {stats.error && (
            <div style={{ marginBottom:12, padding:"10px 14px", background:"#fff7ed", border:"1px solid #fed7aa", borderRadius:6, fontSize:12, color:"#9a3412", display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontWeight:600 }}>Backend unavailable</span>
              — stats are not loading. Make sure the Flask server is running:
              <code style={{ background:"#fef3c7", padding:"1px 6px", borderRadius:3, fontFamily:"monospace" }}>python backend/ingestor.py</code>
            </div>
          )}

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
            <span style={{ fontSize:11, color:"#64748b", fontWeight:500 }}>
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
          <div style={{ border:"1px solid #e2e8f0", borderRadius:6, overflowX:"auto", marginBottom:12, opacity: filters.loading ? 0.6 : 1, transition:"opacity .2s", boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                {/* Column label + sort row */}
                <tr style={{ background:"#f8fafc", borderBottom:"1px solid #edf2f7" }}>
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
                    <th key={l} style={{ textAlign:"left", padding:"9px 12px 5px", color:"#94a3b8", letterSpacing:0.8, textTransform:"uppercase", fontSize:10, fontWeight:600, whiteSpace:"nowrap" }}>
                      {l}{c && <SortButton col={c} sort={filters.sort} order={filters.order} onSort={filters.toggleSort} />}
                    </th>
                  ))}
                </tr>
                {/* Per-column filter row */}
                <tr style={{ background:"#f8fafc", borderBottom:"2px solid #e2e8f0" }}>
                  {/* Address / search */}
                  <td style={{ padding:"5px 8px 8px" }}>
                    <input
                      style={{ width:"100%", minWidth:140, padding:"5px 8px", fontSize:11 }}
                      placeholder="Address, owner, folio…"
                      value={filters.search}
                      onChange={e => filters.setSearch(e.target.value)}
                    />
                  </td>
                  {/* Community */}
                  <td style={{ padding:"5px 8px 8px" }}>
                    <select style={{ width:"100%", minWidth:110, padding:"5px 8px", fontSize:11 }} value={filters.commF} onChange={e => filters.setCommF(e.target.value)}>
                      <option value="">All</option>
                      {communityNames.map(n => <option key={n}>{n}</option>)}
                    </select>
                  </td>
                  {/* Type */}
                  <td style={{ padding:"5px 8px 8px" }}>
                    <select style={{ width:"100%", minWidth:90, padding:"5px 8px", fontSize:11 }} value={filters.typeF} onChange={e => filters.setTypeF(e.target.value)}>
                      <option value="">All</option>
                      {WF_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </td>
                  {/* SqFt min/max */}
                  <td style={{ padding:"5px 8px 8px" }}>
                    <div style={{ display:"flex", gap:3 }}>
                      <input type="number" style={{ width:64, padding:"5px 6px", fontSize:11 }} placeholder="Min" value={filters.sqftMin} onChange={e => filters.setSqftMin(e.target.value)} />
                      <input type="number" style={{ width:64, padding:"5px 6px", fontSize:11 }} placeholder="Max" value={filters.sqftMax} onChange={e => filters.setSqftMax(e.target.value)} />
                    </div>
                  </td>
                  {/* Waterfront min/max */}
                  <td style={{ padding:"5px 8px 8px" }}>
                    <div style={{ display:"flex", gap:3 }}>
                      <input type="number" style={{ width:58, padding:"5px 6px", fontSize:11 }} placeholder="Min ft" value={filters.waterMin} onChange={e => filters.setWaterMin(e.target.value)} />
                      <input type="number" style={{ width:58, padding:"5px 6px", fontSize:11 }} placeholder="Max ft" value={filters.waterMax} onChange={e => filters.setWaterMax(e.target.value)} />
                    </div>
                  </td>
                  {/* Beds min */}
                  <td style={{ padding:"5px 8px 8px" }}>
                    <input type="number" style={{ width:72, padding:"5px 8px", fontSize:11 }} placeholder="Min beds" value={filters.bedsMin} onChange={e => filters.setBedsMin(e.target.value)} />
                  </td>
                  {/* Assessed (price range) */}
                  <td style={{ padding:"5px 8px 8px" }}>
                    <select style={{ width:"100%", minWidth:110, padding:"5px 8px", fontSize:11 }} value={filters.priceF} onChange={e => filters.setPriceF(+e.target.value)}>
                      {PRICE_RANGES.map((r, i) => <option key={r.label} value={i}>{r.label}</option>)}
                    </select>
                  </td>
                  {/* Last Sale — no filter */}
                  <td style={{ padding:"5px 8px 8px" }} />
                  {/* Land — no filter */}
                  <td style={{ padding:"5px 8px 8px" }} />
                  {/* Flood zone */}
                  <td style={{ padding:"5px 8px 8px" }}>
                    <select style={{ width:"100%", minWidth:80, padding:"5px 8px", fontSize:11 }} value={filters.floodF} onChange={e => filters.setFloodF(e.target.value)}>
                      <option value="">All</option>
                      {FLOOD_ZONES.map(z => <option key={z} value={z}>Zone {z}</option>)}
                    </select>
                  </td>
                  {/* Year built min/max */}
                  <td style={{ padding:"5px 8px 8px" }}>
                    <div style={{ display:"flex", gap:3 }}>
                      <input type="number" style={{ width:56, padding:"5px 6px", fontSize:11 }} placeholder="From" value={filters.yearMin} onChange={e => filters.setYearMin(e.target.value)} />
                      <input type="number" style={{ width:56, padding:"5px 6px", fontSize:11 }} placeholder="To" value={filters.yearMax} onChange={e => filters.setYearMax(e.target.value)} />
                    </div>
                  </td>
                </tr>
              </thead>
              <tbody>
                {filters.data.map((p, i) => (
                  <tr key={p.folio} className="tr"
                    onClick={() => setSel(sel?.folio === p.folio ? null : p)}
                    style={{ borderBottom:"1px solid #f1f5f9", background: sel?.folio === p.folio ? "#eff6ff" : "transparent" }}>
                    <td style={{ padding:"10px 12px" }}>
                      <div style={{ color:"#1e293b", fontSize:13, fontWeight:500 }}>{p.address}</div>
                      <div style={{ fontSize:11, color:"#94a3b8", marginTop:2 }}>{p.folio}</div>
                    </td>
                    <td style={{ padding:"10px 12px", color:"#475569", fontSize:12, whiteSpace:"nowrap" }}>{p.community}</td>
                    <td style={{ padding:"10px 12px" }}><Pill label={p.wf_type} color={tc(p.wf_type)} /></td>
                    <td style={{ padding:"10px 12px", color:"#64748b", fontSize:12 }}>{p.sqft ? fmtN(p.sqft) : "—"}</td>
                    <td style={{ padding:"10px 12px", color:"#b88c3c", fontWeight:600, fontSize:12 }}>{p.water_feet ? `${p.water_feet} ft` : "—"}</td>
                    <td style={{ padding:"10px 12px", color:"#64748b", fontSize:12 }}>{p.beds || p.baths ? `${p.beds ?? "—"} / ${p.baths ?? "—"}` : "—"}</td>
                    <td style={{ padding:"10px 12px", color:"#0f172a", fontWeight:600, fontSize:13 }}>{fmtM(p.assessed)}</td>
                    <td style={{ padding:"10px 12px" }}>
                      {p.last_sale_price
                        ? <><div style={{ color:"#b88c3c", fontWeight:600, fontSize:13 }}>{fmtM(p.last_sale_price)}</div>
                            <div style={{ fontSize:11, color:"#94a3b8", marginTop:2 }}>{p.last_sale_date}</div></>
                        : <span style={{ color:"#94a3b8", fontSize:12 }}>—</span>}
                    </td>
                    <td style={{ padding:"10px 12px", color:"#64748b", fontSize:12 }}>{fmtM(p.land_value)}</td>
                    <td style={{ padding:"10px 12px" }}><Pill label={p.flood_zone || "—"} color={fc(p.flood_zone)} /></td>
                    <td style={{ padding:"10px 12px", color:"#64748b", fontSize:12 }}>{p.year_built || "—"}</td>
                  </tr>
                ))}
                {!filters.loading && filters.data.length === 0 && (
                  <tr><td colSpan={11} style={{ padding:"40px", textAlign:"center", color:"#94a3b8", fontSize:13 }}>
                    {filters.error ? `API error: ${filters.error}` : "No properties match your filters"}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display:"flex", justifyContent:"center", alignItems:"center", gap:10, fontSize:11, marginBottom:4 }}>
            <button className="xbtn" onClick={() => filters.setPage(p => Math.max(0, p - 1))} disabled={filters.page === 0 || filters.loading}>← Previous</button>
            <span style={{ color:"#64748b", fontWeight:500 }}>
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
                  <div key={key} style={{ background:"#ffffff", border:"1px solid #e2e8f0", borderLeft:`3px solid ${color}`, borderRadius:6, padding:"14px 18px", boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
                    <div style={{ fontSize:24, fontWeight:600, color:"#0f172a", lineHeight:1, marginBottom:6 }}>{flagCounts[key] || 0}</div>
                    <div style={{ fontSize:11, color:"#64748b", fontWeight:500 }}>{label}</div>
                  </div>
                ))}
              </div>

              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                <div style={{ fontSize:11, color:"#64748b", fontWeight:500 }}>{flagged.length} flagged properties</div>
                <button className="xbtn" onClick={reloadFlagged} disabled={flagLoading}>Refresh</button>
              </div>

              {flagLoading && <div style={{ color:"#64748b", fontSize:13, padding:32, textAlign:"center" }}>Loading…</div>}

              {!flagLoading && flagged.length === 0 && (
                <div style={{ color:"#64748b", fontSize:13, padding:40, textAlign:"center", border:"1px solid #e2e8f0", borderRadius:6 }}>
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
                      style={{ background:"#ffffff", border:"1px solid #e2e8f0", borderLeft:`3px solid ${color}`, borderRadius:6, padding:"14px 16px", cursor:"pointer", transition:"background .12s", boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                      onMouseLeave={e => e.currentTarget.style.background = "#ffffff"}
                      onClick={() => { setSel({ folio: prop.folio, address: prop.address, community: prop.community, wf_type: prop.wf_type, assessed: prop.assessed, last_sale_price: prop.last_sale_price, flood_zone: prop.flood_zone, owner: prop.owner }); setTab("records"); }}
                    >
                      {/* Card header */}
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10, flexWrap:"wrap", gap:8 }}>
                        <div>
                          <div style={{ fontSize:10, color, fontWeight:600, letterSpacing:0.8, textTransform:"uppercase", marginBottom:4 }}>{SEV_LABEL[sev]}</div>
                          <div style={{ fontSize:14, color:"#0f172a", fontWeight:500 }}>{prop.address || "—"}</div>
                          <div style={{ fontSize:11, color:"#64748b", marginTop:3 }}>{prop.community}{prop.wf_type ? ` · ${prop.wf_type}` : ""}</div>
                        </div>
                        <div style={{ textAlign:"right", flexShrink:0 }}>
                          <div style={{ fontSize:18, fontWeight:600, color:"#0f172a", lineHeight:1 }}>{fmtM(prop.assessed)}</div>
                          <div style={{ fontSize:10, color:"#94a3b8", marginTop:3 }}>Assessed value</div>
                          <div style={{ fontSize:10, color:"#94a3b8", marginTop:1 }}>{prop.folio}</div>
                        </div>
                      </div>

                      {/* Legal alert tags */}
                      {prop.alerts.length > 0 && (
                        <div style={{ marginBottom: prop.complaints.length ? 8 : 0 }}>
                          <div style={{ fontSize:10, color:"#94a3b8", fontWeight:600, letterSpacing:0.5, textTransform:"uppercase", marginBottom:5 }}>Legal Records</div>
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
                        <div style={{ borderTop: prop.alerts.length ? "1px solid #e2e8f0" : "none", paddingTop: prop.alerts.length ? 8 : 0 }}>
                          <div style={{ fontSize:10, color:"#94a3b8", fontWeight:600, letterSpacing:0.5, textTransform:"uppercase", marginBottom:5 }}>Foreclosure Complaints</div>
                          {prop.complaints.map((c, i) => {
                            const mc     = (c.meets_criteria || "").trim();
                            const mcYes  = /meets criteria/i.test(mc) && !/does not/i.test(mc);
                            const mcNo   = /does not meet/i.test(mc);
                            const mcColor = mcYes ? "#16a34a" : mcNo ? "#dc2626" : "#64748b";
                            const mcBg    = mcYes ? "#dcfce7" : mcNo ? "#fee2e2" : "#f1f5f9";
                            return (
                              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", padding:"8px 12px", background:"#f8fafc", borderRadius:4, marginBottom:4, flexWrap:"wrap", gap:6, border:"1px solid #f1f5f9" }}>
                                <div>
                                  <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2 }}>
                                    <span style={{ fontSize:12, color:"#1e293b", fontWeight:500 }}>{c.plaintiff}</span>
                                    {mc && mc !== "-" && (
                                      <span style={{ fontSize:9, fontWeight:600, padding:"1px 7px", borderRadius:2, border:`1px solid ${mcColor}40`, color:mcColor, background:mcBg, letterSpacing:0.3, whiteSpace:"nowrap" }}>
                                        {mcYes ? "✓ Meets Criteria" : mcNo ? "✗ Does Not Meet" : mc}
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ fontSize:11, color:"#64748b" }}>
                                    vs. {(c.defendant || "").split(";")[0].trim().slice(0, 70)}
                                  </div>
                                  {c.pdf_link && c.pdf_link !== "-" && (
                                    <a href={c.pdf_link} target="_blank" rel="noreferrer"
                                      onClick={e => e.stopPropagation()}
                                      style={{ fontSize:11, color:"#3b82f6", textDecoration:"none", marginTop:4, display:"inline-block", fontWeight:500 }}>
                                      View filing →
                                    </a>
                                  )}
                                </div>
                                <div style={{ textAlign:"right", flexShrink:0 }}>
                                  <div style={{ fontSize:14, color:"#dc2626", fontWeight:600 }}>{c.unpaid_balance !== "-" ? c.unpaid_balance : c.loan_amount}</div>
                                  <div style={{ fontSize:11, color:"#94a3b8", marginTop:2 }}>{c.date_filed}</div>
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

          {stats.loading && <div style={{ color:"#64748b", fontSize:13, padding:24 }}>Loading…</div>}

          {/* By waterfront type */}
          {stats.by_type.length > 0 && <div>
            <div style={{ fontSize:11, color:"#94a3b8", fontWeight:600, letterSpacing:0.8, textTransform:"uppercase", marginBottom:10 }}>By Waterfront Type</div>
            {stats.by_type.map(({ wf_type: t, cnt: count, avg_price, total_value, avg_water }) => {
              const pct = Math.round(count / stats.total_count * 100);
              return (
                <div key={t} style={{ background:"#ffffff", border:"1px solid #e2e8f0", borderLeft:`3px solid ${tc(t)}`, borderRadius:6, padding:"12px 16px", marginBottom:6, boxShadow:"0 1px 2px rgba(0,0,0,0.04)" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8, flexWrap:"wrap", gap:6 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:14, fontWeight:600, color:"#0f172a" }}>{t}</span>
                      <span style={{ fontSize:11, color:"#94a3b8" }}>{count.toLocaleString()} properties</span>
                    </div>
                    <div style={{ display:"flex", gap:16, fontSize:12, flexWrap:"wrap" }}>
                      <span style={{ color:"#64748b" }}>Avg <span style={{ color:"#b88c3c", fontWeight:600 }}>{fmtM(avg_price)}</span></span>
                      <span style={{ color:"#64748b" }}>Total <span style={{ color:"#0f172a", fontWeight:600 }}>{fmtM(total_value)}</span></span>
                      <span style={{ color:"#64748b" }}>Frontage <span style={{ color:"#b88c3c", fontWeight:600 }}>{Math.round(avg_water)} ft avg</span></span>
                      <span style={{ color:tc(t), fontWeight:600 }}>{pct}%</span>
                    </div>
                  </div>
                  <div style={{ background:"#f1f5f9", borderRadius:2, overflow:"hidden" }}>
                    <div style={{ height:4, width:`${pct}%`, background:tc(t), opacity:0.7 }} />
                  </div>
                </div>
              );
            })}
          </div>}

          {/* Flood + Top 10 */}
          {(stats.by_flood.length > 0 || stats.top10.length > 0) && (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
              <div>
                <div style={{ fontSize:11, color:"#94a3b8", fontWeight:600, letterSpacing:0.8, textTransform:"uppercase", marginBottom:10 }}>Flood Zone Exposure</div>
                {stats.by_flood.map(({ flood_zone: z, cnt: count, avg_price }) => (
                  <div key={z} style={{ background:"#ffffff", border:"1px solid #e2e8f0", borderLeft:`3px solid ${fc(z)}`, borderRadius:6, padding:"12px 16px", marginBottom:6, display:"flex", justifyContent:"space-between", alignItems:"center", boxShadow:"0 1px 2px rgba(0,0,0,0.04)" }}>
                    <div>
                      <div style={{ fontSize:14, fontWeight:600, color:"#0f172a" }}>Zone {z}</div>
                      <div style={{ fontSize:11, color:"#94a3b8", marginTop:3 }}>
                        {z === "VE" ? "Coastal wave action" : z === "AE" ? "Base flood elevation" : "Minimal hazard"}
                      </div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:18, fontWeight:600, color:"#0f172a" }}>{count.toLocaleString()}</div>
                      <div style={{ fontSize:11, color:"#94a3b8", marginTop:2 }}>{fmtM(avg_price)} avg</div>
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <div style={{ fontSize:11, color:"#94a3b8", fontWeight:600, letterSpacing:0.8, textTransform:"uppercase", marginBottom:10 }}>Top 10 by Assessed Value</div>
                <div style={{ background:"#ffffff", border:"1px solid #e2e8f0", borderRadius:6, overflow:"hidden", boxShadow:"0 1px 2px rgba(0,0,0,0.04)" }}>
                  {stats.top10.map((p, i) => (
                    <div key={p.folio}
                      onClick={() => { setSel(p); setTab("records"); }}
                      style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 14px", borderBottom:"1px solid #f1f5f9", cursor:"pointer", transition:"background .12s" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <span style={{ fontSize:11, color:"#94a3b8", fontWeight:600, width:16, flexShrink:0 }}>{i + 1}</span>
                        <div>
                          <div style={{ fontSize:12, color:"#1e293b", fontWeight:500 }}>{p.address}</div>
                          <div style={{ fontSize:11, color:"#94a3b8", marginTop:2 }}>{p.community} · {p.water_feet} ft frontage</div>
                        </div>
                      </div>
                      <div style={{ fontSize:14, color:"#0f172a", fontWeight:600, flexShrink:0, marginLeft:8 }}>{fmtM(p.assessed)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Community rankings */}
          {stats.by_comm.length > 0 && <div>
            <div style={{ fontSize:11, color:"#94a3b8", fontWeight:600, letterSpacing:0.8, textTransform:"uppercase", marginBottom:10 }}>
              All {stats.by_comm.length} Waterfront Communities
            </div>
            <div style={{ border:"1px solid #e2e8f0", borderRadius:6, overflow:"hidden", boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                <thead>
                  <tr style={{ background:"#f8fafc", borderBottom:"1px solid #e2e8f0" }}>
                    {["Community","Type","Properties","Avg Value","Peak Value","Flood"].map(h => (
                      <th key={h} style={{ textAlign:"left", padding:"9px 12px", fontSize:10, fontWeight:600, color:"#94a3b8", letterSpacing:0.8, textTransform:"uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stats.by_comm.map(({ community: c, wf_type, cnt: count, avg_price, max_price, flood }, i) => (
                    <tr key={c} style={{ borderBottom:"1px solid #f1f5f9", background: i % 2 === 0 ? "transparent" : "#f8fafc" }}>
                      <td style={{ padding:"8px 12px", color:"#1e293b", fontWeight:500 }}>{c}</td>
                      <td style={{ padding:"8px 12px" }}><Pill label={wf_type} color={tc(wf_type)} /></td>
                      <td style={{ padding:"8px 12px", color:"#64748b" }}>{count.toLocaleString()}</td>
                      <td style={{ padding:"8px 12px", color:"#b88c3c", fontWeight:600 }}>{fmtM(avg_price)}</td>
                      <td style={{ padding:"8px 12px", color:"#0f172a", fontWeight:600 }}>{fmtM(max_price)}</td>
                      <td style={{ padding:"8px 12px" }}><Pill label={flood || "—"} color={fc(flood)} /></td>
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
            enrichment={pipeline.enrichment}
            onTriggerEnrichment={pipeline.triggerEnrichment}
          />

          <div style={{ fontSize:11, color:"#94a3b8", fontWeight:600, letterSpacing:0.8, textTransform:"uppercase", margin:"6px 0 2px" }}>Data Ingestion Architecture</div>

          {PIPELINE_STEPS.map(({ n, t, c, d, api }) => (
            <div key={n} style={{ background:"#ffffff", border:"1px solid #e2e8f0", borderLeft:`3px solid ${c}`, borderRadius:6, padding:"12px 16px", boxShadow:"0 1px 2px rgba(0,0,0,0.04)" }}>
              <div style={{ display:"flex", gap:14 }}>
                <div style={{ fontSize:12, color:c, opacity:.7, flexShrink:0, fontWeight:700, minWidth:22 }}>{n}</div>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:"#0f172a", marginBottom:5 }}>{t}</div>
                  <div style={{ fontSize:12, color:"#64748b", lineHeight:1.7, marginBottom:6 }}>{d}</div>
                  <div style={{ fontSize:11, color:"#94a3b8", background:"#f8fafc", padding:"5px 10px", borderRadius:4, fontFamily:"'SF Mono','Fira Code',monospace", wordBreak:"break-all", border:"1px solid #f1f5f9" }}>{api}</div>
                </div>
              </div>
            </div>
          ))}

          <div style={{ background:"#ffffff", border:"1px solid #e2e8f0", borderRadius:6, padding:"14px 16px", boxShadow:"0 1px 2px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize:11, color:"#94a3b8", fontWeight:600, letterSpacing:0.8, textTransform:"uppercase", marginBottom:10 }}>Quick Start</div>
            {CODE_SNIPPET.map((row, i) => (
              <div key={i} style={{ fontSize:12, color:row.c === "#2d5070" ? "#94a3b8" : row.c === "#38bdf8" ? "#2563eb" : row.c === "#10b981" ? "#16a34a" : "#7c3aed", fontFamily:"'SF Mono','Fira Code',monospace", lineHeight:2.1 }}>{row.t}</div>
            ))}
          </div>
        </div>}
      </div>

      <Detail prop={sel} onClose={() => setSel(null)} />
    </div>
  );
}
