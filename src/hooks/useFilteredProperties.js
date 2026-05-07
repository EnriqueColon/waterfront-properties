import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE, PRICE_RANGES } from "../constants/index.js";

export const PAGE_SIZE = 60;

export function useFilteredProperties() {
  const [search,   setSearch]   = useState("");
  const [typeF,    setTypeF]    = useState("");
  const [commF,    setCommF]    = useState("");
  const [priceF,   setPriceF]   = useState(0);
  const [floodF,   setFloodF]   = useState("");
  const [sqftMin,  setSqftMin]  = useState("");
  const [sqftMax,  setSqftMax]  = useState("");
  const [waterMin, setWaterMin] = useState("");
  const [waterMax, setWaterMax] = useState("");
  const [yearMin,  setYearMin]  = useState("");
  const [yearMax,  setYearMax]  = useState("");
  const [bedsMin,  setBedsMin]  = useState("");
  const [sort,     setSort]     = useState("assessed");
  const [order,    setOrder]    = useState("desc");
  const [page,     setPage]     = useState(0);

  const [data,    setData]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef = useRef(null);
  const handleSearch = useCallback((val) => {
    setSearch(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(val);
      setPage(0);
    }, 350);
  }, []);

  const resetPage = (fn) => (val) => { fn(val); setPage(0); };

  const clearFilters = useCallback(() => {
    handleSearch("");
    setDebouncedSearch("");
    setTypeF("");
    setCommF("");
    setPriceF(0);
    setFloodF("");
    setSqftMin("");
    setSqftMax("");
    setWaterMin("");
    setWaterMax("");
    setYearMin("");
    setYearMax("");
    setBedsMin("");
    setPage(0);
  }, [handleSearch]);

  useEffect(() => {
    const pr = PRICE_RANGES[priceF];
    const params = new URLSearchParams({ sort, order, page, per_page: PAGE_SIZE });
    if (typeF)          params.set("type",      typeF);
    if (commF)          params.set("community", commF);
    if (floodF)         params.set("flood_zone", floodF);
    if (pr.min)         params.set("price_min", pr.min);
    if (pr.max)         params.set("price_max", pr.max);
    if (sqftMin)        params.set("sqft_min",  sqftMin);
    if (sqftMax)        params.set("sqft_max",  sqftMax);
    if (waterMin)       params.set("water_min", waterMin);
    if (waterMax)       params.set("water_max", waterMax);
    if (yearMin)        params.set("year_min",  yearMin);
    if (yearMax)        params.set("year_max",  yearMax);
    if (bedsMin)        params.set("beds_min",  bedsMin);
    if (debouncedSearch) params.set("q",        debouncedSearch);

    setLoading(true);
    fetch(`${API_BASE}/api/properties?${params}`)
      .then(r => r.json())
      .then(d => { setData(d.data ?? []); setTotal(d.total ?? 0); setError(null); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [typeF, commF, priceF, floodF, sqftMin, sqftMax, waterMin, waterMax,
      yearMin, yearMax, bedsMin, debouncedSearch, sort, order, page]);

  const toggleSort = useCallback((col) => {
    if (sort === col) setOrder(o => o === "desc" ? "asc" : "desc");
    else { setSort(col); setOrder("desc"); }
    setPage(0);
  }, [sort]);

  const exportCSV = useCallback(async () => {
    const pr = PRICE_RANGES[priceF];
    const params = new URLSearchParams({ sort, order, per_page: 10000 });
    if (typeF)          params.set("type",      typeF);
    if (commF)          params.set("community", commF);
    if (floodF)         params.set("flood_zone", floodF);
    if (pr.min)         params.set("price_min", pr.min);
    if (pr.max)         params.set("price_max", pr.max);
    if (sqftMin)        params.set("sqft_min",  sqftMin);
    if (sqftMax)        params.set("sqft_max",  sqftMax);
    if (waterMin)       params.set("water_min", waterMin);
    if (waterMax)       params.set("water_max", waterMax);
    if (yearMin)        params.set("year_min",  yearMin);
    if (yearMax)        params.set("year_max",  yearMax);
    if (bedsMin)        params.set("beds_min",  bedsMin);
    if (debouncedSearch) params.set("q",        debouncedSearch);

    const res = await fetch(`${API_BASE}/api/properties?${params}`);
    const d   = await res.json();
    const rows = d.data ?? [];

    const fields = ["folio","address","community","wf_type","prop_type","sqft",
                    "lot_sqft","beds","baths","year_built","assessed",
                    "land_value","building_value","flood_zone","water_feet",
                    "last_sale_price","last_sale_date","owner"];
    const csv = [fields.join(","), ...rows.map(p => fields.map(k => JSON.stringify(p[k] ?? "")))].join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = "miami_waterfront_real.csv";
    a.click();
  }, [typeF, commF, priceF, floodF, sqftMin, sqftMax, waterMin, waterMax,
      yearMin, yearMax, bedsMin, debouncedSearch, sort, order]);

  const hasActiveFilters = !!(
    debouncedSearch || typeF || commF || priceF || floodF ||
    sqftMin || sqftMax || waterMin || waterMax || yearMin || yearMax || bedsMin
  );

  return {
    search, setSearch: handleSearch,
    typeF,    setTypeF:    resetPage(setTypeF),
    commF,    setCommF:    resetPage(setCommF),
    priceF,   setPriceF:   resetPage(setPriceF),
    floodF,   setFloodF:   resetPage(setFloodF),
    sqftMin,  setSqftMin:  resetPage(setSqftMin),
    sqftMax,  setSqftMax:  resetPage(setSqftMax),
    waterMin, setWaterMin: resetPage(setWaterMin),
    waterMax, setWaterMax: resetPage(setWaterMax),
    yearMin,  setYearMin:  resetPage(setYearMin),
    yearMax,  setYearMax:  resetPage(setYearMax),
    bedsMin,  setBedsMin:  resetPage(setBedsMin),
    sort, order, toggleSort,
    page, setPage,
    data, total, loading, error,
    exportCSV, clearFilters, hasActiveFilters,
  };
}
