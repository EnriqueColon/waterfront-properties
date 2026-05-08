import { COMMUNITIES } from "../data/communities.js";

export const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export const WF_TYPE_COLOR = {
  "Ocean":        "#0ea5e9",
  "Bay":          "#06b6d4",
  "Bay/Ocean":    "#0284c7",
  "Intracoastal": "#a78bfa",
  "Canal":        "#10b981",
  "River":        "#fbbf24",
  "Lake":         "#34d399",
};

export const FLOOD_COLOR = { VE: "#f87171", AE: "#fb923c", X: "#34d399" };

export const WF_TYPES = ["Ocean", "Bay", "Bay/Ocean", "Intracoastal", "Canal", "River", "Lake"];

export const COMMUNITIES_LIST = COMMUNITIES.map(c => c.name);

export const PRICE_RANGES = [
  { label: "Any Price", min: 0,     max: 0     },
  { label: "< $500K",   min: 0,     max: 5e5   },
  { label: "$500K–$1M", min: 5e5,   max: 1e6   },
  { label: "$1M–$3M",   min: 1e6,   max: 3e6   },
  { label: "$3M–$10M",  min: 3e6,   max: 1e7   },
  { label: "$10M–$25M", min: 1e7,   max: 25e6  },
  { label: "$25M+",     min: 25e6,  max: 0     },
];

export const FLOOD_ZONES = ["AE", "VE", "X"];

export const STAGES = ["download", "filter", "spatial", "enrich", "store"];

export const STAGE_LABELS = {
  download: "MDCPA Download",
  filter:   "WF Filter",
  spatial:  "Spatial Join",
  enrich:   "FEMA Enrich",
  store:    "DB Store",
};
