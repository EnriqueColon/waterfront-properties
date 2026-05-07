export function Pill({ label, color }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 7px",
      borderRadius: 2,
      fontSize: 9,
      fontWeight: 500,
      letterSpacing: 0.5,
      background: color + "18",
      color,
      border: `1px solid ${color}30`,
    }}>
      {label}
    </span>
  );
}
