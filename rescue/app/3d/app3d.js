// Rescue Locator 3D - terrain scene of the POA timeline, its source signals, and a blind test game, shown inside /app
// (iframe, ?embed=scene): the shell owns the step card, signal list, ranking, team plan and timeline.
// Reads the same offline files as the 2D screen: out/run.json (rescue-run/1), scenarios/<sc>.json,
// scenarios/<sc>-terrain.json, tools/terrain/data/<sc>-dem.json and out/live-events.json.
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
import { FX, applyFx, installHeightFog } from './fx3d.js'; // vertex / pixel shader effects

// ---------- config ----------
const Q = new URLSearchParams(location.search);
const SCENS = {
  zawrat: { name: 'Zawrat', run: '../../out/run.json', demWide: 'data/zawrat-dem-wide.json', ortho: 'data/zawrat-ortho-wide.jpg' },
  'morskie-oko': { name: 'Morskie Oko', run: '../../out/morskie-oko.run.json' },
  kasprowy: { name: 'Kasprowy', run: '../../out/kasprowy.run.json' },
  'blind-01': { name: 'Test na ślepo: runda 1 (replay)', run: '../../out/blind-01-replay.run.json', scenario: '../../scenarios/blind-01-replay.json',
    terrain: '../../scenarios/blind-01-replay-terrain.json', dem: '../../tools/terrain/data/zawrat-dem.json', demWide: 'data/zawrat-dem-wide.json', ortho: 'data/zawrat-ortho-wide.jpg', reveal: '../../blindtest/blind-01.reveal.json' },
};
// Regions outside the Tatras: any scenario with tools/terrain/data/<sc>-dem.json opens on its own (narrow) DEM, without
// the wide backdrop or aerial photo. Blind tests only through their SCENS entries.
const REGIONS = { 'bieszczady-wetlinska': 'Bieszczady - Połonina Wetlińska', 'karkonosze-sniezka': 'Karkonosze - Śnieżka', sniardwy: 'Śniardwy', morzycko: 'Morzycko', miedzyzdroje: 'Międzyzdroje (Bałtyk)' };
const addScen = (id) => { if (!SCENS[id] && /^[a-z0-9-]{1,40}$/.test(id) && !/blind/.test(id)) SCENS[id] = { name: REGIONS[id] || id, run: `../../out/${id}.run.json`, region: true }; };
SCENS['blind-01-replay'] = SCENS['blind-01']; // the shell's id for the round 1 replay
if (Q.get('sc')) addScen(Q.get('sc'));
const SC = SCENS[Q.get('sc')] ? Q.get('sc') : 'zawrat';
const P = {
  run: Q.get('run') || SCENS[SC].run,
  scenario: Q.get('scenario') || SCENS[SC].scenario || `../../scenarios/${SC}.json`,
  terrain: Q.get('terrain') || SCENS[SC].terrain || `../../scenarios/${SC}-terrain.json`,
  dem: Q.get('dem') || SCENS[SC].dem || `../../tools/terrain/data/${SC}-dem.json`,
  reveal: Q.get('reveal') || SCENS[SC].reveal,
  live: Q.get('live') || '../../out/live-events.json',
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
if (document.body.classList.contains('embed')) {
  // decision S1: embedded views use the shell's tokens (dark operational theme, light via ?theme=light)
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '../tokens.css'; document.head.appendChild(l);
  if (Q.get('theme') === 'light' || Q.get('theme') === 'dark') document.documentElement.dataset.theme = Q.get('theme');
}
// rescue-server computes runs live and the generated out/<sc>.run.json files are not committed: when the static file
// is missing, ask the same origin's GET /api/run/<sc> before giving up (blind tests are never served there).
const API_RUN = `/api/run/${SC}`;
const loadRun = async () => {
  try { return await getJSON(P.run); }
  catch (e) {
    if (!Q.get('run') && !P.reveal && /^404 /.test(e.message)) { try { const r = await getJSON(API_RUN); P.run = API_RUN; return r; } catch {} }
    if (P.reveal || SCENS[SC].region) return null; // replay from the scenario file (synthRun below)
    throw e;
  }
};
let R, SCN, TER, DEM, REV, DEM_FULL, FLAT = false;
try {
  const wide = !Q.get('dem') && Q.get('wide') !== '0' && SCENS[SC].demWide;
  [R, SCN, TER, DEM, REV] = await Promise.all([inlineRun ? Promise.resolve(inlineRun) : loadRun(), getJSON(P.scenario, true), getJSON(P.terrain, true),
    (wide ? getJSON(wide, true) : Promise.resolve(null)).then((d) => d || getJSON(P.dem, true)), P.reveal ? getJSON(P.reveal, true) : null]);
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
const LOW = !!SCENS[SC].region;
const WM = TER?.waterMask && TER.slopeGrid && SCN?.bbox ? { m: TER.waterMask, rows: TER.slopeGrid.rows, cols: TER.slopeGrid.cols, b: SCN.bbox } : null;
function isWater(la, lo) {
  if (WM && la <= WM.b.north && la >= WM.b.south && lo >= WM.b.west && lo <= WM.b.east) {
    const r = Math.min(WM.rows - 1, Math.floor(((WM.b.north - la) / (WM.b.north - WM.b.south)) * WM.rows)), c = Math.min(WM.cols - 1, Math.floor(((lo - WM.b.west) / (WM.b.east - WM.b.west)) * WM.cols));
    return !!WM.m[r * WM.cols + c];
  }
  return LOW && elevM(la, lo) <= 0.3;
}
const hAt = (lat, lon) => ((elevM(lat, lon) - zMin) * EX) / 1000;
const v3 = (lat, lon, lift = 0) => new THREE.Vector3(toX(lon), hAt(lat, lon) + lift, toZ(lat));

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
Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
host.appendChild(labels.domElement);

installHeightFog(); // fx3d: valley haze + aerial perspective, before any material compiles
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 400);
const controls = new OrbitControls(camera, renderer.domElement);
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

// ---------- sky, lights ----------
const SUN_DIR = new THREE.Vector3(-0.72, 0.32, -0.38).normalize(); // low evening sun from the west
const skyMat = FX.sky(SUN_DIR);
scene.add(new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), skyMat));
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
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
scene.add(hemi, sun, sun.target);
scene.fog = new THREE.Fog(0xffffff, 12, 60);

