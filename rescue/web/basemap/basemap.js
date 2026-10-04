// Offline basemap for the rescue screens: local PMTiles + local glyphs/sprites, zero network.
//
//   import * as maplibregl from "./vendor/maplibre-gl.mjs";
//   import { offlineStyle, loadBasemap, ZAWRAT_BOUNDS } from "./basemap/basemap.js";
//   await loadBasemap(maplibregl);
//   const map = new maplibregl.Map({ container: "map", style: offlineStyle(), bounds: ZAWRAT_BOUNDS });
//
// Then add your own sources/layers (POA heatmap, segments, events) on top in map.on("load").
import "../vendor/pmtiles.js";      // IIFE, sets globalThis.pmtiles
import "../vendor/basemaps.js";     // IIFE, sets globalThis.basemaps (Protomaps style layers)

const BASE = new URL(".", import.meta.url).href;  // absolute URL of this folder, works from any page

export const ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors (ODbL)</a> · <a href="https://protomaps.com">Protomaps</a>';

// tatry.pmtiles covers the union of all rescue/scenarios/*.json bboxes + 0.02° pad (see extract_pmtiles.py)
export const TATRY_BOUNDS = [[19.92015, 49.1516], [20.12845, 49.2795]];
// Other rescue regions, one PMTiles file each (extract_pmtiles.py --bbox ...). Usage:
//   await loadBasemap(maplibregl, REGIONS.mamry.file); style: offlineStyle({ file: REGIONS.mamry.file }), bounds: REGIONS.mamry.bounds
export const REGIONS = {
  tatry:      { file: "tatry.pmtiles",      bounds: [[19.92015, 49.1516], [20.12845, 49.2795]], label: "Tatry (Zawrat, Morskie Oko, Kasprowy)" },
  bieszczady: { file: "bieszczady.pmtiles", bounds: [[22.40, 49.03], [22.80, 49.20]], label: "Bieszczady (połoniny, Tarnica)" },
  solina:     { file: "solina.pmtiles",     bounds: [[22.24, 49.40], [22.50, 49.56]], label: "Solina - Myczkowce - Lesko (San)" },
  karkonosze: { file: "karkonosze.pmtiles", bounds: [[15.62, 50.69], [15.82, 50.79]], label: "Karkonosze (Śnieżka)" },
  sniardwy:   { file: "sniardwy.pmtiles",   bounds: [[21.55, 53.68], [21.88, 53.84]], label: "Mazury - Śniardwy" },
  mamry:      { file: "mamry.pmtiles",      bounds: [[21.70, 54.03], [21.98, 54.20]], label: "Mazury - Mamry" },
  miedzyzdroje: { file: "miedzyzdroje.pmtiles", bounds: [[14.37, 53.88], [14.53, 53.98]], label: "Bałtyk - Międzyzdroje" },
  moryn:      { file: "moryn.pmtiles",      bounds: [[14.33, 52.82], [14.46, 52.90]], label: "Moryń - Jezioro Morzycko" },
  pieniny:    { file: "pieniny.pmtiles",    bounds: [[20.37, 49.38], [20.49, 49.455]], label: "Pieniny - Przełom Dunajca" },
  krakow:     { file: "krakow.pmtiles",     bounds: [[19.97, 50.03], [20.10, 50.106]], label: "Kraków - Nowa Huta (miasto)" },
};
// Pick the region whose bounds contain a scenario bbox ({west,south,east,north}); null if none.
export function regionFor(bb) {
  for (const [id, r] of Object.entries(REGIONS)) {
    const [[w, s], [e, n]] = r.bounds;
    if (bb.west >= w && bb.east <= e && bb.south >= s && bb.north <= n) return { id, ...r };
  }
  return null;
}
export const ZAWRAT_BOUNDS = [[19.985, 49.175], [20.1075, 49.269]];   // zawrat.json / blind-01.json + pad

// The whole extract (~3.5 MB) is fetched once into memory, so any static server works
// (python3 -m http.server has no HTTP Range support, which plain pmtiles:// URLs need).
class MemorySource {
  constructor(key, buf) { this.key = key; this.buf = buf; }
  getKey() { return this.key; }
  async getBytes(offset, length) { return { data: this.buf.slice(offset, offset + length) }; }
}

let protocol = null;
export function registerPmtiles(maplibregl) {
  if (protocol) return protocol;
  protocol = new globalThis.pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
  return protocol;
}

