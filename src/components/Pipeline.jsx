import { STAGES, STAGE_LABELS } from "../constants/index.js";

export function Pipeline({ stage, progress, running, lastRun, onTrigger }) {
  const ci = STAGES.indexOf(stage);

  return (
    <div style={{ background: "#040d1a", border: "1px solid #1e3a5f", borderRadius: 5, padding: "13px 16px", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 12, letterSpacing: 3, color: "#38bdf8" }}>
            MDCPA AUTO-INGEST PIPELINE
          </div>
          <div style={{ fontSize: 8, color: "#2d5070", marginTop: 2 }}>
            {running
              ? `● ${STAGE_LABELS[stage]}…`
              : lastRun
                ? `Last sync: ${new Date(lastRun.run_at).toLocaleString()} · ${lastRun.total?.toLocaleString()} properties · ${lastRun.duration_s}s · Auto-refreshes every 24h`
                : "Ready"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
          <span style={{
            fontSize: 7, padding: "3px 8px", borderRadius: 2, border: "1px solid", letterSpacing: 1,
            background: running ? "#f59e0b11" : "#10b98111",
            borderColor: running ? "#f59e0b44" : "#10b98144",
            color: running ? "#f59e0b" : "#10b981",
          }}>
            {running ? "⟳ RUNNING" : "● LIVE"}
          </span>
          <button
            onClick={onTrigger}
            disabled={running}
            style={{
              background: running ? "#1a3458" : "#0ea5e9",
              border: "none",
              color: running ? "#4a6080" : "#020b16",
              fontFamily: "inherit", fontSize: 8, fontWeight: 700, letterSpacing: 1.5,
              padding: "5px 11px", borderRadius: 3,
              cursor: running ? "not-allowed" : "pointer", textTransform: "uppercase",
            }}
          >
            {running ? "Running…" : "▶ Sync Now"}
          </button>
        </div>
      </div>

      <div style={{ background: "#0a1628", borderRadius: 3, height: 3, marginBottom: 10, overflow: "hidden" }}>
        <div style={{ height: 3, width: `${progress}%`, background: "linear-gradient(90deg,#0369a1,#38bdf8)", transition: "width .5s ease" }} />
      </div>

      <div style={{ display: "flex", alignItems: "center" }}>
        {STAGES.map((s, i) => {
          const done   = (!running && stage === "complete") || (running && ci > i);
          const active = running && stage === s;
          const col    = done ? "#10b981" : active ? "#38bdf8" : "#1e3a5f";
          return (
            <div key={s} style={{ display: "flex", alignItems: "center", flex: 1 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flex: 1 }}>
                <div style={{
                  width: 18, height: 18, borderRadius: "50%",
                  background: done ? "#10b98122" : active ? "#38bdf822" : "#0a1628",
                  border: `1.5px solid ${col}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 8, color: col,
                  boxShadow: active ? `0 0 7px ${col}55` : "none",
                  transition: "all .3s",
                }}>
                  {done ? "✓" : i + 1}
                </div>
                <div style={{ fontSize: 6, color: col, letterSpacing: .3, textAlign: "center", whiteSpace: "nowrap" }}>
                  {STAGE_LABELS[s]}
                </div>
              </div>
              {i < STAGES.length - 1 && (
                <div style={{ height: 1, width: 8, flexShrink: 0, background: done ? "#10b98155" : "#1e3a5f" }} />
              )}
            </div>
          );
        })}
      </div>

      {lastRun && (
        <div style={{ display: "flex", gap: 12, marginTop: 9, paddingTop: 7, borderTop: "1px solid #080e1a", fontSize: 7, color: "#2d5070", flexWrap: "wrap" }}>
          <span>SOURCE: <b style={{ color: lastRun.source === "live" ? "#10b981" : "#f59e0b" }}>{lastRun.source?.toUpperCase()}</b></span>
          <span>PROPERTIES: <b style={{ color: "#c8ddf5" }}>{lastRun.total?.toLocaleString()}</b></span>
          <span>NEW: <b style={{ color: "#10b981" }}>{lastRun.inserted?.toLocaleString()}</b></span>
          <span>UPDATED: <b style={{ color: "#a78bfa" }}>{lastRun.updated?.toLocaleString()}</b></span>
          <span>NEXT: <b style={{ color: "#38bdf8" }}>24h auto</b></span>
        </div>
      )}
    </div>
  );
}
