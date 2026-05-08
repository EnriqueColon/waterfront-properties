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
const SEV_COLOR = { red: "#dc2626", orange: "#ea580c", yellow: "#b88c3c" };

function Section({ title, count, color = "#94a3b8", open, onToggle, children }) {
  return (
    <div style={{ margin:"0 0 1px", borderTop:"1px solid #f1f5f9" }}>
      <button onClick={onToggle} style={{ width:"100%", background:"none", border:"none", cursor:"pointer", padding:"10px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", alignItems:"center", gap:7 }}>
          {color !== "#94a3b8" && <span style={{ width:6, height:6, borderRadius:"50%", background:color, flexShrink:0 }} />}
          <span style={{ fontSize:11, fontWeight:600, color:"#334155", letterSpacing:0.3 }}>{title}</span>
          {count != null && <span style={{ fontSize:10, color:"#94a3b8" }}>({count})</span>}
        </div>
        <span style={{ fontSize:12, color:"#94a3b8" }}>{open ? "−" : "+"}</span>
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
      background:"#ffffff", borderLeft:"1px solid #e2e8f0",
      overflowY:"auto", zIndex:400, display:"flex", flexDirection:"column",
      boxShadow:"-4px 0 24px rgba(0,0,0,0.10)",
      fontFamily:"'Inter',-apple-system,sans-serif",
    }}>

      {/* Header */}
      <div style={{ padding:"16px", borderBottom:"1px solid #f1f5f9", background:"#f8fafc", position:"sticky", top:0 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
          <div style={{ fontSize:10, fontWeight:600, color:"#94a3b8", letterSpacing:0.8, textTransform:"uppercase" }}>Property Detail</div>
          <button onClick={onClose} style={{ background:"none", border:"1px solid #e2e8f0", color:"#64748b", cursor:"pointer", width:22, height:22, borderRadius:4, fontSize:14, display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
        </div>
        <div style={{ fontSize:14, fontWeight:600, color:"#0f172a", lineHeight:1.4, marginBottom:4 }}>{prop.address}</div>
        <div style={{ fontSize:11, color:"#64748b", marginBottom:10 }}>{prop.community}</div>
        <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
          <Pill label={prop.wf_type}  color={tc(prop.wf_type)} />
          <Pill label={prop.prop_type || "Unknown"} color="#64748b" />
          {prop.flood_zone && <Pill label={`Zone ${prop.flood_zone}`} color={fc(prop.flood_zone)} />}
        </div>
      </div>

      {/* Assessed hero */}
      <div style={{ padding:"16px", borderBottom:"1px solid #f1f5f9" }}>
        <div style={{ fontSize:10, color:"#94a3b8", fontWeight:600, letterSpacing:0.8, textTransform:"uppercase", marginBottom:6 }}>Assessed Value</div>
        <div style={{ fontSize:30, fontWeight:700, color:"#0f172a", lineHeight:1, letterSpacing:-0.5 }}>{fmtM(prop.assessed)}</div>
        {prop.land_value && prop.assessed && (
          <div style={{ fontSize:10, color:"#94a3b8", marginTop:5 }}>
            Land {Math.round(prop.land_value / prop.assessed * 100)}% · Building {Math.round(prop.building_value / prop.assessed * 100)}%
          </div>
        )}
      </div>

      {/* Coordinates */}
      <div style={{ margin:"12px 16px", background:"#f8fafc", borderRadius:6, padding:"10px 13px", border:"1px solid #e2e8f0", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontSize:9, color:"#94a3b8", fontWeight:600, letterSpacing:0.5, marginBottom:4 }}>Coordinates</div>
          <div style={{ fontSize:11, color:"#475569", fontFamily:"'SF Mono','Fira Code',monospace" }}>
            {prop.lat?.toFixed(5)}° N, {Math.abs(prop.lng)?.toFixed(5)}° W
          </div>
        </div>
        <a href={`https://maps.google.com/?q=${prop.lat},${prop.lng}`} target="_blank" rel="noreferrer"
          style={{ fontSize:10, color:"#3b82f6", textDecoration:"none", fontWeight:500 }}>Maps →</a>
      </div>

      {/* Field list */}
      <div style={{ padding:"0 16px 4px" }}>
        {fields.map(({ l, v, bold, accent, gold }) => (
          <div key={l} style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", padding:"7px 0", borderBottom:"1px solid #f8fafc" }}>
            <div style={{ fontSize:10, color:"#94a3b8", fontWeight:500, flexShrink:0, paddingRight:10, maxWidth:"45%" }}>{l}</div>
            <div style={{ fontSize:11, fontWeight: bold || gold ? 600 : 400, color: gold ? "#b88c3c" : accent ? "#b88c3c" : bold ? "#0f172a" : "#475569", textAlign:"right", wordBreak:"break-word", maxWidth:"55%" }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Folio */}
      <div style={{ padding:"8px 16px", borderTop:"1px solid #f1f5f9" }}>
        <div style={{ fontSize:10, color:"#94a3b8" }}>Folio <span style={{ fontFamily:"'SF Mono','Fira Code',monospace", color:"#64748b" }}>{prop.folio}</span></div>
      </div>

      {/* ── Units in Building ─────────────────────────── */}
      {isMultiType && (
        <div style={{ borderTop:"1px solid #f1f5f9" }}>
          {isMultifamily && siblings.length === 0 && !loadingUnits && (
            <div style={{ padding:"12px 16px" }}>
              <div style={{ fontSize:9, color:"#94a3b8", fontWeight:600, letterSpacing:0.5, textTransform:"uppercase", marginBottom:5 }}>Rental Building</div>
              <div style={{ fontSize:10, color:"#94a3b8", lineHeight:1.6 }}>
                Multifamily building — individual rental units don't carry separate folios in Miami-Dade.
              </div>
            </div>
          )}

          {showUnits && (
            <Section title="Units in this Building" count={siblings.length + 1} open={expanded} onToggle={() => setExpanded(e => !e)}>
              {/* Current unit */}
              <div style={{ background:"#eff6ff", border:"1px solid #bfdbfe", borderRadius:4, padding:"6px 10px", marginBottom:4 }}>
                <div style={{ fontSize:10, color:"#2563eb", fontWeight:600, marginBottom:2 }}>#{prop.folio.slice(-4)} — this unit</div>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:11 }}>
                  <span style={{ color:"#64748b" }}>{prop.beds ?? "—"} bd / {prop.baths ?? "—"} ba</span>
                  <span style={{ color:"#0f172a", fontWeight:600 }}>{fmtM(prop.assessed)}</span>
                </div>
              </div>
              {siblings.map(u => (
                <div key={u.folio} style={{ padding:"5px 10px", borderBottom:"1px solid #f1f5f9", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div>
                    <div style={{ fontSize:10, color:"#64748b" }}>#{u.folio.slice(-4)}</div>
                    <div style={{ fontSize:10, color:"#94a3b8", marginTop:1 }}>{u.beds ?? "—"} bd / {u.baths ?? "—"} ba</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:11, color:"#334155", fontWeight:500 }}>{fmtM(u.assessed)}</div>
                    {u.last_sale_price && <div style={{ fontSize:10, color:"#b88c3c", marginTop:1 }}>{fmtM(u.last_sale_price)}</div>}
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
          color={alerts.some(a => a.severity === "red") ? "#dc2626" : "#ea580c"}
          open={alertsOpen}
          onToggle={() => setAlertsOpen(o => !o)}
        >
          {alerts.map((a, i) => {
            const color = SEV_COLOR[a.severity] || "#64748b";
            return (
              <div key={a.id} style={{ padding:"8px 0", borderBottom: i < alerts.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                  <span style={{ fontSize:11, color, fontWeight:600 }}>{DOC_LABEL[a.doc_type] || a.doc_type}</span>
                  <span style={{ fontSize:10, color:"#94a3b8" }}>{a.rec_date}</span>
                </div>
                {a.first_party  && <div style={{ fontSize:10, color:"#64748b" }}><span style={{ color:"#94a3b8" }}>Grantor: </span>{a.first_party}</div>}
                {a.second_party && <div style={{ fontSize:10, color:"#64748b" }}><span style={{ color:"#94a3b8" }}>Grantee: </span>{a.second_party}</div>}
                {a.book && <div style={{ fontSize:10, color:"#94a3b8", marginTop:2 }}>Bk {a.book} / Pg {a.page}</div>}
              </div>
            );
          })}
          <div style={{ fontSize:10, color:"#94a3b8", marginTop:6, lineHeight:1.5 }}>
            Source: MDC Clerk of Courts. Updated Fridays.{" "}
            <a href="https://www2.miamidadeclerk.gov/ocs/" target="_blank" rel="noreferrer" style={{ color:"#3b82f6" }}>Verify →</a>
          </div>
        </Section>
      )}

      {/* ── Foreclosure Complaints ─────────────────────── */}
      {(complaints.length > 0 || loadingComplaints) && (
        <Section
          title="Foreclosure Complaints"
          count={loadingComplaints ? null : complaints.length}
          color="#dc2626"
          open={complaintsOpen}
          onToggle={() => setComplaintsOpen(o => !o)}
        >
          {complaints.map((c, i) => (
            <div key={c.id} style={{ padding:"8px 0", borderBottom: i < complaints.length - 1 ? "1px solid #f1f5f9" : "none" }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                <span style={{ fontSize:11, color:"#1e293b", fontWeight:600 }}>{c.plaintiff}</span>
                <span style={{ fontSize:10, color:"#94a3b8" }}>{c.date_filed}</span>
              </div>
              <div style={{ fontSize:10, color:"#64748b", marginBottom:4 }}>
                vs. {(c.defendant || "").split(";")[0].trim().slice(0, 60)}
              </div>
              {c.loan_amount && c.loan_amount !== "-" && (
                <div style={{ fontSize:10, color:"#94a3b8" }}>
                  Loan <span style={{ color:"#475569" }}>{c.loan_amount}</span>
                  {c.loan_rate && c.loan_rate !== "-" ? <span style={{ color:"#94a3b8" }}> @ {c.loan_rate}</span> : ""}
                </div>
              )}
              {c.unpaid_balance && c.unpaid_balance !== "-" && (
                <div style={{ fontSize:12, color:"#dc2626", fontWeight:600, marginTop:3 }}>
                  Unpaid: {c.unpaid_balance}
                </div>
              )}
              {c.pdf_link && c.pdf_link !== "-" && (
                <a href={c.pdf_link} target="_blank" rel="noreferrer"
                  style={{ display:"inline-block", marginTop:5, fontSize:10, color:"#3b82f6", textDecoration:"none", fontWeight:500 }}>
                  View filing →
                </a>
              )}
            </div>
          ))}
          <div style={{ fontSize:10, color:"#94a3b8", marginTop:6 }}>Updated every Friday from Google Sheets.</div>
        </Section>
      )}

      {/* No-sale note */}
      {!prop.last_sale_price && (
        <div style={{ margin:"0 16px 12px", background:"#f8fafc", borderRadius:6, padding:"10px 12px", border:"1px solid #e2e8f0" }}>
          <div style={{ fontSize:10, color:"#94a3b8", fontWeight:600, letterSpacing:0.5, textTransform:"uppercase", marginBottom:5 }}>No Sale on Record</div>
          <div style={{ fontSize:10, color:"#94a3b8", lineHeight:1.6 }}>
            No qualified arm's-length sale found with the Miami-Dade PA. Common for vacant lots, government land, conservation areas, or long-held private parcels.
          </div>
        </div>
      )}

      {/* Footer link */}
      <div style={{ padding:"12px 16px", borderTop:"1px solid #f1f5f9", marginTop:"auto" }}>
        <a href={`https://apps.miamidadepa.gov/propertysearch/#/?folio=${prop.folio}`}
          target="_blank" rel="noreferrer"
          style={{ display:"block", textAlign:"center", padding:"9px", background:"#f0f7ff", border:"1px solid #bfdbfe", borderRadius:6, color:"#2563eb", fontSize:11, textDecoration:"none", fontWeight:500 }}>
          MDCPA Property Search →
        </a>
      </div>
    </div>
  );
}
