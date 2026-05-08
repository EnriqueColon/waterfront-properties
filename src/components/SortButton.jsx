export function SortButton({ col, sort, order, onSort }) {
  const active = sort === col;
  return (
    <button
      onClick={e => { e.stopPropagation(); onSort(col); }}
      style={{
        background: "none", border: "none", cursor: "pointer",
        color: active ? "#b88c3c" : "#cbd5e1",
        fontSize: 10, marginLeft: 3, padding: 0,
        verticalAlign: "middle",
      }}
    >
      {active ? (order === "desc" ? "↓" : "↑") : "↕"}
    </button>
  );
}
