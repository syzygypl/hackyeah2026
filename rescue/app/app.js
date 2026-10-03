// Rescue Locator - one app: Story Studio editing on the 2D map + the 3D view (iframe, postMessage contract in CONTRACT.md)
// + shared panels. Backends: unified rescue-server (/api/*) when it answers, else rescue-studio (/story*, /modules),
// else static run files from out/. Offline: MapLibre + basemap from ../web/, no CDN.
import * as maplibregl from "../web/vendor/maplibre-gl.mjs";
import { offlineStyle, loadBasemap, ZAWRAT_BOUNDS } from "../web/basemap/basemap.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (p) => Math.round((p || 0) * 100) + "%";
const LOOPBACK = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(location.hostname);
let PIN = ""; try { PIN = localStorage.getItem("rescue-pin") || ""; } catch (e) {}
if (!LOOPBACK) { $("pinbox").style.display = ""; $("pin").value = PIN; $("pin").onchange = () => { PIN = $("pin").value.trim(); try { localStorage.setItem("rescue-pin", PIN); } catch (e) {} boot(); }; }
async function api(path, body) {
  const h = { "Content-Type": "application/json" }; if (!LOOPBACK && PIN) h["X-Rescue-Pin"] = PIN;
  const r = await fetch(path, body === undefined ? { headers: h, cache: "no-store" } : { method: "POST", headers: h, body: JSON.stringify(body) });
  if (r.status === 401) throw new Error("podaj PIN serwera (z terminala)");
  if (!r.ok) throw new Error("HTTP " + r.status + " " + path);
  return r.json();
}
const tryJSON = async (path) => { try { return await api(path); } catch (e) { return null; } };
function toast(t, ms = 2600) { const el = $("toast"); el.textContent = t; el.style.display = "block"; clearTimeout(toast.h); toast.h = setTimeout(() => el.style.display = "none", ms); }

// ---------- shared state store
// store.run = rescue-run/1 document (+ story/hints from the Studio); store.step is 1-based like the Studio slider
const store = { backend: "static", hasApi: false, hasStudio: false, scenario: "studio", editable: false, run: null, step: 1, selSeg: null, selEv: null, view: "2d", mods: [] };
const subs = [];
function set(patch, why) { Object.assign(store, patch); for (const f of subs) f(why || Object.keys(patch).join(",")); }
const D = () => store.run;
const curStep = () => (store.run && store.run.steps ? store.run.steps[store.step - 1] : null);
window.rescueStore = store;   // debugging / tests

