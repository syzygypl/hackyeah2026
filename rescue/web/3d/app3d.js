// Rescue Locator 3D - terrain diorama of the POA timeline, its source signals, and a blind test game.
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
import { colorFor, gradientCSS, STOPS } from '../../app/scale.js'; // shared heat scale (decision S2), same as 2D

// ---------- config ----------
const Q = new URLSearchParams(location.search);
const SCENS = {
  zawrat: { name: 'Zawrat', run: '../../out/run.json', demWide: 'data/zawrat-dem-wide.json' },
  'morskie-oko': { name: 'Morskie Oko', run: '../../out/morskie-oko.run.json' },
  kasprowy: { name: 'Kasprowy', run: '../../out/kasprowy.run.json' },
  'blind-01': { name: 'Test na ślepo: runda 1 (replay)', run: '../../out/blind-01-replay.run.json', scenario: '../../scenarios/blind-01-replay.json',
    terrain: '../../scenarios/blind-01-replay-terrain.json', dem: '../../tools/terrain/data/zawrat-dem.json', demWide: 'data/zawrat-dem-wide.json', reveal: '../../blindtest/blind-01.reveal.json' },
};
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
const PLAY_MS = Number(Q.get('playMs')) || 2600;
const KM = 111.32;
const KIND = { terrain: 'Teren', cost: 'Koszt terenu', difficulty: 'Trudność', conditions: 'Warunki', rings: 'Statystyka', route: 'Trasa', containment: 'Auto', sector: 'BTS', weather: 'Pogoda', searched: 'Przeszukano', point: 'Znaleziono', clue: 'Ślad' };
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
const pp = (x) => (x >= 0 ? '+' : '-') + nf(Math.abs(x * 100), 1) + ' pp';
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')} min` : `${Math.round(m)} min`);
const PRECIP = { none: 'bez opadu', rain: 'deszcz', snow: 'śnieg' };
// same task hints as the 2D ranking (rescue/web/app.js taskFor)
function taskFor(name) {
  const n = name.toLowerCase();
  if (n.includes('żleb') || n.includes('potok') || n.includes('roztok')) return 'Zespół + pies: zejście wzdłuż żlebu / cieku, sprawdzić progi';
  if (n.includes('szlak') || n.includes('droga')) return 'Zespół szybki: przejście szlakiem, nawoływanie, światło';
  if (n.includes('staw')) return 'Dron termowizyjny + obejście brzegu';
  if (n.includes('grań') || n.includes('perć') || n.includes('wierch') || n.includes('przełęcz')) return 'Zespół wspinaczkowy / śmigłowiec: ściany pod granią';
  if (n.includes('schronisko') || n.includes('hala') || n.includes('murowaniec')) return 'Sprawdzić schronisko, wypytać obsługę i turystów';
  return 'Zespół: przeszukanie segmentu wzdłuż linii terenu';
}
const DIFF_COLORS = ['#e6dfc8', '#9cc47a', '#3f7a3a', '#b8a78a', '#8f80a6', '#4b3f4a', '#4a8fd1']; // same as 2D
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const getJSON = async (u, optional) => {
  try { const r = await fetch(u, { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status + ' ' + u); return await r.json(); }
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
if (Q.get('embed') === '1' || Q.get('embed') === 'bare') document.body.classList.add('embed');
if (Q.get('embed') === 'bare') document.body.classList.add('embed-bare');
if (document.body.classList.contains('embed')) {
  // decision S1: embedded views use the shell's tokens (dark operational theme, light via ?theme=light)
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '../../app/tokens.css'; document.head.appendChild(l);
  if (Q.get('theme') === 'light' || Q.get('theme') === 'dark') document.documentElement.dataset.theme = Q.get('theme');
}
let R, SCN, TER, DEM, REV, DEM_FULL;
try {
  const wide = !Q.get('dem') && Q.get('wide') !== '0' && SCENS[SC].demWide;
  [R, SCN, TER, DEM, REV] = await Promise.all([inlineRun ? Promise.resolve(inlineRun) : getJSON(P.run, !!P.reveal), getJSON(P.scenario, true), getJSON(P.terrain, true),
    (wide ? getJSON(wide, true) : Promise.resolve(null)).then((d) => d || getJSON(P.dem)), P.reveal ? getJSON(P.reveal, true) : null]);
  DEM_FULL = DEM; // full-resolution DEM, kept for the terrain normal map
  if (DEM.cols > 600) DEM = decimate(DEM, 2); // wide backdrop: 2x2 average keeps the mesh ~100k vertices
  if (!R && SCN) R = synthRun(SCN); // replay without engine output: signals and patrols only, no POA map
  if (R.schema !== 'rescue-run/1') throw new Error('run.json: schema ' + R.schema);
} catch (e) {
  $('loadmsg').textContent = 'Nie udało się wczytać danych: ' + e.message + '. Uruchom serwer w katalogu rescue/ (python3 -m http.server 8000) i otwórz /web/3d/.';
  throw e;
}
$('incident').textContent = (R.incident || '') + (R.synthetic ? ' · brak run.json z silnika: bez mapy POA, segmenty przybliżone' : '');

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
const evByLabel = new Map(EVENTS.map((e) => [e.title, e]));
const resources = new Map((SCN?.resources || []).map((r) => [r.id, r]));
const isFound = (e) => e.found || e.provider === 'Found' || /ZNALEZIONO/i.test(e.title || '');
const foundEv = EVENTS.find((e) => isFound(e) && e.step >= 0);
const foundStep = foundEv ? foundEv.step : -1;
const foundAt = foundEv?.point || SCN?.truth?.at;
function influence(k) {
  if (k <= 0) return null;
  const prev = new Map(R.steps[k - 1].segments.map((s) => [s.id, s.poa]));
  let best = null;
  for (const s of R.steps[k].segments) { const d = s.poa - (prev.get(s.id) ?? 0); if (!best || d > best.d) best = { d, name: s.name }; }
  return best && best.d > 0.004 ? best : null;
}

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

// ---------- operation progress (from the timeline, nothing new is computed about the person) ----------
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const PROG = (() => {
  const t0 = toMin(R.steps[0].t), area = new Map(R.steps[0].segments.map((s) => [s.id, s.areaPct]));
  const seen = new Set(); let pos = 0, last = t0;
  return R.steps.map((s, k) => {
    let m = toMin(s.t); if (m < last - 600) m += 1440; last = m; // after midnight
    for (const e of EVENTS) if (e.step === k && e.segments?.length) {
      const prev = new Map(R.steps[Math.max(0, k - 1)].segments.map((x) => [x.id, x.poa]));
      for (const id of e.segments) { pos += (prev.get(id) || 0) * (e.pod ?? 0.7); seen.add(id); }
    }
    const lead = Math.max(...s.segments.map((x) => x.poa));
    return { k, min: m - t0, lead, pos: Math.min(pos, 1), area: [...seen].reduce((a, id) => a + (area.get(id) || 0), 0) / 100, searched: seen.size, teams: (s.assignments || []).length, found: EVENTS.some((e) => e.step === k && isFound(e)) };
  });
})();

// ---------- renderer / scene ----------
const host = $('scene');
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

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.46; controls.minDistance = 0.5; controls.maxDistance = 30;
controls.autoRotateSpeed = 0.3;

const lineMats = new Set();
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); labels.setSize(innerWidth, innerHeight);
  for (const m of lineMats) m.resolution.set(innerWidth, innerHeight);
});

