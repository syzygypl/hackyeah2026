// Rescue Locator 3D - terrain scene of the POA timeline, its source signals, and a blind test game, shown inside /app
// (iframe, ?embed=scene): the shell owns the step card, signal list, ranking, team plan and timeline.
// Reads the same offline files as the 2D screen: out/run.json (rescue-run/1), scenarios/<sc>.json,
// scenarios/<sc>-terrain.json, tools/terrain/data/<sc>-dem.json and the live feed GET /api/live.
// The timeline is computed by the Swift engine; the page draws it. Only the blind test game
// updates the map in the browser (Bayes: segment POA x (1 - POD) after an empty patrol).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { colorFor, gradientCSS, STOPS } from '../scale.js'; // shared heat scale (decision S2), same as 2D
import { FX, FX_OFF, applyFx, installHeightFog } from './fx3d.js'; // vertex / pixel shader effects
import { createTimeline3D } from './timeline3d.js';
import { createCoverage3D } from './coverage3d.js';
import { createWalk3D } from './walk3d.js';
import { createLivePos3D } from './livepos3d.js'; // live team positions (GET /api/positions), Na żywo only
import { waterRaster } from './water3d.js'; // rivers as continuous ribbons, lakes as polygons (high-res water mask)
import { createMachine, createVehicle, vehicleKind, operatorPaint, createRailcar, createDamagedTrack, createProp } from './machines3d.js'; // unit models: aircraft, boats, ground vehicles   // free walk (Spacer): first person from a clicked spot

// ---------- config ----------
// load in slices: the build hands the main thread back between stages (in /app the iframe shares it with the shell);
// a MessageChannel task, not a timer, so a background tab is not throttled to one slice per second
const yieldMain = () => (globalThis.scheduler?.yield ? scheduler.yield() : new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); }));
const Q = new URLSearchParams(location.search);
const SCENS = {
  zawrat: { name: 'Zawrat', run: '../../out/run.json', demWide: 'data/zawrat-dem-wide.json', ortho: 'data/zawrat-ortho-wide.jpg' },
  'morskie-oko': { name: 'Morskie Oko', run: '../../out/morskie-oko.run.json', ortho: 'data/morskie-oko-ortho.jpg', demWide: 'data/morskie-oko-dem-wide.json' },
  kasprowy: { name: 'Kasprowy', run: '../../out/kasprowy.run.json', ortho: 'data/kasprowy-ortho.jpg', demWide: 'data/kasprowy-dem-wide.json' },
  'blind-01': { name: 'Test na ślepo: runda 1 (replay)', run: '../../out/blind-01-replay.run.json', scenario: '../../scenarios/blind-01-replay.json',
    terrain: '../../scenarios/blind-01-replay-terrain.json', dem: '../../tools/terrain/data/zawrat-dem.json', demWide: 'data/zawrat-dem-wide.json', ortho: 'data/zawrat-ortho-wide.jpg', reveal: '../../blindtest/blind-01.reveal.json' },
};
// Regions outside the Tatras: any scenario with tools/terrain/data/<sc>-dem.json opens on its own (narrow) DEM, without
// the wide backdrop or aerial photo. Blind tests only through their SCENS entries.
const REGIONS = { 'bieszczady-wetlinska': 'Bieszczady - Połonina Wetlińska', 'karkonosze-sniezka': 'Karkonosze - Śnieżka', sniardwy: 'Śniardwy', morzycko: 'Morzycko', miedzyzdroje: 'Międzyzdroje (Bałtyk)', 'kajak-pieniny': 'Pieniny - Przełom Dunajca', 'lawina-wolowiec': 'Tatry Zachodnie - lawina pod Wołowcem', 'pozar-biebrza': 'Biebrza - Czerwone Bagno', 'paralotniarz-beskidy': 'Beskid Śląski - Skrzyczne' };
const addScen = (id) => { if (!SCENS[id] && /^[a-z0-9-]{1,40}$/.test(id) && !/blind/.test(id)) SCENS[id] = { name: REGIONS[id] || id, run: `../../out/${id}.run.json`, region: true, ortho: `data/${id}-ortho.jpg`, demWide: `data/${id}-dem-wide.json` }; };
SCENS['blind-01-replay'] = SCENS['blind-01']; // the shell's id for the round 1 replay
if (Q.get('sc')) addScen(Q.get('sc'));
const SC = SCENS[Q.get('sc')] ? Q.get('sc') : 'zawrat';
const P = {
  run: Q.get('run') || SCENS[SC].run,
  scenario: Q.get('scenario') || SCENS[SC].scenario || `../../scenarios/${SC}.json`,
  terrain: Q.get('terrain') || SCENS[SC].terrain || `../../scenarios/${SC}-terrain.json`,
  dem: Q.get('dem') || SCENS[SC].dem || `../../tools/terrain/data/${SC}-dem.json`,
  reveal: Q.get('reveal') || SCENS[SC].reveal,
};
const EX = Number(Q.get('exag')) || 1.6; // vertical exaggeration
const KM = 111.32;
// source signals: [badge, colour, plain-language name]
const SIG = {
  Terrain: ['T', '#6b705c', 'Teren (OSM + DEM)'],
  TerrainDifficulty: ['Tr', '#8d7b68', 'Trudność terenu'],
  KoesterRings: ['K', '#457b9d', 'Statystyka zaginięć (Koester / ISRID)'],
  WeatherConditions: ['W', '#7d8a9c', 'Warunki na miejscu'],
  Weather: ['W', '#7d8a9c', 'Prognoza IMGW'],
  TripPlan: ['P', '#6c4ab6', 'Plan wycieczki od rodziny'],
  TrailheadCar: ['A', '#2a9d8f', 'Auto na parkingu'],
  Cell112Fix: ['B', '#1f4e79', 'CPR 112: sektor BTS'],
  Witness: ['Ś', '#e76f51', 'Świadek'],
  SegmentSearched: ['N', '#555b61', 'Patrol: przeszukano, nic'],
  DronePassEmpty: ['D', '#555b61', 'Dron termowizyjny: nic'],
  Clue: ['!', '#2d6a4f', 'Ślad / znalezienie'],
  RatunekPing: ['G', '#2d6a4f', 'Ratunek: ping GPS'],
  Found: ['!', '#2d6a4f', 'Znalezienie'],
};
const sigOf = (e) => (/świadek/i.test(e.title || '') ? ['Ś', '#e76f51', 'Świadek'] : /ZNALEZIONO/i.test(e.title || '') ? ['!', '#2d6a4f', 'Znalezienie'] : null) || SIG[e.provider] || [e.provider?.[0] || '•', /świadek|witness/i.test(e.title + e.provider) ? '#e76f51' : '#6b6f72', e.provider || 'Sygnał'];
const TEAM_COL = { heli: '#1f4e79', ground: '#b8860b', dog: '#8d5524', drone: '#6c4ab6' };

const $ = (id) => document.getElementById(id);
const nf = (x, d) => Number(x).toLocaleString('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (p, d) => (d != null ? nf(p * 100, d) : p >= 0.095 ? nf(p * 100, 0) : nf(p * 100, 1)) + '%';
const DIFF_COLORS = ['#e6dfc8', '#9cc47a', '#3f7a3a', '#b8a78a', '#8f80a6', '#4b3f4a', '#4a8fd1']; // same as 2D
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// LAN server with --pin: /api/* needs X-Rescue-Pin (the app stores it raw, web/patrol JSON-quoted); same origin only
const runPin = (u) => { try { const p = (localStorage.getItem('rescue-pin') || '').replace(/^"(.*)"$/, '$1'); return p && new URL(u, location.href).origin === location.origin ? { 'X-Rescue-Pin': p } : {}; } catch { return {}; } };
const getJSON = async (u, optional) => {
  const k = new URL(u, location.href).href, pre = window.__pre3d?.[k]; // prefetched by index.html
  if (pre) { delete window.__pre3d[k]; try { return await pre; } catch (e) { if (optional) return null; throw e; } }
  try { const r = await fetch(u, { cache: 'no-cache', headers: runPin(u) }); if (!r.ok) throw new Error(r.status + ' ' + u); return await r.json(); }
  catch (e) { if (optional) return null; throw e; }
};

// Replay fallback when the engine output is not in the repo: one step per scenario event, segments from the
// scenario seeds (nearest seed, approximate), uniform POA. Clearly flagged in the UI; nothing is invented.
function synthRun(sc) {
  const bb = sc.bbox, cell = sc.cellM || 100;
  const rows = Math.round(((bb.north - bb.south) * 111320) / cell), cols = Math.round(((bb.east - bb.west) * 111320 * Math.cos((((bb.north + bb.south) / 2) * Math.PI) / 180)) / cell);
  const N = rows * cols, dLa = (bb.north - bb.south) / rows, dLo = (bb.east - bb.west) / cols, kx = Math.cos((((bb.north + bb.south) / 2) * Math.PI) / 180);
  const segOf = new Array(N), count = {};
  for (let i = 0; i < N; i++) {
    const la = bb.north - (Math.floor(i / cols) + 0.5) * dLa, lo = bb.west + ((i % cols) + 0.5) * dLo;
    let best = null, bd = Infinity;
    for (const s of sc.segments) { const d = (s.seed[0] - la) ** 2 + ((s.seed[1] - lo) * kx) ** 2; if (d < bd) { bd = d; best = s.id; } }
    segOf[i] = best; count[best] = (count[best] || 0) + 1;
  }
  const segments = sc.segments.map((s) => ({ id: s.id, name: s.name, poa: 1 / sc.segments.length, areaPct: (100 * (count[s.id] || 0)) / N, polygon: [] }));
  const kindOf = { Terrain: 'terrain', TerrainDifficulty: 'difficulty', KoesterRings: 'rings', WeatherConditions: 'conditions', TripPlan: 'route', TrailheadCar: 'containment', Cell112Fix: 'sector', Weather: 'weather', SegmentSearched: 'searched', DronePassEmpty: 'searched', Clue: 'clue' };
  let weather = {};
  const steps = sc.events.map((e) => {
    if (e.provider === 'WeatherConditions') weather = { ...weather, ...Object.fromEntries(['visibilityM', 'windMs', 'tempC', 'precip', 'dark', 'ice'].filter((k) => k in e).map((k) => [k, e[k]])) };
    return { t: e.at, label: e.title, kind: /ZNALEZIONO/i.test(e.title) ? 'point' : kindOf[e.provider] || 'clue', source: e.provider, poaGrid: new Array(N).fill(1 / N), segments, weather: { ...weather }, assignments: [], resources: [] };
  });
  return { schema: 'rescue-run/1', synthetic: true, incident: sc.incident, bbox: bb, cellM: cell, rows, cols, ipp: { lat: sc.ipp.at[0], lon: sc.ipp.at[1], name: sc.ipp.name }, segOf, steps, value: {} };
}

function decimate(D, k) {
  const rows = Math.floor(D.rows / k), cols = Math.floor(D.cols / k), z = [];
  for (let r = 0; r < rows; r++) { const row = new Array(cols); for (let c = 0; c < cols; c++) { let a = 0; for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) a += D.z[r * k + i][c * k + j]; row[c] = a / (k * k); } z.push(row); }
  return { ...D, rows, cols, step: D.step * k, stepLat: (D.stepLat || D.step) * k, z };
}

// ---------- load ----------
// Embed: a parent page can hand a run object over postMessage; it is parked in sessionStorage and the page reloads.
const inlineRun = (() => { if (!Q.has('runInline')) return null; try { return JSON.parse(sessionStorage.getItem('rescue3d-run')); } catch { return null; } })();
const EMB = Q.get('embed');
if (EMB === '1' || EMB === 'bare' || EMB === 'scene') document.body.classList.add('embed');
if (EMB === 'bare') document.body.classList.add('embed-bare');
if (EMB === 'scene') document.body.classList.add('embed-scene'); // 3D buttons, no timeline (the shell has its own)
const FPPWIN = EMB === 'fpp'; // the separate FPP window: only the scene in a unit's eye view, its picker and the clock
if (FPPWIN) document.body.classList.add('embed', 'embed-bare', 'embed-fpp');
if (document.body.classList.contains('embed')) {
  // decision S1: embedded views use the shell's tokens (dark operational theme, light via ?theme=light)
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '../tokens.css'; document.head.appendChild(l);
  if (Q.get('theme') === 'light' || Q.get('theme') === 'dark') document.documentElement.dataset.theme = Q.get('theme');
}
// rescue-server computes runs live and the generated out/<sc>.run.json files are not committed: when the static file
// is missing, ask the same origin's GET /api/run/<sc> before giving up (blind tests are never served there).
const API_RUN = `/api/run/${SC}`;
const loadRun = async () => {
  // runInline (1f20792): inside /app the shell already holds this exact run as text (app.js api()); parse it instead of a second GET
  try { const c = parent !== window && parent.__rescueRunText; if (c && c.url === new URL(P.run, location.href).href) return JSON.parse(c.text); } catch (e) {}
  try { return await getJSON(P.run); }
  catch (e) {
    if (!Q.get('run') && !P.reveal && /^404 /.test(e.message)) { try { const r = await getJSON(API_RUN); P.run = API_RUN; return r; } catch {} }
    if (P.reveal || SCENS[SC].region) return null; // replay from the scenario file (synthRun below)
    throw e;
  }
};
let R, SCN, TER, DEM, REV, DEM_FULL, FLAT = false, WIDE = false, OSM3D = null, TRAF = null, W3D = null;
try {
  const wide = !Q.get('dem') && Q.get('wide') !== '0' && SCENS[SC].demWide;
  [R, SCN, TER, DEM, REV, OSM3D, TRAF, W3D] = await Promise.all([inlineRun ? Promise.resolve(inlineRun) : loadRun(), getJSON(P.scenario, true), getJSON(P.terrain, true),
    (wide ? getJSON(wide, true) : Promise.resolve(null)).then((d) => { WIDE = !!d; return d || getJSON(P.dem, true); }), P.reveal ? getJSON(P.reveal, true) : null,
    getJSON(`data/${SC === 'blind-01' ? 'zawrat' : SC}-osm3d.json`, true), // buildings, roads, land cover (make_osm3d.py)
    getJSON(`data/${SC === 'blind-01' ? 'zawrat' : SC}-traffic.json`, true), // roads open to motor traffic, for the cars (make_traffic.py)
    getJSON(`data/${SC === 'blind-01' ? 'zawrat' : SC}-water3d.json`, true)]); // waterway lines + water polygons (make_water3d.py)
  if (!R && SCN) R = synthRun(SCN);
  // no elevation model for this scenario (e.g. a new one from the Studio): flat ground at 1000 m over the run's bbox, so
  // the probability map, signals, teams and the blind test still work; a note says the relief is missing
  if (!DEM && R?.bbox) {
    const b = R.bbox, cols = 240, rows = Math.max(2, Math.round(cols * ((b.north - b.south) / ((b.east - b.west) * Math.cos((((b.north + b.south) / 2) * Math.PI) / 180)))));
    DEM = { lat0: b.north, lon0: b.west, step: (b.east - b.west) / cols, stepLat: (b.north - b.south) / rows, rows, cols, z: Array.from({ length: rows }, () => new Array(cols).fill(1000)) };
    FLAT = true;
  }
  if (!DEM) throw new Error('brak modelu terenu (DEM) dla scenariusza ' + SC);
  DEM_FULL = DEM; // full-resolution DEM, kept for the terrain normal map
  if (DEM.cols > 600) DEM = decimate(DEM, 2); // wide backdrop: 2x2 average keeps the mesh ~100k vertices
  // R from synthRun when there is no engine output: replay with signals and patrols only, no POA map
  if (R.schema !== 'rescue-run/1') throw new Error('run.json: schema ' + R.schema);
} catch (e) {
  // a clear message instead of an endless spinner (e.g. a scenario whose run.json is not in the repo)
  const missingRun = /^404 /.test(e.message) && e.message.includes('.run.json');
  document.body.dataset.state = 'error';
  $('loadmsg').innerHTML = missingRun
    ? `Brak wyniku silnika dla scenariusza <b>${esc(SC)}</b> na tym serwerze. Widok 2D pokazuje to, co jest dostępne.`
    : `Widok 3D nie wczytał danych dla scenariusza <b>${esc(SC)}</b> (${esc(e.message)}). Widok 2D działa bez nich.`;
  throw e;
}

// ---------- geo ----------
const stLon = DEM.step, stLat = DEM.stepLat || DEM.step;
const latN = DEM.lat0, latS = DEM.lat0 - DEM.rows * stLat, lonW = DEM.lon0, lonE = DEM.lon0 + DEM.cols * stLon;
const latC = (latN + latS) / 2, lonC = (lonW + lonE) / 2, KX = Math.cos((latC * Math.PI) / 180);
const WKM = (lonE - lonW) * KX * KM, HKM = (latN - latS) * KM;
let zMin = Infinity, zMax = -Infinity;
for (const row of DEM.z) for (const v of row) { if (v < zMin) zMin = v; if (v > zMax) zMax = v; }
const toX = (lon) => (lon - lonC) * KX * KM;
const toZ = (lat) => (latC - lat) * KM;
const toLon = (x) => x / (KX * KM) + lonC;
const toLat = (z) => latC - z / KM;
const inside = ([la, lo]) => la < latN && la > latS && lo > lonW && lo < lonE;
function elevM(lat, lon) {
  const r = clamp((DEM.lat0 - lat) / stLat - 0.5, 0, DEM.rows - 1), c = clamp((lon - DEM.lon0) / stLon - 0.5, 0, DEM.cols - 1);
  const r0 = Math.floor(r), c0 = Math.floor(c), r1 = Math.min(r0 + 1, DEM.rows - 1), c1 = Math.min(c0 + 1, DEM.cols - 1), fr = r - r0, fc = c - c0;
  const z = DEM.z;
  return (z[r0][c0] * (1 - fc) + z[r0][c1] * fc) * (1 - fr) + (z[r1][c0] * (1 - fc) + z[r1][c1] * fc) * fr;
}
// water outside the Tatras: the scenario terrain's waterMask (grid over the scenario bbox: sea, lakes) plus sea-level DEM
// pixels in regions; the Tatra cuts keep their lake circles only. LOW = a lowland region (no Tatra vegetation belts).
const LOW = !!SCENS[SC].region && zMax < 600; // coast, lakes, city; mountain regions (Karkonosze, Bieszczady) keep the vegetation belts
const WM = TER?.waterMask && TER.slopeGrid && SCN?.bbox ? { m: TER.waterMask, rows: TER.slopeGrid.rows, cols: TER.slopeGrid.cols, b: SCN.bbox } : null;
// the coarse test only feeds the sea part of the high-res mask (water3d.js), which then answers isWater
function waterCoarse(la, lo) {
  if (WM && la <= WM.b.north && la >= WM.b.south && lo >= WM.b.west && lo <= WM.b.east) {
    const r = Math.min(WM.rows - 1, Math.floor(((WM.b.north - la) / (WM.b.north - WM.b.south)) * WM.rows)), c = Math.min(WM.cols - 1, Math.floor(((lo - WM.b.west) / (WM.b.east - WM.b.west)) * WM.cols));
    return !!WM.m[r * WM.cols + c];
  }
  return LOW && elevM(la, lo) <= 0.3;
}
const hAt = (lat, lon) => ((elevM(lat, lon) - zMin) * EX) / 1000;
const WR = WM || LOW ? waterRaster({ latN, latS, lonW, lonE, WKM, HKM, W3D, TER, wm: WM, coarse: waterCoarse,
  coarseRad: Math.max(2, Math.round((WM ? Math.max((512 / WM.cols) * ((WM.b.east - WM.b.west) / (lonE - lonW)), 1) : 2) * 0.6)) }) : null;
function isWater(la, lo) { return WR ? WR.at(la, lo) : waterCoarse(la, lo); }

// ---------- OSM land cover (data/<sc>-osm3d.json from make_osm3d.py; (c) OpenStreetMap contributors, ODbL) ----------
// rings are delta-encoded 1e-5 degree integers; land classes are rasterised once (1024 px) for landAt / leafAt, which the
// forest block uses for tree placement and species (contract with it: the class names below, 'water' from isWater)
const dec = (a) => { const o = new Array(a.length); let la = 0, lo = 0; for (let i = 0; i < a.length; i += 2) { la += a[i]; lo += a[i + 1]; o[i] = la / 1e5; o[i + 1] = lo / 1e5; } return o; };
const LAND_CLS = ['forest', 'wood', 'scrub', 'heath', 'meadow', 'grass', 'farmland', 'orchard', 'residential', 'industrial', 'park', 'cemetery', 'beach', 'sand', 'wetland', 'rock'];
const OSM = OSM3D && OSM3D.v === 2 ? {
  bounds: OSM3D.bounds,
  land: (OSM3D.l || []).map(([c, leaf, outer, inner]) => ({ c, leaf, outer: outer.map(dec), inner: (inner || []).map(dec) })),
  roads: (OSM3D.r || []).map(([c, l]) => ({ c, l: dec(l) })),
  bld: (OSM3D.b || []).map(([h, k, r]) => ({ h, k, r: dec(r) })),
} : null;
if (OSM) for (const L of OSM.land) { let a = 0; const r = L.outer[0]; for (let i = 0; i + 3 < r.length; i += 2) a += r[i + 1] * r[i + 2] - r[i + 3] * r[i]; L.area = Math.abs(a); }
const LG = (() => {
  if (!OSM || !OSM.land.length) return null;
  const [s, w, n, e] = OSM.bounds, W = 1024, H = Math.max(64, Math.round((W * (n - s)) / ((e - w) * KX)));
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingEnabled = false; return g; };
  const gc = mk(), gl = mk();
  const ring = (g, r) => { for (let i = 0; i < r.length; i += 2) { const x = ((r[i + 1] - w) / (e - w)) * W, y = ((n - r[i]) / (n - s)) * H; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); };
  // big areas first, so a park inside a residential area or a meadow inside a forest wins
  for (const L of [...OSM.land].sort((a, b) => b.area - a.area)) {
    const k = LAND_CLS.indexOf(L.c); if (k < 0) continue;
    for (const g of [gc, gl]) { g.beginPath(); L.outer.forEach((r) => ring(g, r)); L.inner.forEach((r) => ring(g, r)); }
    gc.fillStyle = `rgb(${(k + 1) * 15},0,0)`; gc.fill('evenodd');
    gl.fillStyle = `rgb(${{ broad: 60, needle: 120, mixed: 180 }[L.leaf] || 0},0,0)`; gl.fill('evenodd');
  }
  return { s, w, n, e, W, H, c: gc.getImageData(0, 0, W, H).data, l: gl.getImageData(0, 0, W, H).data };
})();
const lgAt = (la, lo, buf) => {
  if (!LG || la > LG.n || la < LG.s || lo < LG.w || lo > LG.e) return -1;
  const x = Math.min(LG.W - 1, Math.floor(((lo - LG.w) / (LG.e - LG.w)) * LG.W)), y = Math.min(LG.H - 1, Math.floor(((LG.n - la) / (LG.n - LG.s)) * LG.H));
  return buf[(y * LG.W + x) * 4];
};
function landAt(la, lo) {
  if (isWater(la, lo)) return 'water';
  const v = lgAt(la, lo, LG ? LG.c : null); return v > 0 ? LAND_CLS[Math.round(v / 15) - 1] || null : null;
}
function leafAt(la, lo) {
  const v = lgAt(la, lo, LG ? LG.l : null); return v > 0 ? ['broad', 'needle', 'mixed'][Math.round(v / 60) - 1] || null : null;
}
const v3 = (lat, lon, lift = 0) => new THREE.Vector3(toX(lon), hAt(lat, lon) + lift, toZ(lat));
// Flat scenarios have no grass/height mesh; otherwise nearGrass exposes its exact triangle height.
let meshHeightAt = hAt;
const eyeAt = (lat, lon, eyeM) => new THREE.Vector3(toX(lon), meshHeightAt(lat, lon) + eyeM / 1000, toZ(lat));

// run grid helpers
const B = R.bbox, dLat = (B.north - B.south) / R.rows, dLon = (B.east - B.west) / R.cols;
const segs = new Map();
R.steps[0].segments.forEach((s) => segs.set(s.id, { id: s.id, name: s.name, polygon: s.polygon, areaPct: s.areaPct, n: 0, sLat: 0, sLon: 0, cells: [] }));
R.segOf.forEach((id, i) => {
  const g = segs.get(id); if (!g) return;
  const r = Math.floor(i / R.cols), c = i % R.cols;
  g.n++; g.cells.push(i); g.sLat += B.north - (r + 0.5) * dLat; g.sLon += B.west + (c + 0.5) * dLon;
});
for (const g of segs.values()) g.center = g.n ? [g.sLat / g.n, g.sLon / g.n] : [g.polygon[0][1], g.polygon[0][0]];
const cellOf = (lat, lon) => {
  const r = Math.floor((B.north - lat) / dLat), c = Math.floor((lon - B.west) / dLon);
  return r >= 0 && r < R.rows && c >= 0 && c < R.cols ? r * R.cols + c : -1;
};

// scenario events (signals) and their timeline steps (matched by title == step label, as in 2D)
const EVENTS = (SCN?.events || []).map((e) => ({ ...e, step: R.steps.findIndex((s) => s.label === e.title) }));
const resources = new Map((SCN?.resources || []).map((r) => [r.id, r]));
const isFound = (e) => e.found || e.provider === 'Found' || /ZNALEZIONO/i.test(e.title || '');
const foundEv = EVENTS.find((e) => isFound(e) && e.step >= 0);
const foundStep = foundEv ? foundEv.step : -1;
const foundAt = foundEv?.point || SCN?.truth?.at;
// ---------- evidence toggle ("uwzględnij"), same model as 2D compute() ----------
// A hint's layer is recovered as poaGrid[k] / poaGrid[k-1] (uniform prior for k = 0); switching a hint off divides the
// current map by its layer and renormalises. Exact for the engine's multiplicative model up to run.json rounding.
const OFF = new Set(); // step indices switched off
const layerCache = new Map();
function layerOf(k) {
  if (layerCache.has(k)) return layerCache.get(k);
  const N = R.rows * R.cols, L = new Float64Array(N), prev = k ? R.steps[k - 1].poaGrid : null, cur = R.steps[k].poaGrid;
  for (let i = 0; i < N; i++) { const a = prev ? prev[i] : 1 / N, b = cur[i]; L[i] = a > 0 && b > 0 ? b / a : 1; }
  layerCache.set(k, L); return L;
}
function gridFor(i) {
  const off = [...OFF].filter((k) => k <= i);
  if (!off.length) return null;
  const p = Float64Array.from(R.steps[i].poaGrid);
  for (const k of off) { const L = layerOf(k); for (let c = 0; c < p.length; c++) p[c] /= L[c]; }
  let sum = 0; for (const v of p) sum += v; for (let c = 0; c < p.length; c++) p[c] /= sum;
  return p;
}

// ---------- renderer / scene ----------
const host = $('scene');
// render scheduler state (see "loop"): wake() asks for full-rate frames for a moment, labelsDirty for a label re-layout
let labelsDirty = true, wakeAt = 0;
const wake = () => { wakeAt = performance.now(); };
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // sun and terrain are static: render the shadow map once
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
host.appendChild(renderer.domElement);
const labels = new CSS2DRenderer();
labels.setSize(innerWidth, innerHeight);
// zIndex 1: its own stacking context, so the labels' depth z-indexes stay below the Kino caption and the panels
Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '1' });
host.appendChild(labels.domElement);

const ATMO = installHeightFog(); // fx3d: aerial perspective, valley fog, alpenglow, before any material compiles
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 400);
const controls = new OrbitControls(camera, host); // label drags bubble to the same scene controls
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.46; controls.minDistance = 0.5; controls.maxDistance = 30;
controls.autoRotateSpeed = 0.3;
controls.addEventListener('change', wake);

const lineMats = new Set();
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); labels.setSize(innerWidth, innerHeight);
  for (const m of lineMats) m.resolution.set(innerWidth, innerHeight);
  applyInsets(); wake();
});
// insets (plumbing): in /app the shell's floating panels cover the frame's edges (?insets=T,R,B,L px, then {type:'insets'}).
// The camera's principal point moves to the middle of the free area and the overlays read --inset-* (style3d.css).
let INSETS = (Q.get('insets') || '').split(',').map(Number);
if (INSETS.length !== 4 || INSETS.some((v) => !Number.isFinite(v))) INSETS = [0, 0, 0, 0];
function applyInsets() {
  const [T, Rr, Bm, L] = INSETS, st = document.documentElement.style;
  [['t', T], ['r', Rr], ['b', Bm], ['l', L]].forEach(([k, v]) => st.setProperty('--inset-' + k, v + 'px'));
  const dx = (L - Rr) / 2, dy = (T - Bm) / 2;
  if (dx || dy) camera.setViewOffset(innerWidth, innerHeight, -dx, -dy, innerWidth, innerHeight); else camera.clearViewOffset();
  wake();
}
applyInsets();

// ---------- sun and moon from the step's clock ----------
// NOAA approximation at the scenario's centre, Polish civil time (CEST in summer). The date is early October unless the
// scenario's dark / light steps fit another day better (winter dusk at 16:05, a light summer evening at 18:40): the day
// of year with the fewest contradictions, nearest to 3 October. Weather "Pogoda" off = a fixed afternoon sun.
const DEG = Math.PI / 180;
const clockH = (t) => { const m = /(?:\+(\d+)\s*)?(\d{1,2}):(\d{2})/.exec(t || ''); return m ? (+m[1] || 0) * 24 + +m[2] + +m[3] / 60 : null; };
function solar(doy, h) {
  const ut = h - (doy >= 87 && doy < 299 ? 2 : 1), g = (2 * Math.PI / 365) * (doy - 1 + (ut - 12) / 24);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = ((ut * 60 + eqt + 4 * lonC) / 4 - 180) * DEG, la = latC * DEG;
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
  return { el: el / DEG, az: (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(la) - Math.tan(dec) * Math.cos(la)) / DEG + 540) % 360 };
}
const DOY = (() => {
  const obs = R.steps.map((s) => [clockH(s.t), s.weather?.dark]).filter(([h, d]) => h != null && typeof d === 'boolean'); // replays: no weather yet = unknown
  let best = 276, bs = Infinity;
  if (obs.length) for (let d = 172; d <= 355; d++) {
    let bad = Math.abs(d - 276) * 0.002;
    for (const [h, dark] of obs) { const e = solar(d, h).el; bad += dark ? Math.max(0, e + 1.5) : Math.max(0, 0.5 - e); }
    if (bad < bs) { bs = bad; best = d; }
  }
  return best;
})();
let weatherOn = true;
const sunOfStep = (i) => {
  const s = R.steps[clamp(i, 0, R.steps.length - 1)], h = clockH(s?.t);
  if (!weatherOn || h == null) return { el: 28, az: 215 };
  const p = solar(DOY, h);
  const dark = s.weather?.dark;
  if (typeof dark === 'boolean') p.el = dark ? Math.min(p.el, -2.5) : Math.max(p.el, -1); // the step's own dark flag wins
  return p;
};
// key light: the sun down to 4.5 deg below the horizon (its light kept at >= 3 deg so the shadow map does not streak; the
// baked shadow uses >= 0.8 deg, so after sunset only the peaks stay lit = alpenglow), then the moon in the south-east
const MOON = { el: 32, az: 128 }, KEY_SWITCH = -4.5;
const dirOf = (el, az, v = new THREE.Vector3()) => v.set(Math.cos(el * DEG) * Math.sin(az * DEG), Math.sin(el * DEG), -Math.cos(el * DEG) * Math.cos(az * DEG));
const keyDir = (p, v, minEl = 3) => (p.el > KEY_SWITCH ? dirOf(Math.max(p.el, minEl), p.az, v) : dirOf(MOON.el, MOON.az, v));
const STEP0 = Q.has('step') ? clamp(+Q.get('step') || 0, 0, R.steps.length - 1) : R.value?.beforePing ?? 0;
const SUN_DIR = keyDir(sunOfStep(STEP0)); // key light direction (sun or moon), shared by the shaders
const SKY_SUN = dirOf(sunOfStep(STEP0).el, sunOfStep(STEP0).az); // the sun itself, also below the horizon (twilight glow)

