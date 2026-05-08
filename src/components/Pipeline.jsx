import { STAGES, STAGE_LABELS } from "../constants/index.js";

export function Pipeline({ stage, progress, running, lastRun, onTrigger }) {
  const ci = STAGES.indexOf(stage);

  return (
    <div style={{ background: "#f0f7ff", border: "1px solid #bfdbfe", borderRadius: 6, padding: "13px 16px", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 12, letterSpacing: 3, color: "#0369a1" }}>
            MDCPA AUTO-INGEST PIPELINE
          </div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
            {running
              ? `● ${STAGE_LABELS[stage]}…`
              : lastRun
                ? `Last sync: ${new Date(lastRun.run_at).toLocaleString()} · ${lastRun.total?.toLocaleString()} properties · ${lastRun.duration_s}s · Auto-refreshes every 24h`
                : "Ready"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
          <span style={{
            fontSize: 9, padding: "3px 8px", borderRadius: 3, border: "1px solid", letterSpacing: 1,
            background: running ? "#fef3c7" : "#dcfce7",
            borderColor: running ? "#fcd34d" : "#86efac",
            color: running ? "#b45309" : "#16a34a",
          }}>
            {running ? "⟳ RUNNING" : "● LIVE"}
          </span>
          <button
            onClick={onTrigger}
            disabled={running}
            style={{
              background: running ? "#e2e8f0" : "#0ea5e9",
              border: "none",
              color: running ? "#94a3b8" : "#ffffff",
              fontFamily: "inherit", fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
              padding: "5px 12px", borderRadius: 4,
              cursor: running ? "not-allowed" : "pointer", textTransform: "uppercase",
            }}
          >
            {running ? "Running…" : "▶ Sync Now"}
          </button>
        </div>
      </div>

      <div style={{ background: "#dbeafe", borderRadius: 3, height: 4, marginBottom: 10, overflow: "hidden" }}>
        <div style={{ height: 4, width: `${progress}%`, background: "linear-gradient(90deg,#0369a1,#38bdf8)", transition: "width .5s ease" }} />
      </div>

      <div style={{ display: "flex", alignItems: "center" }}>
        {STAGES.map((s, i) => {
          const done   = (!running && stage === "complete") || (running && ci > i);
          const active = running && stage === s;
          const col    = done ? "#16a34a" : active ? "#0ea5e9" : "#bfdbfe";
          return (
            <div key={s} style={{ display: "flex", alignItems: "center", flex: 1 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flex: 1 }}>
                <div style={{
                  width: 20, height: 20, borderRadius: "50%",
                  background: done ? "#dcfce7" : active ? "#e0f2fe" : "#f0f7ff",
                  border: `1.5px solid ${col}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 9, color: col,
                  boxShadow: active ? `0 0 7px ${col}66` : "none",
                  transition: "all .3s",
                }}>
                  {done ? "✓" : i + 1}
                </div>
                <div style={{ fontSize: 7, color: col, letterSpacing: .3, textAlign: "center", whiteSpace: "nowrap" }}>
                  {STAGE_LABELS[s]}
                </div>
              </div>
              {i < STAGES.length - 1 && (
                <div style={{ height: 1, width: 8, flexShrink: 0, background: done ? "#86efac" : "#bfdbfe" }} />
              )}
            </div>
          );
        })}
      </div>

      {lastRun && (
        <div style={{ display: "flex", gap: 12, marginTop: 9, paddingTop: 7, borderTop: "1px solid #dbeafe", fontSize: 9, color: "#64748b", flexWrap: "wrap" }}>
          <span>SOURCE: <b style={{ color: lastRun.source === "live" ? "#16a34a" : "#d97706" }}>{lastRun.source?.toUpperCase()}</b></span>
          <span>PROPERTIES: <b style={{ color: "#0f172a" }}>{lastRun.total?.toLocaleString()}</b></span>
          <span>NEW: <b style={{ color: "#16a34a" }}>{lastRun.inserted?.toLocaleString()}</b></span>
          <span>UPDATED: <b style={{ color: "#7c3aed" }}>{lastRun.updated?.toLocaleString()}</b></span>
          <span>NEXT: <b style={{ color: "#0369a1" }}>24h auto</b></span>
        </div>
      )}
    </div>
  );
}
