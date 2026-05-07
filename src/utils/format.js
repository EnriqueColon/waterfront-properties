import { WF_TYPE_COLOR, FLOOD_COLOR } from "../constants/index.js";

export const fmtM = n => {
  if (!n || n === 0) return "$0";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n / 1000)}K`;
};

export const fmtN = n => (n ? (+n).toLocaleString() : "—");

export const tc = t => WF_TYPE_COLOR[t] || "#94a3b8";
export const fc = z => FLOOD_COLOR[z] || "#94a3b8";
