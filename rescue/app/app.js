// Rescue Locator - one app: Story Studio editing on the 2D map + the 3D view (iframe, postMessage contract in CONTRACT.md)
// + shared panels. Backend: rescue-server on the same origin (/api/*, /story*, /modules; deployed on Vercel or
// `swift run rescue-server` on a laptop). Offline: MapLibre + basemap from ../web/, no CDN.
import * as maplibregl from "../web/vendor/maplibre-gl.mjs";
import { offlineStyle, loadBasemap, ZAWRAT_BOUNDS, regionFor } from "../web/basemap/basemap.js";
import { EV_COL, evKind, shortEv, evGroups, groupOf, grpKind, marksHTML, tipHTML, focusTarget, focusUnion, hoverHold, foldPanel } from "./dock.js";   // compact dock, shared with Ćwiczenia
import { paintGrid, legendHTML } from "./scale.js";
import { showValidation } from "./validation.js";
import { initRescuer, render as renderRescuer, pollTask, myTeam, startGps } from "./rescuer.js";   // shared heat scale (decision S2), same as 3D

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (p) => Math.round((p || 0) * 100) + "%";
const LOOPBACK = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(location.hostname);
const DEMO_ADV = new URLSearchParams(location.search).get("demo") === "1";   // sens-funkcji R2-1: the ⏮ ⏭ advance box (and what comes next) only in the demo, ?demo=1 - a live incident has no future
const JOINED = !!new URLSearchParams(location.search).get("key");   // opened from a join link / QR: that is a live action
// action key (write access): arrives once in the join link / QR (?key=), is kept on this device and removed from the address bar
{ const k = new URLSearchParams(location.search).get("key"); if (k) { try { localStorage.setItem("rescue-pin", k.trim()); } catch (e) {} const u = new URL(location.href); u.searchParams.delete("key"); history.replaceState(null, "", u); } }
let PIN = ""; try { PIN = (localStorage.getItem("rescue-pin") || "").replace(/^"(.*)"$/, "$1"); } catch (e) {}   // raw like field/ops/2D; web/patrol writes it JSON-quoted
if (!LOOPBACK) { $("pinbox").style.display = ""; $("keyLock").hidden = false; $("keyLock").onclick = () => $("shareBtn").click(); $("pin").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $("pin").blur(); } };   /* Enter inside the Udostępnij form must not close it: blur commits the key */ if (!PIN) document.body.classList.add("pin-needed"); /* the field screen hides the box once a key came with the share link */ $("pin").value = PIN; $("pin").onchange = () => { PIN = $("pin").value.trim(); try { localStorage.setItem("rescue-pin", PIN); } catch (e) {} keyProbe(true); boot(); }; }
// GET /api/key (rs server, 4d3bc58): which key this device holds - operator | field | none | wrong, never the key itself. The box says it
// (title + colour); pin-needed clears only once the server confirmed a key. 404 / anything else (Swift server, older deploy): today's behaviour.
// A key typed in another tab or frame (storage event) is picked up and re-checked; a probe for an older key is ignored (sequence number)
const KEY_TXT = { operator: "Klucz kierownika akcji: wszystkie zmiany (meldunki, przydziały, Studio, symulacje).", field: "Klucz ratownika: meldunki, ślady i własna pozycja. Zmiany akcji wymagają klucza kierownika.", wrong: "Ten klucz jest nieprawidłowy: tylko podgląd. Wpisz klucz kierownika akcji albo otwórz link „Udostępnij”.", none: "Brak klucza: tylko podgląd. Wpisz klucz akcji albo otwórz link „Udostępnij”." };
async function keyProbe(told) {
  if (LOOPBACK) return;
  const seq = keyProbe.seq = (keyProbe.seq || 0) + 1, sent = PIN;
  let role = null;
  try { const h = {}; if (sent) h["X-Rescue-Pin"] = sent; const r = await fetch("/api/key", { headers: h, cache: "no-store" }); if (r.ok) role = (await r.json()).role; } catch (e) {}
  if (seq !== keyProbe.seq || sent !== PIN) return;   // the key changed meanwhile: a newer probe answers
  const B = document.body.classList, box = $("pinbox");
  B.remove("key-operator", "key-field", "key-wrong", "key-none");
  if (!KEY_TXT[role]) { box.removeAttribute("data-key"); box.querySelector(".kstate").textContent = ""; return; }   // no /api/key here: keep today's behaviour
  B.add("key-" + role); box.dataset.key = role; box.title = KEY_TXT[role]; $("keyLock").title = KEY_TXT[role] + " (kliknij: Udostępnij)";
  box.querySelector(".kstate").textContent = { operator: "kierownik akcji: możesz zmieniać", field: "ratownik: meldunki i ślady", wrong: "nieprawidłowy: tylko podgląd", none: "brak: tylko podgląd" }[role];   // sens-funkcji #15: the key box lives in Udostępnij, it says the role there
  if (role === "operator" || role === "field") B.remove("pin-needed", "pin-asked"); else B.add("pin-needed");
  if (told) toast(role === "operator" ? "Klucz kierownika akcji przyjęty: możesz zmieniać akcję." : KEY_TXT[role], role === "operator" ? 3000 : 6000);
}
keyProbe();
addEventListener("storage", (e) => { if (e.key !== "rescue-pin" && e.key !== null) return; const k = ((e.key ? e.newValue : null) || "").replace(/^"(.*)"$/, "$1").trim(); if (k === PIN) return; PIN = k; if (!LOOPBACK) $("pin").value = PIN; keyProbe(); });
async function api(path, body) {
  const h = { "Content-Type": "application/json" }; if (!LOOPBACK && PIN) h["X-Rescue-Pin"] = PIN;
  const r = await fetch(path, body === undefined ? { headers: h, cache: /^\/api\/run\/[^?]*\?(.*&)?live=0(&|$)/.test(path) ? "default" : "no-cache" } : { method: "POST", headers: h, body: JSON.stringify(body) });   // only the recorded run and its &t= frames (live=0): server max-age=10 + CDN (b892f5c); everything else stays no-cache
  if (r.status === 401) { document.body.classList.add("pin-needed", "pin-asked"); clearTimeout(api.calm); api.calm = setTimeout(() => { if (document.activeElement !== $("pin")) document.body.classList.remove("pin-asked"); }, 20000); throw new Error(PIN ? "Klucz akcji na tym urządzeniu jest nieprawidłowy: wpisz klucz kierownika akcji w oknie „Udostępnij” (kłódka w pasku)." : "Zmiany wymagają klucza akcji: otwórz link „Udostępnij” od kierownika akcji albo wpisz klucz w oknie „Udostępnij” (kłódka w pasku)."); }
  if (r.status === 403) { if (store.role !== "ratownik") document.body.classList.add("pin-needed"); throw new Error("To klucz ratownika (meldunki i ślady). Ta zmiana wymaga klucza kierownika akcji: wpisz go w polu Klucz albo otwórz link „Udostępnij” od kierownika."); }
  if (r.status === 404) throw new Error("Nie znaleziono danych na serwerze.");
  if (r.status >= 500) throw new Error("Serwer zgłosił błąd - spróbuj ponownie za chwilę.");
  if (!r.ok) throw new Error("Serwer odrzucił żądanie (" + r.status + ").");
  if (body !== undefined || !/^\/api\/run\//.test(path) || /[?&]t=/.test(path)) return r.json(); // per-minute frames (&t=) are not the run
  // runInline: the last GET of a run stays here as text; the 2D / 3D frames (same origin) parse it instead of a second GET of the same URL
  const text = await r.text(); window.__rescueRunText = { url: new URL(path, location.href).href, text };
  return JSON.parse(text);
}
const tryJSON = async (path) => { try { return await api(path); } catch (e) { return null; } };
// perf: the run of ?sc= (default zawrat) is requested right away, next to the module graph, the basemap and /api/scenarios
// (boot used to wait for all three first); the first loadScenario takes it when the URL matches, otherwise it is dropped
let PRE_RUN = (() => { const sc = new URLSearchParams(location.search).get("sc") || "zawrat"; if (!/^[\w-]+$/.test(sc) || /blind|^studio$/i.test(sc)) return null;
  const u = "/api/run/" + sc + (initTime() === "hist" ? "?live=0" : ""), E = window.__preRun;   // E: started by index.html with the HTML
  const p = E && E.u === u ? E.p.then((text) => { if (!text) return api(u); window.__rescueRunText = { url: new URL(u, location.href).href, text }; return JSON.parse(text); }) : api(u);
  p.catch(() => {}); return { u, p }; })();
async function preRun(u) { const P = PRE_RUN; PRE_RUN = null; if (!P || P.u !== u) return null; try { return await P.p; } catch (e) { return null; } }
// friendly Polish text for any error (network errors from fetch come as TypeError "Failed to fetch")
function plErr(e) {
  const m = String((e && e.message) || e || "");
  if (/failed to fetch|networkerror|load failed/i.test(m)) return "Brak połączenia z serwerem akcji. Sprawdź sieć i czy serwer działa.";
  if (/abort/i.test(m)) return "Serwer odpowiada zbyt długo - spróbuj ponownie.";
  return m || "Coś poszło nie tak - spróbuj ponownie.";
}
function toast(t, ms = 2600) { const el = $("toast"); el.textContent = t; el.style.display = "block"; clearTimeout(toast.h); toast.h = setTimeout(() => el.style.display = "none", ms); }

// ---------- shared state store
// store.run = rescue-run/1 document (+ story/hints from the Studio); store.step is 1-based like the Studio slider
const store = { mode: "akcja", backend: "static", hasApi: false, hasStudio: false, scenario: "studio", editable: false, run: null, step: 1, selSeg: null, selEv: null, view: "2d", mods: [] };
const subs = [];
function set(patch, why) { Object.assign(store, patch); for (const f of subs) f(why || Object.keys(patch).join(",")); }
const D = () => store.run;
const curStep = () => (store.run && store.run.steps ? store.run.steps[store.step - 1] : null);
window.rescueStore = store;   // debugging / tests

// ---------- backends
// scenarios come from rescue-server (/api/scenarios, runs computed live); only the blind-test replay is a committed file
const STATIC = {};
STATIC["blind-01-replay"] = { name: "Test na ślepo: runda 1 (replay)", run: "../out/blind-01-replay.run.json" };
async function detect() {
  // the three probes at once (perf: they ran one after another, three round trips before the run could even start)
  const blindP = Promise.resolve(true);   // out/blind-01-replay.run.json is committed and served statically: no probe (a GET + cancel showed in every console)
  const [a, m, blindOk] = await Promise.all([tryJSON("/api/scenarios"), tryJSON("/modules"), blindP]);
  store.hasApi = !!a; store.hasStudio = !!(m && m.modules); store.mods = m ? m.modules : [];
  let list = [];
  if (a) for (const s of (Array.isArray(a) ? a : a.scenarios || [])) { const id = typeof s === "string" ? s : s.id || s.name; if (id && !/blind/i.test(id) && !(id === "morzycko" && new URLSearchParams(location.search).get("sc") !== "morzycko")) list.push({ id, name: (s.incident ? id + " - " + s.incident : id).slice(0, 70), api: true, run: s.run || "/api/run/" + id, assessment: s.assessment || "/api/assessment/" + id }); }
  if (store.hasStudio) list.push({ id: "studio", name: "Studio (edycja na żywo)" });
  // blind test round 1 replay (the 3D view shows the hider's story and the true spot at the end); only when its run is there
  // not on the demo list (demo review d1510b2 pt 6); still reachable with ?sc=blind-01-replay (3D README, blind test reveal)
  if (blindOk && new URLSearchParams(location.search).get("sc") === "blind-01-replay") list.push({ id: "blind-01-replay", name: STATIC["blind-01-replay"].name, static: true });
  $("scen").innerHTML = list.map((s) => `<option value="${esc(s.id)}" ${s.disabled ? "disabled" : ""}>${esc(s.name)}</option>`).join("");
  store.scenList = list;
}
async function loadScenario(id) {
  const s = store.scenList.find((x) => x.id === id && !x.disabled) || store.scenList.find((x) => !x.disabled);
  teamOps = []; closePop();
  let run, backend;
  if (s.id === "studio") { run = await api("/story"); backend = "studio"; }
  else if (s.api) { const u = runUrlFor(s.run); run = (await preRun(u)) || await api(u); backend = "api"; store.runUrl = u; store.assessUrl = s.assessment; warmRun(s.run, s.id); }
  else { run = await (await fetch(STATIC[s.id].run, { cache: "no-cache" })).json(); backend = "static"; }
  $("scen").value = s.id;
  applyRun(run, { scenario: s.id, backend, editable: backend === "studio" }, "load");
}
function applyRun(run, extra = {}, why = "run") {
  if (run && run.error && !run.steps) { toast("Nie udało się policzyć mapy: " + run.error); return; }
  const fit = !store.run || JSON.stringify(store.run.bbox) !== JSON.stringify(run.bbox);
  if (why === "load") evOff.clear();
  set({ ...extra, run, step: run.steps ? run.steps.length : 1 }, why);
  if (fit && run.bbox && mapReady) fitRun(run.bbox);
  if (fit && run.bbox) swapBasemap(run.bbox);
  fetchAssessment();
}
// every edit goes through here: re-run on the server, refresh 2D, panels and 3D
async function run(fn, msg) {
  try {
    $("status").textContent = "liczę...";
    const d = await fn();
    if (d.error && !d.steps) { toast("Nie udało się: " + d.error); $("status").textContent = ""; return d; }
    applyRun(d, {}, "edit");
    if (msg) toast(msg);
    return d;
  } catch (e) { toast(plErr(e), 4000); $("status").textContent = ""; }
}
let assessment = null, assessSeq = 0;
// Ocena sytuacji: rescue-server answers at once with rules (wait=0) and computes the local LLM in the background; poll until done
async function fetchAssessment() {
  const seq = ++assessSeq; assessment = null; renderAssess();
  if (!store.hasApi) return;
  const i = store.step - 1;
  try {
    if (store.backend === "api" && store.assessUrl) {
      for (let k = 0; k < 40 && seq === assessSeq; k++) {
        const r = await fetch(`${store.assessUrl}?step=${i}&wait=0`, { cache: "no-cache" }); if (!r.ok) break;
        const d = await r.json(); if (seq !== assessSeq) return;
        assessment = d; renderAssess();
        if (!d.pending) break;
        await new Promise((res) => setTimeout(res, d.retryAfterMs || 5000));
      }
    } else if (store.backend === "studio") {
      const d = await api("/story/assessment", { step: i });   // blocking (rules fallback after the model timeout)
      if (seq === assessSeq) { assessment = d; renderAssess(); }
    }
  } catch (e) {}
}

// ---------- 2D map
let mapReady = false;
await loadBasemap(maplibregl);
const map = new maplibregl.Map({ container: "map", style: offlineStyle({ flavor: "grayscale" }), bounds: ZAWRAT_BOUNDS, attributionControl: { compact: true } });
window.map = map;
map.addControl(new maplibregl.NavigationControl(), "top-left");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }));
const FC = (f) => ({ type: "FeatureCollection", features: f });
function setupLayers() {
  if (mapReady) return;
  const blank = document.createElement("canvas"); blank.width = blank.height = 2;
  map.addSource("heat", { type: "image", url: blank.toDataURL(), coordinates: [[20.005, 49.249], [20.0875, 49.249], [20.0875, 49.195], [20.005, 49.195]] });
  map.addLayer({ id: "heat", type: "raster", source: "heat", paint: { "raster-opacity": 1, "raster-resampling": "linear", "raster-fade-duration": 0 } });
  map.addSource("segs", { type: "geojson", data: FC([]) });
  map.addLayer({ id: "seg-fill", type: "fill", source: "segs", paint: { "fill-color": "#ffd84d", "fill-opacity": ["case", ["get", "sel"], 0.12, 0] } });
  map.addLayer({ id: "seg-line", type: "line", source: "segs", paint: { "line-color": ["case", ["get", "sel"], "#ffd84d", ["get", "top"], "#ffffff", "rgba(255,255,255,.35)"], "line-width": ["case", ["get", "sel"], 3.5, ["get", "top"], 2.5, 1] } });
  map.addLayer({ id: "seg-lbl", type: "symbol", source: "segs", filter: ["get", "show"], layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Medium"], "text-size": 12, "text-allow-overlap": true },
    paint: { "text-color": "#fff", "text-halo-color": "#000", "text-halo-width": 1.6 } });
  map.addSource("ev", { type: "geojson", data: FC([]) });
  map.addLayer({ id: "ev-fill", type: "fill", source: "ev", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": ["get", "color"], "fill-opacity": 0.08 } });
  map.addLayer({ id: "ev-line", type: "line", source: "ev", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": ["get", "color"], "line-width": ["coalesce", ["get", "w"], 2], "line-dasharray": [2, 1.5] } });
  mapReady = true;
  if (store.run && store.run.bbox) fitRun(store.run.bbox);
  renderMap();
}
// Offline basemap of the run's region (Tatry, Bieszczady, ..., Kraków); the style swap re-adds our layers via style.load
let baseFile = "tatry.pmtiles";
async function swapBasemap(bb) {
  const file = (regionFor(bb) || {}).file || "tatry.pmtiles";
  if (file === baseFile) return;
  baseFile = file;
  try { await loadBasemap(maplibregl, file); } catch (e) { return; }
  mapReady = false;
  map.setStyle(offlineStyle({ flavor: "grayscale", file }), { diff: false });
}
// style.load fires without a paint (hidden tabs); "load" waits for the first frame
map.on("style.load", setupLayers); map.on("load", setupLayers); if (map.isStyleLoaded()) setupLayers();
map.on("resize", () => { if (renderMap.stale) renderMap(); if (fitRun.pending) fitRun(fitRun.pending); });   // a hidden #map skipped renderMap / fitRun; setView / setRole resize it when it shows
// the run's area on the shell map. #map is display:none outside Plan (0x0 canvas): fitBounds there only warned "Map cannot fit within
// canvas" (rodzina-dziecko-las) - fit when it shows; the 20 px margin shrinks to what the free area (canvas minus insets) allows
function fitRun(bb) {
  const c = map.getContainer(), p = map.getPadding(), free = Math.min(c.clientWidth - p.left - p.right, c.clientHeight - p.top - p.bottom);
  if (!(free > 8)) { fitRun.pending = bb; return; }
  fitRun.pending = null;
  map.fitBounds([[bb.west, bb.south], [bb.east, bb.north]], { padding: Math.min(20, Math.floor(free / 4)), duration: 0 });
}
function circle(c, rM, n = 48) {
  const k = 111320, ring = [];
  for (let i = 0; i <= n; i++) { const a = i / n * 2 * Math.PI; ring.push([c[1] + rM * Math.sin(a) / (k * Math.cos(c[0] * Math.PI / 180)), c[0] + rM * Math.cos(a) / k]); }
  return { type: "Polygon", coordinates: [ring] };
}
const COL = { rings: "#ffffff", sector: "#b07cff", point: "#3ee08f", route: "#f2b134", containment: "#8797a4", searched: "#8797a4", clue: "#f2b134" };
function searchedUpTo() {
  const out = {}, R = D(); if (!R) return out;
  (R.hints || []).slice(0, store.step).forEach((h) => { if (h.kind === "searched") (h.segments || []).forEach((s) => out[s] = Math.max(out[s] || 0, h.pod || 0)); });
  if (!R.hints) R.steps.slice(0, store.step).forEach((s) => { if (s.kind === "searched") { const m = /S\d+|[A-E]\d/g.exec(s.label || ""); if (m) out[m[0]] = 0.6; } });
  return out;
}
function renderMap() {
  const R = D(), S = curStep(); if (!mapReady || !R || !S) return;
  // #map is display:none outside Plan (Akcja shows the 2D/3D views): no heat toDataURL + setData per scrub step; drawn on the next resize
  if (!map.getContainer().getClientRects().length) { renderMap.stale = true; return; }
  renderMap.stale = false;
  const b = R.bbox, cv = paintGrid(S.poaGrid, R.cols, R.rows);
  map.getSource("heat").updateImage({ url: cv.toDataURL(), coordinates: [[b.west, b.north], [b.east, b.north], [b.east, b.south], [b.west, b.south]] });
  const top = S.segments.slice(0, 3).map((s) => s.id), searched = searchedUpTo();
  map.getSource("segs").setData(FC(S.segments.filter((s) => s.polygon && s.polygon.length).map((s) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [s.polygon] },
    properties: { top: top.includes(s.id), sel: s.id === store.selSeg, show: top.includes(s.id) || searched[s.id] !== undefined || s.id === store.selSeg,
      label: top.includes(s.id) ? `#${top.indexOf(s.id) + 1} ${s.id}` : searched[s.id] !== undefined ? `${s.id} pusty` : `${s.id}` } }))));
  const F = [];
  (R.hints || []).slice(0, store.step).forEach((h) => {
    const c = COL[h.kind] || "#5ce1e6";
    if (h.kind === "rings") (h.quantilesKm || []).forEach((q) => F.push({ type: "Feature", geometry: { type: "LineString", coordinates: circle(h.center, q * 1000).coordinates[0] }, properties: { color: c, w: 1 } }));
    if ((h.kind === "sector" || h.kind === "point" || h.kind === "clue") && h.center) F.push({ type: "Feature", geometry: circle(h.center, Math.max(h.radiusM || 30, 30)), properties: { color: c } });
    if ((h.kind === "route" || h.kind === "containment") && h.points && h.points.length > 1) F.push({ type: "Feature", geometry: { type: "LineString", coordinates: h.points.map((p) => [p[1], p[0]]) }, properties: { color: c, w: h.kind === "route" ? 3 : 6 } });
  });
  map.getSource("ev").setData(FC(F));
}
map.on("click", "seg-fill", (e) => { if (armed || suppressClick || !e.features.length) return; const sg = segAt(e.lngLat.lng, e.lngLat.lat); if (sg) selectSeg(sg.id, "2d"); });

$("legend").innerHTML = legendHTML();
// ---------- selection (shared by 2D, panels and 3D)
function selectSeg(id, from) {
  const fromFrame = from in FRAMES;
  set({ selSeg: store.selSeg === id && !fromFrame ? null : id }, "select");
  for (const k in FRAMES) if (k !== from && store.selSeg) postTo(k, { type: "select", segmentId: store.selSeg });
}
function setStep(n, from) {
  const R = D(); if (!R || !R.steps) return;
  n = Math.max(1, Math.min(R.steps.length, n));
  if (n === store.step) return;
  if (liveOn() && n < R.steps.length) { toast("Na żywo widać tylko teraz. Wcześniejsze momenty: przełącz na „Historia” u góry.", 3500); syncFrames(); return; }
  set({ step: n }, "step");
  for (const k in FRAMES) if (k !== from) { if (FRAMES[k].ready) postTo(k, { type: "step", i: n - 1 }); else syncFrame(k, "step"); }
  clearTimeout(setStep.h); setStep.h = setTimeout(fetchAssessment, 300);
  tlFromStep(from);   // timeline mode: the minute jumps to the step's minute
}

// ---------- panels
function renderPanels() {
  const R = D(), S = curStep(); if (!R || !S) return;
  let SEGS = tlSegments(S);   // timeline mode: ranking of the current minute's frame (coverage folded in); else the step's
  if (evOff.size && store.evTop) { const top = store.evTop.map((id) => SEGS.find((g) => g.id === id)).filter(Boolean); SEGS = [...top, ...SEGS.filter((g) => !top.includes(g))]; } // a signal switched off: the 2D's recomputed top 3
  const t3 = SEGS.slice(0, 3), tp = t3.reduce((a, s) => a + s.poa, 0), ta = t3.reduce((a, s) => a + s.areaPct, 0);
  // no POA % on screen (najmocniejsze-funkcje.md "Czego NIE pokazywać"): a juror reads "45%" as a chance, it holds ~19%; show rank and area
  $("vbig").innerHTML = `<b>${Math.round(ta)}%</b><span>obszaru to top 3<br><em>tu szukać najpierw</em></span>`;
  $("vsub").textContent = tlDoc() && store.minute != null && SEGS !== S.segments ? `Top 3 z ${SEGS.length} sektorów · ${tlClock(tlDoc(), store.minute)} (z pokryciem)` : `Top 3 z ${S.segments.length} sektorów · stan na ${S.t}`;
  const segRows = [...t3]; const sel = SEGS.find((s) => s.id === store.selSeg); if (sel && !t3.includes(sel)) segRows.push(sel);
  $("segs").innerHTML = segRows.map((s) => { const k = SEGS.indexOf(s);
    const a = segTeam(S, s.id), h = S.segmentHistory && S.segmentHistory[s.id];   // R2-6: searched and still in the top 3 - say why (POD only in the title)
    const again = h && k < 3 ? ` <span class="mute" style="font-size:13px" title="Przeszukany (POD ${Math.round(100 * (h.cumPod || 0))}%), a nadal w top 3: przeszukanie nie wykluczyło sektora">· ${(h.cumPod || 0) > 0 && h.cumPod < 0.5 ? "sprawdzony (słabo)" : "przeszukany"}, sprawdzić ponownie</span>` : "";
    return `<div class="box seg ${s.id === store.selSeg ? "sel" : ""}" data-seg="${esc(s.id)}"><span class="rank">${k + 1}</span><b>${esc(s.id)} ${esc(s.name)}</b><div class="p"><span class="mute" style="font-size:13px">${(+s.areaPct).toFixed(1).replace(".", ",")}% obszaru</span>${again}</div><i class="segbar" style="--w:${Math.min(100, s.poa * 100 / Math.max(t3[0].poa, 1e-9) * 0.9).toFixed(0)}%"></i>${a ? `<div class="segteam"><span class="tk">${esc((a.name || "?")[0])}</span>${esc(a.name)}</div>` : ""}</div>`; }).join("");
  const W = S.weather || {}; $("surv").textContent = W.survival ? "Hipotermia: " + W.survival.text : "";
  const by = {}; (S.assignments || []).forEach((a) => by[a.resourceId] = a);
  (store.manual || []).forEach((m) => by[m.resourceId] = { ...(by[m.resourceId] && by[m.resourceId].segmentId === m.segmentId ? by[m.resourceId] : { travelMin: NaN, expectedFind: NaN, safety: [] }), ...m, reason: "Przydział operatora" + (m.at ? " o " + m.at : "") });
  $("teams").innerHTML = (S.resources || []).map((r) => { const a = by[r.id];
    return `<div class="box team ${r.available ? "" : "off"}"><div class="row" style="justify-content:space-between"><b>${esc(r.name)}</b><span class="pill ${r.available ? "" : "off"}">${r.available ? (a ? "przydział" : "wolny") : "niedostępny"}</span></div>
      ${r.available ? "" : `<div class="help">${esc(r.reason)}</div>`}
      ${a ? `<div>→ <b class="seglink" data-seg="${esc(a.segmentId)}" style="cursor:pointer">${esc(a.segmentId)} ${esc(a.segmentName)}</b>${a.by === "operator" ? ` <span class="pill">operator</span>` : ""}</div>${(a.safety || []).map((f) => `<div class="flag">! ${esc(f)}</div>`).join("")}
      <details><summary>Szczegóły</summary>${isFinite(a.travelMin) ? `<div>Dojście ok. ${Math.round(a.travelMin)} min.</div>` : ""}<div>${esc(a.reason || `Skuteczność przeszukania ${pct(a.pod)}, przeszukanie ok. ${Math.round(a.sweepMin || 0)} min.`)}</div></details>` : ""}</div>`; }).join("") || `<div class="help">Ten scenariusz nie ma jeszcze zespołów.</div>`;
  renderProgress(); renderEvents();
  $("clock").textContent = S.label;   // the time sits in the k/n · HH:MM counter (#dkStep)
  $("slider").max = R.steps.length; $("slider").value = store.step; tlSlider();
  $("status").textContent = `${R.incident || ""}${store.backend !== "studio" ? " · tylko odczyt" : ""}`;
  document.body.classList.toggle("readonly", !store.editable);
  $("readonly").style.display = store.editable || store.mode !== "edycja" ? "none" : "";
}
// which team works a segment in this step (operator's manual assignment wins), for the "Top 3 + przydział" cards
function segTeam(S, segId) {
  const m = (store.manual || []).find((x) => x.segmentId === segId), a = m || (S.assignments || []).find((x) => x.segmentId === segId);
  if (!a) return null; const r = (S.resources || []).find((x) => x.id === a.resourceId);
  return { name: (r && r.name) || a.resourceName || a.resourceId };
}
function renderProgress() {
  const R = D(), S = curStep(); if (!S) return;
  const searched = searchedUpTo(), ids = Object.keys(searched);
  const found = R.steps.slice(0, store.step).some((s) => /ZNALEZIONO/i.test(s.label || "") || s.source === "Found");
  const covered = ids.reduce((a, id) => a + (S.segments.find((s) => s.id === id)?.areaPct || 0), 0);
  const assigned = (S.assignments || []).length, avail = (S.resources || []).filter((r) => r.available).length;
  const v = R.value || {};
  $("progress").innerHTML = `${found ? `<div class="big" style="color:var(--ok)">ZNALEZIONO</div>` : ""}
    ${ids.length ? `<div class="kv"><span>Przeszukano</span><b>${ids.length} z ${S.segments.length} sektorów · ${covered.toFixed(1).replace(".", ",")}% obszaru</b></div>
    <div class="bar"><i style="width:${Math.min(100, covered).toFixed(0)}%"></i></div>` : `<div class="help">Jeszcze nic nie przeszukano.</div>`}
    <div class="kv"><span>Zespoły w akcji</span><b>${assigned} z ${avail} dostępnych</b></div>
    ${ids.length ? `<details class="help"><summary>Szczegóły</summary>${ids.map((id) => `${esc(id)}: skuteczność ${pct(searched[id])}`).join(", ")}</details>` : ""}`;
}
function renderAssess() {
  const R = D(), S = curStep(); if (!S) { $("assess").innerHTML = ""; return; }
  if (assessment && assessment.assessment && typeof assessment.assessment === "object") {
    const A = assessment.assessment, li = (x) => `<li>${x}</li>`;
    const sec = (t, arr, f) => arr && arr.length ? `<div class="asec"><b>${t}</b><ul>${arr.map((x) => li(f(x))).join("")}</ul></div>` : "";
    $("assess").innerHTML = `${A.sytuacja ? `<div>${esc(A.sytuacja)}</div>` : ""}
      ${sec("Hipotezy", A.hipotezy, (h) => `<span class="seglink" data-seg="${esc(h.segment)}">${esc(h.segment)}</span> ${esc(h.opis || h.nazwa)}${(h.dowody || []).length ? ` <span class="mute">(${h.dowody.map(esc).join(", ")})</span>` : ""}`)}
      ${sec("Rekomendacje na następną godzinę", A.rekomendacje, (r) => typeof r === "string" ? esc(r) : `<b>${esc(r.zespol || r.team || "")}</b> ${esc(r.segment || "")} ${esc(r.dzialanie || r.opis || r.text || "")}${r.dlaczego ? ` - ${esc(r.dlaczego)}` : ""}`)}
      ${sec("Ryzyka", A.ryzyka, (r) => esc(typeof r === "string" ? r : r.opis || r.text || JSON.stringify(r)))}
      ${sec("Czego brakuje", A.brakuje, (r) => esc(typeof r === "string" ? r : `${r.informacja}${r.dlaczego ? " - " + r.dlaczego : ""}`))}
      <div class="help">${/reg/i.test(assessment.source || "") ? "Ocena z reguł" : "Ocena modelu AI"}${assessment.latencyMs > 1000 ? ` · ${Math.round(assessment.latencyMs / 1000)} s` : ""}${assessment.pending ? " · model AI jeszcze myśli…" : ""}${(assessment.dropped || []).length ? ` · odrzucono ${assessment.dropped.length} niepotwierdzonych` : ""}</div>`;
    $("assess").querySelectorAll(".seglink").forEach((x) => x.onclick = () => { selectSeg(x.dataset.seg, "panel"); flyToSeg(x.dataset.seg); });
    return;
  }
  if (assessment) {
    const a = assessment, txt = a.text || a.summary || a.assessment;
    const rows = Object.entries(a).filter(([k, v]) => !["text", "summary", "assessment"].includes(k) && (typeof v !== "object" || v === null)).slice(0, 8);
    const lists = Object.entries(a).filter(([, v]) => Array.isArray(v) && v.every((x) => typeof x === "string")).slice(0, 3);
    $("assess").innerHTML = `${txt ? `<div>${esc(txt)}</div>` : ""}${rows.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}
      ${lists.map(([k, v]) => `<div class="help"><b>${esc(k)}:</b> ${v.map(esc).join("; ")}</div>`).join("")}<div class="help">Ocena z serwera akcji</div>`;
    return;
  }
  // local summary from the run document (until rescue-server answers /api/assessment)
  const top = S.segments[0], W = S.weather || {}, grounded = (S.resources || []).filter((r) => !r.available);
  const lines = [];
  lines.push(`Najwyżej w rankingu: <b>${esc(top.id)} ${esc(top.name)}</b> (${(+top.areaPct).toFixed(1).replace(".", ",")}% obszaru).`);
  if (W.survival) lines.push(`Hipotermia: ${esc(W.survival.level || "")} - ${esc(String(W.survival.hoursOut).replace(".", ","))} h od ostatniego kontaktu.`);
  if (W.visibilityM != null && W.visibilityM < 300) lines.push(`Mgła: widoczność ${esc(W.visibilityM)} m.`);
  if (grounded.length) lines.push(`Niedostępne: ${grounded.map((r) => esc(r.name.split(" (")[0]) + " (" + esc(r.reason) + ")").join(", ")}.`);
  const a0 = (S.assignments || [])[0]; if (a0) lines.push(`Plan podpowiada: ${esc(a0.resourceId)} -> ${esc(a0.segmentId)} (decyzja kierownika akcji).`);
  $("assess").innerHTML = lines.map((l) => `<div style="margin-bottom:3px">${l}</div>`).join("") + `<div class="help">Krótkie podsumowanie z mapy (pełna ocena dostępna na serwerze akcji)</div>`;
}
$("segs").onclick = (e) => { const b = e.target.closest("[data-seg]"); if (b) { selectSeg(b.dataset.seg, "panel"); flyToSeg(b.dataset.seg); } };
$("teams").onclick = (e) => { const b = e.target.closest(".seglink"); if (b) { selectSeg(b.dataset.seg, "panel"); flyToSeg(b.dataset.seg); } };
function flyToSeg(id) { const s = curStep()?.segments.find((x) => x.id === id); if (!s || !s.polygon || !s.polygon.length || store.mode !== "edycja") return; let w = 180, e = -180, so = 90, n = -90; for (const [x, y] of s.polygon) { w = Math.min(w, x); e = Math.max(e, x); so = Math.min(so, y); n = Math.max(n, y); } map.fitBounds([[w, so], [e, n]], { padding: 120, maxZoom: 15, duration: 500 }); }

// ---------- alerts (from /metrics of this server)
let alertBase = null;
function prom(txt) { const out = []; for (const l of (txt || "").split("\n")) { if (!l || l[0] === "#") continue; const m = /^(\w+)(\{([^}]*)\})?\s+(\S+)/.exec(l); if (!m) continue; const lab = {}; (m[3] || "").replace(/(\w+)="([^"]*)"/g, (_, k, v) => lab[k] = v); out.push({ n: m[1], lab, v: +m[4] }); } return out; }
async function pollAlerts() {
  const get = async (u) => { try { const r = await fetch(u, { cache: "no-cache" }); return r.ok ? await r.text() : null; } catch (e) { return null; } };
  const own = await get("/metrics");
  const A = [];
  const M = prom(own);
  const now = M.find((m) => m.n === "rescue_server_time_seconds")?.v || Date.now() / 1000, thr = M.find((m) => m.n === "rescue_silent_threshold_seconds")?.v || 600;
  const last = {}; M.filter((m) => m.n === "rescue_client_last_report_timestamp_seconds").forEach((m) => { const k = m.lab.team || m.lab.client_id; last[k] = Math.max(last[k] || 0, m.v); });
  for (const [team, t] of Object.entries(last)) { const age = now - t; if (age > thr && age < 7200) A.push(["bad", `CISZA: ${team} - brak meldunku od ${Math.round(age / 60)} min`]); }
  const rej = {}; M.filter((m) => m.n === "rescue_reports_rejected_total").forEach((m) => rej[m.lab.reason] = (rej[m.lab.reason] || 0) + m.v);
  if (!alertBase) alertBase = { ...rej };
  for (const [k, v] of Object.entries(rej)) { const d = v - (alertBase[k] || 0); if (d > 0) A.push([d > 5 ? "bad" : "", `${k === "pin" ? "Próby zmian bez klucza akcji" : "Odrzucone żądania (" + k + ")"}: ${d} od otwarcia strony`]); }
  if (M.some((m) => m.n === "rescue_llm_up" && m.v === 0)) A.push(["", "Model AI jest wyłączony - meldunki są odczytywane regułami"]);
  const S = curStep(); (S?.assignments || []).forEach((a) => { const nm = ((S.resources || []).find((r) => r.id === a.resourceId) || {}).name || a.resourceName || a.resourceId; (a.safety || []).forEach((f) => A.push(["", `${nm}: ${f}`])); });
  if (own === null) A.push(["ok", "Brak połączenia z serwerem akcji - nie widać zespołów w terenie"]);
  $("alerts").innerHTML = (A.length ? A : [["ok", "Wszystko w porządku - brak alertów"]]).map(([c, t]) => `<div class="alert ${c}">${esc(t)}</div>`).join("");
}
setInterval(pollAlerts, 10000);

// ---------- events + timeline
function relOf(t) { const [a, b] = String(t).split(":").map(Number), [c, d] = startClock().split(":").map(Number); let x = a * 60 + b - c * 60 - d; return x < -720 ? x + 1440 : x; }
function renderEvents() {
  const R = D(), S = curStep();
  if (R.story) {
    const items = R.story.items || [], items0 = items;
    $("events").innerHTML = items0.map((it, k) => { const ev = it.events[0] || {};
      const hid = (R.steps.find((st) => st.label === ev.title) || {}).hintId;
      return `<div class="ev ${rel(ev.at) > rel(S.t) ? "future" : ""} ${it.id === store.selEv ? "cur" : ""} ${hid && evOff.has(hid) ? "evoff" : ""}" data-id="${esc(it.id)}"><div class="src">${hid ? evToggle(hid) : ""}${esc(ev.at)} · ${esc(srcPl(it.input.provider))}${it.parsedBy ? " · " + esc(it.parsedBy) : ""}</div>
        <div class="t">${esc(ev.title || srcPl(it.input.provider))}${it.events.length > 1 ? ` <span class="mute">(+${it.events.length - 1})</span>` : ""}</div>
        ${it.note ? `<div class="note">${esc(it.note)}</div>` : ""}
        <div class="ops"><button data-op="up" ${k === 0 ? "disabled" : ""}>&lt;</button><button data-op="down" ${k === items.length - 1 ? "disabled" : ""}>&gt;</button><button data-op="delete">usuń</button></div></div>`; }).join("") || `<div class="help">Historia jest pusta. ${store.mode === "edycja" ? "Przeciągnij dowód z lewej strony na mapę." : "Dodaj zdarzenia w trybie Edycja."}</div>`;
    wireEvents();
  } else {
    // sens-funkcji R2-12: clues and reports first (newest on the left), background (teren / trudność / pogoda / Koester) folded into one
    // card at the end of the past ones; weather = one card with the current state; future steps after it as before
    const cardOf = (s, k) => `<div class="ev ${k + 1 === store.step ? "cur" : k + 1 > store.step ? "future" : ""} ${s.hintId && evOff.has(s.hintId) ? "evoff" : ""}" data-step="${k + 1}"><div class="src">${s.hintId ? evToggle(s.hintId) : ""}${esc(s.t)} · ${esc(srcPl(s.source))}</div><div class="t">${esc(s.label)}</div></div>`;
    const ks = R.steps.map((s, k) => k), isBg = (k) => EV_BG.has(R.steps[k].source), isW = (k) => /^Weather/.test(R.steps[k].source || "");
    const past = ks.filter((k) => k + 1 <= store.step), fut = ks.filter((k) => k + 1 > store.step && !isBg(k));
    const bg = past.filter(isBg), wNow = bg.filter(isW).pop(), bgShow = bg.filter((k) => !isW(k) || k === wNow);
    const bgCard = bg.length ? `<div class="ev evbg${evBgOpen ? " open" : ""}" data-bg="1" title="${evBgOpen ? "Zwiń tło" : "Pokaż tło akcji: teren, trudność, pogoda, statystyka"}"><div class="src">${evBgOpen ? "▾" : "▸"} tło akcji (${bgShow.length})</div><div class="t">Tło: teren, trudność, pogoda, statystyka</div>${wNow != null ? `<div class="note">Pogoda teraz (${esc(R.steps[wNow].t)}): ${esc(R.steps[wNow].label.replace(/^[^:]{0,14}:\s*/, ""))}</div>` : ""}</div>` : "";
    $("events").innerHTML = past.filter((k) => !isBg(k)).reverse().map((k) => cardOf(R.steps[k], k)).join("") + bgCard
      + (evBgOpen ? bgShow.map((k) => cardOf(R.steps[k], k)).join("") : "") + fut.map((k) => cardOf(R.steps[k], k)).join("");
  }
}
// evidence on/off ("uwzględnij"): the embedded views recompute the map in the browser (contract: {type:'evidence', id, on}, '*' = all)
const evOff = new Set();
const EV_BG = new Set(["Terrain", "TerrainDifficulty", "WeatherConditions", "Weather", "KoesterRings"]);   // R2-12: background, folded in Sygnały
let evBgOpen = false;
// Sygnały cards: the engine's provider names in plain Polish (demo review b0858be pt 1 - the jury watches this panel in step 2)
const SRC_PL = { Terrain: "Teren", TerrainDifficulty: "Trudność terenu", WeatherConditions: "Pogoda", Weather: "Pogoda", KoesterRings: "Statystyka zaginięć",
  TripPlan: "Plan wycieczki", TrailheadCar: "Auto na parkingu", Cell112Fix: "Lokalizacja 112", SegmentSearched: "Przeszukany sektor", DronePassEmpty: "Przelot drona bez wyniku",
  Clue: "Poszlaka", WaterDrift: "Dryf na wodzie", RatunekPing: "Aplikacja Ratunek", Found: "Odnaleziony" };
const srcPl = (x) => SRC_PL[x] || x || "";
const evToggle = (id) => `<input type="checkbox" class="evt" data-hint="${esc(id)}" ${evOff.has(id) ? "" : "checked"} title="Uwzględnij ten sygnał (przelicza 2D analizę i 3D)"> `;
function setEvidence(id, on, from) {
  if (id === "*") { if (on) evOff.clear(); } else if (on) evOff.delete(id); else evOff.add(id);
  for (const k in FRAMES) if (k !== from) postTo(k, { type: "evidence", id, on });
  renderEvents();
  $("evReset").hidden = !evOff.size;
  if (!evOff.size && store.evTop) { store.evTop = null; renderPanels(); tlPostTime(undefined, true); }
}
$("events").addEventListener("change", (e) => { const c = e.target.closest(".evt"); if (c) setEvidence(c.dataset.hint, c.checked, "panel"); });
$("events").addEventListener("click", (e) => { if (e.target.closest(".evt")) e.stopPropagation(); }, true);
$("evReset").onclick = () => setEvidence("*", true, "panel");
$("slider").oninput = () => tlScrub() ? setMinute(+$("slider").value) : setStep(+$("slider").value);
// a drag on the timeline: the views may coalesce the time stream ({type:'time', scrub:true}, web/app.js pqPush); keys and clicks go as before
$("slider").addEventListener("pointerdown", () => { TLP.scrub = true; });
for (const ev of ["pointerup", "pointercancel", "change"]) $("slider").addEventListener(ev, () => { TLP.scrub = false; });
$("events").onclick = async (e) => {
  if (suppressClick) return;
  const b = e.target.closest("button"), card = e.target.closest(".ev"); if (!card) return;
  if (card.dataset.bg) { evBgOpen = !evBgOpen; return renderEvents(); }   // R2-12: the folded background card
  if (card.dataset.step) return goEvent(+card.dataset.step);
  if (b) { await run(() => api("/story/edit", { id: card.dataset.id, op: b.dataset.op }), b.dataset.op === "delete" ? "Usunięto zdarzenie" : "Zamieniono kolejność (czas)"); return; }
  // select evidence: jump to its step and fly to it
  const it = D().story.items.find((i) => i.id === card.dataset.id), ev = it && it.events[0]; if (!ev) return;
  set({ selEv: it.id }, "selectEv");
  const k = D().steps.findIndex((s) => s.label === ev.title); if (k >= 0) setStep(k + 1);
  if (ev.point && store.mode === "edycja") map.flyTo({ center: [ev.point[1], ev.point[0]], zoom: Math.max(map.getZoom(), 13.5), duration: 500 });
};
// ▶ (Mateusz): with run.timeline the playhead moves continuously (requestAnimationFrame, sub-minute), speed 1x = 1 scenario minute
// per second (1x/2x/5x/10x/30x, remembered per device, changeable while playing), and it stops briefly exactly at every event's
// minute (the dock shows its card). Without timeline: one step per 1400 ms / speed (min 200 ms).
const SPEEDS = [1, 2, 5, 10, 30];
let playing = null, speed = (() => { try { const v = +localStorage.getItem("rescue-app-speed"); return SPEEDS.includes(v) ? v : 1; } catch (e) { return 1; } })();
function renderSpeed() { const b = $("speed"); if (b) { b.textContent = speed + "×"; b.title = `Prędkość odtwarzania: ${speed}× (1× = 1 minuta akcji na sekundę). Kliknij, aby zmienić.`; } }
renderSpeed();
if ($("speed")) $("speed").onclick = () => {
  speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
  try { localStorage.setItem("rescue-app-speed", String(speed)); } catch (e) {}
  renderSpeed();
  if (playing && playing.step) { clearInterval(playing.step); playing.step = setInterval(playStep, Math.max(200, 1400 / speed)); }
};
function stopPlay() {
  if (!playing) return;
  cancelAnimationFrame(playing.raf); clearInterval(playing.step); playing = null;
  $("play").textContent = "▶"; $("play").title = "Odtwórz historię";
}
function playStep() { if (store.step >= D().steps.length) { stopPlay(); return; } setStep(store.step + 1); }
function playTick(now) {
  const P = playing; if (!P || !P.raf) return;
  const T = tlScrub(); if (!T) { stopPlay(); return; }
  const dt = Math.min(0.25, Math.max(0, (now - P.last) / 1000)); P.last = now;
  if (now < P.hold) { P.raf = requestAnimationFrame(playTick); return; }
  const from = store.minute; let m = Math.min(T.endMinute, from + dt * speed);
  // the next event group after the playhead: land exactly on its minute (all its events in force) and hold there briefly
  const G = evGroups(D()), nx = G.findIndex((g) => g.minute != null && g.minute > from + 1e-6 && g.minute <= m);
  if (nx >= 0) { m = G[nx].minute; P.hold = now + (speed >= 10 ? 700 : 1200); }
  setMinute(m);
  if (nx >= 0) tlCard(store.step);
  if (m >= T.endMinute) { stopPlay(); return; }
  P.raf = requestAnimationFrame(playTick);
}
$("play").onclick = () => {
  if (playing) { stopPlay(); return; }
  const T = tlScrub();
  $("play").textContent = "❚❚"; $("play").title = "Zatrzymaj";
  if (T) {
    if (store.minute >= T.endMinute) setMinute(tlLo(T));
    playing = { raf: 0, last: performance.now(), hold: 0 };
    playing.raf = requestAnimationFrame(playTick);
    return;
  }
  if (store.step >= D().steps.length) setStep(1);
  playing = { step: setInterval(playStep, Math.max(200, 1400 / speed)) };
};

// ---------- drag and drop (pointer events: mouse + touch; every drag also works as click card -> click map)
const CARDS = [
  { key: "cell", provider: "Cell112Fix", label: "Lokalizacja 112 / BTS", color: "#b07cff", r: 1500, pin: "112" },
  { key: "witness", provider: "Clue", label: "Świadek", color: "#5ce1e6", r: 400, title: "Świadek: widział osobę idącą w górę", pin: "Ś" },
  { key: "car", provider: "TrailheadCar", label: "Auto na parkingu", color: "#cccccc", r: 450, pin: "A" },
  { key: "ping", provider: "RatunekPing", label: "Ping Ratunek", color: "#3ee08f", r: 25, pin: "R" },
  { key: "clue", provider: "Clue", label: "Ślad (przedmiot)", color: "#f2b134", r: 500, title: "Rękawiczka przy szlaku", pin: "!" },
  { key: "found", provider: "Found", label: "Znaleziono", color: "#ff6b5a", r: 30, title: "ZNALEZIONO: patrol, osoba przytomna", pin: "Z" },
  { key: "weather", provider: "WeatherConditions", label: "Pogoda", color: "#8fb3ff", weather: true },
  { key: "searched", provider: "SegmentSearched", label: "Patrol przeszukał, nic", color: "#8797a4", seg: true, pod: 0.7 },
  { key: "drone", provider: "DronePassEmpty", label: "Dron przeszukał, nic", color: "#8797a4", seg: true, pod: 0.6 },
];
const PIN_OF = { Cell112Fix: ["112", "#b07cff"], TrailheadCar: ["A", "#cccccc"], RatunekPing: ["R", "#3ee08f"], Clue: ["!", "#f2b134"], Found: ["Z", "#ff6b5a"], KoesterRings: ["IPP", "#ffffff"] };
const POD_DEF = { ground: 0.6, dog: 0.7, drone: 0.6, heli: 0.5 };
let armed = null, teamOps = [], pinMarkers = [], tokMarkers = [], pop = null, suppressClick = false;
const addMin = (t, m) => { const [h, mm] = String(t || "17:40").split(":").map(Number); const x = ((h * 60 + mm + m) % 1440 + 1440) % 1440; return String(Math.floor(x / 60)).padStart(2, "0") + ":" + String(x % 60).padStart(2, "0"); };
const startClock = () => (D() && D().story && D().story.base && D().story.base.startClock) || (D() && D().steps && D().steps[0].t) || "17:40";
const rel = relOf;
const curClock = () => (curStep() || {}).t || startClock();
function inPoly(pt, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; } return c; }
function segAt(lng, lat) { const S = curStep(); return S ? S.segments.find((s) => s.polygon && inPoly([lng, lat], s.polygon)) : null; }
function mapLL(x, y) { const r = $("map").getBoundingClientRect(); if (!r.width || x < r.left || x > r.right || y < r.top || y > r.bottom) return null; const ll = map.unproject([x - r.left, y - r.top]); return { lng: ll.lng, lat: ll.lat, px: [x - r.left, y - r.top] }; }
const HINT = "Przeciągnij <b>dowód</b> na mapę, przeciągnij <b>zespół</b> na sektor. Pinezki można przesuwać.";
function hint(html) { $("hint").innerHTML = store.editable && store.mode === "edycja" ? (html || HINT) : ""; }
function draggable(el, label, onDrop, onMove) {
  el.addEventListener("pointerdown", (e) => {
    if (e.button > 0 || e.target.closest("button,input,select")) return;
    const sx = e.clientX, sy = e.clientY; let on = false;
    const mv = (ev) => {
      if (!on && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      if (!on) { on = true; document.body.classList.add("dragging"); $("ghost").textContent = label(); $("ghost").style.display = "block"; el.classList.add("dragsrc"); }
      $("ghost").style.left = ev.clientX + "px"; $("ghost").style.top = ev.clientY + "px";
      $("map").classList.toggle("drop-ok", !!mapLL(ev.clientX, ev.clientY) && !onMove);
      if (onMove) onMove(ev.clientX, ev.clientY);
      ev.preventDefault();
    };
    const up = (ev) => {
      removeEventListener("pointermove", mv); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
      if (!on) return;
      suppressClick = true; setTimeout(() => suppressClick = false, 50);
      document.body.classList.remove("dragging"); $("ghost").style.display = "none"; $("map").classList.remove("drop-ok"); el.classList.remove("dragsrc");
      if (ev.type === "pointerup") onDrop(ev.clientX, ev.clientY);
    };
    addEventListener("pointermove", mv, { passive: false }); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  });
}
function arm(a) {
  armed = a; document.querySelectorAll(".card.armed").forEach((c) => c.classList.remove("armed"));
  $("map").classList.toggle("armed-map", !!a);
  if (!a) return hint();
  if (store.mode !== "edycja") setMode("edycja");
  document.querySelector(`.card[data-k="${a.kind === "team" ? "t:" + a.res.id : a.card.key}"]`)?.classList.add("armed");
  hint(a.kind === "team" ? `Kliknij <b>sektor</b> na mapie dla: ${esc(a.res.name)} (Esc - anuluj)` : `Kliknij mapę, żeby dodać: <b>${esc(a.card.label)}</b> (Esc - anuluj)`);
}
function renderPalette() {
  const have = new Set(store.mods.map((m) => m.name));
  $("palette").innerHTML = CARDS.filter((c) => have.has(c.provider)).map((c) => `<div class="card" data-k="${c.key}" tabindex="0" role="button" title="Przeciągnij na mapę albo kliknij, potem kliknij mapę"><span class="dot" style="background:${c.color}"></span>${esc(c.label)}</div>`).join("");
  for (const el of $("palette").children) {
    const c = CARDS.find((x) => x.key === el.dataset.k);
    draggable(el, () => c.label, (x, y) => { const ll = mapLL(x, y); if (ll) openForm(c, ll); }); 
    el.onclick = () => { if (!suppressClick) arm(armed && armed.card === c ? null : { kind: "module", card: c }); };
    el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.onclick(); } };
  }
}
function renderTokens() {
  const S = curStep(); if (!S || !store.editable) return;
  const busy = new Set(teamOps.map((o) => o.res.id));
  $("tokens").innerHTML = (S.resources || []).map((r) => { const off = !r.available, b = busy.has(r.id);
    return `<div class="card ${off ? "off" : ""} ${b ? "busy" : ""}" data-k="t:${esc(r.id)}" tabindex="0" role="button" title="${esc(off ? "Niedostępny: " + r.reason : b ? "Zespół już w akcji na mapie" : "Przeciągnij na sektor albo kliknij, potem kliknij sektor")}"><span class="dot" style="background:${off ? "#555" : "#f2b134"}"></span><span>${esc(r.name)}<span class="sub">${esc(off ? r.reason : b ? "w akcji" : "gotowy, " + S.t)}</span></span></div>`; }).join("") || `<div class="help">Brak zespołów.</div>`;
  for (const el of $("tokens").children) {
    const r = (S.resources || []).find((x) => "t:" + x.id === el.dataset.k); if (!r || !r.available || busy.has(r.id)) continue;
    draggable(el, () => r.name, (x, y) => { const ll = mapLL(x, y); if (ll) dropTeam(r, ll); });
    el.onclick = () => { if (!suppressClick) arm(armed && armed.res && armed.res.id === r.id ? null : { kind: "team", res: r }); };
    el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.onclick(); } };
  }
}
function closePop() { if (pop) { pop.el.remove(); pop.m && pop.m.remove(); pop = null; } }
function openForm(c, ll) {
  closePop(); arm(null);
  const seg = segAt(ll.lng, ll.lat), S = curStep();
  if (c.seg && !seg) return toast("Upuść na jeden z sektorów mapy");
  const segOpts = (S ? S.segments : []).map((s) => `<option value="${esc(s.id)}" ${seg && s.id === seg.id ? "selected" : ""}>${esc(s.id)} ${esc(s.name)}</option>`).join("");
  let f = `<h3>${esc(c.label)}</h3><label>Godzina <input type="time" name="at" value="${addMin(curClock(), 5)}"></label>`;
  if (c.r) f += `<label>Promień m <input name="radiusM" inputmode="numeric" value="${c.r}"></label>`;
  if (c.title) f += `<label>Opis <input name="title" value="${esc(c.title)}"></label>`;
  if (c.seg) f += `<label>Sektor <select name="seg">${segOpts}</select></label><label>POD <input name="pod" inputmode="decimal" value="${c.pod}"></label>`;
  if (c.weather) f += `<label>Widoczność m <input name="visibilityM" value="80"></label><label>Wiatr m/s <input name="windMs" value="12"></label><label>Temp. °C <input name="tempC" value="1"></label><label>Ciemno <input type="checkbox" name="dark" checked></label>`;
  f += `<div class="row"><button type="button" class="cancel">Anuluj</button><button class="primary" type="submit">Dodaj</button></div>`;
  const el = document.createElement("form"); el.className = "pop"; el.innerHTML = f;
  const W = $("map").clientWidth, H = $("map").clientHeight;
  // inside the visible map, not under the floating panels (#right with its alerts covered "Dodaj" at 1100 px; insets() = the bar, #right, the dock, #left)
  const [iT, iR, iB, iL] = insets(), fw = 236, fh = 240;
  el.style.left = Math.max(iL + 4, Math.min(W - iR - fw - 4, ll.px[0] + 14)) + "px"; el.style.top = Math.max(iT + 4, Math.min(H - iB - fh - 4, ll.px[1] - 20)) + "px";
  $("map").appendChild(el);
  const m = c.weather ? null : new maplibregl.Marker({ element: pinEl(c.pin || "?", c.color) }).setLngLat([ll.lng, ll.lat]).addTo(map);
  pop = { el, m };
  el.querySelector(".cancel").onclick = closePop;
  el.onkeydown = (e) => { if (e.key === "Escape") closePop(); };
  el.onsubmit = async (e) => {
    e.preventDefault();
    const v = Object.fromEntries([...el.querySelectorAll("input,select")].map((i) => [i.name, i.type === "checkbox" ? i.checked : i.value]));
    const inp = { provider: c.provider, at: v.at };
    if (!c.weather && !c.seg) { inp.lat = +ll.lat.toFixed(5); inp.lon = +ll.lng.toFixed(5); }
    if (v.radiusM) inp.radiusM = v.radiusM;
    if (v.title) inp.title = v.title;
    if (c.seg) { inp.segments = [v.seg]; inp.pod = v.pod; }
    if (c.weather) Object.assign(inp, { visibilityM: v.visibilityM, windMs: v.windMs, tempC: v.tempC, dark: v.dark });
    closePop();
    await addInput(inp);
  };
  setTimeout(() => el.querySelector("input")?.focus(), 0);
}
async function addInput(inp) {
  const d = await run(() => api("/story/event", { event: inp }));
  if (d && d.added) { if (!d.added.events.length) toast("Nie dodano: " + (d.added.note || "brakuje danych")); else toast("Dodano: " + d.added.events.map((e) => e.title).join("; ")); }
  return d;
}
function pinEl(txt, color, future) { const el = document.createElement("div"); el.className = "pin" + (future ? " future" : ""); el.style.background = color; el.innerHTML = `<span>${esc(txt)}</span>`; return el; }
function renderPins() {
  pinMarkers.forEach((m) => m.remove()); pinMarkers = [];
  const S = curStep(), R = D(); if (!S || !R.story) return;
  for (const it of R.story.items) {
    const ev = it.events[0] || {}, p = ev.point; if (!p || !PIN_OF[it.input.provider]) continue;
    let [txt, color] = PIN_OF[it.input.provider];
    if (it.input.provider === "Clue" && /świadek/i.test(ev.title || "")) { txt = "Ś"; color = "#5ce1e6"; }
    const el = pinEl(txt, color, rel(ev.at) > rel(S.t)); if (it.id === store.selEv) el.classList.add("sel");
    el.title = `${ev.at} ${ev.title || it.input.provider}${store.editable ? " - przeciągnij, żeby przesunąć" : ""}`;
    const m = new maplibregl.Marker({ element: el, anchor: "bottom-left", offset: [-2, 2] }).setLngLat([p[1], p[0]]).addTo(map);
    if (store.editable) el.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return; e.preventDefault(); e.stopPropagation();
      const r0 = $("map").getBoundingClientRect(), pt0 = map.project(m.getLngLat()), dx = e.clientX - r0.left - pt0.x, dy = e.clientY - r0.top - pt0.y;
      let moved = false; map.dragPan.disable(); document.body.classList.add("dragging"); $("map").classList.add("drop-ok");
      const mv = (ev2) => { const r = $("map").getBoundingClientRect(); moved = moved || Math.hypot(ev2.clientX - e.clientX, ev2.clientY - e.clientY) > 4; m.setLngLat(map.unproject([ev2.clientX - r.left - dx, ev2.clientY - r.top - dy])); ev2.preventDefault(); };
      const up = async () => {
        removeEventListener("pointermove", mv); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
        map.dragPan.enable(); document.body.classList.remove("dragging"); $("map").classList.remove("drop-ok");
        if (!moved) { m.setLngLat([p[1], p[0]]); set({ selEv: it.id }, "selectEv"); return; }
        const ll = m.getLngLat(), dist = Math.round(new maplibregl.LngLat(p[1], p[0]).distanceTo(ll));
        await run(() => api("/story/edit", { id: it.id, op: "update", input: { lat: +ll.lat.toFixed(5), lon: +ll.lng.toFixed(5) } }), `Przesunięto: ${ev.title || it.input.provider} o ${dist} m - mapa przeliczona`);
      };
      addEventListener("pointermove", mv, { passive: false }); addEventListener("pointerup", up); addEventListener("pointercancel", up);
    });
    pinMarkers.push(m);
  }
}
function dropTeam(r, ll) {
  arm(null);
  const seg = segAt(ll.lng, ll.lat); if (!seg) return toast("Upuść zespół na jeden z sektorów mapy");
  const S = curStep(), plan = (S.assignments || []).find((a) => a.resourceId === r.id && a.segmentId === seg.id);
  teamOps.push({ res: r, segId: seg.id, segName: seg.name, at: curClock(), ll: [ll.lat, ll.lng], pod: plan ? +plan.pod.toFixed(2) : POD_DEF[r.type] || 0.6,
                 sweep: plan ? Math.min(120, Math.max(15, Math.round(plan.travelMin + plan.sweepMin))) : 30 });
  toast(`${r.name.split(" (")[0]} → ${seg.id} ${seg.name}${plan ? " (zgodnie z planem)" : ""}`);
  assignTeam(r.id, seg.id);
  selectSeg(seg.id, "2d");
  renderTeams(); renderTokens();
}
function renderTeams() {
  tokMarkers.forEach((m) => m.remove()); tokMarkers = [];
  teamOps.forEach((o) => {
    const el = document.createElement("div"); el.className = "tok";
    el.innerHTML = `<b>${esc(o.res.name)}</b>${esc(o.segId)} ${esc(o.segName)} · od ${esc(o.at)} · POD ${pct(o.pod)}<div class="row"><button class="nic">nic</button><button class="found">ZNALEZIONO</button><button class="x" title="Odwołaj zespół">x</button></div>`;
    el.querySelector(".nic").onclick = async () => {
      const d = await addInput({ provider: o.res.type === "drone" ? "DronePassEmpty" : "SegmentSearched", at: addMin(o.at, o.sweep), segments: [o.segId], pod: o.pod, title: `${o.res.name}: ${o.segId} przeszukany, nic` });
      if (d && d.added && d.added.events.length) { teamOps.splice(teamOps.indexOf(o), 1); renderTeams(); renderTokens(); }
    };
    el.querySelector(".found").onclick = async () => {
      const d = await addInput({ provider: "Found", at: addMin(o.at, Math.min(o.sweep, 20)), lat: +o.ll[0].toFixed(5), lon: +o.ll[1].toFixed(5), radiusM: 30, title: `ZNALEZIONO: ${o.res.name} w ${o.segId}` });
      if (d && d.added && d.added.events.length) { teamOps = []; renderTeams(); renderTokens(); }
    };
    el.querySelector(".x").onclick = () => { teamOps.splice(teamOps.indexOf(o), 1); renderTeams(); renderTokens(); };
    tokMarkers.push(new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([o.ll[1], o.ll[0]]).addTo(map));
  });
}
let evDrop = null;
function evTarget(x, y) {
  document.querySelectorAll(".ev.drop-before,.ev.drop-after").forEach((c) => c.classList.remove("drop-before", "drop-after"));
  const t = document.elementFromPoint(x, y)?.closest(".ev"); if (!t) return (evDrop = null);
  const r = t.getBoundingClientRect(), before = x < r.left + r.width / 2;
  t.classList.add(before ? "drop-before" : "drop-after"); evDrop = { id: t.dataset.id, before };
}
function wireEvents() {
  if (!store.editable || store.mode !== "edycja") return;
  for (const card of $("events").querySelectorAll(".ev")) {
    draggable(card, () => card.querySelector(".t").textContent, async () => {
      document.querySelectorAll(".ev.drop-before,.ev.drop-after").forEach((c) => c.classList.remove("drop-before", "drop-after"));
      if (!evDrop || evDrop.id === card.dataset.id) return;
      const tgt = D().story.items.find((i) => i.id === evDrop.id), tAt = tgt && tgt.events[0] && tgt.events[0].at; if (!tAt) return;
      const at = addMin(tAt, evDrop.before ? -1 : 1);
      await run(() => api("/story/edit", { id: card.dataset.id, op: "update", input: { at } }), `Nowy czas zdarzenia: ${at} - mapa przeliczona`);
    }, evTarget);
  }
}
map.getCanvasContainer().addEventListener("click", (e) => {
  if (!armed || suppressClick || e.target.closest(".pin,.tok")) return;
  const p = mapLL(e.clientX, e.clientY); if (!p) return;
  const a = armed; suppressClick = true; setTimeout(() => suppressClick = false, 80);
  if (a.kind === "team") dropTeam(a.res, p); else openForm(a.card, p);
});
async function undo() { if (!store.editable) return; closePop(); await run(() => api("/story/edit", { op: "undo" }), "Cofnięto ostatnią zmianę"); }
$("undo").onclick = undo;
addEventListener("keydown", (e) => {
  if (e.key === "Escape") { arm(null); closePop(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.target.closest("input,textarea,select")) { e.preventDefault(); undo(); }
});
$("newZ").onclick = () => { teamOps = []; return run(() => api("/story/new", { template: "zawrat", category: "hiker", startClock: "17:40" }), "Nowa historia: Zawrat"); };
$("save").onclick = async () => {
  try { const r = await api("/story/save", { name: $("sname").value || "studio-story" });
    if (r.error) return toast("Nie zapisano: " + r.error, 4000);
    toast(`Zapisano historię (${r.saved}).`, 5000);
  } catch (e) { toast(plErr(e), 4000); }
};

// ---------- embedded views (CONTRACT.md): 3D (app/3d, source "rescue3d") and the analysis 2D screen (web/, source "rescue2d")
// Before a view says "ready" it is driven by reloading its URL; after "ready" by postMessage (run as URL, step, select).
const FRAMES = {
  "3d": { el: $("frame3d"), note: $("note3d"), src: "", ready: false, dirty: true, source: "rescue3d", visible: () => (store.mode === "akcja" && (store.view === "3d" || store.view === "split")) || (store.mode === "edycja" && store.view === "split") },
  "2da": { el: $("frame2d"), note: $("note2d"), src: "", ready: false, dirty: true, source: "rescue2d", visible: () => store.mode === "akcja" && (store.view === "2d" || store.view === "split") },
};
// run URL the views can fetch themselves (same origin)
function runURL() {
  if (store.backend === "studio") return "/story";
  if (store.backend === "api") return store.runUrl;
  return null;
}
// floating layout (app.css "floating layout"): the free area between the panels, in px from each edge of the viewport
function isFloat() { return document.body.classList.contains("float") && innerWidth > 900; }
function insets() {
  if (!isFloat() || document.body.classList.contains("cinema")) return [0, 0, 0, 0];
  const r = (id) => { const el = $(id); if (!el || getComputedStyle(el).display === "none") return null; const b = el.getBoundingClientRect(); return b.width && b.height ? b : null; }; // fixed panels have no offsetParent
  const h = document.querySelector("header").getBoundingClientRect(), L = r("left"), Rr = r("right"), Bt = r("bottom");
  document.documentElement.style.setProperty("--hdr-h", Math.round(h.height) + "px"); // a wrapped header pushes the rails down
  // 2D+3D: the view switch (#views) sits over the 2D frame's top-right box (its pane ends at the middle) - the frames' overlays start below it
  const V = store.view === "split" ? r("views") : null;
  return [Math.round(Math.max(h.bottom, V ? V.bottom - 8 : 0)), Rr ? Math.round(innerWidth - Rr.left) : 0, Bt ? Math.round(innerHeight - Bt.top) : 0, L ? Math.round(L.right) : 0];
}
function setFloat() {
  document.body.classList.toggle("float", store.role !== "ratownik" && (store.mode === "akcja" || store.mode === "edycja"));
  $("right").classList.toggle("fold-live", store.role !== "ratownik" && store.mode === "akcja");   // the strip only where #right collapses (Akcja)
  pushInsets();
}
// the same free area in one element's own coordinates (split view: each frame covers only half the screen)
function insetsFor(el) {
  const [T, R, B, L] = insets(), f = el && el.getBoundingClientRect();
  if (!f || !f.width) return [T, R, B, L];
  return [Math.max(0, T - f.top), Math.max(0, f.right - (innerWidth - R)), Math.max(0, f.bottom - (innerHeight - B)), Math.max(0, L - f.left)].map(Math.round);
}
let insetsKey = "";
// an open actor drawer (actorlog.js) covers the right edge: the 3D moves its panel aside (the 2D keeps its camera - "Ślad na mapie" pads for it itself)
const drawerW = () => { const d = $("alDrawer"); return d && d.getAttribute("aria-hidden") !== "true" ? d.offsetWidth + 24 : 0; };
function pushInsets() {
  const key = insets().join(",") + store.view + "|" + drawerW();
  if (mapReady) { const [T, R, B, L] = insetsFor($("map")); map.setPadding({ top: T, right: R, bottom: B, left: L }); }
  if (key === insetsKey) return; insetsKey = key;
  const dw = drawerW();
  for (const k in FRAMES) { const i = insetsFor(FRAMES[k].el); if (k === "3d" && dw) { const f = FRAMES[k].el.getBoundingClientRect(); i[1] = Math.max(i[1], Math.round(f.right - (innerWidth - dw))); } postTo(k, { type: "insets", insets: i }); }
}
addEventListener("resize", () => setTimeout(pushInsets, 50));
function frameURL(k) {
  const i = store.step - 1, sc = encodeURIComponent(store.scenario), ru = runURL(), po = encodeURIComponent(location.origin);
  return frameURLBase(k, i, sc, ru, po) + "&insets=" + insetsFor(FRAMES[k].el).join(",");
}
function frameURLBase(k, i, sc, ru, po) {
  if (k === "3d") {
    if (store.backend === "studio") return `3d/index.html?embed=scene&sc=zawrat&run=${encodeURIComponent(ru)}&scenario=${encodeURIComponent("/story/scenario")}&step=${i}`;
    if (store.backend === "api") return `3d/index.html?embed=scene&sc=${sc}&run=${encodeURIComponent(ru)}&step=${i}`;
    return `3d/index.html?embed=scene&sc=${sc}&step=${i}`;
  }
  if (store.backend === "studio") return `../web/index.html?embed=scene&parentOrigin=${po}&run=${encodeURIComponent(ru)}&scenario=${encodeURIComponent("/story/scenario")}&step=${i}`;
  if (store.backend === "api") return `../web/index.html?embed=scene&sc=${sc}&parentOrigin=${po}&run=${encodeURIComponent(ru)}&scenario=${encodeURIComponent("/scenarios/" + store.scenario + ".json")}&step=${i}`;
  return `../web/index.html?embed=scene&parentOrigin=${po}&sc=${sc}&step=${i}`;
}
// a loaded frame is never re-pointed (iframe.src = ... adds an entry to the tab's joint session history, so browser Back would
// undo a frame reload instead of the scenario switch): a fresh element takes its place, whose first load adds no entry
function frameGo(F, u) {
  if (!F.el.getAttribute("src")) { F.el.src = u; return; }
  const n = F.el.cloneNode(false); n.src = u; F.el.replaceWith(n); F.el = n;
  if (afterUse.hook) afterUse.hook(n.contentWindow);
}
function postTo(k, msg) { const F = FRAMES[k]; if (F.ready && F.el.contentWindow) F.el.contentWindow.postMessage({ source: "rescue-app", ...msg }, location.origin); }
function post3d(msg) { for (const k in FRAMES) postTo(k, msg); }
function syncFrame(k, why) {
  const F = FRAMES[k];
  if (F.ready && F.shown !== F.visible()) { F.shown = F.visible(); postTo(k, { type: "visible", on: F.shown }); if (F.shown && tlDoc() && store.minute != null) { TLP.sent[k] = null; tlPostOne(k, tlDoc(), store.minute, tlFrameAt(tlDoc(), store.minute)); } }   // a hidden view may pause its render loop
  if (!F.visible() && !(F.warm && store.mode === "akcja")) { if (why === "edit" || why === "load" || why === "run") F.dirty = true; return; }   // warm: kept alive while hidden
  if (F.ready && !F.dirty && why !== "load") {
    if (why === "edit" || why === "run") { const u = runURL(); if (u) { F.ready = false; postTo2(F, { type: "run", url: u }); return; } }
    if (why === "step") postTo(k, { type: "step", i: store.step - 1 });
    return;
  }
  // still loading (the 3D view needs ~10 s): a step move must not restart it - its "ready" picks up the current step and minute
  if (why === "step" && F.src && !F.ready && !F.dirty) return;
  const u = frameURL(k); if (u === F.src && !F.dirty && why !== "edit" && why !== "run") return;
  if (!F.visible() && F.src) {   // a hidden warm view reloads in the background once the page idles (3D boot yields, 90c2681), so the next switch is instant
    F.dirty = true; clearTimeout(F.rw);
    const t0 = Date.now();   // and only after a buffered 2D swap is done: both booting at once took the new 2D 2 s -> 16 s (chat.js measure)
    F.rw = setTimeout(function go() { (window.requestIdleCallback || ((f) => f()))(() => { if (F.visible() || !F.dirty || store.mode !== "akcja") return; if (k !== "2da" && FRAMES["2da"].next && Date.now() - t0 < 20000) { F.rw = setTimeout(go, 700); return; } const v = frameURL(k); F.src = v; F.ready = false; frameGo(F, v); F.dirty = false; }, { timeout: 4000 }); }, 1500);
    return;
  }
  clearTimeout(F.h);
  F.h = setTimeout(() => {
    F.src = u; F.ready = false; F.dirty = false;
    // double buffer: 2D always, 3D on a scenario switch ("load": the new terrain boots ~10 s) - the old view stays on screen until
    // the new one says "ready", then a 200 ms crossfade, so a switch never shows a blank 2D or 3D
    if (!(k === "2da" || (k === "3d" && why === "load")) || !F.el.getAttribute("src") || !F.visible()) { frameGo(F, u); return; }
    if (F.next) F.next.remove();
    const runOf = (x) => new URL(x, location.href).searchParams.get("run"), T = window.__rescueRunText;
    if (F.spare && F.spareReady && runOf(F.spare.src) === runOf(u) && T && T.text === F.spareText) {   // the spare already shows this run (warmRun)
      F.next = F.spare; F.spare = null;
      dispatchEvent(new MessageEvent("message", { data: F.spareReady, origin: location.origin, source: F.next.contentWindow }));
      return;
    }
    if (F.spare) { F.spare.remove(); F.spare = null; }
    const n = F.next = F.el.cloneNode(false); n.removeAttribute("id");
    n.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;opacity:0;pointer-events:none;transition:opacity .2s";
    n.src = u; F.el.after(n);
  }, why === "step" ? 700 : 50);
  const R = D(), out = k === "3d" && R && R.bbox && (R.bbox.west > 20.09 || R.bbox.east < 20.0 || R.bbox.north < 49.19 || R.bbox.south > 49.25) && store.backend === "studio";
  F.note.textContent = out ? "3D: teren Zawratu - historia poza tym obszarem nie ma jeszcze modelu 3D" : "";
}
// warm-up: once one scene view is ready, the other boots in the background while the browser idles and then stays alive,
// so 2D <-> 3D is a crossfade (app.css), not a reload of the 3D scene
function warmOther(k) {
  if (store.mode !== "akcja" || store.role === "ratownik") return;
  for (const o in FRAMES) { const F = FRAMES[o]; if (o === k || F.warm) continue; F.warm = true;
    afterUse(() => (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(() => syncFrame(o, "load"), { timeout: 3000 })); }
}
// Historia <-> Na żywo: after the first interaction, when idle, the other time mode's run is fetched once (so the switch gets a
// 304 instead of ~0.7 MB) and a hidden spare 2D view boots on it; if the run is still the same at the switch, the spare is
// shown at once (crossfade) instead of booting a new 2D view while the operator waits
function warmRun(base, sc) {
  const other = store.time === "hist" ? base : base + (base.includes("?") ? "&" : "?") + "live=0";
  let tries = 0;
  const spare = async () => {
    const F3 = FRAMES["3d"]; if (F3.src && !F3.ready && ++tries < 15) { setTimeout(spare, 1500); return; }   // the 3D view is booting: do not boot both at once
    try {
      const h = {}; if (!LOOPBACK && PIN) h["X-Rescue-Pin"] = PIN;
      const r = await fetch(other, { headers: h, cache: "no-cache" }); if (!r.ok) return;
      const text = await r.text(), F = FRAMES["2da"];
      if (store.scenario !== sc || store.mode !== "akcja" || store.role === "ratownik" || !F.ready || F.next) return;
      if (F.spare) F.spare.remove();
      const n = F.spare = F.el.cloneNode(false); n.removeAttribute("id"); F.spareText = text; F.spareReady = null;
      n.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;opacity:0;pointer-events:none;transition:opacity .2s";
      F.spareKeep = window.__rescueRunText; window.__rescueRunText = { url: new URL(other, location.href).href, text };   // runInline for the spare's boot
      n.src = frameURLBase("2da", 0, encodeURIComponent(sc), other, encodeURIComponent(location.origin)) + "&insets=" + insetsFor(F.el).join(","); F.el.after(n);
    } catch (e) {}
  };
  afterUse(() => (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(spare, { timeout: 5000 }));
}
// the background boot waits for the operator (first mouse move / touch / key; hover over 2D/3D starts it at once):
// a cold visit that never touches the page does not pay the other view's ~2 MB
function afterUse(f) {
  if (afterUse.used) { f(); return; }
  if (!afterUse.q) {   // one listener set; scene frames get it when they say "ready" (afterUse.hook), as they cover the screen
    afterUse.q = []; afterUse.EV = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"];
    afterUse.go = () => { if (afterUse.used) return; afterUse.used = true; const q = afterUse.q; afterUse.q = []; q.forEach((g) => g()); };
    afterUse.hook = (w) => { try { if (!afterUse.used) afterUse.EV.forEach((t) => w.addEventListener(t, afterUse.go, { capture: true, passive: true, once: true })); } catch (e) {} };
    afterUse.hook(window); $("views").addEventListener("pointerenter", afterUse.go, { once: true });
    for (const F of Object.values(FRAMES)) afterUse.hook(F.el.contentWindow);
  }
  afterUse.q.push(f);
}
function postTo2(F, msg) { F.el.contentWindow.postMessage({ source: "rescue-app", ...msg }, location.origin); }
function sync3d(why) { for (const k in FRAMES) syncFrame(k, why); }
addEventListener("message", (e) => {
  const sp = FRAMES["2da"];
  if (sp.spare && sp.spare.contentWindow === e.source) {   // the hidden spare (warmRun): remember its "ready" until it is shown
    if (e.data && e.data.source === sp.source && e.data.type === "ready") { sp.spareReady = e.data; if (sp.spareKeep !== undefined) { const T = window.__rescueRunText; if (T && T.text === sp.spareText) window.__rescueRunText = sp.spareKeep; sp.spareKeep = undefined; } }
    return;
  }
  const nk = Object.keys(FRAMES).find((x) => FRAMES[x].next && FRAMES[x].next.contentWindow === e.source);
  if (nk) {   // the buffered 2D view: only its "ready" counts, and it swaps in
    if (!e.data || e.data.source !== FRAMES[nk].source || e.data.type !== "ready") return;
    const F = FRAMES[nk], o = F.el, n = F.next; F.next = null; F.el = n; n.id = o.id; n.style.opacity = "1";
    setTimeout(() => { o.remove(); n.style.cssText = ""; }, 220);
  }
  const k = Object.keys(FRAMES).find((x) => FRAMES[x].el.contentWindow === e.source);
  if (!k || e.origin !== location.origin || !e.data || typeof e.data !== "object" || e.data.source !== FRAMES[k].source) return;
  const m = e.data, F = FRAMES[k];
  if (m.type === "ready") {
    F.ready = true;
    if (F.visible() && (!switchTo || (new URL(F.el.src).searchParams.get("sc") === switchTo && new URL(F.el.src).searchParams.get("scenario") !== "/story/scenario"))) window.__boot?.done(); tlPump();   // after a switch only the new scenario's view (a late "ready" of the previous one's must not lift the loader)   // map + Top 3 on screen: boot loader fades out; minute frames may load now
    if (afterUse.hook) afterUse.hook(F.el.contentWindow);
    warmOther(k); F.shown = F.visible(); postTo(k, { type: "visible", on: F.shown });
    if (Number.isInteger(m.step) ? m.step !== store.step - 1 : true) postTo(k, { type: "step", i: store.step - 1 });
    if (store.selSeg) postTo(k, { type: "select", segmentId: store.selSeg });
    for (const id of evOff) postTo(k, { type: "evidence", id, on: false });
    postTo(k, { type: "insets", insets: insetsFor(F.el) });
    // the view (re)loaded: it lost the frame we sent before; send the minute and the frame in force again
    TLP.sent[k] = null;
    if (tlDoc() && store.minute != null) tlPostOne(k, tlDoc(), store.minute, tlFrameAt(tlDoc(), store.minute));
  }
  if (m.type === "time" && Number.isFinite(m.minute) && F.ready) setMinute(m.minute, k);
  if (m.type === "top3" && k === "2da") { store.evTop = evOff.size && Array.isArray(m.ids) && m.ids.length ? m.ids.map(String) : null; renderPanels(); tlPostTime(k, true); }   // the 3D labels follow (msg.top) // signal off: the 2D's recomputed ranking
  if (m.type === "cinema") { document.body.classList.toggle("cinema", !!m.on); if (m.on) import("./actorlog.js").then((x) => x.closeActor()); pushInsets(); } // 3D Kino: panels step aside, full-frame shots
  if (m.type === "select" && (typeof m.segmentId === "string" || m.segmentId === null)) selectSeg(m.segmentId, k);
  if (m.type === "evidence" && typeof m.id === "string") setEvidence(m.id, !!m.on, k);
  // a view reloading itself reports its boot step before "ready": only user steps after "ready" count
  if (m.type === "step" && Number.isInteger(m.i) && F.ready) setStep(m.i + 1, k);
});
// operator -> rescuer: persist the assignment (phones poll GET /story/assign) and tell embedded patrol views
async function assignTeam(resourceId, segmentId) {
  try { const a = await api("/story/assign", { resourceId, segmentId, at: curClock(), scenario: store.scenario, segmentName: curStep()?.segments.find((x) => x.id === segmentId)?.name }); store.manual = a.assignments || []; } catch (e) { toast("Przydział nie został zapisany. " + plErr(e)); }
  for (const id of ["frameTeren", "frameRescuer"]) { const f = $(id); try { f.contentWindow && f.contentWindow.postMessage({ source: "rescue-app", type: "assign", team: resourceId, resourceId, segmentId, by: "operator" }, location.origin); } catch (e) {} }
  renderPanels();
}
// ---------- roles: ratownik (phone, own task + patrol reports) / operator (all modes). ?role= or remembered; picker on first open
function setRole(r) {
  if (r === "ratownik" && store.time !== "live") setTime("live");
  store.role = r; try { localStorage.setItem("rescue-app-role", r); } catch (e) {}
  document.body.classList.toggle("role-ratownik", r === "ratownik"); document.body.classList.toggle("role-operator", r === "operator");
  $("roleBtn").innerHTML = '<span class="rl-pre">Rola: </span>' + (r === "ratownik" ? "ratownik" : "operator");   // the prefix hides under 1500 px (app.css)
  $("rolePick").hidden = true;
  showFirstRun(r);
  if (r === "ratownik") {
    $("rMapHost").appendChild($("map"));
    pollTask(); renderRescuer(); setRescuerFrame(); startGps();
  } else {
    $("center").insertBefore($("map"), $("center").firstChild);
    setMode(store.mode || "akcja");
  }
  setFloat();
  setTimeout(() => map.resize(), 50);
}
// first-run hint: one line, dismissible, remembered per role
const HINTS = {
  // sens-funkcji R2-9: where you are and what to look at (the action is already picked), not "Wybierz akcję u góry"
  operator: () => { const nm = (STATIC[store.scenario] && STATIC[store.scenario].name.replace(/\s*\(.*\)$/, "").split(" - ")[0]) || scenTitle().split(" - ")[0] || "", at = innerWidth <= 600 ? "Na dole" : "Po prawej";
    return store.time === "live" ? `To akcja ${nm} na żywo. ${at}: gdzie szukać najpierw. Meldunek zespołu lub relację świadka wpisz w Czacie.` : `To nagrana historia akcji ${nm}. ${at}: gdzie szukać najpierw.`; },
  ratownik: "Wybierz swój zespół. Zadanie i mapa są u góry, meldunki wysyłasz dużymi przyciskami na dole.",
};
function showFirstRun(role) {
  const el = $("firstRun"); let seen = false; try { seen = localStorage.getItem("rescue-app-hint-" + role) === "1"; } catch (e) {}
  if (seen || !HINTS[role]) { el.hidden = true; return; }
  // header line for the operator; on the phone the header is reduced, so the hint goes above the task card
  if (role === "ratownik") $("rescuer").insertBefore(el, $("rescuer").firstChild); else $("status").before(el);
  el.hidden = false; $("firstRunText").textContent = typeof HINTS[role] === "function" ? HINTS[role]() : HINTS[role];
  const done = () => { el.hidden = true; try { localStorage.setItem("rescue-app-hint-" + role, "1"); } catch (e) {} removeEventListener("pointerdown", done, true); removeEventListener("blur", frameClick); };
  const frameClick = () => setTimeout(() => { if (document.activeElement && document.activeElement.tagName === "IFRAME") done(); }, 0);
  $("firstRunOk").onclick = done;
  setTimeout(() => { addEventListener("pointerdown", done, true); addEventListener("blur", frameClick);
    document.querySelectorAll("iframe").forEach((f) => { const on = () => { try { f.contentWindow.addEventListener("pointerdown", done, true); } catch (e) {} }; on(); f.addEventListener("load", on); }); }, 0);   // R2-9: any click (also into the 2D / 3D frames, which blur this window) dismisses it
}
function refreshFirstRun() {   // R2-9: the action name and Na żywo / Historia are known only once the run is in
  if (store.role === "operator" && !$("firstRun").hidden) $("firstRunText").textContent = HINTS.operator();
}
// Akcja: the event cards hide behind "Sygnały" so the dock is one line; Plan always shows them
$("sigBtn").onclick = () => { const on = document.body.classList.toggle("signals"); $("sigBtn").setAttribute("aria-pressed", on); setTimeout(pushInsets, 50); };
hoverHold($("bottom"));   // hover: the cards open above the dock and stay 3 s after leaving (dock.css #bottom.peek, no inset change)
// Akcja: the right panel collapses like every overlay panel (foldPanel in dock.js: strip + pin, hover / focus / tap, 3 s hold); it
// keeps the Top 3 (.fold-keep) and unfolds Zasoby, Na żywo and the details over the map (app.css #right.peek, no inset change).
// The phone (<= 600 px) keeps its bottom sheet: foldPanel is a no-op there, hoverHold as before.
for (const e of document.querySelectorAll("#right>.hero, #segs, #alerts, #liveBox")) e.classList.add("fold-keep");
if (!foldPanel($("right"), { title: "Gdzie szukać najpierw", key: "rescue-right-pin", live: false, sum: () => document.body.classList.contains("time-live") ? "zasoby · na żywo · plan" : "zasoby · plan · ocena" })) { hoverHold($("right")); $("right").tabIndex = 0; }
function setRescuerFrame() { const t = myTeam(); setFrame("frameRescuer", patrolURL(t)); }
$("roleBtn").onclick = () => { $("rolePick").hidden = false; };
$("rolePick").onclick = (e) => { const b = e.target.closest("[data-role]"); if (b) setRole(b.dataset.role); };
addEventListener("message", (e) => {
  if (e.origin !== location.origin || !e.data || e.data.source !== "rescuePatrol") return;
  if (e.data.type === "report") toast("Meldunek wysłany");
  if (e.data.type === "queued") toast("Brak łączności - meldunek w kolejce");
});
// ---------- modes (top tabs) and views inside a mode
const MODES = {
  akcja: { label: "Akcja", views: [["2d", "2D"], ["3d", "3D"]].concat(/[?&](split|dev)=1\b/.test(location.search) ? [["split", "2D + 3D"]] : []) },   // sens-funkcji #18: 2D + 3D only with ?split=1 / ?dev=1
  edycja: { label: "Plan", views: [["map", "Mapa"], ["split", "Mapa + 3D"]] },
  teren: { label: "Teren", views: [["przeglad", "Przegląd zespołów"], ["patrol", "Telefon patrolu"], ["field", "Meldunek"]] },
  monitoring: { label: "Monitoring", views: [] },
  walidacja: { label: "Walidacja", views: [] },
};
const lastView = {};
// three top tabs (redesign): Akcja, Plan (= edycja), Więcej (Teren / Monitoring / Walidacja as sub-tabs in #more)
const DEV = new URLSearchParams(location.search).get("dev") === "1";   // sens-funkcji #14: Monitoring / Walidacja are our tools, only with ?dev=1
const TABS = [["akcja", "Akcja"], ["edycja", "Plan"], ["wiecej", "Więcej"]], MORE = DEV ? ["teren", "monitoring", "walidacja"] : ["teren"];
let lastMore = "teren";
$("modes").innerHTML = TABS.map(([k, l]) => `<button data-mode="${k}" role="tab">${l}</button>`).join("");
$("modes").onclick = (e) => { const b = e.target.closest("[data-mode]"); if (b) setMode(b.dataset.mode === "wiecej" ? lastMore : b.dataset.mode); };
$("more").innerHTML = MORE.map((k) => `<button data-mode="${k}" role="tab">${MODES[k].label}</button>`).join("");
$("more").onclick = (e) => { const b = e.target.closest("[data-mode]"); if (b) setMode(b.dataset.mode); };
$("views").onclick = (e) => { const b = e.target.closest("[data-view]"); if (b) setView(b.dataset.view); };
function setMode(m, v) {
  if (!MODES[m] || (!DEV && (m === "monitoring" || m === "walidacja"))) m = "akcja";
  store.mode = m;
  document.body.className = document.body.className.replace(/\bmode-\w+/g, "").trim() + " mode-" + m;
  if (MORE.includes(m)) lastMore = m;
  document.querySelectorAll("#modes button").forEach((b) => b.classList.toggle("on", b.dataset.mode === m || (b.dataset.mode === "wiecej" && MORE.includes(m))));
  document.querySelectorAll("#more button").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
  $("more").style.display = MORE.includes(m) ? "" : "none";
  const views = MODES[m].views;
  $("views").innerHTML = views.map(([k, l]) => `<button data-view="${k}" role="tab">${l}</button>`).join("");
  $("views").style.display = views.length ? "" : "none";
  if (m === "edycja" && store.backend !== "studio" && store.hasStudio) { setMode.back = store.scenario; loadScenario("studio").catch((e) => toast(plErr(e))); }
  else if (m !== "edycja" && store.backend === "studio" && setMode.back) { const b = setMode.back; setMode.back = null; switchTo = b; window.__boot?.show("Teren i scenariusz…", true); loadScenario(b).then(() => { renderLiveHead(); if (!(store.role === "operator" && Object.values(FRAMES).some((F) => F.visible()))) window.__boot?.done(); }).catch((e) => { toast(plErr(e)); window.__boot?.done(); }); }   // loader over the Studio views until the incident's own view is ready (no 3 s of "Studio - nowa historia")   // QA #1 (AI Mateusza #1): leaving Plan brings back the incident it replaced (Na żywo again)
  try { localStorage.setItem("rescue-app-mode", m); } catch (e) {}
  setFloat(); // before setView: the frames are created with the floating insets
  setTimeout(pushInsets, 260);   // the dock height animates (app.css): scene padding once more at the end
  setView(v || lastView[m] || (views[0] || [""])[0]);
  if (store.run) renderPanels();
  if (m === "teren") showTeren();
  if (m === "monitoring") showMonitoring();
  if (m === "walidacja") showValidation();
  renderLiveHead();
}
function setView(v) {
  const views = MODES[store.mode].views; if (views.length && !views.some(([k]) => k === v)) v = views[0][0];
  store.view = v; lastView[store.mode] = v;
  document.body.className = document.body.className.replace(/\bview-\w+/g, "").trim() + " view-" + v;
  document.querySelectorAll("#views button").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
  setTimeout(() => { map.resize(); pushInsets(); }, 0);
  if (store.mode === "teren") showTeren();
  sync3d("view");
  hint();
}
// field report pages (out/field.html, out/ops.html) and the patrol view talk to this same server
const FIELD = "";
function setFrame(id, url) { const f = $(id); if (f.dataset.src !== url) { f.dataset.src = url; f.src = url; } }
function showTeren() {
  $("frameTeren").style.display = store.view === "przeglad" ? "none" : ""; $("teamFeed").style.display = store.view === "przeglad" ? "" : "none";
  if (store.view === "przeglad") return pollFeed();
  if (store.view === "field") setFrame("frameTeren", (FIELD || "") + "/field.html");
  else setFrame("frameTeren", patrolURL());
}
function showMonitoring() { setFrame("frameMon", (FIELD || "") + "/ops.html"); }
function patrolURL(team) {
  const api = FIELD || location.origin, run = store.backend === "studio" ? "/story" : store.runUrl;
  return `../web/patrol/index.html?embed=1&api=${encodeURIComponent(api)}${run ? "&run=" + encodeURIComponent(run) : ""}${team ? "&team=" + encodeURIComponent(team) : ""}`;
}
// Teren / Przegląd zespołów: live field reports (GET /live-events) per team + silence from /metrics, "Dodaj do historii" -> Studio FieldReport
let feedTimer = null;
async function pollFeed() {
  clearTimeout(feedTimer);
  if (store.mode !== "teren" || store.view !== "przeglad") return;
  let ev = [], met = "";
  try { ev = await (await fetch((FIELD || "") + "/live-events", { cache: "no-cache" })).json(); } catch (e) {}
  try { met = await (await fetch((FIELD || "") + "/metrics", { cache: "no-cache" })).text(); } catch (e) {}
  const M = prom(met), now = M.find((m) => m.n === "rescue_server_time_seconds")?.v || Date.now() / 1000, thr = M.find((m) => m.n === "rescue_silent_threshold_seconds")?.v || 600;
  const teams = {}; M.filter((m) => m.n === "rescue_client_last_report_timestamp_seconds").forEach((m) => { const k = m.lab.team || m.lab.client_id; teams[k] = Math.max(teams[k] || 0, m.v); });
  const res = (curStep()?.resources || []), man = store.manual || [];
  $("teamFeed").innerHTML = `<div class="vgrid">${res.map((r) => { const last = teams[r.id], age = last ? now - last : null, a = man.find((x) => x.resourceId === r.id) || (curStep()?.assignments || []).find((x) => x.resourceId === r.id);
      return `<div class="vcard"><div class="row" style="justify-content:space-between"><b>${esc(r.name)}</b>${age == null ? `<span class="pill off">brak meldunków</span>` : age > thr ? `<span class="pill off">CISZA ${Math.round(age / 60)} min</span>` : `<span class="pill">${Math.round(age / 60)} min temu</span>`}</div>
        <div class="help">${a ? `zadanie: ${esc(a.segmentId)} ${esc(a.segmentName || "")}${a.by === "operator" ? " (operator)" : " (plan)"}` : r.available ? "bez zadania" : esc(r.reason)}</div></div>`; }).join("")}</div>
    <h2>Meldunki z terenu (${ev.length})</h2>
    ${ev.slice().reverse().slice(0, 60).map((e, k) => `<div class="box"><div class="row" style="justify-content:space-between"><b>${esc(e.at || (e.t || "").slice(11, 16))}</b><span class="mute">${esc(e.parsedBy || "")}</span></div>
      <div>${esc(e.text)}</div><div class="help">${(e.hints || []).map((h) => esc(({ segmentSearched: "przeszukano", clue: "ślad", weatherObs: "pogoda", resourceStatus: "status zespołu" }[h.type] || h.type) + (h.segmentId ? " " + h.segmentId : ""))).join(", ")}</div>
      ${store.backend === "studio" && store.hasStudio ? `<button data-add="${ev.length - 1 - k}">Dodaj do historii</button>` : ""}</div>`).join("") || `<div class="help">Brak meldunków. Ratownicy wysyłają je z roli „Ratownik” albo z telefonu patrolu.</div>`}`;
  $("teamFeed").querySelectorAll("[data-add]").forEach((b) => b.onclick = () => { const e = ev[+b.dataset.add]; run(() => api("/story/event", { event: { provider: "FieldReport", text: e.text, at: e.at } }), "Meldunek dodany do historii"); });
  feedTimer = setTimeout(pollFeed, 8000);
}
// ---------- live mode (CONTRACT.md "Live mode"): poll GET /api/live?sc=, refetch the run when seq grows; LIVE badge + scenario
// title in the header (and the phone bar), feed of the latest events, ad-hoc "+ Ślad" (click the map) and "Wyślij zespół" in Akcja
const CLUE_TYPES = [["odziez", "Odzież"], ["slad", "Ślad"], ["swiadek", "Świadek"], ["telefon", "Sygnał telefonu"], ["znalezisko", "Znalezisko"]];
const live = { seq: -1, ok: false, events: [], armed: false, sc: null };
function scenTitle() {
  const R = D(); if (!R) return "";
  const inc = String(R.incident || "").replace(/\s*\(scenariusz[^)]*\)\s*$/i, ""), parts = inc.split(" - ");
  const what = parts[0] ? parts[0][0].toLowerCase() + parts[0].slice(1) : "";
  if (store.backend === "studio") return "Studio" + (what ? " - " + what : "");
  const place = (STATIC[store.scenario] && STATIC[store.scenario].name.replace(/\s*\(.*\)$/, "").split(" - ")[0]) || (parts[1] || store.scenario || "");
  return what ? `${place} - ${what}` : place;
}
// ---------- Na żywo vs Historia (Andrzej): two separate time modes for the whole app.
// Historia = the prerecorded scenario only (GET /api/run/<sc>?live=0), timeline and play; live functions stay visible but inactive,
// with a note and a switch back. Na żywo = the live run (field reports folded in), timeline held at "now"; + Ślad, Wyślij zespół,
// confirmations, + Nowa akcja and Centrum work only here. Plan (Studio editing) is neither. Rescuer phones are always live.
function initTime() {
  const q = new URLSearchParams(location.search), t = q.get("time");
  if (t === "live" || t === "hist") return t;
  if (JOINED || q.get("role") === "ratownik") return "live";
  if (q.get("step") != null) return "hist";
  try { const v = localStorage.getItem("rescue-app-time"); if (v === "live" || v === "hist") return v; } catch (e) {}
  return "hist";
}
store.time = initTime();
const runUrlFor = (u) => store.time === "hist" ? u + (u.includes("?") ? "&" : "?") + "live=0" : u;
const liveAvail = () => store.backend === "api" && live.ok;          // this scenario has a live action on the server
const liveOn = () => store.time === "live" && store.backend === "api" && store.mode !== "edycja";
const liveNow = () => liveOn() && live.ok;                            // live functions are active
function syncFrames() { const R = D(); if (!R || !R.steps) return; for (const k in FRAMES) if (FRAMES[k].ready) postTo(k, { type: "step", i: store.step - 1 }); $("slider").value = store.step; tlSlider(); }
async function setTime(t, quiet) {
  if (t === store.time) return;
  if (t === "live" && store.backend !== "api") { toast("Ten scenariusz to tylko nagranie - nie ma akcji na żywo. Wybierz scenariusz z serwera albo „+ Nowa akcja”.", 4500); return; }
  stopPlay();
  store.time = t; try { localStorage.setItem("rescue-app-time", t); } catch (e) {}
  renderLiveHead();   // the switch answers the click at once; the map follows when the run is in
  if (!quiet) toast(t === "live" ? "Na żywo: mapa pokazuje teraz, ze zgłoszeniami z terenu" : "Historia: nagrany przebieg akcji. Przesuń oś czasu albo naciśnij ▶", 3000);
  if (store.backend === "api") { try { await loadScenario(store.scenario); } catch (e) { toast(plErr(e)); } }
  renderLiveHead();
}
// the map follows a move only after the server recomputed the run (3-7 s): until then the buttons stay locked with a
// "przeliczam" note (the 3 s live poll used to re-enable them under the old "dalej"), the run is fetched right away, and a run
// fetch started before the move (runGen) is dropped instead of putting the old position back
var runGen = 0;
async function advance(op) {
  if (!liveNow() || advance.busy) return;
  if (op === "start" && !confirm("Cofnąć akcję do początku dla wszystkich podłączonych (operatorzy, telefony ratowników, Centrum)?")) return;
  const g = ++runGen;
  advance.busy = op === "start" ? "Cofam akcję do początku…" : "Przechodzę do następnego zdarzenia…"; renderLiveHead();
  try {
    const r = await api("/api/advance", { sc: store.scenario, op });
    advance.busy = "Przeliczam mapę: " + r.title; renderLiveHead();
    toast("Na żywo: " + r.title, 3500);
    if (liveOn() && store.runUrl) { const run = await api(store.runUrl); if (g === runGen) applyRun(run, {}, "run"); }
  } catch (e) { toast(plErr(e), 4500); }
  advance.busy = null; renderLiveHead();
}
$("advNext").onclick = () => advance("next");
// Historia: rewind the recording to its first event (local to this screen, nobody else sees it)
$("stepPrev").onclick = () => { if (liveOn()) return; stopPlay(); setStep(store.step - 1); };   // ported from b069c21 (AI Andrzeja)
$("histStart").onclick = () => { if (liveOn()) return; stopPlay(); if (tlScrub()) setMinute(tlLo(tlScrub())); else setStep(1); };
$("advStart").onclick = () => advance("start");
$("backLive").onclick = () => setTime("live");   // Historia -> the live moment (after an event jump from Na żywo, or any time)
$("tmode").onclick = (e) => { const b = e.target.closest("[data-t]"); if (b) setTime(b.dataset.t); };
// live-only header actions (+ Nowa akcja, Centrum): inactive in Historia, a click explains how to switch
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-needslive]"); if (!el || store.time === "live") return;
  e.preventDefault(); e.stopImmediatePropagation();
  toast("„" + el.textContent.trim() + "” działa w trybie Na żywo - przełącz u góry: Na żywo / Historia.", 4000);
}, true);
function renderLiveHead() {
  const mode = store.mode === "edycja" || store.backend === "studio" ? "PLAN" : liveOn() ? "LIVE" : "HISTORIA";
  const tip = { LIVE: live.ok ? "Akcja na żywo: zmiany z terenu i od operatora przeliczają mapę co kilka sekund" : "Na żywo - brak połączenia z serwerem akcji", PLAN: "Plan / edycja historii - nie akcja na żywo", HISTORIA: "Nagrana historia akcji - bez zdarzeń na żywo" }[mode];
  for (const [b, t] of [["modeBadge", "scenTitle"], ["rModeBadge", "rScenTitle"]]) {
    const el = $(b); if (!el) continue;
    el.className = "lbadge " + mode.toLowerCase() + (mode === "LIVE" && live.ok ? " atend" : "");
    el.innerHTML = `<i></i>${mode}`;
    el.title = tip;
    $(t).textContent = scenTitle(); $(t).title = (D() && D().incident) || "";
  }
  refreshFirstRun();
  const plan = store.mode === "edycja" || store.backend === "studio";
  $("tmode").hidden = plan;
  $("tmode").querySelectorAll("button").forEach((b) => {
    b.classList.toggle("on", b.dataset.t === store.time);
    if (b.dataset.t === "live") b.disabled = store.backend !== "api";
  });
  document.querySelectorAll("[data-needslive]").forEach((el) => { el.classList.toggle("needslive", store.time !== "live"); el.setAttribute("aria-disabled", store.time !== "live"); });
  // dock: Historia plays the recording; Na żywo holds the timeline at now
  const on = liveOn();
  // Na żywo: no replay; the operator moves the incident on for everyone (POST /api/advance), the server's liveCursor says what is next
  $("slider").hidden = on; $("play").hidden = on; $("speed").hidden = on; $("histStart").hidden = on; $("stepPrev").hidden = on;
  $("backLive").hidden = on || plan || store.backend !== "api" || store.role === "ratownik"; $("advBox").hidden = !on || store.role === "ratownik" || !DEMO_ADV;
  const lc = D() && D().liveCursor, nx = lc && lc.next;
  $("advNext").disabled = !!advance.busy || !liveNow() || !nx; $("advStart").disabled = !!advance.busy || !liveNow();
  $("advNextT").textContent = advance.busy ? advance.busy : !lc ? "" : nx ? `⏭ następne zdarzenie ${nx.at}` : "koniec nagranej akcji";
  $("advNextT").title = nx ? `Następne zdarzenie: ${nx.at} ${nx.title}` : "";
  $("tlabel").textContent = plan ? "Historia" : on ? "Na żywo · teraz" : "Historia";
  renderDock();
  document.body.classList.toggle("time-live", on); document.body.classList.toggle("time-hist", !plan && !on);
  // live box: always in Akcja, active only in Na żywo with a live connection
  const box = $("liveBox"); if (!box) return;
  box.hidden = plan || !D();
  const act = liveNow();
  box.classList.toggle("frozen", !act);
  for (const id of ["liveClue", "liveSend", "ldGo"]) $(id).disabled = !act;
  if (!act) { live.armed = false; $("liveClue").classList.remove("on"); $("liveDispatch").hidden = true; }
  const note = $("liveNote");
  note.hidden = act;
  if (!act) note.innerHTML = store.time === "hist"
    ? `Oglądasz nagraną historię akcji. Ślady, wysyłanie zespołów, potwierdzenia i nowe akcje działają tylko na żywo.${store.backend === "api" ? ` <button type="button" class="primary golive">Przełącz na żywo</button>` : ""}`
    : `Brak połączenia na żywo z serwerem akcji. Funkcje na żywo wrócą, gdy serwer odpowie.`;
  const g = note.querySelector(".golive"); if (g) g.onclick = () => setTime("live");
}
const hhmm = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
function renderDock() {
  const R = D(); if (!R || !R.steps || !$("tlMarks")) return;
  const n = R.steps.length, S = curStep(), T = tlScrub(), G = evGroups(R), N = G.length, cg = groupOf(G, store.step);
  $("tlMarks").innerHTML = marksHTML(R, G, cg,
    (g) => T ? g.first != null && g.first > store.minute : g.ks[0] > store.step,
    (g, j) => T && g.minute != null ? (tlFrac(T, g.minute) * 100).toFixed(2) : N > 1 ? (j / (N - 1) * 100).toFixed(2) : 50);
  if (S) $("clock").title = S.t + " · " + S.label;
  // step counter "k/n · HH:MM" (ported from b069c21, AI Andrzeja); Na żywo: "teraz HH:MM"
  if (S) $("dkStep").innerHTML = liveOn() ? `teraz <b>${esc(S.t)}</b>` : T ? `<b>${esc(tlClock(T, store.minute))}</b> · ${store.step}/${n}` : `<b>${store.step}</b>/${n} · ${esc(S.t)}`;
  $("stepPrev").disabled = store.step <= 1;
  // the native range stays on top, invisible: drag + arrow keys + screen readers; our markers are the picture (ported from b069c21, AI Andrzeja)
  $("tlFill").style.width = `calc((100% - 16px) * ${T ? tlFrac(T, store.minute).toFixed(4) : n > 1 ? ((store.step - 1) / (n - 1)).toFixed(4) : 0})`;
  if (S) $("slider").setAttribute("aria-valuetext", T ? `${tlClock(T, store.minute)}, krok ${store.step} z ${n}, ${S.label}` : `Krok ${store.step} z ${n}, ${S.t}, ${S.label}`);
  // no ticker chips any more (Andrzej 2026-10-04): the timeline takes their width, a point's events are its tooltip (tlTip)
  if (tlTip.kb) tlTip(cg + 1);
}
// group number (1-based) under the pointer: the nearest marker
function tlIndexAt(x) {
  const r = $("tlMarks").getBoundingClientRect(), G = evGroups(D()), N = G.length, f = Math.max(0, Math.min(1, (x - r.left) / (r.width || 1))), T = tlScrub();
  if (T) { let best = 1, bd = 1e9; G.forEach((g, j) => { if (g.minute == null) return; const d = Math.abs(tlFrac(T, g.minute) - f); if (d < bd) { bd = d; best = j + 1; } }); return best; }
  return N < 2 ? 1 : Math.round(f * (N - 1)) + 1;
}
// the event card of group j (1-based): one line per event "HH:MM · title"; 0 hides it
function tlTip(j) {
  const tip = $("tlTip"), R = D(), g = j && R && evGroups(R)[j - 1], m = g && $("tlMarks").children[j - 1];
  if (!m) { tip.hidden = true; return; }
  tip.innerHTML = tipHTML(R, g);
  tip.hidden = false;
  const r = m.getBoundingClientRect();
  tip.style.left = Math.max(8, Math.min(innerWidth - tip.offsetWidth - 8, r.left + r.width / 2 - tip.offsetWidth / 2)) + "px";
  tip.style.top = Math.max(8, r.top - tip.offsetHeight - 10) + "px";
}
$("tl").addEventListener("pointermove", (e) => { if (D() && D().steps) { clearTimeout(tlTip.h); tlTip(tlIndexAt(e.clientX)); } });
$("tl").addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") tlTip(0); });
$("tl").addEventListener("pointerdown", (e) => { tlTip.downX = e.clientX; });
$("tl").addEventListener("click", (e) => {
  if (!D() || !D().steps) return;
  const j = tlIndexAt(e.clientX), g = evGroups(D())[j - 1]; if (!g) return;
  const last = g.ks[g.ks.length - 1];
  if (liveOn()) { goEvent(last, g.minute); return; }   // Na żywo cannot rewind: Historia at that group's minute
  else if (tlScrub()) { const r = $("tlMarks").getBoundingClientRect(), T = tlScrub(); if (Math.abs(e.clientX - (tlTip.downX ?? e.clientX)) <= 4 && g.minute != null && Math.abs((tlFrac(T, g.minute) * r.width + r.left) - e.clientX) <= (e.pointerType === "touch" ? 16 : 8)) { goEvent(last, g.minute); return; } }   // a click (not a drag) on a point = what its ticker chip did: land on the group's minute + zoom; the range handles the rest
  else { if (!g.ks.includes(store.step)) setStep(last); focusEvent(last); }
  tlTip(j); clearTimeout(tlTip.h); tlTip.h = setTimeout(() => tlTip(0), 2200);
});
// keyboard: while the range has focus the tooltip shows the events of the current point (arrow keys move it), Esc hides it
$("slider").addEventListener("focus", () => { if (!$("slider").matches(":focus-visible")) return; tlTip.kb = true; clearTimeout(tlTip.h); const R = D(); if (R && R.steps) tlTip(groupOf(evGroups(R), store.step) + 1); });
$("slider").addEventListener("blur", () => { tlTip.kb = false; tlTip(0); });
$("slider").addEventListener("keydown", (e) => { if (e.key === "Escape" && tlTip.kb) { tlTip.kb = false; tlTip(0); } });
// where a Na żywo feed item sits on the timeline: the scripted step with the same title, else its clock as a scenario minute
function liveEvTarget(e) {
  const R = D(), k = R && R.steps ? R.steps.findIndex((s) => s.label === e.title) + 1 : 0;
  if (k) return { step: k };
  const T = tlDoc(), m = T ? tlMinOfClock(T, hhmm(e.t)) : null;
  return m != null ? { min: m } : {};
}
function renderLiveFeed() {
  const el = $("liveFeed"); if (!el) return;
  const K = { clue: "ślad", dispatch: "przydział", report: "meldunek", scenario: "zdarzenie", inventory: "sprzęt", fix: "pozycja" };
  // operator ACK (Mateusz): unconfirmed messages stand out, ✓ confirms one, "Potwierdź wszystkie" confirms the rest (POST /api/ack)
  const unacked = live.events.filter((e) => !e.acked && e.by !== "operator");
  el.innerHTML = live.events.slice(-8).reverse().map((e) => { const g = liveEvTarget(e); return `<div class="lfi ${!e.acked && e.by !== "operator" ? "unack" : ""}"${g.step ? ` data-step="${g.step}"` : g.min != null ? ` data-min="${g.min}"` : ""} title="Pokaż ten moment w Historii"><span class="lft">${esc(hhmm(e.t))}</span> <b${e.team ? ` data-actor="${esc(e.team)}" title="Dziennik: ${esc(e.team)}"` : ""}>${esc(e.by === "operator" ? "Operator" : e.team || "Ratownik")}</b> <span class="mute">${esc(K[e.kind] || e.kind)}</span> ${esc(e.title)}${!e.acked && e.by !== "operator" ? ` <button class="ack1" data-seq="${e.seq}" title="Potwierdź tę wiadomość">✓</button>` : e.acked ? ` <span class="ackd" title="Potwierdzone">✓</span>` : ""}</div>`; }).join("")
    || `<div class="help">Brak zdarzeń na żywo. Dodaj ślad albo wyślij zespół - mapa przeliczy się od razu.</div>`;
  if ($("ackCount")) $("ackCount").textContent = unacked.length ? `Niepotwierdzone: ${unacked.length}` : "Wszystko potwierdzone";
  $("liveBox").classList.toggle("has-unack", unacked.length > 0);   // the collapsed right panel keeps this row (app.css #right:not(.peek))
  if ($("liveAckAll")) $("liveAckAll").disabled = !unacked.length || !liveNow();
  el.querySelectorAll(".ack1").forEach((b) => { b.disabled = !liveNow(); b.onclick = () => ackEvents(+b.dataset.seq); });
}
async function ackEvents(seq) {
  if (!liveNow()) return toast("Potwierdzanie działa tylko na żywo", 3000);
  try {
    await api("/api/ack", seq ? { seq } : { sc: live.sc });
    for (const e of live.events) if (!seq || e.seq === seq) e.acked = true;
    renderLiveFeed();
    if (!seq) toast("Wszystkie wiadomości potwierdzone");
  } catch (e) { toast(plErr(e)); }
}
if ($("liveAckAll")) $("liveAckAll").onclick = () => ackEvents(null);
// a Na żywo feed item: that moment in Historia (exact minute); ✓ confirms without jumping
if ($("liveFeed")) $("liveFeed").addEventListener("click", (e) => {
  if (e.target.closest("button,.cw,input,[data-actor]")) return;   // ✓, clue weight, actor drawer keep their own clicks
  const it = e.target.closest(".lfi[data-step],.lfi[data-min]"); if (!it) return;
  goEvent(it.dataset.step ? +it.dataset.step : 0, it.dataset.min ? +it.dataset.min : null);
});
async function pollLive() {
  clearTimeout(pollLive.h);
  const sc = store.backend === "api" ? store.scenario : null;
  if (store.hasApi && sc) {
    if (sc !== live.sc) { live.sc = sc; live.seq = -1; live.events = []; }
    try {
      const d = await api(`/api/live?sc=${encodeURIComponent(sc)}&since=${Math.max(0, live.seq)}`);
      if (sc === live.sc) {
        const first = live.seq < 0, restarted = d.seq < live.seq;
        if (restarted) live.events = [];
        const have = new Set(live.events.map((e) => e.seq));
        live.events = [...live.events, ...(d.events || []).filter((e) => !have.has(e.seq))].slice(-30);
        const changed = !first && d.seq !== live.seq;
        live.seq = d.seq; live.ok = true;
        if (changed) { renderLiveHead(); renderLiveFeed(); await onLiveChange(restarted ? [] : d.events || []); }   // the feed shows the event at once, the run follows (12 -> 5 s, AI Mateusza #2 1791081081523)
      }
    } catch (e) { live.ok = false; }
  } else live.ok = false;
  renderLiveHead(); renderLiveFeed();
  pollLive.h = setTimeout(pollLive, 3000);
}
async function onLiveChange(evs) {
  try { const a = await api("/story/assign"); store.manual = a.assignments || []; } catch (e) {}
  if (liveOn() && store.runUrl) { const g = runGen; try { const run = await api(store.runUrl); if (g === runGen) applyRun(run, {}, "run"); } catch (e) {} }
  if (store.role === "ratownik") renderRescuer();
  const other = evs.filter((e) => !(e.by === "operator" && store.role === "operator"));
  if (other.length) toast("Na żywo: " + other.map((e) => (e.team ? e.team + ": " : "") + e.title).join("; ") + (liveOn() ? "" : " (oglądasz historię - przełącz na „Na żywo”)"), 4000);
}
function liveForm(lat, lon, x, y) {
  if (!liveNow()) { live.armed = false; return; }
  closePop(); live.armed = false; $("liveClue").classList.remove("on");
  const el = document.createElement("form"); el.className = "pop"; el.style.position = "fixed";
  el.style.left = Math.max(8, Math.min(innerWidth - 250, x + 14)) + "px"; el.style.top = Math.max(8, Math.min(innerHeight - 220, y - 20)) + "px";
  el.innerHTML = `<h3>Dodaj ślad (na żywo)</h3><label>Rodzaj <select name="type">${CLUE_TYPES.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
    <label>Opis <input name="note" maxlength="200" placeholder="np. czerwona czapka"></label><div class="help">${lat.toFixed(5)}, ${lon.toFixed(5)}</div>
    <div class="row"><button type="button" class="cancel">Anuluj</button><button class="primary" type="submit">Dodaj</button></div>`;
  document.body.appendChild(el); pop = { el };
  el.querySelector(".cancel").onclick = closePop;
  el.onkeydown = (e) => { if (e.key === "Escape") closePop(); };
  el.onsubmit = async (e) => {
    e.preventDefault();
    const body = { type: el.elements.type.value, note: el.elements.note.value, lat: +lat.toFixed(5), lon: +lon.toFixed(5), by: store.role === "ratownik" ? "ratownik" : "operator", sc: store.scenario, id: "op-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7) };
    if (store.role === "ratownik" && myTeam()) body.team = myTeam();
    closePop();
    try { await api("/api/clue", body); toast("Ślad dodany - przeliczam mapę"); pollLive(); } catch (err) { toast("Nie dodano śladu. " + plErr(err), 4000); }
  };
  setTimeout(() => el.elements.note.focus(), 0);
}
$("liveClue").onclick = () => { if (!liveNow()) return; live.armed = !live.armed; $("liveClue").classList.toggle("on", live.armed); if (live.armed) toast("Kliknij mapę w miejscu śladu (Esc - anuluj)", 4000); };
addEventListener("keydown", (e) => { if (e.key === "Escape" && live.armed) { live.armed = false; $("liveClue").classList.remove("on"); } });
addEventListener("message", (e) => {   // 2D view: {source:"rescue2d", type:"mapclick", lat, lon, x, y} (user click on its map)
  if (e.origin !== location.origin || e.source !== $("frame2d").contentWindow || !e.data || e.data.source !== "rescue2d" || e.data.type !== "mapclick" || !live.armed) return;
  const r = $("frame2d").getBoundingClientRect(); liveForm(+e.data.lat, +e.data.lon, r.left + (+e.data.x || r.width / 2), r.top + (+e.data.y || r.height / 2));
});
map.on("click", (e) => { if (live.armed) { const r = $("map").getBoundingClientRect(); liveForm(e.lngLat.lat, e.lngLat.lng, r.left + e.point.x, r.top + e.point.y); } });
$("liveSend").onclick = () => {
  if (!liveNow()) return;
  const box = $("liveDispatch"), S = curStep(); box.hidden = !box.hidden; if (box.hidden || !S) return;
  $("ldTeam").innerHTML = (S.resources || []).map((r) => `<option value="${esc(r.id)}" ${r.available ? "" : "disabled"}>${esc(r.name.split(" (")[0])}</option>`).join("");
  $("ldSeg").innerHTML = S.segments.map((s, k) => `<option value="${esc(s.id)}" ${s.id === store.selSeg ? "selected" : ""}>#${k + 1} ${esc(s.id)} ${esc(s.name)}</option>`).join("");
};
$("ldGo").onclick = async () => { if (!liveNow()) return; const t = $("ldTeam").value, s = $("ldSeg").value; if (!t || !s) return; await assignTeam(t, s); $("liveDispatch").hidden = true; toast(`${t} → ${s}`); pollLive(); };
subs.push((why) => { if (why === "load" || why === "mode" || why === "run" || why === "edit" || why === "step") renderLiveHead(); });

// ---------- wiring
subs.push((why) => {
  if (!store.run || !store.run.steps) return;
  renderMap(); renderPanels(); renderAssess();
  if (why !== "select") { renderPins(); renderTokens(); renderTeams(); }
  else renderPins();
  if (why !== "select" && why !== "selectEv" && why !== "step") sync3d(why);
  if (store.role === "ratownik" && why !== "select") renderRescuer();
});
$("scen").onchange = () => loadScenario($("scen").value).catch((e) => toast(plErr(e), 5000));
// "Zmień scenariusz" in place (CONTRACT "Centrum pick mode, embedded"): ONE Centrum iframe (pick=1&embed=1) in an overlay, created
// on first use and kept (hidden on close, so the next open is instant). rl-pick -> switch the scenario in place (no page load),
// history.pushState so browser Back / Forward walk the scenarios. The full-page pick (centrum.html?pick=1&return=) stays the fallback
// offered (a link in the overlay) when the iframe does not say rl-pick-ready within 10 s. The hidden #scen select stays the scenario state the rest of the shell reads.
function pickFullPage() {
  const u = new URL(location.href), q = u.searchParams, sc = $("scen").value;
  if (sc) q.set("sc", sc);
  for (const [k, v] of [["mode", store.mode], ["view", store.view], ["role", store.role], ["time", store.time]]) if (v) q.set(k, v);
  q.delete("key"); q.delete("step");
  location.href = "centrum.html?pick=1&return=" + encodeURIComponent(u.pathname + u.search + u.hash);
}
const PICK = { el: null, fr: null, ready: false, open: false, wait: 0 };
const pickPost = (m) => { try { PICK.fr.contentWindow.postMessage(m, location.origin); } catch (e) {} };
function pickOpen() {
  if (!PICK.el) {
    const el = PICK.el = document.createElement("div"); el.id = "pickLayer"; el.hidden = true;
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Wybierz akcję");
    const fr = PICK.fr = document.createElement("iframe"); fr.title = "Wybór scenariusza: mapa Polski i lista akcji";
    fr.src = "centrum.html?pick=1&embed=1&sc=" + encodeURIComponent(store.scenario || "");
    const slow = document.createElement("div"); slow.className = "pickslow"; slow.hidden = true;
    slow.innerHTML = 'Wybór scenariusza wczytuje się wolno. <button type="button">Otwórz pełną stronę wyboru</button>';
    slow.querySelector("button").onclick = pickFullPage;
    el.append(fr, slow); document.body.appendChild(el);
    PICK.wait = setTimeout(() => { if (!PICK.ready) slow.hidden = false; }, 10000);   // no rl-pick-ready yet: offer the old full-page pick (never navigate on our own)
  }
  PICK.open = true; PICK.el.hidden = false; document.body.classList.add("picking");
  if (PICK.ready) pickPost({ type: "rl-pick-show", sc: store.scenario });
  PICK.fr.focus();
}
function pickClose(tellFrame) {
  if (!PICK.el || !PICK.open) return;
  PICK.open = false; PICK.el.hidden = true; document.body.classList.remove("picking");
  if (tellFrame) pickPost({ type: "rl-pick-hide" });
  $("scenPick").focus();
}
addEventListener("message", (e) => {
  if (!PICK.fr || e.source !== PICK.fr.contentWindow || e.origin !== location.origin || !e.data || typeof e.data !== "object") return;
  const d = e.data;
  if (d.type === "rl-pick-ready") { PICK.ready = true; clearTimeout(PICK.wait); PICK.el.querySelector(".pickslow").hidden = true; if (PICK.open) pickPost({ type: "rl-pick-show", sc: store.scenario }); }
  else if (d.type === "rl-pick" && typeof d.sc === "string") { switchScenario(d.sc, true, true); pickClose(false); }   // loader first: it replaces the opaque overlay, no flash of the old map
  else if (d.type === "rl-pick-cancel") pickClose(false);
});
addEventListener("keydown", (e) => { if (e.key === "Escape" && PICK.open) { e.preventDefault(); pickClose(true); } });
$("scenPick").onclick = () => pickOpen();
// a scenario switch in place: the URL follows (pushState: Back returns to the previous scenario), the run, panels and views reload
// their data only; what belonged to the old incident (selection, playback, the hidden 2D spare of the other time mode) is dropped
let switchTo = null;   // the scenario a switch is loading (boot loader: whose "ready" counts)
async function switchScenario(sc, push = true, fromPick = false) {
  if (!store.scenList.some((s) => s.id === sc && !s.disabled)) { toast("Nieznany scenariusz: " + sc, 4000); return; }
  if (push) {
    const u = new URL(location.href), q = u.searchParams;
    q.set("sc", sc); q.delete("step"); q.delete("t"); q.delete("key");
    for (const [k, v] of [["mode", store.mode], ["view", store.view], ["role", store.role], ["time", store.time]]) if (v) q.set(k, v);
    if (sc !== store.scenario) history.pushState({ sc }, "", u);
  }
  if (sc === store.scenario) return;
  switchTo = sc; window.__boot?.show("Teren i scenariusz…", fromPick);   // boot loader again (index.html) until the new map is on screen
  stopPlay();
  Object.assign(store, { selSeg: null, selEv: null });
  const sp = FRAMES["2da"]; if (sp.spare) { sp.spare.remove(); sp.spare = null; sp.spareReady = null; }
  window.__boot?.step("Silnik - mapa poszukiwań…");
  try { await loadScenario(sc); } catch (e) { toast(plErr(e), 5000); window.__boot?.done(); return; }
  if (store.scenario !== sc) return;   // a newer switch (Back/Forward) took over: its own loader
  if (store.role === "operator" && Object.values(FRAMES).some((F) => F.visible())) window.__boot?.step("Mapa…"); else window.__boot?.done();   // no scene view to wait for
}
// the livefeed bell (appbell.js, AI Mateusza #1): "Otwórz" = this incident in Historia at its clock, in place, one run load
async function openAt(sc, clock) {
  const toHist = store.time !== "hist";
  if (toHist) { stopPlay(); store.time = "hist"; try { localStorage.setItem("rescue-app-time", "hist"); } catch (e) {} renderLiveHead(); }
  if (sc !== store.scenario) await switchScenario(sc);
  else if (toHist && store.backend === "api") { try { await loadScenario(sc); } catch (e) { toast(plErr(e)); } }
  renderLiveHead();
  const T = tlDoc(), m = clock && T ? tlMinOfClock(T, clock) : null; if (m != null) setMinute(m);
  focusWhenReady(sc, store.step);
}
// after a switch the 2D view is a new frame (double buffer): zoom onto the notified event once that frame is the shown one and
// ready, else the message lands in the old view (focusEvent: the area the event changed; a report / setup step keeps the full fit)
function focusWhenReady(sc, k, t0 = Date.now()) {
  if (store.scenario !== sc || store.step !== k || Date.now() - t0 > 30000) return;   // the operator moved on meanwhile
  const F = FRAMES["2da"];
  if (F.next || !F.ready || !String(F.src || "").includes("sc=" + encodeURIComponent(sc))) { setTimeout(() => focusWhenReady(sc, k, t0), 300); return; }
  setTimeout(() => { if (store.scenario === sc && store.step === k) focusEvent(k); }, 400);   // after the view's own first fit
}
addEventListener("popstate", (e) => {
  const sc = (e.state && e.state.sc) || new URLSearchParams(location.search).get("sc") || (store.hasApi ? "zawrat" : null);
  if (PICK.open) pickClose(true);
  if (sc && sc !== store.scenario) switchScenario(sc, false);
});

window.rescueApp = { CARDS, openForm, dropTeam, addInput, setStep, selectSeg, setView, setMode, undo, teamOps: () => teamOps, frames: FRAMES };   // tests
Object.assign(window.rescueApp, { setTime, loadScenario, switchScenario, pickOpen, openAt });   // intro.js (guided tour) drives the shell through these
Object.assign(window.rescueApp, { applyRun, onStore: (f) => subs.push(f) });   // chat.js (Czat): Historia what-if run + refresh hook
async function boot() {
  try {
    await detect();
    if (!store.scenList.length) throw new Error("Brak scenariuszy na serwerze.");
    renderPalette();
    let m = "akcja"; try { m = localStorage.getItem("rescue-app-mode") || "akcja"; } catch (e) {}
    const q = new URLSearchParams(location.search); if (q.get("mode")) m = q.get("mode");
    const want = q.get("sc") || (store.hasApi ? "zawrat" : null);
    if (want && store.scenList.some((s) => s.id === want)) $("scen").value = want;
    window.__boot?.step("Silnik - mapa poszukiwań…");   // boot loader (index.html): what is loading now
    await loadScenario($("scen").value);
    try { history.replaceState({ ...(history.state || {}), sc: store.scenario }, ""); } catch (e) {}   // Back to the first scenario finds its sc
    setMode(m, q.get("view"));
    if (q.get("step") != null && Number.isFinite(+q.get("step"))) setStep(+q.get("step") + 1); // ?step= is 0-based, like the views
    if (q.get("t") && tlDoc()) { const tm = tlMinOfClock(tlDoc(), q.get("t")); if (tm != null) { setMinute(tm); focusWhenReady(store.scenario, store.step); } }   // ?t=HH:MM (Centrum timeline / bell, AI Mateusza #1): Historia at that clock, zoomed on that event
    initRescuer({ store, api, map, maplibregl, toast, curStep, selectSeg: (id, from) => selectSeg(id, from), onTeam: setRescuerFrame });
    try { const a = await api("/story/assign"); store.manual = a.assignments || []; } catch (e) {}
    let role = q.get("role"); if (!role) { try { role = localStorage.getItem("rescue-app-role"); } catch (e) {} }
    if (role === "ratownik" || role === "operator") setRole(role); else { store.role = "operator"; $("rolePick").hidden = false; }
    window.__boot?.ui(store.role === "operator" && $("rolePick").hidden && Object.values(FRAMES).some((F) => F.visible()));   // no scene view to wait for: loader off now
    hint();
    pollAlerts();
    pollLive();
  } catch (e) { console.error(e); window.__boot?.done(); toast("Nie mogę połączyć się z serwerem akcji - sprawdź sieć i odśwież stronę.", 10000); }
}
boot();

// ---------- "+ Nowa akcja" (AI Michała): who, where, when -> POST /story/new -> Studio in Plan mode to add evidence
{
  const hhmm = (d) => d.toTimeString().slice(0, 5);
  const LABEL = { hiker: "turysta", dementia: "senior z demencją", child: "dziecko", gatherer: "grzybiarz", boater: "żeglarz / kajakarz", swimmer: "pływak" };
  let places = null;
  async function loadPlaces() {
    if (places) return places;
    const ids = (store.scenList || []).filter((s) => s.api).map((s) => s.id);
    places = (await Promise.all(ids.map(async (id) => {
      try { const sc = await (await fetch(`../scenarios/${id}.json`, { cache: "no-cache" })).json(); return sc.ipp && sc.ipp.at ? { id, name: sc.incident ? sc.incident.split(" - ").slice(1).join(" - ").replace(/\s*\(.*?\)\s*$/, "") || id : id, at: sc.ipp.at } : null; }
      catch (e) { return null; }
    }))).filter(Boolean);
    return places;
  }
  $("newActionBtn").onclick = async () => {
    if (!store.hasStudio) { toast("Nowa akcja wymaga serwera akcji: swift run rescue-server"); return; }
    const now = new Date();
    $("naReport").value = hhmm(now); $("naLast").value = hhmm(new Date(now - 2 * 3600e3));
    const ps = await loadPlaces();
    $("naWhere").innerHTML = ps.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
    $("newAction").showModal();
  };
  $("naCat").onclick = (ev) => { const b = ev.target.closest("button"); if (!b) return; $("naCat").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); };
  $("newAction").addEventListener("close", async () => {
    if ($("newAction").returnValue !== "ok") return;
    const cat = $("naCat").querySelector("button.on")?.dataset.v || "hiker";
    const ll = $("naLatLon").value.split(/[,\s;]+/).map(Number).filter((x) => !isNaN(x));
    const place = places.find((p) => p.id === $("naWhere").value);
    const ipp = ll.length === 2 ? ll : place ? place.at : null;
    if (!ipp) { toast("Podaj miejsce zaginięcia"); return; }
    const who = $("naWho").value.trim(), start = $("naReport").value || hhmm(new Date()), last = $("naLast").value;
    const where = ll.length === 2 ? `${ipp[0].toFixed(4)}, ${ipp[1].toFixed(4)}` : place.name;
    const incident = `Akcja: ${who || LABEL[cat]} - ${where}${last ? `, ostatni kontakt ${last}` : ""} (zgłoszenie ${start})`;
    teamOps = [];
    await run(() => api("/story/new", { template: !ll.length && place && place.id === "zawrat" ? "zawrat" : undefined, ipp, category: cat, startClock: start, incident }), "Nowa akcja: " + where);
    try { await loadScenario("studio"); } catch (e) {}
    setMode("edycja");
    $("naWho").value = ""; $("naLatLon").value = "";
  });
}