// ---------- sky, lights ----------
const skyMat = FX.sky(SKY_SUN);
skyMat.uniforms.uMoonDir.value.copy(dirOf(MOON.el, MOON.az));
// drawn last of the opaque objects (depth-tested, no depth write): the sky's per-pixel scattering and cloud noise runs
// only where no terrain, tree or building is in front (it sorted first before: same centre as the terrain, lower id)
{ const m = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), skyMat); m.renderOrder = 100; scene.add(m); }
const starGeo = new THREE.BufferGeometry();
{
  const n = 900, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const th = Math.random() * Math.PI * 2, y = 0.15 + Math.random() * 0.85, rr = Math.sqrt(1 - y * y);
    pos.set([Math.cos(th) * rr * 170, y * 170, Math.sin(th) * rr * 170], i * 3);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
}
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
scene.add(new THREE.Points(starGeo, starMat));
// rain / snow (fx3d.precip): 9000 particles in a box that follows the orbit target and scales with the zoom
const precipMat = FX.precip({ uTime: { value: 0 }, uWind: { value: 0.03 }, uDay: { value: 1 } }); // linked to heatU below
const precip = (() => {
  const n = 9000, pos = new Float32Array(n * 3), rnd = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos[i * 3] = Math.random(); pos[i * 3 + 1] = Math.random(); pos[i * 3 + 2] = Math.random(); rnd[i] = Math.random(); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
  const p = new THREE.Points(g, precipMat); p.frustumCulled = false; p.visible = false; p.renderOrder = 2; scene.add(p);
  return p;
})();
// near snow (fx3d.snowNear): world-anchored flakes around the camera, on top of the far layer above
const snowNearMat = FX.snowNear({ uTime: { value: 0 }, uWind: { value: 0.03 }, uDay: { value: 1 } });
const snowNear = (() => {
  const n = 7000, pos = new Float32Array(n * 3), rnd = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos[i * 3] = Math.random(); pos[i * 3 + 1] = Math.random(); pos[i * 3 + 2] = Math.random(); rnd[i] = Math.random(); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
  const p = new THREE.Points(g, snowNearMat); p.frustumCulled = false; p.visible = false; p.renderOrder = 3; scene.add(p);
  return p;
})();
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
scene.add(hemi, sun, sun.target);
scene.fog = new THREE.Fog(0xffffff, 12, 60);

await yieldMain();
// ---------- terrain texture ----------
// texture pixels per DEM pixel: about 3K px across (high-fidelity hillshade and contours), at most 4096 px on either side
const TS = clamp(Math.floor(Math.min(3072 / DEM.cols, 4096 / DEM.rows, renderer.capabilities.maxTextureSize / Math.max(DEM.cols, DEM.rows))), 2, 14);
// the texture samples the full-resolution DEM (the mesh uses the decimated one on wide cuts)
function elevFull(lat, lon) {
  const D = DEM_FULL, sl = D.stepLat || D.step;
  const r = clamp((D.lat0 - lat) / sl - 0.5, 0, D.rows - 1), c = clamp((lon - D.lon0) / D.step - 0.5, 0, D.cols - 1);
  const r0 = Math.floor(r), c0 = Math.floor(c), r1 = Math.min(r0 + 1, D.rows - 1), c1 = Math.min(c0 + 1, D.cols - 1), fr = r - r0, fc = c - c0, z = D.z;
  return (z[r0][c0] * (1 - fc) + z[r0][c1] * fc) * (1 - fr) + (z[r1][c0] * (1 - fc) + z[r1][c1] * fc) * fr;
}
const TW = DEM.cols * TS, TH = DEM.rows * TS;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// base colours, normal map and AO are baked in workers (bake3d.js) while the main thread builds the rest of the scene;
// applyBake() puts the pixels in before the first frame (start). The worker code is the former inline bake: same pixels.
const flatZ = (D) => { const z = new Float64Array(D.rows * D.cols); for (let r = 0; r < D.rows; r++) z.set(D.z[r].length > D.cols ? D.z[r].slice(0, D.cols) : D.z[r], r * D.cols); return z; };
const demMsg = (D) => ({ lat0: D.lat0, lon0: D.lon0, step: D.step, stepLat: D.stepLat, rows: D.rows, cols: D.cols, z: flatZ(D) });
const bakeIn = { full: demMsg(DEM_FULL), dem: DEM === DEM_FULL ? null : demMsg(DEM), TS, KX, KM, EX, LOW,
  WM: WM && { m: Uint8Array.from(WM.m, (v) => (v ? 1 : 0)), rows: WM.rows, cols: WM.cols, b: { north: WM.b.north, south: WM.b.south, east: WM.b.east, west: WM.b.west } } };
// four workers at once: the colours in three row bands, the normal map + AO in the fourth (one worker alone was the
// critical path of the load, ~1.2 s on an efficiency core)
const bakeJob = (() => {
  const run = (part) => new Promise((resolve, reject) => {
    const msg = { ...bakeIn, part };
    const local = () => import('./bake3d.js').then((m) => resolve(m.bakeTerrain(msg)), reject); // no worker: same code here
    try {
      const w = new Worker(new URL('./bake3d.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => { w.terminate(); if (e.data?.error) local(); else resolve(e.data); };
      w.onerror = (e) => { e.preventDefault?.(); w.terminate(); local(); };
      w.postMessage(msg);
    } catch { local(); }
  });
  const n = 3, cut = (k) => Math.round((TH * k) / n);
  return Promise.all([run({ nao: true }), ...Array.from({ length: n }, (_, k) => run({ rows: [cut(k), cut(k + 1)] }))]);
})();
const baseCanvas = document.createElement('canvas'); baseCanvas.width = TW; baseCanvas.height = TH;
// land cover tints, building footprints and roads on the base texture (about 3 m per pixel, so streets read crisply)
function paintOSM(g) {
  const P = (la, lo) => [((lo - DEM.lon0) / stLon) * TS, ((DEM.lat0 - la) / stLat) * TS];
  const path = (r, close) => { for (let i = 0; i < r.length; i += 2) { const [x, y] = P(r[i], r[i + 1]); i ? g.lineTo(x, y) : g.moveTo(x, y); } if (close) g.closePath(); };
  const TINT = { forest: 'rgba(44,88,46,.42)', wood: 'rgba(52,96,50,.42)', scrub: 'rgba(98,118,66,.38)', heath: 'rgba(150,132,92,.32)', meadow: 'rgba(158,186,104,.38)',
    grass: 'rgba(150,190,110,.4)', farmland: 'rgba(222,206,146,.55)', orchard: 'rgba(136,170,92,.45)', residential: 'rgba(214,204,190,.72)', industrial: 'rgba(200,194,204,.75)',
    park: 'rgba(120,172,96,.55)', cemetery: 'rgba(146,164,126,.6)', beach: 'rgba(236,218,172,.85)', sand: 'rgba(226,206,160,.75)', wetland: 'rgba(116,150,140,.5)', rock: 'rgba(176,170,162,.35)' };
  g.save();
  for (const L of [...OSM.land].sort((a, b) => b.area - a.area)) {
    const f = TINT[L.c]; if (!f) continue;
    g.beginPath(); L.outer.forEach((r) => path(r, true)); L.inner.forEach((r) => path(r, true)); g.fillStyle = f; g.fill('evenodd');
    if (L.c === 'farmland' && L.area > 2e-7) { g.save(); g.clip('evenodd'); g.strokeStyle = 'rgba(150,130,80,.18)'; g.lineWidth = 1; const [x0, y0] = P(L.outer[0][0], L.outer[0][1]); for (let k = -400; k < 400; k += 5) { g.beginPath(); g.moveTo(x0 + k, y0 - 400); g.lineTo(x0 + k + 160, y0 + 400); g.stroke(); } g.restore(); }
  }
  g.fillStyle = 'rgba(120,108,100,.85)';
  for (const b of OSM.bld) { g.beginPath(); path(b.r, true); g.fill(); }
  const px = TS / (stLon * KX * KM * 1000) * 1; // texture px per metre
  const ROAD = { major: [11, '#f4f1ea', '#8d7f6c'], minor: [7, '#fbfaf6', '#a59a88'], service: [4, '#f2efe8', null], track: [3, '#9a8462', null], rail: [3, '#4a4a4a', null] };
  for (const pass of [0, 1]) for (const r of OSM.roads) {
    const [wm, fill, casing] = ROAD[r.c] || ROAD.minor; if (pass === 0 && !casing) continue;
    g.beginPath(); path(r.l, false); g.lineCap = 'round'; g.lineJoin = 'round';
    g.lineWidth = Math.max(1, wm * px) + (pass === 0 ? 2 : 0); g.strokeStyle = pass === 0 ? casing : fill;
    g.setLineDash(r.c === 'track' ? [4, 4] : r.c === 'rail' ? [6, 4] : []); g.stroke();
  }
  g.setLineDash([]); g.restore();
}
const compCanvas = document.createElement('canvas'); compCanvas.width = TW; compCanvas.height = TH;
const compTex = new THREE.CanvasTexture(compCanvas); compTex.colorSpace = THREE.SRGBColorSpace; compTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
// POA heat drawn in the terrain shader: two canvas textures (previous / current step) crossfaded by uHeatT, with
// contour edges at the 2x / 5x / 10x stops of the shared scale and a slow pulse on the hotspot
const heatTex = () => { const t = new THREE.CanvasTexture(document.createElement('canvas')); t.colorSpace = THREE.SRGBColorSpace; return t; };
const heatU = { uHeatFrom: { value: heatTex() }, uHeatTo: { value: heatTex() }, uHeatT: { value: 1 }, uHeatOn: { value: new THREE.Vector2() },
  uHeatRect: { value: new THREE.Vector4() }, uHeatEdges: { value: new THREE.Vector3() }, uTime: { value: 0 }, uEmis: { value: 0 },
  uSnowY: { value: ((2350 - zMin) * EX) / 1000 }, uWind: { value: 0.03 },
  uDay: { value: 1 }, uCloud: { value: 0.35 }, uCloudOff: { value: new THREE.Vector2() }, uSunDir: { value: SUN_DIR }, // shared by every fx3d effect
  // water reflection (see "water reflection"): mirrored terrain, its texture projection, the mirror plane, on/off
  uReflTex: { value: Object.assign(new THREE.DataTexture(new Uint8Array(4), 1, 1), { needsUpdate: true }) }, uReflMat: { value: new THREE.Matrix4() }, uReflY: { value: -99 }, uReflOn: { value: 0 },
  uNight: { value: 0 } }; // night glow (lit windows), from the mood in glowTick
Object.assign(precipMat.uniforms, { uTime: heatU.uTime, uWind: heatU.uWind, uDay: heatU.uDay });
Object.assign(snowNearMat.uniforms, { uTime: heatU.uTime, uWind: heatU.uWind, uDay: heatU.uDay });

await yieldMain();
const terrainGeo = new THREE.PlaneGeometry(WKM, HKM, DEM.cols - 1, DEM.rows - 1);
terrainGeo.rotateX(-Math.PI / 2);
{
  const pos = terrainGeo.attributes.position;
  for (let r = 0; r < DEM.rows; r++) for (let c = 0; c < DEM.cols; c++) pos.setY(r * DEM.cols + c, ((DEM.z[r][c] - zMin) * EX) / 1000);
  terrainGeo.computeVertexNormals();
}
// object-space normal map from the full-resolution DEM: the mesh is averaged 2x2 for the wide cut, the shading keeps every ridge
let terrainAO = null, sunMask = null, sunAt = () => 1, sunBake = null;
const normalTex = (() => {
  const k = DEM_FULL.cols / DEM.cols >= 1.5 ? 2 : 1, C = DEM.cols * k, Rr = DEM.rows * k, Z = DEM_FULL.z;
  const sx = 2 * (DEM_FULL.step * KX * KM), sz = 2 * ((DEM_FULL.stepLat || DEM_FULL.step) * KM), f = EX / 1000;
  const data = new Uint8Array(C * Rr * 4); // normal map: filled by the worker (applyBake)
  const t = new THREE.DataTexture(data, C, Rr, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.needsUpdate = true;
  // flat height array in scene units, for the sun bake below
  const H = new Float32Array(C * Rr); for (let r = 0; r < Rr; r++) for (let c = 0; c < C; c++) H[r * C + c] = Z[r][c] * f;
  const ao = new Uint8Array(C * Rr * 4), px = sx / 2, pz = sz / 2; // ambient occlusion: filled by the worker (applyBake)
  const a = new THREE.DataTexture(ao, C, Rr, THREE.RGBAFormat);
  a.magFilter = THREE.LinearFilter; a.minFilter = THREE.LinearMipmapLinearFilter; a.generateMipmaps = true; a.needsUpdate = true;
  terrainAO = a;
  // baked terrain self-shadow (far cascade) on a half-resolution grid: march from every cell towards the sun (or moon),
  // soft penumbra. Rows r0..r1, so a re-bake when the light moves can be spread over a few frames (sunBake).
  const C2 = C >> 1, R2 = Rr >> 1, px2 = px * 2, pz2 = pz * 2, stepKm = Math.min(px2, pz2);
  const H2 = new Float32Array(C2 * R2); let hMax = -Infinity;
  for (let r = 0; r < R2; r++) for (let c = 0; c < C2; c++) { const v = H[2 * r * C + 2 * c]; H2[r * C2 + c] = v; if (v > hMax) hMax = v; }
  const bakeRows = (dir, sm, smData, r0, r1) => {
    const hd = Math.max(Math.hypot(dir.x, dir.z), 1e-3), rise = (dir.y / hd) * stepKm, dcs = (dir.x / hd) * stepKm / px2, drs = (dir.z / hd) * stepKm / pz2;
    for (let r = r0; r < r1; r++) for (let c = 0; c < C2; c++) {
      let ray = H2[r * C2 + c], lit = 1, cc = c, rr = r;
      for (let k = 1; k < 400; k++) {
        cc += dcs; rr += drs; ray += rise;
        if (ray > hMax || cc < 0 || rr < 0 || cc > C2 - 1 || rr > R2 - 1) break;
        const d = (ray - H2[Math.round(rr) * C2 + Math.round(cc)]) / (k * stepKm * 0.035); // ~2 deg penumbra
        if (d < lit) { lit = d; if (lit <= -1) break; }
      }
      const v = clamp(0.5 + 0.5 * lit, 0, 1), o = ((R2 - 1 - r) * C2 + c) * 4;
      if (sm) sm[r * C2 + c] = v;
      smData[o] = smData[o + 1] = smData[o + 2] = v * 255; smData[o + 3] = 255;
    }
  };
  const maskTex = (data) => { const t = new THREE.DataTexture(data, C2, R2, THREE.RGBAFormat); t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t; };
  const sm = new Float32Array(C2 * R2), smData = new Uint8Array(C2 * R2 * 4);
  bakeRows(keyDir(sunOfStep(STEP0), new THREE.Vector3(), 0.8), sm, smData, 0, R2);
  sunMask = maskTex(smData);
  sunBake = { rows: R2, run: (dir, tex, r0, r1) => bakeRows(dir, null, tex.image.data, r0, r1), tex: () => maskTex(new Uint8Array(C2 * R2 * 4)) };
  const sLat = 2 * (DEM_FULL.stepLat || DEM_FULL.step), sLon = 2 * DEM_FULL.step;
  sunAt = (lat, lon) => sm[clamp(Math.round((DEM_FULL.lat0 - lat) / sLat - 0.5), 0, R2 - 1) * C2 + clamp(Math.round((lon - DEM_FULL.lon0) / sLon - 0.5), 0, C2 - 1)];
  return t;
})();
const terrainMat = new THREE.MeshStandardMaterial({ map: compTex, emissive: 0x000000, roughness: 0.96, metalness: 0,
  normalMap: normalTex, normalMapType: THREE.ObjectSpaceNormalMap, aoMap: terrainAO, aoMapIntensity: 0.8 });
heatU.uSunMask = { value: sunMask }; heatU.uSunMask2 = { value: sunBake.tex() }; heatU.uSunMaskT = { value: 0 }; // crossfaded on a re-bake
// fx3d: close-up detail, POA heat layer, baked + near sun shadow, drifting cloud shadows, snow glints
heatU.uSnowCover = heatU.uSnowCover || { value: 0 };
const POD3D = R.timeline?.actors?.length ? createCoverage3D({ THREE, rows: R.rows, cols: R.cols, rect: heatU.uHeatRect }) : null;
applyFx(terrainMat, [FX.terrainDetail(), FX.snowCover(heatU), POD3D?.effect, FX.poaHeat(heatU), FX.bakedSun(heatU), FX.cloudShadows(heatU), FX.snowGlints(heatU)]);
const terrain = new THREE.Mesh(terrainGeo, terrainMat);
terrain.castShadow = true; terrain.receiveShadow = true;
scene.add(terrain);
// sea and lakes outside the Tatras as a real water surface (fx3d.seaWaves): the terrain mesh itself, lifted 3 m, shows
// only where isWater says water: water3d.js's ~4 m mask (rivers as ribbons at their OSM width, lake polygons, the sea
// from the scenario waterMask), softened so its edge is a smooth shore line and the 0.5..0.9 band carries the surf
let seaMesh = null;
const WATER = []; // water bodies for the reflection plane: { x, z, r, y (surface without waves), sea }
if (WR && WR.n > 20) { // the mask is water3d.js's high-res raster (row 0 = south), one byte per pixel
  const tex = new THREE.DataTexture(WR.tex, WR.W, WR.H, THREE.RedFormat); tex.unpackAlignment = 1; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  const seaMat = new THREE.MeshStandardMaterial({ color: 0x14606f, emissive: 0x020c10, roughness: 0.07, metalness: 0.05, envMapIntensity: 1.25 });
  applyFx(seaMat, [FX.seaWaves(heatU, tex, new THREE.Vector4(-WKM / 2, HKM / 2, WKM, HKM)), FX.waterReflect(heatU, 'sea')]);
  seaMesh = new THREE.Mesh(terrainGeo, seaMat); seaMesh.position.y = 0.003; seaMesh.receiveShadow = true; seaMesh.renderOrder = 1; scene.add(seaMesh);
  const st = Math.max(1, Math.round(Math.sqrt(WR.n / 1500))); // ~1500 samples of open water with their surface height (reflection plane)
  for (let r = 0; r < WR.H; r += st) for (let c = 0; c < WR.W; c += st) if (WR.tex[r * WR.W + c] > 230) {
    const la = latS + ((r + 0.5) / WR.H) * (latN - latS), lo = lonW + ((c + 0.5) / WR.W) * (lonE - lonW);
    WATER.push({ x: toX(lo), z: toZ(la), r: (st * WKM) / WR.W, y: hAt(la, lo) + 0.003, sea: true });
  }
}
{
  const S = Math.max(WKM, HKM) * 0.75, cam = sun.shadow.camera;
  cam.left = -S; cam.right = S; cam.top = S; cam.bottom = -S; cam.near = 0.1; cam.far = 80; cam.updateProjectionMatrix();
  sun.position.copy(SUN_DIR).multiplyScalar(30); sun.target.position.set(0, 0, 0);
}
{
  // diorama skirt: earth cut down to a base plate
  const base = -0.25, pos = terrainGeo.attributes.position, verts = [], idx = [];
  const edge = (ids) => {
    const o = verts.length / 3;
    ids.forEach((id) => verts.push(pos.getX(id), pos.getY(id), pos.getZ(id), pos.getX(id), base, pos.getZ(id)));
    for (let i = 0; i < ids.length - 1; i++) { const a = o + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  };
  const C = DEM.cols, Rw = DEM.rows, seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  edge(seq(C, (i) => i)); edge(seq(C, (i) => (Rw - 1) * C + (C - 1 - i))); edge(seq(Rw, (i) => (Rw - 1 - i) * C)); edge(seq(Rw, (i) => i * C + C - 1));
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); g.setIndex(idx); g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x7a6248, roughness: 1, side: THREE.DoubleSide })));
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(WKM, HKM).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4a3f34, roughness: 1 }));
  plate.position.y = base; scene.add(plate);
}

await yieldMain();
// ---------- heat (POA) ----------
const RAMP = [[0, [255, 214, 102]], [0.35, [252, 163, 17]], [0.65, [232, 93, 4]], [0.85, [208, 0, 0]], [1, [157, 2, 8]]];
const heatRect = {
  x: ((B.west - DEM.lon0) / stLon) * TS, y: ((DEM.lat0 - B.north) / stLat) * TS,
  w: ((B.east - B.west) / stLon) * TS, h: ((B.north - B.south) / stLat) * TS,
};
heatU.uHeatRect.value.set(heatRect.x / TW, heatRect.y / TH, heatRect.w / TW, heatRect.h / TH);
heatU.uHeatEdges.value.set(STOPS[2].alpha, STOPS[3].alpha, STOPS[4].alpha); // 2x, 5x, 10x contours
function heatCanvasGrid(p) {
  let mx = 0, mn = Infinity; for (const v of p) { if (v > mx) mx = v; if (v < mn) mn = v; }
  if (mx - mn < 1e-12) return null; // uniform (replay without engine output): no heat
  const small = document.createElement('canvas'); small.width = R.cols; small.height = R.rows;
  const g = small.getContext('2d'), img = g.createImageData(R.cols, R.rows);
  // shared scale (rescue/app/scale.js): colour by "times the average cell", stops 0.5x/1x/2x/5x/10x/25x+, same as 2D
  const N = p.length;
  for (let i = 0; i < N; i++) { const [r, gg, b, a] = colorFor(p[i], N); img.data.set([r, gg, b, Math.round(a * 255)], i * 4); }
  g.putImageData(img, 0, 0);
  const mid = document.createElement('canvas'); mid.width = R.cols * 4; mid.height = R.rows * 4;
  const gm = mid.getContext('2d'); gm.imageSmoothingQuality = 'high'; gm.drawImage(small, 0, 0, mid.width, mid.height);
  const out = document.createElement('canvas'); out.width = Math.round(heatRect.w); out.height = Math.round(heatRect.h);
  const go = out.getContext('2d'); go.imageSmoothingQuality = 'high'; go.filter = 'blur(2px)'; go.drawImage(mid, 0, 0, out.width, out.height);
  return out;
}
const heatCache = new Map();
const heatOf = (i) => { if (!heatCache.has(i)) heatCache.set(i, heatCanvasGrid(R.steps[i].poaGrid)); return heatCache.get(i); };
let heatFrom = null, heatTo = null, heatT = 1, WASH = new Map(), TL_COV = [], fppHeat = 1; // searched segment id -> times searched
const llToTex = (la, lo) => [((lo - DEM.lon0) / stLon) * TS, ((DEM.lat0 - la) / stLat) * TS];
function compose() {
  const g = compCanvas.getContext('2d');
  g.globalAlpha = 1; g.drawImage(ORTHO.on && ORTHO.canvas ? ORTHO.canvas : baseCanvas, 0, 0);
  if (SHOW_DIFF) g.drawImage(diffLayer(), heatRect.x, heatRect.y, heatRect.w, heatRect.h); // the heat itself is drawn by the terrain shader
  heatU.uHeatOn.value.set(!SHOW_DIFF && heatFrom ? fppHeat : 0, !SHOW_DIFF && heatTo ? fppHeat : 0);
  // searched ground: cool grey wash with hatching, stronger for repeated searches
  for (const [id, n] of WASH) {
    const sg = segs.get(id); if (!sg?.polygon?.length) continue;
    g.beginPath(); sg.polygon.forEach(([lo, la], j) => { const [x, y] = llToTex(la, lo); j ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath();
    g.fillStyle = `rgba(214, 222, 232, ${Math.min(0.22 + 0.12 * (n - 1), 0.5)})`; g.fill();
    g.save(); g.clip(); g.strokeStyle = 'rgba(70, 84, 104, 0.35)'; g.lineWidth = 1.4;
    for (let x = -TH; x < TW; x += 9) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + TH, TH); g.stroke(); }
    g.restore();
  }
  compTex.needsUpdate = true;
}
let SHOW_DIFF = false, diffCanvas = null;
// aerial photo layer (button "Zdjęcie"): Sentinel-2 cloudless 2016 resampled onto the wide DEM grid by data/make_ortho.py,
// drawn instead of the topo base, so the searched wash, the difficulty layer and the shader heat stay on top
const ORTHO = { on: false, canvas: null };
if (SCENS[SC].ortho && (!SCENS[SC].demWide || WIDE)) { // the photo is made for the wide cut
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = TW; c.height = TH;
    const g = c.getContext('2d'); g.filter = 'brightness(1.45) contrast(1.08) saturate(1.15)'; // satellite photos are dark next to the topo tint
    const sw = img.width * (DEM.cols * stLon) / (DEM_FULL.cols * DEM_FULL.step), sh = img.height * (DEM.rows * stLat) / (DEM_FULL.rows * (DEM_FULL.stepLat || DEM_FULL.step));
    g.drawImage(img, 0, 0, sw, sh, 0, 0, TW, TH);
    ORTHO.canvas = c; $('btn-ortho').hidden = false;
  };
  img.src = SCENS[SC].ortho;
}
$('btn-ortho').addEventListener('click', () => {
  ORTHO.on = !ORTHO.on; $('btn-ortho').classList.toggle('on', ORTHO.on); compose();
  let a = $('ortho-attrib');
  if (!a) { a = document.createElement('div'); a.id = 'ortho-attrib'; a.innerHTML = 'Zdjęcie: <a href="https://cloudless.eox.at" target="_blank" rel="noopener">EOxCloudless</a> 2016, EOX IT Services GmbH (zmodyfikowane dane Copernicus Sentinel 2016), CC BY 4.0'; document.body.appendChild(a); }
  a.hidden = !ORTHO.on;
});
function diffLayer() {
  if (diffCanvas) return diffCanvas;
  const small = document.createElement('canvas'); small.width = R.cols; small.height = R.rows;
  const g = small.getContext('2d'), img = g.createImageData(R.cols, R.rows);
  (R.difficulty || []).forEach((d, i) => { const c = new THREE.Color(DIFF_COLORS[d] || '#000'); img.data.set([c.r * 255, c.g * 255, c.b * 255, d >= 0 ? 165 : 0], i * 4); });
  g.putImageData(img, 0, 0);
  const out = document.createElement('canvas'); out.width = Math.round(heatRect.w); out.height = Math.round(heatRect.h);
  const go = out.getContext('2d'); go.imageSmoothingEnabled = false; go.drawImage(small, 0, 0, out.width, out.height);
  return (diffCanvas = out);
}
const showHeat = (cv, animate = true) => {
  heatFrom = animate ? heatTo : null; heatTo = cv; heatT = heatFrom ? 0 : 1; heatU.uHeatT.value = heatT;
  for (const [u, c] of [[heatU.uHeatFrom, heatFrom], [heatU.uHeatTo, heatTo]]) if (c && u.value.image !== c) {
    if (u.value.image.width !== c.width || u.value.image.height !== c.height) u.value.dispose(); // immutable GPU storage: re-allocate on size change
    u.value.image = c; u.value.needsUpdate = true;
  }
  compose();
};

// ---------- lines, pins, labels ----------
function densify(pts, maxKm = 0.03) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    if (i) {
      const [la0, lo0] = pts[i - 1], [la1, lo1] = pts[i];
      const n = Math.ceil(Math.hypot((lo1 - lo0) * KX * KM, (la1 - la0) * KM) / maxKm);
      for (let k = 1; k < n; k++) out.push([la0 + ((la1 - la0) * k) / n, lo0 + ((lo1 - lo0) * k) / n]);
    }
    out.push(pts[i]);
  }
  return out;
}
function makeLine(vecs, { color = '#222', width = 2, opacity = 1, dashed = false, dash = 0.05, gap = 0.04 } = {}) {
  const geo = new LineGeometry(); geo.setPositions(vecs.flatMap((v) => [v.x, v.y, v.z]));
  const mat = new LineMaterial({ color, linewidth: width, transparent: opacity < 1, opacity, dashed, dashSize: dash, gapSize: gap });
  mat.resolution.set(innerWidth, innerHeight); lineMats.add(mat);
  const l = new Line2(geo, mat); if (dashed) l.computeLineDistances();
  return l;
}
// draped polyline in [lat, lon]; parts outside the DEM are dropped
// Batched: every group keeps one LineSegments2 per style (colour, width, dash...), so a layer of 100 outlines is one
// draw call. Runs are collected here and uploaded once, right before the next frame renders (flushLines).
const dirtyLines = new Set(), flowMats = new Set(); // flowMats: dashes animated along the line (streams)
function drapeRuns(latlon, lift, opts, group) {
  const key = JSON.stringify(opts), batches = group.userData.lines || (group.userData.lines = new Map());
  let b = batches.get(key);
  if (!b) batches.set(key, (b = { group, opts, pts: [], obj: null }));
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      let a = v3(run[0][0], run[0][1], lift);
      for (let i = 1; i < run.length; i++) { const c = v3(run[i][0], run[i][1], lift); b.pts.push(a.x, a.y, a.z, c.x, c.y, c.z); a = c; }
      dirtyLines.add(b);
    }
    run = [];
  };
  for (const p of densify(latlon)) { if (inside(p)) run.push(p); else flush(); }
  flush();
}
function flushLines() {
  for (const b of dirtyLines) {
    const { color = '#222', width = 2, opacity = 1, dashed = false, dash = 0.05, gap = 0.04 } = b.opts; // flow: see flowMats
    if (!b.obj) {
      const mat = new LineMaterial({ color, linewidth: width, transparent: opacity < 1, opacity, dashed, dashSize: dash, gapSize: gap });
      mat.resolution.set(innerWidth, innerHeight); lineMats.add(mat); if (b.opts.flow) flowMats.add(mat);
      b.obj = new LineSegments2(new LineSegmentsGeometry(), mat); b.group.add(b.obj);
    } else { b.obj.geometry.dispose(); b.obj.geometry = new LineSegmentsGeometry(); }
    b.obj.geometry.setPositions(b.pts);
    if (dashed) b.obj.computeLineDistances();
  }
  dirtyLines.clear();
}
const ringLL = (poly) => poly.map(([lo, la]) => [la, lo]); // polygons are [lon, lat]
const circleLL = ([la, lo], rM, n = 96) => Array.from({ length: n + 1 }, (_, i) => {
  const a = (i / n) * Math.PI * 2; return [la + (Math.sin(a) * rM) / 1000 / KM, lo + (Math.cos(a) * rM) / 1000 / (KM * KX)];
});
function disposeGroup(g) {
  for (const b of g.userData.lines?.values() || []) dirtyLines.delete(b);
  g.userData.lines = null; labelsDirty = true;
  g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { lineMats.delete(o.material); o.material.dispose(); } if (o.isCSS2DObject) o.element.remove(); });
  g.clear();
}
function label(html, cls, pos) {
  const el = document.createElement('div'); el.className = 'lbl3d ' + (cls || ''); el.innerHTML = html; labelsDirty = true;
  el.style.willChange = 'transform'; // own compositor layer: moving a label is not a repaint of its shadow over the canvas (-4 ms/frame while orbiting)
  const o = new CSS2DObject(el); o.position.copy(pos); LBLS.add(o); return o;
}
// ---------- label declutter (AI Mateusza #2) ----------
// Screen-space pass after the CSS2D layout: labels by priority (top 3 > IPP / find / selected unit > unit and team chips,
// current signal > older signal chips > huts, rings), each placed where it does not overlap one already placed - a pin label
// (IPP, find) may step up or down one line first, the rest fade out (opacity, no clicks). Top 3 always stay, on top of
// everything (style3d.css). Sizes are measured once per text (no layout reads while orbiting); ~0.1 ms for 50 labels, at most 10 Hz.
const LBLS = new Set(), LB_SIZE = new WeakMap(), _lp = new THREE.Vector3();
const lbPrio = (el) => { const c = el.classList;
  return c.contains('top3') ? 6 : c.contains('ipp') || c.contains('found') || c.contains('target') ? 5 : c.contains('patrol') ? 4.5
    : c.contains('team') || c.contains('cur') ? 4 : c.contains('sig') ? 3 : c.contains('hut') ? 2 : 1; };
