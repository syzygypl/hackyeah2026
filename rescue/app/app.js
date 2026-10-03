// Rescue Locator - one app: Story Studio editing on the 2D map + the 3D view (iframe, postMessage contract in CONTRACT.md)
// + shared panels. Backend: rescue-server on the same origin (/api/*, /story*, /modules; deployed on Vercel or
// `swift run rescue-server` on a laptop). Offline: MapLibre + basemap from ../web/, no CDN.
import * as maplibregl from "../web/vendor/maplibre-gl.mjs";
import { offlineStyle, loadBasemap, ZAWRAT_BOUNDS, regionFor } from "../web/basemap/basemap.js";
import { paintGrid, legendHTML } from "./scale.js";
import { showValidation } from "./validation.js";
import { initRescuer, render as renderRescuer, pollTask, myTeam } from "./rescuer.js";   // shared heat scale (decision S2), same as 3D

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (p) => Math.round((p || 0) * 100) + "%";
const LOOPBACK = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(location.hostname);
const JOINED = !!new URLSearchParams(location.search).get("key");   // opened from a join link / QR: that is a live action
// action key (write access): arrives once in the join link / QR (?key=), is kept on this device and removed from the address bar
{ const k = new URLSearchParams(location.search).get("key"); if (k) { try { localStorage.setItem("rescue-pin", k.trim()); } catch (e) {} const u = new URL(location.href); u.searchParams.delete("key"); history.replaceState(null, "", u); } }
let PIN = ""; try { PIN = (localStorage.getItem("rescue-pin") || "").replace(/^"(.*)"$/, "$1"); } catch (e) {}   // raw like field/ops/2D; web/patrol writes it JSON-quoted
if (!LOOPBACK) { $("pinbox").style.display = ""; $("pin").value = PIN; $("pin").onchange = () => { PIN = $("pin").value.trim(); try { localStorage.setItem("rescue-pin", PIN); } catch (e) {} boot(); }; }
async function api(path, body) {
  const h = { "Content-Type": "application/json" }; if (!LOOPBACK && PIN) h["X-Rescue-Pin"] = PIN;
  const r = await fetch(path, body === undefined ? { headers: h, cache: "no-store" } : { method: "POST", headers: h, body: JSON.stringify(body) });
  if (r.status === 401) throw new Error("Zmiany wymagają klucza akcji: otwórz link „Udostępnij” od kierownika akcji albo wpisz klucz w polu Klucz.");
  if (r.status === 404) throw new Error("Nie znaleziono danych na serwerze.");
  if (r.status >= 500) throw new Error("Serwer zgłosił błąd - spróbuj ponownie za chwilę.");
  if (!r.ok) throw new Error("Serwer odrzucił żądanie (" + r.status + ").");
  return r.json();
}
const tryJSON = async (path) => { try { return await api(path); } catch (e) { return null; } };
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
  const a = await tryJSON("/api/scenarios");
  const m = await tryJSON("/modules");
  store.hasApi = !!a; store.hasStudio = !!(m && m.modules); store.mods = m ? m.modules : [];
  let list = [];
  if (a) for (const s of (Array.isArray(a) ? a : a.scenarios || [])) { const id = typeof s === "string" ? s : s.id || s.name; if (id && !/blind/i.test(id)) list.push({ id, name: (s.incident ? id + " - " + s.incident : id).slice(0, 70), api: true, run: s.run || "/api/run/" + id, assessment: s.assessment || "/api/assessment/" + id }); }
  if (store.hasStudio) list.push({ id: "studio", name: "Studio (edycja na żywo)" });
  // blind test round 1 replay (the 3D view shows the hider's story and the true spot at the end); only when its run is there
  try { const r = await fetch(STATIC["blind-01-replay"].run, { cache: "no-store" }); if (r.ok) list.push({ id: "blind-01-replay", name: STATIC["blind-01-replay"].name, static: true }); r.body && r.body.cancel(); } catch (e) {}
  $("scen").innerHTML = list.map((s) => `<option value="${esc(s.id)}" ${s.disabled ? "disabled" : ""}>${esc(s.name)}</option>`).join("");
  store.scenList = list;
}
async function loadScenario(id) {
  const s = store.scenList.find((x) => x.id === id && !x.disabled) || store.scenList.find((x) => !x.disabled);
  teamOps = []; closePop();
  let run, backend;
  if (s.id === "studio") { run = await api("/story"); backend = "studio"; }
  else if (s.api) { const u = runUrlFor(s.run); run = await api(u); backend = "api"; store.runUrl = u; store.assessUrl = s.assessment; }
  else { run = await (await fetch(STATIC[s.id].run, { cache: "no-store" })).json(); backend = "static"; }
  $("scen").value = s.id;
  applyRun(run, { scenario: s.id, backend, editable: backend === "studio" }, "load");
}
function applyRun(run, extra = {}, why = "run") {
  if (run && run.error && !run.steps) { toast("Nie udało się policzyć mapy: " + run.error); return; }
  const fit = !store.run || JSON.stringify(store.run.bbox) !== JSON.stringify(run.bbox);
  if (why === "load") evOff.clear();
  set({ ...extra, run, step: run.steps ? run.steps.length : 1 }, why);
  if (fit && run.bbox && mapReady) map.fitBounds([[run.bbox.west, run.bbox.south], [run.bbox.east, run.bbox.north]], { padding: 20, duration: 0 });
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
        const r = await fetch(`${store.assessUrl}?step=${i}&wait=0`, { cache: "no-store" }); if (!r.ok) break;
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
  if (store.run && store.run.bbox) map.fitBounds([[store.run.bbox.west, store.run.bbox.south], [store.run.bbox.east, store.run.bbox.north]], { padding: 20, duration: 0 });
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
}