// ---------- "Udostępnij" (operator): join links + QR for this action. The key travels only in the link (?key=), the phone
// keeps it and drops it from the address bar. Without a key on this device the links are view-only.
{
  // the QR library (vendor/qrcode.min.js) is fetched the first time the dialog opens, not with every page load
  const qrLib = () => window.qrcode ? Promise.resolve() : (qrLib.p ||= new Promise((ok) => { const s = document.createElement("script"); s.src = "vendor/qrcode.min.js";
    s.onload = ok; s.onerror = () => { qrLib.p = null; ok(); }; document.head.appendChild(s); }));
  const qrSVG = (text) => { try { const q = qrcode(0, "M"); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) { return ""; } };
  const link = (role, withKey) => {
    const u = new URL("/app/", location.origin);
    if (role) u.searchParams.set("role", role);
    const sc = $("scen").value; if (sc && sc !== "studio") u.searchParams.set("sc", sc);
    if (withKey && PIN) u.searchParams.set("key", PIN);
    return u.toString();
  };
  const row = (title, sub, url) => `<div class="shr"><div class="shq">${qrSVG(url)}</div><div><b>${esc(title)}</b><div class="help">${esc(sub)}</div>
    <input readonly value="${esc(url)}" onfocus="this.select()"><button data-copy="${esc(url)}">Kopiuj link</button></div></div>`;
  $("shareBtn").onclick = async () => {
    // rescuers get the field key (reports and clues only), never the operator key; only an operator can fetch it
    const qrP = qrLib();
    let field = ""; if (PIN) { try { field = (await api("/api/join")).fieldKey || ""; } catch (e) {} }
    await qrP;
    const rescuer = (() => { const u = new URL(link("ratownik", false)); if (field) u.searchParams.set("key", field); return u.toString(); })();
    $("shareBody").innerHTML = (PIN && field ? "" : `<p class="help">Na tym urządzeniu nie ma klucza operatora, więc linki są tylko do podglądu. Wpisz klucz powyżej albo otwórz link operatora.</p>`)
      + row("Ratownik (telefon)", "Zeskanuj telefonem: rola ratownik, ta akcja. Klucz ratownika: tylko meldunki i ślady.", rescuer)
      + row("Operator (drugi komputer)", "Pełny dostęp: przydziały, Studio, Centrum, czyszczenie akcji. Nie pokazuj na rzutniku.", link("operator", !!field))
      + row("Podgląd (jury, bez zapisu)", "Widzi mapę i plan na żywo, nie może niczego zmienić.", link("", false));
    $("keySlot").append($("pinbox"));   // sens-funkcji #15: the key box sits in Udostępnij while it is open, back in the bar (rescuer 401, phone menu) on close
    $("shareDlg").showModal();
  };
  $("shareDlg").addEventListener("close", () => $("status").before($("pinbox")));
  $("shareBody").onclick = async (ev) => {
    const b = ev.target.closest("[data-copy]"); if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); toast("Skopiowano link"); } catch (e) { toast("Zaznacz link i skopiuj ręcznie"); }
  };
  $("shareReset").onclick = async () => {
    if (!confirm("Wyczyścić akcję na serwerze? Znikną meldunki, ślady, feed, przydziały i historia Studio (dla wszystkich urządzeń).")) return;
    try { await api("/api/reset", {}); toast("Akcja wyczyszczona"); $("shareDlg").close(); boot(); } catch (e) { toast(plErr(e), 5000); }
  };
}

