import { useState, useEffect } from "react";
import { Pill } from "./Pill.jsx";
import { fmtM, fmtN, tc, fc } from "../utils/format.js";
import { API_BASE } from "../constants/index.js";
import { usePropertyAlerts } from "../hooks/useAlerts.js";
import { usePropertyComplaints } from "../hooks/useComplaints.js";

const MULTI_TYPES = new Set(["Condo", "Multifamily", "Cooperative", "Retirement"]);

function useBuildingUnits(folio) {
  const [units,   setUnits]   = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!folio) return;
    const prefix = folio.slice(0, 10);
    setLoading(true);
    fetch(`${API_BASE}/api/building/${prefix}`)
      .then(r => r.json())
      .then(data => setUnits(Array.isArray(data) ? data : []))
      .catch(() => setUnits([]))
      .finally(() => setLoading(false));
  }, [folio]);

  return { units, loading };
}

const DOC_LABEL = {
  LP: "Lis Pendens", FC: "Foreclosure", CF: "Certificate of Foreclosure",
  JL: "Judgment Lien", TL: "Tax Lien", LN: "Lien", CL: "Code Lien",
  ML: "Mechanics Lien", PL: "Pending Lien", MT: "Mortgage",
};
const SEV_COLOR = { red: "#c44040", orange: "#c47830", yellow: "#b88c3c" };

function Section({ title, count, color = "#5a7090", open, onToggle, children }) {
  return (
    <div style={{ margin:"0 0 1px", borderTop:"1px solid #111820" }}>
      <button onClick={onToggle} style={{ width:"100%", background:"none", border:"none", cursor:"pointer", padding:"10px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", alignItems:"center", gap:7 }}>
          {color !== "#5a7090" && <span style={{ width:6, height:6, borderRadius:"50%", background:color, flexShrink:0 }} />}
          <span style={{ fontSize:10, fontWeight:600, color:"#a8bcd4", letterSpacing:0.3 }}>{title}</span>
          {count != null && <span style={{ fontSize:9, color:"#5a7090" }}>({count})</span>}
        </div>
        <span style={{ fontSize:10, color:"#5a7090" }}>{open ? "−" : "+"}</span>
      </button>
      {open && <div style={{ padding:"0 16px 12px" }}>{children}</div>}
    </div>
  );
}