let lbAt = 0, lbDue = true;
function declutter(now) {
  if (now - lbAt < 100) { lbDue = true; return; }
  lbAt = now; lbDue = false;
  const W = innerWidth, H = innerHeight, items = [];
  for (const o of LBLS) {
    const el = o.element; let root = o; while (root.parent) root = root.parent;
    if (root !== scene) { if (o.userData.lbSeen && !el.isConnected) LBLS.delete(o); continue; }
    o.userData.lbSeen = true;
    if (el.style.display === 'none' || el.style.visibility === 'hidden' || !el.isConnected) continue;
    const txt = el.textContent; let sz = LB_SIZE.get(el);
    if (!sz || sz.t !== txt || !sz.w) { el.style.translate = ''; sz = { t: txt, w: el.offsetWidth, h: el.offsetHeight }; LB_SIZE.set(el, sz); }
    o.getWorldPosition(_lp).project(camera);
    const x = ((_lp.x + 1) * W) / 2, y = ((1 - _lp.y) * H) / 2;
    items.push({ el, x, y, w: sz.w + 4, h: sz.h + 2, p: lbPrio(el) + (el.getAttribute('aria-pressed') === 'true' ? 1.5 : 0), d: _lp.z });
  }
  items.sort((a, b) => b.p - a.p || a.d - b.d);
  const placed = [], hit = (l, t, w, h) => placed.some((b) => l < b.l + b.w && l + w > b.l && t < b.t + b.h && t + h > b.t);
  for (const it of items) {
    let dy = 0, ok = it.p >= 6; // top 3: always shown (two top-3 labels may touch; never hidden)
    if (!ok) for (const c of it.p >= 5 ? [0, -it.h, it.h] : [0]) if (!hit(it.x - it.w / 2, it.y - it.h / 2 + c, it.w, it.h)) { dy = c; ok = true; break; }
    const st = it.el.style;
    if (!st.transition) st.transition = 'opacity .18s';
    st.opacity = ok ? '' : '0';
    if (!ok) st.pointerEvents = 'none'; else if (it.el.dataset.actorId) st.pointerEvents = 'auto';
    st.translate = dy ? `0 ${dy}px` : '';
    if (ok) placed.push({ l: it.x - it.w / 2, t: it.y - it.h / 2 + dy, w: it.w, h: it.h });
  }
}
const ballGeo = new THREE.SphereGeometry(1, 16, 12);
// night glow halos (see "night glow"): [colour, size px] by pin class; any object with userData.glow gets one
const GLOW = { ipp: ['#ffcf6e', 150], hut: ['#ffad5c', 105], found: ['#7dffb4', 175], target: ['#ff8070', 170] };
function pin(lat, lon, color, h = 0.2, html = null, cls = '', r = 0.016) {
  const g = new THREE.Group(), p0 = v3(lat, lon, 0.004), p1 = p0.clone().add(new THREE.Vector3(0, h, 0));
  g.add(makeLine([p0, p1], { color: '#2b2f33', width: 1.4, opacity: 0.85 }));
  const head = new THREE.Mesh(ballGeo, new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
  head.scale.setScalar(r); head.position.copy(p1); g.add(head);
  if (GLOW[cls.split(' ')[0]]) head.userData.glow = GLOW[cls.split(' ')[0]];
  if (html) g.add(label(html, cls, p1.clone().add(new THREE.Vector3(0, r, 0))));
  return g;
}

// ---------- static map features ----------
const TRAIL_COL = { czerwony: '#d62828', niebieski: '#1d5fbf', zielony: '#2b9348', 'żółty': '#d9a400', czarny: '#222222' };
const statics = new THREE.Group(); scene.add(statics);
for (const t of TER?.trails || []) {
  const key = (t.name || '').split(/[\s:]/)[0].toLowerCase();
  drapeRuns(t.points, 0.013, { color: '#fbf8f0', width: 4, opacity: 0.55 }, statics);
  drapeRuns(t.points, 0.014, { color: TRAIL_COL[key] || '#555', width: 2 }, statics);
}
// streams: a blue bed plus light dashes running downstream (OSM waterways are drawn in the flow direction)
for (const s of TER?.streams || []) {
  drapeRuns(s.points, 0.008, { color: '#3a86c8', width: 1.6, opacity: 0.8 }, statics);
  drapeRuns(s.points, 0.0085, { color: '#d8f1ff', width: 1.2, opacity: 0.9, dashed: true, dash: 0.014, gap: 0.035, flow: true }, statics);
}
// lakes: a polar grid (unit radius, 24 rings) so the vertex shader has vertices to move; fx3d waves do the rest
const waterMat = new THREE.MeshStandardMaterial({ color: 0x14606f, emissive: 0x020c10, roughness: 0.07, metalness: 0.05, envMapIntensity: 1.25 });
applyFx(waterMat, [FX.lakeWaves(heatU), FX.waterReflect(heatU, 'waves')]); // fx3d: waves, foam, depth tint, sun glitter, mirrored mountains
const lakeGeo = new THREE.RingGeometry(0.0001, 1, 96, 24).rotateX(-Math.PI / 2);
for (const l of seaMesh ? [] : TER?.lakes || []) { // regions: lakes come with the sea surface above
  const m = new THREE.Mesh(lakeGeo, waterMat), r = l.radiusM / 1000;
  m.scale.set(r, 1, r); m.position.copy(v3(l.center[0], l.center[1], 0.005)); statics.add(m);
  WATER.push({ x: m.position.x, z: m.position.z, r, y: m.position.y, sea: false });
}
for (const h of TER?.huts || []) statics.add(pin(h.at[0], h.at[1], '#7f5539', 0.07, esc(h.name), 'hut', 0.011));
for (const g of segs.values()) drapeRuns(ringLL(g.polygon), 0.016, { color: '#2b2f33', width: 1, opacity: 0.28 }, statics);
statics.add(pin(R.ipp.lat, R.ipp.lon, '#b8860b', 0.3, 'IPP · ostatnio widziany', 'ipp', 0.02));

await yieldMain();
// ---------- forests: instanced trees by species ----------
// Tatras: vegetation belts by elevation (lower montane beech-fir-spruce with larch, upper montane spruce with larch and
// rowan, dwarf pine above, shrubs scattered on the meadows). Outside the Tatras: the OSM landcover (landAt / leafAt from
// the osm3d data) when the scenario has it, else mixed lowland woods in noise patches. October: larches gold, beeches
// copper, birches yellow, rowans red, conifers green. One InstancedMesh per species, low-poly unit-height geometry.
const forest = new THREE.Group(); scene.add(forest);
let forestLod = null; // near / far tree meshes re-split by camera distance (forest block), called from the loop
{
  let seed = 1234567; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // cheap value noise for natural patches
  const NS = 64, nv = Float32Array.from({ length: NS * NS }, rnd);
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, at = (a, b) => nv[((a % NS) + NS) % NS + (((b % NS) + NS) % NS) * NS];
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return (at(xi, yi) * (1 - u) + at(xi + 1, yi) * u) * (1 - v) + (at(xi, yi + 1) * (1 - u) + at(xi + 1, yi + 1) * u) * v;
  };
  const pick = (table) => { let r = rnd(), acc = 0; for (const [k, p] of table) { acc += p; if (r < acc) return k; } return table[table.length - 1][0]; };

  // geometry: parts with a vertex colour each (crown white so the instance colour is the foliage, trunk brown/white)
  const part = (g, col, y, sx = 1, sy = 1, jitter = 0) => {
    g = g.index ? g.toNonIndexed() : g.clone(); g.deleteAttribute('uv'); g.deleteAttribute('normal'); g.scale(sx, sy, sx); g.translate(0, y, 0);
    const p = g.attributes.position;
    if (jitter) { const key = (i) => `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`, off = new Map();
      for (let i = 0; i < p.count; i++) { const k = key(i); if (!off.has(k)) off.set(k, [(rnd() - 0.5) * jitter, (rnd() - 0.5) * jitter, (rnd() - 0.5) * jitter]); const o = off.get(k); p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]); } }
    const c = new THREE.Color(col), cols = new Float32Array(p.count * 3); for (let i = 0; i < p.count; i++) cols.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3)); return g;
  };
  const merge = (parts) => {
    const n = parts.reduce((a, g) => a + g.attributes.position.count, 0), pos = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
    for (const g of parts) { pos.set(g.attributes.position.array, o * 3); col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
  };
  const W = '#ffffff', BARK = '#6b4c34', BIRCH = '#e8e4da';
  // low-poly on purpose (~20-40 triangles a tree, tens of thousands of trees): no trunk caps, no cone bases, 20-face crowns
  const trunk = (h, r = 0.045, col = BARK) => part(new THREE.CylinderGeometry(r * 0.7, r, h, 5, 1, true), col, h / 2);
  const cone = (r, h) => new THREE.ConeGeometry(r, h, 7, 1, true), blob = (r) => new THREE.IcosahedronGeometry(r, 0);
  const GEO = {
    spruce: merge([trunk(0.14), part(cone(0.44, 0.48), W, 0.32), part(cone(0.37, 0.48), W, 0.56), part(cone(0.27, 0.46), W, 0.78)]),
    fir: merge([trunk(0.12), part(new THREE.CylinderGeometry(0.1, 0.4, 0.55, 7, 1, true), W, 0.38), part(cone(0.3, 0.45), W, 0.76)]),
    larch: merge([trunk(0.16, 0.04), part(cone(0.27, 0.86), W, 0.57)]),
    pine: merge([trunk(0.62, 0.04), part(blob(0.34), W, 0.8, 1, 0.5, 0.06)]),
    mugo: merge([part(blob(0.5), W, 0.18, 1, 0.45), part(blob(0.34), W, 0.14, 1, 0.5).translate(0.32, 0, 0.12)]),
    broad: merge([trunk(0.42, 0.05), part(blob(0.4), W, 0.68, 1, 0.82, 0.1), part(blob(0.28), W, 0.6, 1, 0.8, 0.08).translate(0.2, 0, -0.12)]),
    birch: merge([trunk(0.5, 0.03, BIRCH), part(blob(0.25), W, 0.74, 0.85, 1.35, 0.05)]),
    shrub: merge([part(blob(0.5), W, 0.26, 1, 0.6, 0.12)]),
  };
  // species: geometry, height range (km), palette (October)
  const SP = {
    spruce: { geo: GEO.spruce, h: [0.026, 0.046], cols: ['#22492b', '#2f5d34', '#3b6a3e', '#28503a'] },
    fir: { geo: GEO.fir, h: [0.024, 0.04], cols: ['#24503f', '#335f4c', '#2b5844'] },
    larch: { geo: GEO.larch, h: [0.024, 0.04], cols: ['#d9a521', '#e8b93a', '#c98f1c', '#b8a23a', '#9aa53a'] },
    pine: { geo: GEO.pine, h: [0.02, 0.034], cols: ['#3d6638', '#4f7240', '#466a3a'] },
    mugo: { geo: GEO.mugo, h: [0.01, 0.02], cols: ['#4c7639', '#5e8541', '#6d9346'] },
    beech: { geo: GEO.broad, h: [0.02, 0.036], cols: ['#c8641e', '#d98a2b', '#b5501a', '#e0a33a', '#8f8a2e'] },
    oak: { geo: GEO.broad, h: [0.018, 0.032], cols: ['#a07a2c', '#8b6a2a', '#7a7a2e', '#b58f3a', '#6f7a34'] },
    birch: { geo: GEO.birch, h: [0.016, 0.028], cols: ['#e8c93a', '#f0d75a', '#c9b23a', '#d8c04a'] },
    rowan: { geo: GEO.broad, h: [0.008, 0.014], cols: ['#c0392b', '#d35400', '#a93226', '#c8551e'] },
    fruit: { geo: GEO.broad, h: [0.008, 0.012], cols: ['#7d8f34', '#a39a36', '#c9a33a'] },
    shrub: { geo: GEO.shrub, h: [0.006, 0.012], cols: ['#7a8a3a', '#8e7a3a', '#6a7a40', '#a0682a', '#5f7a3f'] },
  };
  const list = Object.fromEntries(Object.keys(SP).map((k) => [k, []]));

  const lakes = (TER?.lakes || []).map((l) => ({ la: l.center[0], lo: l.center[1], r: (l.radiusM + 25) / 1000 }));
  const inLake = (la, lo) => lakes.some((l) => Math.hypot((la - l.la) * KM, (lo - l.lo) * KM * KX) < l.r);
  // OSM landcover (other session's osm3d data): used when the helper exists and knows this area
  const LC = typeof landAt === 'function' ? landAt : null, LEAF = typeof leafAt === 'function' ? leafAt : () => null;
  let useLC = false;
  if (LC) for (let k = 0; k < 400 && !useLC; k++) useLC = !!LC(latS + rnd() * (latN - latS), lonW + rnd() * (lonE - lonW));
  const DENS = { forest: 0.9, wood: 0.9, scrub: 0.55, heath: 0.25, park: 0.22, cemetery: 0.3, orchard: 0.4 };
  const tries = FLAT ? 0 : Q.has('trees') ? +Q.get('trees') : Math.round(clamp(WKM * HKM * 2000, 40000, 140000)); // no forest guessed on flat fallback ground
  for (let n = 0; n < tries; n++) {
    const la = latS + rnd() * (latN - latS), lo = lonW + rnd() * (lonE - lonW), e = elevM(la, lo);
    const dz = Math.hypot(elevM(la, lo + 0.0004) - elevM(la, lo - 0.0004), elevM(la + 0.0003, lo) - elevM(la - 0.0003, lo)) / 2 / 33;
    const slope = (Math.atan(dz) * 180) / Math.PI;
    if (slope > 38 || inLake(la, lo) || isWater(la, lo)) continue;
    const nz = noise(toX(lo) * 2.2 + 50, toZ(la) * 2.2 + 50);
    let sp = null;
    if (useLC) {
      const lc = LC(la, lo), d = DENS[lc]; if (!d || rnd() > d) continue;
      if (lc === 'scrub' || lc === 'heath') sp = pick([['shrub', 0.75], ['birch', 0.15], ['pine', 0.1]]);
      else if (lc === 'orchard') sp = 'fruit';
      else if (lc === 'park' || lc === 'cemetery') sp = pick([['oak', 0.35], ['beech', 0.25], ['birch', 0.2], ['spruce', 0.1], ['pine', 0.1]]);
      else { const leaf = LEAF(la, lo);
        sp = leaf === 'needle' ? pick([['pine', 0.7], ['spruce', 0.2], ['larch', 0.1]]) : leaf === 'broad' ? pick([['beech', 0.4], ['oak', 0.35], ['birch', 0.25]])
          : pick([['pine', 0.4], ['oak', 0.2], ['beech', 0.15], ['birch', 0.15], ['spruce', 0.1]]); }
    } else if (LOW) { // lowland without landcover data: mixed woods in patches
      if (nz > 0.6 && rnd() < 0.8) sp = pick([['pine', 0.45], ['oak', 0.15], ['beech', 0.15], ['birch', 0.15], ['spruce', 0.1]]);
      else if (nz > 0.5 && rnd() < 0.05) sp = 'shrub';
    } else if (e < 1520 && nz > 0.32 - (1520 - e) / 2500 && rnd() < 0.9) {
      sp = e < 1250 ? pick([['spruce', 0.42], ['fir', 0.18], ['beech', 0.25], ['larch', 0.08], ['rowan', 0.04], ['birch', 0.03]]) : pick([['spruce', 0.82], ['larch', 0.1], ['rowan', 0.05], ['fir', 0.03]]);
    } else if (e >= 1450 && e < 1850 && nz > 0.45 && rnd() < 0.55) sp = 'mugo';
    else if (e < 1750 && slope < 30 && nz > 0.4 && rnd() < 0.035) sp = pick([['shrub', 0.7], ['rowan', 0.3]]); // scattered on the meadows
    if (sp) list[sp].push([la, lo]);
  }
  const treeMat = new THREE.MeshStandardMaterial({ roughness: 0.92, flatShading: true, vertexColors: true });
  applyFx(treeMat, [FX.treeWind(heatU), FX.snowCover(heatU, 0.62)]); // fx3d: crowns sway with the step's wind
  // LOD: every species has a near mesh (the geometry above) and a far one (5-14 triangles: one or two cones, an
  // octahedron crown, a 3-sided trunk; same unit height and silhouette), both filled from instance data sorted into
  // 0.5 km tiles. A tile is near while it is closer to the camera than R, the distance where a tree is still ~14 device
  // px tall (2.5-7 km, longer on the Kino lens); forestLod re-splits after the camera moved 0.15 R and uploads only when
  // a tile changed side, so a still or orbiting overview (all far) never touches the buffers. No rnd() calls here: the
  // placement sequence (positions, sizes, colours) stays as it was.
  const coneN = (r, h, n, y) => part(new THREE.ConeGeometry(r, h, n, 1, true), W, y);
  const trunk3 = (h, r, col = BARK) => part(new THREE.CylinderGeometry(r * 0.7, r, h, 3, 1, true), col, h / 2);
  const octa = (r, y, sx, sy, dx = 0) => part(new THREE.OctahedronGeometry(r, 0), W, y, 1, sy).scale(sx, 1, 1).translate(dx, 0, 0);
  const FAR = {
    spruce: merge([coneN(0.44, 0.6, 5, 0.38), coneN(0.3, 0.52, 5, 0.74)]),
    fir: merge([coneN(0.4, 0.92, 5, 0.54)]),
    larch: merge([coneN(0.27, 0.86, 5, 0.57)]),
    pine: merge([trunk3(0.62, 0.04), octa(0.34, 0.8, 1, 0.5)]),
    mugo: merge([octa(0.5, 0.18, 1.3, 0.45, 0.15)]),
    broad: merge([trunk3(0.42, 0.05), octa(0.42, 0.66, 1.1, 0.82, 0.08)]),
    birch: merge([trunk3(0.5, 0.03, BIRCH), octa(0.25, 0.74, 0.85, 1.35)]),
    shrub: merge([octa(0.5, 0.26, 1, 0.6)]),
  };
  const farGeo = (g) => Object.entries(GEO).find(([, v]) => v === g)?.[0];
  const TK = 0.5, TCX = Math.ceil(WKM / TK), TCZ = Math.ceil(HKM / TK), NT = TCX * TCZ;
  const tileOf = (x, z) => clamp(Math.floor((x + WKM / 2) / TK), 0, TCX - 1) + clamp(Math.floor((z + HKM / 2) / TK), 0, TCZ - 1) * TCX;
  const tSum = new Float64Array(NT * 4), lods = [];
  const o = new THREE.Object3D(), c = new THREE.Color();
  for (const [k, sp] of Object.entries(SP)) {
    const pts = list[k]; if (!pts.length) continue;
    const n = pts.length, pal = sp.cols.map((x) => new THREE.Color(x)), m0 = new Float32Array(n * 16), c0 = new Float32Array(n * 3), t0 = new Int32Array(n);
    pts.forEach(([la, lo], i) => {
      const h = sp.h[0] + rnd() * (sp.h[1] - sp.h[0]), w = 0.82 + rnd() * 0.36;
      o.position.copy(v3(la, lo, -0.002)); o.rotation.set((rnd() - 0.5) * 0.08, rnd() * 6.28, (rnd() - 0.5) * 0.08); o.scale.set(h * w, h, h * w * (0.9 + rnd() * 0.2)); o.updateMatrix();
      o.matrix.toArray(m0, i * 16);
      c.copy(pal[Math.floor(rnd() * pal.length)]).multiplyScalar((0.9 + rnd() * 0.2) * (0.55 + 0.45 * sunAt(la, lo))); c0.set([c.r, c.g, c.b], i * 3); // darker in the baked terrain shadow
      const t = (t0[i] = tileOf(o.position.x, o.position.z)); tSum[t * 4] += o.position.x; tSum[t * 4 + 1] += o.position.y; tSum[t * 4 + 2] += o.position.z; tSum[t * 4 + 3]++;
    });
    // counting sort by tile: each tile's trees are one contiguous run
    const start = new Int32Array(NT + 1); for (let i = 0; i < n; i++) start[t0[i] + 1]++;
    for (let t = 0; t < NT; t++) start[t + 1] += start[t];
    const fill = start.slice(0, NT), M = new Float32Array(n * 16), C = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const j = fill[t0[i]]++; M.set(m0.subarray(i * 16, i * 16 + 16), j * 16); C.set(c0.subarray(i * 3, i * 3 + 3), j * 3); }
    const mk = (geo, name) => {
      const m = new THREE.InstancedMesh(geo, treeMat, n); m.setColorAt(0, c);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.name = name; m.count = 0; m.receiveShadow = true; m.castShadow = false; forest.add(m); return m;
    };
    const hi = mk(sp.geo, k), lo = mk(FAR[farGeo(sp.geo)] || sp.geo, k + '-far');
    lo.frustumCulled = false; // spread over the whole cut: its bounds would always be in view anyway
    lods.push({ hi, lo, M, C, start });
  }
  const tC = new Float32Array(NT * 3), tN = new Uint8Array(NT), tNear = new Uint8Array(NT);
  for (let t = 0; t < NT; t++) if (tSum[t * 4 + 3]) { tN[t] = 1; for (let a = 0; a < 3; a++) tC[t * 3 + a] = tSum[t * 4 + a] / tSum[t * 4 + 3]; }
  const lodAt = new THREE.Vector3(1e9, 0, 0); let lodR = 0, first = true;
  const upload = (m, cnt) => {
    m.count = cnt; m.visible = cnt > 0;
    m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, cnt * 16); m.instanceMatrix.needsUpdate = true;
    m.instanceColor.clearUpdateRanges(); m.instanceColor.addUpdateRange(0, cnt * 3); m.instanceColor.needsUpdate = true;
  };
  forestLod = () => {
    if (!lods.length) return;
    const p = camera.position, R = clamp(((renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 0.036) / 14, 2.5, 7);
    if (!first && p.distanceTo(lodAt) < R * 0.15 && Math.abs(R - lodR) < R * 0.1) return;
    lodAt.copy(p); lodR = R;
    let changed = first; first = false;
    for (let t = 0; t < NT; t++) {
      if (!tN[t]) continue;
      const d = Math.hypot(tC[t * 3] - p.x, tC[t * 3 + 1] - p.y, tC[t * 3 + 2] - p.z) - 0.36, v = d < (tNear[t] ? R * 1.1 : R) ? 1 : 0; // hysteresis
      if (v !== tNear[t]) { tNear[t] = v; changed = true; }
    }
    if (!changed) return;
    for (const L of lods) {
      const cnt = [0, 0], dst = [L.lo, L.hi];
      for (let t = 0; t < NT;) { // runs of consecutive tiles on the same side: one copy each
        if (L.start[t] === L.start[t + 1]) { t++; continue; }
        const v = tNear[t], a = L.start[t]; let u = t + 1;
        while (u < NT && (L.start[u] === L.start[u + 1] || tNear[u] === v)) u++;
        const b = L.start[u], m = dst[v];
        m.instanceMatrix.array.set(L.M.subarray(a * 16, b * 16), cnt[v] * 16); m.instanceColor.array.set(L.C.subarray(a * 3, b * 3), cnt[v] * 3); cnt[v] += b - a; t = u;
      }
      upload(L.lo, cnt[0]); upload(L.hi, cnt[1]);
      if (cnt[1]) L.hi.computeBoundingSphere(); // near set: real bounds, so it is culled when behind the camera
    }
  };
  forestLod(); // all far until the loop first places the camera
}
// ---------- near grass: instanced tufts and dwarf pine around the orbit target ----------
// Only when zoomed in (camera within ~2 km of the target, uGrassFade grows them out of the ground). Placement is a
// jittered grid anchored in world space (cell -> hashed position, size, colour, keep), so a cell that stays inside the
// disc keeps its tuft when the target moves and only the rim changes. A new set is computed a few thousand cells per
// frame into staging arrays and uploaded in one go once the target has moved 120 m; nothing runs per frame otherwise.
// Ground: not water or lakes, not steep (rock), not built-up (OSM landAt residential / industrial / cemetery / sand),
// not on trails, streams or roads; meadows, grass, heath and scrub first, a little under forest; without land cover by
// elevation (Tatras: meadow up to ~2200 m, dwarf pine in the 1450-1850 m belt). Heights sit on the mesh's own
// triangles, so nothing floats. Pools: 20k tufts (12 triangles each), 2.4k dwarf pines; shadows not cast.
const nearGrass = (() => {
  if (FLAT) return null;
  const MAXG = 20000, MAXP = 2400, CG = 0.005, CP = 0.02, RAD = 0.45; // pool sizes, cell sizes and disc radius (km)
  heatU.uGrassC = { value: new THREE.Vector3(1e3, 0, 1e3) }; heatU.uGrassR = { value: RAD }; heatU.uGrassFade = { value: 0 };
  let seed = 777; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // tuft: 6 leaning blades, both windings (FrontSide, so both faces keep the up normal and light like the ground)
  const tuft = (() => {
    const pos = [], col = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * 6.283 + rnd() * 0.7, r = 0.04 + rnd() * 0.12, lean = 0.15 + rnd() * 0.3, h = 0.65 + rnd() * 0.35, w = 0.06 + rnd() * 0.04;
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r, tx = Math.cos(a) * (r + lean), tz = Math.sin(a) * (r + lean), px = -Math.sin(a) * w, pz = Math.cos(a) * w;
      const A = [cx - px, 0, cz - pz], B = [cx + px, 0, cz + pz], T = [tx, h, tz];
      pos.push(...A, ...B, ...T, ...B, ...A, ...T);
      for (let k = 0; k < 2; k++) col.push(0.5, 0.5, 0.45, 0.5, 0.5, 0.45, 1.08, 1.04, 0.86);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill([0, 1, 0]).flat(), 3)); return g;
  })();
  // dwarf pine (kosodrzewina): three flattened, jittered blobs, darker underneath
  const pine = (() => {
    const parts = [[0.5, 0, 0.2, 0, 0.42], [0.36, 0.3, 0.14, 0.12, 0.5], [0.32, -0.28, 0.12, -0.16, 0.46]].map(([r, x, y, z, sy]) => {
      const g = new THREE.IcosahedronGeometry(r, 0); g.scale(1, sy, 1); // already non-indexed g.translate(x, y + r * sy * 0.6, z);
      const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + (rnd() - 0.5) * 0.08, p.getY(i) + (rnd() - 0.5) * 0.05, p.getZ(i) + (rnd() - 0.5) * 0.08);
      return g;
    });
    const n = parts.reduce((a, g) => a + g.attributes.position.count, 0), pos = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
    for (const g of parts) { pos.set(g.attributes.position.array, o * 3); o += g.attributes.position.count; }
    for (let i = 0; i < n; i++) { const v = 0.6 + 0.4 * Math.min(1, Math.max(0, pos[i * 3 + 1] / 0.5)); col.set([v, v, v], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
  })();
  const gMat = applyFx(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), [FX.grassField(heatU, 1), FX.snowCover(heatU, 0.5)]);
  const pMat = applyFx(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), [FX.grassField(heatU, 0.25), FX.snowCover(heatU, 0.5)]);
  const meshes = [new THREE.InstancedMesh(tuft, gMat, MAXG), new THREE.InstancedMesh(pine, pMat, MAXP)];
  for (const m of meshes) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.setColorAt(0, new THREE.Color()); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.count = 0; m.visible = false; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; scene.add(m);
  }
  // October: dry, yellowing grass (greener under trees and on wet ground), dark dwarf pine
  const GPAL = ['#9c9a52', '#a89f58', '#8d9148', '#b3a262', '#7e8a46', '#a08a50', '#94a050'].map((c) => new THREE.Color(c)), GLUSH = new THREE.Color('#5f7a38');
  const PPAL = ['#2f4a2a', '#36502c', '#2b4426', '#3c5a32', '#33502f'].map((c) => new THREE.Color(c));
  // integer hash of a cell (deterministic: the same cell always gets the same tuft)
  const h32 = (x, z, s) => { let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1) ^ Math.imul(s + 1, 0x9e3779b1); h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const patch = (x, z) => { // value noise on a 40 m lattice: tufts grow in clumps, not as an even carpet
    const fx = x / 0.04, fz = z / 0.04, ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    return (h32(ix, iz, 9) * (1 - su) + h32(ix + 1, iz, 9) * su) * (1 - sv) + (h32(ix, iz + 1, 9) * (1 - su) + h32(ix + 1, iz + 1, 9) * su) * sv;
  };
  // the terrain mesh's own surface (PlaneGeometry triangles a-b-d / b-c-d), plus its slope in degrees (real, not exaggerated)
  const C1 = DEM.cols - 1, R1 = DEM.rows - 1, Y = (r, c) => ((DEM.z[r][c] - zMin) * EX) / 1000;
  const ground = (x, z) => {
    const fc = clamp(((x + WKM / 2) / WKM) * C1, 0, C1 - 1e-6), fr = clamp(((z + HKM / 2) / HKM) * R1, 0, R1 - 1e-6), c = Math.floor(fc), r = Math.floor(fr), u = fc - c, v = fr - r;
    const ha = Y(r, c), hb = Y(r + 1, c), hc = Y(r + 1, c + 1), hd = Y(r, c + 1);
    const y = u + v <= 1 ? ha + (hd - ha) * u + (hb - ha) * v : hc + (hb - hc) * (1 - u) + (hd - hc) * (1 - v);
    const gx = ((hd - ha + hc - hb) / 2) / (WKM / C1), gz = ((hb - ha + hc - hd) / 2) / (HKM / R1);
    return [y, (Math.atan(Math.hypot(gx, gz) / EX) * 180) / Math.PI];
  };
  meshHeightAt = (lat, lon) => ground(toX(lon), toZ(lat))[0]; // FPP: the same surface as grass placement
  const lakes = (TER?.lakes || []).map((l) => ({ x: toX(l.center[1]), z: toZ(l.center[0]), r: (l.radiusM + 15) / 1000 }));
  const NOGRASS = new Set(['water', 'residential', 'industrial', 'cemetery', 'beach', 'sand', 'rock']);
  const GP = { meadow: 1, grass: 1, heath: 0.85, scrub: 0.65, park: 0.7, orchard: 0.8, wetland: 0.6, farmland: 0.25, forest: 0.3, wood: 0.3 };
  const PP = { heath: 0.35, scrub: 0.45, meadow: 0.06, grass: 0.04, forest: 0.05, wood: 0.05 };
  // chance of a tuft / a dwarf pine at a spot: [grass, pine, lush 0..1]
  const chance = (x, z, slope) => {
    if (slope > 34 || lakes.some((l) => Math.hypot(x - l.x, z - l.z) < l.r)) return null;
    const la = toLat(z), lo = toLon(x), lc = landAt(la, lo);
    if (lc ? NOGRASS.has(lc) : isWater(la, lo)) return null;
    const flat = 1 - smooth(20, 34, slope), e = elevM(la, lo);
    if (lc) return [(GP[lc] ?? 0.5) * flat, (PP[lc] ?? 0) * (e > 900 ? 1.6 : 0.6) * flat, lc === 'forest' || lc === 'wood' || lc === 'wetland' ? 0.7 : 0];
    if (LOW) return [0.6 * flat, 0, 0.2];
    return [(1 - smooth(2050, 2300, e)) * flat, (e > 1400 && e < 1900 ? 0.4 * smooth(1400, 1500, e) * (1 - smooth(1800, 1900, e)) : 0) * flat, e < 1300 ? 0.5 : 0];
  };
  const mat = new Float32Array(16);
  const put = (S, i, x, y, z, a, w, h) => { const c = Math.cos(a), s = Math.sin(a), o = i * 16; mat.set([c * w, 0, -s * w, 0, 0, h, 0, 0, s * w, 0, c * w, 0, x, y, z, 1]); S.m.set(mat, o); };
  // a placement job: both grids over the disc, a slice of cells per frame. Rows run even ones first, then odd ones, so
  // a full pool thins the whole disc evenly instead of cutting off its far side. Staging arrays are allocated once.
  const STAGE = [[MAXG, CG], [MAXP, CP]].map(([max, cs], k) => ({ k, max, cs, m: new Float32Array(max * 16), c: new Float32Array(max * 3) }));
  // paths kept clear (trails, streams, OSM roads; width in km), as scene x/z with a bounding box; drawn per job into a
  // small mask around the disc (2 m per pixel), read once
  const PATHS = [...(TER?.trails || []).map((t) => [t.points.flat(), 0.004]), ...(TER?.streams || []).map((s) => [s.points.flat(), 0.004]),
    ...(OSM?.roads || []).map((r) => [r.l, ({ major: 0.014, minor: 0.01, service: 0.006, track: 0.005, rail: 0.006 })[r.c] || 0.008])].map(([ll, w]) => {
    const xz = new Float32Array(ll.length); let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < ll.length; i += 2) { const x = toX(ll[i + 1]), z = toZ(ll[i]); xz[i] = x; xz[i + 1] = z; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    return { xz, w, x0, x1, z0, z1 };
  });
  const MPX = 450, mg = Object.assign(document.createElement('canvas'), { width: MPX, height: MPX }).getContext('2d', { willReadFrequently: true });
  const maskFor = (cx, cz) => {
    const s = MPX / (2 * RAD); mg.setTransform(1, 0, 0, 1, 0, 0); mg.clearRect(0, 0, MPX, MPX); mg.setTransform(s, 0, 0, s, (RAD - cx) * s, (RAD - cz) * s);
    mg.strokeStyle = '#fff'; mg.lineCap = 'round'; mg.lineJoin = 'round';
    for (const p of PATHS) {
      if (p.x1 < cx - RAD || p.x0 > cx + RAD || p.z1 < cz - RAD || p.z0 > cz + RAD) continue;
      mg.beginPath(); for (let i = 0; i < p.xz.length; i += 2) i ? mg.lineTo(p.xz[i], p.xz[i + 1]) : mg.moveTo(p.xz[i], p.xz[i + 1]);
      mg.lineWidth = Math.max(p.w, 2 / s); mg.stroke();
    }
    return mg.getImageData(0, 0, MPX, MPX).data;
  };
  const jobFor = (t) => ({ cx: t.x, cz: t.z, mask: PATHS.length ? maskFor(t.x, t.z) : null, grids: STAGE.map((S) => {
    const ix0 = Math.floor((t.x - RAD) / S.cs), iz0 = Math.floor((t.z - RAD) / S.cs), nx = Math.ceil((2 * RAD) / S.cs) + 1, nz = nx;
    return Object.assign(S, { ix0, iz0, nx, nz, i: 0, n: 0 });
  }) });
  const onPath = (job, x, z) => { if (!job.mask) return false; const s = MPX / (2 * RAD), px = Math.floor((x - job.cx + RAD) * s), pz = Math.floor((z - job.cz + RAD) * s);
    return px >= 0 && pz >= 0 && px < MPX && pz < MPX && job.mask[(pz * MPX + px) * 4 + 3] > 0; };
  const col = new THREE.Color();
  const work = (job, budget) => {
    for (const S of job.grids) {
      const half = Math.ceil(S.nz / 2);
      while (budget > 0 && S.i < S.nx * S.nz) {
        const { cs, k } = S, row = Math.floor(S.i / S.nx), ix = S.ix0 + (S.i % S.nx), iz = S.iz0 + (row < half ? row * 2 : (row - half) * 2 + 1);
        S.i++; budget--;
        if (S.n >= S.max) continue;
        const x = (ix + 0.1 + 0.8 * h32(ix, iz, k * 7 + 1)) * cs, z = (iz + 0.1 + 0.8 * h32(ix, iz, k * 7 + 2)) * cs;
        if (Math.hypot(x - job.cx, z - job.cz) > RAD || Math.abs(x) > WKM / 2 - 0.01 || Math.abs(z) > HKM / 2 - 0.01 || onPath(job, x, z)) continue;
        const [y, slope] = ground(x, z), p = chance(x, z, slope); if (!p) continue;
        const keep = h32(ix, iz, k * 7 + 3);
        if (keep > p[k] * clamp((patch(x + k * 7, z) - 0.2) * 2.2, 0.08, 1.3)) continue; // in clumps
        const r4 = h32(ix, iz, k * 7 + 4), r5 = h32(ix, iz, k * 7 + 5), r6 = h32(ix, iz, k * 7 + 6), shade = 0.55 + 0.45 * sunAt(toLat(z), toLon(x));
        if (k === 0) { const h = 0.003 + r4 * 0.0026; put(S, S.n, x, y - 0.0004, z, r5 * 6.283, h * (0.8 + r6 * 0.4), h); col.copy(GPAL[Math.floor(r6 * GPAL.length)]).lerp(GLUSH, p[2] * r5); }
        else { const h = 0.008 + r4 * 0.006; put(S, S.n, x, y - 0.0008, z, r5 * 6.283, h * (0.45 + r6 * 0.2), h); col.copy(PPAL[Math.floor(r6 * PPAL.length)]); }
        col.multiplyScalar(shade * (0.9 + r4 * 0.2)); S.c.set([col.r, col.g, col.b], S.n * 3); S.n++;
      }
    }
    return job.grids.every((S) => S.i >= S.nx * S.nz);
  };
  let job = null, placed = null, fade = 0, eager = Q.has('zoom'); // ?zoom start: first set at once, already grown (screenshots)
  const commit = () => {
    job.grids.forEach((S, i) => {
      const m = meshes[i]; m.instanceMatrix.array.set(S.m.subarray(0, S.n * 16)); m.instanceColor.array.set(S.c.subarray(0, S.n * 3));
      m.count = S.n; m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, S.n * 16); m.instanceMatrix.needsUpdate = true;
      m.instanceColor.clearUpdateRanges(); m.instanceColor.addUpdateRange(0, S.n * 3); m.instanceColor.needsUpdate = true;
    });
    heatU.uGrassC.value.set(job.cx, 0, job.cz); placed = { x: job.cx, z: job.cz }; job = null; wake();
  };
  // per frame: the fade, and a re-placement only after the target moved far (the work itself is sliced)
  return function tick(dt) {
    const t = controls.target, want = forest.visible ? 1 - smooth(1.5, 2.1, camera.position.distanceTo(t)) : 0;
    if (eager && !want) eager = false; // started too far out: grow in normally later
    fade += (want - fade) * (1 - Math.exp(-dt * 3)); if (Math.abs(want - fade) < 0.002 || eager) fade = want;
    if (want > 0 && !job && (!placed || Math.hypot(t.x - placed.x, t.z - placed.z) > 0.12)) job = jobFor(t);
    if (job && work(job, eager ? Infinity : 2500)) { commit(); eager = false; }
    heatU.uGrassFade.value = fade;
    for (const m of meshes) m.visible = fade > 0.005 && m.count > 0;
  };
})();
await yieldMain();
// ---------- buildings: one merged mesh, footprints from OSM extruded to their height (levels x 3 m, or by type) ----------
const buildings = (() => {
  if (!OSM || !OSM.bld.length) return null;
  const pos = [], col = [], c = new THREE.Color();
  const roofCol = (k) => (/^(house|detached|semidetached_house|terrace|bungalow|cabin|hut|farm|farm_auxiliary|barn)$/.test(k || '') ? [0.66, 0.3, 0.22]
    : /^(church|chapel|cathedral)$/.test(k || '') ? [0.33, 0.43, 0.4] : /^(industrial|warehouse|garage|garages|retail|commercial)$/.test(k || '') ? [0.6, 0.62, 0.64] : [0.5, 0.48, 0.47]);
  let seed = 4242; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const b of OSM.bld) {
    const r = b.r, n = r.length / 2 - (r[0] === r[r.length - 2] && r[1] === r[r.length - 1] ? 1 : 0); if (n < 3) continue;
    const xs = [], zs = []; let base = Infinity, inside_ = true;
    for (let i = 0; i < n; i++) { const la = r[2 * i], lo = r[2 * i + 1]; if (la > latN || la < latS || lo < lonW || lo > lonE || isWater(la, lo)) { inside_ = false; break; } xs.push(toX(lo)); zs.push(toZ(la)); base = Math.min(base, hAt(la, lo)); }
    if (!inside_) continue;
    let A = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n; A += xs[i] * zs[j] - xs[j] * zs[i]; }
    if (A > 0) { xs.reverse(); zs.reverse(); } // outward wall normals
    const top = base + (b.h * EX) / 1000, y0 = base - 0.002;
    const wv = 0.8 + rnd() * 0.12, wall = [wv, wv * 0.97, wv * 0.92], roof = roofCol(b.k).map((v) => v * (0.9 + rnd() * 0.2));
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      pos.push(xs[i], y0, zs[i], xs[j], y0, zs[j], xs[j], top, zs[j], xs[i], y0, zs[i], xs[j], top, zs[j], xs[i], top, zs[i]);
      for (let k = 0; k < 6; k++) col.push(...wall);
    }
    const tri = THREE.ShapeUtils.triangulateShape(xs.map((x, i) => new THREE.Vector2(x, zs[i])), []);
    for (const [a, bb, cc] of tri) {
      const up = (zs[bb] - zs[a]) * (xs[cc] - xs[a]) - (xs[bb] - xs[a]) * (zs[cc] - zs[a]) > 0;
      const [p, q] = up ? [bb, cc] : [cc, bb];
      pos.push(xs[a], top, zs[a], xs[p], top, zs[p], xs[q], top, zs[q]);
      for (let k = 0; k < 3; k++) col.push(...roof);
    }
  }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, applyFx(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 }), [FX.snowCover(heatU), FX.windows(heatU, (3 * EX) / 1000)])); // fx3d: lit windows at night
  m.castShadow = true; m.receiveShadow = true; scene.add(m);
  return m;
})();
await yieldMain();
// ---------- traffic: cars driving along the OSM roads (data/<sc>-traffic.json; decorative, not engine data) ----------
// Only roads open to public motor traffic (make_traffic.py: no service roads, pedestrian zones, tracks or trails, no
// access=no/private/..., no dead-end roads inside a national park such as the Morskie Oko road above Palenica). The
// painted roads of <sc>-osm3d.json are not used: without a traffic file there are no cars. Ways sharing an end point form a network: at the end of a way a car turns into a random other way leaving that node
// (or turns back at a dead end). Right-hand traffic: each car is offset into its lane from the way's centre line. Density
// and speed by class (major 50 km/h, 5 cars/km; minor 30 km/h, 1.6/km), at most MAX cars over the
// cut. One InstancedMesh for the bodies and one for the lights (head white, tail red), plus a glow point per lamp pair
// (additive, a few px at any zoom); the lights show at dusk and night (the mood's uNight). Cars are true size (4.4 x 1.8 m) at every zoom, like the
// OSM buildings: in the overview they shrink below a pixel and only the night glow shows the flow. No shadows: the
// shadow map is rendered only when the view settles. Button "Ruch" / ?traffic=0 hides them (and stops the per-frame update).
const traffic = (() => {
  if (!TRAF?.r?.length || Q.get('traffic') === '0') return null;
  const CLS = { major: [50, 5, 0.0018], minor: [30, 1.6, 0.0014] }; // km/h, cars per km, lane offset (km)
  const ways = [], nodes = new Map(), key = (la, lo) => Math.round(la * 1e5) + ',' + Math.round(lo * 1e5);
  for (const [c, l] of TRAF.r) {
    const cl = CLS[c], r = { l: dec(l) }; if (!cl || r.l.length < 4) continue;
    const xz = [], cum = [0];
    for (let i = 0; i < r.l.length; i += 2) {
      const la = r.l[i], lo = r.l[i + 1];
      if (!inside([la, lo]) || isWater(la, lo)) { xz.length = 0; break; } // ways leaving the cut or over water: skipped whole
      const x = toX(lo), z = toZ(la);
      if (xz.length) { const d = Math.hypot(x - xz[xz.length - 2], z - xz[xz.length - 1]); if (d < 1e-6) continue; cum.push(cum[cum.length - 1] + d); }
      xz.push(x, z);
    }
    if (xz.length < 4) continue;
    const w = { xz, cum, len: cum[cum.length - 1], cl, a: key(r.l[0], r.l[1]), b: key(r.l[r.l.length - 2], r.l[r.l.length - 1]) };
    ways.push(w);
    for (const k of [w.a, w.b]) { if (!nodes.has(k)) nodes.set(k, []); nodes.get(k).push(w); }
  }
  if (!ways.length) return null;
  let seed = 777; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const MAX = 1500, want = ways.reduce((s, w) => s + w.len * w.cl[1], 0), keep = Math.min(1, MAX / Math.max(want, 1));
  const cars = [];
  for (const w of ways) {
    let n = w.len * w.cl[1] * keep; n = Math.floor(n) + (rnd() < n % 1 ? 1 : 0);
    for (let i = 0; i < n; i++) cars.push({ w, s: rnd() * w.len, dir: rnd() < 0.5 ? 1 : -1, seg: 0, v: (w.cl[0] / 3600) * (0.8 + rnd() * 0.35) });
  }
  if (!cars.length) return null;
  // low-poly car, 4.4 x 1.8 m, unit height ~1.5 m; front = +x
  const part = (g, col, x, y) => { g.translate(x, y, 0); const c = new THREE.Color(col), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g.toNonIndexed(); };
  const merge = (gs) => { const p = [], c = []; for (const g of gs) { const G = g.index ? g.toNonIndexed() : g; p.push(...G.attributes.position.array); c.push(...G.attributes.color.array); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); g.computeVertexNormals(); return g; };
  const body = merge([part(new THREE.BoxGeometry(0.0044, 0.0007, 0.0018), '#ffffff', 0, 0.00055), part(new THREE.BoxGeometry(0.0024, 0.00055, 0.00158), '#ffffff', -0.0003, 0.00118),
    part(new THREE.BoxGeometry(0.0006, 0.0003, 0.0019), '#222222', 0, 0.0002).translate(0.0013, 0, 0), part(new THREE.BoxGeometry(0.0006, 0.0003, 0.0019), '#222222', 0, 0.0002).translate(-0.0013, 0, 0)]);
  const lights = merge([part(new THREE.BoxGeometry(0.0002, 0.00025, 0.0005), '#fff6d8', 0.0022, 0.0007).translate(0, 0, 0.00055), part(new THREE.BoxGeometry(0.0002, 0.00025, 0.0005), '#fff6d8', 0.0022, 0.0007).translate(0, 0, -0.00055),
    part(new THREE.BoxGeometry(0.0002, 0.00022, 0.0005), '#ff1a10', -0.0022, 0.0007).translate(0, 0, 0.00055), part(new THREE.BoxGeometry(0.0002, 0.00022, 0.0005), '#ff1a10', -0.0022, 0.0007).translate(0, 0, -0.00055)]);
  const PAL = ['#f2f2f0', '#f2f2f0', '#b9bec4', '#b9bec4', '#2b2d31', '#2b2d31', '#8c1d1d', '#1f3f78', '#5b6066', '#c9b48a', '#2f5a3a'].map((x) => new THREE.Color(x));
  const N = cars.length, mBody = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.3 }), N);
  const mLight = new THREE.InstancedMesh(lights, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), N);
  cars.forEach((c, i) => mBody.setColorAt(i, PAL[Math.floor(rnd() * PAL.length)]));
  for (const m of [mBody, mLight]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.receiveShadow = true; m.name = 'traffic'; }
  mLight.visible = false;
  // night glow: one soft additive point per head (warm white) and tail light pair (red), a few px at any zoom
  const spr = document.createElement('canvas'); spr.width = spr.height = 32;
  { const c = spr.getContext('2d'), gr = c.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, 32, 32); }
  const gPos = new Float32Array(N * 6), gCol = new Float32Array(N * 6);
  for (let i = 0; i < N; i++) gCol.set([1, 0.93, 0.75, 1, 0.12, 0.06], i * 6);
  const glowGeo = new THREE.BufferGeometry(); glowGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3).setUsage(THREE.DynamicDrawUsage)); glowGeo.setAttribute('color', new THREE.BufferAttribute(gCol, 3));
  const glow = new THREE.Points(glowGeo, new THREE.PointsMaterial({ size: 7 * renderer.getPixelRatio(), sizeAttenuation: false, vertexColors: true, map: new THREE.CanvasTexture(spr), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
  glow.frustumCulled = false; glow.visible = false; glow.name = 'traffic';
  const g = new THREE.Group(); g.add(mBody, mLight, glow); scene.add(g);
  const E = mBody.instanceMatrix.array, L = mLight.instanceMatrix.array;
  const next = (c) => { // end of the way: another way from this node, or back along the same one
    const at = c.dir > 0 ? c.w.b : c.w.a, opts = (nodes.get(at) || []).filter((w) => w !== c.w);
    if (!opts.length) { c.dir = -c.dir; c.s = c.dir > 0 ? 0 : c.w.len; return; }
    const w = opts[Math.floor(rnd() * opts.length)];
    c.w = w; c.dir = w.a === at ? 1 : -1; c.s = c.dir > 0 ? 0 : w.len; c.seg = c.dir > 0 ? 0 : w.cum.length - 2; c.v = (w.cl[0] / 3600) * (0.8 + rnd() * 0.35);
  };
  let on = true;
  function tick(dt) {
    if (!on) return;
    for (let i = 0; i < N; i++) {
      const c = cars[i];
      c.s += c.dir * c.v * dt;
      if (c.s < 0 || c.s > c.w.len) next(c);
      const { xz, cum } = c.w;
      while (c.seg < cum.length - 2 && cum[c.seg + 1] < c.s) c.seg++;
      while (c.seg > 0 && cum[c.seg] > c.s) c.seg--;
      const j = c.seg, f = (c.s - cum[j]) / Math.max(cum[j + 1] - cum[j], 1e-9);
      let dx = xz[2 * j + 2] - xz[2 * j], dz = xz[2 * j + 3] - xz[2 * j + 1]; const dl = Math.hypot(dx, dz) || 1; dx = (dx / dl) * c.dir; dz = (dz / dl) * c.dir;
      const off = c.w.cl[2], x = xz[2 * j] + (xz[2 * j + 2] - xz[2 * j]) * f - dz * off, z = xz[2 * j + 1] + (xz[2 * j + 3] - xz[2 * j + 1]) * f + dx * off; // right of travel
      const y = meshHeightAt(toLat(z), toLon(x)) + 0.0001;
      // rotation about y so that local +x points along (dx, dz), true scale (1)
      const o = i * 16;
      E[o] = dx; E[o + 1] = 0; E[o + 2] = dz; E[o + 3] = 0;
      E[o + 4] = 0; E[o + 5] = 1; E[o + 6] = 0; E[o + 7] = 0;
      E[o + 8] = -dz; E[o + 9] = 0; E[o + 10] = dx; E[o + 11] = 0;
      E[o + 12] = x; E[o + 13] = y; E[o + 14] = z; E[o + 15] = 1;
    }
    mBody.instanceMatrix.needsUpdate = true;
    mLight.visible = glow.visible = heatU.uNight.value > 0.15;
    if (mLight.visible) {
      L.set(E); mLight.instanceMatrix.needsUpdate = true;
      for (let i = 0, o = 0; i < N; i++, o += 16) { // lamp centres: local (+-0.0022, 0.0007, 0) through the car's matrix
        const ax = E[o] * 0.0023, az = E[o + 2] * 0.0023, y = E[o + 13] + E[o + 5] * 0.0007, q = i * 6;
        gPos[q] = E[o + 12] + ax; gPos[q + 1] = y; gPos[q + 2] = E[o + 14] + az; gPos[q + 3] = E[o + 12] - ax; gPos[q + 4] = y; gPos[q + 5] = E[o + 14] - az;
      }
      glowGeo.attributes.position.needsUpdate = true;
    }
  }
  return { tick, cars, group: g, set: (v) => { on = v; g.visible = v; } };
})();
// ---------- unit vehicles: ground units' cars parked at their base (machines3d.vehicleKind / createVehicle) ----------
// A ground resource of the scenario (police patrol, city guard, PSP / OSP crew, GOPR / TOPR patrol) gets its vehicle
// at its base, on the nearest road open to traffic (data/<sc>-traffic.json) within 300 m (its road access: a beach or
// village station sits off the street), along the road, on the right shoulder; units sharing a base park one behind
// the other. A base at a mountain hut or station without a road nearby gets none; so does a base outside the cut.
// Blue lights flash while the unit has an assignment in the shown step (drawTeams -> setActive). True size (a car 4.6 m,
// a fire engine 8 m), like the traffic and the OSM buildings.
const unitCars = (() => {
  if (!TRAF?.r?.length) return null;
  const roads = TRAF.r.map(([, l]) => { const d = dec(l), xz = []; for (let i = 0; i < d.length; i += 2) xz.push(toX(d[i + 1]), toZ(d[i])); return xz; });
  const list = [];
  for (const r of resources.values()) {
    const vk = r.type === 'ground' && r.base && inside(r.base) ? vehicleKind(r.name) : null; if (!vk) continue;
    const bx = toX(r.base[1]), bz = toZ(r.base[0]); let best = null, bd = 0.3;
    for (const xz of roads) for (let i = 0; i + 3 < xz.length; i += 2) {
      const ax = xz[i], az = xz[i + 1], dx = xz[i + 2] - ax, dz = xz[i + 3] - az, L2 = dx * dx + dz * dz || 1e-12;
      const u = clamp(((bx - ax) * dx + (bz - az) * dz) / L2, 0, 1), px = ax + u * dx, pz = az + u * dz, d = Math.hypot(bx - px, bz - pz);
      if (d < bd) { bd = d; const l = Math.sqrt(L2); best = { x: px, z: pz, dx: dx / l, dz: dz / l }; }
    }
    if (!best) continue;
    const k = list.filter((c) => Math.hypot(c.at.x - best.x, c.at.z - best.z) < 0.02).length, back = k * 0.01; // queue behind a car already there, 10 m apart
    const v = createVehicle(THREE, vk), x = best.x - best.dz * 0.004 - best.dx * back, z = best.z + best.dx * 0.004 - best.dz * back; // right shoulder, 4 m off the centre line
    v.obj.position.set(x, meshHeightAt(toLat(z), toLon(x)), z); v.setHeading(best.dx, best.dz);
    v.obj.name = 'unitCar'; scene.add(v.obj); list.push({ id: r.id, v, at: best });
  }
  if (!list.length) return null;
  return { list, setActive: (ids) => list.forEach((c) => c.v.setActive(ids.has(c.id))), tick: (dt) => list.forEach((c) => c.v.tick(dt)) };
})();
await yieldMain();
// ---------- water reflection: the mountains mirrored in the lakes and the sea (fx3d.waterReflect) ----------
// One planar mirror at a time: the water body nearest the orbit target that is on screen sets the plane y. The terrain
// and buildings (layer 1, with the lights: no trees, lines, labels or sky; the sky stays the environment map's) are
// rendered from the camera mirrored about it (three's Reflector: oblique near plane = water plane) into an 8-bit RGBA
// target at half the canvas size (no MSAA, no half float: both break on the Asahi GPU), scissored to the lakes lying in
// that plane, only when the camera moved or every 0.4 s. ?fx=-refl, or a target the GPU cannot render into: current look.
// The mirrored terrain is its own copy for layer 1: the same vertices split into 8x8 index chunks, so only the chunks
// inside the scissored mirror frustum are drawn (a lake mirrors a few of them, not the 200k+ triangles of the cut), with
// a cheaper material - no close-up rock / grass detail, snow glints or shadow-map lookups (the baked sun shadow and cloud
// shadows stay): the waves blur the mirror image far below that detail. Slow camera moves (orbit, drift) refresh the
// mirror every 2nd frame; the skipped frame keeps the previous texture with its own projection, so it stays put on the
// water (off by one frame of parallax: under 0.0015 rad of view change, a pixel or two).
const REFL = { ok: false, tried: false, at: 0, rt: null, cam: new THREE.PerspectiveCamera(), v: new THREE.Vector3(), f: new THREE.Vector3(), q: new THREE.Vector4(), p4: new THREE.Vector4(), pl: new THREE.Plane(), cc: new THREE.Color(),
  chunks: [], fr: new THREE.Frustum(), cm: new THREE.Matrix4(), pos: new THREE.Vector3(), quat: new THREE.Quaternion(), stale: false };
REFL.cam.layers.set(1);
if (WATER.length && !FX_OFF.has('refl') && renderer.capabilities.isWebGL2) {
  try {
    REFL.rt = new THREE.WebGLRenderTarget(256, 256, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, samples: 0, depthBuffer: true, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    REFL.rt.texture.colorSpace = THREE.SRGBColorSpace; // SRGB8_ALPHA8: 8 bits without banding in the dark (night) reflections
    REFL.ok = true;
  } catch (e) { console.warn('3d: water reflection off', e); }
}
if (REFL.ok) {
  const mat = applyFx(new THREE.MeshStandardMaterial({ map: compTex, emissive: 0x000000, roughness: 0.96, metalness: 0, normalMap: normalTex, normalMapType: THREE.ObjectSpaceNormalMap, aoMap: terrainAO, aoMapIntensity: 0.8 }),
    [FX.snowCover(heatU), POD3D?.effect, FX.poaHeat(heatU), FX.bakedSun(heatU), FX.cloudShadows(heatU)]);
  const idx = terrainGeo.index.array, P = terrainGeo.attributes.position, gx = DEM.cols - 1, gy = DEM.rows - 1, N = 8, box = new THREE.Box3(), v = new THREE.Vector3();
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const r0 = Math.floor((j * gy) / N), r1 = Math.floor(((j + 1) * gy) / N), c0 = Math.floor((i * gx) / N), c1 = Math.floor(((i + 1) * gx) / N);
    if (r1 <= r0 || c1 <= c0) continue;
    const out = new idx.constructor((r1 - r0) * (c1 - c0) * 6); // PlaneGeometry: 6 indices per cell, cells row by row
    for (let r = r0, o = 0; r < r1; r++, o += (c1 - c0) * 6) out.set(idx.subarray((r * gx + c0) * 6, (r * gx + c1) * 6), o);
    box.makeEmpty(); for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) box.expandByPoint(v.fromBufferAttribute(P, r * DEM.cols + c));
    const geo = new THREE.BufferGeometry(); for (const [k, a] of Object.entries(terrainGeo.attributes)) geo.setAttribute(k, a); // shared GPU buffers
    geo.setIndex(new THREE.BufferAttribute(out, 1)); geo.boundingBox = box.clone(); geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    const m = new THREE.Mesh(geo, mat); m.layers.set(1); m.frustumCulled = false; m.matrixAutoUpdate = false; m.updateMatrixWorld(); m.name = 'reflTerrain';
    REFL.chunks.push(m); scene.add(m);
  }
  // buildings likewise: their triangles regrouped by 8x8 cell (order within an opaque mesh does not matter), one
  // layer 1 draw range per cell on the shared buffers
  if (buildings) {
    const g = buildings.geometry, n = g.attributes.position.count / 3, X = g.attributes.position.array, cell = new Uint8Array(n), cnt = new Uint32Array(N * N + 1);
    for (let t = 0; t < n; t++) {
      const o = t * 9, x = (X[o] + X[o + 3] + X[o + 6]) / 3, z = (X[o + 2] + X[o + 5] + X[o + 8]) / 3;
      cnt[(cell[t] = clamp(Math.floor((z / HKM + 0.5) * N), 0, N - 1) * N + clamp(Math.floor((x / WKM + 0.5) * N), 0, N - 1)) + 1]++;
    }
    for (let k = 0; k < N * N; k++) cnt[k + 1] += cnt[k];
    const at = cnt.slice(0, N * N), dst = new Uint32Array(n); for (let t = 0; t < n; t++) dst[t] = at[cell[t]]++;
    for (const a of Object.values(g.attributes)) {
      const sz = a.itemSize * 3, src = a.array.slice();
      for (let t = 0; t < n; t++) a.array.set(src.subarray(t * sz, t * sz + sz), dst[t] * sz);
      a.needsUpdate = true;
    }
    for (let k = 0; k < N * N; k++) {
      const t0 = cnt[k], t1 = cnt[k + 1]; if (t1 <= t0) continue;
      box.makeEmpty(); for (let i = t0 * 3; i < t1 * 3; i++) box.expandByPoint(v.fromBufferAttribute(g.attributes.position, i));
      const geo = new THREE.BufferGeometry(); for (const [k2, a] of Object.entries(g.attributes)) geo.setAttribute(k2, a);
      geo.setDrawRange(t0 * 3, (t1 - t0) * 3); geo.boundingBox = box.clone(); geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
      const m = new THREE.Mesh(geo, buildings.material); m.layers.set(1); m.frustumCulled = false; m.matrixAutoUpdate = false;
      m.matrix.copy(buildings.matrixWorld); m.matrixWorld.copy(buildings.matrixWorld); m.name = 'reflBuildings';
      REFL.chunks.push(m); scene.add(m);
    }
  }
}
function reflPick() {
  const t = controls.target, v = REFL.v, px = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360)); let best = null, bd = Infinity;
  for (const w of WATER) {
    if (camera.position.y < w.y + 0.01 || (!w.sea && (w.r * px) / Math.hypot(w.x - camera.position.x, w.y - camera.position.y, w.z - camera.position.z) < 12)) continue; // under it, or a lake under 12 px
    v.set(w.x, w.y, w.z).project(camera);
    if (v.z > 1 || Math.abs(v.x) > 1.6 || Math.abs(v.y) > 1.6) continue;
    const d = Math.max(0, Math.hypot(w.x - t.x, w.z - t.z) - w.r);
    if (d < bd) { bd = d; best = w; }
  }
  return best;
}
function reflRender(moved, now) {
  if (!REFL.ok) return;
  const rt = REFL.rt, cv = renderer.domElement, W = clamp(Math.round(cv.width * 0.5), 64, 1024), H = clamp(Math.round((W * cv.height) / Math.max(cv.width, 1)), 64, 1024);
  if (!moved && !REFL.stale && now - REFL.at < 400) return;
  // slow move since the last mirror render (orbit, drift): keep it for this frame, render the next one
  if (moved && !REFL.stale && heatU.uReflOn.value > 0 && rt.width === W && rt.height === H && camera.quaternion.angleTo(REFL.quat) < 0.0015
    && camera.position.distanceTo(REFL.pos) < 0.0015 * camera.position.distanceTo(controls.target)) { REFL.stale = true; return; }
  REFL.stale = false; REFL.at = now; REFL.pos.copy(camera.position); REFL.quat.copy(camera.quaternion);
  const w = reflPick(); heatU.uReflOn.value = w ? 1 : 0; if (!w) return;
  const h = w.y + ((0.0012 + heatU.uWind.value * 0.02) / Math.sqrt(w.sea ? 0.27 : 1)) * 2.7; // the waves' mean lift (fx3d)
  heatU.uReflY.value = h;
  if (rt.width !== W || rt.height !== H) rt.setSize(W, H);
  // mirrored camera: eye and look-at point reflected about y = h, up reflected
  const c = REFL.cam, e = camera.matrixWorld.elements;
  c.position.set(camera.position.x, 2 * h - camera.position.y, camera.position.z);
  REFL.f.set(camera.position.x - e[8], camera.position.y - e[9], camera.position.z - e[10]); REFL.f.y = 2 * h - REFL.f.y;
  c.up.set(e[4], -e[5], e[6]); c.lookAt(REFL.f); c.far = camera.far; c.updateMatrixWorld();
  c.projectionMatrix.copy(camera.projectionMatrix);
  const M = heatU.uReflMat.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(c.projectionMatrix).multiply(c.matrixWorldInverse);
  // oblique near plane on the water surface: nothing under it is mirrored
  const pl = REFL.pl.set(REFL.v.set(0, 1, 0), -h).applyMatrix4(c.matrixWorldInverse), P = c.projectionMatrix.elements, q = REFL.q;
  const cp = REFL.p4.set(pl.normal.x, pl.normal.y, pl.normal.z, pl.constant);
  q.set((Math.sign(cp.x) + P[8]) / P[0], (Math.sign(cp.y) + P[9]) / P[5], -1, (1 + P[10]) / P[14]);
  cp.multiplyScalar(2 / cp.dot(q));
  P[2] = cp.x; P[6] = cp.y; P[10] = cp.z + 1 - 0.0005; P[14] = cp.w;
  c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
  // scissor: the texture area the lakes in this plane sample (the sea uses all of it)
  rt.scissorTest = false;
  let u0 = 0, v0 = 0, u1 = 1, v1 = 1; // mirror texture area drawn (uv)
  if (!w.sea) {
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0, full = false;
    for (const b of WATER) if (!b.sea && Math.abs(b.y - w.y) < 0.016) for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2, p = REFL.p4.set(b.x + Math.cos(a) * b.r * 1.1, h, b.z + Math.sin(a) * b.r * 1.1, 1).applyMatrix4(M);
      if (p.w <= 0.001) { full = true; break; }
      x0 = Math.min(x0, p.x / p.w); x1 = Math.max(x1, p.x / p.w); y0 = Math.min(y0, p.y / p.w); y1 = Math.max(y1, p.y / p.w);
    }
    if (!full) {
      x0 = clamp(x0 - 0.05, 0, 1); y0 = clamp(y0 - 0.05, 0, 1); x1 = clamp(x1 + 0.05, 0, 1); y1 = clamp(y1 + 0.05, 0, 1);
      if (x1 <= x0 || y1 <= y0) { heatU.uReflOn.value = 0; return; } // in front of the camera but off screen in the mirror: nothing to draw
      rt.scissor.set(Math.floor(x0 * W), Math.floor(y0 * H), Math.ceil((x1 - x0) * W) + 1, Math.ceil((y1 - y0) * H) + 1); rt.scissorTest = true;
      u0 = rt.scissor.x / W; v0 = rt.scissor.y / H; u1 = Math.min(1, (rt.scissor.x + rt.scissor.z) / W); v1 = Math.min(1, (rt.scissor.y + rt.scissor.w) / H);
    }
  }
  // cull the terrain and building chunks to the frustum of the scissored area: crop * oblique projection * view
  const sx = u1 - u0, sy = v1 - v0, ox = u0 + u1 - 1, oy = v0 + v1 - 1;
  REFL.fr.setFromProjectionMatrix(REFL.cm.set(1 / sx, 0, 0, -ox / sx, 0, 1 / sy, 0, -oy / sy, 0, 0, 1, 0, 0, 0, 0, 1).multiply(c.projectionMatrix).multiply(c.matrixWorldInverse));
  for (const m of REFL.chunks) m.visible = REFL.fr.intersectsBox(m.geometry.boundingBox);
  for (const o of scene.children) if (o.isLight) o.layers.enable(1); // lights are culled by layer too
  const shadowDue = renderer.shadowMap.needsUpdate, ca = renderer.getClearAlpha(); renderer.getClearColor(REFL.cc);
  try {
    renderer.shadowMap.needsUpdate = false; // the shadow map is the main camera's (it would cull the trees by layer here)
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0);
    if (!REFL.tried) { REFL.tried = true; const gl = renderer.getContext(); if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete'); }
    renderer.render(scene, c);
    heatU.uReflTex.value = rt.texture;
  } catch (err) { REFL.ok = false; heatU.uReflOn.value = 0; console.warn('3d: water reflection off', err); }
  finally { renderer.setRenderTarget(null); renderer.setClearColor(REFL.cc, ca); renderer.shadowMap.needsUpdate = shadowDue; }
}
const foundPin = foundAt ? pin(foundAt[0], foundAt[1], '#2d6a4f', 0.42, 'ZNALEZIONO · ' + esc(foundEv?.at || ''), 'found', 0.026) : null;
if (foundPin) { foundPin.visible = false; scene.add(foundPin); }
// blind test reveal: the hider's true spot, published with the salt after the round
const revealPin = REV?.at ? pin(REV.at[0], REV.at[1], '#b8322a', 0.55, 'Odsłonięte: tu była · ' + esc(REV.round || ''), 'target', 0.028) : null;
if (revealPin) { revealPin.visible = false; scene.add(revealPin); }
// ---------- wreck: a derailed train and damaged track from the scenario's "wreck" (e.g. dywersja-poprad) ----------
// { kind: 'train', at, cars, sabotage: [{at, label}] }: the locomotive and cars sit on the nearest OSM railway at
// `at`, heading north (the run's direction of travel is not in the data), and come off it towards the lower side of
// the embankment: the locomotive furthest, the first car on its side, the next ones less and less, the last one still
// on the rails. Each sabotage point gets torn rails and barriers; one away from the IPP also gets a labelled pin.
// Real size (a car is 24.5 m). Display only: the engine knows nothing of it.
const wreck = (() => {
  const W = SCN?.wreck || (() => { // the same from "props": train-derailed {at, cars} and damaged-track {at, label}
    const ps = SCN?.props || [], tr = ps.find((p) => p.kind === 'train-derailed'), sb = ps.filter((p) => p.kind === 'damaged-track' && p.at);
    return tr?.at || sb.length ? { kind: tr?.at ? 'train' : 'sabotage', at: tr?.at, cars: tr?.cars, sabotage: sb.map((p) => ({ at: p.at, label: p.label })) } : null;
  })();
  if (!W) return null;
  const g = new THREE.Group(); g.name = 'wreck'; scene.add(g);
  const rails = (OSM?.roads || []).filter((r) => r.c === 'rail');
  const onRail = (la, lo) => { // nearest point and direction of the railway, scene units; null without one within 300 m
    const px = toX(lo), pz = toZ(la); let best = null, bd = 0.3;
    for (const r of rails) for (let i = 0; i + 3 < r.l.length; i += 2) {
      const ax = toX(r.l[i + 1]), az = toZ(r.l[i]), dx = toX(r.l[i + 3]) - ax, dz = toZ(r.l[i + 2]) - az, L2 = dx * dx + dz * dz || 1e-12;
      const u = clamp(((px - ax) * dx + (pz - az) * dz) / L2, 0, 1), x = ax + u * dx, z = az + u * dz, d = Math.hypot(px - x, pz - z);
      if (d < bd) { bd = d; const l = Math.sqrt(L2); best = { x, z, dx: dx / l, dz: dz / l }; }
    }
    if (best && best.dz > 0) { best.dx = -best.dx; best.dz = -best.dz; } // forward = northwards
    return best;
  };
  const ground = (x, z) => meshHeightAt(toLat(z), toLon(x));
  if (W.kind === 'train' && W.at) {
    const a = onRail(W.at[0], W.at[1]) || { x: toX(W.at[1]), z: toZ(W.at[0]), dx: 0, dz: -1 };
    const sx = -a.dz, sz = a.dx, side = ground(a.x + sx * 0.03, a.z + sz * 0.03) < ground(a.x - sx * 0.03, a.z - sz * 0.03) ? 1 : -1; // downhill side
    // [along the track km, off it km, yaw deg, roll deg] from the locomotive back
    const POSE = [[0.03, 0.011, 24, 14], [0.006, 0.008, 38, 86], [-0.019, 0.0045, 16, 9], [-0.0445, 0.0015, 6, 0], [-0.07, 0, 0, 0], [-0.0955, 0, 0, 0]];
    for (let i = 0; i <= Math.max(1, Math.min(5, W.cars || 4)); i++) {
      const [al, off, yaw, roll] = POSE[i], car = createRailcar(THREE, i === 0);
      const x = a.x + a.dx * al + sx * side * off, z = a.z + a.dz * al + sz * side * off, h = Math.atan2(-a.dz, a.dx) - side * (yaw * Math.PI) / 180;
      car.rotation.order = 'YXZ'; car.rotation.y = h; car.rotation.x = side * (roll * Math.PI) / 180;
      const hx = Math.cos(h) * 0.011, hz = -Math.sin(h) * 0.011; // on the higher of its two ends and middle, a little sunk
      car.position.set(x, Math.max(ground(x, z), ground(x + hx, z + hz), ground(x - hx, z - hz)) - 0.0004 + (roll > 45 ? 0.0012 : 0), z);
      car.name = 'wreckCar'; g.add(car);
    }
  }
  for (const sb of W.sabotage || []) {
    const r = onRail(sb.at[0], sb.at[1]) || { x: toX(sb.at[1]), z: toZ(sb.at[0]), dx: 0, dz: -1 };
    const d = createDamagedTrack(THREE); d.position.set(r.x, ground(r.x, r.z), r.z); d.rotation.y = Math.atan2(-r.dz, r.dx); g.add(d);
    const ip = SCN?.ipp?.at || W.at || sb.at;
    if (Math.hypot(sb.at[0] - ip[0], (sb.at[1] - ip[1]) * KX) * KM > 0.15) g.add(pin(sb.at[0], sb.at[1], '#b8322a', 0.3, esc(sb.label || 'Uszkodzony tor'), 'clue', 0.02));
  }
  return g;
})();
// ---------- scenario props: the story's objects ("props" in the scenario file, machines3d.createProp) ----------
// [{kind, at, heading? (deg clockwise from north), from? / until? ("HH:MM" scenario clock), label?, size?}]: real size,
// on the ground (floating kinds on the water surface where isWater says water, an avalanche draped lump by lump), a
// labelled pin when the prop has a label; shown only between `from` and `until` of the shown step's clock. Display only.
const props = (() => {
  const list = (SCN?.props || []).filter((p) => Array.isArray(p.at) && inside(p.at) && !/^(train-derailed|damaged-track)$/.test(p.kind));
  if (!list.length) return null;
  const out = [], v = new THREE.Vector3();
  for (const p of list) {
    const pr = createProp(THREE, p); if (!pr) { console.warn('3d: unknown prop kind', p.kind); continue; }
    const [la, lo] = p.at, x = toX(lo), z = toZ(la);
    const y = meshHeightAt(la, lo) + (pr.float && isWater(la, lo) ? 0.008 : 0) - (pr.sink || 0) * (pr.float && isWater(la, lo) ? 1 : 0.3);
    const h = ((+p.heading || 0) * Math.PI) / 180;
    pr.obj.position.set(x, y, z); pr.obj.rotation.y = Math.atan2(Math.cos(h), Math.sin(h));
    if (pr.obj.userData.drape) { pr.obj.updateMatrixWorld(true); for (const [m, lift] of pr.obj.userData.drape) { m.getWorldPosition(v); m.position.y = meshHeightAt(toLat(v.z), toLon(v.x)) - y + lift; } }
    if (pr.obj.userData.drapeMesh) { // a surface laid on the terrain vertex by vertex (avalanche debris)
      const [m, lift] = pr.obj.userData.drapeMesh, P = m.geometry.attributes.position; pr.obj.updateMatrixWorld(true);
      for (let i = 0; i < P.count; i++) { const j = P.getY(i); v.fromBufferAttribute(P, i).setY(0).applyMatrix4(m.matrixWorld); P.setY(i, meshHeightAt(toLat(v.z), toLon(v.x)) - y + lift + j); }
      P.needsUpdate = true; m.geometry.computeVertexNormals(); m.geometry.computeBoundingSphere();
    }
    const g = new THREE.Group(); g.name = 'prop'; g.add(pr.obj);
    if (p.label) g.add(pin(la, lo, '#b8322a', 0.25, esc(p.label), 'clue', 0.018));
    scene.add(g); out.push({ p, pr, g });
  }
  const mins = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : null; };
  return {
    list: out,
    setClock(clock) { const c = mins(clock); for (const o of out) { const f = mins(o.p.from), u = mins(o.p.until); o.g.visible = c == null || ((f == null || c >= f) && (u == null || c < u)); } },
    tick(dt) { for (const o of out) if (o.g.visible && o.pr.tick) o.pr.tick(dt); },
  };
})();

