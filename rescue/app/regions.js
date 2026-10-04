// Regions of Poland for Centrum (AI Mateusza #2): incident naming "województwo → rejon → nazwa" and the light map detail
// (main rivers, mountain / lake district labels, cities). Hand-made from public facts (city coordinates, river courses at
// overview accuracy ~2-5 km), no tiles, ~10 kB. Usable from any page:
//   import { regionOf, pathText, MAP_DETAIL } from "./regions.js";
//   regionOf([lat, lon]) -> { woj: "małopolskie", rejon: "Tatry" }
// Województwo: a named rejon carries its own (it lies wholly inside one); else the nearest voivodeship seat. When a
// wojewodztwa.json (admin-1 polygons) is added, setWojPolygons() makes it point-in-polygon.

// rejon anchors: [name, lat, lon, radius km, województwo]; the closest one (relative to its radius) wins
export const REJONY = [
  ["Tatry", 49.225, 19.98, 18, "małopolskie"],
  ["Pieniny", 49.415, 20.42, 9, "małopolskie"],
  ["Beskid Sądecki", 49.47, 20.69, 16, "małopolskie"],
  ["Beskid Śląski", 49.66, 19.0, 16, "śląskie"],
  ["Dolina Sanu", 49.47, 22.35, 10, "podkarpackie"],
  ["Bieszczady", 49.13, 22.6, 28, "podkarpackie"],
  ["Karkonosze", 50.76, 15.74, 16, "dolnośląskie"],
  ["Mazury", 53.79, 21.64, 32, "warmińsko-mazurskie"],
  ["Puszcza Augustowska", 53.8, 23.2, 22, "podlaskie"],
  ["Biebrza", 53.62, 22.78, 18, "podlaskie"],
  ["Dolina Narwi", 53.2, 22.4, 12, "podlaskie"],
  ["Puszcza Notecka", 52.72, 16.1, 22, "wielkopolskie"],
  ["Wolin", 53.93, 14.45, 14, "zachodniopomorskie"],
  ["Pojezierze Myśliborskie", 52.86, 14.41, 14, "zachodniopomorskie"],
  ["Kraków", 50.06, 19.98, 16, "małopolskie"],
  ["Łódź", 51.76, 19.46, 14, "łódzkie"],
  ["Warszawa", 52.23, 21.01, 18, "mazowieckie"],
  ["Dolina Świdra", 52.14, 21.36, 9, "mazowieckie"],
];
// voivodeship seats (fallback województwo = nearest seat)
const SEATS = [
  ["Warszawa", 52.23, 21.01, "mazowieckie"], ["Kraków", 50.06, 19.94, "małopolskie"], ["Łódź", 51.76, 19.46, "łódzkie"],
  ["Wrocław", 51.11, 17.04, "dolnośląskie"], ["Poznań", 52.41, 16.93, "wielkopolskie"], ["Gdańsk", 54.35, 18.65, "pomorskie"],
  ["Szczecin", 53.43, 14.55, "zachodniopomorskie"], ["Bydgoszcz", 53.12, 18.01, "kujawsko-pomorskie"], ["Toruń", 53.01, 18.6, "kujawsko-pomorskie"],
  ["Lublin", 51.25, 22.57, "lubelskie"], ["Białystok", 53.13, 23.16, "podlaskie"], ["Katowice", 50.26, 19.02, "śląskie"],
  ["Kielce", 50.87, 20.63, "świętokrzyskie"], ["Olsztyn", 53.78, 20.48, "warmińsko-mazurskie"], ["Rzeszów", 50.04, 22.0, "podkarpackie"],
  ["Opole", 50.67, 17.93, "opolskie"], ["Zielona Góra", 51.94, 15.51, "lubuskie"], ["Gorzów Wielkopolski", 52.73, 15.24, "lubuskie"],
];
const km = (a, b, c, d) => { const x = (d - b) * Math.cos((a + c) / 2 * Math.PI / 180) * 111.32, y = (c - a) * 110.57; return Math.hypot(x, y); };
let WOJ = null;   // optional admin-1 polygons: [{ name, rings:[[[lon,lat],...]] }]
export function setWojPolygons(fc) {
  WOJ = (fc.features || []).map((f) => ({ name: String(f.properties.name || f.properties.nazwa || "").toLowerCase(),
    rings: f.geometry.type === "Polygon" ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map((p) => p[0]) }));
}
const inRing = (r, x, y) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const cache = new Map();
export function regionOf(ll) {
  if (!ll) return null;
  const [lat, lon] = ll, key = lat.toFixed(4) + "," + lon.toFixed(4);
  if (cache.has(key)) return cache.get(key);
  let best = null, bs = Infinity;
  for (const r of REJONY) { const d = km(lat, lon, r[1], r[2]), s = d / r[3]; if (s <= 1 && s < bs) { bs = s; best = r; } }
  let seat = null, sd = Infinity;
  for (const s of SEATS) { const d = km(lat, lon, s[1], s[2]); if (d < sd) { sd = d; seat = s; } }
  let woj = best ? best[4] : seat[3];
  if (WOJ) { const w = WOJ.find((p) => p.rings.some((r) => inRing(r, lon, lat))); if (w) woj = w.name; }
  // no named rejon: the nearest city / town of the map detail within 40 km, else the voivodeship seat
  let rejon = best && best[0];
  if (!rejon) { let t = null, td = 40; for (const f of MAP_DETAIL.places.features) { const [x, y] = f.geometry.coordinates, d = km(lat, lon, y, x); if (d < td) { td = d; t = f.properties.name; } } rejon = t || seat[0]; }
  const out = { woj, rejon };
  cache.set(key, out);
  return out;
}
export const pathText = (r, name) => r ? `${r.woj} → ${r.rejon} → ${name}` : name;

