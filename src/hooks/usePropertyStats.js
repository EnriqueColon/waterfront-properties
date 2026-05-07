import { useState, useEffect } from "react";
import { API_BASE } from "../constants/index.js";

const EMPTY = {
  total_count: 0, total_value: 0, max_sale: 0, avg_water: 0,
  by_type: [], by_flood: [], top10: [], by_comm: [], last_run: null,
};

export function usePropertyStats() {
  const [stats,   setStats]   = useState(EMPTY);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    fetch(`${API_BASE}/api/stats`)
      .then(r => r.json())
      .then(d => { setStats(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    // Re-fetch stats every 30 s so they update when the pipeline finishes
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, []);

  return { ...stats, loading };
}