// dynamic layers
const dyn = { top: new THREE.Group(), searched: new THREE.Group(), teams: new THREE.Group(), signals: new THREE.Group(), live: new THREE.Group(), game: new THREE.Group() };
Object.values(dyn).forEach((g) => scene.add(g));
const movers = [];

// ---------- mood: time of day, weather, valley fog ----------
// The sky palette follows the sun's elevation (deg): day, golden hour, sunset, alpenglow, blue hour and the moonlit night
// (the old night mood, with a cooler ambient). The weather is layered on top every frame: fog greys and flattens the
// light, a building cloud deck darkens the sky and hides the sun, snow turns it white. The sun moves in ~3 s, clouds
// build in ~5 s, rain / snow start only once the deck is there, and the step before rain already builds it.
const SKY_KEYS = [
  [-18, { top: '#121c33', bottom: '#4c5874', fog: '#3c4762', sun: '#c6d4f5', glow: '#000000', hs: '#7486ad', hg: '#2a2e3b', sunI: 1.25, hI: 0.95, exp: 1.05 }], // night: darker moonlit (review 1791058388408 pt 4), markers and heat glow carry the picture
  [-11, { top: '#121c33', bottom: '#4c5874', fog: '#3c4762', sun: '#c6d4f5', glow: '#000000', hs: '#7486ad', hg: '#2a2e3b', sunI: 1.25, hI: 0.95, exp: 1.05 }],
  [-7, { top: '#203a6e', bottom: '#7a8ab6', fog: '#63739c', sun: '#c8d6ff', glow: '#5a4a8a', hs: '#97a9d6', hg: '#43485c', sunI: 1.3, hI: 1.25, exp: 1.15 }],
  [-4.5, { top: '#2f4a80', bottom: '#a796b4', fog: '#8a8cad', sun: '#ff94a8', glow: '#c05878', hs: '#aab2d6', hg: '#4d4858', sunI: 0, hI: 1.25, exp: 1.22 }],
  [-3, { top: '#3a5689', bottom: '#d9958c', fog: '#9e9ab4', sun: '#ff8c96', glow: '#ff6a5a', hs: '#b4b6d6', hg: '#544a50', sunI: 1.1, hI: 1.1, exp: 1.2 }],
  [0.5, { top: '#4a6ca0', bottom: '#f2a26c', fog: '#bcb4c0', sun: '#ff9a5c', glow: '#ff8a4a', hs: '#c8c4d8', hg: '#5e4a3a', sunI: 2.1, hI: 0.9, exp: 1.18 }],
  [5, { top: '#4776af', bottom: '#f3d0a0', fog: '#c3cad6', sun: '#ffc888', glow: '#ffbf80', hs: '#d2d6e6', hg: '#6a573c', sunI: 2.7, hI: 0.88, exp: 1.16 }],
  [14, { top: '#3f78b8', bottom: '#f1e2cc', fog: '#c8d5e2', sun: '#ffe8c8', glow: '#ffe2b8', hs: '#cfdcf0', hg: '#6a5a3e', sunI: 2.9, hI: 0.9, exp: 1.15 }],
  [30, { top: '#3f78b8', bottom: '#f1e6d4', fog: '#c9d8e6', sun: '#fff0d6', glow: '#fff0d6', hs: '#cfe0f5', hg: '#6a5a3e', sunI: 3.0, hI: 0.9, exp: 1.15 }],
].map(([el, k]) => [el, Object.fromEntries(Object.entries(k).map(([n, v]) => [n, typeof v === 'string' ? new THREE.Color(v) : v]))]);
const PAL_C = ['top', 'bottom', 'fog', 'sun', 'glow', 'hs', 'hg'], PAL_N = ['sunI', 'hI', 'exp'];
const pal = Object.fromEntries(PAL_C.map((n) => [n, new THREE.Color()]));
function palette(el) {
  const e = clamp(el, -18, 30); let i = 1;
  while (i < SKY_KEYS.length - 1 && SKY_KEYS[i][0] < e) i++;
  const [e0, a] = SKY_KEYS[i - 1], [e1, b] = SKY_KEYS[i], t = clamp((e - e0) / (e1 - e0), 0, 1);
  for (const n of PAL_C) pal[n].copy(a[n]).lerp(b[n], t);
  for (const n of PAL_N) pal[n] = a[n] + (b[n] - a[n]) * t;
  return pal;
}
await yieldMain();
// ---------- night glow: halos around markers at night and in fog, lit windows ----------
// One additive point cloud (fx3d.halo): every visible object tagged userData.glow ([colour, px]) gets a soft halo at its
// world position, gathered only on rendered frames while it is dark or foggy. uNight drives the buildings' windows.
const haloMat = FX.halo(), HALO_MAX = 256;
const halos = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(HALO_MAX * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(HALO_MAX * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(HALO_MAX), 1).setUsage(THREE.DynamicDrawUsage));
  const p = new THREE.Points(g, haloMat); p.frustumCulled = false; p.visible = false; p.renderOrder = 4; scene.add(p);
  return p;
})();
const glowCol = new Map(), glowV = new THREE.Vector3();
function glowTick() {
  const night = clamp(heatU.uEmis.value * 4, 0, 1), fog = clamp((9 - scene.fog.near) / 3, 0, 1); // mood: emis 0.25 at night, fog near 9 clear .. 5 thick
  heatU.uNight.value = night;
  const amt = Math.max(night, fog * 0.65); haloMat.uniforms.uAmt.value = amt; haloMat.uniforms.uTime.value = heatU.uTime.value;
  halos.visible = amt > 0.01; if (!halos.visible) return;
  haloMat.uniforms.uPx.value = renderer.getPixelRatio();
  const P = halos.geometry.attributes.position, C = halos.geometry.attributes.aCol, S = halos.geometry.attributes.aSize; let n = 0;
  scene.traverseVisible((o) => {
    const gl = o.userData.glow; if (!gl || n >= HALO_MAX) return;
    let c = glowCol.get(gl[0]); if (!c) glowCol.set(gl[0], (c = new THREE.Color().setStyle(gl[0], THREE.LinearSRGBColorSpace))); // raw: the halo shader writes display values
    o.getWorldPosition(glowV); P.setXYZ(n, glowV.x, glowV.y, glowV.z); C.setXYZ(n, c.r, c.g, c.b); S.setX(n, gl[1]); n++;
  });
  halos.geometry.setDrawRange(0, n); P.needsUpdate = C.needsUpdate = S.needsUpdate = true;
}

