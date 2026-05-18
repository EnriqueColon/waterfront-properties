import { useState, useEffect } from "react";
import { API_BASE } from "../constants/index.js";

const EMPTY = {
  total_count: 0, total_value: null, max_sale: null, avg_water: 0,
  by_type: [], by_flood: [], top10: [], by_comm: [], last_run: null,
};

export function usePropertyStats() {
  const [stats,   setStats]   = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  const refresh = () => {
    setLoading(true);
    fetch(`${API_BASE}/api/stats`)
      .then(r => r.json())
      .then(d => { setStats(d); setError(false); setLoading(false); })
      .catch(() => { setStats(EMPTY); setError(true); setLoading(false); });
  };

  useEffect(() => {
    refresh();
    // Re-fetch stats every 30 s so they update when the pipeline finishes
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, []);

  return { ...stats, loading, error };
}
