export function Stat({ label, value, sub, accent = "#b88c3c" }) {
  return (
    <div style={{
      background: "#ffffff",
      border: "1px solid #e2e8f0",
      borderLeft: `3px solid ${accent}`,
      borderRadius: 6,
      padding: "14px 16px",
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    }}>
      <div style={{ fontSize: 10, color: "#94a3b8", letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, color: "#0f172a", letterSpacing: 0, lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 5 }}>{sub}</div>}
    </div>
  );
}