const C_HAZE = new THREE.Color(0.86, 0.94, 1.06), C_WHITE = new THREE.Color(1, 1, 1), C_MOONLIT = new THREE.Color('#7d8bab'), C_ALPEN = new THREE.Color('#ff5f7e');
const C_SNOWFOG = new THREE.Color('#e7ecf1'), C_SNOWSKY = new THREE.Color('#eef1f4'), tmpC = new THREE.Color();
const greyOf = (c, k) => { const l = (c.r * 0.3 + c.g * 0.59 + c.b * 0.11) * k; return tmpC.setRGB(l, l, l); };
// valley fog field (fx3d atmosphere): the local valley floor = a 0.6 km minimum filter of the mesh heights, smoothed;
// fog fills what lies below it plus the current thickness (cirques, valley bottoms, lakes, flat lowland)
{
  const C = DEM.cols, Rr = DEM.rows, cell = WKM / Math.max(C - 1, 1), H = new Float32Array(C * Rr);
  for (let r = 0; r < Rr; r++) for (let c = 0; c < C; c++) H[r * C + c] = ((DEM.z[r][c] - zMin) * EX) / 1000;
  const pass = (src, dx, dy, rad, isMin) => {
    const out = new Float32Array(src.length);
    for (let r = 0; r < Rr; r++) for (let c = 0; c < C; c++) {
      let a = isMin ? Infinity : 0, n = 0;
      for (let t = -rad; t <= rad; t++) {
        const rr = r + t * dy, cc = c + t * dx; if (rr < 0 || cc < 0 || rr >= Rr || cc >= C) continue;
        const v = src[rr * C + cc]; if (isMin) { if (v < a) a = v; } else { a += v; n++; }
      }
      out[r * C + c] = isMin ? a : a / n;
    }
    return out;
  };
  const mr = Math.max(2, Math.round(0.6 / cell)), br = Math.max(1, Math.round(0.3 / cell));
  let F = pass(pass(H, 1, 0, mr, true), 0, 1, mr, true);
  for (let k = 0; k < 2; k++) F = pass(pass(F, 1, 0, br, false), 0, 1, br, false);
  let fMax = 1e-6; for (const v of F) if (v > fMax) fMax = v;
  const data = new Uint8Array(C * Rr * 4); // row 0 = north = v 0, as z grows southwards
  for (let i = 0; i < C * Rr; i++) { data[i * 4] = Math.round((F[i] / fMax) * 255); data[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(data, C, Rr, THREE.RGBAFormat); t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  ATMO.uValley.value = t; ATMO.uValleyRect.value.set(-WKM / 2, -HKM / 2, WKM, HKM); ATMO.uValleyP.value.w = fMax;
}
ATMO.uAtmoSun.value = SKY_SUN; // haze glows towards the sun, also below the horizon
ATMO.uAlpenY.value.set(0.45, 0.85).multiplyScalar(((zMax - zMin) * EX) / 1000); // alpenglow on the upper part of the relief
const ALPEN = smooth(500, 1200, zMax - zMin) * 0.26; // mountains only
const s0 = sunOfStep(STEP0);
const cur = { el: s0.el, az: s0.az, cloud: 0.35, rain: 0, snow: 0, fogW: 0, white: 0, near: 12, far: 60, wind: 0.02, cover: 0, valley: 0, vthick: 0.07 };
let tgt = { ...cur, storm: false };
// far shadow re-bake when the key light moves: rows spread over frames (~4 ms each) into the hidden mask, then crossfade
const bake = { want: keyDir(s0, new THREE.Vector3(), 0.8), dir: keyDir(s0, new THREE.Vector3(), 0.8), job: null, side: 0, fade: false };
function tickBake(dt) {
  const u = heatU.uSunMaskT;
  if (bake.fade) { u.value = clamp(u.value + (bake.side ? dt : -dt) / 1.4, 0, 1); if (u.value === bake.side) bake.fade = false; return; }
  if (!bake.job && bake.want.angleTo(bake.dir) > 0.008) bake.job = { dir: bake.want.clone(), r: 0, tex: bake.side ? heatU.uSunMask.value : heatU.uSunMask2.value };
  const j = bake.job; if (!j) return;
  const t0 = performance.now();
  while (j.r < sunBake.rows && performance.now() - t0 < 4) { const r1 = Math.min(sunBake.rows, j.r + 6); sunBake.run(j.dir, j.tex, j.r, r1); j.r = r1; }
  if (j.r >= sunBake.rows) { j.tex.needsUpdate = true; bake.dir.copy(j.dir); bake.side = 1 - bake.side; bake.fade = true; bake.job = null; }
}
function setMood(w, i = STEP) {
  const on = weatherOn, vis = on ? w?.visibilityM ?? 10000 : 10000, sp = sunOfStep(i), tC = w?.tempC ?? 8;
  const pr = on && w?.precip && w.precip !== 'none' ? w.precip : null, next = on ? R.steps[i + 1]?.weather?.precip : null;
  tgt = {
    el: sp.el, az: sp.az, storm: pr === 'rain',
    fogW: vis <= 100 ? 1 : vis < 500 ? 0.8 : vis < 2000 ? 0.25 : 0,
    near: !on ? 9 : vis <= 100 ? 5.5 : vis < 500 ? 6.5 : 9, far: !on ? 40 : vis <= 100 ? 26 : vis < 500 ? 30 : 40,
    wind: clamp((on ? w?.windMs ?? 4 : 4) / 14, 0.15, 1.5) * 0.07,
    // cloud cover and precipitation from the step's weather (off with "Pogoda"); rain at the next step builds the deck now
    cloud: !on ? 0.3 : pr ? 0.88 : vis < 500 ? 0.7 : next && next !== 'none' ? 0.62 : 0.35,
    rain: pr === 'rain' ? 1 : pr === 'drizzle' ? 0.35 : 0, snow: pr === 'snow' ? 1 : 0,
    white: pr === 'snow' ? smooth(-8, -2, sp.el) : 0, // whiteout by day: white fog, closer, flat light
    // snow cover: full while it snows, a dusting in hard frost (accumulates slowly in stepMood)
    cover: !on ? 0 : pr === 'snow' ? 1 : tC <= -3 ? 0.5 : tC <= 0 ? 0.25 : 0,
    // valley fog: thick in low visibility, a thin layer in cool air around dusk, dawn and at night, none in heat
    valley: !on ? 0 : Math.max(vis < 500 ? 1 : 0, smooth(16, 3, sp.el) * smooth(20, 8, tC) * (pr ? 0.3 : 0.6)),
    vthick: vis < 500 ? 0.2 : 0.07 + 0.04 * smooth(10, -6, sp.el),
  };
  if (pr === 'snow') { tgt.near *= 1 - 0.2 * tgt.white; tgt.far *= 1 - 0.25 * tgt.white; }
  keyDir(sp, bake.want, 0.8);
}
let flash = 0, flashIn = 3, flick = 0, envAt = -1, shadowAt = 0, shadowDirty = false;
const lastKey = new THREE.Vector3(), envSig = new Float32Array(9);
function stepMood(dt, snap = false) {
  const now = performance.now(), kk = (r) => (snap ? 1 : 1 - Math.exp(-dt * r));
  const kS = kk(1.1);
  cur.el += (tgt.el - cur.el) * kS; cur.az += ((((tgt.az - cur.az) % 360) + 540) % 360 - 180) * kS;
  for (const n of ['near', 'far', 'wind', 'fogW', 'white', 'valley', 'vthick']) cur[n] += (tgt[n] - cur[n]) * kk(0.9);
  cur.cloud += (tgt.cloud - cur.cloud) * kk(tgt.cloud > cur.cloud ? 0.45 : 0.35);
  const gate = smooth(0.55, 0.8, cur.cloud); // rain and snow fall once the deck has built, and stop first
  for (const n of ['rain', 'snow']) { const g = tgt[n] * gate; cur[n] += (g - cur[n]) * kk(g > cur[n] ? 0.8 : 1.6); }
  cur.cover += (tgt.cover - cur.cover) * kk(0.35); heatU.uSnowCover.value = cur.cover; // snow builds up over a few seconds
  heatU.uWind.value = cur.wind; heatU.uCloud.value = cur.cloud;
  heatU.uCloudOff.value.add(new THREE.Vector2(0.8, 0.6).multiplyScalar(dt * (0.004 + cur.wind * 0.12))); // clouds drift with the wind
  const su = skyMat.uniforms;
  su.uCloud.value = cur.cloud; su.uCloudOff.value.copy(heatU.uCloudOff.value);
  const pk = cur.snow > cur.rain ? 1 : 0, pa = Math.max(cur.rain, cur.snow);
  precip.visible = pa > 0.01; precipMat.uniforms.uKind.value = pk; precipMat.uniforms.uAmt.value = pa;
  snowNear.visible = cur.snow > 0.01; snowNearMat.uniforms.uAmt.value = cur.snow;
  // colours: the palette at the current sun height, then fog (f), cloud deck (st) and whiteout on top
  const el = cur.el, p = palette(el), f = cur.fogW, st = smooth(0.6, 0.92, cur.cloud), night = smooth(-4, -10, el), tw = smooth(14, 1, el) * smooth(-7, -2, el) * (1 - st) * (1 - cur.white);
  p.top.lerp(greyOf(p.top, 1.15), 0.55 * f); p.top.lerp(greyOf(p.top, 0.7), 0.75 * st);
  p.bottom.lerp(p.fog, 0.6 * f); p.bottom.lerp(greyOf(p.bottom, 0.8), 0.6 * st);
  p.fog.lerp(greyOf(p.fog, 1.04), 0.4 * f); p.fog.lerp(greyOf(p.fog, 0.85), 0.5 * st);
  if (cur.white > 0.001) { p.fog.lerp(C_SNOWFOG, cur.white); p.bottom.lerp(C_SNOWSKY, cur.white); }
  const sunAmt = (1 - 0.55 * f) * (1 - 0.8 * st);
  su.top.value.copy(p.top); su.bottom.value.copy(p.bottom); su.uHaze.value.copy(p.fog).multiply(tmpC.copy(C_HAZE).lerp(C_WHITE, Math.max(cur.white, 0.5 * f)));
  su.sunCol.value.copy(p.glow); su.sunAmt.value = sunAmt; dirOf(el, cur.az, SKY_SUN);
  su.uMoon.value = night * (1 - 0.85 * cur.cloud) * (1 - 0.7 * f);
  su.uCloudLit.value.copy(C_WHITE).multiplyScalar(0.95).lerp(p.glow, 0.7 * tw).multiplyScalar(0.1 + 0.9 * smooth(-9, 0, el)).lerp(C_MOONLIT, night * 0.8).multiplyScalar(1 - 0.35 * st);
  su.uCloudDark.value.copy(p.bottom).lerp(p.top, 0.35).multiplyScalar(0.92); // bases: sky light from below
  scene.fog.color.copy(p.fog); scene.fog.near = cur.near; scene.fog.far = cur.far;
  ATMO.uAtmoSunCol.value.copy(p.glow).multiplyScalar(smooth(-7, -1, el) * (1 - 0.7 * st) * (1 - 0.5 * f));
  ATMO.uValleyP.value.set(cur.valley, cur.vthick, heatU.uTime.value, ATMO.uValleyP.value.w);
  ATMO.uValleyCol.value.copy(p.fog).lerp(p.hs, 0.35).lerp(p.glow, 0.2 * tw);
  ATMO.uAlpen.value.copy(C_ALPEN).multiplyScalar(ALPEN * smooth(2.5, -0.5, el) * smooth(-5.5, -2.5, el) * (1 - 0.8 * st) * (1 - 0.3 * f));
  // lights: sun or moon (key), sky ambient, lightning in rain
  if (tgt.storm && cur.rain > 0.6 && !snap) {
    if ((flashIn -= dt) <= 0) { flash = 1; flick = 0.1 + Math.random() * 0.15; flashIn = 6 + Math.random() * 12; }
    if (flick > 0 && (flick -= dt) <= 0) flash = Math.max(flash, 0.8);
  }
  flash *= Math.exp(-dt * 10); su.uFlash.value = flash;
  keyDir({ el, az: cur.az }, SUN_DIR);
  sun.color.copy(p.sun); sun.intensity = p.sunI * (1 - 0.25 * f) * (1 - 0.6 * st) * (1 - 0.3 * cur.white);
  hemi.color.copy(p.hs); hemi.groundColor.copy(p.hg);
  hemi.intensity = p.hI * 0.45 * (1 + 0.12 * f) + flash * 2.5; // the sky environment map carries the rest of the ambient light
  starMat.opacity = 0.6 * smooth(-5, -11, el) * (1 - 0.9 * f) * (1 - st);
  heatU.uDay.value = 0.15 + 0.85 * smooth(-9, -2, el); heatU.uEmis.value = 0.25 * smooth(-3, -9, el);
  renderer.toneMappingExposure = p.exp + 0.05 * st;
  // the key light moved: shadow map and the far (baked) shadow follow
  if (SUN_DIR.distanceToSquared(lastKey) > 1e-7) { lastKey.copy(SUN_DIR); shadowDirty = true; }
  if (shadowDirty && (snap || now - shadowAt > 150)) {
    shadowDirty = false; shadowAt = now;
    sun.position.set(shFit.x, 0, shFit.z).addScaledVector(SUN_DIR, 30); sun.target.position.set(shFit.x, 0, shFit.z); sun.target.updateMatrixWorld();
    renderer.shadowMap.needsUpdate = true;
  }
  if (!snap) tickBake(dt);
  // Sky light follows weather transitions at most once a second; retain the smooth palette each frame.
  const sig = [p.top.r, p.top.g, p.top.b, p.bottom.r, p.bottom.g, p.bottom.b, cur.cloud, sunAmt * 0.3, el * 0.01];
  let d = 0; for (let k = 0; k < sig.length; k++) d = Math.max(d, Math.abs(sig[k] - envSig[k]));
  if (!snap && d > 0.004 && now - envAt > 1000) { envSig.set(sig); updateEnv(); }
}
// image-based light from the sky dome: prefiltered with PMREM, re-baked only while the mood (time, weather) is changing
const pmrem = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene(), envSkyMat = skyMat.clone();
envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), envSkyMat));
// Sky lighting is smooth: capture 64px cube faces instead of fromScene's fixed 256px faces.
// Reuse the capture target; keep the same weather-driven PMREM updates and HDR lighting.
const envCube = new THREE.WebGLCubeRenderTarget(64, { type: THREE.HalfFloatType, generateMipmaps: false });
const envCamera = new THREE.CubeCamera(0.1, 50, envCube);
let envRT = null;
function updateEnv() {
  const u = envSkyMat.uniforms, s = skyMat.uniforms;
  for (const k in s) { const v = s[k].value; if (v?.copy) u[k].value.copy(v); else u[k].value = v; }
  u.bottom.value.lerp(hemi.groundColor, 0.55); u.sunAmt.value = s.sunAmt.value * 0.15; u.uMoon.value *= 0.3; u.uFlash.value = 0;
  envCamera.update(renderer, envScene);
  const rt = pmrem.fromCubemap(envCube.texture);
  scene.environment = rt.texture; envRT?.dispose(); envRT = rt; envAt = performance.now();
}
scene.environmentIntensity = 0.7;

