import { useState, useEffect, useCallback } from "react";
import { API_BASE } from "../constants/index.js";

export function usePipeline() {
  const [pStage,   setPStage]   = useState("complete");
  const [pProg,    setPProg]    = useState(100);
  const [pRunning, setPRunning] = useState(false);
  const [lastRun,  setLastRun]  = useState(null);
  const [enrichment, setEnrichment] = useState(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/pipeline/status`);
      const d   = await res.json();
      setPStage(d.stage    ?? "complete");
      setPProg(d.progress  ?? 100);
      setPRunning(d.running ?? false);
      if (d.last_run) setLastRun(d.last_run);
    } catch (_) {}
    try {
      const res2 = await fetch(`${API_BASE}/api/enrichment/status`);
      const e = await res2.json();
      setEnrichment(e);
    } catch (_) {}
  }, []);

  useEffect(() => {
    fetchStatus();
    const isActive = pRunning || enrichment?.running;
    const ms = isActive ? 3000 : 30000;
    const id = setInterval(fetchStatus, ms);
    return () => clearInterval(id);
  }, [fetchStatus, pRunning, enrichment?.running]);

  const triggerPipeline = useCallback(async () => {
    if (pRunning) return;
    try {
      await fetch(`${API_BASE}/api/pipeline/trigger`, { method: "POST" });
      setPRunning(true);
      setPStage("download");
      setPProg(2);
    } catch (err) {
      console.error("Trigger failed:", err);
    }
  }, [pRunning]);

  const triggerEnrichment = useCallback(async () => {
    if (enrichment?.running) return;
    try {
      await fetch(`${API_BASE}/api/enrichment/trigger`, { method: "POST" });
      fetchStatus();
    } catch (err) {
      console.error("Enrichment trigger failed:", err);
    }
  }, [enrichment?.running, fetchStatus]);

  return { pStage, pProg, pRunning, lastRun, triggerPipeline, enrichment, triggerEnrichment };
}
