import { useState, useEffect, useCallback } from "react";
import { API_BASE } from "../constants/index.js";

export function useFlagged(activeTab) {
  const [flagged,  setFlagged]  = useState([]);
  const [counts,   setCounts]   = useState({ red: 0, orange: 0, yellow: 0, complaint: 0 });
  const [loading,  setLoading]  = useState(false);
  const [fullLoaded, setFullLoaded] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/flagged/counts`)
      .then(r => r.json())
      .then(d => setCounts(d || {}))
      .catch(() => {});
  }, []);

  const loadFull = useCallback(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/flagged`)
      .then(r => r.json())
      .then(d => {
        setFlagged(d.flagged || []);
        setCounts(d.counts  || {});
        setFullLoaded(true);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (activeTab === "flagged" && !fullLoaded) {
      loadFull();
    }
  }, [activeTab, fullLoaded, loadFull]);

  const reload = useCallback(() => {
    setFullLoaded(false);
    loadFull();
  }, [loadFull]);

  return { flagged, counts, loading, reload };
}