// ---------- source signals ----------
function anchorOf(e) {
  if (e.point && inside(e.point)) return e.point;
  if (e.points?.length) { const ins = e.points.filter(inside); if (ins.length) return e.provider === 'TrailheadCar' ? ins[0] : ins[Math.floor(ins.length / 2)]; }
  if (e.segments?.length) { const g = segs.get(e.segments[0]); if (g) return g.center; }
  return null;
}
function drawSignal(e, isCur) {
  const [badge, col] = sigOf(e), G = dyn.signals, op = isCur ? 1 : 0.6;
  if (e.provider === 'KoesterRings' && e.point) {
    (e.quantilesKm || []).forEach((q, j) => {
      const ring = circleLL(e.point, q * 1000, 160);
      drapeRuns(ring, 0.02, { color: col, width: 1.5, opacity: 0.75 * op, dashed: true, dash: 0.08, gap: 0.05 }, G);
      const at = ring[20];
      if (isCur && inside(at)) G.add(label(`${[25, 50, 75, 95][j] ?? ''}% · ${q} km`, 'ring', v3(at[0], at[1], 0.05)));
    });
    return; // the IPP pin marks the centre
  }
  if (isFound(e)) return; // the find pin is shown separately
  if (e.points?.length) drapeRuns(e.points, 0.024, { color: col, width: isCur ? 3 : 2.2, opacity: op, dashed: e.provider === 'TrailheadCar', dash: 0.05, gap: 0.035 }, G);
  if (e.point && e.radiusM >= 100) drapeRuns(circleLL(e.point, e.radiusM), 0.022, { color: col, width: 1.8, opacity: 0.85 * op, dashed: true, dash: 0.06, gap: 0.04 }, G);
  const a = anchorOf(e); if (!a) return;
  const short = e.title.length > 40 ? e.title.slice(0, 38) + '…' : e.title;
  G.add(pin(a[0], a[1], col, isCur ? 0.34 : 0.2, `<span class="d" style="background:${col}"></span><b>${esc(e.at)}</b> ${esc(isCur ? short : badge)}`, 'sig' + (isCur ? ' cur' : ''), isCur ? 0.022 : 0.015));
}

// ---------- step state ----------
let STEP = -1, TL3D = null, WALK = null;
const searchedUpTo = (i) => { const s = new Set(); EVENTS.forEach((e) => { if (e.step >= 0 && e.step <= i && !OFF.has(e.step)) (e.segments || []).forEach((id) => s.add(id)); }); return s; };
// evidence id = step's hintId (string) or step index; '*' with on:true restores all
const stepOfEvidence = (id) => (Number.isInteger(id) ? id : R.steps.findIndex((s) => s.hintId === id));
function setEvidence(id, on, notify = false) {
  if (id === '*') { if (on) OFF.clear(); }
  else { const k = stepOfEvidence(id); if (k < 0 || k >= R.steps.length) return; if (on) OFF.delete(k); else OFF.add(k); if (notify) toParent({ type: 'evidence', id: R.steps[k].hintId ?? k, on }); }
  const cur = STEP; STEP = -1; setStep(Math.max(0, cur), false);
}
function renderOffBanner(i) {
  const off = [...OFF].filter((k) => k <= i).sort((a, b) => a - b), el = $('offbanner');
  el.hidden = !off.length;
  if (!off.length) return;
  const short = (t) => (t.length > 34 ? t.slice(0, 33) + '…' : t);
  el.innerHTML = `Widok przeliczony w przeglądarce bez: ${off.map((k) => `<b>${esc(short(R.steps[k].label))}</b>`).join(', ')} <button class="btn sm" id="resetoff">Przywróć</button>`;
  $('resetoff').onclick = () => { setEvidence('*', true); toParent({ type: 'evidence', id: '*', on: true }); };
}
// Na żywo: the shell's {type:'time', live:true} (fallback: a run URL without live=0); then the frame does not re-rank the top 3
let TL_LIVE = (() => { try { return !P.reveal && new URL(P.run, location.href).searchParams.get('live') !== '0' && (Q.get('embed') === 'scene' || Q.get('embed') === 'fpp'); } catch { return false; } })();
const rankedOf = (segments) => [...segments].sort((a, b) => b.poa - a.poa);
// the shell's panel top 3 ({type:'time', top:[ids]}, 7e2b7a9): when present it is the only source of the #1-#3 labels
let TL_TOP = null, TL_TOPM = null, topDrawn = '';   // ids + the shell minute they belong to
const topOfShell = () => TL_TOP.map((id) => segs.get(id)).filter(Boolean);
const useShellTop = () => !!TL_TOP;   // also with a signal switched off: the shell relays the 2D's recomputed top 3 (33a6ad6)
function drawTop(ranked) {
  if (useShellTop() && G.phase === 'off') ranked = topOfShell();   // also after a step / evidence redraw
  topDrawn = ranked.slice(0, 3).map((s) => s.id).join();
  disposeGroup(dyn.top);
  if (R.synthetic && G.phase === 'off') return;
  ranked.slice(0, 3).forEach((sg, k) => {
    const g = segs.get(sg.id); if (!g) return;
    // as in 2D: top 3 outlined white 3.2 px, chip "#1 Name - 21%" with the rank in red
    drapeRuns(ringLL(g.polygon), 0.02, { color: '#ffffff', width: 3.2, opacity: 0.95 }, dyn.top);
    const l = label(`<b class="rk">#${k + 1}</b> ${esc(sg.name)}`, 'top3', v3(g.center[0], g.center[1], 0.14));
    l.userData.glow = ['#fff0c8', k ? 100 : 130]; dyn.top.add(l);
  });
}
function setStep(i, animate = true, fromTime = false) {
  if (G.phase !== 'off') return;
  i = clamp(i, 0, R.steps.length - 1);
  const prev = STEP; STEP = i;
  const s = R.steps[i], OG = gridFor(i), ranked = OG ? rankedOf(segPoa(OG)) : rankedOf(s.segments);
  props?.setClock(s.t); // story objects appear at their clock
  WASH = new Map(); EVENTS.forEach((e) => { if (e.step >= 0 && e.step <= i && !OFF.has(e.step)) (e.segments || []).forEach((id) => WASH.set(id, (WASH.get(id) || 0) + 1)); });
  showHeat(OG ? heatCanvasGrid(OG) : heatOf(i), animate && prev >= 0);
  drawTop(ranked);
  disposeGroup(dyn.searched);
  const searched = searchedUpTo(i);
  for (const id of searched) { const g = segs.get(id); if (g) drapeRuns(ringLL(g.polygon), 0.018, { color: '#555b61', width: 1.8, opacity: 0.9, dashed: true, dash: 0.035, gap: 0.03 }, dyn.searched); }
  disposeGroup(dyn.signals);
  EVENTS.forEach((e) => { if (e.step >= 0 && e.step <= i && !OFF.has(e.step)) drawSignal(e, e.step === i); });
  drawTeams(s);
  if (foundPin) foundPin.visible = foundStep >= 0 && i >= foundStep;
  if (revealPin) revealPin.visible = i >= (foundStep >= 0 ? foundStep : R.steps.length - 1);
  labelsDirty = true; wake();
  // blind-01 replay: the hider's story appears with the reveal pin (the shell's step card does not know it)
  if (REV) { const at = i >= (foundStep >= 0 ? foundStep : R.steps.length - 1); if (at) gamePanel(`<h3>Odsłonięcie (${esc(REV.round || '')})</h3><p>${esc(REV.story || '')}${REV.state ? ` <i>(${esc(REV.state)})</i>` : ''}</p>`); else $('game').hidden = true; }
  setMood(s.weather, i);
  renderOffBanner(i);
  if (TL3D && !fromTime && !fromParent) TL3D.setTime(s.minute, s.t, false); // the shell sends {type:'time'} right after its step
  if (prev !== i && !fromParent) toParent({ type: 'step', i, t: s.t });
}
function drawTeams(s) {
  disposeGroup(dyn.teams); movers.length = 0;
  unitCars?.setActive(new Set((s.assignments || []).map((a) => a.resourceId))); // deployed units: blue lights on
  if (R.timeline?.actors?.length) return; // timeline tracks replace decorative assignment loops
  // history: every patrol so far, as a faint trail from its base to the searched segment
  for (const e of EVENTS) {
    if (!(e.step >= 0 && e.step <= STEP && e.segments?.length)) continue;
    const res = resources.get(e.resource) || (e.provider === 'DronePassEmpty' ? resources.get('drone') : null);
    const base = res?.base || [R.ipp.lat, R.ipp.lon], col = TEAM_COL[res?.type] || '#555b61';
    for (const id of e.segments) {
      const g = segs.get(id); if (!g) continue;
      const p0 = v3(base[0], base[1], 0.03), p2 = v3(g.center[0], g.center[1], 0.04);
      const p1 = p0.clone().lerp(p2, 0.5); p1.y = Math.max(p0.y, p2.y) + 0.15 + p0.distanceTo(p2) * 0.08;
      dyn.teams.add(makeLine(new THREE.QuadraticBezierCurve3(p0, p1, p2).getPoints(40), { color: col, width: e.step === STEP ? 2.2 : 1.2, opacity: e.step === STEP ? 0.95 : 0.4 }));
    }
  }
  const resInfo = new Map((s.resources || []).map((r) => [r.id, r]));
  for (const a of s.assignments || []) {
    const res = resources.get(a.resourceId), g = segs.get(a.segmentId); if (!res?.base || !g) continue;
    const type = resInfo.get(a.resourceId)?.type || res.type, col = TEAM_COL[type] || '#555';
    const bIn = [clamp(res.base[0], latS + 0.001, latN - 0.001), clamp(res.base[1], lonW + 0.001, lonE - 0.001)]; // base off the map: start at its edge
    const p0 = v3(bIn[0], bIn[1], 0.03), p2 = v3(g.center[0], g.center[1], 0.05);
    const p1 = p0.clone().lerp(p2, 0.5); p1.y = Math.max(p0.y, p2.y) + (type === 'heli' || type === 'drone' ? 0.45 : 0.22) + Math.min(p0.distanceTo(p2), 6) * 0.12;
    const curve = new THREE.QuadraticBezierCurve3(p0, p1, p2), pts = curve.getPoints(64);
    const line = makeLine(pts, { color: col, width: 1.8, opacity: 0.9, dashed: true, dash: 0.05, gap: 0.04 });
    const mach = createMachine(THREE, type, operatorPaint(res.name) || col); // aircraft fly the arc as a model (operator livery); ground teams, dogs, boats, divers go along its ground track
    const dot = mach ? mach.obj : new THREE.Mesh(ballGeo, new THREE.MeshStandardMaterial({ color: col }));
    if (!mach) { dot.scale.setScalar(0.014); dot.userData.glow = ['#' + new THREE.Color(col).lerp(new THREE.Color('#ffffff'), 0.45).getHexString(), 100]; }
    dyn.teams.add(line, dot, label(`${esc(res.name.split(' (')[0])} · ${Math.round(a.etaMin)} min`, 'team', p1.clone()));
    movers.push({ curve, dot, mach, mat: line.material, t: Math.random(), speed: mach && mach.surface !== 'air' ? 0.04 : 0.15 }); // walkers loop slower (~25 s)
  }
}

// ---------- legend (shared scale) ----------
const LEGEND_HEAT = `<div class="lg-title" title="Waga mapy w komórce 100 x 100 m względem średniej: 1× = średnio ${nf(100 / (R.rows * R.cols), 3)}% na komórkę; poniżej 0,5× bez koloru">Waga mapy <span class="lg-sub">× średnia</span></div><i class="ramp" style="background:${gradientCSS()}"></i>
    <div class="stops">${STOPS.map((x) => `<span>${x.label}</span>`).join('')}</div>
    <div class="lg-keys"><span><i class="k-top"></i>top 3</span><span><i class="k-srch"></i>przeszukany</span></div>`;
const LEGEND_DIFF = `<div class="lg-title">Trudność terenu (silnik)</div><div class="lg-diff">${(R.difficultyClasses || []).map((c) => `<span><i style="background:${DIFF_COLORS[c.id] || '#000'}"></i>${esc(c.label)}</span>`).join('')}</div>`;
// embed=scene: legend box top-left and controls top-right, laid out like the 2D screen's #legend / #mapctl
if (EMB === 'scene') {
  $('sceneLegend').hidden = false; $('sceneLegend').innerHTML = LEGEND_HEAT;
  // control box like 2D #mapctl: segmented group, checkbox row, full-width button; it drives the regular HUD buttons
  const ctl = document.createElement('div'); ctl.id = 'sceneCtl'; ctl.className = 'floating';
  ctl.innerHTML = `<div class="seg-switch"><button data-b="btn-cine">Kino</button><button data-b="btn-top">Lider</button><button data-b="btn-rot">Obrót</button><button data-b="btn-walk" title="Spacer: kliknij w teren i idź z widokiem z oczu (Esc kończy)">Spacer</button></div>
    <div class="ctl-row"><label class="chk"><input type="checkbox" data-b="btn-diff"> trudność</label><label class="chk"><input type="checkbox" data-b="btn-trees" checked> las</label><label class="chk"><input type="checkbox" data-b="btn-traffic" checked> ruch</label><label class="chk"><input type="checkbox" data-b="btn-fog" checked> pogoda</label><label class="chk" hidden><input type="checkbox" data-b="btn-ortho"> zdjęcie</label></div>
    <button class="full" data-b="btn-all">Cały obszar</button><button class="full" data-b="btn-game">Test na ślepo</button>`;
  document.body.appendChild(ctl);
  ctl.addEventListener('click', (e) => { const t = e.target.closest('[data-b]'); if (!t) return; $(t.dataset.b).click(); syncCtl(); });
  if ($('btn-diff').hidden) ctl.querySelector('[data-b="btn-diff"]').closest('label').hidden = true;
  if ($('btn-traffic').hidden) ctl.querySelector('[data-b="btn-traffic"]').closest('label').hidden = true;
  const syncCtl = () => {
    ctl.querySelector('[data-b="btn-cine"]').classList.toggle('on', $('btn-cine').classList.contains('on'));
    ctl.querySelector('[data-b="btn-rot"]').classList.toggle('on', $('btn-rot').classList.contains('on'));
    ctl.querySelector('[data-b="btn-walk"]').classList.toggle('on', !!(WALK?.on || WALK?.armed));
    for (const id of ['btn-diff', 'btn-trees', 'btn-traffic', 'btn-fog', 'btn-ortho']) ctl.querySelector(`input[data-b="${id}"]`).checked = $(id).classList.contains('on');
    ctl.querySelector('input[data-b="btn-ortho"]').closest('label').hidden = $('btn-ortho').hidden; // shown once the aerial photo has loaded
  };
  setInterval(syncCtl, 1000); // Kino ends on its own; keep the box honest
  // collapsible box (Mateusz, AI Mateusza #2): a strip "Sterowanie 3D" + the active mode until hover / focus / tap
  // (hoverHold from ../dock.js, held 3 s, Esc closes); the pin keeps it open (localStorage). The width stays the same in both
  // states, so frameScene's reserved right margin (it reads only the box width) does not change. Kino keeps its own look.
  if (innerWidth > 600) {
    const head = document.createElement('div'); head.className = 'ctl-head';
    head.innerHTML = `<span class="ctl-ttl">Sterowanie 3D</span><span class="ctl-mode"></span><button type="button" class="ctl-pin" aria-pressed="false" title="Przypnij panel (zostaje rozwinięty)" aria-label="Przypnij panel sterowania 3D"><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M6 1.5h4l-.6 4.2 2.6 2.3v1.2H8.6V15h-1.2V9.2H4V8l2.6-2.3z" fill="currentColor"/></svg></button>`;
    ctl.prepend(head); ctl.classList.add('cc'); ctl.tabIndex = 0;
    const pin = head.querySelector('.ctl-pin'), mode = head.querySelector('.ctl-mode');
    const setPin = (v) => { ctl.classList.toggle('pinned', v); pin.setAttribute('aria-pressed', String(v)); try { localStorage.setItem('rl3dCtlPin', v ? '1' : '0'); } catch {} };
    try { if (localStorage.getItem('rl3dCtlPin') === '1') setPin(true); } catch {}
    pin.addEventListener('click', (e) => { e.stopPropagation(); setPin(!ctl.classList.contains('pinned')); });
    const syncMode = () => { mode.textContent = document.body.classList.contains('cinema') ? 'Kino' : (WALK?.on || WALK?.armed) ? 'Spacer' : document.querySelector('#timeline3dCtl button.on') ? 'FPP' : $('btn-rot').classList.contains('on') ? 'Obrót' : 'Swobodny'; };
    syncMode(); setInterval(syncMode, 500); ctl.addEventListener('click', () => setTimeout(syncMode, 0));
    import('../dock.js').then((m) => m.hoverHold(ctl, { holdMs: 3000 })).catch(() => { ctl.classList.remove('cc'); head.remove(); });
  }
}

