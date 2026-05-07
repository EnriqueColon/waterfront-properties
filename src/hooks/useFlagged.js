import { useState, useEffect } from "react";
import { API_BASE } from "../constants/index.js";

export function useFlagged() {
  const [flagged,  setFlagged]  = useState([]);
  const [counts,   setCounts]   = useState({ red: 0, orange: 0, yellow: 0, complaint: 0 });
  const [loading,  setLoading]  = useState(true);

  const load = () => {
    setLoading(true);
    fetch(`${API_BASE}/api/flagged`)
      .then(r => r.json())
      .then(d => {
        setFlagged(d.flagged || []);
        setCounts(d.counts  || {});
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  return { flagged, counts, loading, reload: load };
}