// ---------- terrain texture ----------
const TS = clamp(Math.floor(1500 / DEM.cols), 2, 4); // texture pixels per DEM pixel (capped for large DEM cuts)
const TW = DEM.cols * TS, TH = DEM.rows * TS;
// vegetation by elevation (Tatra belts: spruce forest, dwarf pine, alpine meadow), rock by slope, snow high up
const VEG = [[900, [62, 112, 52]], [1200, [48, 98, 44]], [1450, [70, 118, 52]], [1600, [104, 138, 64]], [1800, [150, 160, 88]], [2000, [168, 166, 120]], [2300, [184, 180, 168]]];
const ROCK = [[1000, [138, 128, 116]], [1800, [156, 148, 138]], [2300, [186, 180, 172]]];
function lerpStops(stops, v) {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) {
    const [e0, a] = stops[i - 1], [e1, b] = stops[i], t = (v - e0) / (e1 - e0);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  return stops[stops.length - 1][1];
}
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const baseCanvas = document.createElement('canvas'); baseCanvas.width = TW; baseCanvas.height = TH;
{
  // printed-topo look: vegetation/rock tint, warm-lit / cool-shadow hillshade, brown contours every 50 m (bold every 250 m)
  const g = baseCanvas.getContext('2d'), img = g.createImageData(TW, TH), d = img.data;
  const E = new Float32Array(TW * TH);
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) E[y * TW + x] = elevM(DEM.lat0 - ((y + 0.5) / TS) * stLat, DEM.lon0 + ((x + 0.5) / TS) * stLon);
  const px = (stLon * KX * KM * 1000) / TS, py = (stLat * KM * 1000) / TS;
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
    const i = y * TW + x, e = E[i];
    const right = E[y * TW + Math.min(x + 1, TW - 1)], left = E[y * TW + Math.max(x - 1, 0)];
    const down = E[Math.min(y + 1, TH - 1) * TW + x], up = E[Math.max(y - 1, 0) * TW + x];
    const gx = (right - left) / (2 * px), gy = (down - up) / (2 * py), slope = (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI;
    const len = Math.hypot(gx, gy, 1), shade = clamp((0.62 * gx - 0.62 * gy + 0.5) / len / 0.78, 0, 1.4);
    const wla = DEM.lat0 - ((y + 0.5) / TS) * stLat, wlo = DEM.lon0 + ((x + 0.5) / TS) * stLon;
    if ((LOW || WM) && isWater(wla, wlo)) { const k = 0.9 + 0.1 * Math.sin(x * 0.07 + y * 0.05); d[i * 4] = 92 * k; d[i * 4 + 1] = 142 * k; d[i * 4 + 2] = 166 * k; d[i * 4 + 3] = 255; continue; }
    let c = LOW ? mix3([168, 178, 132], [150, 142, 120], smooth(14, 30, slope)) : mix3(lerpStops(VEG, e), lerpStops(ROCK, e), smooth(26, 42, slope));
    c = mix3(c, [236, 238, 242], smooth(2350, 2550, e) * 0.8);
    c = c.map((v) => v * (0.62 + 0.42 * shade));
    if (shade < 0.75) c = mix3(c, [58, 74, 112], (0.75 - shade) * 0.45);
    else if (shade > 1) c = mix3(c, [255, 236, 204], (shade - 1) * 0.3);
    const f = (st) => Math.floor(e / st) !== Math.floor(right / st) || Math.floor(e / st) !== Math.floor(down / st);
    const w = f(250) ? 0.3 : f(50) ? 0.12 : 0;
    if (w) c = mix3(c, [110, 76, 44], w);
    d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}
const compCanvas = document.createElement('canvas'); compCanvas.width = TW; compCanvas.height = TH;
const compTex = new THREE.CanvasTexture(compCanvas); compTex.colorSpace = THREE.SRGBColorSpace; compTex.anisotropy = 8;
// POA heat drawn in the terrain shader: two canvas textures (previous / current step) crossfaded by uHeatT, with
// contour edges at the 2x / 5x / 10x stops of the shared scale and a slow pulse on the hotspot
const heatTex = () => { const t = new THREE.CanvasTexture(document.createElement('canvas')); t.colorSpace = THREE.SRGBColorSpace; return t; };
const heatU = { uHeatFrom: { value: heatTex() }, uHeatTo: { value: heatTex() }, uHeatT: { value: 1 }, uHeatOn: { value: new THREE.Vector2() },
  uHeatRect: { value: new THREE.Vector4() }, uHeatEdges: { value: new THREE.Vector3() }, uTime: { value: 0 }, uEmis: { value: 0 },
  uSnowY: { value: ((2350 - zMin) * EX) / 1000 }, uWind: { value: 0.03 },
  uDay: { value: 1 }, uCloud: { value: 0.35 }, uCloudOff: { value: new THREE.Vector2() }, uSunDir: { value: SUN_DIR } }; // shared by every fx3d effect
Object.assign(precipMat.uniforms, { uTime: heatU.uTime, uWind: heatU.uWind, uDay: heatU.uDay });