// ---------- camera ----------
let fly = null;
function flyTo(target, dist = 3, dur = 1.6) {
  TL3D?.stopFpp();
  const dir = camera.position.clone().sub(controls.target).normalize();
  if (dir.y < 0.4) { dir.y = 0.5; dir.normalize(); }
  fly = { t: 0, dur, p0: camera.position.clone(), t0: controls.target.clone(), p1: target.clone().add(dir.multiplyScalar(dist)), t1: target.clone() };
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const bc = [(B.north + B.south) / 2, (B.east + B.west) / 2];
const center = new THREE.Vector3(toX(bc[1]), hAt(bc[0], bc[1]) * 0.6, toZ(bc[0]));
const SPAN = Math.max((B.east - B.west) * KX * KM, (B.north - B.south) * KM) * 1.15;
// frame a bbox ({south, west, north, east} or [s, w, n, e]) from the current azimuth, looking down ~42 degrees; the fly keeps the
// camera above the ground on the way (aboveGround in frame()), so it never passes through a ridge
// (the pose itself comes from frameScene below: the bbox corners and the named sectors framed, azimuth kept unless a ridge hides them)
function focusArea(bb, m = {}) {
  const [s, w, n, e] = Array.isArray(bb) ? bb : [bb.south, bb.west, bb.north, bb.east];
  if (![s, w, n, e].every(Number.isFinite) || n <= s || e <= w) return;
  const S = clamp(s, latS, latN), N = clamp(n, latS, latN), Wl = clamp(w, lonW, lonE), E = clamp(e, lonW, lonE);
  const pts = [], vis = [];
  for (const [a, b] of [[0, 0], [0, 0.5], [0, 1], [0.5, 0], [0.5, 1], [1, 0], [1, 0.5], [1, 1], [0.5, 0.5]]) pts.push(v3(S + (N - S) * a, Wl + (E - Wl) * b));
  vis.push([v3((S + N) / 2, (Wl + E) / 2, 0.03)]);
  for (const id of Array.isArray(m.segIds) ? m.segIds : []) { const g = segs.get(id); if (g) vis.push([v3(g.center[0], g.center[1], 0.03)]); }
  frameScene({ pts, vis, keepAz: true, padRight: +m.padRight || 0, dur: 1.6 });
}
function overview(dur = 1.8) {
  TL3D?.stopFpp();
  // oblique view from the south-east, the whole massif in frame
  fly = { t: 0, dur, p0: camera.position.clone(), t0: controls.target.clone(), p1: center.clone().add(new THREE.Vector3(SPAN * 0.42, SPAN * 0.62, SPAN * 0.92)), t1: center.clone() };
}
// frameScene (AI Mateusza #2): one camera pose for "show me what matters". It frames the IPP and the current top 3 sectors
// (or the given points) inside the free area between the shell's panels (insets + the scene's own control box), looks
// obliquely (42 deg in the mountains, 36 deg over lakes / flat ground with a wider margin), and picks one of 8 azimuths by
// marching rays from the candidate camera to sample points of each sector over the DEM: most visible wins, then north-up,
// then sunlit (and, when re-framing a focus, the current azimuth). Mountain shots keep the targets a bit below the centre so
// the far ridges and sky stay in the upper frame. The camera never ends below terrain + clearance; the fly orbits around
// the moving target (azimuth / elevation / log distance interpolated) instead of cutting through it.
let camUser = false; // the operator moved the camera since the last frameScene: do not reframe on 2D -> 3D or insets
const MOUNTAIN = !FLAT && !LOW && zMax - zMin > 250;
function framePoints() {
  const ids = topDrawn ? topDrawn.split(',') : rankedOf(R.steps[Math.max(0, STEP)].segments).slice(0, 3).map((s) => s.id);
  const pts = R.ipp && inside([R.ipp.lat, R.ipp.lon]) ? [v3(R.ipp.lat, R.ipp.lon)] : [], vis = [];
  for (const id of ids) {
    const g = segs.get(id); if (!g) continue;
    const c = g.center, poly = g.polygon || [], k = Math.max(1, Math.floor(poly.length / 10)), sam = [v3(c[0], c[1], 0.03)];
    for (let i = 0; i < poly.length; i += k) {
      const [lo, la] = poly[i]; if (!inside([la, lo])) continue;
      pts.push(v3(la, lo));
      if (sam.length < 5 && i % (k * 2) === 0) sam.push(v3(c[0] + (la - c[0]) * 0.5, c[1] + (lo - c[1]) * 0.5, 0.03)); // halfway to the edge
    }
    pts.push(sam[0]); vis.push(sam);
  }
  return { pts, vis };
}
function frameScene({ pts, vis, keepAz = false, padRight = 0, dur } = {}) {
  if (!pts) ({ pts, vis } = framePoints());
  if (!pts.length) return;
  vis = vis || [pts];
  const W = innerWidth, H = innerHeight, [T0, R0, B0, L0] = INSETS, ctl = $('sceneCtl'), cr = ctl && !ctl.hidden ? ctl.getBoundingClientRect() : null;
  const Rr = R0 + padRight + (cr && cr.width ? cr.width + 14 : 0), T = T0 + 12, Bm = B0 + 12, L = L0 + 12;
  const fx0 = -1 + (2 * L) / W, fx1 = 1 - (2 * Rr) / W, fy0 = -1 + (2 * Bm) / H, fy1 = 1 - (2 * T) / H;
  if (fx1 - fx0 < 0.3 || fy1 - fy0 < 0.3) return;
  const pitch = ((MOUNTAIN ? 42 : 36) * Math.PI) / 180, fill = MOUNTAIN ? 0.74 : 0.68, bias = MOUNTAIN ? -0.14 : -0.04; // bias: NDC of the targets' centre in the free area
  const tmp = camera.clone(), right = new THREE.Vector3(), up = new THREE.Vector3(), q = new THREE.Vector3(), tanH = Math.tan((camera.fov * Math.PI) / 360);
  const c0 = pts.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
  const cur = camera.position.clone().sub(controls.target), curAz = Math.atan2(cur.x, cur.z);
  const sunAz = Math.atan2(SUN_DIR.x, SUN_DIR.z);
  const pose = (az) => {
    const f = new THREE.Vector3(-Math.sin(az) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(az) * Math.cos(pitch));
    const t = c0.clone(); let d = clamp(Math.max(WKM, HKM) * 0.6, 1, 25);
    for (let it = 0; it < 6; it++) {
      tmp.position.copy(t).addScaledVector(f, -d); tmp.lookAt(t); tmp.updateMatrixWorld(); tmp.matrixWorldInverse.copy(tmp.matrixWorld).invert();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, behind = false;
      for (const p of pts) { q.copy(p).project(tmp); if (q.z > 1 || q.z < -1) { behind = true; break; } x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
      if (behind) { d *= 1.6; continue; }
      right.setFromMatrixColumn(tmp.matrixWorld, 0); up.setFromMatrixColumn(tmp.matrixWorld, 1);
      const ox = (x0 + x1) / 2 - (fx0 + fx1) / 2, oy = (y0 + y1) / 2 - ((fy0 + fy1) / 2 + (bias * (fy1 - fy0)) / 2);
      t.addScaledVector(right, ox * d * tanH * tmp.aspect).addScaledVector(up, oy * d * tanH);
      const s = Math.max((x1 - x0) / ((fx1 - fx0) * fill), (y1 - y0) / ((fy1 - fy0) * fill), 0.05);
      d = clamp(d * (0.35 + 0.65 * s), 0.7, 28);
    }
    const p = aboveGround(t.clone().addScaledVector(f, -d), 0.35);
    // share of the sample points the camera sees (a sector counts as much as the IPP)
    let seen = 0;
    for (const set of vis) {
      let ok = 0;
      for (const s of set) {
        let clear = true;
        for (let k = 1; k < 48 && clear; k++) {
          const u = k / 48, x = p.x + (s.x - p.x) * u, y = p.y + (s.y - p.y) * u, z = p.z + (s.z - p.z) * u;
          if (u < 0.97 && y < hAt(toLat(z), toLon(x)) - 0.004) clear = false;
        }
        ok += clear;
      }
      seen += ok / set.length;
    }
    const score = (seen / vis.length) * 10 + Math.cos(az) * 1.2 + Math.cos(az - sunAz) * 0.4 + (keepAz ? Math.cos(az - curAz) * 2.5 : 0);
    return { p, t, score, seen: seen / vis.length };
  };
  let best = null;
  for (const az of [...Array(8)].map((_, i) => (i * Math.PI) / 4).concat(keepAz ? [curAz] : [])) { const c = pose(az); if (!best || c.score > best.score) best = c; }
  TL3D?.stopFpp(); camUser = false;
  const hop = camera.position.distanceTo(best.p);
  const o0 = camera.position.clone().sub(controls.target), o1 = best.p.clone().sub(best.t);
  const sph0 = new THREE.Spherical().setFromVector3(o0), sph1 = new THREE.Spherical().setFromVector3(o1);
  let dth = sph1.theta - sph0.theta; dth = Math.atan2(Math.sin(dth), Math.cos(dth)); // shortest way round
  const t0 = controls.target.clone(), sp = new THREE.Spherical();
  fly = { t: 0, dur: dur ?? clamp(1.2 + hop * 0.04, 1.2, 1.8), p0: camera.position.clone(), t0, p1: best.p, t1: best.t,
    path: (k, out) => {
      sp.set(Math.exp(Math.log(Math.max(sph0.radius, 1e-3)) * (1 - k) + Math.log(sph1.radius) * k), sph0.phi + (sph1.phi - sph0.phi) * k, sph0.theta + dth * k);
      return out.setFromSpherical(sp).add(controls.target);
    } };
  return { seen: best.seen, pos: best.p, target: best.t };
}
$('btn-all').addEventListener('click', () => overview());
$('btn-top').addEventListener('click', () => {
  const s = G.phase === 'off' ? rankedOf(R.steps[STEP].segments)[0] : G.ranked[0];
  const g = segs.get(s.id); flyTo(v3(g.center[0], g.center[1]), 2.4);
});
let autoRot = false, idleAt = performance.now();
$('btn-rot').addEventListener('click', () => { TL3D?.stopFpp(); autoRot = !autoRot; $('btn-rot').classList.toggle('on', autoRot); });
$('btn-fog').addEventListener('click', () => { weatherOn = !weatherOn; $('btn-fog').classList.toggle('on', weatherOn); setMood(R.steps[Math.max(0, STEP)].weather, Math.max(0, STEP)); });
controls.addEventListener('start', () => { idleAt = Infinity; fly = null; camUser = true; if (CINE.on) cinema(false); });
controls.addEventListener('end', () => { idleAt = performance.now(); });

if (!(Array.isArray(R.difficulty) && R.difficulty.length === R.rows * R.cols)) $('btn-diff').hidden = true;
$('btn-diff').addEventListener('click', () => {
  SHOW_DIFF = !SHOW_DIFF; $('btn-diff').classList.toggle('on', SHOW_DIFF); compose();
  const dc = $('btn-diff').querySelector('input'); if (dc) dc.checked = SHOW_DIFF;
  $('sceneLegend').innerHTML = SHOW_DIFF ? LEGEND_DIFF : LEGEND_HEAT;
});
$('btn-trees').addEventListener('click', () => { forest.visible = !forest.visible; $('btn-trees').classList.toggle('on', forest.visible); });
if (!traffic) $('btn-traffic').hidden = true;
$('btn-traffic').addEventListener('click', () => { const v = !$('btn-traffic').classList.contains('on'); traffic?.set(v); $('btn-traffic').classList.toggle('on', v); wake(); });

// ---------- cinematic mode: letterbox, subtitles, scripted shots through the timeline ----------
// Every step is a shot with a pose(tau) -> camera position + look-at point: a slow orbit with a gentle dolly-in around the
// step's subject, or a dolly along the trail for route steps (trip plan, car to trailhead). Between shots the camera flies
// a cubic Hermite path from its current position and velocity to the next shot's first pose and velocity (no stop at the
// cut, an arc over the ridges on long hops), on a longer lens (fov 32), inside the letterbox with a soft vignette.
const CINE = { on: false, shot: null, vel: new THREE.Vector3(), tvel: new THREE.Vector3(), last: null, lastT: null, fov0: camera.fov };
const CINE_FOV = 32, _cp = new THREE.Vector3(), _ct = new THREE.Vector3(), _cq = new THREE.Vector3(), _cs = new THREE.Vector3();
const vignette = Object.assign(document.createElement('div'), { id: 'vignette' }); document.body.appendChild(vignette); // style3d.css, body.cinema only
function shotTarget(i) {
  const e = EVENTS.find((x) => x.step === i);
  const a = e && (isFound(e) ? e.point || foundAt : anchorOf(e)); // the find: where its pin stands
  if (a && inside(a)) return v3(a[0], a[1]);
  const top = rankedOf(R.steps[i].segments)[0], g = segs.get(top.id);
  return v3(g.center[0], g.center[1]);
}
// keep the camera above the ground along its whole path (cinema shots fly low)
const aboveGround = (v, clear = 0.35) => { v.y = Math.max(v.y, hAt(toLat(v.z), toLon(v.x)) + clear); return v; };
const smoothT = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
// the trail a route step is about (inside the map, at least ~0.6 km long), as a curve on the ground
function shotTrail(i) {
  const e = EVENTS.find((x) => x.step === i), s = R.steps[i];
  if (!e?.points || e.points.length < 2 || !(s.kind === 'route' || s.kind === 'containment' || e.provider === 'TripPlan' || e.provider === 'TrailheadCar')) return null;
  const pts = densify(e.points.filter(inside), 0.08).map(([la, lo]) => v3(la, lo, 0.02));
  if (pts.length < 3) return null;
  const c = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  return c.getLength() > 0.6 ? c : null;
}
// camera pose tau seconds into the shot's hold (both vectors written to out)
function shotPose(sh, tau, pos, tgt) {
  const k = smoothT(tau / sh.len);
  if (sh.trail) {
    const u = 0.04 + 0.88 * k, p = sh.trail.getPointAt(u), ahead = sh.trail.getPointAt(Math.min(1, u + 0.09));
    const dir = _cq.subVectors(ahead, p).setY(0); if (dir.lengthSq() < 1e-8) dir.set(1, 0, 0); dir.normalize();
    _cs.set(dir.z, 0, -dir.x); // the side of the trail the camera rides on, fixed per shot
    pos.copy(p).addScaledVector(_cs, sh.side * 0.55).addScaledVector(dir, -0.75); pos.y += 0.5 + 0.1 * Math.sin(tau * 0.5);
    tgt.lerpVectors(p, ahead, 0.7); tgt.y += 0.04;
  } else {
    const ang = sh.ang + tau * 0.055, d = sh.dist * (1 - 0.14 * k); // slow orbit with a dolly-in
    tgt.copy(sh.t); tgt.y += sh.lift + 0.03 * k; // close shots aim between the spot and its pin head
    pos.set(sh.t.x + Math.cos(ang) * d, sh.t.y + d * (0.42 - 0.06 * k) + 0.25, sh.t.z + Math.sin(ang) * d);
  }
  return aboveGround(pos, 0.45);
}
const hermite = (out, p0, v0, p1, v1, u, T) => {
  const u2 = u * u, u3 = u2 * u, a = 2 * u3 - 3 * u2 + 1, b = (u3 - 2 * u2 + u) * T, c = -2 * u3 + 3 * u2, d = (u3 - u2) * T;
  return out.set(p0.x * a + v0.x * b + p1.x * c + v1.x * d, p0.y * a + v0.y * b + p1.y * c + v1.y * d, p0.z * a + v0.z * b + p1.z * c + v1.z * d);
};
// how much of the sight line from the camera to the subject the terrain hides (0 = clear)
function blockedView(pos, tgt) {
  let n = 0;
  for (let k = 1; k < 16; k++) { const f = k / 16, x = pos.x + (tgt.x - pos.x) * f, y = pos.y + (tgt.y - pos.y) * f, z = pos.z + (tgt.z - pos.z) * f; if (hAt(toLat(z), toLon(x)) > y - 0.015) n++; }
  return n;
}
// Kino shots follow event GROUPS (Mateusz): events at the same moment (the start setup: terrain, weather, rings, IPP) or within
// 2 min of the group's first one are one shot with one card. The shell's rule (window.rescueApp.eventGroups) when embedded,
// the same rule here when 3D runs alone.
function cineGroups() {
  try { const g = parent !== window && parent.rescueApp?.eventGroups?.(); if (Array.isArray(g) && g.length && g.every((x) => x.steps?.length)) return g.map((x) => x.steps.filter((i) => i >= 0 && i < R.steps.length)).filter((x) => x.length); } catch (e) {}
  const out = [];
  R.steps.forEach((s, i) => { const m = Number.isFinite(s.minute) ? s.minute : null, g = out[out.length - 1];
    if (g && m != null && g.first != null && m - g.first <= 2) g.steps.push(i); else out.push({ first: m, steps: [i] }); });
  return out.map((g) => g.steps);
}
function cineCard(ks) {
  const ss = ks.map((k) => R.steps[k]), head = `<b>${esc(ss[ss.length - 1].t)}</b>`;
  if (ss.length === 1) return `${head} ${esc(ss[0].label)}`;
  const shown = ss.slice(0, 4).map((s) => `<span class="cc-i">${esc(s.label)}</span>`).join('');
  return `${head} <span class="cc-n">${ss.length} ${ss.length % 10 >= 2 && ss.length % 10 <= 4 && (ss.length % 100 < 12 || ss.length % 100 > 14) ? 'zdarzenia' : 'zdarzeń'}</span><span class="cc-l">${shown}${ss.length > 4 ? `<span class="cc-i">+${ss.length - 4} więcej</span>` : ''}</span>`;
}
function cineShot(gi) {
  const ks = CINE.groups[gi], i = ks[ks.length - 1];   // the group's last step: all of its events are in force
  setStep(i);
  const s = R.steps[i], t = shotTarget(i), trail = ks.map(shotTrail).find(Boolean) || null, close = ks.some((k) => R.steps[k].kind === 'point' || R.steps[k].kind === 'found');
  const dist = (s.kind === 'rings' || s.kind === 'route' ? 4.2 : close ? 1.4 : 2.4) * 1.2; // longer lens: further back
  const sh = { i, g: gi, t, trail, ang: i * 1.1 + 0.6, dist, lift: close ? 0.2 : 0, side: i % 2 ? 1 : -1, len: close ? 9 : trail ? 8 : 5.2, tau: 0 };
  // orbit start: the default angle, or the nearest of 8 around it from which the ridges do not hide the subject
  if (!trail) {
    const a0 = sh.ang, P = new THREE.Vector3(), T = new THREE.Vector3(); let best = Infinity, bestA = a0;
    for (const da of [0, 0.785, -0.785, 1.571, -1.571, 2.356, -2.356, 3.142]) {
      sh.ang = a0 + da; const b = blockedView(shotPose(sh, 0, P, T), T) + blockedView(shotPose(sh, sh.len, P, T), T);
      if (b < best) { best = b; bestA = sh.ang; } if (!b) break;
    }
    sh.ang = bestA;
  }
  // transition: Hermite from the current camera (position, velocity) to the hold's first pose and velocity
  const p1 = new THREE.Vector3(), t1 = new THREE.Vector3(), tb = new THREE.Vector3(); shotPose(sh, 0, p1, t1);
  const v1 = shotPose(sh, 0.1, new THREE.Vector3(), tb).sub(p1).multiplyScalar(10), tv1 = tb.sub(t1).multiplyScalar(10);
  const hop = camera.position.distanceTo(p1), dur = clamp(2.2 + hop * 0.18, 2.4, 4.5);
  const f = { u: 0, dur, p0: camera.position.clone(), v0: CINE.vel.clone().clampLength(0, hop / dur), p1, v1, t0: controls.target.clone(), tv0: CINE.tvel.clone().clampLength(0, 1), t1, tv1, arc: 0 };
  // arc: just enough lift (as a parabola in u) to clear the ridges the straight path would cut
  for (let u = 0.1; u < 0.95; u += 0.1) { hermite(_cp, f.p0, f.v0, f.p1, f.v1, u, dur); f.arc = Math.max(f.arc, (hAt(toLat(_cp.z), toLon(_cp.x)) + 0.4 - _cp.y) / (4 * u * (1 - u))); }
  f.arc = Math.min(f.arc, 2.5); sh.fly = f;
  CINE.shot = sh; fly = null;
  $('caption').innerHTML = cineCard(ks);
}
// Kino mixes in first-person shots: a unit seen at this minute (patrol, dog, helicopter...) for ~5 s, then the next shot
function cineFpp(next) {
  if (!TL3D?.startFpp) return false;
  // rescue units only: the missing person's track is an estimate, "through their eyes" would read as knowing where they are
  const kindOf = (id) => (R.timeline?.actors || []).find((a) => a.id === id)?.kind;
  // and only units inside the terrain model (inset 5%): the helicopter waits at its base outside it, its insert was fog and sky
  const b = R.bbox, mLat = (b.north - b.south) * 0.05, mLon = (b.east - b.west) * 0.05;
  const inside = (p) => !Array.isArray(p) || (p[0] > b.south + mLat && p[0] < b.north - mLat && p[1] > b.west + mLon && p[1] < b.east - mLon);
  const ids = (TL3D.frame?.actors || []).filter((a) => a.id && kindOf(a.id) !== 'osoba' && inside(a.pos)).map((a) => a.id);
  const clock = R.steps[STEP]?.t || '';   // the shot just shown; startFpp can move STEP to the unit's first sample, the clock must not go back
  for (let k = 0; k < ids.length; k++) {
    const id = ids[(next + k) % ids.length];
    CINE.inserting = true; const ok = TL3D.startFpp(id); CINE.inserting = false;   // our own insert: startFpp's onStopCamera must not end Kino
    if (ok) {
      const name = document.querySelector(`.tl3d-title ~ select option[value="${CSS.escape(id)}"], select[aria-label="Jednostka dla kamery FPP"] option[value="${CSS.escape(id)}"]`)?.textContent || id;
      CINE.fpp = { t: 5, next }; CINE.shot = null;
      $('caption').innerHTML = `<b>${esc(clock)}</b> Oczami jednostki: ${esc(name)}`;
      return true;
    }
  }
  return false;
}
function cinema(on) {
  if (on) TL3D?.stopFpp();
  CINE.on = on; document.body.classList.toggle('cinema', on); $('btn-cine').classList.toggle('on', on);
  toParent({ type: 'cinema', on }); // /app hides its floating panels while Kino runs
  if (on) { CINE.prevRot = autoRot; CINE.vel.set(0, 0, 0); CINE.tvel.set(0, 0, 0); CINE.last = null; CINE.groups = cineGroups(); cineShot(0); }   // Kino is the film of the whole story, from the first step (the shell's step sits at the end, the timeline sync moves STEP)
  else { if (CINE.fpp) { CINE.fpp = null; TL3D?.stopFpp(); } CINE.shot = null; overview(1.6); }
}
$('btn-cine').addEventListener('click', () => cinema(!CINE.on));
addEventListener('keydown', (e) => { if (e.key === 'Escape' && CINE.on) cinema(false); });
function cineTick(dt) {
  // lens: ease to the longer focal length in Kino and back afterwards
  const fovTo = CINE.on ? CINE_FOV : CINE.fov0;
  if (Math.abs(camera.fov - fovTo) > 0.02) { camera.fov += (fovTo - camera.fov) * (1 - Math.exp(-dt * 1.5)); camera.updateProjectionMatrix(); }
  // first-person insert (timeline units with a track at this minute): the timeline drives the camera meanwhile
  if (CINE.on && CINE.fpp) {
    CINE.fpp.t -= dt;
    if (CINE.fpp.t > 0 && TL3D?.following) return;
    const next = CINE.fpp.next; CINE.fpp = null; TL3D?.stopFpp(); CINE.vel.set(0, 0, 0); CINE.tvel.set(0, 0, 0); CINE.last = null;
    if (next < CINE.groups.length) cineShot(next); return;
  }
  const sh = CINE.shot; if (!CINE.on || !sh || fly) return;
  if (sh.fly) {
    const f = sh.fly; f.u = Math.min(1, f.u + dt / f.dur);
    hermite(_cp, f.p0, f.v0, f.p1, f.v1, f.u, f.dur); _cp.y += f.arc * 4 * f.u * (1 - f.u); // arc over the ridges on long hops
    hermite(_ct, f.t0, f.tv0, f.t1, f.tv1, f.u, f.dur);
    if (f.u >= 1) sh.fly = null;
  } else {
    sh.tau += dt; shotPose(sh, sh.tau, _cp, _ct);
  }
  aboveGround(_cp, 0.3);
  camera.position.copy(_cp); controls.target.copy(_ct); camera.lookAt(_ct);
  if (CINE.last && dt > 0) { CINE.vel.lerp(_cq.subVectors(_cp, CINE.last).divideScalar(dt), 0.3); CINE.tvel.lerp(_cq.subVectors(_ct, CINE.lastT).divideScalar(dt), 0.3); }
  CINE.last = (CINE.last || new THREE.Vector3()).copy(_cp); CINE.lastT = (CINE.lastT || new THREE.Vector3()).copy(_ct);
  if (!sh.fly && sh.tau > sh.len) {
    const more = sh.g < CINE.groups.length - 1;
    if (more && sh.g % 2 === 1 && cineFpp(sh.g + 1)) return;
    if (more) cineShot(sh.g + 1);
    else { CINE.shot = null; $('caption').innerHTML = ''; overview(4); setTimeout(() => CINE.on && cinema(false), 4500); }
  }
}

// ---------- pointer: tooltip, hide click, double-click fly ----------
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
let hoverPending = false, lastEv = null, downAt = null;
const diffLabel = new Map((R.difficultyClasses || []).map((d) => [d.id, d.label]));
// terrain under the pointer: the ray is marched over the DEM height field (bilinear, 8 m steps, then bisection),
// not tested against the ~200k mesh triangles, so hover costs microseconds instead of a frame
const H_TOP = ((zMax - zMin) * EX) / 1000;
function pickRay(r) {
  const o = r.origin, d = r.direction;
  let t0 = 0, t1 = 400;
  for (const [oo, dd, lo, hi] of [[o.x, d.x, -WKM / 2, WKM / 2], [o.y, d.y, -1, H_TOP + 0.01], [o.z, d.z, -HKM / 2, HKM / 2]]) {
    if (Math.abs(dd) < 1e-9) { if (oo < lo || oo > hi) return null; continue; }
    let a = (lo - oo) / dd, b = (hi - oo) / dd; if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return null;
  }
  const above = (t) => o.y + d.y * t - hAt(toLat(o.z + d.z * t), toLon(o.x + d.x * t));
  if (above(t0) < 0) return { point: r.at(t0, new THREE.Vector3()) };
  for (let t = t0, step = 0.008; t < t1; t += step) {
    if (above(t + step) < 0) {
      let a = t, b = t + step; for (let k = 0; k < 12; k++) { const m = (a + b) / 2; if (above(m) < 0) b = m; else a = m; }
      return { point: r.at(b, new THREE.Vector3()) };
    }
  }
  return null;
}
const pick = (e) => { mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(mouse, camera); return pickRay(ray.ray); };
const cv = renderer.domElement;
cv.addEventListener('pointermove', (e) => { lastEv = e; if (!hoverPending) { hoverPending = true; requestAnimationFrame(hover); } });
cv.addEventListener('pointerleave', () => { $('tip').hidden = true; });
host.addEventListener('pointerdown', (e) => { downAt = e.target.closest('[data-actor-id]') ? null : [e.clientX, e.clientY]; });
host.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  if (e.target.closest?.('.lbl3d')) return; // a unit label handles its own click (timeline3d); here it would be a click-to-move to the ground behind it
  const h = pick(e);
  if (WALK?.click(h)) return;   // Spacer armed: this click picks the start; walking: clicks only look around
  if (G.phase === 'off' && TL3D?.pickActor(ray, h ? ray.ray.origin.distanceTo(h.point) : Infinity)) return;
  if (!h) return;
  if (G.phase === 'off' && TL3D?.selected && !TL3D.following && TL_LIVE && !P.reveal) return moveUnit3d(TL3D.selected, toLat(h.point.z), toLon(h.point.x)); // click-to-move
  if (G.phase === 'hide') return hideAt(toLat(h.point.z), toLon(h.point.x));
  const k = cellOf(toLat(h.point.z), toLon(h.point.x)); if (k < 0) return;
  if (G.phase === 'off') selectSeg(R.segOf[k], { fly: false });
  else if (G.phase === 'search') sendPatrol(R.segOf[k]); // the patrol goes to the clicked segment
});
host.addEventListener('dblclick', (e) => { if (WALK?.on || e.target.closest('[data-actor-id]')) return; const h = pick(e); if (h && G.phase !== 'hide') flyTo(h.point, 2); });
TL3D = createTimeline3D({ THREE, run: R, scene, camera, controls, v3, eyeAt, line: makeLine, drape: drapeRuns,
  dispose: disposeGroup, label, esc, nf, wake,
  onFrame: (f, minute) => {
    if (G.phase !== 'off') return;
    TL_COV = f?.cov || [];
    POD3D?.set(f?.cov, minute);
    if (!f) {
      let i = 0; R.steps.forEach((s, k) => { if (s.minute <= minute) i = k; });
      setStep(i, false, true);
      if (useShellTop() && Math.abs(minute - TL_TOPM) <= 0.5) drawTop(topOfShell());
      return;
    }
    if (f.step >= 0 && STEP !== f.step) setStep(f.step, false, true);
    if (R.timeline.searchEvents !== 'keep') WASH.clear();
    if (f.poaGrid?.length === R.rows * R.cols) showHeat(heatCanvasGrid(f.poaGrid), true);
    // top 3 = the shell panel's source: Historia ranks the minute's frame, Na żywo ranks the live step (shell tlSegments)
    if (TL_TOP && Math.abs(minute - TL_TOPM) > 0.5) TL_TOP = null;   // 3D moved the clock itself (Kino): own ranking
    if (useShellTop()) drawTop(topOfShell());
    else if (f.segments?.length && !TL_LIVE && ![...OFF].some((k) => k <= STEP)) drawTop(rankedOf(f.segments));
    else if (TL_LIVE || [...OFF].some((k) => k <= STEP)) { const OG = gridFor(STEP); drawTop(OG ? rankedOf(segPoa(OG)) : rankedOf(R.steps[STEP].segments)); }
    compose();
  },
  onStopCamera: () => { if (CINE.on && !CINE.inserting) cinema(false); fly = null; autoRot = false; controls.autoRotate = false; },
  // FPP: the outlines float metres above the ground and the signal pins stand like beams in an eye-level view, so they step aside
  onCamera: (on, actorId) => { fppHeat = on ? 0.3 : 1; for (const g of [dyn.top, dyn.searched, dyn.teams, dyn.sel, dyn.signals, dyn.live]) g.visible = !on; compose(); toParent({ type: 'fpp', on, actorId }); },
  onActor: (id) => toParent({ type: 'actor', id }),
  onWindow: FPPWIN ? null : (id) => openFppWindow(id), lockFpp: FPPWIN, isLive: () => TL_LIVE && !P.reveal, onMove: postMove,
  getFrame: async (t) => {
    const history = new URL(P.run, location.href).searchParams.get('live') === '0' ? '&live=0' : '';
    const f = await getJSON(`/api/run/${SC}?t=${encodeURIComponent(t)}${history}`, true);
    return f?.schema === 'rescue-frame/1' && Number.isFinite(f.minute) ? f : null;
  },
});
WALK = createWalk3D({ THREE, camera, controls, eyeAt, toLat, toLon, host, wake,
  bounds: { x0: -WKM / 2 + 0.05, x1: WKM / 2 - 0.05, z0: -HKM / 2 + 0.05, z1: HKM / 2 - 0.05 },
  onStart: () => { if (CINE.on) cinema(false); TL3D?.stopFpp(); fly = null; autoRot = false; $('btn-rot')?.classList.remove('on'); },
});
$('btn-walk')?.addEventListener('click', () => WALK.arm());
createLivePos3D({ THREE, pin, label, v3, drape: drapeRuns, dispose: disposeGroup, wake, inside, esc, parent: dyn.live, sc: SC, isLive: () => TL_LIVE && !P.reveal,
  units: () => R.steps[R.steps.length - 1]?.resources || [], skip: (id) => (R.timeline?.actors || []).some((a) => a.id === id) });
function hover() {
  hoverPending = false; const e = lastEv, tip = $('tip'); if (!e) return;
  const hit = pick(e); if (!hit) { tip.hidden = true; return; }
  const lat = toLat(hit.point.z), lon = toLon(hit.point.x), k = cellOf(lat, lon);
  let html = G.phase === 'hide' ? '<div><b>Kliknij, aby tu ukryć zaginionego</b></div>' : '';
  html += `<div><b>${Math.round(elevM(lat, lon))} m n.p.m.</b></div>`;
  if (k >= 0) {
    const g = segs.get(R.segOf[k]), grid = G.phase === 'search' || G.phase === 'done' ? G.grid : TL3D?.frame?.poaGrid || R.steps[STEP].poaGrid;
    if (G.phase !== 'hide') html += `<div>${esc(g?.name || R.segOf[k])} · waga komórki × średnia: <b>${nf(grid[k] * R.rows * R.cols, 2)}×</b></div>`;
    else html += `<div>${esc(g?.name || R.segOf[k])}</div>`;
    if (TL3D?.frame) html += `<div>pokrycie (POD): ${pct(TL_COV.find(([cell]) => cell === k)?.[1] || 0)}</div>`;
    const sl = TER?.slopeDeg?.[k], d = R.difficulty?.[k];
    html += `<div>${sl != null ? `nachylenie ${Math.round(sl)}°` : ''}${d != null && diffLabel.has(d) ? ` · ${esc(diffLabel.get(d))}` : ''}</div>`;
  }
  tip.innerHTML = html; tip.hidden = false;
  tip.style.left = Math.min(e.clientX + 14, innerWidth - 260) + 'px'; tip.style.top = e.clientY + 14 + 'px';
}

