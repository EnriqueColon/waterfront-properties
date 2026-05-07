import { useState, useEffect } from "react";
import { API_BASE } from "../constants/index.js";

export function useComplaints() {
  const [data, setData]       = useState({ complaints: [], total: 0, matched: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/complaints`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return { ...data, loading };
}

export function usePropertyComplaints(folio) {
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading]       = useState(false);

  useEffect(() => {
    if (!folio) return;
    setLoading(true);
    fetch(`${API_BASE}/api/complaints?folio=${folio}`)
      .then(r => r.json())
      .then(d => { setComplaints(d.complaints || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [folio]);

  return { complaints, loading };
}