// ---------- timeline mode (CONTRACT.md "Timeline mode" 6, AI Mateusza after AI Andrzeja): with run.timeline the dock scrubs MINUTES
// continuously (startMinute..endMinute, fractional minutes; event steps stay as ticks), and the views get {type:"time", minute, t,
// frameMinute, frame?} after every move (at most ~30 per second). The step in force (last step with minute <= the minute) still
// drives panels and the views' "step". Na żywo: held, the views get the live moment's minute. Without timeline nothing here runs.
// Frames: exact per-minute frames (GET <runUrl>&t=<minute>, cached on the server) are prefetched ahead of the playhead, so heat,
// coverage and FOV change every minute, not every frameMin; until a minute arrives the run's own frame in force stands in.
// `frame` is sent only when it changed for that view; `frameMinute` says which frame is in force (the view keeps the last one).
store.minute = null;
var tlBusy = false;
function tlDoc() { const T = D() && D().timeline; return T && Number.isFinite(T.startMinute) && Number.isFinite(T.endMinute) && T.endMinute > T.startMinute && D().steps ? T : null; }
function tlScrub() { return !liveOn() && store.mode !== "edycja" ? tlDoc() : null; }
function tlLo(T) { const s0 = D() && D().steps && D().steps[0]; return Math.min(T.startMinute, s0 && Number.isFinite(s0.minute) ? s0.minute : T.startMinute); }
function tlFrac(T, m) { const lo = tlLo(T); return Math.max(0, Math.min(1, (m - lo) / ((T.endMinute - lo) || 1))); }
function tlClock(T, m) {
  const [h, mm] = String(T.start || "00:00").split(":").map(Number), x = (((h * 60 + mm + Math.floor(m + 1e-6) - T.startMinute) % 1440) + 1440) % 1440;   // T.start = clock of startMinute
  return String(Math.floor(x / 60)).padStart(2, "0") + ":" + String(x % 60).padStart(2, "0");
}
// scenario minute of a clock "HH:MM" (live feed items)
function tlMinOfClock(T, c) {
  const [h, mm] = String(c || "").split(":").map(Number), [a, b] = String(T.start || "00:00").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  let x = h * 60 + mm - a * 60 - b; if (x < -720) x += 1440; if (x > 720) x -= 1440;
  return Math.max(tlLo(T), Math.min(T.endMinute, T.startMinute + x));
}
// frame in force at a minute (last frame with minute <= m), null before the first frame / for a frames=0 run
function tlFrame(T, m) { let f = null; for (const x of T.frames || []) { if (x.minute > m) break; f = x; } return f; }
const TLF = { key: "", byMin: new Map(), busy: new Set(), failed: 0, gen: 0 };
const TLP = { at: 0, h: 0, sent: {}, sentAt: {} };
const tlKey = () => (store.backend === "api" && store.runUrl && tlDoc() ? store.runUrl : "");
function tlReset() {
  TLF.key = tlKey(); TLF.byMin = new Map(); TLF.busy = new Set(); TLF.failed = 0; TLF.gen++; TLP.sent = {};
  const T = tlDoc(); if (T) for (const f of T.frames || []) TLF.byMin.set(f.minute, f);
  tlPump();
}
// the exact frame of the minute when we have it, else the run's frame in force
function tlFrameAt(T, m) { return (TLF.key && TLF.key === tlKey() && TLF.byMin.get(Math.floor(m + 1e-6))) || tlFrame(T, m); }
function tlNext() {
  const T = tlScrub(); if (!T || !TLF.key || TLF.key !== tlKey() || TLF.failed > 5) return null;
  const lo = Math.ceil(tlLo(T)), hi = Math.floor(T.endMinute), c = Math.floor((store.minute == null ? lo : store.minute) + 1e-6);
  const want = (m) => m >= lo && m <= hi && !TLF.byMin.has(m) && !TLF.busy.has(m);
  for (let d = 0; d <= 20; d++) if (want(c + d)) return c + d;   // ahead of the playhead first
  for (let d = 1; d <= 5; d++) if (want(c - d)) return c - d;
  return null;   // only a window around the playhead (-5..+20 min); it moves with setMinute, the run's own frames cover the rest (wydajnosc.md Runda 3: ~150 requests / 2.9 MB per opening before)
}
function tlPump() {
  const FV = Object.values(FRAMES).filter((F) => F.visible()); if (!(FV.length ? FV : Object.values(FRAMES)).some((F) => F.ready)) return;   // after the shown view's ready (not a hidden one's); minute frames (&t=) only after a view is ready: at boot the run and the map get the bandwidth
  while (TLF.busy.size < 3) {
    const m = tlNext(); if (m == null) return;
    const gen = TLF.gen, u = TLF.key; TLF.busy.add(m);
    api(u + (u.includes("?") ? "&" : "?") + "t=" + m).then((f) => {
      if (gen !== TLF.gen) return;
      TLF.busy.delete(m);
      if (f && f.schema === "rescue-frame/1" && Array.isArray(f.poaGrid) && f.minute === m) {
        TLF.byMin.set(m, f);
        if (store.minute != null && Math.floor(store.minute + 1e-6) === m) { tlPostTime(undefined, true); renderPanels(); }   // the exact frame of the shown minute just arrived
      } else TLF.failed++;
      tlPump();
    }).catch(() => { if (gen === TLF.gen) { TLF.busy.delete(m); TLF.failed++; tlPump(); } });
  }
}
// "Gdzie szukać najpierw" from the frame: frame.segments (poa desc, coverage folded in) + areaPct from the step's segment list
function tlSegments(S) {
  const T = tlDoc(), f = T && store.minute != null && !liveOn() ? tlFrameAt(T, store.minute) : null;
  if (!f || !Array.isArray(f.segments) || !f.segments.length) return S.segments;
  const by = new Map(S.segments.map((g) => [g.id, g]));
  return f.segments.map((g) => ({ ...(by.get(g.id) || { areaPct: 0 }), id: g.id, name: g.name, poa: g.poa, cumPod: g.cumPod }));
}
// a new frame goes to a view at most every 180 ms while playing fast (heat rebuilds are not free); the minute always goes
function tlPostOne(k, T, m, frame) {
  const msg = { type: "time", minute: m, t: tlClock(T, m), live: liveOn(), ...(TLP.scrub ? { scrub: true } : {}) }, now = performance.now(), last = TLP.sent[k];
  if (frame && last && frame !== last && playing && now - (TLP.sentAt[k] || 0) < 180 && last.minute <= m) frame = last;
  if (frame) { msg.frameMinute = frame.minute; if (last !== frame) { msg.frame = frame; TLP.sent[k] = frame; TLP.sentAt[k] = now; } }
  // the panel's top 3 (tlSegments: the minute's frame in Historia, the step on Na żywo) - the views label the same sectors #1-#3
  const S = curStep(); if (S) msg.top = evOff.size && store.evTop ? store.evTop.slice(0, 3) : tlSegments(S).slice(0, 3).map((g) => g.id);   // = the panel (a signal off: the 2D's recomputed top 3)
  postTo(k, msg);
}
// throttled to ~30 messages per second (the last one always goes out); force = now
function tlPostTime(from, force) {
  clearTimeout(TLP.h);
  const now = performance.now();
  if (!force && now - TLP.at < 33) { TLP.h = setTimeout(() => tlPostTime(from, true), 34 - (now - TLP.at)); return; }
  TLP.at = now;
  const T = tlDoc(); if (!T || store.minute == null) return;
  const frame = tlFrameAt(T, store.minute);
  for (const k in FRAMES) if (k !== from && FRAMES[k].ready && FRAMES[k].visible()) tlPostOne(k, T, store.minute, frame);   // a hidden view catches up when shown (syncFrame)
}
// the range becomes a minute axis (or back to steps for a run without timeline)
function tlSlider() {
  const T = tlScrub(), sl = $("slider");
  if (T) { sl.min = tlLo(T); sl.max = T.endMinute; sl.step = "any"; sl.value = store.minute != null ? store.minute : tlLo(T); }
  else { sl.min = 1; sl.step = 1; if (D() && D().steps) { sl.max = D().steps.length; sl.value = store.step; } }
}
// light dock update while the playhead moves inside one step (the full renderDock rebuilds markers and ticker)
function tlDockLive() {
  const T = tlScrub(), R = D(), S = curStep(); if (!T || !R || !S) return;
  $("tlFill").style.width = `calc((100% - 16px) * ${tlFrac(T, store.minute).toFixed(4)})`;
  $("dkStep").innerHTML = `<b>${esc(tlClock(T, store.minute))}</b> · ${store.step}/${R.steps.length}`;
}
function setMinute(m, from) {
  const T = tlDoc(); if (!T || !Number.isFinite(m)) return;
  m = Math.max(tlLo(T), Math.min(T.endMinute, Math.round(m * 100) / 100));
  if (store.minute != null && Math.abs(m - store.minute) < 0.005) return;
  const prev = store.minute == null ? null : Math.floor(store.minute + 1e-6);
  store.minute = m;
  const R = D(); let k = 1; R.steps.forEach((s, i) => { if (s.minute <= m + 1e-6) k = i + 1; });
  if (k !== store.step) { tlBusy = true; try { setStep(k, from); } finally { tlBusy = false; } }
  else if (Math.floor(m + 1e-6) !== prev) renderPanels();   // the ranking follows the minute's frame even inside one step
  tlPostTime(from); tlSlider(); tlDockLive(); tlPump();
}
// an event jump (ticker, cards, ◀, a view's own step) moves the minute to that step; in live the minute follows the held step
function tlFromStep(from) {
  const T = tlDoc(), S = curStep(); if (tlBusy || !T || !S) return;
  const m = Math.max(tlLo(T), Math.min(T.endMinute, S.minute));
  if (m === store.minute) return;
  store.minute = m; tlPostTime(from, true); tlSlider(); renderDock(); renderPanels(); tlPump();
}
// the event's card in the dock (marker tooltip "HH:MM · title") for a moment
function tlCard(k) { tlTip(groupOf(evGroups(D()), k) + 1); clearTimeout(tlTip.h); tlTip.h = setTimeout(() => tlTip(0), 2600); }
// one entry for every "go to this event" click (dock marker, ticker, Sygnały card, Na żywo feed). Historia: land on the event's exact
// minute (its exact frame is fetched first in line if it is not cached yet). Na żywo cannot rewind: switch to Historia at that minute;
// the dock then offers "Wróć na żywo" (back to the live moment).
async function goEvent(k, minute) {
  stopPlay();
  const R0 = D(), s0 = k && R0 && R0.steps[k - 1];
  if (minute == null && s0 && Number.isFinite(s0.minute)) minute = s0.minute;
  if (liveOn()) {
    if (store.backend !== "api") return;
    toast("Przełączam na Historię…", 8000);
    await setTime("hist", true);
    if (liveOn()) return;
    const R = D(), kk = s0 ? R.steps.findIndex((x) => x.label === s0.label) + 1 : 0;
    if (tlScrub() && minute != null) setMinute(minute);
    if (kk && kk !== store.step && (!tlScrub() || R.steps[kk - 1].minute === store.minute)) setStep(kk);
    tlCard(store.step); focusEvent(store.step);
    toast(`Historia o ${tlDoc() ? tlClock(tlDoc(), store.minute) : (curStep() || {}).t || ""} - na żywo nie da się cofnąć. „Wróć na żywo” w pasku na dole.`, 4000);
    return;
  }
  if (tlScrub() && minute != null) { setMinute(minute); if (k && k !== store.step && D().steps[k - 1] && D().steps[k - 1].minute === store.minute) setStep(k); }
  else if (k) setStep(k);
  tlCard(store.step); focusEvent(k || store.step);
}
// an event click zooms 2D onto the area its group changed (dock.js focusTarget: searched sectors, clue point + radius, dispatch
// sector + team, the find; weather and the start setup do not move the map). Straight to the 2D frame like "highlight" (its ready
// flag drops while a run reloads, the view queues); 3D gets the same message (its handler: AI Andrzeja). Kino does not use this.
function focusEvent(k) {
  const R = D(); if (!R || !R.steps || !k) return;
  const G = evGroups(R), g = G[groupOf(G, k)], t = focusUnion((g ? g.ks : [k]).map((kk) => focusTarget(null, R, kk)));
  if (!t) return;
  const d = $("alDrawer"), padRight = d && d.getAttribute("aria-hidden") !== "true" ? Math.max(0, Math.round(innerWidth - d.getBoundingClientRect().left) - insets()[1]) : 0;
  const msg = { type: "focusArea", bbox: t.bbox, kind: t.kind, segIds: t.segIds, padRight };
  try { const f = $("frame2d"); if (f && f.contentWindow) f.contentWindow.postMessage({ source: "rescue-app", ...msg }, location.origin); } catch (e) {}
  postTo("3d", msg);
}
// event groups for Kino and tests (same rule as the dock): [{minute, first, steps: [step index], events: [{i, t, minute, label, kind, hintId}]}]
window.rescueApp.eventGroups = () => evGroups(D()).map((g) => ({ minute: g.minute, first: g.first, steps: g.ks.map((k) => k - 1),
  events: g.ks.map((k) => { const s = D().steps[k - 1]; return { i: k - 1, t: s.t, minute: s.minute, label: s.label, kind: s.kind, hintId: s.hintId }; }) }));