// Call before creating the map. When the server answers HTTP Range (Vercel, rescue-server) only the tiles in view are
// fetched (Kraków is 14 MB - too much for a citizen's phone); otherwise, or with {full: true} (the patrol phone, which
// must work offline), the whole archive is loaded into memory under the same URL offlineStyle() uses.
// A {full: true} call after a Range load upgrades it: the map paints from Range requests first, the archive follows.
const loaded = new Set(), inMemory = new Set();
export async function loadBasemap(maplibregl, file = "tatry.pmtiles", { full = false } = {}) {
  const p = registerPmtiles(maplibregl);
  const url = BASE + file;
  if (inMemory.has(url) || (!full && loaded.has(url))) return;
  if (!full) {
    try {
      const r = await fetch(url, { headers: { Range: "bytes=0-511" } });
      if (r.status === 206) { await r.arrayBuffer(); p.add(new globalThis.pmtiles.PMTiles(url)); loaded.add(url); return; }
    } catch (e) {}
  }
  const buf = await (await fetch(url)).arrayBuffer();
  loaded.add(url); inMemory.add(url);
  p.add(new globalThis.pmtiles.PMTiles(new MemorySource(url, buf)));
}

// "paper": Protomaps light recoloured to the app's paper look (docs/rescue-locator/ui-design.md): warm ground, muted
// water and forest, quiet roads and labels, so the POA heat and the red/navy accents stay the loudest things on the map.
// Hex values here mirror --rl-* tokens (MapLibre styles cannot read CSS variables).
const PAPER = {
  background: "#ece8df", earth: "#ece8df", park_a: "#dde3d2", park_b: "#cbd9bf", wood_a: "#d6dfc9", wood_b: "#bfd1b0",
  scrub_a: "#dfe3d2", scrub_b: "#cdd8bd", glacier: "#f6f4ef", sand: "#e8e0cc", beach: "#ebe2c8", pedestrian: "#e6e1d6",
  hospital: "#e6dcd8", school: "#e6e0d6", industrial: "#dcdad4", aerodrome: "#e0ddd6", zoo: "#dde3d2", military: "#e0ddd6",
  water: "#a9c7d6", buildings: "#d6cfc2", railway: "#a9a296", boundaries: "#b3aca0",
  other: "#f3f0e8", minor_service: "#f3f0e8", minor_a: "#f3f0e8", minor_b: "#faf8f3", link: "#faf8f3", major: "#faf8f3", highway: "#fffdf8",
  minor_service_casing: "#dcd6ca", minor_casing: "#dcd6ca", link_casing: "#dcd6ca", major_casing_early: "#d4cdbf", major_casing_late: "#d4cdbf",
  highway_casing_early: "#cfc7b8", highway_casing_late: "#cfc7b8",
  roads_label_minor: "#6b6f72", roads_label_minor_halo: "#faf8f3", roads_label_major: "#4a5054", roads_label_major_halo: "#faf8f3",
  ocean_label: "#4f7a91", subplace_label: "#6b6f72", subplace_label_halo: "#faf8f3", city_label: "#23272a", city_label_halo: "#faf8f3",
  state_label: "#8a8f92", state_label_halo: "#faf8f3", country_label: "#8a8f92", address_label: "#6b6f72", address_label_halo: "#faf8f3",
};
const PAPER_LANDCOVER = { grassland: "#e1e4d0", barren: "#ece4d2", urban_area: "#e4e0d8", farmland: "#e6e6d2", glacier: "#f6f4ef", scrub: "#dfe3d0", forest: "#d3dec7" };

function flavorOf(bm, flavor) {
  if (flavor !== "paper") return bm.namedFlavor(flavor);
  const f = { ...bm.namedFlavor("light"), ...PAPER };
  f.landcover = { ...f.landcover, ...PAPER_LANDCOVER };
  return f;
}

// flavor: "paper" (default, app look), "light" (Protomaps original), "white", "grayscale", "dark"
// hillshade: optional { url, bounds:[[w,s],[e,n]] } (from hillshadeFor) - soft DEM relief drawn over land/landuse, under water and roads.
export function offlineStyle({ flavor = "paper", lang = "pl", file = "tatry.pmtiles", mountain = true, hillshade = null } = {}) {
  const bm = globalThis.basemaps;
  const layers = bm.layers("protomaps", flavorOf(bm, flavor), { lang });
  const sources = { protomaps: { type: "vector", url: "pmtiles://" + BASE + file, attribution: ATTRIBUTION } };
  if (hillshade && hillshade.url && hillshade.bounds) {
    const [[w, s], [e, n]] = hillshade.bounds;
    sources.hillshade = { type: "image", url: new URL(hillshade.url, BASE).href, coordinates: [[w, n], [e, n], [e, s], [w, s]] };
    const at = layers.findIndex((l) => l.id === "water");
    layers.splice(at < 0 ? layers.length : at, 0, { id: "hillshade", type: "raster", source: "hillshade",
      paint: { "raster-opacity": flavor === "dark" ? 0.6 : 0.9, "raster-resampling": "linear", "raster-fade-duration": 0 } });
  }
  return {
    version: 8,
    glyphs: BASE + "fonts/{fontstack}/{range}.pbf",
    sprite: BASE + "sprites/light",   // only the light sprite is bundled offline; icons read fine on the dark flavor too
    sources,
    layers: mountain ? layers.concat(mountainLayers(flavor === "dark")) : layers,
  };
}

