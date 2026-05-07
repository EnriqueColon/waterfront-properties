import { COMMUNITIES } from "./communities.js";

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

export function buildFullDB() {
  const r = rng(9137);
  const lastNames  = ["Rodriguez","Martinez","Johnson","Garcia","Smith","Hernandez","Williams","Lopez","Brown","Gonzalez","Perez","Kim","Chen","Cohen","Schwartz","Levine","Murphy","O'Brien","Rosenberg","Fernandez","Gutierrez","Ramirez","Torres","Flores","Rivera","Morales","Reyes","Cruz","Ortega","Medina"];
  const firstNames = ["Carlos","Maria","James","Sophia","Robert","Elena","David","Isabella","Michael","Ana","Luis","Patricia","Jorge","Sandra","Eduardo","Monica","Alberto","Carmen","Rafael","Diana","Miguel","Rosa","Antonio","Beatriz","Fernando","Claudia"];
  const sfx     = [" LLC"," Trust"," Holdings LLC"," Realty Trust"," Family Trust",""];
  const usTypes = ["SFH","SFH","SFH","Condo","Condo","Condo","Townhome","Townhome","Villa","Penthouse"];

  const props = [];
  let id = 1;

  for (const comm of COMMUNITIES) {
    const section = String(~~(r() * 35) + 1).padStart(2, "0");
    const twp     = String(~~(r() * 4) + 51).padStart(2, "0");
    const rng_    = String(~~(r() * 3) + 40).padStart(2, "0");

    for (let i = 0; i < comm.count; i++) {
      const isOrg = r() < 0.35;
      const owner = isOrg
        ? lastNames[~~(r() * 30)] + sfx[~~(r() * 6)]
        : firstNames[~~(r() * 26)] + " " + lastNames[~~(r() * 30)] + sfx[~~(r() * 6)];

      const street   = comm.streets[~~(r() * comm.streets.length)];
      const streetNum = 100 + ~~(r() * 29800);
      const propType = usTypes[~~(r() * 10)];
      const isCondo  = propType === "Condo" || propType === "Penthouse";

      const sale     = comm.priceMin + ~~(r() * (comm.priceMax - comm.priceMin));
      const assessed = ~~(sale * (0.55 + r() * 0.38));
      const land     = isCondo ? 0 : ~~(assessed * (0.25 + r() * 0.45));
      const bldg     = assessed - land;

      const sqft    = isCondo ? 600  + ~~(r() * 5400)  : 1200 + ~~(r() * 12800);
      const lot     = isCondo ? 0    : 4000 + ~~(r() * 55000);
      const beds    = isCondo ? 1 + ~~(r() * 4) : 2 + ~~(r() * 7);
      const baths   = Math.max(1, beds - 1 + ~~(r() * 3));
      const yr      = comm.name.includes("Fisher") || isCondo ? 1970 + ~~(r() * 54) : 1940 + ~~(r() * 84);
      const waterFt = comm.waterMin + ~~(r() * (comm.waterMax - comm.waterMin));

      const lat = comm.lat[0] + r() * (comm.lat[1] - comm.lat[0]);
      const lng = comm.lng[0] + r() * (comm.lng[1] - comm.lng[0]);

      const blk   = String(~~(r() * 999) + 1).padStart(3, "0");
      const lt    = String(i).padStart(4, "0");
      const folio = `${section}-${twp}${rng_}-${blk}-${lt}`;

      props.push({
        id: id++,
        folio,
        address: isCondo
          ? `${streetNum} ${street} #${~~(r() * 4999) + 100}`
          : `${streetNum} ${street}`,
        community:      comm.name,
        wf_type:        comm.wfType,
        prop_type:      propType,
        sqft,
        lot_sqft:       lot,
        beds,
        baths,
        year_built:     yr,
        assessed,
        land_value:     Math.max(0, land),
        building_value: Math.max(0, bldg),
        last_sale:      sale,
        sale_year:      2008 + ~~(r() * 17),
        flood_zone:     comm.flood,
        water_feet:     waterFt,
        owner:          owner.trim(),
        lat:            +lat.toFixed(6),
        lng:            +lng.toFixed(6),
        homestead:      r() < 0.38 ? 1 : 0,
      });
    }
  }
  return props;
}

export const ALL         = buildFullDB();
export const TOTAL_COUNT = ALL.length;