// a new run (scenario switch, live refetch, Historia/Na żywo): start at the current step's minute, or reset without timeline
subs.push((why) => {
  if (why !== "load" && why !== "run" && why !== "edit" && why !== "mode") return;
  const T = tlDoc(), S = curStep();
  if (TLF.key !== tlKey() || why === "edit") tlReset();
  if (!T) { store.minute = null; tlSlider(); return; }
  if (why === "load" || store.minute == null || liveOn() || store.minute < tlLo(T) || store.minute > T.endMinute) store.minute = Math.max(tlLo(T), Math.min(T.endMinute, S ? S.minute : tlLo(T)));
  tlSlider(); tlPostTime(undefined, true); renderDock(); renderPanels();
});
// ---------- clue weights (wagi śladów, CONTRACT.md "Clue weights"): one block, decorates the Sygnały cards (#events) and the
// "Na żywo" feed (#liveFeed) after they render - a small bar + number per clue, hover = "dlaczego ta waga", operator stepper
// (−/+ 0,1) and "auto" (POST /api/clue/weight). Data: run.clueWeights (live moment) and steps[k].clueWeights (per step, Historia).
(() => {
  const pl = (x) => (+x).toFixed(2).replace(".", ",");
  const list = () => (D() && D().clueWeights) || [];
  const byHint = (id) => list().find((c) => c.hintId === id);
  // weight at the current step in Historia (decay over time); Na żywo = the live moment
  const wAt = (c) => { const m = !liveOn() && curStep() && curStep().clueWeights; return m && m[c.hintId] != null ? m[c.hintId] : c.weight; };
  const canEdit = () => liveNow() && store.role !== "ratownik";
  function tip(c) {
    return [`Waga ${pl(wAt(c))} - ${c.typeLabel}, ${c.sourceLabel}`, ...(c.why || []),
      `= ${pl(c.factors.reliability)} × ${pl(c.factors.accuracy)} × ${pl(c.factors.recency)} × ${pl(c.factors.corroboration)}${c.override != null ? " → ręcznie " + pl(c.override) : ""}`].join("\n");
  }
  function chip(c) {
    const w = wAt(c), ed = canEdit() && c.id;
    return `<div class="cw${c.applied ? "" : " info"}${c.override != null ? " man" : ""}" data-cw="${esc(c.id)}" title="${esc(tip(c))}">`
      + `<span class="cwl">waga</span><i class="cwb"><i style="width:${Math.round(w * 100)}%"></i></i><b>${pl(w)}</b>`
      + (c.override != null ? `<span class="cwm">ręcznie</span>` : c.applied ? "" : `<span class="cwm">info</span>`)
      + (ed ? `<button type="button" data-d="-0.1" title="Mniejsza waga (operator)">−</button><button type="button" data-d="0.1" title="Większa waga (operator)">+</button>`
        + (c.override != null ? `<button type="button" data-auto="1" title="Wróć do wagi wyliczonej">auto</button>` : "") : "") + `</div>`;
  }
  async function setW(c, w) {
    try {
      await api("/api/clue/weight", { sc: store.scenario, clueId: c.id, weight: w, by: "operator", title: c.typeLabel });
      toast(w == null ? "Waga śladu: auto - przeliczam mapę" : `Waga śladu ${pl(w)} - przeliczam mapę`); pollLive();
    } catch (e) { toast("Nie zmieniono wagi. " + plErr(e), 4000); }
  }
  function wire(root) {
    root.querySelectorAll(".cw").forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const b = e.target.closest("button"), c = list().find((x) => x.id === el.dataset.cw); if (!b || !c || !canEdit()) return;
        if (b.dataset.auto) return setW(c, null);
        setW(c, Math.max(0, Math.min(1, Math.round((wAt(c) + +b.dataset.d) * 10) / 10)));
      };
    });
  }
  function decorate() {
    const R = D(); if (!R || !R.steps || !list().length) return;
    const ev = $("events");
    if (ev) {
      for (const card of ev.querySelectorAll(".ev[data-step]")) {
        if (card.querySelector(".cw")) continue;
        const s = R.steps[+card.dataset.step - 1], c = s && byHint(s.hintId); if (!c) continue;
        card.insertAdjacentHTML("beforeend", chip(c));
      }
      wire(ev);
    }
    const fe = $("liveFeed");
    if (fe) {
      const evs = live.events.slice(-8).reverse();
      [...fe.querySelectorAll(".lfi")].forEach((row, k) => {
        const e = evs[k]; if (!e) return;
        const m = row.querySelector(".mute"); if (e.kind === "weight" && m) m.textContent = "waga";
        if (row.querySelector(".cw") || (e.kind !== "clue" && e.kind !== "report")) return;
        const c = e.kind === "clue" && e.lat != null ? list().find((x) => x.live && x.lat != null && Math.abs(x.lat - e.lat) < 1e-5 && Math.abs(x.lon - e.lon) < 1e-5)
          : list().find((x) => x.live && x.lat != null && String(e.note || "").includes(x.lat.toFixed(4)));
        if (c) row.insertAdjacentHTML("beforeend", chip(c));
      });
      wire(fe);
    }
  }
  const mo = new MutationObserver(() => decorate());
  for (const id of ["events", "liveFeed"]) if ($(id)) mo.observe($(id), { childList: true });
  decorate();
})();
// ---------- Zasoby i dziennik (CONTRACT.md "Zasoby i dziennik" 6): actor drawer from the Na żywo feed and the 2D / 3D views ({type:"actor", id}), Zasoby link
{
  const zl = $("zasobyLink");
  const upd = () => { if (zl) zl.href = "zasoby.html?sc=" + encodeURIComponent(store.scenario || ""); };
  subs.push(upd); upd();
  const atNow = () => { const T = tlDoc(); return T && store.minute != null ? tlClock(T, store.minute) : curClock(); };   // timeline minute when scrubbing
  // straight to the 2D frame (not postTo: its ready flag drops while a run reloads; the view queues messages until it is ready)
  // padRight: how far the open actor drawer reaches past the map's own right inset, so fitBounds keeps the track out from under it
  const padRight = () => { const d = $("alDrawer"); if (!d || d.getAttribute("aria-hidden") === "true") return 0; return Math.max(0, Math.round(innerWidth - d.getBoundingClientRect().left) - insets()[1]); };
  const highlight = (a) => { const f = $("frame2d"); try { f && f.contentWindow && f.contentWindow.postMessage({ source: "rescue-app", type: "highlight", actor: a, sc: store.scenario, at: atNow(), padRight: padRight() }, location.origin); } catch (e) {} };
  // "Ślad na mapie": back to Akcja if needed, 2D fits the track; in 3D the view selects the team ({type:"highlight", actor, fly})
  const focusTrack = (a) => { if (store.mode !== "akcja") setMode("akcja"); if (store.view === "3d" || store.view === "split") postTo("3d", { type: "highlight", actor: a, fly: true }); highlight(a); };
  const showActor = (id) => import("./actorlog.js").then((m) => m.openActor(id, { sc: store.backend === "api" ? store.scenario : undefined, at: liveOn() ? undefined : atNow(),
    onTrack: focusTrack, onClose: () => { highlight(null); pushInsets(); } })).then(() => pushInsets());
  $("liveFeed") && $("liveFeed").addEventListener("click", (e) => { const b = e.target.closest("[data-actor]"); if (b) { showActor(b.dataset.actor); highlight(b.dataset.actor); } });
  addEventListener("message", (e) => { if (e.origin === location.origin && e.data && (e.data.source === "rescue2d" || e.data.source === "rescue3d") && e.data.type === "actor" && typeof e.data.id === "string") showActor(e.data.id); });
  const qa = new URLSearchParams(location.search).get("actor");
  // ?actor=<id> (link from Zasoby / Centrum): wait for the 2D view, open the drawer, then fit the track beside it
  if (qa) { const t0 = Date.now(), go = () => { if (!FRAMES["2da"].ready && Date.now() - t0 < 20000) return setTimeout(go, 300); showActor(qa).then(() => focusTrack(qa)); }; setTimeout(go, 300); }
  // "Zasoby akcji" under the top 3 (Akcja): every unit of the incident, status, one health chip, GPS feed dot (GET /api/inventory?sc=&at=)
  const AK = { pieszy: "PP", pies: "K9", dron: "DR", smiglowiec: "SM", lodz: "ŁD", nurkowie: "NU" };
  const chip = (u) => {
    const h = u.health || {}, lv = (codes) => { const w = (u.warnings || []).filter((x) => codes.includes(x.code)); return w.some((x) => x.level === "red") ? "red" : w.length ? "amber" : ""; };
    if (h.fault) return ["usterka", "red", "Usterka: " + h.fault];
    if (h.batteryPct != null) return ["bateria " + h.batteryPct + "%", lv(["battery", "spares"]), `Bateria ${h.batteryPct}% (~${h.flightMinLeft} min lotu, szacunek)`];
    if (h.fuelPct != null) return ["paliwo " + h.fuelPct + "%", lv(["fuel", "duty"]), `Paliwo ${h.fuelPct}% (~${h.enduranceMinLeft} min, szacunek)`];
    if (h.workMin != null) return [`${h.workMin}/${h.workLimitMin} min`, lv(["dogwork", "duty"]), `Pies pracuje ${h.workMin} min bez przerwy (limit ${h.workLimitMin})`];
    if (h.fatiguePct != null) return ["zmęczenie " + h.fatiguePct + "%", lv(["fatigue", "duty"]), `Zmęczenie ${h.fatiguePct}% (szacunek z trasy i czasu służby)`];
    return ["-", u.level === "ok" ? "" : u.level, "brak danych o stanie"];
  };
  let assetsKey = "", assetsAt = 0, assetsBusy = false;
  async function loadAssets(force) {
    const box = $("assetList"); if (!box || store.mode !== "akcja" || store.role === "ratownik" || !$("assets").open) return;
    if (store.backend !== "api") { box.innerHTML = `<div class="help">Zasoby akcji są dla akcji z serwera (nie dla historii ze Studia).</div>`; return; }
    const at = liveOn() ? "" : atNow(), key = store.scenario + "|" + at;
    if (assetsBusy || (!force && key === assetsKey && Date.now() - assetsAt < 20000)) return;
    assetsBusy = true;
    try {
      const d = await api(`/api/inventory?sc=${encodeURIComponent(store.scenario)}${at ? "&at=" + encodeURIComponent(at) : ""}`);
      assetsKey = key; assetsAt = Date.now();
      const st = curStep(), asg = (st && st.assignments) || [];
      const units = (d.units || []).filter((u) => u.atSc === store.scenario);
      box.innerHTML = units.map((u) => {
        const [v, lv, tip] = chip(u), gps = (u.feeds || []).find((f) => f.kind === "gps" || f.kind === "collar") || { status: "off" };
        const plan = !u.sc && (u.home || []).includes(store.scenario), seg = u.segmentId || (asg.find((a) => a.resourceId === u.id) || {}).segmentId;
        const status = (plan ? "w planie" : u.status) + (seg ? " " + seg : "");
        return `<div class="arow" data-id="${esc(u.id)}" tabindex="0" title="${esc(u.name)} - kliknij: dziennik, źródła danych i ślad na mapie${esc((u.warnings || []).map((w) => "\n" + w.text).join(""))}">`
          + `<span class="ak">${esc(AK[u.kind] || "?")}</span><span class="an">${esc(u.name)}</span><span class="as">${esc(status)}</span>`
          + `<span class="ah ${lv}" title="${esc(tip)}">${esc(v)}</span><span class="ad ${esc(gps.status)}" title="GPS: ${gps.status === "live" ? "na żywo" : gps.status === "stale" ? "nieaktualny" : "brak"}${gps.lastAt ? ", " + esc(gps.lastAt) : ""}"></span></div>`;
      }).join("") || `<div class="help">Brak zespołów przy tej akcji.</div>`;
      const red = units.filter((u) => u.level === "red").length, amber = units.filter((u) => u.level === "amber").length;
      $("assetsSum").innerHTML = `${units.length}${red ? ` · <b style="color:var(--rl-danger)">${red} alarm</b>` : ""}${amber ? ` · ${amber} uwaga` : ""} · ${esc(d.at || "")}`;
      box.querySelectorAll(".arow").forEach((r) => {
        const go = () => { showActor(r.dataset.id); highlight(r.dataset.id); };
        r.onclick = go; r.onkeydown = (e) => { if (e.key === "Enter") go(); };
      });
    } catch (e) { box.innerHTML = `<div class="help">Zasoby niedostępne: ${esc(plErr(e))}</div>`; }
    finally { assetsBusy = false; }
  }
  $("assets") && $("assets").addEventListener("toggle", () => loadAssets(true));
  subs.push((why) => { if (why === "load" || why === "run" || why === "mode" || why === "step") setTimeout(() => loadAssets(why !== "step"), 300); });
  setInterval(() => { if (!document.hidden) loadAssets(false); }, 4000);   // scrubbed minute changed, or 20 s old -> refetch
  setTimeout(() => loadAssets(true), 1500);
}