// ---------- blind test game ----------
// You hide the missing person; the map keeps the engine's POA from the chosen step and does not know the spot.
// A SHA-256 commitment of the spot + salt is shown up front. Each patrol to a segment finds the person with
// probability POD if they are there; the draw is HMAC(salt, segment|attempt), so the result is fixed in advance
// and the same draws drive the naive baseline (segments in order of distance from IPP).
const G = { phase: 'off' };
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
async function draw(seg, n) {
  if (!G.key) G.key = await crypto.subtle.importKey('raw', new TextEncoder().encode(G.salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', G.key, new TextEncoder().encode(`${seg}|${n}`)));
  return (sig[0] * 2 ** 24 + sig[1] * 2 ** 16 + sig[2] * 2 ** 8 + sig[3]) / 2 ** 32;
}
const PATROL_MIN = 30;
function segPoa(grid) {
  return [...segs.values()].map((g) => ({ id: g.id, name: g.name, areaPct: g.areaPct, poa: g.cells.reduce((a, i) => a + grid[i], 0) }));
}
function gamePanel(html) { const p = $('game'); p.hidden = false; p.innerHTML = html; }
function lockTimeline(on) { document.body.classList.toggle('searching', on && G.phase === 'search'); }
function startGame() {
  if (G.phase !== 'off') return endGame();
  TL3D?.setVisible(false);
  POD3D?.setVisible(false);
  const base = Q.has('blindStep') ? +Q.get('blindStep') : R.value?.beforePing ?? STEP;
  if (STEP !== base) setStep(base);
  Object.assign(G, { phase: 'hide', base, target: null, salt: null, key: null, commit: null, patrols: [], attempts: new Map(), searched: new Set(), found: false });
  disposeGroup(dyn.teams); movers.length = 0; if (foundPin) foundPin.visible = false; if (revealPin) revealPin.visible = false;
  lockTimeline(true); document.body.classList.add('hiding'); $('btn-game').textContent = 'Zakończ test';
  gamePanel(`<h3>Test na ślepo: ukryj zaginionego</h3>
    <p>Kliknij w teren, żeby schować osobę. Mapa zostaje taka, jak policzył ją silnik o <b>${esc(R.steps[base].t)}</b> (${esc(R.steps[base].label)}) i nie wie, gdzie kliknąłeś. Spróbuj ją przechytrzyć.</p>
    <div class="row"><button class="btn" id="g-rand">Losuj miejsce</button><button class="btn" id="g-cancel">Anuluj</button></div>`);
  $('g-rand').onclick = () => { let p; do p = [B.south + Math.random() * (B.north - B.south), B.west + Math.random() * (B.east - B.west)]; while (!inside(p)); hideAt(p[0], p[1], true); };
  $('g-cancel').onclick = endGame;
}
async function hideAt(lat, lon, random = false) {
  const k = cellOf(lat, lon); if (k < 0) return;
  G.target = [lat, lon]; G.cell = k; G.seg = R.segOf[k];
  G.salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  G.commit = await sha256(`${lat.toFixed(5)},${lon.toFixed(5)}|${G.salt}`);
  G.grid = Float64Array.from(R.steps[G.base].poaGrid);
  G.start = rankedOf(segPoa(G.grid));
  G.phase = 'search'; G.random = random;
  document.body.classList.remove('hiding'); lockTimeline(true);
  refreshGame();
}
function refreshGame(msg = '') {
  G.ranked = rankedOf(segPoa(G.grid));
  showHeat(heatCanvasGrid(G.grid));
  drawTop(G.ranked);
  disposeGroup(dyn.searched);
  for (const id of G.searched) { const g = segs.get(id); if (g) drapeRuns(ringLL(g.polygon), 0.018, { color: '#555b61', width: 1.8, opacity: 0.9, dashed: true, dash: 0.035, gap: 0.03 }, dyn.searched); }
  const area = [...G.searched].reduce((a, id) => a + (segs.get(id)?.areaPct || 0), 0);
  const clock = addMin(R.steps[G.base].t, G.patrols.length * PATROL_MIN);
  const stats = `<div class="stats"><div class="stat"><b>${G.patrols.length}</b><span>patroli</span></div><div class="stat"><b>${area.toFixed(1)}%</b><span>obszaru przeszukane</span></div><div class="stat"><b>${clock}</b><span>czas akcji</span></div></div>`;
  const log = G.patrols.length ? `<ol>${G.patrols.map((p) => `<li>${esc(p.name)}: ${p.found ? '<b>ZNALEZIONO</b>' : 'nic'} (POD ${Math.round(p.pod * 100)}%)</li>`).join('')}</ol>` : '';
  if (G.phase === 'search') {
    gamePanel(`<h3>Szukaj</h3>
      <p>Zobowiązanie (SHA-256 miejsca i soli): <code>${G.commit.slice(0, 24)}…</code></p>
      <p>Wyślij patrol do lidera albo kliknij segment na mapie (POD ${Math.round((R.steps[G.base].weather?.dark ? 0.6 : 0.75) * 100)}%). Puste przeszukanie obniża prawdopodobieństwo segmentu (POA × (1 − POD)) i mapa się przelicza.</p>
      ${stats}${msg ? `<p>${msg}</p>` : ''}${log}
      <div class="row"><button class="btn red" id="g-lead">Patrol do lidera</button><button class="btn" id="g-auto">${G.auto ? 'Stop' : 'Szukaj automatycznie'}</button><button class="btn" id="g-reveal">Odsłoń</button></div>`);
    $('g-lead').onclick = () => sendPatrol(G.ranked[0].id);
    $('g-auto').onclick = () => { G.auto = !G.auto; refreshGame(); if (G.auto) autoNext(); };
    $('g-reveal').onclick = () => finish(false);
  }
}
const addMin = (t, m) => { const [h, mm] = t.split(':').map(Number), x = h * 60 + mm + m; return `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
let busy = false;
async function sendPatrol(segId) {
  if (G.phase !== 'search' || busy) return;
  busy = true;
  const g = segs.get(segId), n = (G.attempts.get(segId) || 0) + 1; G.attempts.set(segId, n);
  const pod = R.steps[G.base].weather?.dark ? 0.6 : 0.75;
  const u = await draw(segId, n), found = segId === G.seg && u < pod;
  // animate the patrol from the IPP to the segment, then resolve
  const p0 = v3(R.ipp.lat, R.ipp.lon, 0.03), p2 = v3(g.center[0], g.center[1], 0.05);
  const p1 = p0.clone().lerp(p2, 0.5); p1.y = Math.max(p0.y, p2.y) + 0.25 + p0.distanceTo(p2) * 0.12;
  const curve = new THREE.QuadraticBezierCurve3(p0, p1, p2);
  const line = makeLine(curve.getPoints(48), { color: '#b8322a', width: 1.8, opacity: 0.85, dashed: true, dash: 0.05, gap: 0.04 });
  const dot = new THREE.Mesh(ballGeo, new THREE.MeshStandardMaterial({ color: '#b8322a' })); dot.scale.setScalar(0.016);
  dot.userData.glow = ['#ff7a68', 110]; dyn.game.add(line, dot);
  await new Promise((res) => movers.push({ curve, dot, mat: line.material, t: 0, once: true, done: res }));
  dyn.game.remove(line, dot); lineMats.delete(line.material); line.geometry.dispose(); line.material.dispose();
  G.patrols.push({ id: segId, name: g.name, found, pod });
  G.searched.add(segId);
  dyn.game.add(label(found ? 'ZNALEZIONO' : 'nic', 'patrol' + (found ? ' ok' : ''), v3(g.center[0], g.center[1], 0.08)));
  busy = false;
  if (found) { G.found = true; return finish(true); }
  // Bayes update after an empty search
  let tot = 0; for (const i of g.cells) G.grid[i] *= 1 - pod;
  for (const v of G.grid) tot += v; for (let i = 0; i < G.grid.length; i++) G.grid[i] /= tot;
  refreshGame(`Patrol w ${esc(g.name)}: nic.`);
  if (G.patrols.length >= 40) return finish(false);
  if (G.auto) setTimeout(autoNext, 500);
}
function autoNext() { if (G.auto && G.phase === 'search') sendPatrol(G.ranked[0].id); }
async function naiveCount() {
  // same draws, but patrols go through segments in order of distance from the IPP, round after round
  const order = [...segs.values()].map((g) => ({ id: g.id, d: Math.hypot((g.center[0] - R.ipp.lat) * KM, (g.center[1] - R.ipp.lon) * KM * KX) })).sort((a, b) => a.d - b.d);
  const pod = R.steps[G.base].weather?.dark ? 0.6 : 0.75, att = new Map();
  for (let n = 1; n <= 200; n++) {
    const s = order[(n - 1) % order.length].id, k = (att.get(s) || 0) + 1; att.set(s, k);
    if (s === G.seg && (await draw(s, k)) < pod) return n;
  }
  return null;
}
async function finish(found) {
  G.phase = 'done'; G.auto = false;
  const rank0 = G.start.findIndex((s) => s.id === G.seg) + 1, naive = await naiveCount();
  const tpin = pin(G.target[0], G.target[1], found ? '#2d6a4f' : '#b8322a', 0.45, found ? 'Tu był · znaleziony' : 'Tu był ukryty', found ? 'found' : 'target', 0.026);
  dyn.game.add(tpin);
  const verify = await sha256(`${G.target[0].toFixed(5)},${G.target[1].toFixed(5)}|${G.salt}`);
  const area = [...G.searched].reduce((a, id) => a + (segs.get(id)?.areaPct || 0), 0);
  refreshGame();
  gamePanel(`<h3>${found ? 'Znaleziony' : 'Odsłonięte'}</h3>
    <div class="res ${found ? 'ok' : 'fail'}">${found
      ? `Silnik znalazł osobę w <b>${G.patrols.length}</b> patrolach (${area.toFixed(1)}% obszaru).`
      : `Nie znaleziono w ${G.patrols.length} patrolach.`}
      Naiwnie (od IPP, segment po segmencie): <b>${naive ?? '>200'}</b> patroli.<br>
      Segment kryjówki (${esc(segs.get(G.seg).name)}) był <b>#${rank0}</b> z ${G.start.length} w rankingu przed pierwszym patrolem.</div>
    <p>Miejsce: <code>${G.target[0].toFixed(5)}, ${G.target[1].toFixed(5)}</code> · sól: <code>${G.salt}</code><br>
      SHA-256 zgodny ze zobowiązaniem: <b>${verify === G.commit ? 'tak' : 'NIE'}</b></p>
    <div class="row"><button class="btn red" id="g-again">Zagraj jeszcze raz</button><button class="btn" id="g-end">Zakończ</button></div>`);
  $('g-again').onclick = () => { endGame(); startGame(); };
  $('g-end').onclick = endGame;
  flyTo(v3(G.target[0], G.target[1]), 3);
}
function endGame() {
  TL3D?.setVisible(true);
  POD3D?.setVisible(true);
  G.phase = 'off'; G.auto = false; disposeGroup(dyn.game);
  $('game').hidden = true; $('btn-game').textContent = 'Test na ślepo';
  document.body.classList.remove('hiding', 'searching'); lockTimeline(false);
  const s = STEP; STEP = -1; setStep(s, false);
}
$('btn-game').addEventListener('click', startGame);

// ---------- live field reports ----------
// rescue-server's live feed (CONTRACT.md "Live mode": GET /api/live?sc=&since=): clues as pins, reports and dispatches as
// toasts. Without the route (static hosting) it stops after the first miss instead of polling a 404 every few seconds.
const seenLive = new Set();
let liveSeq = 0, liveMiss = 0;
const hhmm = (t) => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }); };
async function pollLive() {
  // History and blind replays keep their recorded evidence; do not mix in current field reports.
  if (P.reveal || new URL(P.run, location.href).searchParams.get('live') === '0') return;
  const f = await getJSON(`/api/live?sc=${encodeURIComponent(SC)}&since=${liveSeq}`, true);
  if (!f || !Array.isArray(f.events)) { if (++liveMiss >= 2) return; setTimeout(pollLive, 8000); return; }
  liveMiss = 0; liveSeq = Math.max(liveSeq, f.seq || 0);
  for (const e of f.events) {
    const key = e.seq ?? e.t + '|' + e.title; if (seenLive.has(key)) continue; seenLive.add(key);
    if (e.kind === 'clue' && e.lat != null && e.lon != null) dyn.live.add(pin(e.lat, e.lon, '#b8860b', 0.26, 'Ślad: ' + esc(e.title || e.note || ''), 'sig cur', 0.018));
    if (e.kind === 'clue' || e.kind === 'report' || e.kind === 'dispatch') toast({ at: hhmm(e.t), text: e.title || e.note || '' });
  }
  setTimeout(pollLive, 4000);
}
function hint(text) { // a short note in the feed corner (8 s)
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = text; $('feed').prepend(el); setTimeout(() => el.remove(), 8000);
}
function toast(e) {
  const el = document.createElement('div'); el.className = 'toast';
  el.innerHTML = `<span class="t">${esc(e.at || '')} meldunek</span>${esc(e.text)}`;
  const feed = $('feed'); feed.prepend(el);
  while (feed.children.length > 4) feed.lastChild.remove();
  setTimeout(() => el.remove(), 30000);
}

// ---------- selection + embed API (postMessage, same origin only) ----------
// in:  {type:'run', run} | {type:'run', url} | {type:'step', i} | {type:'select', segmentId}
// out: {type:'ready', scenario, steps} | {type:'step', i, t} | {type:'select', segmentId}
let SEL = null, fromParent = false;
const toParent = (msg) => { if (window.parent !== window) window.parent.postMessage({ source: 'rescue3d', ...msg }, location.origin); };
function selectSeg(id, { fly: doFly = true, notify = true } = {}) {
  const g = segs.get(id); if (!g) return;
  SEL = id; disposeGroup(dyn.sel);
  const selCol = getComputedStyle(document.documentElement).getPropertyValue('--rl-select').trim() || '#1f4e79';
  drapeRuns(ringLL(g.polygon), 0.026, { color: selCol, width: 4, opacity: 0.95 }, dyn.sel);
  if (doFly) flyTo(v3(g.center[0], g.center[1]), 2.4);
  if (notify && !fromParent) toParent({ type: 'select', segmentId: id });
}
dyn.sel = new THREE.Group(); scene.add(dyn.sel);
addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.source !== window.parent || !e.data || typeof e.data !== 'object') return;
  applyMsg(e.data);
  if (FPP_BC && RELAY.has(e.data.type)) FPP_BC.postMessage({ ...e.data, sc: SC }); // the FPP window follows the shell
});
// ---------- FPP window (?embed=fpp): a unit's eye view in its own window, kept in step with this view ----------
// The "Okno" button opens /app/3d/?embed=fpp&unit=<id> with this page's run, scenario and step in a named window (a second
// click reuses it and switches the unit). This view relays the shell's step / time / evidence / unit messages over
// BroadcastChannel('rl-3d'); the window applies them like its own parent's and asks for the current state when it
// loads; a scenario or run switch makes it reload on the new one. A closed window costs nothing; a blocked popup falls
// back to FPP in the map with a short note. The window renders at most 24 fps at DPR <= 0.75, without the water mirror
// (measured on starship-v2, 1440x900 main view orbiting with GPU sync: render 5.1 ms alone; see README).
const RELAY = new Set(['step', 'time', 'evidence', 'actor']);
const FPP_BC = 'BroadcastChannel' in window ? new BroadcastChannel('rl-3d') : null;
let fppWin = null;
function openFppWindow(id) {
  if (fppWin && !fppWin.closed) { FPP_BC?.postMessage({ type: 'unit', id, sc: SC }); fppWin.focus(); return; }
  const u = new URL(location.href); u.searchParams.set('embed', 'fpp'); u.searchParams.set('unit', id); u.searchParams.set('step', String(STEP));
  for (const k of ['stats', 'gpu', 'zoom']) u.searchParams.delete(k);
  if (!u.searchParams.has('fx')) u.searchParams.set('fx', '-refl'); // the window skips the water mirror pass
  fppWin = window.open(u.href, 'rl-fpp', 'popup,width=960,height=600');
  if (!fppWin) { TL3D?.startFpp(id); hint('Przeglądarka zablokowała okno - widok z oczu jednostki jest w mapie. Zezwól na wyskakujące okna dla tej strony.'); }
}
function fppState() { // what a freshly opened window needs to catch up
  FPP_BC.postMessage({ type: 'step', i: STEP, sc: SC });
  if (TL3D?.minute != null) FPP_BC.postMessage({ type: 'time', minute: TL3D.minute, sc: SC });
  for (const k of OFF) FPP_BC.postMessage({ type: 'evidence', id: k, on: false, sc: SC });
}
if (FPP_BC && !FPPWIN) FPP_BC.onmessage = (e) => { if (e.data?.type === 'hello' && e.data.sc === SC) fppState(); };
if (FPP_BC && FPPWIN) FPP_BC.onmessage = (e) => {
  const m = e.data; if (!m || typeof m !== 'object') return;
  if (m.type === 'scene' && (m.sc !== SC || (m.run || '') !== (Q.get('run') || ''))) { // the main view switched scenario or run
    const u = new URL(location.href); u.searchParams.set('sc', m.sc); if (m.run) u.searchParams.set('run', m.run); else u.searchParams.delete('run'); u.searchParams.delete('runInline'); location.replace(u); return;
  }
  if (m.sc && m.sc !== SC) return;
  if (m.type === 'unit' && typeof m.id === 'string') TL3D?.startFpp(m.id);
  else if (RELAY.has(m.type)) { if (m.type === 'actor') return; applyMsg(m); if (TL3D?.want && !TL3D.following) TL3D.startFpp(TL3D.want); }
};
// WASD in FPP (timeline3d): the moved unit's position goes to the server, so 2D, the timeline and Zasoby see it.
// POST /api/positions/<sc> (manual positions) when the server has it, else the live GPS fix route POST /api/fix;
// same auth as every write (X-Rescue-Pin). Throttled by timeline3d (~1/s or every 10 m); a refused post shows a note (moveRefused).
let POS_API = true;
async function postMove(unit, lat, lon, headingDeg, t) {
  const H = { 'Content-Type': 'application/json', ...runPin('/api/fix') }, la = +lat.toFixed(6), lo = +lon.toFixed(6);
  try {
    if (POS_API) {
      const r = await fetch(`/api/positions/${encodeURIComponent(SC)}`, { method: 'POST', headers: H, body: JSON.stringify({ unit, lat: la, lon: lo, ts: new Date().toISOString(), t, headingDeg: Math.round(headingDeg), source: 'manual', by: '3d-fpp' }) });
      if (r.ok) return; if (r.status === 404 || r.status === 405) POS_API = false; else return moveRefused(r.status);
    }
    const r = await fetch('/api/fix', { method: 'POST', headers: H, body: JSON.stringify({ sc: SC, actor: unit, t, lat: la, lon: lo, accM: 5, src: 'est' }) }); // an older server: a live fix (gps / report / est)
    if (!r.ok) moveRefused(r.status);
  } catch (e) { console.warn('3d: position post failed', e); }
}
// A refused move shows immediately, then at most every 20 s. Keep it outside the feed, which is hidden on phones/in cinema.
let moveRefusedAt = -Infinity;
function moveRefused(status) {
  if (performance.now() - moveRefusedAt < 20000) return; moveRefusedAt = performance.now();
  const key = (() => { try { return !!localStorage.getItem('rescue-pin'); } catch (e) { return false; } })();
  const el = document.createElement('div'); el.className = 'toast move-refused'; el.setAttribute('role', 'alert');
  el.textContent = status === 401 ? (key ? 'Ruch nie zapisany: klucz akcji na tym urządzeniu jest nieprawidłowy (pole Klucz u góry).' : 'Ruch nie zapisany: wpisz klucz akcji w polu Klucz u góry albo otwórz link „Udostępnij”.')
    : status === 403 ? 'Ruch nie zapisany: ten klucz nie pozwala przesuwać zespołów.' : `Ruch nie zapisany: serwer odrzucił (${status}).`;
  document.body.append(el); setTimeout(() => el.remove(), 8000);
}
// Click-to-move (top-down / orbit view, live only): with a unit selected, a click on the terrain sends it there - a dashed
// line and a target ring show the move, the unit glides there in 1.2 s (the same manual override as WASD) and the
// position goes to the server through postMove (/api/positions source manual) at once; a new click replaces the line.
let MOVE3D = null;
function moveUnit3d(id, lat, lon) {
  const from = TL3D.positionOf(id); if (!from) return;
  if (MOVE3D) { cancelAnimationFrame(MOVE3D.raf); clearTimeout(MOVE3D.tm); scene.remove(MOVE3D.g); disposeGroup(MOVE3D.g); }
  const g = new THREE.Group(), N = 24, pts = [];
  for (let i = 0; i <= N; i++) { const k = i / N; pts.push(v3(from.lat + (lat - from.lat) * k, from.lon + (lon - from.lon) * k, 0.03)); }
  const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0xe8590c, dashSize: 0.04, gapSize: 0.025, depthTest: false }));
  ln.computeLineDistances(); ln.renderOrder = 10; g.add(ln);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.022, 0.034, 32), new THREE.MeshBasicMaterial({ color: 0xe8590c, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.9 }));
  ring.rotation.x = -Math.PI / 2; ring.position.copy(v3(lat, lon, 0.02)); ring.renderOrder = 10; g.add(ring);
  scene.add(g);
  const hd = (Math.atan2((lon - from.lon) * Math.cos((lat * Math.PI) / 180), lat - from.lat) * 180 / Math.PI + 360) % 360;
  postMove(id, lat, lon, hd);
  const t0 = performance.now(), D = 1200, M = { g };
  const step = (now) => {
    const k = Math.min(1, (now - t0) / D), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    TL3D.placeActor(id, from.lat + (lat - from.lat) * e, from.lon + (lon - from.lon) * e, hd * Math.PI / 180); wake();
    if (k < 1) M.raf = requestAnimationFrame(step);
    else M.tm = setTimeout(() => { scene.remove(g); disposeGroup(g); if (MOVE3D === M) MOVE3D = null; wake(); }, 4000);
  };
  M.raf = requestAnimationFrame(step); MOVE3D = M;
}
function applyMsg(m) {
  fromParent = true;
  try {
    if (m.type === 'step' && Number.isInteger(m.i)) setStep(m.i);
    else if (m.type === 'time' && Number.isFinite(m.minute)) { if (typeof m.live === 'boolean') TL_LIVE = m.live; if (Array.isArray(m.top) && m.top.length) { TL_TOP = m.top.map(String); TL_TOPM = m.minute; }
      TL3D?.setTime(m.minute, m.t, true, m.frame, m.frameMinute);
      if (useShellTop() && G.phase === 'off' && TL_TOP.join() !== topDrawn) { drawTop(topOfShell()); wake(); } }
    else if (m.type === 'fpp') { if (m.on === false) TL3D?.stopFpp(); else TL3D?.startFpp(m.actorId); }
    else if (m.type === 'actor' && (m.id === null || typeof m.id === 'string')) TL3D?.selectActor(m.id, false);
    else if (m.type === 'highlight' && typeof m.actor === 'string') {
      TL3D?.selectActor(m.actor, false);
      const f = m.fly ? TL3D?.actorFocus?.(m.actor) : null;
      if (f && inside([f.lat, f.lon])) { const r = 0.45 / KM, pts = [...Array(8)].map((_, i) => v3(clamp(f.lat + r * Math.cos(i * 0.785), latS, latN), clamp(f.lon + (r / KX) * Math.sin(i * 0.785), lonW, lonE))); frameScene({ pts, vis: [[v3(f.lat, f.lon, 0.03)]], keepAz: true, dur: 1.6 }); }
    }
    else if (m.type === 'focusArea' && m.bbox) focusArea(m.bbox, m);
    else if (m.type === 'visible') { const was = shellHidden; shellHidden = m.on === false; if (!shellHidden) { if (was && !camUser && !CINE.on && !WALK?.on && !TL3D?.following) frameScene(); wake(); } } // 2D -> 3D: re-frame unless the operator moved
    else if (m.type === 'select' && typeof m.segmentId === 'string') selectSeg(m.segmentId);
    else if (m.type === 'insets' && Array.isArray(m.insets) && m.insets.length === 4) { const k0 = INSETS.join(); INSETS = m.insets.map((v) => +v || 0); applyInsets();
      if (INSETS.join() !== k0 && !camUser && !CINE.on && !WALK?.on && !TL3D?.following) frameScene({ dur: 1.2 }); }
    else if (m.type === 'evidence' && (typeof m.id === 'string' || Number.isInteger(m.id))) setEvidence(m.id, m.on !== false);
    else if (m.type === 'run' && m.run && typeof m.run === 'object') {
      sessionStorage.setItem('rescue3d-run', JSON.stringify(m.run));
      const u = new URL(location.href); u.searchParams.set('runInline', '1'); u.searchParams.delete('run'); location.replace(u);
    } else if (m.type === 'run' && typeof m.url === 'string') {
      const u = new URL(location.href); u.searchParams.set('run', m.url); u.searchParams.delete('runInline'); location.replace(u);
    }
  } finally { fromParent = false; }
}

// ---------- loop ----------
const clock = new THREE.Clock();
// near shadow cascade: when zoomed in, the sun's shadow map is fitted to a box around the orbit target and re-rendered
// once the view settles (target moved or zoom changed); trees cast shadows only then. Zoomed out it covers the whole cut.
const SH_FULL = Math.max(WKM, HKM) * 0.75;
let shFit = { x: 0, z: 0, S: SH_FULL }, shCheckAt = 0;
function fitShadow(now) {
  if (now - shCheckAt < 400 || fly) return;
  shCheckAt = now;
  const t = controls.target, dist = camera.position.distanceTo(t), S = dist > 7 ? SH_FULL : clamp(dist * 1.1, 1.2, 6);
  if (Math.hypot(t.x - shFit.x, t.z - shFit.z) < S * 0.2 && Math.abs(S - shFit.S) < shFit.S * 0.25) return;
  const cx = S === SH_FULL ? 0 : t.x, cz = S === SH_FULL ? 0 : t.z, cam = sun.shadow.camera;
  cam.left = -S; cam.right = S; cam.top = S; cam.bottom = -S; cam.updateProjectionMatrix();
  sun.position.set(cx, 0, cz).addScaledVector(SUN_DIR, 30); sun.target.position.set(cx, 0, cz); sun.target.updateMatrixWorld();
  sun.shadow.normalBias = 0.02 * Math.max(S / SH_FULL, 0.08);
  forest.children.forEach((m) => { m.castShadow = S !== SH_FULL; });
  renderer.shadowMap.needsUpdate = true; shFit = { x: cx, z: cz, S };
}
// Render scheduler. Nothing is drawn while the view cannot be seen (background tab, or /app showing 2D: the iframe is
// display:none and its IntersectionObserver reports it). A still camera with only ambient animation (wind, ripples,
// heat pulse, team dots) renders at 30 fps; moving, flying, Kino and crossfades render every frame. The CSS labels are
// re-laid out only when the camera or the label set changed. Resolution can step down while frames run slow (> 24 ms)
// and back up once there is headroom - only with ?dpr=auto: on the Asahi laptop orbiting is bound by the page
// compositor, not fill rate, so a lower resolution only blurred the picture. ?dpr=<n> pins it, ?stats=1 shows fps,
// CPU split, draw calls and resolution (?gpu=1 adds a gl.finish so "render" includes GPU time).
const DPR_AUTO = Q.get('dpr') === 'auto', DPR_PIN = Q.has('dpr') && !DPR_AUTO;
const DPR_MAX = DPR_PIN ? +Q.get('dpr') : Math.min(devicePixelRatio, FPPWIN ? 0.75 : 1.5), DPR_MIN = DPR_AUTO ? Math.max(0.75, DPR_MAX * 0.6) : DPR_MAX;
let shellHidden = false; // {type:'visible', on:false} from /app: 2D is shown, the scene stays built but nothing ticks or renders
let dpr = DPR_MAX, offscreen = false, lastRender = 0, lastLabels = 0, ema = 16, slowFor = 0, fastFor = 0, upWait = 4000, upAt = 0;
renderer.setPixelRatio(dpr);
new IntersectionObserver(([en]) => { offscreen = !en.isIntersecting; if (!offscreen) wake(); }).observe(host);
addEventListener('visibilitychange', wake);
const camSig = new Float64Array(32);
function cameraMoved() {
  camera.updateMatrixWorld();
  const a = camera.matrixWorld.elements, b = camera.projectionMatrix.elements; let moved = false;
  for (let i = 0; i < 16; i++) { if (camSig[i] !== a[i]) { camSig[i] = a[i]; moved = true; } if (camSig[16 + i] !== b[i]) { camSig[16 + i] = b[i]; moved = true; } }
  return moved;
}
function adaptResolution(now, interval) {
  if (!DPR_AUTO || interval > 100) return; // fixed resolution, or a hitch (tab switch, GC)
  ema += (interval - ema) * 0.08;
  slowFor = ema > 24 ? slowFor + interval : 0; fastFor = ema < 18 ? fastFor + interval : 0;
  if (slowFor > 1000 && dpr > DPR_MIN) { dpr = Math.max(DPR_MIN, +(dpr - 0.15).toFixed(2)); renderer.setPixelRatio(dpr); slowFor = 0; if (now - upAt < 6000) upWait = Math.min(upWait * 2, 60000); }
  else if (fastFor > upWait && dpr < DPR_MAX) { dpr = Math.min(DPR_MAX, +(dpr + 0.15).toFixed(2)); renderer.setPixelRatio(dpr); fastFor = 0; upAt = now; }
}
const GPU_SYNC = Q.has('gpu');
const statsEl = Q.has('stats') ? Object.assign(document.createElement('div'), { id: 'stats3d' }) : null;
if (statsEl) { Object.assign(statsEl.style, { position: 'fixed', left: '8px', bottom: '8px', zIndex: 99, font: '11px/1.35 monospace', background: 'rgba(0,0,0,.65)', color: '#cfe', padding: '4px 7px', borderRadius: '4px', pointerEvents: 'none', whiteSpace: 'pre' }); document.body.appendChild(statsEl); }
let statN = 0, statT = 0, statAt = 0, statCalls = 0, statTris = 0, cpuR = 0, cpuL = 0, cpuF = 0, nL = 0;
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  if (document.hidden || offscreen || shellHidden) { clock.getDelta(); return; } // also stops water, PMREM, Kino and timeline ticks
  const dt = Math.min(clock.getDelta(), 0.1);
  if (heatT < 1) { heatT = Math.min(1, heatT + dt / 0.7); heatU.uHeatT.value = heatT; }
  heatU.uTime.value += dt;
  stepMood(dt);
  if (fly) {
    fly.t += dt / fly.dur; const k = ease(Math.min(1, fly.t));
    controls.target.lerpVectors(fly.t0, fly.t1, k); if (fly.path) fly.path(k, camera.position); else camera.position.lerpVectors(fly.p0, fly.p1, k);
    aboveGround(camera.position, 0.25);
    if (fly.t >= 1) { fly = null; idleAt = performance.now(); }
  }
  controls.autoRotate = autoRot && !fly && !CINE.on && !TL3D?.following && !WALK?.on && performance.now() - idleAt > 4000;
  cineTick(dt);
  fitShadow(performance.now());
  if ((!CINE.on || fly) && !TL3D?.following && !WALK?.on) controls.update();
  const timelineMoving = TL3D?.tick(dt);
  const walking = WALK?.tick(dt);
  const coverageMoving = POD3D?.tick(dt);
  let oneShot = false;
  for (let i = movers.length - 1; i >= 0; i--) {
    const m = movers[i];
    if (m.once) { oneShot = true; m.t += dt / 1.1; m.dot.position.copy(m.curve.getPoint(Math.min(1, m.t))); if (m.t >= 1) { movers.splice(i, 1); m.done(); } }
    else {
      m.t = (m.t + dt * (m.speed || 0.15)) % 1; m.mat.dashOffset -= dt * 0.08;
      if (m.mach) {
        const q = m.curve.getPoint(m.t), d = m.curve.getTangent(m.t);
        if (m.mach.surface !== 'air') { const la = toLat(q.z), lo = toLon(q.x); q.y = meshHeightAt(la, lo) + (isWater(la, lo) ? 0.011 : 0.0004); } // walk / sail the arc's ground track
        m.mach.place(q); m.mach.setHeading(d.x, d.z); m.mach.tick(dt);
      }
      else m.dot.position.copy(m.curve.getPoint(m.t));
    }
  }
  for (const m of flowMats) m.dashOffset -= dt * 0.05; // streams run downstream
  forestLod?.(); // trees: near / far LOD split, re-done only after the camera moved far
  nearGrass?.(dt); // near grass: fade with the zoom, re-placed in slices when the target moved far
  traffic?.tick(dt); // cars along the roads
  unitCars?.tick(dt); // blue lights of deployed units' vehicles
  props?.tick(dt); // scenario props: drifting kayak, smoke, hazard lights
  if (precip.visible) {
    const u = precipMat.uniforms; u.uCenter.value.copy(controls.target);
    u.uBox.value = clamp(camera.position.distanceTo(controls.target) * 0.9, 0.8, 8);
    u.uPx.value = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
  }
  if (snowNear.visible) snowNearMat.uniforms.uPx.value = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
  flushLines();
  const moved = cameraMoved();
  const active = moved || fly || CINE.on || walking || timelineMoving || coverageMoving || oneShot || heatT < 1 || controls.autoRotate || now - wakeAt < 600 || renderer.shadowMap.needsUpdate;
  if (!active && now - lastRender < 1000 / 31) return; // ambient only: 30 fps
  if (FPPWIN && now - lastRender < 1000 / 25) return; // the FPP window: at most 24 fps, so the main view keeps its frame rate
  const interval = now - lastRender; lastRender = now;
  if (active) adaptResolution(now, interval);
  const c0 = performance.now();
  glowTick(); // night glow: halos and lit windows follow the mood
  reflRender(moved, now); // water reflection pass (throttled, reduced resolution)
  renderer.render(scene, camera);
  if (GPU_SYNC) renderer.getContext().finish(); // ?gpu=1: stats count the GPU time in "render" (diagnostic only)
  const c1 = performance.now();
  if (moved || timelineMoving || labelsDirty || now - lastLabels > 1000) { labels.render(scene, camera); TL3D?.layoutLabels(); labelsDirty = false; lastLabels = now; nL++; lbDue = true; }
  if (lbDue) declutter(now);
  if (statsEl) {
    const c2 = performance.now();
    statN++; statT += interval; cpuR += c1 - c0; cpuL += c2 - c1; cpuF += c0 - now; statCalls = renderer.info.render.calls; statTris = renderer.info.render.triangles;
    if (now - statAt > 500) {
      statsEl.textContent = `${(1000 / (statT / statN)).toFixed(0)} fps  ${(statT / statN).toFixed(1)} ms\ncpu: update ${(cpuF / statN).toFixed(1)}  render ${(cpuR / statN).toFixed(1)}  labels ${(cpuL / statN).toFixed(1)} ms (${nL}/${statN})\n${statCalls} draw calls  ${(statTris / 1000).toFixed(0)}k tris\ndpr ${dpr} (${DPR_MIN}-${DPR_MAX})  ${active ? 'active' : 'idle 30'}`;
      statN = 0; statT = 0; cpuR = 0; cpuL = 0; cpuF = 0; nL = 0; statAt = now;
    }
  }
}

await yieldMain();
// ---------- start ----------
if (statsEl) window.__r3d = { THREE, camera, controls, v3, flyTo, setStep, TER, terrain, timeline: TL3D, coverage: POD3D, renderer, REFL, heatU, WATER, hAt, toX, toZ, halos, buildings, CINE, foundAt, traffic, props }; // diagnostics only (?stats=1): frame shots from the console
setStep(Q.has('step') ? +Q.get('step') : R.value?.beforePing ?? 0, false);
stepMood(0.1, true); updateEnv(); // start in the step's light, no fade-in
camera.position.copy(center).add(new THREE.Vector3(SPAN * 0.2, SPAN * 2.2, SPAN * 1.6));
controls.target.copy(center);
// ?zoom=<km>[,lat,lon]: open close to the ground (camera that far from the run's centre, or from lat,lon), oblique view;
// for checking close-up materials and the near grass without clicking (no fly-in: the first frame is already there)
const ZOOM = (Q.get('zoom') || '').split(',').map(Number);
if (ZOOM[0] > 0) {
  const t = ZOOM.length === 3 && inside([ZOOM[1], ZOOM[2]]) ? v3(ZOOM[1], ZOOM[2]) : v3(bc[0], bc[1]);
  controls.target.copy(t); camera.position.copy(aboveGround(t.clone().add(new THREE.Vector3(0.3, 0.42, 0.86).normalize().multiplyScalar(clamp(ZOOM[0], 0.5, 30))), 0.25));
} else frameScene({ dur: 1.8 }); // the start shot: IPP + top 3 from the best side (was overview(2.6), from the south-east)
renderer.shadowMap.needsUpdate = true;
// shader programs link on the driver's threads (KHR_parallel_shader_compile) while the terrain bake finishes in its worker
const [[nao, ...bands]] = await Promise.all([bakeJob, renderer.compileAsync(scene, camera).catch(() => {})]);
{
  const g = baseCanvas.getContext('2d');
  for (const b of bands) if (b.y1 > b.y0) g.putImageData(new ImageData(b.base, b.TW, b.y1 - b.y0), 0, b.y0);
  if (OSM) paintOSM(g);
  normalTex.image.data = nao.normal; normalTex.needsUpdate = true; terrainAO.image.data = nao.ao; terrainAO.needsUpdate = true;
  compose();
}
frame();
pollLive();
document.body.dataset.state = 'ready';
// no DEM: a clear panel at the top of the free area says why the ground is flat and what still holds; it stays until closed
if (FLAT) {
  const n = document.createElement('div'); n.id = 'flatNote'; n.className = 'floating'; n.setAttribute('role', 'status');
  Object.assign(n.style, { top: 'calc(var(--inset-t, 0px) + 16px)', left: 'calc((100vw + var(--inset-l, 0px) - var(--inset-r, 0px)) / 2)', transform: 'translateX(-50%)',
    width: 'min(440px, calc(100vw - 32px))', padding: '14px 16px', zIndex: 6, font: '13px/1.45 var(--rl-font, system-ui)' });
  n.innerHTML = `<div style="font-weight:700;font-size:15px;margin-bottom:4px">Brak modelu terenu 3D dla tego scenariusza</div>
    <div>Dla obszaru <b>${esc(SCENS[SC]?.name || SC)}</b> nie ma danych wysokości terenu, więc widok 3D pokazuje go <b>płasko</b>, bez gór i dolin.</div>
    <div style="margin-top:6px">Mapa prawdopodobieństwa, sygnały i zespoły są aktualne. Ukształtowanie terenu zobaczysz w widoku <b>2D</b>.</div>
    <button class="btn sm" style="margin-top:10px">Rozumiem</button>`;
  n.querySelector('button').onclick = () => n.remove();
  document.body.appendChild(n);
}
toParent({ type: 'ready', scenario: SC, steps: R.steps.length, step: STEP });
if (FPP_BC && !FPPWIN) FPP_BC.postMessage({ type: 'scene', sc: SC, run: Q.get('run') || '' }); // an open FPP window follows a scenario / run switch
if (FPPWIN) {
  document.title = 'Widok z oczu jednostki - ' + (SCENS[SC]?.name || SC);
  const unit = Q.get('unit');
  if (!R.timeline?.actors?.length) hint('Ten scenariusz nie ma osi czasu z pozycjami jednostek - brak widoku z oczu.');
  else { if (unit) TL3D?.startFpp(unit); FPP_BC?.postMessage({ type: 'hello', sc: SC }); }
}