// ---- map detail (GeoJSON, [lon, lat])
const L = (name, rank, pts) => ({ type: "Feature", properties: { name, rank }, geometry: { type: "LineString", coordinates: pts } });
const P = (name, rank, lon, lat, kind) => ({ type: "Feature", properties: { name, rank, kind }, geometry: { type: "Point", coordinates: [lon, lat] } });
export const MAP_DETAIL = {
  rivers: { type: "FeatureCollection", features: [
    L("Wisła", 1, [[18.98, 49.61], [18.86, 49.66], [18.81, 49.72], [18.79, 49.8], [18.95, 49.93], [19.23, 50.04], [19.6, 50.0], [19.94, 50.05], [20.2, 50.08], [20.5, 50.17], [20.8, 50.29], [21.28, 50.43], [21.6, 50.6], [21.75, 50.68], [21.86, 50.89], [21.97, 51.2], [21.97, 51.42], [21.85, 51.56], [21.5, 51.75], [21.2, 51.98], [21.04, 52.25], [20.85, 52.38], [20.7, 52.44], [20.2, 52.42], [19.7, 52.55], [19.07, 52.66], [18.6, 53.01], [18.43, 53.35], [18.75, 53.48], [18.86, 53.73], [18.79, 54.09], [18.94, 54.34]]),
    L("Odra", 1, [[18.33, 49.92], [18.21, 50.09], [18.2, 50.35], [17.92, 50.67], [17.47, 50.86], [17.3, 50.95], [17.03, 51.12], [16.7, 51.25], [16.43, 51.41], [16.08, 51.66], [15.72, 51.8], [15.4, 51.95], [15.1, 52.05], [14.75, 52.08], [14.56, 52.35], [14.64, 52.59], [14.35, 52.75], [14.2, 52.88], [14.35, 53.1], [14.49, 53.25], [14.57, 53.43], [14.6, 53.7]]),
    L("Warta", 2, [[19.45, 50.5], [19.12, 50.81], [18.87, 51.12], [18.73, 51.6], [18.79, 51.97], [18.64, 52.2], [18.25, 52.22], [17.7, 52.17], [17.3, 52.1], [17.02, 52.09], [16.95, 52.4], [16.81, 52.65], [16.4, 52.68], [16.08, 52.65], [15.9, 52.6], [15.55, 52.72], [15.23, 52.73], [14.9, 52.62], [14.64, 52.59]]),
    L("San", 2, [[22.88, 49.0], [22.78, 49.08], [22.67, 49.2], [22.52, 49.33], [22.45, 49.38], [22.41, 49.44], [22.33, 49.47], [22.2, 49.56], [22.1, 49.68], [22.23, 49.81], [22.5, 49.8], [22.77, 49.78], [22.82, 49.95], [22.68, 50.02], [22.42, 50.26], [22.27, 50.5], [22.05, 50.58], [21.83, 50.72]]),
    L("Bug", 2, [[24.1, 50.6], [24.03, 50.83], [23.81, 51.17], [23.6, 51.4], [23.55, 51.55], [23.62, 51.8], [23.62, 52.08], [23.12, 52.37], [22.66, 52.4], [22.25, 52.55], [21.87, 52.7], [21.47, 52.59], [21.07, 52.51]]),
    L("Narew", 2, [[23.6, 52.75], [23.5, 52.91], [22.95, 52.95], [22.88, 52.99], [22.77, 53.2], [22.38, 53.19], [22.07, 53.18], [21.88, 53.23], [21.57, 53.08], [21.4, 52.88], [21.08, 52.7], [21.07, 52.51], [20.7, 52.44]]),
    L("Dunajec", 3, [[19.95, 49.3], [20.03, 49.48], [20.31, 49.43], [20.4, 49.41], [20.48, 49.42], [20.43, 49.44], [20.43, 49.56], [20.64, 49.56], [20.7, 49.62], [20.69, 49.75], [20.81, 49.86], [20.84, 49.96], [20.89, 50.13], [20.72, 50.24]]),
    L("Poprad", 3, [[20.89, 49.35], [20.79, 49.38], [20.71, 49.44], [20.68, 49.49], [20.64, 49.56]]),
  ] },
  // soft labels for mountain ranges and lake districts (rank 1 at overview, 2 from zoom 6.5)
  areas: { type: "FeatureCollection", features: [
    P("Tatry", 1, 19.98, 49.2, "mountain"), P("Bieszczady", 1, 22.55, 49.1, "mountain"), P("Karkonosze", 1, 15.65, 50.78, "mountain"),
    P("Beskidy", 1, 19.6, 49.62, "mountain"), P("Pieniny", 2, 20.4, 49.4, "mountain"), P("Beskid Niski", 2, 21.5, 49.5, "mountain"),
    P("Góry Świętokrzyskie", 2, 20.9, 50.86, "mountain"), P("Sudety", 2, 16.4, 50.55, "mountain"),
    P("Mazury", 1, 21.75, 53.95, "lakes"), P("Pojezierze Pomorskie", 2, 17.3, 53.85, "lakes"), P("Pojezierze Suwalskie", 2, 22.95, 54.2, "lakes"),
    P("Puszcza Notecka", 2, 16.0, 52.77, "forest"), P("Puszcza Augustowska", 2, 23.25, 53.9, "forest"), P("Biebrza", 2, 22.7, 53.5, "lakes"),
  ] },
  // voivodeship seats (rank 1), larger towns (rank 2, from zoom 6.3), small towns near the incidents (rank 3, from zoom 7.5)
  places: { type: "FeatureCollection", features: [
    ...SEATS.map((s) => P(s[0], 1, s[2], s[1], "seat")),
    ...[["Zakopane", 19.95, 49.3], ["Nowy Sącz", 20.69, 49.62], ["Sanok", 22.21, 49.56], ["Przemyśl", 22.77, 49.78], ["Jelenia Góra", 15.73, 50.9],
      ["Suwałki", 22.93, 54.1], ["Łomża", 22.06, 53.18], ["Elbląg", 19.4, 54.16], ["Koszalin", 16.17, 54.19], ["Słupsk", 17.03, 54.46],
      ["Płock", 19.71, 52.55], ["Radom", 21.15, 51.4], ["Częstochowa", 19.12, 50.81], ["Bielsko-Biała", 19.04, 49.82], ["Tarnów", 20.99, 50.01],
      ["Kalisz", 18.09, 51.76], ["Legnica", 16.16, 51.21], ["Wałbrzych", 16.28, 50.78], ["Siedlce", 22.29, 52.17], ["Zamość", 23.25, 50.72],
      ["Chełm", 23.47, 51.13], ["Świnoujście", 14.25, 53.91], ["Giżycko", 21.76, 54.04], ["Ełk", 22.36, 53.83]].map((t) => P(t[0], 2, t[1], t[2], "town")),
    ...[["Augustów", 22.98, 53.84], ["Mikołajki", 21.57, 53.8], ["Międzyzdroje", 14.45, 53.93], ["Ustrzyki Dolne", 22.59, 49.43], ["Lesko", 22.33, 49.47],
      ["Karpacz", 15.75, 50.78], ["Szczawnica", 20.48, 49.42], ["Szczyrk", 19.03, 49.72], ["Piwniczna-Zdrój", 20.71, 49.44], ["Wizna", 22.38, 53.19],
      ["Sieraków", 16.08, 52.65], ["Moryń", 14.39, 52.86], ["Cisna", 22.33, 49.21], ["Wetlina", 22.48, 49.15], ["Ruciane-Nida", 21.55, 53.64],
      ["Pisz", 21.81, 53.63], ["Goniądz", 22.74, 53.49]].map((t) => P(t[0], 3, t[1], t[2], "town")),
  ] },
};