// Hillshade overlay (hillshade/<scenario>.png from hillshade.py) whose bounds contain the bbox centre (nearest crop centre); null if none.
// bbox: {west,south,east,north}. Returns { id, url, bounds } ready for offlineStyle({ hillshade }).
let hsIndex = null;
export async function hillshadeFor(bb) {
  try {
    hsIndex = hsIndex || await (await fetch(BASE + "hillshade/index.json")).json();
  } catch (e) { return null; }
  if (!bb) return null;
  const x = (bb.west + bb.east) / 2, y = (bb.south + bb.north) / 2;
  let best = null, bestA = Infinity;
  for (const [id, h] of Object.entries(hsIndex)) {
    const [[w, s], [e, n]] = h.bounds, a = ((w + e) / 2 - x) ** 2 + ((s + n) / 2 - y) ** 2;   // closest crop centre wins
    if (x >= w && x <= e && y >= s && y <= n && a < bestA) { best = { id, url: BASE + h.file, bounds: h.bounds }; bestA = a; }
  }
  return best;
}

// Extra layers for mountain rescue on top of the Protomaps style: trails a rescuer can read at a glance,
// peaks with elevation, huts/shelters. All from the same offline tiles.
// Trails in sand-brown (TOPR red is reserved for rank 1 / alarm), peaks in ink, huts in navy (--rl-accent).
function mountainLayers(dark) {
  const ink = dark ? "#eef2f5" : "#23272a", halo = dark ? "#151c22" : "#faf8f3";
  return [
  { id: "rescue-trails-casing", type: "line", source: "protomaps", "source-layer": "roads", minzoom: 11,
    filter: ["==", ["get", "kind"], "path"],
    paint: { "line-color": halo, "line-opacity": 0.8, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.5, 16, 5] } },
  { id: "rescue-trails", type: "line", source: "protomaps", "source-layer": "roads", minzoom: 11,
    filter: ["==", ["get", "kind"], "path"],
    layout: { "line-cap": "round" },
    paint: { "line-color": dark ? "#e9c46a" : "#8a5a00", "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.8, 16, 2.5], "line-dasharray": [2, 1.2] } },
  { id: "rescue-peak-dots", type: "circle", source: "protomaps", "source-layer": "pois", minzoom: 11,
    filter: ["==", ["get", "kind"], "peak"],
    paint: { "circle-radius": 3, "circle-color": ink, "circle-stroke-color": halo, "circle-stroke-width": 1 } },
  { id: "rescue-peaks", type: "symbol", source: "protomaps", "source-layer": "pois", minzoom: 11,
    filter: ["==", ["get", "kind"], "peak"],
    layout: {
      "text-field": ["case", ["has", "elevation"],
        ["format", ["get", "name"], {}, "\n", {}, ["concat", ["to-string", ["get", "elevation"]], " m"], { "font-scale": 0.85 }],
        ["get", "name"]],
      "text-font": ["Noto Sans Medium"], "text-size": 11, "text-anchor": "top", "text-offset": [0, 0.5], "text-max-width": 8,
      "symbol-sort-key": ["-", 0, ["coalesce", ["get", "elevation"], 0]] },
    paint: { "text-color": ink, "text-halo-color": halo, "text-halo-width": 1.4 } },
  { id: "rescue-huts", type: "symbol", source: "protomaps", "source-layer": "pois", minzoom: 11,
    filter: ["in", ["get", "kind"], ["literal", ["alpine_hut", "shelter", "wilderness_hut", "hut"]]],
    layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Medium"], "text-size": 12, "text-anchor": "top" },
    paint: { "text-color": dark ? "#7fb2e0" : "#1f4e79", "text-halo-color": halo, "text-halo-width": 1.5 } },
  ];
}