// ---------- panels
function renderPanels() {
  const R = D(), S = curStep(); if (!R || !S) return;
  const t3 = S.segments.slice(0, 3), tp = t3.reduce((a, s) => a + s.poa, 0), ta = t3.reduce((a, s) => a + s.areaPct, 0);
  // no POA % on screen (najmocniejsze-funkcje.md "Czego NIE pokazywać"): a juror reads "45%" as a chance, it holds ~19%; show rank and area
  $("vbig").innerHTML = `<b>${Math.round(ta)}%</b><span>obszaru to top 3<br><em>tu szukać najpierw</em></span>`;
  $("vsub").textContent = `Top 3 z ${S.segments.length} segmentów · krok ${store.step}/${R.steps.length} (${S.t})`;
  const segRows = [...t3]; const sel = S.segments.find((s) => s.id === store.selSeg); if (sel && !t3.includes(sel)) segRows.push(sel);
  $("segs").innerHTML = segRows.map((s) => { const k = S.segments.indexOf(s);
    const a = segTeam(S, s.id);
    return `<div class="box seg ${s.id === store.selSeg ? "sel" : ""}" data-seg="${esc(s.id)}"><span class="rank">${k + 1}</span><b>${esc(s.id)} ${esc(s.name)}</b><div class="p"><span class="mute" style="font-size:13px">${(+s.areaPct).toFixed(1).replace(".", ",")}% obszaru</span></div><i class="segbar" style="--w:${Math.min(100, s.poa * 100 / Math.max(t3[0].poa, 1e-9) * 0.9).toFixed(0)}%"></i>${a ? `<div class="segteam"><span class="tk">${esc((a.name || "?")[0])}</span>${esc(a.name)}</div>` : ""}</div>`; }).join("");
  const W = S.weather || {}; $("surv").textContent = W.survival ? "Hipotermia: " + W.survival.text : "";
  const by = {}; (S.assignments || []).forEach((a) => by[a.resourceId] = a);
  (store.manual || []).forEach((m) => by[m.resourceId] = { ...(by[m.resourceId] && by[m.resourceId].segmentId === m.segmentId ? by[m.resourceId] : { travelMin: NaN, expectedFind: NaN, safety: [] }), ...m, reason: "Przydział operatora" + (m.at ? " o " + m.at : "") });
  $("teams").innerHTML = (S.resources || []).map((r) => { const a = by[r.id];
    return `<div class="box team ${r.available ? "" : "off"}"><div class="row" style="justify-content:space-between"><b>${esc(r.name)}</b><span class="pill ${r.available ? "" : "off"}">${r.available ? (a ? "przydział" : "wolny") : "niedostępny"}</span></div>
      ${r.available ? "" : `<div class="help">${esc(r.reason)}</div>`}
      ${a ? `<div>→ <b class="seglink" data-seg="${esc(a.segmentId)}" style="cursor:pointer">${esc(a.segmentId)} ${esc(a.segmentName)}</b>${a.by === "operator" ? ` <span class="pill">operator</span>` : ""}</div>${(a.safety || []).map((f) => `<div class="flag">! ${esc(f)}</div>`).join("")}
      <details><summary>Szczegóły</summary>${isFinite(a.travelMin) ? `<div>Dojście ok. ${Math.round(a.travelMin)} min.</div>` : ""}<div>${esc(a.reason || `Skuteczność przeszukania ${pct(a.pod)}, przeszukanie ok. ${Math.round(a.sweepMin || 0)} min.`)}</div></details>` : ""}</div>`; }).join("") || `<div class="help">Ten scenariusz nie ma jeszcze zespołów.</div>`;
  renderProgress(); renderEvents();
  $("clock").textContent = S.t + " · " + S.label;
  $("slider").max = R.steps.length; $("slider").value = store.step;
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
  if (W.survival) lines.push(`Hipotermia: ${esc(W.survival.level || "")} - ${esc(W.survival.hoursOut)} h od ostatniego kontaktu.`);
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
  const get = async (u) => { try { const r = await fetch(u, { cache: "no-store" }); return r.ok ? await r.text() : null; } catch (e) { return null; } };
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
  const S = curStep(); (S?.assignments || []).forEach((a) => (a.safety || []).forEach((f) => A.push(["", `${a.resourceId}: ${f}`])));
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
      return `<div class="ev ${rel(ev.at) > rel(S.t) ? "future" : ""} ${it.id === store.selEv ? "cur" : ""} ${hid && evOff.has(hid) ? "evoff" : ""}" data-id="${esc(it.id)}"><div class="src">${hid ? evToggle(hid) : ""}${esc(ev.at)} · ${esc(it.input.provider)}${it.parsedBy ? " · " + esc(it.parsedBy) : ""}</div>
        <div class="t">${esc(ev.title || it.input.provider)}${it.events.length > 1 ? ` <span class="mute">(+${it.events.length - 1})</span>` : ""}</div>
        ${it.note ? `<div class="note">${esc(it.note)}</div>` : ""}
        <div class="ops"><button data-op="up" ${k === 0 ? "disabled" : ""}>&lt;</button><button data-op="down" ${k === items.length - 1 ? "disabled" : ""}>&gt;</button><button data-op="delete">usuń</button></div></div>`; }).join("") || `<div class="help">Historia jest pusta. ${store.mode === "edycja" ? "Przeciągnij dowód z lewej strony na mapę." : "Dodaj zdarzenia w trybie Edycja."}</div>`;
    wireEvents();
  } else {
    $("events").innerHTML = R.steps.map((s, k) => `<div class="ev ${k + 1 === store.step ? "cur" : k + 1 > store.step ? "future" : ""} ${s.hintId && evOff.has(s.hintId) ? "evoff" : ""}" data-step="${k + 1}"><div class="src">${s.hintId ? evToggle(s.hintId) : ""}${esc(s.t)} · ${esc(s.source || "")}</div><div class="t">${esc(s.label)}</div></div>`).join("");
  }
}
// evidence on/off ("uwzględnij"): the embedded views recompute the map in the browser (contract: {type:'evidence', id, on}, '*' = all)
const evOff = new Set();
const evToggle = (id) => `<input type="checkbox" class="evt" data-hint="${esc(id)}" ${evOff.has(id) ? "" : "checked"} title="Uwzględnij ten sygnał (przelicza 2D analizę i 3D)"> `;
function setEvidence(id, on, from) {
  if (id === "*") { if (on) evOff.clear(); } else if (on) evOff.delete(id); else evOff.add(id);
  for (const k in FRAMES) if (k !== from) postTo(k, { type: "evidence", id, on });
  renderEvents();
  $("evReset").hidden = !evOff.size;
}
$("events").addEventListener("change", (e) => { const c = e.target.closest(".evt"); if (c) setEvidence(c.dataset.hint, c.checked, "panel"); });
$("events").addEventListener("click", (e) => { if (e.target.closest(".evt")) e.stopPropagation(); }, true);
$("evReset").onclick = () => setEvidence("*", true, "panel");
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
  if (ev.point && store.mode === "edycja") map.flyTo({ center: [ev.point[1], ev.point[0]], zoom: Math.max(map.getZoom(), 13.5), duration: 500 });
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
  return [Math.round(h.bottom), Rr ? Math.round(innerWidth - Rr.left) : 0, Bt ? Math.round(innerHeight - Bt.top) : 0, L ? Math.round(L.right) : 0];
}
function setFloat() {
  document.body.classList.toggle("float", store.role !== "ratownik" && (store.mode === "akcja" || store.mode === "edycja"));
  pushInsets();
}
// the same free area in one element's own coordinates (split view: each frame covers only half the screen)
function insetsFor(el) {
  const [T, R, B, L] = insets(), f = el && el.getBoundingClientRect();
  if (!f || !f.width) return [T, R, B, L];
  return [Math.max(0, T - f.top), Math.max(0, f.right - (innerWidth - R)), Math.max(0, f.bottom - (innerHeight - B)), Math.max(0, L - f.left)].map(Math.round);
}
let insetsKey = "";
function pushInsets() {
  const key = insets().join(",") + store.view;
  if (mapReady) { const [T, R, B, L] = insetsFor($("map")); map.setPadding({ top: T, right: R, bottom: B, left: L }); }
  if (key === insetsKey) return; insetsKey = key;
  for (const k in FRAMES) postTo(k, { type: "insets", insets: insetsFor(FRAMES[k].el) });
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
function postTo(k, msg) { const F = FRAMES[k]; if (F.ready && F.el.contentWindow) F.el.contentWindow.postMessage({ source: "rescue-app", ...msg }, location.origin); }
function post3d(msg) { for (const k in FRAMES) postTo(k, msg); }
function syncFrame(k, why) {
  const F = FRAMES[k];
  if (!F.visible()) { if (why === "edit" || why === "load" || why === "run") F.dirty = true; return; }
  if (F.ready && !F.dirty && why !== "load") {
    if (why === "edit" || why === "run") { const u = runURL(); if (u) { F.ready = false; postTo2(F, { type: "run", url: u }); return; } }
    if (why === "step") postTo(k, { type: "step", i: store.step - 1 });
    return;
  }
  const u = frameURL(k); if (u === F.src && !F.dirty && why !== "edit" && why !== "run") return;
  clearTimeout(F.h);
  F.h = setTimeout(() => { F.src = u; F.ready = false; F.el.src = u; F.dirty = false; }, why === "step" ? 700 : 50);
  const R = D(), out = k === "3d" && R && R.bbox && (R.bbox.west > 20.09 || R.bbox.east < 20.0 || R.bbox.north < 49.19 || R.bbox.south > 49.25) && store.backend === "studio";
  F.note.textContent = out ? "3D: teren Zawratu - historia poza tym obszarem nie ma jeszcze modelu 3D" : "";
}
function postTo2(F, msg) { F.el.contentWindow.postMessage({ source: "rescue-app", ...msg }, location.origin); }
function sync3d(why) { for (const k in FRAMES) syncFrame(k, why); }
addEventListener("message", (e) => {
  const k = Object.keys(FRAMES).find((x) => FRAMES[x].el.contentWindow === e.source);
  if (!k || e.origin !== location.origin || !e.data || typeof e.data !== "object" || e.data.source !== FRAMES[k].source) return;
  const m = e.data, F = FRAMES[k];
  if (m.type === "ready") {
    F.ready = true;
    if (Number.isInteger(m.step) ? m.step !== store.step - 1 : true) postTo(k, { type: "step", i: store.step - 1 });
    if (store.selSeg) postTo(k, { type: "select", segmentId: store.selSeg });
    for (const id of evOff) postTo(k, { type: "evidence", id, on: false });
    postTo(k, { type: "insets", insets: insetsFor(F.el) });
  }
  if (m.type === "cinema") { document.body.classList.toggle("cinema", !!m.on); pushInsets(); } // 3D Kino: panels step aside, full-frame shots
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
  $("roleBtn").textContent = r === "ratownik" ? "Rola: ratownik" : "Rola: operator";
  $("rolePick").hidden = true;
  showFirstRun(r);
  if (r === "ratownik") {
    $("rMapHost").appendChild($("map"));
    pollTask(); renderRescuer(); setRescuerFrame();
  } else {
    $("center").insertBefore($("map"), $("center").firstChild);
    setMode(store.mode || "akcja");
  }
  setFloat();
  setTimeout(() => map.resize(), 50);
}
// first-run hint: one line, dismissible, remembered per role
const HINTS = {
  operator: "Wybierz scenariusz u góry. Akcja pokazuje mapę i plan, Plan pozwala dodawać dowody przeciągając je na mapę.",
  ratownik: "Wybierz swój zespół. Zadanie i mapa są u góry, meldunki wysyłasz dużymi przyciskami na dole.",
};
function showFirstRun(role) {
  const el = $("firstRun"); let seen = false; try { seen = localStorage.getItem("rescue-app-hint-" + role) === "1"; } catch (e) {}
  if (seen || !HINTS[role]) { el.hidden = true; return; }
  // header line for the operator; on the phone the header is reduced, so the hint goes above the task card
  if (role === "ratownik") $("rescuer").insertBefore(el, $("rescuer").firstChild); else $("status").before(el);
  el.hidden = false; $("firstRunText").textContent = HINTS[role];
  $("firstRunOk").onclick = () => { el.hidden = true; try { localStorage.setItem("rescue-app-hint-" + role, "1"); } catch (e) {} };
}
// Akcja: the event cards hide behind "Sygnały" so the dock is one line; Plan always shows them
$("sigBtn").onclick = () => { const on = document.body.classList.toggle("signals"); $("sigBtn").setAttribute("aria-pressed", on); setTimeout(pushInsets, 50); };
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
  akcja: { label: "Akcja", views: [["2d", "2D"], ["3d", "3D"]] },
  edycja: { label: "Plan", views: [["map", "Mapa"], ["split", "Mapa + 3D"]] },
  teren: { label: "Teren", views: [["przeglad", "Przegląd zespołów"], ["patrol", "Telefon patrolu"], ["field", "Meldunek"]] },
  monitoring: { label: "Monitoring", views: [] },
  walidacja: { label: "Walidacja", views: [] },
};
const lastView = {};
// three top tabs (redesign): Akcja, Plan (= edycja), Więcej (Teren / Monitoring / Walidacja as sub-tabs in #more)
const TABS = [["akcja", "Akcja"], ["edycja", "Plan"], ["wiecej", "Więcej"]], MORE = ["teren", "monitoring", "walidacja"];
let lastMore = "teren";
$("modes").innerHTML = TABS.map(([k, l]) => `<button data-mode="${k}" role="tab">${l}</button>`).join("");
$("modes").onclick = (e) => { const b = e.target.closest("[data-mode]"); if (b) setMode(b.dataset.mode === "wiecej" ? lastMore : b.dataset.mode); };
$("more").innerHTML = MORE.map((k) => `<button data-mode="${k}" role="tab">${MODES[k].label}</button>`).join("");
$("more").onclick = (e) => { const b = e.target.closest("[data-mode]"); if (b) setMode(b.dataset.mode); };
$("views").onclick = (e) => { const b = e.target.closest("[data-view]"); if (b) setView(b.dataset.view); };
function setMode(m, v) {
  if (!MODES[m]) m = "akcja";
  store.mode = m;
  document.body.className = document.body.className.replace(/\bmode-\w+/g, "").trim() + " mode-" + m;
  if (MORE.includes(m)) lastMore = m;
  document.querySelectorAll("#modes button").forEach((b) => b.classList.toggle("on", b.dataset.mode === m || (b.dataset.mode === "wiecej" && MORE.includes(m))));
  document.querySelectorAll("#more button").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
  $("more").style.display = MORE.includes(m) ? "" : "none";
  const views = MODES[m].views;
  $("views").innerHTML = views.map(([k, l]) => `<button data-view="${k}" role="tab">${l}</button>`).join("");
  $("views").style.display = views.length ? "" : "none";
  if (m === "edycja" && store.backend !== "studio" && store.hasStudio) loadScenario("studio").catch((e) => toast(plErr(e)));
  try { localStorage.setItem("rescue-app-mode", m); } catch (e) {}
  setFloat(); // before setView: the frames are created with the floating insets
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
  try { ev = await (await fetch((FIELD || "") + "/live-events", { cache: "no-store" })).json(); } catch (e) {}
  try { met = await (await fetch((FIELD || "") + "/metrics", { cache: "no-store" })).text(); } catch (e) {}
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
function syncFrames() { const R = D(); if (!R || !R.steps) return; for (const k in FRAMES) if (FRAMES[k].ready) postTo(k, { type: "step", i: store.step - 1 }); $("slider").value = store.step; }
async function setTime(t) {
  if (t === store.time) return;
  if (t === "live" && store.backend !== "api") { toast("Ten scenariusz to tylko nagranie - nie ma akcji na żywo. Wybierz scenariusz z serwera albo „+ Nowa akcja”.", 4500); return; }
  if (playing) $("play").onclick();
  store.time = t; try { localStorage.setItem("rescue-app-time", t); } catch (e) {}
  if (store.backend === "api") { try { await loadScenario(store.scenario); } catch (e) { toast(plErr(e)); } }
  renderLiveHead();
  toast(t === "live" ? "Na żywo: mapa pokazuje teraz, ze zgłoszeniami z terenu" : "Historia: nagrany przebieg akcji. Przesuń oś czasu albo naciśnij ▶", 3000);
}
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
  const plan = store.mode === "edycja" || store.backend === "studio";
  $("tmode").hidden = plan;
  $("tmode").querySelectorAll("button").forEach((b) => {
    b.classList.toggle("on", b.dataset.t === store.time);
    if (b.dataset.t === "live") b.disabled = store.backend !== "api";
  });
  document.querySelectorAll("[data-needslive]").forEach((el) => { el.classList.toggle("needslive", store.time !== "live"); el.setAttribute("aria-disabled", store.time !== "live"); });
  // dock: Historia plays the recording; Na żywo holds the timeline at now
  const on = liveOn();
  $("slider").disabled = on; $("play").disabled = on;
  $("play").title = on ? "Odtwarzanie działa w trybie Historia" : "Odtwórz historię";
  $("tlabel").textContent = plan ? "Historia" : on ? "Na żywo · teraz" : "Historia";
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
function renderLiveFeed() {
  const el = $("liveFeed"); if (!el) return;
  const K = { clue: "ślad", dispatch: "przydział", report: "meldunek" };
  // operator ACK (Mateusz): unconfirmed messages stand out, ✓ confirms one, "Potwierdź wszystkie" confirms the rest (POST /api/ack)
  const unacked = live.events.filter((e) => !e.acked && e.by !== "operator");
  el.innerHTML = live.events.slice(-8).reverse().map((e) => `<div class="lfi ${!e.acked && e.by !== "operator" ? "unack" : ""}"><span class="lft">${esc(hhmm(e.t))}</span> <b>${esc(e.by === "operator" ? "Operator" : e.team || "Ratownik")}</b> <span class="mute">${esc(K[e.kind] || e.kind)}</span> ${esc(e.title)}${!e.acked && e.by !== "operator" ? ` <button class="ack1" data-seq="${e.seq}" title="Potwierdź tę wiadomość">✓</button>` : e.acked ? ` <span class="ackd" title="Potwierdzone">✓</span>` : ""}</div>`).join("")
    || `<div class="help">Brak zdarzeń na żywo. Dodaj ślad albo wyślij zespół - mapa przeliczy się od razu.</div>`;
  if ($("ackCount")) $("ackCount").textContent = unacked.length ? `Niepotwierdzone: ${unacked.length}` : "Wszystko potwierdzone";
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
        if (changed) await onLiveChange(restarted ? [] : d.events || []);
      }
    } catch (e) { live.ok = false; }
  } else live.ok = false;
  renderLiveHead(); renderLiveFeed();
  pollLive.h = setTimeout(pollLive, 3000);
}
async function onLiveChange(evs) {
  try { const a = await api("/story/assign"); store.manual = a.assignments || []; } catch (e) {}
  if (liveOn() && store.runUrl) { try { applyRun(await api(store.runUrl), {}, "run"); } catch (e) {} }
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

window.rescueApp = { CARDS, openForm, dropTeam, addInput, setStep, selectSeg, setView, setMode, undo, teamOps: () => teamOps, frames: FRAMES };   // tests
async function boot() {
  try {
    await detect();
    if (!store.scenList.length) throw new Error("Brak scenariuszy na serwerze.");
    renderPalette();
    let m = "akcja"; try { m = localStorage.getItem("rescue-app-mode") || "akcja"; } catch (e) {}
    const q = new URLSearchParams(location.search); if (q.get("mode")) m = q.get("mode");
    const want = q.get("sc") || (store.hasApi ? "zawrat" : null);
    if (want && store.scenList.some((s) => s.id === want)) $("scen").value = want;
    await loadScenario($("scen").value);
    setMode(m, q.get("view"));
    if (q.get("step") != null && Number.isFinite(+q.get("step"))) setStep(+q.get("step") + 1); // ?step= is 0-based, like the views
    initRescuer({ store, api, map, maplibregl, toast, curStep, selectSeg: (id, from) => selectSeg(id, from), onTeam: setRescuerFrame });
    try { const a = await api("/story/assign"); store.manual = a.assignments || []; } catch (e) {}
    let role = q.get("role"); if (!role) { try { role = localStorage.getItem("rescue-app-role"); } catch (e) {} }
    if (role === "ratownik" || role === "operator") setRole(role); else { store.role = "operator"; $("rolePick").hidden = false; }
    hint();
    pollAlerts();
    pollLive();
  } catch (e) { console.error(e); toast("Nie mogę połączyć się z serwerem akcji - sprawdź sieć i odśwież stronę.", 10000); }
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
      try { const sc = await (await fetch(`../scenarios/${id}.json`, { cache: "no-store" })).json(); return sc.ipp && sc.ipp.at ? { id, name: sc.incident ? sc.incident.split(" - ").slice(1).join(" - ").replace(/\s*\(.*?\)\s*$/, "") || id : id, at: sc.ipp.at } : null; }
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
    let field = ""; if (PIN) { try { field = (await api("/api/join")).fieldKey || ""; } catch (e) {} }
    const rescuer = (() => { const u = new URL(link("ratownik", false)); if (field) u.searchParams.set("key", field); return u.toString(); })();
    $("shareBody").innerHTML = (PIN && field ? "" : `<p class="help">Na tym urządzeniu nie ma klucza operatora, więc linki są tylko do podglądu. Wpisz klucz w polu Klucz albo otwórz link operatora.</p>`)
      + row("Ratownik (telefon)", "Zeskanuj telefonem: rola ratownik, ta akcja. Klucz ratownika: tylko meldunki i ślady.", rescuer)
      + row("Operator (drugi komputer)", "Pełny dostęp: przydziały, Studio, Centrum, czyszczenie akcji. Nie pokazuj na rzutniku.", link("operator", !!field))
      + row("Podgląd (jury, bez zapisu)", "Widzi mapę i plan na żywo, nie może niczego zmienić.", link("", false));
    $("shareDlg").showModal();
  };
  $("shareBody").onclick = async (ev) => {
    const b = ev.target.closest("[data-copy]"); if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); toast("Skopiowano link"); } catch (e) { toast("Zaznacz link i skopiuj ręcznie"); }
  };
  $("shareReset").onclick = async () => {
    if (!confirm("Wyczyścić akcję na serwerze? Znikną meldunki, ślady, feed, przydziały i historia Studio (dla wszystkich urządzeń).")) return;
    try { await api("/api/reset", {}); toast("Akcja wyczyszczona"); $("shareDlg").close(); boot(); } catch (e) { toast(plErr(e), 5000); }
  };
}
