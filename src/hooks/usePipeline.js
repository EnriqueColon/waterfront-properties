import { useState, useEffect, useCallback } from "react";
import { API_BASE } from "../constants/index.js";

export function usePipeline() {
  const [pStage,   setPStage]   = useState("complete");
  const [pProg,    setPProg]    = useState(100);
  const [pRunning, setPRunning] = useState(false);
  const [lastRun,  setLastRun]  = useState(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/pipeline/status`);
      const d   = await res.json();
      setPStage(d.stage    ?? "complete");
      setPProg(d.progress  ?? 100);
      setPRunning(d.running ?? false);
      if (d.last_run) setLastRun(d.last_run);
    } catch (_) {
      // API not yet reachable — leave defaults
    }
  }, []);

  // Poll every 2 s while running, every 30 s at rest
  useEffect(() => {
    fetchStatus();
    const ms = pRunning ? 2000 : 30000;
    const id = setInterval(fetchStatus, ms);
    return () => clearInterval(id);
  }, [fetchStatus, pRunning]);

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

  return { pStage, pProg, pRunning, lastRun, triggerPipeline };
}