const terrainGeo = new THREE.PlaneGeometry(WKM, HKM, DEM.cols - 1, DEM.rows - 1);
terrainGeo.rotateX(-Math.PI / 2);
{
  const pos = terrainGeo.attributes.position;
  for (let r = 0; r < DEM.rows; r++) for (let c = 0; c < DEM.cols; c++) pos.setY(r * DEM.cols + c, ((DEM.z[r][c] - zMin) * EX) / 1000);
  terrainGeo.computeVertexNormals();
}
// object-space normal map from the full-resolution DEM: the mesh is averaged 2x2 for the wide cut, the shading keeps every ridge
let terrainAO = null, sunMask = null, sunAt = () => 1;
const normalTex = (() => {
  const k = DEM_FULL.cols / DEM.cols >= 1.5 ? 2 : 1, C = DEM.cols * k, Rr = DEM.rows * k, Z = DEM_FULL.z;
  const sx = 2 * (DEM_FULL.step * KX * KM), sz = 2 * ((DEM_FULL.stepLat || DEM_FULL.step) * KM), f = EX / 1000;
  const at = (r, c) => Z[clamp(r, 0, Rr - 1)][clamp(c, 0, C - 1)];
  const data = new Uint8Array(C * Rr * 4);
  for (let r = 0; r < Rr; r++) for (let c = 0; c < C; c++) {
    const gx = ((at(r, c + 1) - at(r, c - 1)) * f) / sx, gz = ((at(r + 1, c) - at(r - 1, c)) * f) / sz, l = Math.hypot(gx, 1, gz);
    const o = ((Rr - 1 - r) * C + c) * 4; // texture row 0 = south (v = 0)
    data[o] = (-gx / l * 0.5 + 0.5) * 255; data[o + 1] = (1 / l * 0.5 + 0.5) * 255; data[o + 2] = (-gz / l * 0.5 + 0.5) * 255; data[o + 3] = 255;
  }
  const t = new THREE.DataTexture(data, C, Rr, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true;
  // flat height array in scene units, for the two bakes below
  const H = new Float32Array(C * Rr); for (let r = 0; r < Rr; r++) for (let c = 0; c < C; c++) H[r * C + c] = Z[r][c] * f;
  // baked ambient occlusion: horizon angle in 8 directions out to ~1 km, so gullies and cirques sit in their own shade
  const ao = new Uint8Array(C * Rr * 4), px = sx / 2, pz = sz / 2, DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]], STEPS = [1, 2, 3, 5, 8, 12, 18, 27, 40];
  const DL = DIRS.map(([dc, dr]) => Math.hypot(dc * px, dr * pz));
  for (let r = 0; r < Rr; r++) for (let c = 0; c < C; c++) {
    const h0 = H[r * C + c]; let occ = 0;
    for (let j = 0; j < 8; j++) {
      const dc = DIRS[j][0], dr = DIRS[j][1], dl = DL[j]; let mx = 0;
      for (const k of STEPS) { const rr = r + dr * k, cc = c + dc * k; if (rr < 0 || cc < 0 || rr >= Rr || cc >= C) break; const tn = (H[rr * C + cc] - h0) / (dl * k); if (tn > mx) mx = tn; }
      occ += mx / Math.sqrt(1 + mx * mx); // sin(horizon angle)
    }
    const v = clamp(1 - (occ / 8) * 1.35, 0.25, 1) * 255, o = ((Rr - 1 - r) * C + c) * 4;
    ao[o] = ao[o + 1] = ao[o + 2] = v; ao[o + 3] = 255;
  }
  const a = new THREE.DataTexture(ao, C, Rr, THREE.RGBAFormat);
  a.magFilter = THREE.LinearFilter; a.minFilter = THREE.LinearMipmapLinearFilter; a.generateMipmaps = true; a.needsUpdate = true;
  terrainAO = a;
  // baked terrain self-shadow (far cascade) on a half-resolution grid: march from every cell towards the low sun, soft penumbra
  const C2 = C >> 1, R2 = Rr >> 1, px2 = px * 2, pz2 = pz * 2;
  const hd = Math.hypot(SUN_DIR.x, SUN_DIR.z), stepKm = Math.min(px2, pz2), rise = (SUN_DIR.y / hd) * stepKm;
  const dcs = (SUN_DIR.x / hd) * stepKm / px2, drs = (SUN_DIR.z / hd) * stepKm / pz2;
  const H2 = new Float32Array(C2 * R2); let hMax = -Infinity;
  for (let r = 0; r < R2; r++) for (let c = 0; c < C2; c++) { const v = H[2 * r * C + 2 * c]; H2[r * C2 + c] = v; if (v > hMax) hMax = v; }
  const sm = new Float32Array(C2 * R2), smData = new Uint8Array(C2 * R2 * 4);
  for (let r = 0; r < R2; r++) for (let c = 0; c < C2; c++) {
    let ray = H2[r * C2 + c], lit = 1, cc = c, rr = r;
    for (let k = 1; k < 400; k++) {
      cc += dcs; rr += drs; ray += rise;
      if (ray > hMax || cc < 0 || rr < 0 || cc > C2 - 1 || rr > R2 - 1) break;
      const d = (ray - H2[Math.round(rr) * C2 + Math.round(cc)]) / (k * stepKm * 0.035); // ~2 deg penumbra
      if (d < lit) { lit = d; if (lit <= -1) break; }
    }
    const v = clamp(0.5 + 0.5 * lit, 0, 1), o = ((R2 - 1 - r) * C2 + c) * 4;
    sm[r * C2 + c] = v; smData[o] = smData[o + 1] = smData[o + 2] = v * 255; smData[o + 3] = 255;
  }
  sunMask = new THREE.DataTexture(smData, C2, R2, THREE.RGBAFormat);
  sunMask.magFilter = THREE.LinearFilter; sunMask.minFilter = THREE.LinearMipmapLinearFilter; sunMask.generateMipmaps = true; sunMask.needsUpdate = true;
  const sLat = 2 * (DEM_FULL.stepLat || DEM_FULL.step), sLon = 2 * DEM_FULL.step;
  sunAt = (lat, lon) => sm[clamp(Math.round((DEM_FULL.lat0 - lat) / sLat - 0.5), 0, R2 - 1) * C2 + clamp(Math.round((lon - DEM_FULL.lon0) / sLon - 0.5), 0, C2 - 1)];
  return t;
})();
const terrainMat = new THREE.MeshStandardMaterial({ map: compTex, emissive: 0x000000, roughness: 0.96, metalness: 0,
  normalMap: normalTex, normalMapType: THREE.ObjectSpaceNormalMap, aoMap: terrainAO, aoMapIntensity: 0.8 });