export function Detail({ prop, onClose }) {
  const [expanded,       setExpanded]       = useState(false);
  const [alertsOpen,     setAlertsOpen]     = useState(true);
  const [complaintsOpen, setComplaintsOpen] = useState(true);

  const { units,      loading: loadingUnits      } = useBuildingUnits(prop?.folio);
  const { alerts,     loading: loadingAlerts     } = usePropertyAlerts(prop?.folio);
  const { complaints, loading: loadingComplaints } = usePropertyComplaints(prop?.folio);

  useEffect(() => { setExpanded(false); setAlertsOpen(true); setComplaintsOpen(true); }, [prop?.folio]);

  if (!prop) return null;

  const isMultiType   = MULTI_TYPES.has(prop.prop_type);
  const siblings      = units.filter(u => u.folio !== prop.folio);
  const showUnits     = isMultiType && siblings.length > 0;
  const isMultifamily = prop.prop_type === "Multifamily";

  const fields = [
    { l:"Assessed Value",  v: fmtM(prop.assessed),                                               bold: true },
    { l:"Land Value",      v: fmtM(prop.land_value) },
    { l:"Building Value",  v: fmtM(prop.building_value) },
    { l:"Property Type",   v: prop.prop_type || "—" },
    { l:"Building SqFt",  v: prop.sqft      ? `${fmtN(prop.sqft)} sf`      : "—" },
    { l:"Lot SqFt",        v: prop.lot_sqft  ? `${fmtN(prop.lot_sqft)} sf` : "N/A (Condo)" },
    { l:"Water Frontage",  v: prop.water_feet ? `${prop.water_feet} ft`     : "—", accent: true },
    { l:"Beds / Baths",    v: (prop.beds || prop.baths) ? `${prop.beds ?? "—"} / ${prop.baths ?? "—"}` : "—" },
    { l:"Year Built",      v: prop.year_built || "—" },
    { l:"Flood Zone",      v: prop.flood_zone ? `Zone ${prop.flood_zone}`   : "—" },
    { l:"Water Body",      v: prop.water_body || "—" },
    { l:"Owner of Record", v: prop.owner || "—" },
    { l:"Last Sale Price", v: prop.last_sale_price ? fmtM(prop.last_sale_price) : "No sale on record", gold: !!prop.last_sale_price },
    { l:"Last Sale Date",  v: prop.last_sale_date  || "—" },
  ];

  return (
    <div style={{
      position:"fixed", right:0, top:0, bottom:0, width:300,
      background:"#0a0e14", borderLeft:"1px solid #1a2535",
      overflowY:"auto", zIndex:400, display:"flex", flexDirection:"column",
      boxShadow:"-8px 0 32px #00000080",
      fontFamily:"'Inter',-apple-system,sans-serif",
    }}>

      {/* Header */}
      <div style={{ padding:"16px", borderBottom:"1px solid #111820", background:"#0c1018", position:"sticky", top:0 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
          <div style={{ fontSize:10, fontWeight:600, color:"#5a7090", letterSpacing:0.8, textTransform:"uppercase" }}>Property Detail</div>
          <button onClick={onClose} style={{ background:"none", border:"1px solid #1a2535", color:"#6a88a8", cursor:"pointer", width:22, height:22, borderRadius:2, fontSize:12, display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
        </div>
        <div style={{ fontSize:13, fontWeight:500, color:"#d0d8e4", lineHeight:1.4, marginBottom:4 }}>{prop.address}</div>
        <div style={{ fontSize:10, color:"#6a88a8", marginBottom:10 }}>{prop.community}</div>
        <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
          <Pill label={prop.wf_type}  color={tc(prop.wf_type)} />
          <Pill label={prop.prop_type || "Unknown"} color="#4a5e75" />
          {prop.flood_zone && <Pill label={`Zone ${prop.flood_zone}`} color={fc(prop.flood_zone)} />}
        </div>
      </div>

      {/* Assessed hero */}
      <div style={{ padding:"16px", borderBottom:"1px solid #111820" }}>
        <div style={{ fontSize:9, color:"#5a7090", fontWeight:600, letterSpacing:0.8, textTransform:"uppercase", marginBottom:6 }}>Assessed Value</div>
        <div style={{ fontSize:28, fontWeight:600, color:"#d0d8e4", lineHeight:1, letterSpacing:-0.5 }}>{fmtM(prop.assessed)}</div>
        {prop.land_value && prop.assessed && (
          <div style={{ fontSize:9, color:"#5a7090", marginTop:5 }}>
            Land {Math.round(prop.land_value / prop.assessed * 100)}% · Building {Math.round(prop.building_value / prop.assessed * 100)}%
          </div>
        )}
      </div>

      {/* Coordinates */}
      <div style={{ margin:"12px 16px", background:"#111820", borderRadius:3, padding:"10px 13px", border:"1px solid #1a2535", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontSize:9, color:"#5a7090", fontWeight:600, letterSpacing:0.5, marginBottom:4 }}>Coordinates</div>
          <div style={{ fontSize:10, color:"#8a9eb8", fontFamily:"'SF Mono','Fira Code',monospace" }}>
            {prop.lat?.toFixed(5)}° N, {Math.abs(prop.lng)?.toFixed(5)}° W
          </div>
        </div>
        <a href={`https://maps.google.com/?q=${prop.lat},${prop.lng}`} target="_blank" rel="noreferrer"
          style={{ fontSize:9, color:"#6a88a8", textDecoration:"none", fontWeight:500 }}>Maps →</a>
      </div>

      {/* Field list */}
      <div style={{ padding:"0 16px 4px" }}>
        {fields.map(({ l, v, bold, accent, gold }) => (
          <div key={l} style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", padding:"7px 0", borderBottom:"1px solid #0d1118" }}>
            <div style={{ fontSize:9, color:"#5a7090", fontWeight:500, flexShrink:0, paddingRight:10, maxWidth:"45%" }}>{l}</div>
            <div style={{ fontSize:10, fontWeight: bold || gold ? 600 : 400, color: gold ? "#b88c3c" : accent ? "#b88c3c" : bold ? "#d0d8e4" : "#8a9eb8", textAlign:"right", wordBreak:"break-word", maxWidth:"55%" }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Folio */}
      <div style={{ padding:"8px 16px", borderTop:"1px solid #111820" }}>
        <div style={{ fontSize:9, color:"#5a7090" }}>Folio <span style={{ fontFamily:"'SF Mono','Fira Code',monospace", color:"#6a88a8" }}>{prop.folio}</span></div>
      </div>

      {/* ── Units in Building ─────────────────────────── */}
      {isMultiType && (
        <div style={{ borderTop:"1px solid #111820" }}>
          {isMultifamily && siblings.length === 0 && !loadingUnits && (
            <div style={{ padding:"12px 16px" }}>
              <div style={{ fontSize:9, color:"#5a7090", fontWeight:600, letterSpacing:0.5, textTransform:"uppercase", marginBottom:5 }}>Rental Building</div>
              <div style={{ fontSize:9, color:"#5a7090", lineHeight:1.6 }}>
                Multifamily building — individual rental units don't carry separate folios in Miami-Dade.
              </div>
            </div>
          )}

          {showUnits && (
            <Section title="Units in this Building" count={siblings.length + 1} open={expanded} onToggle={() => setExpanded(e => !e)}>
              {/* Current unit */}
              <div style={{ background:"#12202e", border:"1px solid #1a2535", borderRadius:2, padding:"6px 10px", marginBottom:4 }}>
                <div style={{ fontSize:9, color:"#4a7fa5", fontWeight:600, marginBottom:2 }}>#{prop.folio.slice(-4)} — this unit</div>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:10 }}>
                  <span style={{ color:"#6a88a8" }}>{prop.beds ?? "—"} bd / {prop.baths ?? "—"} ba</span>
                  <span style={{ color:"#d0d8e4", fontWeight:600 }}>{fmtM(prop.assessed)}</span>
                </div>
              </div>
              {siblings.map(u => (
                <div key={u.folio} style={{ padding:"5px 10px", borderBottom:"1px solid #111820", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div>
                    <div style={{ fontSize:9, color:"#6a88a8" }}>#{u.folio.slice(-4)}</div>
                    <div style={{ fontSize:9, color:"#5a7090", marginTop:1 }}>{u.beds ?? "—"} bd / {u.baths ?? "—"} ba</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:10, color:"#8a9eb8", fontWeight:500 }}>{fmtM(u.assessed)}</div>
                    {u.last_sale_price && <div style={{ fontSize:9, color:"#b88c3c", marginTop:1 }}>{fmtM(u.last_sale_price)}</div>}
                  </div>
                </div>
              ))}
            </Section>
          )}
        </div>
      )}

      {/* ── Legal Encumbrances ─────────────────────────── */}
      {(alerts.length > 0 || loadingAlerts) && (
        <Section
          title="Legal Encumbrances"
          count={loadingAlerts ? null : alerts.length}
          color={alerts.some(a => a.severity === "red") ? "#c44040" : "#c47830"}
          open={alertsOpen}
          onToggle={() => setAlertsOpen(o => !o)}
        >
          {alerts.map((a, i) => {
            const color = SEV_COLOR[a.severity] || "#4a5e75";
            return (
              <div key={a.id} style={{ padding:"8px 0", borderBottom: i < alerts.length - 1 ? "1px solid #111820" : "none" }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                  <span style={{ fontSize:10, color, fontWeight:600 }}>{DOC_LABEL[a.doc_type] || a.doc_type}</span>
                  <span style={{ fontSize:9, color:"#5a7090" }}>{a.rec_date}</span>
                </div>
                {a.first_party  && <div style={{ fontSize:9, color:"#6a88a8" }}><span style={{ color:"#5a7090" }}>Grantor: </span>{a.first_party}</div>}
                {a.second_party && <div style={{ fontSize:9, color:"#6a88a8" }}><span style={{ color:"#5a7090" }}>Grantee: </span>{a.second_party}</div>}
                {a.book && <div style={{ fontSize:9, color:"#5a7090", marginTop:2 }}>Bk {a.book} / Pg {a.page}</div>}
              </div>
            );
          })}
          <div style={{ fontSize:9, color:"#5a7090", marginTop:6, lineHeight:1.5 }}>
            Source: MDC Clerk of Courts. Updated Fridays.{" "}
            <a href="https://www2.miamidadeclerk.gov/ocs/" target="_blank" rel="noreferrer" style={{ color:"#4a7fa5" }}>Verify →</a>
          </div>
        </Section>
      )}

      {/* ── Foreclosure Complaints ─────────────────────── */}
      {(complaints.length > 0 || loadingComplaints) && (
        <Section
          title="Foreclosure Complaints"
          count={loadingComplaints ? null : complaints.length}
          color="#c44040"
          open={complaintsOpen}
          onToggle={() => setComplaintsOpen(o => !o)}
        >
          {complaints.map((c, i) => (
            <div key={c.id} style={{ padding:"8px 0", borderBottom: i < complaints.length - 1 ? "1px solid #111820" : "none" }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                <span style={{ fontSize:10, color:"#a8bcd4", fontWeight:600 }}>{c.plaintiff}</span>
                <span style={{ fontSize:9, color:"#5a7090" }}>{c.date_filed}</span>
              </div>
              <div style={{ fontSize:9, color:"#6a88a8", marginBottom:4 }}>
                vs. {(c.defendant || "").split(";")[0].trim().slice(0, 60)}
              </div>
              {c.loan_amount && c.loan_amount !== "-" && (
                <div style={{ fontSize:9, color:"#5a7090" }}>
                  Loan <span style={{ color:"#8a9eb8" }}>{c.loan_amount}</span>
                  {c.loan_rate && c.loan_rate !== "-" ? <span style={{ color:"#5a7090" }}> @ {c.loan_rate}</span> : ""}
                </div>
              )}
              {c.unpaid_balance && c.unpaid_balance !== "-" && (
                <div style={{ fontSize:10, color:"#c44040", fontWeight:600, marginTop:3 }}>
                  Unpaid: {c.unpaid_balance}
                </div>
              )}
              {c.pdf_link && c.pdf_link !== "-" && (
                <a href={c.pdf_link} target="_blank" rel="noreferrer"
                  style={{ display:"inline-block", marginTop:5, fontSize:9, color:"#4a7fa5", textDecoration:"none", fontWeight:500 }}>
                  View filing →
                </a>
              )}
            </div>
          ))}
          <div style={{ fontSize:9, color:"#5a7090", marginTop:6 }}>Updated every Friday from Google Sheets.</div>
        </Section>
      )}

      {/* No-sale note */}
      {!prop.last_sale_price && (
        <div style={{ margin:"0 16px 12px", background:"#111820", borderRadius:3, padding:"10px 12px", border:"1px solid #1a2535" }}>
          <div style={{ fontSize:9, color:"#5a7090", fontWeight:600, letterSpacing:0.5, textTransform:"uppercase", marginBottom:5 }}>No Sale on Record</div>
          <div style={{ fontSize:9, color:"#5a7090", lineHeight:1.6 }}>
            No qualified arm's-length sale found with the Miami-Dade PA. Common for vacant lots, government land, conservation areas, or long-held private parcels.
          </div>
        </div>
      )}

      {/* Footer link */}
      <div style={{ padding:"12px 16px", borderTop:"1px solid #111820", marginTop:"auto" }}>
        <a href={`https://apps.miamidadepa.gov/propertysearch/#/?folio=${prop.folio}`}
          target="_blank" rel="noreferrer"
          style={{ display:"block", textAlign:"center", padding:"8px", background:"#111820", border:"1px solid #1a2535", borderRadius:3, color:"#4a7fa5", fontSize:10, textDecoration:"none", fontWeight:500 }}>
          MDCPA Property Search →
        </a>
      </div>
    </div>
  );
}
