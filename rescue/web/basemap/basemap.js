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
  bieszczady: { file: "bieszczady.pmtiles", bounds: [[22.40, 49.03], [22.72, 49.20]], label: "Bieszczady (połoniny)" },
  karkonosze: { file: "karkonosze.pmtiles", bounds: [[15.62, 50.69], [15.82, 50.79]], label: "Karkonosze (Śnieżka)" },
  sniardwy:   { file: "sniardwy.pmtiles",   bounds: [[21.55, 53.68], [21.88, 53.84]], label: "Mazury - Śniardwy" },
  // mamry (extract pending):      { file: "mamry.pmtiles",      bounds: [[21.70, 54.03], [21.98, 54.20]], label: "Mazury - Mamry" },
  // moryn (extract pending):      { file: "moryn.pmtiles",      bounds: [[14.33, 52.82], [14.46, 52.90]], label: "Moryń - Jezioro Morzycko" },
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

// Call before creating the map: loads the archive into memory under the same URL offlineStyle() uses.
export async function loadBasemap(maplibregl, file = "tatry.pmtiles") {
  const p = registerPmtiles(maplibregl);
  const url = BASE + file;
  const buf = await (await fetch(url)).arrayBuffer();
  p.add(new globalThis.pmtiles.PMTiles(new MemorySource(url, buf)));
}

// flavor: "light" (default, best under a heatmap), "white", "grayscale", "dark"
export function offlineStyle({ flavor = "light", lang = "pl", file = "tatry.pmtiles", mountain = true } = {}) {
  const bm = globalThis.basemaps;
  const layers = bm.layers("protomaps", bm.namedFlavor(flavor), { lang });
  return {
    version: 8,
    glyphs: BASE + "fonts/{fontstack}/{range}.pbf",
    sprite: BASE + "sprites/" + (flavor === "dark" ? "dark" : "light"),
    sources: {
      protomaps: { type: "vector", url: "pmtiles://" + BASE + file, attribution: ATTRIBUTION },
    },
    layers: mountain ? layers.concat(MOUNTAIN_LAYERS) : layers,
  };
}

// Extra layers for mountain rescue on top of the Protomaps style: trails a rescuer can read at a glance,
// peaks with elevation, huts/shelters. All from the same offline tiles.
const MOUNTAIN_LAYERS = [
  { id: "rescue-trails-casing", type: "line", source: "protomaps", "source-layer": "roads", minzoom: 11,
    filter: ["==", ["get", "kind"], "path"],
    paint: { "line-color": "#ffffff", "line-opacity": 0.8, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.5, 16, 5] } },
  { id: "rescue-trails", type: "line", source: "protomaps", "source-layer": "roads", minzoom: 11,
    filter: ["==", ["get", "kind"], "path"],
    layout: { "line-cap": "round" },
    paint: { "line-color": "#c0392b", "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.8, 16, 2.5], "line-dasharray": [2, 1.2] } },
  { id: "rescue-peak-dots", type: "circle", source: "protomaps", "source-layer": "pois", minzoom: 11,
    filter: ["==", ["get", "kind"], "peak"],
    paint: { "circle-radius": 3, "circle-color": "#3d2b1f", "circle-stroke-color": "#ffffff", "circle-stroke-width": 1 } },
  { id: "rescue-peaks", type: "symbol", source: "protomaps", "source-layer": "pois", minzoom: 11,
    filter: ["==", ["get", "kind"], "peak"],
    layout: {
      "text-field": ["case", ["has", "elevation"],
        ["format", ["get", "name"], {}, "\n", {}, ["concat", ["to-string", ["get", "elevation"]], " m"], { "font-scale": 0.85 }],
        ["get", "name"]],
      "text-font": ["Noto Sans Medium"], "text-size": 11, "text-anchor": "top", "text-offset": [0, 0.5], "text-max-width": 8,
      "symbol-sort-key": ["-", 0, ["coalesce", ["get", "elevation"], 0]] },
    paint: { "text-color": "#3d2b1f", "text-halo-color": "#ffffff", "text-halo-width": 1.4 } },
  { id: "rescue-huts", type: "symbol", source: "protomaps", "source-layer": "pois", minzoom: 11,
    filter: ["in", ["get", "kind"], ["literal", ["alpine_hut", "shelter", "wilderness_hut", "hut"]]],
    layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Medium"], "text-size": 12, "text-anchor": "top" },
    paint: { "text-color": "#1f4e79", "text-halo-color": "#ffffff", "text-halo-width": 1.5 } },
];