heatU.uSunMask = { value: sunMask };
// fx3d: close-up detail, POA heat layer, baked + near sun shadow, drifting cloud shadows, snow glints
applyFx(terrainMat, [FX.terrainDetail(), FX.poaHeat(heatU), FX.bakedSun(heatU), FX.cloudShadows(heatU), FX.snowGlints(heatU)]);
const terrain = new THREE.Mesh(terrainGeo, terrainMat);
terrain.castShadow = true; terrain.receiveShadow = true;
scene.add(terrain);
// sea and lakes outside the Tatras as a real water surface (fx3d.seaWaves): the terrain mesh itself, lifted 3 m, shows
// only where isWater says water, so the coast and lake shapes match the 2D map; the mask is blurred so its edge is a
// smooth shore line (the scenario waterMask is a coarse grid) and the 0.5..0.9 band carries the surf
let seaMesh = null;
if (WM || LOW) {
  const C = 512, Rw = Math.max(2, Math.round((C * HKM) / WKM)), m = new Float32Array(C * Rw); let n = 0;
  for (let r = 0; r < Rw; r++) for (let c = 0; c < C; c++) { if (isWater(latN - ((r + 0.5) / Rw) * (latN - latS), lonW + ((c + 0.5) / C) * (lonE - lonW))) { m[r * C + c] = 1; n++; } }
  if (n > 20) {
    const cellPx = WM ? Math.max((C / WM.cols) * ((WM.b.east - WM.b.west) / (lonE - lonW)), 1) : 2, rad = Math.max(2, Math.round(cellPx * 0.6));
    const blur = (src, dx, dy) => { const out = new Float32Array(src.length); for (let r = 0; r < Rw; r++) for (let c = 0; c < C; c++) { let a = 0, k = 0; for (let t = -rad; t <= rad; t++) { const rr = r + t * dy, cc = c + t * dx; if (rr >= 0 && rr < Rw && cc >= 0 && cc < C) { a += src[rr * C + cc]; k++; } } out[r * C + c] = a / k; } return out; };
    const mb = blur(blur(m, 1, 0), 0, 1), data = new Uint8Array(C * Rw * 4);
    for (let r = 0; r < Rw; r++) for (let c = 0; c < C; c++) { const o = ((Rw - 1 - r) * C + c) * 4; data[o] = data[o + 1] = data[o + 2] = mb[r * C + c] * 255; data[o + 3] = 255; } // row 0 = south
    const tex = new THREE.DataTexture(data, C, Rw, THREE.RGBAFormat); tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    const seaMat = new THREE.MeshStandardMaterial({ color: 0x14606f, emissive: 0x020c10, roughness: 0.07, metalness: 0.05, envMapIntensity: 1.25 });
    applyFx(seaMat, [FX.seaWaves(heatU, tex, new THREE.Vector4(-WKM / 2, HKM / 2, WKM, HKM))]);
    seaMesh = new THREE.Mesh(terrainGeo, seaMat); seaMesh.position.y = 0.003; seaMesh.receiveShadow = true; seaMesh.renderOrder = 1; scene.add(seaMesh);
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
let heatFrom = null, heatTo = null, heatT = 1, WASH = new Map(); // searched segment id -> times searched
const llToTex = (la, lo) => [((lo - DEM.lon0) / stLon) * TS, ((DEM.lat0 - la) / stLat) * TS];
function compose() {
  const g = compCanvas.getContext('2d');
  g.globalAlpha = 1; g.drawImage(ORTHO.on && ORTHO.canvas ? ORTHO.canvas : baseCanvas, 0, 0);
  if (SHOW_DIFF) g.drawImage(diffLayer(), heatRect.x, heatRect.y, heatRect.w, heatRect.h); // the heat itself is drawn by the terrain shader
  heatU.uHeatOn.value.set(!SHOW_DIFF && heatFrom ? 1 : 0, !SHOW_DIFF && heatTo ? 1 : 0);
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
if (SCENS[SC].ortho && DEM_FULL.cols > 600) {
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
  const o = new CSS2DObject(el); o.position.copy(pos); return o;
}
const ballGeo = new THREE.SphereGeometry(1, 16, 12);
function pin(lat, lon, color, h = 0.2, html = null, cls = '', r = 0.016) {
  const g = new THREE.Group(), p0 = v3(lat, lon, 0.004), p1 = p0.clone().add(new THREE.Vector3(0, h, 0));
  g.add(makeLine([p0, p1], { color: '#2b2f33', width: 1.4, opacity: 0.85 }));
  const head = new THREE.Mesh(ballGeo, new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
  head.scale.setScalar(r); head.position.copy(p1); g.add(head);
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
applyFx(waterMat, [FX.lakeWaves(heatU)]); // fx3d: waves, foam, depth tint, sun glitter
const lakeGeo = new THREE.RingGeometry(0.0001, 1, 96, 24).rotateX(-Math.PI / 2);
for (const l of seaMesh ? [] : TER?.lakes || []) { // regions: lakes come with the sea surface above
  const m = new THREE.Mesh(lakeGeo, waterMat), r = l.radiusM / 1000;
  m.scale.set(r, 1, r); m.position.copy(v3(l.center[0], l.center[1], 0.005)); statics.add(m);
}
for (const h of TER?.huts || []) statics.add(pin(h.at[0], h.at[1], '#7f5539', 0.07, esc(h.name), 'hut', 0.011));
for (const g of segs.values()) drapeRuns(ringLL(g.polygon), 0.016, { color: '#2b2f33', width: 1, opacity: 0.28 }, statics);
statics.add(pin(R.ipp.lat, R.ipp.lon, '#b8860b', 0.3, 'IPP · ostatnio widziany', 'ipp', 0.02));

// ---------- forests: instanced spruce (montane belt) and dwarf pine (subalpine belt) ----------
const forest = new THREE.Group(); scene.add(forest);
{
  let seed = 1234567; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // cheap value noise for natural patches
  const NS = 64, nv = Float32Array.from({ length: NS * NS }, rnd);
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, at = (a, b) => nv[((a % NS) + NS) % NS + (((b % NS) + NS) % NS) * NS];
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return (at(xi, yi) * (1 - u) + at(xi + 1, yi) * u) * (1 - v) + (at(xi, yi + 1) * (1 - u) + at(xi + 1, yi + 1) * u) * v;
  };
  const lakes = (TER?.lakes || []).map((l) => ({ la: l.center[0], lo: l.center[1], r: (l.radiusM + 25) / 1000 }));
  const inLake = (la, lo) => lakes.some((l) => Math.hypot((la - l.la) * KM, (lo - l.lo) * KM * KX) < l.r);
  const spruce = [], pine = [];
  const tries = FLAT ? 0 : Q.has('trees') ? +Q.get('trees') : Math.round(clamp(WKM * HKM * 2000, 40000, 140000)); // no forest guessed on flat fallback ground
  for (let n = 0; n < tries; n++) {
    const la = latS + rnd() * (latN - latS), lo = lonW + rnd() * (lonE - lonW), e = elevM(la, lo);
    const dz = Math.hypot(elevM(la, lo + 0.0004) - elevM(la, lo - 0.0004), elevM(la + 0.0003, lo) - elevM(la - 0.0003, lo)) / 2 / 33;
    const slope = (Math.atan(dz) * 180) / Math.PI;
    if (slope > 38 || inLake(la, lo) || isWater(la, lo)) continue;
    const nz = noise(toX(lo) * 2.2 + 50, toZ(la) * 2.2 + 50);
    if (LOW) { if (nz > 0.6 && rnd() < 0.8) spruce.push([la, lo, e]); continue; } // lowland: woods in patches, not a Tatra belt
    if (e < 1520 && nz > 0.32 - (1520 - e) / 2500 && rnd() < 0.9) spruce.push([la, lo, e]);
    else if (e >= 1450 && e < 1850 && nz > 0.45 && rnd() < 0.55) pine.push([la, lo, e]);
  }
  const place = (list, geo, mat, hMin, hMax, colA, colB) => {
    const m = new THREE.InstancedMesh(geo, mat, list.length), o = new THREE.Object3D(), c = new THREE.Color(), A = new THREE.Color(colA), Bc = new THREE.Color(colB);
    list.forEach(([la, lo], i) => {
      const h = hMin + rnd() * (hMax - hMin);
      o.position.copy(v3(la, lo, -0.002)); o.rotation.set(0, rnd() * 6.28, 0); o.scale.set(h * (0.85 + rnd() * 0.3), h, h * (0.85 + rnd() * 0.3)); o.updateMatrix();
      m.setMatrixAt(i, o.matrix); m.setColorAt(i, c.copy(A).lerp(Bc, rnd()).multiplyScalar(0.55 + 0.45 * sunAt(la, lo))); // darker in the baked terrain shadow
    });
    m.receiveShadow = true; m.castShadow = false; forest.add(m);
  };
  const cone = new THREE.ConeGeometry(0.28, 1, 6, 1); cone.translate(0, 0.5, 0);
  const cone2 = new THREE.ConeGeometry(0.36, 0.7, 6, 1); cone2.translate(0, 0.32, 0);
  const sprGeo = new THREE.BufferGeometry().copy(cone); // two-tier spruce silhouette
  {
    const a = cone.toNonIndexed(), b = cone2.toNonIndexed(), pa = a.attributes.position.array, pb = b.attributes.position.array;
    const pos = new Float32Array(pa.length + pb.length); pos.set(pa); pos.set(pb, pa.length);
    sprGeo.setIndex(null); sprGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sprGeo.deleteAttribute('uv'); sprGeo.deleteAttribute('normal'); sprGeo.computeVertexNormals();
  }
  const pineGeo = new THREE.IcosahedronGeometry(0.5, 0); pineGeo.scale(1, 0.45, 1); pineGeo.translate(0, 0.18, 0);
  const treeMat = new THREE.MeshStandardMaterial({ roughness: 0.92, flatShading: true });
  applyFx(treeMat, [FX.treeWind(heatU)]); // fx3d: crowns sway with the step's wind
  place(spruce, sprGeo, treeMat, 0.026, 0.044, '#2f5d34', '#4f7d40');
  place(pine, pineGeo, treeMat, 0.012, 0.02, '#4c7639', '#6d9346');
}
const foundPin = foundAt ? pin(foundAt[0], foundAt[1], '#2d6a4f', 0.42, 'ZNALEZIONO · ' + esc(foundEv?.at || ''), 'found', 0.026) : null;
if (foundPin) { foundPin.visible = false; scene.add(foundPin); }
// blind test reveal: the hider's true spot, published with the salt after the round
const revealPin = REV?.at ? pin(REV.at[0], REV.at[1], '#b8322a', 0.55, 'Odsłonięte: tu była · ' + esc(REV.round || ''), 'target', 0.028) : null;
if (revealPin) { revealPin.visible = false; scene.add(revealPin); }

// dynamic layers
const dyn = { top: new THREE.Group(), searched: new THREE.Group(), teams: new THREE.Group(), signals: new THREE.Group(), live: new THREE.Group(), game: new THREE.Group() };
Object.values(dyn).forEach((g) => scene.add(g));
const movers = [];

// ---------- mood: daylight, fog, dusk ----------
const MOODS = {
  day: { top: '#3f78b8', bottom: '#f1e6d4', fog: '#c9d8e6', sun: '#fff0d6', sunI: 3.0, hs: '#cfe0f5', hg: '#6a5a3e', hI: 0.9, stars: 0, emis: 0, exp: 1.15 },
  fog: { top: '#7f9bb8', bottom: '#ece5d8', fog: '#cdd6df', sun: '#fff5e8', sunI: 2.3, hs: '#dbe6f2', hg: '#6f6656', hI: 1.0, stars: 0, emis: 0, exp: 1.12 },
  night: { top: '#2a3d63', bottom: '#a0aecb', fog: '#8291b3', sun: '#e3eaff', sunI: 2.9, hs: '#cad7f0', hg: '#5c5c68', hI: 1.65, stars: 0.6, emis: 0.25, exp: 1.2 },
};
const cur = { cloud: 0.35, rain: 0, snow: 0, top: new THREE.Color('#86aacb'), bottom: new THREE.Color('#e6ebe8'), fog: new THREE.Color('#dde3e4'), sun: new THREE.Color('#fff'), hs: new THREE.Color('#fff'), hg: new THREE.Color('#666'), sunI: 2.6, hI: 1, stars: 0, emis: 0, exp: 1, near: 12, far: 60, wind: 0.02 };
let tgt = { ...cur }, weatherOn = true;
function setMood(w) {
  const vis = w?.visibilityM ?? 10000, dark = !!w?.dark && weatherOn;
  const m = dark ? MOODS.night : weatherOn && vis < 500 ? MOODS.fog : MOODS.day;
  tgt = {
    top: new THREE.Color(m.top), bottom: new THREE.Color(m.bottom), fog: new THREE.Color(m.fog), sun: new THREE.Color(m.sun), hs: new THREE.Color(m.hs), hg: new THREE.Color(m.hg),
    sunI: m.sunI, hI: m.hI, stars: m.stars * (vis >= 500 ? 1 : 0.1), emis: m.emis, exp: m.exp,
    near: !weatherOn ? 9 : vis <= 100 ? 5 : vis < 500 ? 6 : 9, far: !weatherOn ? 40 : vis <= 100 ? 22 : vis < 500 ? 28 : 40,
    wind: clamp((weatherOn ? w?.windMs ?? 4 : 4) / 14, 0.15, 1.5) * 0.07,
    // cloud cover and precipitation from the step's weather (off with "Pogoda")
    cloud: !weatherOn ? 0.3 : w?.precip && w.precip !== 'none' ? 0.85 : vis < 500 ? 0.7 : 0.35,
    rain: weatherOn && w?.precip === 'rain' ? 1 : 0, snow: weatherOn && w?.precip === 'snow' ? 1 : 0,
  };
}
function stepMood(dt) {
  const k = 1 - Math.exp(-dt * 1.8);
  for (const c of ['top', 'bottom', 'fog', 'sun', 'hs', 'hg']) cur[c].lerp(tgt[c], k);
  for (const n of ['sunI', 'hI', 'stars', 'emis', 'exp', 'near', 'far', 'wind', 'cloud', 'rain', 'snow']) cur[n] += (tgt[n] - cur[n]) * k;
  heatU.uWind.value = cur.wind; heatU.uCloud.value = cur.cloud; heatU.uDay.value = clamp(1 - cur.stars * 1.6, 0.15, 1);
  heatU.uCloudOff.value.add(new THREE.Vector2(0.8, 0.6).multiplyScalar(dt * (0.004 + cur.wind * 0.12))); // clouds drift with the wind
  skyMat.uniforms.uCloud.value = cur.cloud; skyMat.uniforms.uCloudOff.value.copy(heatU.uCloudOff.value);
  const pk = cur.snow > cur.rain ? 1 : 0, pa = Math.max(cur.rain, cur.snow);
  precip.visible = pa > 0.01; precipMat.uniforms.uKind.value = pk; precipMat.uniforms.uAmt.value = pa;
  skyMat.uniforms.top.value.copy(cur.top); skyMat.uniforms.bottom.value.copy(cur.bottom);
  scene.fog.color.copy(cur.fog); scene.fog.near = cur.near; scene.fog.far = cur.far;
  sun.color.copy(cur.sun); sun.intensity = cur.sunI; hemi.color.copy(cur.hs); hemi.groundColor.copy(cur.hg); hemi.intensity = cur.hI;
  starMat.opacity = cur.stars; heatU.uEmis.value = cur.emis; renderer.toneMappingExposure = cur.exp;
  skyMat.uniforms.sunCol.value.copy(cur.sun); skyMat.uniforms.sunAmt.value = clamp(1.4 - cur.stars * 1.6, 0.15, 1.2) * (cur.near < 7 ? 0.45 : 1);
  hemi.intensity = cur.hI * 0.45; // the sky environment map carries the rest of the ambient light
  if ((Math.abs(cur.top.r - tgt.top.r) + Math.abs(cur.bottom.g - tgt.bottom.g) + Math.abs(cur.fog.b - tgt.fog.b) > 0.004 && performance.now() - envAt > 250) || envAt < 0) updateEnv();
}
// image-based light from the sky dome: prefiltered with PMREM, re-baked only while the mood (day/fog/night) is changing
const pmrem = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene(), envSkyMat = skyMat.clone();
envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), envSkyMat));
let envRT = null, envAt = -1;
function updateEnv() {
  const u = envSkyMat.uniforms;
  u.top.value.copy(cur.top); u.bottom.value.copy(cur.bottom).lerp(cur.hg, 0.55); u.sunDir.value.copy(SUN_DIR); u.sunCol.value.copy(cur.sun); u.sunAmt.value = skyMat.uniforms.sunAmt.value * 0.15; u.uCloud.value = cur.cloud;
  const rt = pmrem.fromScene(envScene, 0, 0.1, 50);
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
let STEP = -1;
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
const rankedOf = (segments) => [...segments].sort((a, b) => b.poa - a.poa);
function drawTop(ranked) {
  disposeGroup(dyn.top);
  if (R.synthetic && G.phase === 'off') return;
  ranked.slice(0, 3).forEach((sg, k) => {
    const g = segs.get(sg.id); if (!g) return;
    // as in 2D: top 3 outlined white 3.2 px, chip "#1 Name - 21%" with the rank in red
    drapeRuns(ringLL(g.polygon), 0.02, { color: '#ffffff', width: 3.2, opacity: 0.95 }, dyn.top);
    dyn.top.add(label(`<b class="rk">#${k + 1}</b> ${esc(sg.name)} - ${pct(sg.poa)}`, 'top3', v3(g.center[0], g.center[1], 0.14)));
  });
}
function setStep(i, animate = true) {
  if (G.phase !== 'off') return;
  i = clamp(i, 0, R.steps.length - 1);
  const prev = STEP; STEP = i;
  const s = R.steps[i], OG = gridFor(i), ranked = OG ? rankedOf(segPoa(OG)) : rankedOf(s.segments);
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
  setMood(s.weather);
  renderOffBanner(i);
  if (prev !== i && !fromParent) toParent({ type: 'step', i, t: s.t });
}
function drawTeams(s) {
  disposeGroup(dyn.teams); movers.length = 0;
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
    const dot = new THREE.Mesh(ballGeo, new THREE.MeshStandardMaterial({ color: col })); dot.scale.setScalar(0.014);
    dyn.teams.add(line, dot, label(`${esc(res.name.split(' (')[0])} · ${Math.round(a.etaMin)} min`, 'team', p1.clone()));
    movers.push({ curve, dot, mat: line.material, t: Math.random() });
  }
}

// ---------- legend (shared scale) ----------
const LEGEND_HEAT = `<div class="lg-title">Prawdopodobieństwo × średnia komórka</div><i class="ramp" style="background:${gradientCSS()}"></i>
    <div class="stops">${STOPS.map((x) => `<span>${x.label}</span>`).join('')}</div>
    <div class="lg-note">1× = średnio ${nf(100 / (R.rows * R.cols), 3)}% na komórkę 100 x 100 m; poniżej 0,5× bez koloru</div>
    <div class="lg-keys"><span><i class="k-top"></i>top 3</span><span><i class="k-srch"></i>przeszukany</span></div>`;
const LEGEND_DIFF = `<div class="lg-title">Trudność terenu (silnik)</div><div class="lg-diff">${(R.difficultyClasses || []).map((c) => `<span><i style="background:${DIFF_COLORS[c.id] || '#000'}"></i>${esc(c.label)}</span>`).join('')}</div>`;
// embed=scene: legend box top-left and controls top-right, laid out like the 2D screen's #legend / #mapctl
if (EMB === 'scene') {
  $('sceneLegend').hidden = false; $('sceneLegend').innerHTML = LEGEND_HEAT;
  // control box like 2D #mapctl: segmented group, checkbox row, full-width button; it drives the regular HUD buttons
  const ctl = document.createElement('div'); ctl.id = 'sceneCtl'; ctl.className = 'floating';
  ctl.innerHTML = `<div class="seg-switch"><button data-b="btn-cine">Kino</button><button data-b="btn-top">Lider</button><button data-b="btn-rot">Obrót</button></div>
    <div class="ctl-row"><label class="chk"><input type="checkbox" data-b="btn-diff"> trudność</label><label class="chk"><input type="checkbox" data-b="btn-trees" checked> las</label><label class="chk"><input type="checkbox" data-b="btn-fog" checked> pogoda</label><label class="chk" hidden><input type="checkbox" data-b="btn-ortho"> zdjęcie</label></div>
    <button class="full" data-b="btn-all">Cały obszar</button><button class="full" data-b="btn-game">Test na ślepo</button>`;
  document.body.appendChild(ctl);
  ctl.addEventListener('click', (e) => { const t = e.target.closest('[data-b]'); if (!t) return; $(t.dataset.b).click(); syncCtl(); });
  if ($('btn-diff').hidden) ctl.querySelector('[data-b="btn-diff"]').closest('label').hidden = true;
  const syncCtl = () => {
    ctl.querySelector('[data-b="btn-cine"]').classList.toggle('on', $('btn-cine').classList.contains('on'));
    ctl.querySelector('[data-b="btn-rot"]').classList.toggle('on', $('btn-rot').classList.contains('on'));
    for (const id of ['btn-diff', 'btn-trees', 'btn-fog', 'btn-ortho']) ctl.querySelector(`input[data-b="${id}"]`).checked = $(id).classList.contains('on');
    ctl.querySelector('input[data-b="btn-ortho"]').closest('label').hidden = $('btn-ortho').hidden; // shown once the aerial photo has loaded
  };
  setInterval(syncCtl, 1000); // Kino ends on its own; keep the box honest
}

// ---------- camera ----------
let fly = null;
function flyTo(target, dist = 3, dur = 1.6) {
  const dir = camera.position.clone().sub(controls.target).normalize();
  if (dir.y < 0.4) { dir.y = 0.5; dir.normalize(); }
  fly = { t: 0, dur, p0: camera.position.clone(), t0: controls.target.clone(), p1: target.clone().add(dir.multiplyScalar(dist)), t1: target.clone() };
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const bc = [(B.north + B.south) / 2, (B.east + B.west) / 2];
const center = new THREE.Vector3(toX(bc[1]), hAt(bc[0], bc[1]) * 0.6, toZ(bc[0]));
const SPAN = Math.max((B.east - B.west) * KX * KM, (B.north - B.south) * KM) * 1.15;
function overview(dur = 1.8) {
  // oblique view from the south-east, the whole massif in frame
  fly = { t: 0, dur, p0: camera.position.clone(), t0: controls.target.clone(), p1: center.clone().add(new THREE.Vector3(SPAN * 0.42, SPAN * 0.62, SPAN * 0.92)), t1: center.clone() };
}
$('btn-all').addEventListener('click', () => overview());
$('btn-top').addEventListener('click', () => {
  const s = G.phase === 'off' ? rankedOf(R.steps[STEP].segments)[0] : G.ranked[0];
  const g = segs.get(s.id); flyTo(v3(g.center[0], g.center[1]), 2.4);
});
let autoRot = false, idleAt = performance.now();
$('btn-rot').addEventListener('click', () => { autoRot = !autoRot; $('btn-rot').classList.toggle('on', autoRot); });
$('btn-fog').addEventListener('click', () => { weatherOn = !weatherOn; $('btn-fog').classList.toggle('on', weatherOn); setMood(R.steps[Math.max(0, STEP)].weather); });
controls.addEventListener('start', () => { idleAt = Infinity; fly = null; if (CINE.on) cinema(false); });
controls.addEventListener('end', () => { idleAt = performance.now(); });

if (!(Array.isArray(R.difficulty) && R.difficulty.length === R.rows * R.cols)) $('btn-diff').hidden = true;
$('btn-diff').addEventListener('click', () => {
  SHOW_DIFF = !SHOW_DIFF; $('btn-diff').classList.toggle('on', SHOW_DIFF); compose();
  const dc = $('btn-diff').querySelector('input'); if (dc) dc.checked = SHOW_DIFF;
  $('sceneLegend').innerHTML = SHOW_DIFF ? LEGEND_DIFF : LEGEND_HEAT;
});
$('btn-trees').addEventListener('click', () => { forest.visible = !forest.visible; $('btn-trees').classList.toggle('on', forest.visible); });

// ---------- cinematic mode: letterbox, subtitles, scripted shots through the timeline ----------
const CINE = { on: false, shot: null };
function shotTarget(i) {
  const e = EVENTS.find((x) => x.step === i);
  const a = e && (isFound(e) ? e.point : anchorOf(e));
  if (a && inside(a)) return v3(a[0], a[1]);
  const top = rankedOf(R.steps[i].segments)[0], g = segs.get(top.id);
  return v3(g.center[0], g.center[1]);
}
// keep the camera above the ground along its whole path (cinema shots fly low)
const aboveGround = (v, clear = 0.35) => { v.y = Math.max(v.y, hAt(toLat(v.z), toLon(v.x)) + clear); return v; };
function cineShot(i) {
  setStep(i);
  const s = R.steps[i], t = shotTarget(i), ang = i * 1.1 + 0.6, dist = s.kind === 'rings' || s.kind === 'route' ? 4.2 : s.kind === 'point' ? 1.4 : 2.4;
  const pos = t.clone().add(new THREE.Vector3(Math.cos(ang) * dist, dist * 0.42 + 0.25, Math.sin(ang) * dist));
  aboveGround(pos, 0.45);
  fly = { t: 0, dur: 2.6, p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: t };
  CINE.shot = { i, until: performance.now() + (s.kind === 'point' ? 9000 : 5200), ang, dist, t };
  $('caption').innerHTML = `<b>${esc(s.t)}</b> ${esc(s.label)}`;
}
function cinema(on) {
  CINE.on = on; document.body.classList.toggle('cinema', on); $('btn-cine').classList.toggle('on', on);
  toParent({ type: 'cinema', on }); // /app hides its floating panels while Kino runs
  if (on) { CINE.prevRot = autoRot; cineShot(Q.has('step') ? STEP : 0); }
  else { CINE.shot = null; overview(1.6); }
}
$('btn-cine').addEventListener('click', () => cinema(!CINE.on));
addEventListener('keydown', (e) => { if (e.key === 'Escape' && CINE.on) cinema(false); });
function cineTick(dt) {
  const sh = CINE.shot; if (!CINE.on || !sh || fly) return;
  // slow dolly around the subject between cuts
  sh.ang += dt * 0.09;
  const pos = sh.t.clone().add(new THREE.Vector3(Math.cos(sh.ang) * sh.dist, sh.dist * 0.42 + 0.25, Math.sin(sh.ang) * sh.dist));
  aboveGround(pos, 0.45);
  camera.position.lerp(pos, 1 - Math.exp(-dt * 2)); controls.target.lerp(sh.t, 1 - Math.exp(-dt * 2));
  camera.lookAt(controls.target);
  if (performance.now() > sh.until) {
    if (sh.i < R.steps.length - 1) cineShot(sh.i + 1);
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
cv.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
cv.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const h = pick(e); if (!h) return;
  if (G.phase === 'hide') return hideAt(toLat(h.point.z), toLon(h.point.x));
  const k = cellOf(toLat(h.point.z), toLon(h.point.x)); if (k < 0) return;
  if (G.phase === 'off') selectSeg(R.segOf[k], { fly: false });
  else if (G.phase === 'search') sendPatrol(R.segOf[k]); // the patrol goes to the clicked segment
});
cv.addEventListener('dblclick', (e) => { const h = pick(e); if (h && G.phase !== 'hide') flyTo(h.point, 2); });
function hover() {
  hoverPending = false; const e = lastEv, tip = $('tip'); if (!e) return;
  const hit = pick(e); if (!hit) { tip.hidden = true; return; }
  const lat = toLat(hit.point.z), lon = toLon(hit.point.x), k = cellOf(lat, lon);
  let html = G.phase === 'hide' ? '<div><b>Kliknij, aby tu ukryć zaginionego</b></div>' : '';
  html += `<div><b>${Math.round(elevM(lat, lon))} m n.p.m.</b></div>`;
  if (k >= 0) {
    const g = segs.get(R.segOf[k]), grid = G.phase === 'search' || G.phase === 'done' ? G.grid : R.steps[STEP].poaGrid;
    if (G.phase !== 'hide') html += `<div>${esc(g?.name || R.segOf[k])} · komórka 100 m: <b>${(grid[k] * 100).toFixed(2)}%</b></div>`;
    else html += `<div>${esc(g?.name || R.segOf[k])}</div>`;
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
  dyn.game.add(line, dot);
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
  G.phase = 'off'; G.auto = false; disposeGroup(dyn.game);
  $('game').hidden = true; $('btn-game').textContent = 'Test na ślepo';
  document.body.classList.remove('hiding', 'searching'); lockTimeline(false);
  const s = STEP; STEP = -1; setStep(s, false);
}
$('btn-game').addEventListener('click', startGame);

// ---------- live field reports ----------
const seenLive = new Set();
async function pollLive() {
  const ev = await getJSON(P.live, true);
  if (Array.isArray(ev)) for (const e of ev) {
    const key = e.t + '|' + e.text; if (seenLive.has(key)) continue; seenLive.add(key);
    toast(e);
    for (const h of e.hints || []) {
      const g = segs.get(h.segmentId), at = h.lat != null && h.lon != null ? [h.lat, h.lon] : g ? g.center : null; if (!at) continue;
      if (h.type === 'clue') dyn.live.add(pin(at[0], at[1], '#b8860b', 0.26, 'Ślad: ' + esc(h.description || ''), 'sig cur', 0.018));
      else if (h.type === 'segmentSearched' && g) drapeRuns(ringLL(g.polygon), 0.022, { color: '#b8860b', width: 2, opacity: 0.9 }, dyn.live);
    }
  }
  setTimeout(pollLive, 4000);
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
  const m = e.data; fromParent = true;
  try {
    if (m.type === 'step' && Number.isInteger(m.i)) setStep(m.i);
    else if (m.type === 'select' && typeof m.segmentId === 'string') selectSeg(m.segmentId);
    else if (m.type === 'insets' && Array.isArray(m.insets) && m.insets.length === 4) { INSETS = m.insets.map((v) => +v || 0); applyInsets(); }
    else if (m.type === 'evidence' && (typeof m.id === 'string' || Number.isInteger(m.id))) setEvidence(m.id, m.on !== false);
    else if (m.type === 'run' && m.run && typeof m.run === 'object') {
      sessionStorage.setItem('rescue3d-run', JSON.stringify(m.run));
      const u = new URL(location.href); u.searchParams.set('runInline', '1'); u.searchParams.delete('run'); location.replace(u);
    } else if (m.type === 'run' && typeof m.url === 'string') {
      const u = new URL(location.href); u.searchParams.set('run', m.url); u.searchParams.delete('runInline'); location.replace(u);
    }
  } finally { fromParent = false; }
});

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
const DPR_MAX = DPR_PIN ? +Q.get('dpr') : Math.min(devicePixelRatio, 1.5), DPR_MIN = DPR_AUTO ? Math.max(0.75, DPR_MAX * 0.6) : DPR_MAX;
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
  if (document.hidden || offscreen) { clock.getDelta(); return; }
  const dt = Math.min(clock.getDelta(), 0.1);
  if (heatT < 1) { heatT = Math.min(1, heatT + dt / 0.7); heatU.uHeatT.value = heatT; }
  heatU.uTime.value += dt;
  stepMood(dt);
  if (fly) {
    fly.t += dt / fly.dur; const k = ease(Math.min(1, fly.t));
    camera.position.lerpVectors(fly.p0, fly.p1, k); controls.target.lerpVectors(fly.t0, fly.t1, k);
    aboveGround(camera.position, 0.25);
    if (fly.t >= 1) { fly = null; idleAt = performance.now(); }
  }
  controls.autoRotate = autoRot && !fly && !CINE.on && performance.now() - idleAt > 4000;
  cineTick(dt);
  fitShadow(performance.now());
  if (!CINE.on || fly) controls.update();
  let oneShot = false;
  for (let i = movers.length - 1; i >= 0; i--) {
    const m = movers[i];
    if (m.once) { oneShot = true; m.t += dt / 1.1; m.dot.position.copy(m.curve.getPoint(Math.min(1, m.t))); if (m.t >= 1) { movers.splice(i, 1); m.done(); } }
    else { m.t = (m.t + dt * 0.15) % 1; m.dot.position.copy(m.curve.getPoint(m.t)); m.mat.dashOffset -= dt * 0.08; }
  }
  for (const m of flowMats) m.dashOffset -= dt * 0.05; // streams run downstream
  if (precip.visible) {
    const u = precipMat.uniforms; u.uCenter.value.copy(controls.target);
    u.uBox.value = clamp(camera.position.distanceTo(controls.target) * 0.9, 0.8, 8);
    u.uPx.value = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
  }
  flushLines();
  const moved = cameraMoved();
  const active = moved || fly || CINE.on || oneShot || heatT < 1 || controls.autoRotate || now - wakeAt < 600 || renderer.shadowMap.needsUpdate;
  if (!active && now - lastRender < 1000 / 31) return; // ambient only: 30 fps
  const interval = now - lastRender; lastRender = now;
  if (active) adaptResolution(now, interval);
  const c0 = performance.now();
  renderer.render(scene, camera);
  if (GPU_SYNC) renderer.getContext().finish(); // ?gpu=1: stats count the GPU time in "render" (diagnostic only)
  const c1 = performance.now();
  if (moved || labelsDirty || now - lastLabels > 1000) { labels.render(scene, camera); labelsDirty = false; lastLabels = now; nL++; }
  if (statsEl) {
    const c2 = performance.now();
    statN++; statT += interval; cpuR += c1 - c0; cpuL += c2 - c1; cpuF += c0 - now; statCalls = renderer.info.render.calls; statTris = renderer.info.render.triangles;
    if (now - statAt > 500) {
      statsEl.textContent = `${(1000 / (statT / statN)).toFixed(0)} fps  ${(statT / statN).toFixed(1)} ms\ncpu: update ${(cpuF / statN).toFixed(1)}  render ${(cpuR / statN).toFixed(1)}  labels ${(cpuL / statN).toFixed(1)} ms (${nL}/${statN})\n${statCalls} draw calls  ${(statTris / 1000).toFixed(0)}k tris\ndpr ${dpr} (${DPR_MIN}-${DPR_MAX})  ${active ? 'active' : 'idle 30'}`;
      statN = 0; statT = 0; cpuR = 0; cpuL = 0; cpuF = 0; nL = 0; statAt = now;
    }
  }
}

// ---------- start ----------
if (statsEl) window.__r3d = { THREE, camera, controls, v3, flyTo, setStep, TER }; // diagnostics only (?stats=1): frame shots from the console
setStep(Q.has('step') ? +Q.get('step') : R.value?.beforePing ?? 0, false);
for (let k = 0; k < 60; k++) stepMood(0.1);
camera.position.copy(center).add(new THREE.Vector3(SPAN * 0.2, SPAN * 2.2, SPAN * 1.6));
controls.target.copy(center);
overview(2.6);
renderer.shadowMap.needsUpdate = true;
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