// ---------- backends
const STATIC = { zawrat: { name: "Zawrat (demo, odczyt)", run: "../out/run.json" } };
async function detect() {
  const a = await tryJSON("/api/scenarios");
  const m = await tryJSON("/modules");
  store.hasApi = !!a; store.hasStudio = !!(m && m.modules); store.mods = m ? m.modules : [];
  let list = [];
  if (store.hasStudio) list.push({ id: "studio", name: "Studio (edycja na żywo)" });
  if (a) for (const s of (Array.isArray(a) ? a : a.scenarios || [])) { const id = typeof s === "string" ? s : s.id || s.name; if (id && !/blind/i.test(id)) list.push({ id, name: (s.name || id) + " (serwer)", api: true }); }
  for (const [id, s] of Object.entries(STATIC)) if (!list.some((x) => x.id === id)) list.push({ id, name: s.name, static: true });
  $("scen").innerHTML = list.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
  store.scenList = list;
}
async function loadScenario(id) {
  const s = store.scenList.find((x) => x.id === id) || store.scenList[0];
  teamOps = []; closePop();
  let run, backend;
  if (s.id === "studio") { run = await api("/story"); backend = "studio"; }
  else if (s.api) { run = await api("/api/run/" + encodeURIComponent(s.id)); backend = "api"; }
  else { run = await (await fetch(STATIC[s.id].run, { cache: "no-store" })).json(); backend = "static"; }
  applyRun(run, { scenario: s.id, backend, editable: backend === "studio" }, "load");
}
function applyRun(run, extra = {}, why = "run") {
  if (run && run.error && !run.steps) { toast("Błąd: " + run.error); return; }
  const fit = !store.run || JSON.stringify(store.run.bbox) !== JSON.stringify(run.bbox);
  set({ ...extra, run, step: run.steps ? run.steps.length : 1 }, why);
  if (fit && run.bbox && mapReady) map.fitBounds([[run.bbox.west, run.bbox.south], [run.bbox.east, run.bbox.north]], { padding: 20, duration: 0 });
  fetchAssessment();
}
// every edit goes through here: re-run on the server, refresh 2D, panels and 3D
async function run(fn, msg) {
  try {
    $("status").textContent = "liczę...";
    const d = await fn();
    if (d.error && !d.steps) { toast("Błąd: " + d.error); $("status").textContent = ""; return d; }
    applyRun(d, {}, "edit");
    if (msg) toast(msg);
    return d;
  } catch (e) { toast(String(e.message || e), 4000); $("status").textContent = ""; }
}
let assessment = null;
async function fetchAssessment() {
  assessment = null;
  if (store.hasApi) {
    const q = `?scenario=${encodeURIComponent(store.scenario)}&step=${store.step - 1}`;
    assessment = await tryJSON("/api/assessment" + q);
  }
  renderAssess();
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
  map.addLayer({ id: "heat", type: "raster", source: "heat", paint: { "raster-opacity": 0.78, "raster-resampling": "linear", "raster-fade-duration": 0 } });
  map.addSource("segs", { type: "geojson", data: FC([]) });
  map.addLayer({ id: "seg-fill", type: "fill", source: "segs", paint: { "fill-color": "#ffd84d", "fill-opacity": ["case", ["get", "sel"], 0.12, 0] } });
  map.addLayer({ id: "seg-line", type: "line", source: "segs", paint: { "line-color": ["case", ["get", "sel"], "#ffd84d", ["get", "top"], "#ffffff", "rgba(255,255,255,.35)"], "line-width": ["case", ["get", "sel"], 3.5, ["get", "top"], 2.5, 1] } });
  map.addLayer({ id: "seg-lbl", type: "symbol", source: "segs", filter: ["get", "show"], layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Medium"], "text-size": 12, "text-allow-overlap": true },
    paint: { "text-color": "#fff", "text-halo-color": "#000", "text-halo-width": 1.6 } });
  map.addSource("ev", { type: "geojson", data: FC([]) });
  map.addLayer({ id: "ev-fill", type: "fill", source: "ev", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": ["get", "color"], "fill-opacity": 0.08 } });
  map.addLayer({ id: "ev-line", type: "line", source: "ev", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": ["get", "color"], "line-width": ["coalesce", ["get", "w"], 2], "line-dasharray": [2, 1.5] } });
  mapReady = true;
  if (store.run && store.run.bbox) map.fitBounds([[store.run.bbox.west, store.run.bbox.south], [store.run.bbox.east, store.run.bbox.north]], { padding: 20, duration: 0 });
  renderMap();
}
// style.load fires without a paint (hidden tabs); "load" waits for the first frame
map.on("style.load", setupLayers); map.on("load", setupLayers); if (map.isStyleLoaded()) setupLayers();
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
  const b = R.bbox, cv = document.createElement("canvas"); cv.width = R.cols; cv.height = R.rows;
  const cx = cv.getContext("2d"), im = cx.createImageData(R.cols, R.rows);
  let mx = 0; for (const p of S.poaGrid) mx = Math.max(mx, p);
  S.poaGrid.forEach((p, i) => { const t = Math.sqrt(p / (mx || 1)); im.data.set([255, Math.round(230 * (1 - Math.min(1, t * 1.2)) + 25), Math.round(60 * (1 - t)), Math.round(Math.min(1, t * 1.6) * 225)], i * 4); });
  cx.putImageData(im, 0, 0);
  map.getSource("heat").updateImage({ url: cv.toDataURL(), coordinates: [[b.west, b.north], [b.east, b.north], [b.east, b.south], [b.west, b.south]] });
  const top = S.segments.slice(0, 3).map((s) => s.id), searched = searchedUpTo();
  map.getSource("segs").setData(FC(S.segments.filter((s) => s.polygon && s.polygon.length).map((s) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [s.polygon] },
    properties: { top: top.includes(s.id), sel: s.id === store.selSeg, show: top.includes(s.id) || searched[s.id] !== undefined || s.id === store.selSeg,
      label: top.includes(s.id) ? `#${top.indexOf(s.id) + 1} ${s.id} ${pct(s.poa)}` : searched[s.id] !== undefined ? `${s.id} pusty, POD ${pct(searched[s.id])}` : `${s.id} ${pct(s.poa)}` } }))));
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

// ---------- selection (shared by 2D, panels and 3D)
function selectSeg(id, from) {
  set({ selSeg: store.selSeg === id && from !== "3d" ? null : id }, "select");
  if (from !== "3d") post3d({ type: "select", segmentId: store.selSeg });
}
function setStep(n, from) {
  const R = D(); if (!R || !R.steps) return;
  n = Math.max(1, Math.min(R.steps.length, n));
  if (n === store.step) return;
  set({ step: n }, "step");
  if (from !== "3d") post3d({ type: "step", i: n - 1 });
  clearTimeout(setStep.h); setStep.h = setTimeout(fetchAssessment, 300);
}

// ---------- panels
function renderPanels() {
  const R = D(), S = curStep(); if (!R || !S) return;
  const t3 = S.segments.slice(0, 3), tp = t3.reduce((a, s) => a + s.poa, 0), ta = t3.reduce((a, s) => a + s.areaPct, 0);
  $("vbig").textContent = `${pct(tp)} prawdopodobieństwa w ${Math.round(ta)}% obszaru`;
  $("vsub").textContent = `Top 3 z ${S.segments.length} segmentów · krok ${store.step}/${R.steps.length} (${S.t})`;
  const segRows = [...t3]; const sel = S.segments.find((s) => s.id === store.selSeg); if (sel && !t3.includes(sel)) segRows.push(sel);
  $("segs").innerHTML = segRows.map((s) => { const k = S.segments.indexOf(s);
    return `<div class="box seg ${s.id === store.selSeg ? "sel" : ""}" data-seg="${esc(s.id)}"><span class="rank">${k + 1}</span><b>${esc(s.id)} ${esc(s.name)}</b><div class="p">${pct(s.poa)} <span class="mute" style="font-size:13px">w ${(+s.areaPct).toFixed(1)}% obszaru</span></div></div>`; }).join("");
  const W = S.weather || {}; $("surv").textContent = W.survival ? "Hipotermia: " + W.survival.text : "";
  const by = {}; (S.assignments || []).forEach((a) => by[a.resourceId] = a);
  $("teams").innerHTML = (S.resources || []).map((r) => { const a = by[r.id];
    return `<div class="box team ${r.available ? "" : "off"}"><div class="row" style="justify-content:space-between"><b>${esc(r.name)}</b><span class="pill ${r.available ? "" : "off"}">${r.available ? (a ? "przydział" : "wolny") : "niedostępny"}</span></div>
      ${r.available ? "" : `<div class="help">${esc(r.reason)}</div>`}
      ${a ? `<div>-> <b class="seglink" data-seg="${esc(a.segmentId)}" style="cursor:pointer">${esc(a.segmentId)} ${esc(a.segmentName)}</b>, ETA ${Math.round(a.travelMin)} min, szansa ${pct(a.expectedFind)}</div>${(a.safety || []).map((f) => `<div class="flag">! ${esc(f)}</div>`).join("")}
      <details><summary>dlaczego</summary>${esc(a.reason || `POA ${pct(a.poa)}, POD ${pct(a.pod)}, dojście ${Math.round(a.travelMin)} min, przeszukanie ${Math.round(a.sweepMin || 0)} min`)}</details>` : ""}</div>`; }).join("") || `<div class="help">Brak zespołów w scenariuszu.</div>`;
  renderProgress(); renderEvents();
  $("clock").textContent = S.t + " · " + S.label;
  $("slider").max = R.steps.length; $("slider").value = store.step;
  $("status").textContent = `${R.incident || ""}${store.backend !== "studio" ? " · tylko odczyt" : ""}`;
  document.body.classList.toggle("readonly", !store.editable);
  $("readonly").style.display = store.editable ? "none" : "";
}
function renderProgress() {
  const R = D(), S = curStep(); if (!S) return;
  const searched = searchedUpTo(), ids = Object.keys(searched);
  const found = R.steps.slice(0, store.step).some((s) => /ZNALEZIONO/i.test(s.label || "") || s.source === "Found");
  const covered = ids.reduce((a, id) => a + (S.segments.find((s) => s.id === id)?.areaPct || 0), 0);
  const assigned = (S.assignments || []).length, avail = (S.resources || []).filter((r) => r.available).length;
  const v = R.value || {};
  $("progress").innerHTML = `${found ? `<div class="big" style="color:var(--ok)">ZNALEZIONO</div>` : ""}
    <div class="kv"><span>Przeszukane segmenty</span><b>${ids.length} z ${S.segments.length}</b></div>
    <div class="bar"><i style="width:${Math.min(100, covered).toFixed(0)}%"></i></div>
    <div class="kv"><span>Obszar przeszukany</span><b>${covered.toFixed(1)}%</b></div>
    <div class="kv"><span>Zespoły w akcji / dostępne</span><b>${assigned} / ${avail}</b></div>
    ${ids.length ? `<div class="help">${ids.map((id) => `${esc(id)} (POD ${pct(searched[id])})`).join(", ")}</div>` : ""}
    ${v.planned && v.naive ? `<div class="kv"><span>Plan vs naiwnie</span><b>${esc(v.planned.findMin ?? "?")} / ${esc(v.naive.findMin ?? "?")} min</b></div>` : ""}`;
}
function renderAssess() {
  const R = D(), S = curStep(); if (!S) { $("assess").innerHTML = ""; return; }
  if (assessment) {
    const a = assessment, txt = a.text || a.summary || a.assessment;
    const rows = Object.entries(a).filter(([k, v]) => !["text", "summary", "assessment"].includes(k) && (typeof v !== "object" || v === null)).slice(0, 8);
    const lists = Object.entries(a).filter(([, v]) => Array.isArray(v) && v.every((x) => typeof x === "string")).slice(0, 3);
    $("assess").innerHTML = `${txt ? `<div>${esc(txt)}</div>` : ""}${rows.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}
      ${lists.map(([k, v]) => `<div class="help"><b>${esc(k)}:</b> ${v.map(esc).join("; ")}</div>`).join("")}<div class="help">źródło: /api/assessment</div>`;
    return;
  }
  // local summary from the run document (until rescue-server answers /api/assessment)
  const top = S.segments[0], W = S.weather || {}, grounded = (S.resources || []).filter((r) => !r.available);
  const lines = [];
  lines.push(`Najbardziej prawdopodobny: <b>${esc(top.id)} ${esc(top.name)}</b> (${pct(top.poa)}).`);
  if (W.survival) lines.push(`Hipotermia: ${esc(W.survival.level || "")} - ${esc(W.survival.hoursOut)} h od ostatniego kontaktu.`);
  if (W.visibilityM != null && W.visibilityM < 300) lines.push(`Mgła: widoczność ${esc(W.visibilityM)} m.`);
  if (grounded.length) lines.push(`Niedostępne: ${grounded.map((r) => esc(r.name.split(" (")[0]) + " (" + esc(r.reason) + ")").join(", ")}.`);
  const a0 = (S.assignments || [])[0]; if (a0) lines.push(`Następny krok: ${esc(a0.resourceId)} -> ${esc(a0.segmentId)}, szansa ${pct(a0.expectedFind)}.`);
  $("assess").innerHTML = lines.map((l) => `<div style="margin-bottom:3px">${l}</div>`).join("") + `<div class="help">źródło: lokalnie z run.json (brak /api/assessment)</div>`;
}
$("segs").onclick = (e) => { const b = e.target.closest("[data-seg]"); if (b) { selectSeg(b.dataset.seg, "panel"); flyToSeg(b.dataset.seg); } };
$("teams").onclick = (e) => { const b = e.target.closest(".seglink"); if (b) { selectSeg(b.dataset.seg, "panel"); flyToSeg(b.dataset.seg); } };
function flyToSeg(id) { const s = curStep()?.segments.find((x) => x.id === id); if (!s || !s.polygon || !s.polygon.length || store.view === "3d") return; let w = 180, e = -180, so = 90, n = -90; for (const [x, y] of s.polygon) { w = Math.min(w, x); e = Math.max(e, x); so = Math.min(so, y); n = Math.max(n, y); } map.fitBounds([[w, so], [e, n]], { padding: 120, maxZoom: 15, duration: 500 }); }

// ---------- alerts (from /metrics of this server and of rescue-field on :8770)
let alertBase = null;
function prom(txt) { const out = []; for (const l of (txt || "").split("\n")) { if (!l || l[0] === "#") continue; const m = /^(\w+)(\{([^}]*)\})?\s+(\S+)/.exec(l); if (!m) continue; const lab = {}; (m[3] || "").replace(/(\w+)="([^"]*)"/g, (_, k, v) => lab[k] = v); out.push({ n: m[1], lab, v: +m[4] }); } return out; }
async function pollAlerts() {
  const get = async (u) => { try { const r = await fetch(u, { cache: "no-store" }); return r.ok ? await r.text() : null; } catch (e) { return null; } };
  const own = await get("/metrics"), field = await get(`${location.protocol}//${location.hostname}:8770/metrics`);
  const A = [];
  const M = [...prom(own), ...prom(field)];
  const now = M.find((m) => m.n === "rescue_server_time_seconds")?.v || Date.now() / 1000, thr = M.find((m) => m.n === "rescue_silent_threshold_seconds")?.v || 600;
  const last = {}; M.filter((m) => m.n === "rescue_client_last_report_timestamp_seconds").forEach((m) => { const k = m.lab.team || m.lab.client_id; last[k] = Math.max(last[k] || 0, m.v); });
  for (const [team, t] of Object.entries(last)) { const age = now - t; if (age > thr && age < 7200) A.push(["bad", `CISZA: ${team} - ostatni meldunek ${Math.round(age / 60)} min temu`]); }
  const rej = {}; M.filter((m) => m.n === "rescue_reports_rejected_total").forEach((m) => rej[m.lab.reason] = (rej[m.lab.reason] || 0) + m.v);
  if (!alertBase) alertBase = { ...rej };
  for (const [k, v] of Object.entries(rej)) { const d = v - (alertBase[k] || 0); if (d > 0) A.push([d > 5 ? "bad" : "", `Odrzucone żądania (${k === "pin" ? "zły PIN" : k}): ${d} od otwarcia strony`]); }
  if (M.some((m) => m.n === "rescue_llm_up" && m.v === 0)) A.push(["", "Lokalny LLM niedostępny - meldunki parsowane regułami"]);
  const S = curStep(); (S?.assignments || []).forEach((a) => (a.safety || []).forEach((f) => A.push(["", `${a.resourceId}: ${f}`])));
  if (field === null) A.push(["ok", "rescue-field (:8770) nie odpowiada - brak danych o zespołach w terenie"]);
  $("alerts").innerHTML = (A.length ? A : [["ok", "Brak alertów"]]).map(([c, t]) => `<div class="alert ${c}">${esc(t)}</div>`).join("");
}
setInterval(pollAlerts, 10000);

// ---------- events + timeline
function relOf(t) { const [a, b] = String(t).split(":").map(Number), [c, d] = startClock().split(":").map(Number); let x = a * 60 + b - c * 60 - d; return x < -720 ? x + 1440 : x; }
function renderEvents() {
  const R = D(), S = curStep();
  if (R.story) {
    const items = R.story.items || [], items0 = items;
    $("events").innerHTML = items0.map((it, k) => { const ev = it.events[0] || {};
      return `<div class="ev ${rel(ev.at) > rel(S.t) ? "future" : ""} ${it.id === store.selEv ? "cur" : ""}" data-id="${esc(it.id)}"><div class="src">${esc(ev.at)} · ${esc(it.input.provider)}${it.parsedBy ? " · " + esc(it.parsedBy) : ""}</div>
        <div class="t">${esc(ev.title || it.input.provider)}${it.events.length > 1 ? ` <span class="mute">(+${it.events.length - 1})</span>` : ""}</div>
        ${it.note ? `<div class="note">${esc(it.note)}</div>` : ""}
        <div class="ops"><button data-op="up" ${k === 0 ? "disabled" : ""}>&lt;</button><button data-op="down" ${k === items.length - 1 ? "disabled" : ""}>&gt;</button><button data-op="delete">usuń</button></div></div>`; }).join("");
    wireEvents();
  } else {
    $("events").innerHTML = R.steps.map((s, k) => `<div class="ev ${k + 1 === store.step ? "cur" : k + 1 > store.step ? "future" : ""}" data-step="${k + 1}"><div class="src">${esc(s.t)} · ${esc(s.source || "")}</div><div class="t">${esc(s.label)}</div></div>`).join("");
  }
}
$("slider").oninput = () => setStep(+$("slider").value);
$("events").onclick = async (e) => {
  if (suppressClick) return;
  const b = e.target.closest("button"), card = e.target.closest(".ev"); if (!card) return;
  if (card.dataset.step) return setStep(+card.dataset.step);
  if (b) { await run(() => api("/story/edit", { id: card.dataset.id, op: b.dataset.op }), b.dataset.op === "delete" ? "Usunięto zdarzenie" : "Zamieniono kolejność (czas)"); return; }
  // select evidence: jump to its step and fly to it
  const it = D().story.items.find((i) => i.id === card.dataset.id), ev = it && it.events[0]; if (!ev) return;
  set({ selEv: it.id }, "selectEv");
  const k = D().steps.findIndex((s) => s.label === ev.title); if (k >= 0) setStep(k + 1);
  if (ev.point && store.view !== "3d") map.flyTo({ center: [ev.point[1], ev.point[0]], zoom: Math.max(map.getZoom(), 13.5), duration: 500 });
};
let playing = null;
$("play").onclick = () => {
  if (playing) { clearInterval(playing); playing = null; $("play").textContent = "▶"; return; }
  if (store.step >= D().steps.length) setStep(1);
  $("play").textContent = "❚❚";
  playing = setInterval(() => { if (store.step >= D().steps.length) { $("play").onclick(); return; } setStep(store.step + 1); }, 1400);
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
function hint(html) { $("hint").innerHTML = store.editable ? (html || HINT) : ""; }
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
  if (store.view === "3d") setView("split");
  document.querySelector(`.card[data-k="${a.kind === "team" ? "t:" + a.res.id : a.card.key}"]`)?.classList.add("armed");
  hint(a.kind === "team" ? `Kliknij <b>sektor</b> na mapie dla: ${esc(a.res.name)} (Esc - anuluj)` : `Kliknij mapę, żeby dodać: <b>${esc(a.card.label)}</b> (Esc - anuluj)`);
}
function renderPalette() {
  const have = new Set(store.mods.map((m) => m.name));
  $("palette").innerHTML = CARDS.filter((c) => have.has(c.provider)).map((c) => `<div class="card" data-k="${c.key}" tabindex="0" role="button" title="Przeciągnij na mapę albo kliknij, potem kliknij mapę"><span class="dot" style="background:${c.color}"></span>${esc(c.label)}</div>`).join("");
  for (const el of $("palette").children) {
    const c = CARDS.find((x) => x.key === el.dataset.k);
    draggable(el, () => c.label, (x, y) => { const ll = mapLL(x, y); if (ll) openForm(c, ll); else if (store.view === "3d") toast("Upuść na mapie 2D (widok 2D lub Podział)"); });
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
  if (c.seg && !seg) return toast("Upuść na sektor (segment) mapy");
  const segOpts = (S ? S.segments : []).map((s) => `<option value="${esc(s.id)}" ${seg && s.id === seg.id ? "selected" : ""}>${esc(s.id)} ${esc(s.name)}</option>`).join("");
  let f = `<h3>${esc(c.label)}</h3><label>Godzina <input type="time" name="at" value="${addMin(curClock(), 5)}"></label>`;
  if (c.r) f += `<label>Promień m <input name="radiusM" inputmode="numeric" value="${c.r}"></label>`;
  if (c.title) f += `<label>Opis <input name="title" value="${esc(c.title)}"></label>`;
  if (c.seg) f += `<label>Sektor <select name="seg">${segOpts}</select></label><label>POD <input name="pod" inputmode="decimal" value="${c.pod}"></label>`;
  if (c.weather) f += `<label>Widoczność m <input name="visibilityM" value="80"></label><label>Wiatr m/s <input name="windMs" value="12"></label><label>Temp. °C <input name="tempC" value="1"></label><label>Ciemno <input type="checkbox" name="dark" checked></label>`;
  f += `<div class="row"><button type="button" class="cancel">Anuluj</button><button class="primary" type="submit">Dodaj</button></div>`;
  const el = document.createElement("form"); el.className = "pop"; el.innerHTML = f;
  const W = $("map").clientWidth, H = $("map").clientHeight;
  el.style.left = Math.max(4, Math.min(W - 240, ll.px[0] + 14)) + "px"; el.style.top = Math.max(4, Math.min(H - 240, ll.px[1] - 20)) + "px";
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
  if (d && d.added) { if (!d.added.events.length) toast("Nie dodano: " + (d.added.note || "brak danych")); else toast("Dodano: " + d.added.events.map((e) => e.title).join("; ")); }
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
  const seg = segAt(ll.lng, ll.lat); if (!seg) return toast("Upuść zespół na sektor (segment) mapy");
  const S = curStep(), plan = (S.assignments || []).find((a) => a.resourceId === r.id && a.segmentId === seg.id);
  teamOps.push({ res: r, segId: seg.id, segName: seg.name, at: curClock(), ll: [ll.lat, ll.lng], pod: plan ? +plan.pod.toFixed(2) : POD_DEF[r.type] || 0.6,
                 sweep: plan ? Math.min(120, Math.max(15, Math.round(plan.travelMin + plan.sweepMin))) : 30 });
  toast(`${r.name} -> ${seg.id} ${seg.name} (${curClock()})${plan ? ", zgodnie z planem" : ""}`);
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
  if (!store.editable) return;
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
    if (r.error) return toast("Błąd: " + r.error, 4000);
    toast(`Zapisano ${r.saved}. Uruchom: ${r.run}`, 7000);
  } catch (e) { toast(String(e.message || e), 4000); }
};

// ---------- 3D view in an iframe (CONTRACT.md). postMessage when the 3D page says "ready", else reload with URL params.
let ready3d = false, src3d = "", dirty3d = true;
function url3d() {
  const i = store.step - 1;
  if (store.backend === "studio") return `../web/3d/index.html?sc=zawrat&run=${encodeURIComponent("/story")}&scenario=${encodeURIComponent("/story/scenario")}&step=${i}`;
  if (store.backend === "api") return `../web/3d/index.html?sc=${encodeURIComponent(store.scenario)}&run=${encodeURIComponent("/api/run/" + store.scenario)}&step=${i}`;
  return `../web/3d/index.html?sc=${encodeURIComponent(store.scenario)}&step=${i}`;
}
function post3d(msg) { if (ready3d) $("frame3d").contentWindow.postMessage({ source: "rescue-app", ...msg }, location.origin); }
function sync3d(why) {
  if (store.view === "2d") { dirty3d = true; return; }
  if (ready3d) {
    if (why === "run" || why === "edit" || why === "load" || dirty3d) post3d({ type: "run", run: store.run, step: store.step - 1 });
    if (why === "step" || dirty3d) post3d({ type: "step", i: store.step - 1 });
    if (store.selSeg) post3d({ type: "select", segmentId: store.selSeg });
    dirty3d = false; return;
  }
  const u = url3d(); if (u === src3d && !(why === "edit" || why === "run") && !dirty3d) return;
  clearTimeout(sync3d.h);
  sync3d.h = setTimeout(() => { src3d = u; ready3d = false; $("frame3d").src = u; dirty3d = false; }, why === "step" ? 700 : 50);
  const R = D(), out = R && R.bbox && (R.bbox.west > 20.09 || R.bbox.east < 20.0 || R.bbox.north < 49.19 || R.bbox.south > 49.25);
  $("note3d").textContent = out ? "3D: teren Zawratu - historia poza tym obszarem nie ma jeszcze modelu 3D" : ready3d ? "" : "3D: tryb zgodności (przeładowanie przy zmianie)";
}
addEventListener("message", (e) => {
  if (e.source !== $("frame3d").contentWindow || !e.data || typeof e.data !== "object") return;
  const m = e.data;
  if (m.type === "ready") { ready3d = true; $("note3d").textContent = ""; post3d({ type: "run", run: store.run, step: store.step - 1 }); if (store.selSeg) post3d({ type: "select", segmentId: store.selSeg }); }
  if (m.type === "select" && typeof m.segmentId !== "undefined") selectSeg(m.segmentId, "3d");
  if (m.type === "step" && Number.isInteger(m.i)) setStep(m.i + 1, "3d");
});
function setView(v) {
  store.view = v;
  document.body.className = document.body.className.replace(/view-\w+/, "view-" + v);
  document.querySelectorAll(".views button").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
  try { localStorage.setItem("rescue-app-view", v); } catch (e) {}
  setTimeout(() => map.resize(), 0);
  sync3d("view");
}
document.querySelectorAll(".views button").forEach((b) => b.onclick = () => setView(b.dataset.view));

// ---------- wiring
subs.push((why) => {
  if (!store.run || !store.run.steps) return;
  renderMap(); renderPanels(); renderAssess();
  if (why !== "select") { renderPins(); renderTokens(); renderTeams(); }
  else renderPins();
  if (why !== "select" && why !== "selectEv") sync3d(why);
});
$("scen").onchange = () => loadScenario($("scen").value).catch((e) => toast(String(e.message || e), 5000));

window.rescueApp = { CARDS, openForm, dropTeam, addInput, setStep, selectSeg, setView, undo, teamOps: () => teamOps, src3d: () => src3d, ready3d: () => ready3d };   // tests
async function boot() {
  try {
    await detect();
    if (!store.scenList.length) throw new Error("brak scenariuszy");
    renderPalette();
    let v = "2d"; try { v = localStorage.getItem("rescue-app-view") || "2d"; } catch (e) {}
    const q = new URLSearchParams(location.search); if (q.get("view")) v = q.get("view");
    if (q.get("sc") && store.scenList.some((s) => s.id === q.get("sc"))) $("scen").value = q.get("sc");
    await loadScenario($("scen").value);
    setView(["2d", "3d", "split"].includes(v) ? v : "2d");
    hint();
    pollAlerts();
  } catch (e) { toast("Serwer niedostępny: swift run rescue-studio, potem http://127.0.0.1:8771/app/ (" + (e.message || e) + ")", 8000); }
}
boot();
