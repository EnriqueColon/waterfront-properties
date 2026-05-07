export function Stat({ label, value, sub, accent = "#b88c3c" }) {
  return (
    <div style={{
      background: "#0c1018",
      border: "1px solid #1a2535",
      borderLeft: `2px solid ${accent}`,
      borderRadius: 3,
      padding: "12px 16px",
    }}>
      <div style={{ fontSize: 9, color: "#6a88a8", letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 500, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 17, fontWeight: 600, color: "#d0d8e4", letterSpacing: 0, lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 9, color: "#6a88a8", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}
