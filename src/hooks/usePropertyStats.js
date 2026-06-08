import { useState, useEffect, useCallback } from "react";
import { API_BASE } from "../constants/index.js";

const EMPTY = {
  total_count: 0, total_value: null, max_sale: null, avg_water: 0,
  by_type: [], by_flood: [], top10: [], by_comm: [], last_run: null,
};

export function usePropertyStats(pipelineRunning = false) {
  const [stats,   setStats]   = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/stats`)
      .then(r => r.json())
      .then(d => { setStats(d); setError(false); setLoading(false); })
      .catch(() => { setStats(EMPTY); setError(true); setLoading(false); });
  }, []);

  useEffect(() => {
    refresh();
    const ms = pipelineRunning ? 5000 : 300000;
    const id = setInterval(refresh, ms);
    return () => clearInterval(id);
  }, [refresh, pipelineRunning]);

  return { ...stats, loading, error };
}
