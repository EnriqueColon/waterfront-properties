import { useState, useEffect } from "react";
import { API_BASE } from "../constants/index.js";

export function useAlerts() {
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/alerts`)
      .then(r => r.json())
      .then(d => { setSummary(d.summary || {}); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return { summary, loading };
}

export function usePropertyAlerts(folio) {
  const [alerts,  setAlerts]  = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!folio) return;
    setLoading(true);
    fetch(`${API_BASE}/api/alerts?folio=${folio}`)
      .then(r => r.json())
      .then(d => { setAlerts(d.alerts || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [folio]);

  return { alerts, loading };
}