// ---------- sky, lights ----------
const SUN_DIR = new THREE.Vector3(-0.72, 0.32, -0.38).normalize(); // low evening sun from the west
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() }, sunDir: { value: SUN_DIR }, sunCol: { value: new THREE.Color('#ffd9a0') }, sunAmt: { value: 1 } },
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunCol; uniform float sunAmt; varying vec3 vP;
    void main(){
      float h = clamp(vP.y*1.5+0.1,0.0,1.0);
      vec3 c = mix(bottom, top, pow(h,0.75));
      float d = max(dot(normalize(vP), sunDir), 0.0);
      c += sunCol * (pow(d, 900.0) * 6.0 + pow(d, 60.0) * 0.45 + pow(d, 6.0) * 0.18) * sunAmt;
      gl_FragColor = vec4(c, 1.0);
    }`,
});
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
    let c = mix3(lerpStops(VEG, e), lerpStops(ROCK, e), smooth(26, 42, slope));
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
const glowCanvas = document.createElement('canvas'); glowCanvas.width = TW; glowCanvas.height = TH;
const compTex = new THREE.CanvasTexture(compCanvas); compTex.colorSpace = THREE.SRGBColorSpace; compTex.anisotropy = 8;
const glowTex = new THREE.CanvasTexture(glowCanvas); glowTex.colorSpace = THREE.SRGBColorSpace;

const terrainGeo = new THREE.PlaneGeometry(WKM, HKM, DEM.cols - 1, DEM.rows - 1);
terrainGeo.rotateX(-Math.PI / 2);
{
  const pos = terrainGeo.attributes.position;
  for (let r = 0; r < DEM.rows; r++) for (let c = 0; c < DEM.cols; c++) pos.setY(r * DEM.cols + c, ((DEM.z[r][c] - zMin) * EX) / 1000);
  terrainGeo.computeVertexNormals();
}
// object-space normal map from the full-resolution DEM: the mesh is averaged 2x2 for the wide cut, the shading keeps every ridge
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
  return t;
})();
const terrainMat = new THREE.MeshStandardMaterial({ map: compTex, emissiveMap: glowTex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.96, metalness: 0,
  normalMap: normalTex, normalMapType: THREE.ObjectSpaceNormalMap });
const terrain = new THREE.Mesh(terrainGeo, terrainMat);
terrain.castShadow = true; terrain.receiveShadow = true;
scene.add(terrain);
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
  const g = compCanvas.getContext('2d'), gg = glowCanvas.getContext('2d');
  g.globalAlpha = 1; g.drawImage(baseCanvas, 0, 0);
  gg.globalAlpha = 1; gg.fillStyle = '#000'; gg.fillRect(0, 0, TW, TH);
  const draw = (cv, a) => {
    if (!cv || a <= 0) return;
    g.globalAlpha = a; g.drawImage(cv, heatRect.x, heatRect.y, heatRect.w, heatRect.h);
    gg.globalAlpha = a; gg.drawImage(cv, heatRect.x, heatRect.y, heatRect.w, heatRect.h);
  };
  if (SHOW_DIFF) draw(diffLayer(), 1); else { draw(heatFrom, 1 - heatT); draw(heatTo, heatT); }
  g.globalAlpha = 1; gg.globalAlpha = 1;
  // searched ground: cool grey wash with hatching, stronger for repeated searches
  for (const [id, n] of WASH) {
    const sg = segs.get(id); if (!sg?.polygon?.length) continue;
    g.beginPath(); sg.polygon.forEach(([lo, la], j) => { const [x, y] = llToTex(la, lo); j ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath();
    g.fillStyle = `rgba(214, 222, 232, ${Math.min(0.22 + 0.12 * (n - 1), 0.5)})`; g.fill();
    g.save(); g.clip(); g.strokeStyle = 'rgba(70, 84, 104, 0.35)'; g.lineWidth = 1.4;
    for (let x = -TH; x < TW; x += 9) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + TH, TH); g.stroke(); }
    g.restore();
  }
  compTex.needsUpdate = true; glowTex.needsUpdate = true;
}
let SHOW_DIFF = false, diffCanvas = null;
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
const showHeat = (cv, animate = true) => { heatFrom = animate ? heatTo : null; heatTo = cv; heatT = heatFrom ? 0 : 1; compose(); };

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
function drapeRuns(latlon, lift, opts, group) {
  let run = [];
  const flush = () => { if (run.length > 1) group.add(makeLine(run.map(([la, lo]) => v3(la, lo, lift)), opts)); run = []; };
  for (const p of densify(latlon)) { if (inside(p)) run.push(p); else flush(); }
  flush();
}
const ringLL = (poly) => poly.map(([lo, la]) => [la, lo]); // polygons are [lon, lat]
const circleLL = ([la, lo], rM, n = 96) => Array.from({ length: n + 1 }, (_, i) => {
  const a = (i / n) * Math.PI * 2; return [la + (Math.sin(a) * rM) / 1000 / KM, lo + (Math.cos(a) * rM) / 1000 / (KM * KX)];
});
function disposeGroup(g) {
  g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { lineMats.delete(o.material); o.material.dispose(); } if (o.isCSS2DObject) o.element.remove(); });
  g.clear();
}
function label(html, cls, pos) {
  const el = document.createElement('div'); el.className = 'lbl3d ' + (cls || ''); el.innerHTML = html;
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
for (const s of TER?.streams || []) drapeRuns(s.points, 0.008, { color: '#3a86c8', width: 1.3, opacity: 0.75 }, statics);
const waterMat = new THREE.MeshStandardMaterial({ color: 0x1f8fa6, emissive: 0x06303a, roughness: 0.12, metalness: 0.25 });
for (const l of TER?.lakes || []) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(l.radiusM / 1000, 48).rotateX(-Math.PI / 2), waterMat);
  m.position.copy(v3(l.center[0], l.center[1], 0.005)); statics.add(m);
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
  const tries = Q.has('trees') ? +Q.get('trees') : Math.round(clamp(WKM * HKM * 2000, 40000, 140000));
  for (let n = 0; n < tries; n++) {
    const la = latS + rnd() * (latN - latS), lo = lonW + rnd() * (lonE - lonW), e = elevM(la, lo);
    const dz = Math.hypot(elevM(la, lo + 0.0004) - elevM(la, lo - 0.0004), elevM(la + 0.0003, lo) - elevM(la - 0.0003, lo)) / 2 / 33;
    const slope = (Math.atan(dz) * 180) / Math.PI;
    if (slope > 38 || inLake(la, lo)) continue;
    const nz = noise(toX(lo) * 2.2 + 50, toZ(la) * 2.2 + 50);
    if (e < 1520 && nz > 0.32 - (1520 - e) / 2500 && rnd() < 0.9) spruce.push([la, lo, e]);
    else if (e >= 1450 && e < 1850 && nz > 0.45 && rnd() < 0.55) pine.push([la, lo, e]);
  }
  const place = (list, geo, mat, hMin, hMax, colA, colB) => {
    const m = new THREE.InstancedMesh(geo, mat, list.length), o = new THREE.Object3D(), c = new THREE.Color(), A = new THREE.Color(colA), Bc = new THREE.Color(colB);
    list.forEach(([la, lo], i) => {
      const h = hMin + rnd() * (hMax - hMin);
      o.position.copy(v3(la, lo, -0.002)); o.rotation.set(0, rnd() * 6.28, 0); o.scale.set(h * (0.85 + rnd() * 0.3), h, h * (0.85 + rnd() * 0.3)); o.updateMatrix();
      m.setMatrixAt(i, o.matrix); m.setColorAt(i, c.copy(A).lerp(Bc, rnd()));
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
const cur = { top: new THREE.Color('#86aacb'), bottom: new THREE.Color('#e6ebe8'), fog: new THREE.Color('#dde3e4'), sun: new THREE.Color('#fff'), hs: new THREE.Color('#fff'), hg: new THREE.Color('#666'), sunI: 2.6, hI: 1, stars: 0, emis: 0, exp: 1, near: 12, far: 60 };
let tgt = { ...cur }, weatherOn = true;
function setMood(w) {
  const vis = w?.visibilityM ?? 10000, dark = !!w?.dark && weatherOn;
  const m = dark ? MOODS.night : weatherOn && vis < 500 ? MOODS.fog : MOODS.day;
  tgt = {
    top: new THREE.Color(m.top), bottom: new THREE.Color(m.bottom), fog: new THREE.Color(m.fog), sun: new THREE.Color(m.sun), hs: new THREE.Color(m.hs), hg: new THREE.Color(m.hg),
    sunI: m.sunI, hI: m.hI, stars: m.stars * (vis >= 500 ? 1 : 0.1), emis: m.emis, exp: m.exp,
    near: !weatherOn ? 9 : vis <= 100 ? 5 : vis < 500 ? 6 : 9, far: !weatherOn ? 40 : vis <= 100 ? 22 : vis < 500 ? 28 : 40,
  };
}
function stepMood(dt) {
  const k = 1 - Math.exp(-dt * 1.8);
  for (const c of ['top', 'bottom', 'fog', 'sun', 'hs', 'hg']) cur[c].lerp(tgt[c], k);
  for (const n of ['sunI', 'hI', 'stars', 'emis', 'exp', 'near', 'far']) cur[n] += (tgt[n] - cur[n]) * k;
  skyMat.uniforms.top.value.copy(cur.top); skyMat.uniforms.bottom.value.copy(cur.bottom);
  scene.fog.color.copy(cur.fog); scene.fog.near = cur.near; scene.fog.far = cur.far;
  sun.color.copy(cur.sun); sun.intensity = cur.sunI; hemi.color.copy(cur.hs); hemi.groundColor.copy(cur.hg); hemi.intensity = cur.hI;
  starMat.opacity = cur.stars; terrainMat.emissiveIntensity = cur.emis; renderer.toneMappingExposure = cur.exp;
  skyMat.uniforms.sunCol.value.copy(cur.sun); skyMat.uniforms.sunAmt.value = clamp(1.4 - cur.stars * 1.6, 0.15, 1.2) * (cur.near < 7 ? 0.45 : 1);
}

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
function renderSignals(i) {
  const list = $('signals');
  if (!EVENTS.length) { list.innerHTML = R.steps.map((s, k) => `<li class="${k > i ? 'future' : k === i ? 'cur' : ''}" data-step="${k}"><span class="ic" style="background:#6b6f72">${k + 1}</span><div><div class="tt">${esc(s.label)}</div><div class="meta"><span class="t">${s.t}</span>${esc(s.source || '')}</div></div></li>`).join(''); return; }
  list.innerHTML = EVENTS.map((e, k) => {
    const [badge, col, name] = sigOf(e), inf = e.step >= 0 ? influence(e.step) : null;
    const cls = e.step < 0 || e.step > i ? 'future' : e.step === i ? 'cur' : '';
    const ctl = e.step >= 0 ? `<div class="use"><label><input type="checkbox" data-off="${e.step}" ${OFF.has(e.step) ? '' : 'checked'}> uwzględnij</label><button class="lnk" data-go="${Math.max(0, e.step - 1)}">Przed</button><button class="lnk" data-go="${e.step}">Po</button></div>` : '';
    return `<li class="${cls}${OFF.has(e.step) ? ' off' : ''}" data-ev="${k}"><span class="ic" style="background:${col}">${esc(badge)}</span><div><div class="tt">${esc(e.title)}</div><div class="meta"><span class="t">${esc(e.at)}</span>${esc(name)}${e.wave ? ` · fala ${e.wave}` : ''}${e.pod ? ` · POD ${Math.round(e.pod * 100)}%` : ''}${e.step < 0 ? ' · poza osią czasu' : ''}</div>${inf ? `<div class="inf">wpływ: ${esc(inf.name)} ${pp(inf.d)}</div>` : ''}${ctl}</div></li>`;
  }).join('');
  list.querySelector('li.cur')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
$('signals').addEventListener('click', (ev) => {
  if (G.phase !== 'off') return;
  const cb = ev.target.closest('input[data-off]');
  if (cb) { const k = +cb.dataset.off; if (cb.checked) OFF.delete(k); else OFF.add(k); const cur = STEP; STEP = -1; setStep(cur, false); ev.stopPropagation(); return; }
  if (ev.target.closest('label')) return; // label click is forwarded to the checkbox
  const go = ev.target.closest('[data-go]');
  if (go) { stopPlay(); setStep(+go.dataset.go); return; }
  const li = ev.target.closest('li'); if (!li) return;
  if (li.dataset.step) { stopPlay(); setStep(+li.dataset.step); return; }
  const e = EVENTS[+li.dataset.ev]; if (e.step >= 0) { stopPlay(); setStep(e.step); }
  const a = anchorOf(e) || e.point; if (a && inside(a)) flyTo(v3(a[0], a[1]), e.points?.length > 20 ? 4.2 : 2.6);
});

// ---------- step state ----------
let STEP = -1;
const searchedUpTo = (i) => { const s = new Set(); EVENTS.forEach((e) => { if (e.step >= 0 && e.step <= i && !OFF.has(e.step)) (e.segments || []).forEach((id) => s.add(id)); }); return s; };
function renderOffBanner(i) {
  const off = [...OFF].filter((k) => k <= i).sort((a, b) => a - b), el = $('offbanner');
  el.hidden = !off.length;
  if (!off.length) return;
  const short = (t) => (t.length > 34 ? t.slice(0, 33) + '…' : t);
  el.innerHTML = `Widok przeliczony w przeglądarce bez: ${off.map((k) => `<b>${esc(short(R.steps[k].label))}</b>`).join(', ')} <button class="btn sm" id="resetoff">Przywróć</button>`;
  $('resetoff').onclick = () => { OFF.clear(); const k = STEP; STEP = -1; setStep(k, false); };
  $('rank-scope').textContent = `Przeliczony w przeglądarce bez ${off.length} ${off.length === 1 ? 'sygnału' : 'sygnałów'} (silnik: krok ${i + 1})`;
}
const rankedOf = (segments) => [...segments].sort((a, b) => b.poa - a.poa);
function drawTop(ranked) {
  disposeGroup(dyn.top);
  if (R.synthetic && G.phase === 'off') return;
  ranked.slice(0, 3).forEach((sg, k) => {
    const g = segs.get(sg.id); if (!g) return;
    drapeRuns(ringLL(g.polygon), 0.02, { color: k === 0 ? '#b8322a' : '#2b2f33', width: k === 0 ? 3.2 : 2, opacity: k === 0 ? 1 : 0.75 }, dyn.top);
    dyn.top.add(label(`<span>${esc(sg.name)}</span><span class="p">${pct(sg.poa)}</span>`, k === 0 ? 'rank1' : '', v3(g.center[0], g.center[1], 0.14)));
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
  setMood(s.weather);
  renderUI(i, ranked, searched, prev);
  renderSignals(i);
  renderOffBanner(i);
  if (SEL) document.querySelectorAll('#ranklist li').forEach((li) => li.classList.toggle('sel', li.dataset.seg === SEL));
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

// ---------- UI ----------
function renderUI(i, ranked, searched, prev) {
  const s = R.steps[i];
  $('sc-clock').textContent = s.t;
  const kind = $('sc-kind'); kind.className = 'kind k-' + s.kind; kind.textContent = KIND[s.kind] || s.kind;
  $('sc-label').textContent = s.label;
  const lead = ranked[0];
  let html = `Najbardziej prawdopodobne: <b>${esc(lead.name)}</b> <span class="pct">${pct(lead.poa)}</span>`;
  if (prev >= 0 && prev !== i) { const pl = rankedOf(R.steps[prev].segments)[0]; if (pl.id !== lead.id) html += `<br>Zmiana lidera (było: ${esc(pl.name)})`; }
  const fSeg = R.value?.findSeg ?? R.value?.truthSeg;
  if (foundStep >= 0 && i >= foundStep && fSeg) {
    const rank = rankedOf(R.steps[Math.max(0, foundStep - 1)].segments).findIndex((x) => x.id === fSeg) + 1;
    html += `<br>Znaleziony w: <b>${esc(R.value.findSegName || segs.get(fSeg)?.name || fSeg)}</b>${rank ? ` (#${rank} w rankingu tuż przed)` : ''}`;
  }
  // "Zmiana": the three biggest segment moves against the previous step, as in 2D
  if (i > 0) {
    const pm = new Map(R.steps[i - 1].segments.map((x) => [x.id, x.poa]));
    const mv = s.segments.map((x) => ({ id: x.id, d: x.poa - (pm.get(x.id) || 0) })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3).filter((x) => Math.abs(x.d) >= 0.001);
    if (mv.length) html += `<div class="sc-effect">Zmiana: ${mv.map((x) => `<span class="${x.d >= 0 ? 'up' : 'down'}">${esc(x.id)} ${pp(x.d)}</span>`).join(' ')}</div>`;
  }
  if (REV && i >= (foundStep >= 0 ? foundStep : R.steps.length - 1)) html += `<br><br><b>Odsłonięcie (${esc(REV.round)}):</b> ${esc(REV.story || '')}${REV.state ? ` <i>(${esc(REV.state)})</i>` : ''}`;
  if (R.synthetic) html = `<span class="pct">Brak run.json z silnika</span>: mapa POA pojawi się, gdy plik trafi do repo.<br>` + html.replace(/^Najbardziej[^<]*<b>[^<]*<\/b> <span class="pct">[^<]*<\/span>/, '');
  $('sc-lead').innerHTML = html;
  const w = s.weather || {}, chips = [];
  if (w.visibilityM != null) chips.push([`widoczność ${w.visibilityM >= 1000 ? (w.visibilityM / 1000).toFixed(1) + ' km' : w.visibilityM + ' m'}`, w.visibilityM < 200 ? 'warn' : '']);
  if (w.windMs != null) chips.push([`wiatr ${w.windMs} m/s`, w.windMs >= 12 ? 'warn' : '']);
  if (w.tempC != null) chips.push([`${w.tempC > 0 ? '+' : ''}${w.tempC}°C`, '']);
  if (w.precip && w.precip !== 'none') chips.push([PRECIP[w.precip] || w.precip, '']);
  if (w.dark) chips.push(['ciemno', 'night']);
  if (w.ice) chips.push(['oblodzenie', 'warn']);
  const sv = w.survival || {};
  if (sv.level) chips.push([`hipotermia: ${sv.level}`, 'surv lv-' + String(sv.level).replace(/[^a-ząćęłńóśźż]/gi, ''), sv.text]);
  $('weather').innerHTML = chips.map(([t, c, title]) => `<span class="wchip ${c}"${title ? ` title="${esc(title)}"` : ''}>${esc(t)}</span>`).join('');
  const n = s.hintsActive?.length || i + 1;
  renderRanking(ranked, searched, foundStep >= 0 && i >= foundStep ? (R.value?.findSeg ?? R.value?.truthSeg) : null, `Łącznie ${n} ${n === 1 ? 'sygnał' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'sygnały' : 'sygnałów'} do ${s.t}, nie tylko ostatni`);
  renderPlan(s);
  $('slider').value = i;
  $('stepno').innerHTML = `<b>${i + 1}</b>/${R.steps.length}`; $('prev').disabled = i === 0; $('next').disabled = i === R.steps.length - 1;
  renderValue();
  document.querySelectorAll('.tick').forEach((t, k) => { t.classList.toggle('cur', k === i); t.classList.toggle('past', k < i); });
  renderProgress(i);
  const l2 = document.querySelector('a.pill.link'); if (l2) l2.href = `../?sc=${encodeURIComponent(SC)}&step=${i}`;
}
function renderProgress(i) {
  const P = PROG, cur = P[i], W = 300, H = 74, maxMin = Math.max(1, P[P.length - 1].min);
  const X = (m) => 6 + (m / maxMin) * (W - 12), Y = (v) => H - 6 - v * (H - 14);
  const path = (f, upto = P.length - 1) => P.slice(0, upto + 1).map((p, k) => `${k ? 'L' : 'M'}${X(p.min).toFixed(1)},${Y(f(p)).toFixed(1)}`).join('');
  const ghost = (f, c) => `<path d="${path(f)}" fill="none" stroke="${c}" stroke-width="1.2" opacity="0.25"/>`;
  const live = (f, c) => `<path d="${path(f, i)}" fill="none" stroke="${c}" stroke-width="2.2"/>`;
  const evdots = P.filter((p) => EVENTS.some((e) => e.step === p.k)).map((p) => `<circle cx="${X(p.min)}" cy="${H - 3}" r="${p.found ? 3.5 : 1.8}" fill="${p.found ? '#2d6a4f' : p.k <= i ? '#555b61' : '#c8c8c8'}"/>`).join('');
  const hh = Math.floor(cur.min / 60), mm = String(cur.min % 60).padStart(2, '0');
  $('progress').innerHTML = `<div class="pg-head"><b>Przebieg akcji</b><span>${hh} h ${mm} min od zgłoszenia</span></div>
    <div class="pg-kpi"><div><b>${cur.searched}</b><span>segm. przeszukane</span></div><div><b>${(cur.area * 100).toFixed(0)}%</b><span>obszaru</span></div><div><b style="color:#1f4e79">${(cur.pos * 100).toFixed(0)}%</b><span>szansa znalezienia dotąd</span></div><div><b style="color:#b8322a">${pct(cur.lead)}</b><span>lider mapy</span></div></div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" aria-label="Wykres przebiegu akcji">
      ${ghost((p) => p.lead, '#b8322a')}${ghost((p) => p.pos, '#1f4e79')}${ghost((p) => p.area, '#6b6f72')}
      ${live((p) => p.area, '#6b6f72')}${live((p) => p.pos, '#1f4e79')}${live((p) => p.lead, '#b8322a')}
      <line x1="${X(cur.min)}" x2="${X(cur.min)}" y1="4" y2="${H - 6}" stroke="#23272a" stroke-dasharray="2 2" opacity="0.5"/>${evdots}
    </svg>
    <div class="pg-leg"><i style="background:#b8322a"></i>lider mapy <i style="background:#1f4e79"></i>szansa znalezienia (Σ POA×POD) <i style="background:#6b6f72"></i>przeszukany obszar</div>`;
}
function renderPlan(s) {
  const res = new Map((s.resources || []).map((r) => [r.id, r]));
  const items = (s.assignments || []).map((a) => {
    const r = res.get(a.resourceId) || resources.get(a.resourceId) || { name: a.resourceId }, t = r.type || resources.get(a.resourceId)?.type;
    return `<li data-seg="${esc(a.segmentId)}"><div class="as-h"><span class="dot" style="background:${TEAM_COL[t] || '#555'}"></span><span>${esc(String(r.name).split(' (')[0])} → <b>${esc(a.segmentId)}</b> ${esc(a.segmentName || '')}</span></div>
      <div class="as-m">ETA <b>${fmtMin(a.etaMin)}</b> · szansa znalezienia <b>${pct(a.expectedFind, 1)}</b> · POD ${pct(a.pod)}</div>
      ${a.reason ? `<div class="as-r">${esc(a.reason)}</div>` : ''}${(a.safety || []).map((x) => `<div class="as-safe">${esc(x)}</div>`).join('')}</li>`;
  }).join('');
  const down = (s.resources || []).filter((r) => r.available === false).map((r) => `<li class="down"><span>${esc(r.name)}</span> - ${esc(r.reason || 'niedostępny')}</li>`).join('');
  $('teams').innerHTML = (items || '<li class="none">Brak dostępnych zespołów w tym kroku.</li>') + down;
}
function renderValue() {
  const v = R.value, el = $('value'); if (!el) return;
  if (!v || v.top3poa == null) { el.hidden = true; return; }
  const at = R.steps[v.beforePing] || R.steps[R.steps.length - 1], seg = v.truthSeg ?? v.findSeg;
  el.hidden = false;
  el.innerHTML = `<h2>Wartość <span class="mode">silnik, ${esc(at.t)}</span></h2>
    <div class="v-big">${pct(v.top3poa, 0)} <span>prawdopodobieństwa w <b>${pct(v.top3area, 0)}</b> obszaru (top 3)</span></div>
    ${v.rankFused != null ? `<div class="v-row"><b class="ok">#${v.rankFused}</b> vs <b>#${v.rankRings}</b> <span>miejsce odnalezienia (${esc(seg)}): po fuzji vs same pierścienie Koestera</span></div>` : ''}
    ${v.areaFused != null ? `<div class="v-row"><b class="ok">${pct(v.areaFused, 1)}</b> vs <b>${pct(v.areaRings, 1)}</b> <span>obszaru do przeszukania, zanim zespół trafi</span></div>` : ''}
    ${v.pos2hPlanned != null && v.pos2hNaive != null ? `<div class="v-row"><b class="ok">${pct(v.pos2hPlanned, 0)}</b> vs <b>${pct(v.pos2hNaive, 0)}</b> <span>szansa znalezienia w 2 h: przydział silnika vs „największe POA najpierw”</span></div>` : ''}
    <button class="btn sm" id="gobp">Pokaż krok ${esc(at.t)}</button>`;
  $('gobp').onclick = () => { stopPlay(); setStep(v.beforePing); };
}
function renderRanking(ranked, searched, foundSeg, scope) {
  $('rank-scope').textContent = R.synthetic && G.phase === 'off' ? '\u00a0' : scope;
  if (R.synthetic && G.phase === 'off') { $('ranklist').innerHTML = '<li class="none" style="cursor:default;color:var(--mute);font-size:12.5px">Ranking pojawi się z plikiem run.json silnika.</li>'; return; }
  const mx = ranked[0].poa || 1;
  $('ranklist').innerHTML = ranked.slice(0, 8).map((sg) => {
    const cls = [searched.has(sg.id) ? 'searched' : '', sg.id === foundSeg ? 'found' : ''].join(' ');
    const k = ranked.indexOf(sg), area = sg.areaPct ?? segs.get(sg.id)?.areaPct;
    return `<li class="${cls}" data-seg="${sg.id}"><div class="row"><span class="nm"><i>${sg.id}</i>${esc(sg.name)}</span><span class="pv">${pct(sg.poa)}</span></div><div class="bar"><i style="width:${(sg.poa / mx) * 100}%"></i></div><div class="meta">${area != null ? `${nf(area, 1)}% obszaru` : ''}</div>${k < 3 && G.phase === 'off' ? `<div class="task">${esc(taskFor(sg.name))}</div>` : ''}<div class="act">Wyślij tu patrol</div></li>`;
  }).join('');
}
$('ranklist').addEventListener('click', (e) => {
  const li = e.target.closest('li'); if (!li) return;
  if (G.phase === 'search') return sendPatrol(li.dataset.seg);
  selectSeg(li.dataset.seg);
});

function buildTimeline() {
  const n = R.steps.length, el = $('ticks');
  $('slider').max = n - 1;
  el.innerHTML = R.steps.map((s, k) => `<div class="tick k-${s.kind}${k === 0 || s.t !== R.steps[k - 1].t ? ' lbl' : ''}" style="left:${n > 1 ? (k / (n - 1)) * 100 : 50}%" title="${esc(s.t + ' · ' + s.label)}"><b></b><span>${s.t}</span></div>`).join('');
  el.querySelectorAll('.tick').forEach((t, k) => t.addEventListener('click', () => { stopPlay(); setStep(k); }));
  $('slider').addEventListener('input', (e) => { stopPlay(); setStep(+e.target.value); });
}
let playTimer = null;
const stopPlay = () => { clearInterval(playTimer); playTimer = null; $('play').classList.remove('on'); };
function togglePlay() {
  if (G.phase !== 'off') return;
  if (playTimer) return stopPlay();
  if (STEP >= R.steps.length - 1) setStep(0);
  $('play').classList.add('on');
  playTimer = setInterval(() => { if (STEP >= R.steps.length - 1) return stopPlay(); setStep(STEP + 1); }, PLAY_MS);
}
$('play').addEventListener('click', togglePlay);
$('prev').addEventListener('click', () => { stopPlay(); setStep(STEP - 1); });
$('next').addEventListener('click', () => { stopPlay(); setStep(STEP + 1); });
addEventListener('keydown', (e) => {
  if (e.target.closest('select,input') || G.phase !== 'off') return;
  if (e.key === 'ArrowRight') { stopPlay(); setStep(STEP + 1); }
  else if (e.key === 'ArrowLeft') { stopPlay(); setStep(STEP - 1); }
  else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'Home') { stopPlay(); setStep(0); }
  else if (e.key === 'End') { stopPlay(); setStep(R.steps.length - 1); }
});
(async () => {
  const sel = $('scensel');
  for (const [id, s] of Object.entries(SCENS)) {
    const o = document.createElement('option'); o.value = id; o.textContent = s.name; o.selected = id === SC;
    if (id !== SC) { try { const r = await fetch(s.run, { method: 'HEAD' }); if (!r.ok) throw 0; } catch { o.disabled = true; o.textContent += ' (brak run.json)'; } }
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => { const u = new URL(location.href); u.searchParams.set('sc', sel.value); u.searchParams.delete('run'); location.href = u.toString(); });
})();

// ---------- legend (shared scale) ----------
const LEGEND_HEAT = `<span>Prawdopodobieństwo × średnia komórka</span><i class="ramp" style="background:${gradientCSS()}"></i><span class="stops">${STOPS.map((x) => `<b>${x.label}</b>`).join('')}</span>`;
document.querySelector('.legend').innerHTML = LEGEND_HEAT;

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
  document.querySelector('.legend').innerHTML = SHOW_DIFF
    ? `<span>Trudność terenu (silnik)</span><div class="lg-diff">${(R.difficultyClasses || []).map((c) => `<span><i style="background:${DIFF_COLORS[c.id] || '#000'}"></i>${esc(c.label)}</span>`).join('')}</div>`
    : LEGEND_HEAT;
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
  if (on) { stopPlay(); CINE.prevRot = autoRot; cineShot(Q.has('step') ? STEP : 0); }
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
const pick = (e) => { mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(mouse, camera); return ray.intersectObject(terrain)[0]; };
const cv = renderer.domElement;
cv.addEventListener('pointermove', (e) => { lastEv = e; if (!hoverPending) { hoverPending = true; requestAnimationFrame(hover); } });
cv.addEventListener('pointerleave', () => { $('tip').hidden = true; });
cv.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
cv.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const h = pick(e); if (!h) return;
  if (G.phase === 'hide') return hideAt(toLat(h.point.z), toLon(h.point.x));
  const k = cellOf(toLat(h.point.z), toLon(h.point.x)); if (k >= 0 && G.phase === 'off') selectSeg(R.segOf[k], { fly: false });
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
function lockTimeline(on) {
  stopPlay(); $('play').disabled = on; $('slider').disabled = on;
  document.body.classList.toggle('searching', on && G.phase === 'search');
}
function startGame() {
  if (G.phase !== 'off') return endGame();
  const base = Q.has('blindStep') ? +Q.get('blindStep') : R.value?.beforePing ?? STEP;
  if (STEP !== base) setStep(base);
  Object.assign(G, { phase: 'hide', base, target: null, salt: null, key: null, commit: null, patrols: [], attempts: new Map(), searched: new Set(), found: false });
  disposeGroup(dyn.teams); movers.length = 0; if (foundPin) foundPin.visible = false; if (revealPin) revealPin.visible = false;
  $('teams').innerHTML = '<li class="none">W teście patrole wysyłasz Ty (z IPP), POD ' + (R.steps[base].weather?.dark ? '60' : '75') + '%.</li>';
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
  renderRanking(G.ranked, G.searched, G.found ? G.seg : null, `Mapa z ${R.steps[G.base].t} po ${G.patrols.length} ${G.patrols.length === 1 ? 'patrolu' : 'patrolach'} w teście`);
  disposeGroup(dyn.searched);
  for (const id of G.searched) { const g = segs.get(id); if (g) drapeRuns(ringLL(g.polygon), 0.018, { color: '#555b61', width: 1.8, opacity: 0.9, dashed: true, dash: 0.035, gap: 0.03 }, dyn.searched); }
  const area = [...G.searched].reduce((a, id) => a + (segs.get(id)?.areaPct || 0), 0);
  const clock = addMin(R.steps[G.base].t, G.patrols.length * PATROL_MIN);
  const stats = `<div class="stats"><div class="stat"><b>${G.patrols.length}</b><span>patroli</span></div><div class="stat"><b>${area.toFixed(1)}%</b><span>obszaru przeszukane</span></div><div class="stat"><b>${clock}</b><span>czas akcji</span></div></div>`;
  const log = G.patrols.length ? `<ol>${G.patrols.map((p) => `<li>${esc(p.name)}: ${p.found ? '<b>ZNALEZIONO</b>' : 'nic'} (POD ${Math.round(p.pod * 100)}%)</li>`).join('')}</ol>` : '';
  if (G.phase === 'search') {
    gamePanel(`<h3>Szukaj</h3>
      <p>Zobowiązanie (SHA-256 miejsca i soli): <code>${G.commit.slice(0, 24)}…</code></p>
      <p>Wyślij patrol do lidera albo kliknij segment w rankingu. Puste przeszukanie obniża prawdopodobieństwo segmentu (POA × (1 − POD)) i mapa się przelicza.</p>
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
const liveList = [];
function renderLive() {
  const el = $('live'); if (!el) return;
  el.hidden = !liveList.length;
  el.innerHTML = `<h2>Meldunki z terenu <span class="mode">${liveList.length}</span></h2><ol>${liveList.slice().reverse().map((e) => {
    const kinds = (e.hints || []).map((h) => (h.type === 'clue' ? 'ślad' : h.type === 'segmentSearched' ? 'przeszukany ' + (h.segmentId || '') : h.type)).join(', ');
    return `<li><span class="t">${esc(e.at || '')}</span> ${esc(e.text)}<div class="meta">${esc(kinds || 'bez wskazówek')} · ${esc(e.parsedBy || '')}${e.latencyMs != null ? ` · ${e.latencyMs} ms` : ''} · <b>${R.steps.some((s) => s.label === e.text) ? 'w silniku' : 'czeka na przeliczenie'}</b></div></li>`;
  }).join('')}</ol>`;
}
function toast(e) {
  liveList.push(e); renderLive();
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
  document.querySelectorAll('#ranklist li').forEach((li) => li.classList.toggle('sel', li.dataset.seg === id));
  if (doFly) flyTo(v3(g.center[0], g.center[1]), 2.4);
  if (notify && !fromParent) toParent({ type: 'select', segmentId: id });
}
dyn.sel = new THREE.Group(); scene.add(dyn.sel);
addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.source !== window.parent || !e.data || typeof e.data !== 'object') return;
  const m = e.data; fromParent = true;
  try {
    if (m.type === 'step' && Number.isInteger(m.i)) { stopPlay(); setStep(m.i); }
    else if (m.type === 'select' && typeof m.segmentId === 'string') selectSeg(m.segmentId);
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
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (heatT < 1) { heatT = Math.min(1, heatT + dt / 0.7); compose(); }
  stepMood(dt);
  if (fly) {
    fly.t += dt / fly.dur; const k = ease(Math.min(1, fly.t));
    camera.position.lerpVectors(fly.p0, fly.p1, k); controls.target.lerpVectors(fly.t0, fly.t1, k);
    aboveGround(camera.position, 0.25);
    if (fly.t >= 1) { fly = null; idleAt = performance.now(); }
  }
  controls.autoRotate = autoRot && !fly && !CINE.on && performance.now() - idleAt > 4000;
  cineTick(dt);
  if (!CINE.on || fly) controls.update();
  for (let i = movers.length - 1; i >= 0; i--) {
    const m = movers[i];
    if (m.once) { m.t += dt / 1.1; m.dot.position.copy(m.curve.getPoint(Math.min(1, m.t))); if (m.t >= 1) { movers.splice(i, 1); m.done(); } }
    else { m.t = (m.t + dt * 0.15) % 1; m.dot.position.copy(m.curve.getPoint(m.t)); m.mat.dashOffset -= dt * 0.08; }
  }
  renderer.render(scene, camera);
  labels.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- start ----------
buildTimeline();
setStep(Q.has('step') ? +Q.get('step') : R.value?.beforePing ?? 0, false);
for (let k = 0; k < 60; k++) stepMood(0.1);
camera.position.copy(center).add(new THREE.Vector3(SPAN * 0.2, SPAN * 2.2, SPAN * 1.6));
controls.target.copy(center);
overview(2.6);
renderer.shadowMap.needsUpdate = true;
frame();
pollLive();
document.body.dataset.state = 'ready';
toParent({ type: 'ready', scenario: SC, steps: R.steps.length, step: STEP });
