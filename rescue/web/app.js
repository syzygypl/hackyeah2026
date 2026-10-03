/* Rescue Locator - web screen for out/run.json (schema rescue-run/1).
   Static, no build. MapLibre GL JS + pmtiles are vendored in vendor/.
   Fully offline by default: optional local basemap (basemap/style.json),
   otherwise an offline relief made from the scenario terrain + DEM, otherwise a flat background.
   Online raster tiles only with ?tiles=online. If WebGL / MapLibre is unavailable, a Canvas 2D view is used. */
'use strict';
(function () {
  const $ = (s) => document.querySelector(s);
  const Q = new URLSearchParams(location.search);
  // ?pin= is NOT supported (it would land in browser history): PIN is typed into the page, kept in localStorage.
  if (Q.has('pin')) { Q.delete('pin'); try { history.replaceState(null, '', location.pathname + (Q.toString() ? '?' + Q : '') + location.hash); } catch (e) { /* ignore */ } }
  // Scenarios the screen can switch between (header). run.json files are produced by
  // `cd rescue && swift run rescue-demo --fast scenarios/<name>.json`; missing ones are greyed out.
  // The offline basemap (basemap/) only covers the Zawrat bbox; other scenarios use the DEM relief.
  const SCENARIOS = [
    { id: 'zawrat', label: 'Zawrat', run: '../out/run.json', scenario: '../scenarios/zawrat.json', dem: '../tools/terrain/data/zawrat-dem.json', basemap: true },
    { id: 'morskie-oko', label: 'Morskie Oko', run: '../out/morskie-oko.run.json', scenario: '../scenarios/morskie-oko.json', dem: '../tools/terrain/data/morskie-oko-dem.json', basemap: false },
    { id: 'kasprowy', label: 'Kasprowy', run: '../out/kasprowy.run.json', scenario: '../scenarios/kasprowy.json', dem: '../tools/terrain/data/kasprowy-dem.json', basemap: false },
    // blind tests replayed with the hidden answer revealed (same bbox as Zawrat for blind-01; blind-02 is Zakopane)
    { id: 'blind-01-replay', label: 'Test na ślepo 1 (powtórka)', run: '../out/blind-01-replay.run.json', scenario: '../scenarios/blind-01-replay.json', dem: '../tools/terrain/data/zawrat-dem.json', basemap: true },
    { id: 'blind-02-replay', label: 'Test na ślepo 2 (powtórka)', run: '../out/blind-02-replay.run.json', scenario: '../scenarios/blind-02-replay.json', dem: '../tools/terrain/data/blind-02-dem.json', basemap: false },
    // outside the Tatras (rescue/README "Scenarios outside the Tatras"); basemapFile = regional PMTiles in basemap/
    ...[['bieszczady-wetlinska', 'Bieszczady - Połonina Wetlińska', 'bieszczady.pmtiles'], ['karkonosze-sniezka', 'Karkonosze - Śnieżka', 'karkonosze.pmtiles'],
      ['sniardwy', 'Śniardwy (woda)', 'sniardwy.pmtiles'], ['morzycko', 'Morzycko (woda)', 'moryn.pmtiles'], ['miedzyzdroje', 'Międzyzdroje (Bałtyk)', 'miedzyzdroje.pmtiles'],
      ['krakow-nowa-huta', 'Kraków - Nowa Huta (miasto)', 'krakow.pmtiles']]
      .map(([id, label, f]) => ({ id, label, run: `../out/${id}.run.json`, scenario: `../scenarios/${id}.json`, dem: `../tools/terrain/data/${id}-dem.json`, basemap: true, basemapFile: f })),
  ];
  const SC = SCENARIOS.find((x) => x.id === Q.get('sc')) || SCENARIOS[0];
  const CUSTOM_RUN = Q.has('run') || Q.has('runInline'); // ?run= (or a parent-supplied run) wins over the switcher
  // Embed (combined app rescue/app/, same contract as web/3d): ?embed=1 hides header + side panels, ?embed=bare also the
  // timeline and map controls. Messages are accepted only from window.parent at PARENT_ORIGIN (same origin by default).
  const EMBED = ['1', 'bare', 'scene'].includes(Q.get('embed')) ? Q.get('embed') : null; // scene = map + legend + map controls, like web/3d
  const PARENT_ORIGIN = Q.get('parentOrigin') || location.origin;
  const EMBED_VERSION = 'rescue2d/1';
  const CFG = {
    sc: CUSTOM_RUN ? 'custom' : SC.id,
    run: Q.get('run') || SC.run,
    scenario: Q.get('scenario') || SC.scenario,
    terrain: Q.get('terrain') || '',
    dem: Q.get('dem') || SC.dem,
    live: Q.get('live') || '../out/live-events.json',
    field: Q.get('field') || 'http://127.0.0.1:8770',
    basemap: Q.get('basemap') || (SC.basemap || CUSTOM_RUN ? 'basemap/' : 'none'), // folder with basemap.js or style.json; "none" = skip
    flavor: Q.get('flavor') || 'paper',
    tiles: Q.get('tiles') === 'online',
    renderer: Q.get('renderer') || 'auto', // auto | canvas
    step: Q.get('step'),
    playMs: Math.max(400, +Q.get('playMs') || 1800),
    livePollMs: Math.max(1000, +Q.get('livePollMs') || 4000),
    runPollMs: 5000,
  };

  /* ---------- field server PIN (same behaviour as rescue/out/field.html) ---------- */
  // Needed only when rescue-field listens on the LAN (serve --host 0.0.0.0 --pin NNNN); loopback needs none.
  const FIELD = (() => { try { return new URL(CFG.field, location.href); } catch (e) { return null; } })();
  const FIELD_LOOPBACK = !FIELD || ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(FIELD.hostname);
  let PIN = '';
  try { PIN = (localStorage.getItem('rescue-pin') || '').replace(/^"(.*)"$/, '$1'); } catch (e) { /* storage blocked */ }   // web/patrol stores it JSON-quoted
  const toField = (url) => { try { return !!FIELD && new URL(url, location.href).origin === FIELD.origin; } catch (e) { return false; } };
  // the run (/api/run/<sc>) on a LAN server needs the PIN too: send it to the field server and to our own origin
  const runPin = (url) => { try { return PIN && (toField(url) || new URL(url, location.href).origin === location.origin) ? { 'X-Rescue-Pin': PIN } : {}; } catch (e) { return {}; } };
  const pinHeaders = (url, extra) => Object.assign({}, extra || {}, !FIELD_LOOPBACK && PIN && toField(url) ? { 'X-Rescue-Pin': PIN } : {});

  /* ---------- diagnostics (read by the headless check) ---------- */
  const DIAG = { errors: [], warnings: [], info: {} };
  function diag() {
    const el = $('#diag');
    if (el) el.textContent = JSON.stringify(DIAG);
  }
  function warn(msg) { DIAG.warnings.push(String(msg)); console.warn('[rescue]', msg); diag(); }
  window.addEventListener('error', (e) => { DIAG.errors.push(String(e.message || e)); diag(); });
  window.addEventListener('unhandledrejection', (e) => { DIAG.errors.push('promise: ' + String(e.reason && e.reason.message || e.reason)); diag(); });

  // S3 (parity with 3D): the find segment is value.findSeg, falling back to value.truthSeg (blind-01-replay has only that)
  const findSegOf = (v) => (v ? v.findSeg || v.truthSeg || null : null);

  /* ---------- formatting ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (x, d) => Number(x).toLocaleString('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (x, d = 0) => nf(x * 100, d) + '%';
  const pctAuto = (x) => { const v = x * 100; return (v >= 10 ? nf(v, 0) : v >= 1 ? nf(v, 1) : nf(v, 2)) + '%'; };
  const pp = (x) => (x >= 0 ? '+' : '-') + nf(Math.abs(x * 100), 1) + ' pp';

  /* ---------- colour scale: shared with 3D (decision S2, rescue/app/scale.js, loaded by index.html) ----------
     colour by "times the average cell" (p * N) on a log scale, stops 0.5x 1x 2x 5x 10x 25x+, below 0.5x transparent */
  const SCALE = window.RescueScale;
  function heatRGBA(p, N) {
    const [r, g, b, a] = SCALE.colorFor(p, N);
    return a > 0 ? `rgba(${r},${g},${b},${+a.toFixed(3)})` : 'rgba(0,0,0,0)';
  }
  const DIFF_COLORS = ['#e6dfc8', '#9cc47a', '#3f7a3a', '#b8a78a', '#8f80a6', '#4b3f4a', '#4a8fd1'];

  /* ---------- evidence kinds ---------- */
  const I = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const KINDS = {
    rings: { pl: 'Pierścienie Koestera', icon: I('<circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="9.5"/>') },
    terrain: { pl: 'Teren', icon: I('<path d="M2 20 9 8l4 6 3-4 6 10z"/>') },
    cost: { pl: 'Koszt terenu', icon: I('<path d="M3 20 12 4l9 16z"/><path d="M12 10v4.5"/><path d="M12 17.2v.3"/>') },
    route: { pl: 'Trasa', icon: I('<circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/><path d="M7 19c5 0 3-7 6-7s4-5 4-5"/>') },
    sector: { pl: 'Sektor BTS 112', icon: I('<circle cx="12" cy="9" r="1.8"/><path d="m12 11-4 10M12 11l4 10M9.5 18h5"/><path d="M7.5 4.5a6.5 6.5 0 0 0 0 9M16.5 4.5a6.5 6.5 0 0 1 0 9"/>') },
    point: { pl: 'Punkt GPS', icon: I('<path d="M12 21s-7-6.4-7-12a7 7 0 0 1 14 0c0 5.6-7 12-7 12z"/><circle cx="12" cy="9" r="2.4"/>') },
    searched: { pl: 'Przeszukano, nic', icon: I('<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/><path d="M7.3 10h5.4"/>') },
    containment: { pl: 'Ograniczenie', icon: I('<path d="M3 16v-3.5L5.2 7h13.6L21 12.5V16z"/><circle cx="7.5" cy="17" r="1.6"/><circle cx="16.5" cy="17" r="1.6"/>') },
    weather: { pl: 'Pogoda', icon: I('<path d="M6.5 14h11a3.7 3.7 0 0 0-.7-7.3A5.6 5.6 0 0 0 6 8.2 2.9 2.9 0 0 0 6.5 14z"/><path d="M4 18h16M7 21.5h10"/>') },
    difficulty: { pl: 'Trudność terenu', icon: I('<path d="M3 20h18"/><path d="M5 20 10 9l3 5 2-3 4 9"/><path d="M10 9V4l4 1.5L10 7"/>') },
    conditions: { pl: 'Warunki', icon: I('<path d="M14 14.5V5a2 2 0 0 0-4 0v9.5a4 4 0 1 0 4 0z"/><path d="M12 9v7"/>') },
    report: { pl: 'Zgłoszenie z terenu', icon: I('<path d="M4 5h16v10H9l-5 4z"/><path d="M8 9h8M8 12h5"/>') },
  };
  const kindOf = (k) => KINDS[k] || { pl: k || '?', icon: KINDS.report.icon };

  /* ---------- fetch helpers ---------- */
  async function fetchJSON(url, optional) {
    try {
      const r = await fetch(url, { cache: 'no-store', headers: runPin(url) });
      if (!r.ok) { if (optional) return null; throw new Error(`HTTP ${r.status} dla ${url}`); }
      return await r.json();
    } catch (e) {
      if (optional) return null;
      throw e;
    }
  }
  function resolveURL(rel, base) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(rel) || rel.startsWith('/')) return rel;
    const dir = new URL('.', new URL(base, location.href)).href;
    return dir + rel.replace(/^\.\//, '');
  }

  /* ---------- geometry ---------- */
  function circle(lat, lon, rM, n = 72) {
    const ring = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * 2 * Math.PI;
      ring.push([lon + (rM * Math.cos(a)) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (rM * Math.sin(a)) / 110540]);
    }
    return ring;
  }
  const ll = (p) => [p[1], p[0]]; // [lat, lon] -> [lon, lat]
  const feat = (geometry, properties) => ({ type: 'Feature', geometry, properties });
  const line = (coords, props) => feat({ type: 'LineString', coordinates: coords }, props);
  const poly = (ring, props) => feat({ type: 'Polygon', coordinates: [ring] }, props);
  const pt = (lonlat, props) => feat({ type: 'Point', coordinates: lonlat }, props);
  const FC = (features) => ({ type: 'FeatureCollection', features });

  /* ---------- contract check (light; full validator is rescue/validate/validate_run.py) ---------- */
  function checkRun(R) {
    const errs = [];
    if (R.schema !== 'rescue-run/1') errs.push(`schema = ${R.schema}, oczekiwano rescue-run/1`);
    const N = R.rows * R.cols;
    if (!R.bbox || !(R.bbox.south < R.bbox.north && R.bbox.west < R.bbox.east)) errs.push('bbox niepoprawny');
    if (!Array.isArray(R.segOf) || R.segOf.length !== N) errs.push('segOf ma złą długość');
    if (!Array.isArray(R.steps) || !R.steps.length) errs.push('brak steps');
    (R.steps || []).forEach((s, k) => {
      if (!Array.isArray(s.poaGrid) || s.poaGrid.length !== N) errs.push(`steps[${k}].poaGrid ma złą długość`);
      if (!Array.isArray(s.segments)) errs.push(`steps[${k}].segments brak`);
    });
    return errs;
  }

  /* ---------- model built from run.json (+ optional scenario/terrain) ---------- */
  function buildModel(R, scen, terrain) {
    const { rows, cols } = R;
    const N = rows * cols;
    const { south, west, north, east } = R.bbox;
    const dLat = (north - south) / rows, dLon = (east - west) / cols;
    const cellKm2 = (R.cellM * R.cellM) / 1e6;
    const cells = [];
    for (let i = 0; i < N; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      const n = north - r * dLat, s = n - dLat, w = west + c * dLon, e = w + dLon;
      cells.push({ type: 'Feature', id: i, properties: { i, p: 0, c: 'rgba(0,0,0,0)', d: Array.isArray(R.difficulty) && R.difficulty.length === N ? R.difficulty[i] : -1 }, geometry: { type: 'Polygon', coordinates: [[[w, n], [e, n], [e, s], [w, s], [w, n]]] } });
    }
    // segments: names / area / polygon from the steps, centroid from segOf
    const segs = new Map();
    R.steps.forEach((st) => st.segments.forEach((g) => {
      if (!segs.has(g.id)) segs.set(g.id, { id: g.id, name: g.name, areaPct: g.areaPct, polygon: g.polygon, n: 0, sLat: 0, sLon: 0 });
    }));
    R.segOf.forEach((id, i) => {
      if (!segs.has(id)) segs.set(id, { id, name: id, areaPct: 0, polygon: null, n: 0, sLat: 0, sLon: 0 });
      const g = segs.get(id), r = Math.floor(i / cols), c = i % cols;
      g.n++; g.sLat += north - (r + 0.5) * dLat; g.sLon += west + (c + 0.5) * dLon;
    });
    for (const g of segs.values()) {
      g.center = g.n ? [g.sLon / g.n, g.sLat / g.n] : (g.polygon ? g.polygon[0] : [west, north]);
      if (!g.areaPct) g.areaPct = (100 * g.n) / N;
      const ring = g.polygon || [];
      g.bounds = ring.length ? [[Math.min(...ring.map((p) => p[0])), Math.min(...ring.map((p) => p[1]))], [Math.max(...ring.map((p) => p[0])), Math.max(...ring.map((p) => p[1]))]] : null;
    }
    const segIdx = new Map([...segs.keys()].map((id, j) => [id, j]));
    const segOfIdx = Int32Array.from(R.segOf.map((id) => segIdx.get(id)));

    // hints: one per step, matched to scenario events for detail / geometry
    const events = (scen && scen.events) || [];
    const used = new Set();
    const hints = R.steps.map((s, k) => {
      let ev = null;
      let j = events.findIndex((e, x) => !used.has(x) && e.title === s.label);
      if (j < 0 && events[k] && events[k].provider === s.source && !used.has(k)) j = k;
      if (j >= 0) { used.add(j); ev = events[j]; }
      let segIds = ev && ev.segments ? ev.segments.slice() : [];
      if (!segIds.length && s.kind === 'searched') segIds = (s.label.match(/\bS\d+\b/g) || []).filter((id) => segs.has(id));
      return { k, id: s.hintId, kind: s.kind, label: s.label, source: s.source, t: s.t, minute: s.minute, ev, segIds, pod: ev && ev.pod };
    });

    // per-hint multiplicative layer recovered from consecutive cumulative steps: L_k = P_k / P_(k-1)
    let unrecoverable = 0;
    const layers = R.steps.map((s, k) => {
      const L = new Float64Array(N);
      const prev = k ? R.steps[k - 1].poaGrid : null;
      for (let i = 0; i < N; i++) {
        const a = prev ? prev[i] : 1 / N, b = s.poaGrid[i];
        if (a > 0 && b > 0) L[i] = b / a; else { L[i] = 1; unrecoverable++; }
      }
      return L;
    });
    if (unrecoverable) warn(`${unrecoverable} komórek bez odtwarzalnej warstwy (POA = 0), przyjęto 1`);

    const T = terrain || (scen && scen.terrain) || null;
    return { R, scen, T, rows, cols, N, bbox: R.bbox, dLat, dLon, cellKm2, cells, segs, segIdx, segOfIdx, segList: [...segs.values()], hints, layers };
  }

  /* ---------- state ---------- */
  const S = {
    M: null, view: null, step: 0, disabled: new Set(), selected: null, fullNames: false, showTruth: false,
    base: 'relief', bases: [], playing: false, timer: null, live: [], liveSeen: new Set(), liveStatus: 'czekam', lastRunSig: '',
    lastP: null,
  };

  function compute(step) {
    const M = S.M;
    const base = M.R.steps[step].poaGrid;
    const off = M.hints.filter((h) => h.k <= step && S.disabled.has(h.id));
    const p = Float64Array.from(base);
    if (!off.length) return p;
    for (const h of off) { const L = M.layers[h.k]; for (let i = 0; i < M.N; i++) p[i] /= L[i]; }
    let sum = 0; for (let i = 0; i < M.N; i++) sum += p[i];
    for (let i = 0; i < M.N; i++) p[i] /= sum;
    return p;
  }
  function stats(p) {
    const M = S.M;
    const sp = new Float64Array(M.segList.length);
    for (let i = 0; i < M.N; i++) sp[M.segOfIdx[i]] += p[i];
    return M.segList.map((g, j) => ({ id: g.id, name: g.name, poa: sp[j], areaPct: g.areaPct, density: g.areaPct > 0 ? sp[j] / (g.areaPct / 100) : 0 }))
      .sort((a, b) => b.poa - a.poa);
  }
  function searchedState(step) {
    const out = {};
    for (const h of S.M.hints) {
      if (h.k > step || h.kind !== 'searched' || S.disabled.has(h.id)) continue;
      for (const id of h.segIds) {
        const prev = out[id] ? out[id].pod : 0;
        const pod = h.pod != null ? h.pod : null;
        out[id] = { pod: pod == null ? prev : 1 - (1 - prev) * (1 - pod), by: h };
      }
    }
    return out;
  }

  // parity with 3D: the find is the Found provider / a ZNALEZIONO hint; its step and the find segment's rank just before it
  const isFoundHint = (h) => h.source === 'Found' || !!(h.ev && h.ev.found) || /ZNALEZIONO/i.test(h.label || '');
  function foundInfo() {
    const M = S.M, h = M.hints.find(isFoundHint), seg = findSegOf(M.R.value);
    if (!h || !seg) return null;
    const before = M.R.steps[Math.max(0, h.k - 1)].segments.slice().sort((a, b) => b.poa - a.poa);
    const g = M.segs.get(seg);
    return { k: h.k, seg, name: (g && g.name) || (M.R.value && M.R.value.findSegName) || seg, rank: before.findIndex((x) => x.id === seg) + 1 };
  }

  // S6 (parity with 3D): header link to the 3D view with the same scenario and step. 3D knows these ids;
  // any other run goes over as ?run=&scenario=&terrain=&dem= (paths re-based from web/ to web/3d/).
  const SC3D = { zawrat: 'zawrat', 'morskie-oko': 'morskie-oko', kasprowy: 'kasprowy', 'blind-01-replay': 'blind-01' };
  function link3d() {
    const a = $('#to3d'); if (!a) return;
    const up = (u) => (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith('/') ? u : '../' + u);
    const q = new URLSearchParams();
    if (SC3D[CFG.sc]) q.set('sc', SC3D[CFG.sc]);
    else if (CFG.run) {
      q.set('run', up(CFG.run)); q.set('scenario', up(CFG.scenario)); q.set('dem', up(CFG.dem));
      q.set('terrain', up(CFG.terrain || CFG.scenario.replace(/\.json$/, '-terrain.json')));
    }
    q.set('step', String(S.step));
    a.href = '3d/?' + q;
  }

  // parity with 3D: "wpływ" = the segment that gained most when the hint arrived (engine steps k-1 -> k)
  function influence(k) {
    const R = S.M.R; if (k <= 0) return null;
    const prev = new Map(R.steps[k - 1].segments.map((s) => [s.id, s.poa]));
    let best = null;
    for (const s of R.steps[k].segments) { const d = s.poa - (prev.get(s.id) || 0); if (!best || d > best.d) best = { d, id: s.id, name: s.name }; }
    return best && best.d > 0.004 ? best : null;
  }

  function taskFor(name) {
    const n = name.toLowerCase();
    if (n.includes('żleb') || n.includes('potok') || n.includes('roztok')) return 'Zespół + pies: zejście wzdłuż żlebu / cieku, sprawdzić progi';
    if (n.includes('szlak') || n.includes('droga')) return 'Zespół szybki: przejście szlakiem, nawoływanie, światło';
    if (n.includes('staw')) return 'Dron termowizyjny + obejście brzegu';
    if (n.includes('grań') || n.includes('perć') || n.includes('wierch') || n.includes('przełęcz')) return 'Zespół wspinaczkowy / śmigłowiec: ściany pod granią';
    if (n.includes('schronisko') || n.includes('hala') || n.includes('murowaniec')) return 'Sprawdzić schronisko, wypytać obsługę i turystów';
    return 'Zespół: przeszukanie segmentu wzdłuż linii terenu';
  }

  /* ---------- relief (offline terrain background) ---------- */
  function hypso(z) {
    const stops = [[900, [62, 92, 58]], [1300, [86, 112, 70]], [1600, [118, 124, 88]], [1900, [132, 124, 106]], [2200, [156, 150, 140]], [2500, [190, 186, 180]]];
    if (z <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (z <= stops[i][0]) {
        const t = (z - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
        return stops[i - 1][1].map((v, j) => v + t * (stops[i][1][j] - v));
      }
    }
    return stops[stops.length - 1][1];
  }
  function reliefFromDEM(D) {
    const { rows, cols, step, lat0, lon0, z } = D;
    const cv = document.createElement('canvas'); cv.width = cols; cv.height = rows;
    const ctx = cv.getContext('2d'); const img = ctx.createImageData(cols, rows);
    const latC = lat0 - (rows * step) / 2;
    const dx = step * 111320 * Math.cos((latC * Math.PI) / 180), dy = step * 110540;
    const az = (315 * Math.PI) / 180, alt = (45 * Math.PI) / 180;
    const Z = (r, c) => z[Math.max(0, Math.min(rows - 1, r))][Math.max(0, Math.min(cols - 1, c))];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const gx = (Z(r, c + 1) - Z(r, c - 1)) / (2 * dx), gy = (Z(r + 1, c) - Z(r - 1, c)) / (2 * dy);
      const slope = Math.atan(Math.hypot(gx, gy)), aspect = Math.atan2(gy, -gx);
      let sh = Math.cos(Math.PI / 2 - alt) * Math.cos(slope) + Math.sin(Math.PI / 2 - alt) * Math.sin(slope) * Math.cos(az - Math.PI / 2 - aspect);
      sh = Math.max(0, sh);
      const col = hypso(Z(r, c)), k = 0.35 + 0.75 * sh, o = (r * cols + c) * 4;
      img.data[o] = Math.min(255, col[0] * k); img.data[o + 1] = Math.min(255, col[1] * k); img.data[o + 2] = Math.min(255, col[2] * k); img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const west = lon0, north = lat0, east = lon0 + cols * step, south = lat0 - rows * step;
    return { canvas: cv, url: cv.toDataURL('image/png'), coords: [[west, north], [east, north], [east, south], [west, south]], bounds: { west, north, east, south },
      attribution: 'Teren: Copernicus DEM GLO-30 © DLR e.V. 2010-2014, © Airbus 2014-2018 (UE/ESA)', src: 'dem' };
  }
  function reliefFromSlope(M) {
    const sl = M.T && M.T.slopeDeg;
    if (!Array.isArray(sl) || sl.length !== M.N) return null;
    const cv = document.createElement('canvas'); cv.width = M.cols; cv.height = M.rows;
    const ctx = cv.getContext('2d'); const img = ctx.createImageData(M.cols, M.rows);
    for (let i = 0; i < M.N; i++) {
      const t = Math.min(1, sl[i] / 50), o = i * 4;
      const a = [74, 104, 64], b = [150, 144, 132];
      img.data[o] = a[0] + t * (b[0] - a[0]); img.data[o + 1] = a[1] + t * (b[1] - a[1]); img.data[o + 2] = a[2] + t * (b[2] - a[2]); img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const { west, north, east, south } = M.bbox;
    return { canvas: cv, url: cv.toDataURL('image/png'), coords: [[west, north], [east, north], [east, south], [west, south]], bounds: M.bbox, attribution: 'Teren: nachylenie z DEM (scenariusz)', src: 'slope' };
  }
  const TRAIL_COLORS = { czerwony: '#e3483d', zielony: '#43b05c', niebieski: '#3d82e0', 'żółty': '#e9c64a', czarny: '#16191c' };
  function trailColor(name) {
    const k = String(name || '').split(/[:/ ]/)[0].toLowerCase();
    return TRAIL_COLORS[k] || '#e8edf1';
  }
  function baseFeatures(M) {
    const T = M.T; if (!T) return FC([]);
    const f = [];
    (T.lakes || []).forEach((l) => f.push(poly(circle(l.center[0], l.center[1], l.radiusM || 100, 48), { fill: '#3c6e98', fillOpacity: 0.9, color: '#6fa6d6', width: 1, opacity: 0.8, dash: 0, name: l.name })));
    (T.streams || []).forEach((s) => f.push(line(s.points.map(ll), { color: '#6db3ff', width: 1.3, opacity: 0.75, dash: 0, name: s.name })));
    (T.trails || []).forEach((t) => {
      const c = trailColor(t.name);
      f.push(line(t.points.map(ll), { color: c === '#16191c' ? '#d0d4d8' : '#0d1114', width: 3.2, opacity: 0.55, dash: 0, name: t.name }));
      f.push(line(t.points.map(ll), { color: c, width: 1.8, opacity: 0.95, dash: 1, name: t.name }));
    });
    (T.huts || []).forEach((h) => f.push(pt(ll(h.at), { color: '#f4f1ea', radius: 4.5, stroke: '#1a1f24', name: h.name })));
    return FC(f);
  }

  /* ---------- overlays for the current step ---------- */
  function overlays(step, stTop) {
    const M = S.M, f = [], chips = [];
    const active = M.hints.filter((h) => h.k <= step && !S.disabled.has(h.id));
    const searched = searchedState(step);
    let weather = null;
    for (const h of active) {
      const e = h.ev || {};
      if (h.kind === 'rings' && e.point && e.quantilesKm) {
        e.quantilesKm.forEach((q, j) => {
          f.push(poly(circle(e.point[0], e.point[1], q * 1000, 120), { color: '#ffffff', width: 1.4, opacity: 0.75, dash: 1, fillOpacity: 0 }));
          const lat = e.point[0] + (q * 1000) / 110540;
          if (lat < M.bbox.north) chips.push({ key: 'ring' + j, at: [e.point[1], lat], cls: 'chip ring', html: `${[25, 50, 75, 95][j] || ''}% · ${nf(q, 1)} km`, title: 'Pierścień Koestera (ISRID, wartości przybliżone)' });
        });
      }
      if (h.kind === 'route' && e.points) {
        f.push(line(e.points.map(ll), { color: '#0d1114', width: 7, opacity: 0.5, dash: 0 }));
        f.push(line(e.points.map(ll), { color: '#38d6e0', width: 4, opacity: 0.95, dash: 0 }));
      }
      if (h.kind === 'containment') {
        if (e.points) f.push(line(e.points.map(ll), { color: '#c3cbd3', width: 14, opacity: 0.28, dash: 0 }));
        if (e.point) chips.push({ key: 'car', at: ll(e.point), cls: 'chip car', html: 'Auto', title: h.label });
      }
      if (h.kind === 'sector' && e.point && e.radiusM) {
        f.push(poly(circle(e.point[0], e.point[1], e.radiusM), { color: '#b98cff', width: 2.2, opacity: 0.95, dash: 1, fill: '#b98cff', fillOpacity: 0.07 }));
        chips.push({ key: 'bts', at: [e.point[1], e.point[0] - (e.radiusM * 0.8) / 110540], cls: 'chip bts', html: 'Sektor 112', title: h.label });
      }
      if (h.kind === 'point' && e.point) {
        f.push(poly(circle(e.point[0], e.point[1], Math.max(e.radiusM || 25, 60)), { color: '#3ee08f', width: 3, opacity: 1, dash: 0, fill: '#3ee08f', fillOpacity: 0.35 }));
        chips.push({ key: 'ping' + h.k, at: ll(e.point), cls: 'chip ping', html: `Ratunek ${esc(h.t)}`, title: h.label, offset: [0, 34] });
      }
      if (h.kind === 'cost' && M.T && M.T.ridges) {
        M.T.ridges.forEach((r) => f.push(line(r.points.map(ll), { color: '#efe6d6', width: 1.4, opacity: 0.55, dash: 1 })));
      }
      if (h.kind === 'weather') weather = h;
    }
    for (const id of Object.keys(searched)) {
      const g = M.segs.get(id); if (!g || !g.polygon) continue;
      f.push(poly(g.polygon, { color: '#b9c9da', width: 2, opacity: 0.95, dash: 1, fill: '#9fb3c8', fillOpacity: 0.2 }));
    }
    // IPP
    const ipp = M.R.ipp;
    if (ipp) chips.push({ key: 'ipp', at: [ipp.lon, ipp.lat], cls: 'chip ipp', html: 'IPP', title: ipp.name });
    // truth (backtest only)
    if (S.showTruth && M.scen && M.scen.truth) chips.push({ key: 'truth', at: ll(M.scen.truth.at), cls: 'chip truth', html: 'Odnaleziony (backtest)', title: M.scen.truth.name });
    // live field reports
    S.live.forEach((ev) => {
      const pts = ev.hints.filter((h) => h.lonlat).map((h, j) => ({ key: 'live:' + ev.id + ':' + j, at: h.lonlat, type: h.type, text: h.text, atSeg: !!h.segId }));
      if (!pts.length && ev.lonlat) pts.push({ key: 'live:' + ev.id, at: ev.lonlat, type: 'report', text: ev.text });
      pts.forEach((q, j) => chips.push({ key: q.key, at: q.at, cls: 'chip live lv-' + q.type + (ev.fresh ? ' fresh' : ''), html: `${esc(ev.t || '')} ${esc(short(q.text, 26))}`, title: `${ev.text}\n${q.text}`, offset: q.atSeg ? [0, -30 - 22 * j] : [0, 0] }));
      if (pts.length) ev.hints.filter((h) => h.type === 'segmentSearched' && h.segId && M.segs.get(h.segId)).forEach((h) => f.push(poly(M.segs.get(h.segId).polygon, { color: '#ffd166', width: 2, opacity: 0.95, dash: 1, fill: '#ffd166', fillOpacity: 0.08 })));
    });
    // segment labels
    const rank = new Map(stTop.map((s, j) => [s.id, j + 1]));
    for (const g of M.segList) {
      const r = rank.get(g.id), sr = searched[g.id], st = S.lastStats.find((x) => x.id === g.id);
      const top = r && r <= 3;
      const nm = top || S.fullNames || g.id === S.selected ? `${esc(g.name)} - ${pctAuto(st.poa)}` : `${esc(g.id)} · ${pctAuto(st.poa)}`;
      const asg = (M.R.steps[step].assignments || []).filter((a) => a.segmentId === g.id).map((a) => { const r = (M.R.steps[step].resources || []).find((x) => x.id === a.resourceId); return RES_SHORT[r && r.type] || a.resourceId; });
      const extra = (sr ? `<span class="srch">przeszukany${sr.pod != null ? ', POD ' + pct(sr.pod) : ''}</span>` : '') + (asg.length ? `<span class="asg">${esc(asg.join(', '))}</span>` : '');
      chips.push({ key: 'seg:' + g.id, at: g.center, cls: 'chip seg' + (top ? ' top top' + r : '') + (sr ? ' searched' : '') + (g.id === S.selected ? ' sel' : ''),
        html: (top ? `<b class="rk">#${r}</b> ` : '') + nm + extra, title: `${g.id} ${g.name}: POA ${pct(st.poa, 1)}, obszar ${nf(g.areaPct, 1)}%`, seg: g.id });
    }
    return { fc: FC(f), chips, weather };
  }
  const short = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  /* ---------- label decluttering (shared by both views) ---------- */
  const chipPri = (cls) => (/\btop1\b/.test(cls) ? 0 : /\btop2\b/.test(cls) ? 1 : /\btop3\b/.test(cls) ? 2 : /\bping\b/.test(cls) ? 3 : /\bipp\b/.test(cls) ? 4 : /\blive\b/.test(cls) ? 5 : /\bseg\b/.test(cls) ? 6 : 7);
  // items: {x, y (anchor px incl. base offset), w, h, pri, apply(dx, dy, dim)}
  function declutter(items) {
    const placed = [], hit = (a, b) => a.x < b.x + b.w + 2 && b.x < a.x + a.w + 2 && a.y < b.y + b.h + 2 && b.y < a.y + a.h + 2;
    items.sort((a, b) => a.pri - b.pri);
    for (const it of items) {
      if (it.pri === 7) { it.apply(0, 0, false); continue; }
      const step = it.h + 3, cands = [0, step, -step, 2 * step, -2 * step];
      let done = false;
      for (const dy of cands) {
        const r = { x: it.x - it.w / 2, y: it.y + dy - it.h / 2, w: it.w, h: it.h };
        if (!placed.some((q) => hit(q, r))) { placed.push(r); it.apply(0, dy, false); done = true; break; }
      }
      if (!done) { it.apply(0, 0, it.pri > 4); if (it.pri <= 4) placed.push({ x: it.x - it.w / 2, y: it.y - it.h / 2, w: it.w, h: it.h }); }
    }
  }

  /* ---------- MapLibre view ---------- */
  function MapLibreView(container, M, opt) {
    const self = this;
    const { west, south, east, north } = M.bbox;
    const style = opt.baseStyle ? JSON.parse(JSON.stringify(opt.baseStyle)) : { version: 8, sources: {}, layers: [] };
    const baseLayerIds = (style.layers || []).map((l) => l.id);
    this.hasBasemap = !!opt.baseStyle;
    const map = new maplibregl.Map({
      container, style, bounds: [[west, south], [east, north]], fitBoundsOptions: { padding: 24 }, attributionControl: false,
      dragRotate: false, pitchWithRotate: false, touchPitch: false, maxZoom: 17, minZoom: 9,
      fadeDuration: 0,
    });
    this.map = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 120 }), 'bottom-right');
    const markers = new Map();
    const tileErr = {}, tileOk = {};
    map.on('error', (e) => {
      const id = e.sourceId || (e.source && e.source.id);
      if (id) { tileErr[id] = (tileErr[id] || 0) + 1; if (!tileOk[id] && tileErr[id] >= 3 && opt.onSourceFail) opt.onSourceFail(id); }
      else warn('map: ' + (e.error && e.error.message || e.message || 'error'));
    });
    map.on('sourcedata', (e) => { if (e.tile && e.sourceId) tileOk[e.sourceId] = (tileOk[e.sourceId] || 0) + 1; });
    this.ready = new Promise((res) => map.on('load', () => {
      const first = map.getStyle().layers[0];
      map.addLayer({ id: 'bg-flat', type: 'background', paint: { 'background-color': '#1f2a24' } }, first ? first.id : undefined);
      if (opt.tiles) {
        map.addSource('topo', { type: 'raster', tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`), tileSize: 256, maxzoom: 17, attribution: '© OpenStreetMap contributors, SRTM | style: © OpenTopoMap (CC-BY-SA)' });
        map.addSource('osm', { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' });
        const dim = { 'raster-brightness-max': 0.82, 'raster-saturation': -0.25 };
        map.addLayer({ id: 'topo', type: 'raster', source: 'topo', layout: { visibility: 'none' }, paint: dim });
        map.addLayer({ id: 'osm', type: 'raster', source: 'osm', layout: { visibility: 'none' }, paint: dim });
      }
      if (opt.relief) {
        map.addSource('relief', { type: 'image', url: opt.relief.url, coordinates: opt.relief.coords });
        map.addLayer({ id: 'relief', type: 'raster', source: 'relief', paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 } });
        map.addSource('relief-attr', { type: 'geojson', data: FC([pt([west, south], {})]), attribution: opt.relief.attribution });
        map.addLayer({ id: 'relief-attr', type: 'circle', source: 'relief-attr', paint: { 'circle-radius': 0, 'circle-opacity': 0 } });
      }
      const empty = FC([]);
      map.addSource('base', { type: 'geojson', data: empty, attribution: M.T ? '© OpenStreetMap contributors (ODbL)' : undefined });
      map.addSource('cells', { type: 'geojson', data: FC(M.cells) });
      map.addSource('ov', { type: 'geojson', data: empty });
      map.addSource('segs', { type: 'geojson', data: empty });
      const P = ['==', ['geometry-type'], 'Polygon'], Ln = ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'Polygon']];
      const lineP = { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': ['get', 'opacity'] };
      map.addLayer({ id: 'base-fill', type: 'fill', source: 'base', filter: P, paint: { 'fill-color': ['coalesce', ['get', 'fill'], '#000'], 'fill-opacity': ['coalesce', ['get', 'fillOpacity'], 0] } });
      // per-cell rgba from the shared scale (set in setHeat), alpha carried in the colour
      map.addLayer({ id: 'heat', type: 'fill', source: 'cells', paint: { 'fill-color': ['get', 'c'], 'fill-opacity': 1, 'fill-antialias': false } });
      const dm = ['match', ['get', 'd']]; DIFF_COLORS.forEach((c, j) => dm.push(j, c)); dm.push('rgba(0,0,0,0)');
      map.addLayer({ id: 'diff', type: 'fill', source: 'cells', layout: { visibility: 'none' }, paint: { 'fill-color': dm, 'fill-opacity': 0.82, 'fill-antialias': false } });
      map.addLayer({ id: 'base-line', type: 'line', source: 'base', filter: ['all', Ln, ['==', ['get', 'dash'], 0]], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: lineP });
      map.addLayer({ id: 'base-line-dash', type: 'line', source: 'base', filter: ['all', Ln, ['==', ['get', 'dash'], 1]], paint: { ...lineP, 'line-dasharray': [2.2, 1.4] } });
      map.addLayer({ id: 'base-pt', type: 'circle', source: 'base', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': ['get', 'radius'], 'circle-color': ['get', 'color'], 'circle-stroke-color': ['get', 'stroke'], 'circle-stroke-width': 1.5 } });
      map.addLayer({ id: 'ov-fill', type: 'fill', source: 'ov', filter: P, paint: { 'fill-color': ['coalesce', ['get', 'fill'], '#000'], 'fill-opacity': ['coalesce', ['get', 'fillOpacity'], 0] } });
      map.addLayer({ id: 'seg-line', type: 'line', source: 'segs', layout: { 'line-join': 'round', 'line-sort-key': ['get', 'z'] }, paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': ['get', 'opacity'] } });
      map.addLayer({ id: 'ov-line', type: 'line', source: 'ov', filter: ['all', Ln, ['==', ['get', 'dash'], 0]], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: lineP });
      map.addLayer({ id: 'ov-line-dash', type: 'line', source: 'ov', filter: ['all', Ln, ['==', ['get', 'dash'], 1]], paint: { ...lineP, 'line-dasharray': [2.5, 1.6] } });
      map.on('mousemove', 'heat', (e) => { const f = e.features && e.features[0]; if (f) opt.onHover(f.properties.i, e.point); });
      map.on('mouseleave', 'heat', () => opt.onHover(null));
      map.on('click', 'heat', (e) => { const f = e.features && e.features[0]; if (f) opt.onCellClick(f.properties.i); });
      res();
    }));
    this.setBase = (b) => {
      const vis = (id, on) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); };
      baseLayerIds.forEach((id) => vis(id, b === 'map'));
      vis('topo', b === 'topo'); vis('osm', b === 'osm'); vis('relief', b === 'relief'); vis('relief-attr', b === 'relief');
      ['base-fill', 'base-line', 'base-line-dash', 'base-pt'].forEach((id) => vis(id, b === 'relief' || b === 'none'));
      vis('bg-flat', b !== 'map');
    };
    this.setBaseFC = (fc) => map.getSource('base').setData(fc);
    this.setDiff = (on) => { map.setLayoutProperty('diff', 'visibility', on ? 'visible' : 'none'); map.setLayoutProperty('heat', 'visibility', on ? 'none' : 'visible'); };
    this.setHeat = (p) => { for (let i = 0; i < M.N; i++) { const pr = M.cells[i].properties; pr.p = p[i]; pr.c = heatRGBA(p[i], M.N); } map.getSource('cells').setData(FC(M.cells)); };
    this.setOverlay = (fc) => map.getSource('ov').setData(fc);
    this.setSegments = (fc) => map.getSource('segs').setData(fc);
    this.setChips = (chips) => {
      const seen = new Set();
      for (const c of chips) {
        seen.add(c.key);
        let m = markers.get(c.key);
        if (!m) {
          const el = document.createElement('div');
          if (c.seg) el.addEventListener('click', (ev) => { ev.stopPropagation(); opt.onSegClick(c.seg); });
          m = new maplibregl.Marker({ element: el, anchor: 'center', offset: c.offset || [0, 0] }).setLngLat(c.at).addTo(map);
          markers.set(c.key, m);
        }
        const el = m.getElement();
        if (el.dataset.html !== c.html) { el.innerHTML = c.html; el.dataset.html = c.html; }
        el.className = c.cls + ' maplibregl-marker'; el.title = c.title || '';
        m.__base = c.offset || [0, 0];
        m.setLngLat(c.at);
      }
      for (const [k, m] of markers) if (!seen.has(k)) { m.remove(); markers.delete(k); }
      tidy();
    };
    function tidy() {
      declutter([...markers.values()].map((m) => {
        const el = m.getElement(), p = map.project(m.getLngLat()), b = m.__base || [0, 0];
        return { x: p.x + b[0], y: p.y + b[1], w: el.offsetWidth, h: el.offsetHeight, pri: chipPri(el.className),
          apply: (dx, dy, dim) => { m.setOffset([b[0] + dx, b[1] + dy]); el.style.opacity = dim ? '0.25' : ''; } };
      }));
    }
    map.on('zoomend', tidy); map.on('moveend', tidy); map.on('resize', tidy);
    this.fitAll = () => map.fitBounds([[west, south], [east, north]], { padding: 24, duration: 500 });
    this.fitSeg = (g) => { if (g.bounds) map.fitBounds(g.bounds, { padding: 90, maxZoom: 15, duration: 600 }); };
    this.layerCount = () => map.getStyle().layers.length;
    this.resize = () => map.resize();
    this.kind = 'maplibre';
  }

  /* ---------- Canvas 2D fallback view (no WebGL / no MapLibre) ---------- */
  function CanvasView(container, M, opt) {
    const self = this;
    const cv = document.createElement('canvas'); cv.className = 'cv-map'; container.appendChild(cv);
    const chipLayer = document.createElement('div'); chipLayer.className = 'cv-chips'; container.appendChild(chipLayer);
    const attr = document.createElement('div'); attr.className = 'cv-attr'; container.appendChild(attr);
    const ctx = cv.getContext('2d');
    let diffOn = false;
    let p = null, base = 'relief', baseFC = FC([]), ovFC = FC([]), segFC = FC([]), chips = [], X = null;
    const { west, south, east, north } = M.bbox;
    const kx = Math.cos((((north + south) / 2) * Math.PI) / 180);
    function layout() {
      const w = container.clientWidth, h = container.clientHeight, dpr = window.devicePixelRatio || 1;
      cv.width = Math.max(1, w * dpr); cv.height = Math.max(1, h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px';
      const gw = (east - west) * kx, gh = north - south, pad = 24;
      const s = Math.min((w - 2 * pad) / gw, (h - 2 * pad) / gh);
      X = { s, ox: (w - gw * s) / 2, oy: (h - gh * s) / 2, dpr };
    }
    const toXY = (lon, lat) => [X.ox + (lon - west) * kx * X.s, X.oy + (north - lat) * X.s];
    function drawFC(fc, kinds) {
      for (const f of fc.features) {
        const pr = f.properties, g = f.geometry;
        if (g.type === 'Point') {
          if (!kinds.includes('pt')) continue;
          const [x, y] = toXY(...g.coordinates); ctx.beginPath(); ctx.arc(x, y, pr.radius || 4, 0, 7);
          ctx.fillStyle = pr.color; ctx.fill(); ctx.strokeStyle = pr.stroke || '#000'; ctx.lineWidth = 1.5; ctx.stroke(); continue;
        }
        const rings = g.type === 'Polygon' ? g.coordinates : [g.coordinates];
        ctx.beginPath();
        for (const ring of rings) ring.forEach((c, j) => { const [x, y] = toXY(c[0], c[1]); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        if (g.type === 'Polygon' && kinds.includes('fill') && pr.fillOpacity) { ctx.globalAlpha = pr.fillOpacity; ctx.fillStyle = pr.fill; ctx.fill(); }
        if (kinds.includes('line') && pr.width) { ctx.globalAlpha = pr.opacity == null ? 1 : pr.opacity; ctx.strokeStyle = pr.color; ctx.lineWidth = pr.width; ctx.setLineDash(pr.dash ? [pr.width * 2.4, pr.width * 1.6] : []); ctx.stroke(); }
        ctx.globalAlpha = 1; ctx.setLineDash([]);
      }
    }
    function draw() {
      if (!X) layout();
      ctx.setTransform(X.dpr, 0, 0, X.dpr, 0, 0);
      ctx.fillStyle = '#1f2a24'; ctx.fillRect(0, 0, cv.width, cv.height);
      if (base === 'relief' && opt.relief) {
        const b = opt.relief.bounds; const [x0, y0] = toXY(b.west, b.north), [x1, y1] = toXY(b.east, b.south);
        ctx.imageSmoothingEnabled = true; ctx.drawImage(opt.relief.canvas, x0, y0, x1 - x0, y1 - y0);
      }
      drawFC(baseFC, ['fill']);
      if (diffOn) {
        const cw = (east - west) / M.cols, ch = (north - south) / M.rows;
        for (let i = 0; i < M.N; i++) {
          const d = M.cells[i].properties.d; if (d < 0) continue;
          const r = Math.floor(i / M.cols), q = i % M.cols;
          const [x0, y0] = toXY(west + q * cw, north - r * ch), [x1, y1] = toXY(west + (q + 1) * cw, north - (r + 1) * ch);
          ctx.globalAlpha = 0.82; ctx.fillStyle = DIFF_COLORS[d] || '#000'; ctx.fillRect(x0, y0, x1 - x0 + 0.5, y1 - y0 + 0.5);
        }
        ctx.globalAlpha = 1;
      } else if (p) {
        const cw = (east - west) / M.cols, ch = (north - south) / M.rows;
        for (let i = 0; i < M.N; i++) {
          const [cr, cg, cb, ca] = SCALE.colorFor(p[i], M.N); if (!(ca > 0)) continue;
          const r = Math.floor(i / M.cols), q = i % M.cols;
          const [x0, y0] = toXY(west + q * cw, north - r * ch), [x1, y1] = toXY(west + (q + 1) * cw, north - (r + 1) * ch);
          ctx.globalAlpha = ca; ctx.fillStyle = `rgb(${cr},${cg},${cb})`; ctx.fillRect(x0, y0, x1 - x0 + 0.5, y1 - y0 + 0.5);
        }
        ctx.globalAlpha = 1;
      }
      drawFC(baseFC, ['line', 'pt']);
      drawFC(ovFC, ['fill']);
      drawFC(segFC, ['line']);
      drawFC(ovFC, ['line']);
      chipLayer.innerHTML = '';
      for (const c of chips) {
        const el = document.createElement('div'); el.className = c.cls; el.innerHTML = c.html; el.title = c.title || '';
        const [x, y] = toXY(c.at[0], c.at[1]); el.style.left = x + (c.offset ? c.offset[0] : 0) + 'px'; el.style.top = y + (c.offset ? c.offset[1] : 0) + 'px';
        if (c.seg) el.addEventListener('click', () => opt.onSegClick(c.seg));
        chipLayer.appendChild(el);
        c.__el = el; c.__x = x + (c.offset ? c.offset[0] : 0); c.__y = y + (c.offset ? c.offset[1] : 0);
      }
      declutter(chips.map((c) => ({ x: c.__x, y: c.__y, w: c.__el.offsetWidth, h: c.__el.offsetHeight, pri: chipPri(c.cls),
        apply: (dx, dy, dim) => { c.__el.style.top = c.__y + dy + 'px'; c.__el.style.opacity = dim ? '0.25' : ''; } })));
      attr.textContent = [base === 'relief' && opt.relief ? opt.relief.attribution : '', M.T ? '© OpenStreetMap contributors (ODbL)' : '', 'Dane scenariusza fikcyjne'].filter(Boolean).join(' | ');
    }
    cv.addEventListener('mousemove', (e) => {
      if (!X) return;
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const lon = west + (x - X.ox) / (kx * X.s), lat = north - (y - X.oy) / X.s;
      const row = Math.floor(((north - lat) / (north - south)) * M.rows), col = Math.floor(((lon - west) / (east - west)) * M.cols);
      if (row < 0 || col < 0 || row >= M.rows || col >= M.cols) opt.onHover(null); else opt.onHover(row * M.cols + col, { x, y });
    });
    cv.addEventListener('mouseleave', () => opt.onHover(null));
    new ResizeObserver(() => { X = null; draw(); }).observe(container);
    this.ready = Promise.resolve();
    this.setBase = (b) => { base = b; draw(); };
    this.setDiff = (on) => { diffOn = on; draw(); };
    this.setBaseFC = (fc) => { baseFC = fc; };
    this.setHeat = (q) => { p = q; };
    this.setOverlay = (fc) => { ovFC = fc; };
    this.setSegments = (fc) => { segFC = fc; };
    this.setChips = (c) => { chips = c; draw(); };
    this.fitAll = () => {}; this.fitSeg = () => {};
    this.layerCount = () => 6;
    this.resize = () => { X = null; draw(); };
    this.kind = 'canvas';
  }

  /* ---------- UI rendering ---------- */
  function segFC(top3, searched) {
    const M = S.M, rank = new Map(top3.map((s, j) => [s.id, j + 1]));
    return FC(M.segList.filter((g) => g.polygon).map((g) => {
      const r = rank.get(g.id), sel = g.id === S.selected;
      return poly(g.polygon, sel ? { color: '#5ce1e6', width: 4.5, opacity: 1, z: 3 } : r ? { color: '#ffffff', width: 3.2, opacity: 1, z: 2 } : { color: '#ffffff', width: 1, opacity: 0.4, z: 1 });
    }));
  }

  function render() {
    const M = S.M, step = S.step, h = M.hints[step];
    const p = compute(step), st = stats(p);
    S.lastStats = st; S.lastP = p;
    const prevSt = step > 0 ? stats(compute(step - 1)) : null;
    const top3 = st.slice(0, 3);
    const searched = searchedState(step);
    const ov = overlays(step, top3);
    S.view.setHeat(p);
    S.view.setSegments(segFC(top3, searched));
    S.view.setOverlay(ov.fc);
    S.view.setChips(ov.chips);

    // header
    $('#clock').textContent = h.t;
    // step card
    const evd = h.ev && h.ev.detail ? `<div class="sc-detail">${esc(h.ev.detail)}</div>` : '';
    let effect = '';
    if (prevSt) {
      const prevMap = new Map(prevSt.map((s) => [s.id, s.poa]));
      const mv = st.map((s) => ({ id: s.id, d: s.poa - (prevMap.get(s.id) || 0) })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3).filter((x) => Math.abs(x.d) >= 0.001);
      effect = mv.length ? `<div class="sc-effect">Zmiana: ${mv.map((x) => `<span class="${x.d >= 0 ? 'up' : 'down'}">${esc(x.id)} ${pp(x.d)}</span>`).join(' ')}</div>` : '';
    }
    const offNote = S.disabled.has(h.id) ? '<div class="sc-off">Ta wskazówka jest wyłączona w widoku.</div>' : '';
    const leadChange = prevSt && prevSt[0].id !== st[0].id ? `<div class="sc-lead">Zmiana lidera (było: <b>${esc(prevSt[0].id)} ${esc(prevSt[0].name)}</b>)</div>` : '';
    const fi = foundInfo();
    const foundLine = fi && step >= fi.k ? `<div class="sc-lead">Znaleziony w: <b>${esc(fi.seg)} ${esc(fi.name)}</b>${fi.rank ? ` (#${fi.rank} w rankingu tuż przed)` : ''}</div>` : '';
    $('#stepcard').innerHTML = `<div class="sc-head"><span class="ic k-${esc(h.kind)}">${kindOf(h.kind).icon}</span><span>Krok ${step + 1}/${M.hints.length} · ${esc(h.t)} · ${esc(kindOf(h.kind).pl)}</span></div>
      <div class="sc-title">Nowa wskazówka: ${esc(h.label)}</div>${evd}${effect}${offNote}
      <div class="sc-lead">Prowadzi: <b>${esc(top3[0].id)} ${esc(top3[0].name)}</b> ${pct(top3[0].poa, 0)}</div>${leadChange}${foundLine}<div class="sc-wx" id="scwx"></div>`;
    // banner for modified view
    const off = M.hints.filter((x) => x.k <= step && S.disabled.has(x.id));
    const mb = $('#modbanner');
    if (off.length) { mb.hidden = false; mb.innerHTML = `Widok przeliczony w przeglądarce bez: ${off.map((x) => '<b>' + esc(short(x.label, 34)) + '</b>').join(', ')} <button id="resetoff" class="ghost sm">Przywróć</button>`; $('#resetoff').onclick = () => { S.disabled.clear(); render(); }; }
    else mb.hidden = true;
    // weather badge
    const wb = $('#scwx'), W = M.R.steps[step].weather;
    if (W && typeof W === 'object') {
      const parts = [W.visibilityM != null ? `widoczność ${nf(W.visibilityM, 0)} m` : '', W.windMs != null ? `wiatr ${nf(W.windMs, 0)} m/s` : '', W.tempC != null ? `${nf(W.tempC, 0)}°C` : '', W.precip && W.precip !== 'none' ? PRECIP[W.precip] || W.precip : '', W.dark ? 'noc' : '', W.ice ? 'lód' : ''].filter(Boolean);
      const sv = W.survival || {};
      wb.hidden = false;
      wb.innerHTML = `<span class="ic k-conditions">${KINDS.conditions.icon}</span><span>${esc(parts.join(' · '))}</span>${sv.level ? `<span class="surv lv-${esc(String(sv.level).replace(/[^a-ząćęłńóśźż]/gi, ''))}" title="${esc(sv.text || '')}">hipotermia: ${esc(sv.level)}</span>` : ''}`;
    } else if (ov.weather) { wb.hidden = false; wb.innerHTML = `<span class="ic k-weather">${KINDS.weather.icon}</span>${esc(short(ov.weather.label, 48))}`; } else wb.hidden = true;

    renderCards();
    renderLive();
    renderPlan();
    renderRanking(st, searched);
    renderValue(st);
    renderProgress();
    renderTimeline();
    link3d();
    document.body.dataset.step = String(step);
  }

  function renderCards() {
    const M = S.M, step = S.step;
    const html = M.hints.map((h) => {
      const future = h.k > step, isNew = h.k === step, off = S.disabled.has(h.id);
      const det = h.ev && h.ev.detail ? `<div class="c-det">${esc(h.ev.detail)}</div>` : '';
      const status = future ? `<span class="c-status">jeszcze nie dotarła</span>` : isNew ? '<span class="c-status new">nowa</span>' : '';
      const inf = future ? null : influence(h.k);
      const infl = inf ? `<div class="c-inf" title="Segment, który zyskał najwięcej po dodaniu tej wskazówki (silnik)">wpływ: ${esc(inf.id)} ${esc(inf.name)} ${pp(inf.d)}</div>` : '';
      return `<div class="card${future ? ' future' : ''}${isNew ? ' new' : ''}${off ? ' off' : ''}" data-k="${h.k}">
        <div class="c-top"><span class="ic k-${esc(h.kind)}" title="${esc(kindOf(h.kind).pl)}">${kindOf(h.kind).icon}</span>
          <span class="c-meta">${esc(h.t)} · ${esc(h.source)}</span>${status}</div>
        <div class="c-title">${esc(h.label)}</div>${det}${infl}
        <div class="c-act">
          <label class="chk"><input type="checkbox" data-act="toggle" ${off ? '' : 'checked'} ${future ? 'disabled' : ''}> uwzględnij</label>
          <button class="ghost sm" data-act="before" ${h.k === 0 ? 'disabled' : ''} title="Skocz do kroku przed tą wskazówką">Przed</button>
          <button class="ghost sm" data-act="after" title="Skocz do kroku z tą wskazówką">Po</button>
        </div></div>`;
    }).join('');
    const box = $('#cards');
    const scroll = box.parentElement.scrollTop;
    box.innerHTML = html;
    box.parentElement.scrollTop = scroll;
  }

  function initLive() {
    $('#live').innerHTML = `<section class="live"><h3>Zgłoszenia z terenu <span class="live-dot" id="livedot"></span></h3>
      <div class="live-status" id="livestatus"></div><ul id="livelist"></ul>
      <details class="ff"><summary>Nowy meldunek z terenu</summary><form id="fieldform" class="fieldform" autocomplete="off">
        <textarea id="fieldtext" rows="2" placeholder="Meldunek, np. Patrol 2: przeszukaliśmy żleb pod Zawratem, nic, widoczność 20 m"></textarea>
        <div class="ff-row"><input id="fieldat" placeholder="hh:mm" size="5" maxlength="5" title="Opcjonalnie: czas scenariusza"><button class="primary sm" type="submit">Wyślij meldunek</button></div>
        <label class="ff-pin" id="pinbox" hidden>PIN serwera <input id="pin" inputmode="numeric" autocomplete="off" size="8" title="PIN z terminala rescue-field (tryb LAN). Zapamiętany w tej przeglądarce, nie trafia do adresu."></label>
        <div class="ff-msg" id="fieldmsg"></div>
        <div class="live-note">Idzie do lokalnego <code>rescue-field</code> (${esc(CFG.field.replace(/^https?:\/\//, ''))}, offline). Na mapie jako znaczniki; do POA wlicza je silnik przy kolejnym przebiegu.</div>
      </form></details></section>`;
    if (!FIELD_LOOPBACK) {
      $('#pinbox').hidden = false;
      $('#pin').value = PIN;
      $('#pin').addEventListener('change', () => { PIN = $('#pin').value.trim(); try { localStorage.setItem('rescue-pin', PIN); } catch (e) { /* ignore */ } pollLive(false); });
    }
    $('#fieldform').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = $('#fieldtext').value.trim(), at = $('#fieldat').value.trim(), msg = $('#fieldmsg');
      if (!text) { msg.textContent = 'Wpisz treść meldunku.'; return; }
      msg.textContent = 'Wysyłam...';
      try {
        const body = at ? { text, at } : { text };
        const url = CFG.field.replace(/\/$/, '') + '/report';
        const r = await fetch(url, { method: 'POST', headers: pinHeaders(url, { 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
        if (r.status === 401) { msg.textContent = PIN ? 'Zły PIN - wpisz PIN wyświetlony w terminalu rescue-field.' : 'Serwer wymaga PIN-u (tryb LAN): wpisz PIN wyświetlony w terminalu rescue-field.'; return; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const ev = await r.json().catch(() => null);
        msg.textContent = ev && ev.parsedBy ? `Przyjęty (${ev.parsedBy}${ev.latencyMs != null ? ', ' + ev.latencyMs + ' ms' : ''}).` : 'Przyjęty.';
        $('#fieldtext').value = '';
        pollLive(false);
      } catch (err) {
        msg.textContent = `Serwer rescue-field nie odpowiada (${err.message}). Uruchom: cd rescue && swift run rescue-field serve`;
      }
    });
  }
  function renderLive() {
    const list = $('#livelist'); if (!list) return;
    list.innerHTML = S.live.slice().reverse().map((e) => `<li class="${e.fresh ? 'fresh' : ''}"><span class="ic k-report">${kindOf('report').icon}</span><div>
      <div class="c-meta">${esc(e.t || '--:--')}${e.source ? ' · ' + esc(e.source) : ''}${e.parsedBy ? ` · <span title="${esc(e.parsedBy)}">${esc(parsedShort(e.parsedBy))}</span>` : ''}</div>
      <div class="c-title">${esc(e.text)}</div>
      ${e.hints.length ? `<div class="lh">${e.hints.map((h) => `<span class="lh-i lh-${esc(h.type)}">${esc(h.text)}</span>`).join('')}</div>` : ''}
      ${e.note ? `<div class="c-det">${esc(e.note)}</div>` : ''}</div></li>`).join('');
    $('#livestatus').textContent = S.liveStatus;
    $('#livedot').classList.toggle('on', S.live.length > 0);
  }

  function renderRanking(st, searched) {
    const M = S.M, max = st[0].poa || 1;
    const truth = M.R.value && findSegOf(M.R.value);
    $('#rankmode').textContent = S.disabled.size && M.hints.some((h) => h.k <= S.step && S.disabled.has(h.id)) ? 'przeliczony w przeglądarce' : 'silnik, krok ' + (S.step + 1);
    $('#ranking tbody').innerHTML = st.map((s, j) => {
      const top = j < 3, sr = searched[s.id];
      const tags = (sr ? `<span class="tag-s">przeszukany${sr.pod != null ? ' POD ' + pct(sr.pod) : ''}</span>` : '') + (S.showTruth && s.id === truth ? '<span class="tag-t">odnaleziony</span>' : '');
      const task = top ? `<div class="task">${esc(taskFor(s.name))}</div>` : '';
      return `<tr class="${top ? 'top' : ''}${s.id === S.selected ? ' sel' : ''}" data-seg="${esc(s.id)}">
        <td class="rk">${top ? `<span class="badge">${j + 1}</span>` : j + 1}</td>
        <td class="nm"><b>${esc(s.id)}</b> ${esc(s.name)} ${tags}${task}</td>
        <td class="n poa">${pctAuto(s.poa)}<i class="bar" style="width:${(100 * s.poa) / max}%"></i></td>
        <td class="n">${nf(s.areaPct, 1)}%</td>
        <td class="n">${nf(s.density, 1)}x</td></tr>`;
    }).join('');
    const top3 = st.slice(0, 3);
    const tp = top3.reduce((a, s) => a + s.poa, 0), ta = top3.reduce((a, s) => a + s.areaPct, 0);
    const tr = truth ? st.findIndex((s) => s.id === truth) + 1 : 0;
    $('#nowline').innerHTML = `Teraz (${esc(M.hints[S.step].t)}): top 3 = <b>${pct(tp)}</b> w <b>${nf(ta, 0)}%</b> obszaru` + (S.showTruth && tr ? `, ${esc(truth)} na <b>#${tr}</b>` : '');
  }

  const RES_SHORT = { ground: 'Patrol', dog: 'Pies', drone: 'Dron', heli: 'Śmigłowiec', boat: 'Łódź', diver: 'Nurek' };
  const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')} min` : `${Math.round(m)} min`);
  function renderPlan() {
    const st = S.M.R.steps[S.step], A = st.assignments, Rs = st.resources;
    if (!Array.isArray(A) && !Array.isArray(Rs)) { $('#plan').innerHTML = ''; return; }
    const res = new Map((Rs || []).map((r) => [r.id, r]));
    const items = (A || []).map((a) => {
      const r = res.get(a.resourceId) || { name: a.resourceId };
      const safety = (a.safety || []).map((x) => `<div class="as-safe">${esc(x)}</div>`).join('');
      return `<li class="as" data-seg="${esc(a.segmentId)}"><div class="as-h"><span class="as-res">${esc(r.name)}</span> <span class="as-arrow">→</span> <b>${esc(a.segmentId)}</b> ${esc(a.segmentName || '')}</div>
        <div class="as-m">ETA <b>${fmtMin(a.etaMin)}</b> · szansa znalezienia <b>${pct(a.expectedFind, 1)}</b> · POD ${pct(a.pod)}</div>
        <div class="as-r">${esc(a.reason || '')}</div>${safety}</li>`;
    }).join('');
    const down = (Rs || []).filter((r) => !r.available).map((r) => `<li><span class="as-res">${esc(r.name)}</span> - ${esc(r.reason || 'niedostępny')}</li>`).join('');
    $('#plan').innerHTML = `<h2>Przydział zespołów <span class="mode">silnik, ${esc(st.t)}</span></h2>
      ${items ? `<ol class="assign">${items}</ol>` : '<p class="mute sm">Brak dostępnych zespołów w tym kroku.</p>'}
      ${down ? `<ul class="down">${down}</ul>` : ''}`;
  }

  // parity with 3D: operation progress from the timeline (searched segments, cumulative POA x POD, lead POA); nothing new about the person
  const toMin = (t) => { const [hh, mm] = String(t).split(':').map(Number); return hh * 60 + mm; };
  function progressOf(M) {
    if (M.prog) return M.prog;
    const R = M.R, t0 = toMin(R.steps[0].t), area = new Map(R.steps[0].segments.map((x) => [x.id, x.areaPct]));
    const seen = new Set(); let pos = 0, last = t0;
    M.prog = R.steps.map((st, k) => {
      let m = toMin(st.t); if (m < last - 600) m += 1440; last = m; // after midnight
      const h = M.hints[k];
      if (h.kind === 'searched' && h.segIds.length) {
        const prev = new Map(R.steps[Math.max(0, k - 1)].segments.map((x) => [x.id, x.poa]));
        for (const id of h.segIds) { pos += (prev.get(id) || 0) * (h.pod != null ? h.pod : 0.7); seen.add(id); }
      }
      return { k, min: m - t0, lead: Math.max(...st.segments.map((x) => x.poa)), pos: Math.min(pos, 1), searched: seen.size,
        area: [...seen].reduce((a, id) => a + (area.get(id) || 0), 0) / 100, found: isFoundHint(h) };
    });
    return M.prog;
  }
  function renderProgress() {
    const P = progressOf(S.M), i = S.step, cur = P[i], W = 320, H = 74, maxMin = Math.max(1, P[P.length - 1].min);
    const X = (m) => 6 + (m / maxMin) * (W - 12), Y = (v) => H - 6 - v * (H - 14);
    const path = (f, upto) => P.slice(0, upto + 1).map((q, k) => `${k ? 'L' : 'M'}${X(q.min).toFixed(1)},${Y(f(q)).toFixed(1)}`).join('');
    const line = (f, c, upto, w, o) => `<path d="${path(f, upto)}" fill="none" style="stroke:${c}" stroke-width="${w}" opacity="${o}"/>`;
    const series = [[(q) => q.area, 'var(--mute)'], [(q) => q.pos, 'var(--accent)'], [(q) => q.lead, 'var(--bad)']];
    const dots = P.map((q) => `<circle cx="${X(q.min).toFixed(1)}" cy="${H - 3}" r="${q.found ? 3.5 : 1.8}" style="fill:${q.found ? 'var(--ok)' : q.k <= i ? 'var(--ink-2)' : 'var(--line)'}"/>`).join('');
    $('#progress').innerHTML = `<h2>Przebieg akcji <span class="mode">${Math.floor(cur.min / 60)} h ${String(cur.min % 60).padStart(2, '0')} min od zgłoszenia</span></h2>
      <div class="pg-kpi"><div><b>${cur.searched}</b><span>segm. przeszukane</span></div><div><b>${pct(cur.area)}</b><span>obszaru</span></div>
        <div><b class="pos">${pct(cur.pos)}</b><span>szansa znalezienia dotąd</span></div><div><b class="lead">${pctAuto(cur.lead)}</b><span>lider mapy</span></div></div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" aria-label="Wykres przebiegu akcji">
        ${series.map(([f, c]) => line(f, c, P.length - 1, 1.2, 0.25)).join('')}${series.map(([f, c]) => line(f, c, i, 2.2, 1)).join('')}
        <line x1="${X(cur.min)}" x2="${X(cur.min)}" y1="4" y2="${H - 6}" style="stroke:var(--ink-2)" stroke-dasharray="2 2" opacity="0.6"/>${dots}
      </svg>
      <div class="pg-leg"><i style="background:var(--bad)"></i>lider mapy <i style="background:var(--accent)"></i>szansa znalezienia (Σ POA×POD) <i style="background:var(--mute)"></i>przeszukany obszar</div>`;
  }

  function renderValue() {
    const M = S.M, v = M.R.value;
    if (!v) { $('#value').innerHTML = '<h2>Wartość</h2><p class="mute">Brak bloku value w run.json.</p>'; return; }
    const at = M.hints[v.beforePing] || M.hints[M.hints.length - 1];
    const next = M.hints[v.beforePing + 1];
    const when = next && next.kind === 'point' ? `${esc(at.t)}, przed ${/ratunek/i.test(next.source) ? 'pingiem Ratunek' : 'punktem GPS'}` : esc(at.t);
    $('#value').innerHTML = `<h2>Wartość <span class="mode">silnik, ${when}</span></h2>
      <div class="v-big">${pct(v.top3poa)} <span>wagi mapy</span></div>
      <div class="v-sub">w <b>${pct(v.top3area)}</b> obszaru - top 3 segmenty z ${M.segList.length}</div>
      <div class="v-row"><span class="v-num ok">#${v.rankFused}</span><span class="v-vs">vs</span><span class="v-num">#${v.rankRings}</span>
        <span class="v-txt">miejsce odnalezienia (${esc(findSegOf(v))}): po fuzji wskazówek vs same pierścienie Koestera</span></div>
      <div class="v-row"><span class="v-num ok">${pct(v.areaFused, 1)}</span><span class="v-vs">vs</span><span class="v-num">${pct(v.areaRings, 1)}</span>
        <span class="v-txt">obszaru do przeszukania, zanim zespół trafi</span></div>
      ${v.pos2hPlanned != null && v.pos2hNaive != null ? `<div class="v-row"><span class="v-num ok">${pct(v.pos2hPlanned)}</span><span class="v-vs">vs</span><span class="v-num">${pct(v.pos2hNaive)}</span>
        <span class="v-txt">szansa znalezienia w 2 h: przydział silnika vs "największe POA najpierw"</span></div>` : ''}
      <div class="v-act"><button class="ghost sm" id="gobp">Pokaż krok ${esc(at.t)}</button>
        <label class="chk"><input type="checkbox" id="truth" ${S.showTruth ? 'checked' : ''}> miejsce odnalezienia (backtest)</label></div>`;
    $('#gobp').onclick = () => { stop(); S.disabled.clear(); setStep(v.beforePing); };
    $('#truth').onchange = (e) => { S.showTruth = e.target.checked; render(); };
  }

  function renderTimeline() {
    const M = S.M, n = M.hints.length;
    const sl = $('#slider'); sl.max = String(n - 1); sl.value = String(S.step);
    $('#stepno').innerHTML = `<b>${S.step + 1}</b>/${n}`;
    const ticks = $('#ticks');
    if (ticks.childElementCount !== n) {
      ticks.innerHTML = M.hints.map((h, k) => {
        const showT = k === 0 || M.hints[k - 1].t !== h.t;
        return `<button class="tick" data-k="${k}" style="left:${n > 1 ? (100 * k) / (n - 1) : 0}%" title="${esc(h.t + ' ' + h.label)}"><span class="ic k-${esc(h.kind)}">${kindOf(h.kind).icon}</span>${showT ? `<span class="tt">${esc(h.t)}</span>` : ''}</button>`;
      }).join('');
    }
    [...ticks.children].forEach((b, k) => { b.classList.toggle('done', k <= S.step); b.classList.toggle('cur', k === S.step); });
    $('#play').textContent = S.playing ? 'Pauza' : 'Odtwórz';
    $('#prev').disabled = S.step === 0; $('#next').disabled = S.step === n - 1;
  }

  function renderLegend() {
    if (S.showDiff) {
      const cls = S.M.R.difficultyClasses || [];
      $('#legend').innerHTML = `<div class="lg-title">Trudność terenu (silnik)</div><div class="lg-diff">${cls.map((c) => `<span><i class="lg-sw" style="background:${DIFF_COLORS[c.id] || '#000'}"></i>${esc(c.label)}</span>`).join('')}</div>`;
      return;
    }
    $('#legend').innerHTML = `<div class="lg-title">Prawdopodobieństwo × średnia komórka</div><div class="lg-ramp" style="background:${SCALE.gradientCSS()}"></div>
      <div class="lg-stops">${SCALE.STOPS.map((x) => `<span>${x.label}</span>`).join('')}</div>
      <div class="lg-note">1× = średnio ${pct(1 / S.M.N, 3)} na komórkę 100 x 100 m; poniżej 0,5× bez koloru</div>
      <div class="lg-keys"><span><i class="k ln-seg"></i>top 3</span><span><i class="k ln-srch"></i>przeszukany</span></div>`;
  }

  function renderBaseSwitch() {
    const labels = { map: 'Mapa', relief: 'Teren', topo: 'Topo online', osm: 'OSM online', none: 'Brak' };
    const box = $('#mapctl .seg-switch');
    box.innerHTML = S.bases.map((b) => `<button data-base="${b}" class="${b === S.base ? 'on' : ''}">${labels[b]}</button>`).join('');
  }
  function setBase(b) {
    if (!S.bases.includes(b)) return;
    S.base = b; S.view.setBase(b); renderBaseSwitch();
    document.body.dataset.basemap = b;
  }

  /* ---------- interaction ---------- */
  function setStep(k, fromParent) {
    const n = S.M.hints.length, prev = S.step;
    S.step = Math.max(0, Math.min(n - 1, k));
    render();
    if (!fromParent && S.step !== prev) toParent({ type: 'step', i: S.step, t: S.M.hints[S.step].t });
  }
  function play() {
    if (S.playing) return stop();
    if (S.step >= S.M.hints.length - 1) S.step = -1;
    S.playing = true; setStep(S.step + 1);
    S.timer = setInterval(() => { if (S.step >= S.M.hints.length - 1) return stop(); setStep(S.step + 1); }, CFG.playMs);
  }
  function stop() { S.playing = false; clearInterval(S.timer); S.timer = null; if (S.M) renderTimeline(); }
  function selectSeg(id, fromParent) {
    S.selected = fromParent ? id : (S.selected === id ? null : id); // parent sets, user clicks toggle
    render();
    const g = S.M.segs.get(id);
    if (S.selected && g) S.view.fitSeg(g);
    if (!fromParent) toParent({ type: 'select', segmentId: S.selected });
  }

  /* ---------- embed API (postMessage; same shapes as web/3d, tagged source: 'rescue2d') ---------- */
  // in:  {type:'run', run} | {type:'run', url} | {type:'run', run: {url}} | {type:'step', i} | {type:'select', segmentId|null}
  // out: {source:'rescue2d', type:'ready', version, scenario, steps, step} | {..., type:'step', i, t} | {..., type:'select', segmentId}
  function toParent(msg) {
    if (window.parent === window) return;
    try { window.parent.postMessage({ source: 'rescue2d', ...msg }, PARENT_ORIGIN); } catch (e) { warn('postMessage: ' + e.message); }
  }
  function onParentMessage(e) {
    if (e.source !== window.parent || window.parent === window || e.origin !== PARENT_ORIGIN) return;
    const m = e.data;
    if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.type !== 'string') return;
    if (!S.M || document.body.dataset.state !== 'ready') { (S.pendingMsgs = S.pendingMsgs || []).push(m); return; }
    applyParentMessage(m);
  }
  function reloadWith(set, del) {
    const u = new URL(location.href);
    Object.entries(set).forEach(([k, v]) => u.searchParams.set(k, v));
    del.forEach((k) => u.searchParams.delete(k));
    location.replace(u.href);
  }
  function applyParentMessage(m) {
    try {
      if (m.type === 'insets' && Array.isArray(m.insets) && m.insets.length === 4) { INSETS = m.insets.map((v) => +v || 0); applyInsets(); }
      else if (m.type === 'step' && Number.isInteger(m.i)) { stop(); setStep(m.i, true); }
      else if (m.type === 'select' && (m.segmentId === null || (typeof m.segmentId === 'string' && S.M.segs.has(m.segmentId)))) selectSeg(m.segmentId, true);
      else if (m.type === 'run' && typeof m.url === 'string') reloadWith({ run: m.url }, ['runInline', 'sc', 'step']);
      else if (m.type === 'run' && m.run && typeof m.run === 'object' && typeof m.run.url === 'string' && !m.run.schema) reloadWith({ run: m.run.url }, ['runInline', 'sc', 'step']);
      else if (m.type === 'run' && m.run && typeof m.run === 'object') {
        const errs = checkRun(m.run);
        if (errs.length) { warn('embed: run rejected (' + errs.join('; ') + ')'); return; }
        sessionStorage.setItem('rescue2d-run', JSON.stringify(m.run)); // parked for the reload; the map is built per run at boot
        reloadWith({ runInline: '1' }, ['run', 'sc', 'step']);
      }
    } catch (err) { warn('embed message ignored: ' + err.message); }
  }
  window.addEventListener('message', onParentMessage);
  // insets (plumbing): in /app the shell's floating panels cover the frame's edges (?insets=T,R,B,L px, then {type:'insets'});
  // MapLibre pads its camera so the scenario sits in the free area, and the overlays read --inset-* (style.css)
  let INSETS = (Q.get('insets') || '').split(',').map(Number);
  if (INSETS.length !== 4 || INSETS.some((v) => !isFinite(v))) INSETS = [0, 0, 0, 0];
  function applyInsets() {
    const [T, Rr, Bm, L] = INSETS, st = document.documentElement.style;
    [['t', T], ['r', Rr], ['b', Bm], ['l', L]].forEach(([k, v]) => st.setProperty('--inset-' + k, v + 'px'));
    const map = S.view && S.view.map; if (!map || !S.M) return;
    const { west, south, east, north } = S.M.bbox;
    map.setPadding({ top: T, right: Rr, bottom: Bm, left: L });
    map.fitBounds([[west, south], [east, north]], { padding: 24, duration: 0 });
  }
  function onHover(i, pt) {
    const tip = $('#tip');
    if (i == null || !S.lastP) { tip.hidden = true; return; }
    const M = S.M, r = Math.floor(i / M.cols), c = i % M.cols, g = M.segList[M.segOfIdx[i]];
    const sl = M.T && M.T.slopeDeg && M.T.slopeDeg.length === M.N ? ` · nachylenie ${nf(M.T.slopeDeg[i], 0)}°` : '';
    tip.innerHTML = `<b>${pctAuto(S.lastP[i])}</b> POA komórki (${r}, ${c})<br>${esc(g.id)} ${esc(g.name)}${sl}`;
    tip.hidden = false; tip.style.left = pt.x + 14 + 'px'; tip.style.top = pt.y + 14 + 'px';
  }

  function wire() {
    $('#play').onclick = play;
    $('#prev').onclick = () => { stop(); setStep(S.step - 1); };
    $('#next').onclick = () => { stop(); setStep(S.step + 1); };
    $('#slider').oninput = (e) => { stop(); setStep(+e.target.value); };
    $('#ticks').onclick = (e) => { const b = e.target.closest('.tick'); if (b) { stop(); setStep(+b.dataset.k); } };
    $('#cards').addEventListener('click', (e) => {
      const card = e.target.closest('.card'); if (!card) return;
      const k = +card.dataset.k, act = e.target.dataset.act;
      if (act === 'before') { stop(); setStep(k - 1); }
      if (act === 'after') { stop(); setStep(k); }
    });
    $('#cards').addEventListener('change', (e) => {
      if (e.target.dataset.act !== 'toggle') return;
      const k = +e.target.closest('.card').dataset.k, id = S.M.hints[k].id;
      if (e.target.checked) S.disabled.delete(id); else S.disabled.add(id);
      render();
    });
    $('#plan').addEventListener('click', (e) => { const li = e.target.closest('li.as'); if (li) selectSeg(li.dataset.seg); });
    $('#ranking tbody').addEventListener('click', (e) => { const tr = e.target.closest('tr'); if (tr) selectSeg(tr.dataset.seg); });
    $('#mapctl').addEventListener('click', (e) => { const b = e.target.closest('[data-base]'); if (b) setBase(b.dataset.base); });
    $('#fullnames').onchange = (e) => { S.fullNames = e.target.checked; render(); };
    $('#difficulty').onchange = (e) => { S.showDiff = e.target.checked; S.view.setDiff(S.showDiff); renderLegend(); };
    $('#fitall').onclick = () => { S.selected = null; render(); S.view.fitAll(); };
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
      if (e.key === 'ArrowRight') { stop(); setStep(S.step + 1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { stop(); setStep(S.step - 1); e.preventDefault(); }
      else if (e.key === ' ') { play(); e.preventDefault(); }
      else if (e.key === 'Home') { stop(); setStep(0); }
      else if (e.key === 'End') { stop(); setStep(S.M.hints.length - 1); }
    });
  }

  /* ---------- live field reports (tolerant reader) ---------- */
  function pickLatLon(v) {
    if (!v) return null;
    if (Array.isArray(v) && v.length >= 2 && isFinite(v[0]) && isFinite(v[1])) {
      const a = +v[0], b = +v[1];
      const isLat = (x) => x > 40 && x < 60, isLon = (x) => x > 10 && x < 30;
      if (isLat(a) && isLon(b)) return [b, a];
      if (isLon(a) && isLat(b)) return [a, b];
      return [b, a]; // contract default [lat, lon]
    }
    if (typeof v === 'object') {
      if (v.type === 'Point' && Array.isArray(v.coordinates)) return [+v.coordinates[0], +v.coordinates[1]];
      if (v.geometry) return pickLatLon(v.geometry);
      const lat = v.lat ?? v.latitude, lon = v.lon ?? v.lng ?? v.longitude;
      if (isFinite(lat) && isFinite(lon)) return [+lon, +lat];
    }
    return null;
  }
  function hhmm(v) {
    if (!v) return '';
    const s = String(v);
    if (/^\d{1,2}:\d{2}/.test(s)) return s.slice(0, 5);
    const d = new Date(s); return isNaN(d) ? s : d.toTimeString().slice(0, 5);
  }
  const plMeldunek = (n) => (n === 1 ? 'meldunek' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'meldunki' : 'meldunków');
  const parsedShort = (p) => (/^llm/i.test(p) ? 'LLM lokalny' : /rule|reguł/i.test(p) ? 'reguły' : p);
  const STRENGTH = { strong: 'silny', medium: 'średni', weak: 'słaby' };
  const PRECIP = { none: 'bez opadu', rain: 'deszcz', snow: 'śnieg' };
  function liveHint(h) {
    const seg = h.segmentId && S.M && S.M.segs.get(h.segmentId);
    const segTxt = h.segmentId ? `${h.segmentId}${seg ? ' ' + seg.name : ''}` : '';
    let lonlat = (isFinite(h.lat) && isFinite(h.lon) && h.lat != null && h.lon != null) ? [+h.lon, +h.lat] : null;
    if (!lonlat && seg && (h.type === 'segmentSearched' || h.type === 'clue')) lonlat = seg.center;
    let text;
    switch (h.type) {
      case 'segmentSearched': text = `Przeszukano ${segTxt || '?'}${h.pod != null ? ', POD ' + pct(h.pod) : ''}${h.resource ? ' (' + h.resource + ')' : ''}, nic`; break;
      case 'clue': text = `Trop${segTxt ? ' w ' + segTxt : ''}: ${h.description || '?'}${h.strength ? ' (' + (STRENGTH[h.strength] || h.strength) + ')' : ''}`; break;
      case 'weatherObs': text = 'Pogoda: ' + [h.visibilityM != null ? `widoczność ${h.visibilityM} m` : '', h.windMs != null ? `wiatr ${h.windMs} m/s` : '', h.precip ? PRECIP[h.precip] || h.precip : ''].filter(Boolean).join(', '); break;
      case 'resourceStatus': text = `${h.resource || 'Zasób'}: ${h.available === false ? 'niedostępny' : h.available ? 'dostępny' : '?'}${h.reason ? ' - ' + h.reason : ''}`; break;
      default: text = h.description || h.type || 'wskazówka';
    }
    return { type: h.type || 'other', text, lonlat, segId: h.segmentId || null };
  }
  // Contract (rescue/README.md "out/live-events.json"): append-only array of
  // { t: ISO wall clock, at?: "HH:mm" scenario clock, source, text, parsedBy, latencyMs, note?, hints: [{type, ...}] }.
  // Tolerant: also accepts {events|reports: [...]}, and a lat/lon on the report itself.
  function normLive(json) {
    const arr = Array.isArray(json) ? json : json ? json.events || json.reports || json.items || [] : [];
    return arr.filter((e) => e && typeof e === 'object').map((e, j) => {
      const t = /^\d{1,2}:\d{2}$/.test(String(e.at || '')) ? e.at : hhmm(e.t || e.time || e.timestamp);
      const hints = Array.isArray(e.hints) ? e.hints.filter((h) => h && typeof h === 'object').map(liveHint) : [];
      const own = pickLatLon(e.point) || pickLatLon(e.position) || pickLatLon(e.location) || (isFinite(e.lat) && isFinite(e.lon) && e.lat != null ? [+e.lon, +e.lat] : null);
      return { id: `${j}|${e.t || ''}|${e.text || ''}`, t, text: String(e.text || e.title || e.message || 'Meldunek'), source: e.source || '', parsedBy: e.parsedBy || '', note: e.note || '', hints, lonlat: own };
    });
  }
  async function pollLive(first) {
    try {
      const r = await fetch(CFG.live, { cache: 'no-store', headers: pinHeaders(CFG.live) });
      const now = new Date().toTimeString().slice(0, 8);
      if (r.status === 401) { S.liveStatus = 'Serwer meldunków wymaga PIN-u: wpisz PIN wyświetlony w terminalu rescue-field (pole PIN niżej).'; }
      else if (!r.ok) { S.liveStatus = `Brak pliku ${CFG.live.split('/').pop()} - czekam (${now})`; }
      else {
        const items = normLive(await r.json());
        items.forEach((x) => { x.fresh = !first && !S.liveSeen.has(x.id); S.liveSeen.add(x.id); });
        const changed = items.length !== S.live.length || items.some((x) => x.fresh);
        S.live = items;
        S.liveStatus = `${items.length} ${plMeldunek(items.length)}, odświeżono ${now}`;
        if (changed && S.M && S.view) { render(); return; }
      }
    } catch (e) {
      S.liveStatus = 'Meldunki: plik niedostępny lub niepoprawny - czekam';
    }
    renderLive();
  }
  async function pollRun() {
    if (CFG.run === 'inline') return; // parent-supplied run: nothing to poll
    try {
      const r = await fetch(CFG.run, { method: 'HEAD', cache: 'no-store', headers: runPin(CFG.run) });
      const sig = (r.headers.get('last-modified') || '') + '|' + (r.headers.get('content-length') || '');
      if (sig !== '|' && S.lastRunSig && sig !== S.lastRunSig) {
        S.lastRunSig = sig;
        const R = await fetchJSON(CFG.run);
        if (!checkRun(R).length) {
          const wasLast = S.step === S.M.hints.length - 1;
          S.M = buildModel(R, S.M.scen, S.M.T);
          $('#incident').textContent = `${R.incident} · ${R.date}`;
          $('#ticks').innerHTML = '';
          setStep(wasLast ? S.M.hints.length - 1 : Math.min(S.step, S.M.hints.length - 1));
          flashNote('Silnik zapisał nowy run.json - wczytano');
        }
      } else if (sig !== '|') S.lastRunSig = sig;
    } catch (e) { /* offline / file missing: keep current */ }
  }
  function flashNote(msg, sticky) {
    const n = $('#netnote'); n.hidden = false; n.textContent = msg;
    clearTimeout(flashNote.t); if (!sticky) flashNote.t = setTimeout(() => { n.hidden = true; }, 6000);
  }

  /* ---------- basemap (optional, local PMTiles) ---------- */
  // 1) basemap/basemap.js (module API: loadBasemap + offlineStyle, in-memory PMTiles), 2) basemap/style.json, 3) none.
  async function loadBasemapStyle(useML) {
    if (CFG.basemap === 'none' || !useML) return null;
    const dir = CFG.basemap.endsWith('/') ? CFG.basemap : CFG.basemap.replace(/[^/]*$/, '');
    try {
      const head = await fetch(dir + 'basemap.js', { method: 'HEAD', cache: 'no-store' });
      if (head.ok) {
        const mod = await import(new URL(dir + 'basemap.js', location.href).href);
        const file = SC.basemapFile && (!CUSTOM_RUN || Q.get('sc') === SC.id) ? SC.basemapFile : undefined;   // regional PMTiles outside the Tatras (?sc= also with ?run=)
        await mod.loadBasemap(window.maplibregl, file);
        const style = mod.offlineStyle(file ? { flavor: CFG.flavor, file } : { flavor: CFG.flavor });
        if (style && style.layers) { S.basemapSrc = dir + 'basemap.js'; return style; }
      }
    } catch (e) { warn('basemap.js: ' + e.message); }
    const styleURL = CFG.basemap.endsWith('.json') ? CFG.basemap : dir + 'style.json';
    const style = await fetchJSON(styleURL, true);
    if (!style || !style.layers) return null;
    if (window.pmtiles && !S.pmReg) { try { maplibregl.addProtocol('pmtiles', new pmtiles.Protocol().tile); S.pmReg = true; } catch (e) { warn('pmtiles: ' + e.message); } }
    S.basemapSrc = styleURL;
    const base = styleURL;
    const fixPm = (u) => (u.startsWith('pmtiles://') && !/^pmtiles:\/\/[a-z]+:/i.test(u) ? 'pmtiles://' + new URL(u.slice(10), new URL(base, location.href)).href : u);
    for (const src of Object.values(style.sources || {})) {
      if (typeof src.url === 'string') src.url = src.url.startsWith('pmtiles://') ? fixPm(src.url) : resolveURL(src.url, base);
      if (Array.isArray(src.tiles)) src.tiles = src.tiles.map((t) => resolveURL(t, base));
      if (typeof src.data === 'string') src.data = resolveURL(src.data, base);
    }
    if (typeof style.glyphs === 'string') style.glyphs = resolveURL(style.glyphs, base);
    if (typeof style.sprite === 'string') style.sprite = resolveURL(style.sprite, base);
    else if (Array.isArray(style.sprite)) style.sprite = style.sprite.map((s) => ({ ...s, url: resolveURL(s.url, base) }));
    return style;
  }

  /* ---------- boot ---------- */
  function fatal(msg) {
    document.body.dataset.state = 'error';
    const f = $('#fatal'); f.hidden = false;
    f.innerHTML = `<h2>Nie udało się wczytać danych</h2><p>${esc(msg)}</p><p>Uruchom serwer z katalogu <code>rescue/</code>:<br><code>python3 -m http.server 8000</code><br>i otwórz <code>http://localhost:8000/web/</code>. Ścieżkę do danych można podać: <code>?run=../out/run.json</code>.</p>`;
    DIAG.errors.push('fatal: ' + msg); diag();
  }
  function webglOK() {
    try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
  }

  /* ---------- scenario switcher (header) ---------- */
  function initScenarioSwitcher() {
    const sel = $('#scensel'); if (!sel) return;
    sel.innerHTML = SCENARIOS.map((x) => `<option value="${x.id}">${esc(x.label)}</option>`).join('') +
      (CUSTOM_RUN ? `<option value="custom">Własny (?run=)</option>` : '');
    sel.value = CFG.sc;
    sel.addEventListener('change', () => {
      if (sel.value === 'custom') return;
      const q = new URLSearchParams(location.search);
      ['run', 'scenario', 'terrain', 'dem', 'step', 'sc', 'pin'].forEach((k) => q.delete(k));
      if (sel.value !== SCENARIOS[0].id) q.set('sc', sel.value);
      location.search = q.toString(); // reload: the map is built for one scenario bbox at boot
    });
    // discover which run.json files exist; missing ones are greyed out
    SCENARIOS.forEach(async (x) => {
      let ok = false;
      try { ok = (await fetch(x.run, { method: 'HEAD', cache: 'no-store', headers: runPin(x.run) })).ok; } catch (e) { ok = false; }
      const o = sel.querySelector(`option[value="${x.id}"]`);
      if (o && !ok) { o.disabled = true; o.textContent = `${x.label} (brak run.json)`; o.title = `Wygeneruj: cd rescue && swift run rescue-demo --fast scenarios/${x.id}.json`; }
    });
    if (!CUSTOM_RUN && !SC.basemap && !Q.get('basemap')) {
      const b = $('#basebadge'); b.hidden = false;
      b.textContent = 'Podkład mapy tylko dla Zawratu - tu relief z DEM';
      b.title = 'Offline basemap (basemap/) obejmuje bbox Zawratu. Dla tego scenariusza tło to cieniowanie z DEM albo nachylenie terenu.';
    }
  }

  async function boot() {
    if (!SCALE) return fatal('brak wspólnej skali ../app/scale.js (serwer musi działać w rescue/)');
    if (EMBED) {
      document.body.classList.add('embed'); if (EMBED !== '1') document.body.classList.add('embed-' + EMBED);
      // decision S1: embedded in the shell = its tokens (dark operational by default, ?theme=light for print), same as web/3d
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '../app/tokens.css'; document.head.appendChild(l);
      if (Q.get('theme') === 'light' || Q.get('theme') === 'dark') document.documentElement.dataset.theme = Q.get('theme');
    }
    wire();
    initScenarioSwitcher();
    initLive();
    let R;
    if (Q.has('runInline')) {
      try { R = JSON.parse(sessionStorage.getItem('rescue2d-run')); } catch (e) { R = null; }
      if (!R) return fatal('brak run.json przekazanego przez aplikację nadrzędną (sessionStorage)');
      CFG.run = 'inline';
    } else {
      try { R = await fetchJSON(CFG.run); } catch (e) { return fatal(`${CFG.run}: ${e.message}`); }
    }
    const errs = checkRun(R);
    if (errs.length) return fatal('run.json nie spełnia kontraktu rescue-run/1: ' + errs.join('; '));
    const scen = await fetchJSON(CFG.scenario, true);
    // The engine may widen its grid beyond the scenario bbox (by design), so the scenario is usable when its bbox lies
    // inside the run's bbox; overlays are drawn in lat/lon, independent of the grid.
    const eps = 1e-6, sb = scen && scen.bbox;
    const sameBox = !!(sb && sb.south >= R.bbox.south - eps && sb.north <= R.bbox.north + eps && sb.west >= R.bbox.west - eps && sb.east <= R.bbox.east + eps);
    if (scen && !sameBox) warn('bbox scenariusza wychodzi poza bbox run.json - pomijam warstwy scenariusza');
    const scenOK = sameBox ? scen : null;
    const terrainURL = CFG.terrain || CFG.scenario.replace(/\.json$/, '-terrain.json');
    const terrain = scenOK ? await fetchJSON(terrainURL, true) : null;
    const M = buildModel(R, scenOK, terrain);
    S.M = M;
    DIAG.info = { steps: M.hints.length, cells: M.N, segments: M.segList.length, scenario: !!scenOK, terrain: terrain ? terrainURL : (scenOK && scenOK.terrain ? 'scenario' : null) };

    // backgrounds
    const dem = await fetchJSON(CFG.dem, true);
    let relief = null;
    try { relief = dem && dem.z ? reliefFromDEM(dem) : reliefFromSlope(M); } catch (e) { warn('relief: ' + e.message); }
    if (!relief) relief = reliefFromSlope(M);
    const useML = CFG.renderer !== 'canvas' && !window.__mlFailed && !!window.maplibregl && webglOK();
    const baseStyle = await loadBasemapStyle(useML);
    S.bases = [baseStyle ? 'map' : null, relief ? 'relief' : null, CFG.tiles ? 'topo' : null, CFG.tiles ? 'osm' : null, 'none'].filter(Boolean);
    const want = Q.get('base');
    S.base = want && S.bases.includes(want) ? want : S.bases[0];

    $('#incident').textContent = `${R.incident} · ${R.date}`;
    const opt = {
      relief, baseStyle, tiles: CFG.tiles, onHover, onSegClick: selectSeg, onCellClick: (i) => selectSeg(M.segList[M.segOfIdx[i]].id),
      onSourceFail: (id) => {
        if ((id === 'topo' || id === 'osm') && S.base === id) { flashNote('Kafelki online niedostępne - pokazuję teren offline', true); setBase(S.bases.includes('relief') ? 'relief' : 'none'); }
        else if (baseStyle && baseStyle.sources && baseStyle.sources[id] && S.base === 'map') { flashNote('Podkład offline (basemap) nie wczytał się - pokazuję teren z DEM', true); setBase(S.bases.includes('relief') ? 'relief' : 'none'); }
      },
    };
    try {
      S.view = useML ? new MapLibreView($('#map'), M, opt) : new CanvasView($('#map'), M, opt);
    } catch (e) {
      warn('MapLibre nie wystartował (' + e.message + ') - widok Canvas');
      $('#map').innerHTML = '';
      S.view = new CanvasView($('#map'), M, opt);
    }
    if (!useML) flashNote(CFG.renderer === 'canvas' ? 'Widok zastępczy (Canvas), wymuszony parametrem' : window.__mlFailed || !window.maplibregl ? 'MapLibre niedostępny - widok zastępczy (Canvas)' : 'Brak WebGL - widok zastępczy (Canvas)', true);
    await S.view.ready;
    applyInsets();
    S.view.setBaseFC(baseFeatures(M));
    setBase(S.base);
    $('#diffwrap').hidden = !(Array.isArray(R.difficulty) && R.difficulty.length === M.N);
    renderLegend();
    const startStep = CFG.step != null && CFG.step !== '' ? +CFG.step : M.R.value ? M.R.value.beforePing : 0;
    S.step = Math.max(0, Math.min(M.hints.length - 1, isFinite(startStep) ? startStep : 0));
    await pollLive(true);
    render();
    document.body.dataset.state = 'ready';
    document.body.dataset.renderer = S.view.kind;
    DIAG.info.renderer = S.view.kind; DIAG.info.layers = S.view.layerCount(); DIAG.info.base = S.base; DIAG.info.bases = S.bases; DIAG.info.relief = relief ? relief.src : null;
    diag();
    setInterval(() => pollLive(false), CFG.livePollMs);
    setInterval(pollRun, CFG.runPollMs);
    pollRun();
    window.__rescue = { S, CFG, DIAG, setStep, compute, stats };
    toParent({ type: 'ready', version: EMBED_VERSION, scenario: CFG.sc, steps: M.hints.length, step: S.step });
    (S.pendingMsgs || []).splice(0).forEach(applyParentMessage);
  }
  boot().catch((e) => fatal(e.message || String(e)));
})();
