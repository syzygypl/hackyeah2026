// Centrum - all incidents (scenarios / LIVE actions) on one view for the operator (kierownik akcji / dyspozytor).
// Overview map + incident cards + shared team roster (drag a team onto an incident). Click -> open the incident in the app.
// Data: GET /api/incidents + GET /api/teams + POST /api/teams/assign (CONTRACT.md "Live mode"). Until the server has them,
// the adapter below falls back to GET /api/scenarios + lazy GET /api/run/<sc> (+ GET /api/live if present) and an
// in-memory team roster mock seeded from the scenario files. Switching is automatic: a 404 means "not there yet".
// MapLibre (~300 kB) is imported dynamically (initMap at the bottom): cards and roster render from the API without waiting for it.
let maplibregl, offlineStyle, loadBasemap, REGIONS;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// share of the search area, "1,8%" (no POA % on screen: najmocniejsze-funkcje.md "Czego NIE pokazywać", as in Akcja top 3)
const areaTxt = (a) => (+a || 0).toFixed(1).replace(".", ",") + "%";
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const POLL_MS = 10000;   // 10 s: /api/incidents + /api/teams per tick (perf round 3, wydajnosc.md)
// the card shows the live run (cursor time, e.g. "scenariusz 19:45"), so open Na żywo: the same moment and top 3 (demo review 2)
const openURL = (sc) => `./?role=operator&mode=akcja&time=live&sc=${encodeURIComponent(sc)}`;
function toast(t, ms = 3000) { const el = $("toast"); el.textContent = t; el.style.display = "block"; clearTimeout(toast.h); toast.h = setTimeout(() => el.style.display = "none", ms); }

// ---------- transport (PIN like app.js: loopback needs none)
const LOOPBACK = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(location.hostname);
{ const k = new URLSearchParams(location.search).get("key"); if (k) { try { localStorage.setItem("rescue-pin", k.trim()); } catch (e) {} const u = new URL(location.href); u.searchParams.delete("key"); history.replaceState(null, "", u); } }   // join link, as in app.js
let PIN = ""; try { PIN = (localStorage.getItem("rescue-pin") || "").replace(/^"(.*)"$/, "$1"); } catch (e) {}
if (!LOOPBACK) { $("pinbox").hidden = false; $("pin").value = PIN; $("pin").onchange = () => { PIN = $("pin").value.trim(); try { localStorage.setItem("rescue-pin", PIN); } catch (e) {} tick(); }; }
async function api(path, body) {
  const h = { "Content-Type": "application/json" }; if (!LOOPBACK && PIN) h["X-Rescue-Pin"] = PIN;
  const r = await fetch(path, body === undefined ? { headers: h, cache: "no-cache" } : { method: "POST", headers: h, body: JSON.stringify(body) });
  if (!r.ok) { const e = new Error(r.status === 401 ? "Podaj PIN akcji." : "HTTP " + r.status); e.status = r.status; throw e; }
  return r.json();
}

// ---------- data adapter: normalized incident = { sc, title, place, live, found, mode, lastEventAt, lastClock, top3:[{segmentId,name,weight}], teams:{assigned,total}, pending }
const has = { incidents: null, teams: null, live: null };   // null = not probed yet, true / false after the first answer
let liveRetry = 0;
const reprobe = { incidents: 0, teams: 0 };   // after a 404, ask again every 60 s (the server route may land while the page is open)
const tryReal = (k) => has[k] !== false || Date.now() > reprobe[k];
const missing = (k) => { has[k] = false; reprobe[k] = Date.now() + 60000; };
function splitIncident(txt, sc) {
  const t = String(txt || sc).replace(/\s*\(scenariusz fikcyjny\)\s*/i, "").trim();
  const i = t.indexOf(" - "); let title = i > 0 ? t.slice(0, i) : t, place = i > 0 ? t.slice(i + 3) : sc;
  if (/^.[a-ząćęłńóśźż]/.test(title)) title = title.charAt(0).toLowerCase() + title.slice(1);
  return { title, place };
}
async function loadIncidents() {
  if (tryReal("incidents")) {
    try { const a = await api("/api/incidents?fast=1"); has.incidents = true; return (Array.isArray(a) ? a : a.incidents || []).filter((x) => !/blind/i.test(x.sc)).map(normIncident); }
    catch (e) { if (e.status === 404) missing("incidents"); else throw e; }
  }
  return fallbackIncidents();
}
function normIncident(x) {
  return { sc: x.sc, title: x.title || "", place: x.place || x.sc, live: !!x.live, found: !!(x.ended ?? x.found), replayFound: !!x.replayFound, mode: x.mode || null, lastEventAt: x.lastEventAt || null,
    lastClock: x.at || x.lastClock || null, top3: (x.top3 || []).map((s) => ({ segmentId: s.segmentId, name: s.name, weight: s.weight ?? s.poa ?? 0, areaPct: s.areaPct })), teams: x.teams || null, pending: !!x.pending };
}
// fallback: /api/scenarios (every 60 s) + one /api/run/<sc> at a time (first engine run can take ~15 s), summarized and cached
let scenCache = null, scenAt = 0;
const runSum = {};            // sc -> { top3, teams, found, lastClock, liveFolded }
const runWant = {};           // sc -> live seq the cached summary is based on (refetch when the feed seq for sc grows)
const liveBySc = {};          // sc -> { seq, t } from /api/live or roster moves (mock)
let liveSeq = 0, runQueue = [], runBusy = null;   // runBusy = sc being computed
async function fallbackIncidents() {
  if (!scenCache || Date.now() - scenAt > 60000) {
    const a = await api("/api/scenarios"); scenAt = Date.now();
    scenCache = (Array.isArray(a) ? a : a.scenarios || []).map((s) => typeof s === "string" ? { name: s } : s).filter((s) => s.name && !/blind/i.test(s.name));
  }
  await pollLive();
  const out = scenCache.map((s) => {
    const sc = s.name, r = runSum[sc], lv = liveBySc[sc];
    if ((!r || (lv && lv.seq > (runWant[sc] || 0))) && !runQueue.includes(sc) && runBusy !== sc) runQueue.push(sc);
    return { sc, ...splitIncident(s.incident, sc), live: !!lv || !!(r && r.liveFolded), found: false, replayFound: !!(r && r.replayFound), mode: null, lastEventAt: lv ? lv.t : null,
      lastClock: r ? r.lastClock : s.startClock || null, top3: r ? r.top3 : [], teams: r ? r.teams : null, pending: !r };
  });
  pumpRuns();
  return out;
}
async function pumpRuns() {
  if (runBusy || !runQueue.length) return;
  const sc = runQueue.shift(), seq = (liveBySc[sc] || {}).seq || 0;
  runBusy = sc;
  try { const run = await api("/api/run/" + encodeURIComponent(sc)); runSum[sc] = summarize(run); }
  catch (e) { runSum[sc] = runSum[sc] || { top3: [], teams: null, found: false, lastClock: null, err: true }; }
  runWant[sc] = seq; runBusy = null;
  const x = !has.incidents && incidents.find((i) => i.sc === sc), r = runSum[sc];   // patch the shown card now, not at the next 5 s tick
  if (x) { Object.assign(x, { top3: r.top3, teams: r.teams, replayFound: !!r.replayFound, lastClock: r.lastClock || x.lastClock, pending: false }); x.live = x.live || !!r.liveFolded; render(); }
  setTimeout(pumpRuns, 300);   // stagger: never two engine runs at once from this page
}
function summarize(run) {
  // like /api/incidents: the "live moment" is the last step before the replay's scripted find
  const steps = run.steps || [], fi = steps.findIndex((s) => s.kind === "found"), last = steps[(fi > 0 ? fi : steps.length) - 1] || {};
  const segs = (last.segments || []).slice().sort((a, b) => b.poa - a.poa).slice(0, 3);
  const assigned = new Set((last.assignments || []).map((a) => a.resourceId));
  return { top3: segs.map((s) => ({ segmentId: s.id, name: s.name, weight: s.poa, areaPct: s.areaPct })), teams: { assigned: assigned.size, total: (last.resources || []).length },
    replayFound: fi >= 0, lastClock: last.t || null, liveFolded: (run.liveEventsFolded || 0) > 0 };
}
async function pollLive() {
  if (has.live === false && Date.now() < liveRetry) return;
  try {
    const f = await api("/api/live?since=" + liveSeq); has.live = true;
    for (const e of f.events || []) if (e.sc) liveBySc[e.sc] = { seq: e.seq, t: e.t };
    liveSeq = Math.max(liveSeq, f.seq || 0);
  } catch (e) { has.live = false; liveRetry = Date.now() + 60000; }
}

// ---------- scenario files (IPP, bbox, resources): /scenarios/<sc>.json, small, fetched once
const meta = {}, metaP = {};
// one request per scenario, and every caller waits for it: the first-paint skeleton and the first poll ask at the same time,
// and a caller that got null for an in-flight request rendered the cards without map dots until the next poll (5 s)
function loadMeta(sc) {
  return metaP[sc] ||= (async () => {
    meta[sc] = null;
    try { const s = await api("/scenarios/" + encodeURIComponent(sc) + ".json"); meta[sc] = { ipp: s.ipp && s.ipp.at, bbox: s.bbox, resources: s.resources || [] }; } catch (e) {}
    return meta[sc];
  })();
}

// ---------- team roster: real API or in-memory mock (same shapes as CONTRACT.md)
const KIND = { ground: "pieszy", dog: "pies", drone: "dron", heli: "smiglowiec", boat: "lodz", diver: "nurkowie" };
let mock = null;
function seedMock(scs) {
  const by = new Map();
  for (const sc of scs) for (const r of (meta[sc] && meta[sc].resources) || []) {
    if (!by.has(r.id)) by.set(r.id, { id: r.id, name: r.name, kind: KIND[r.type] || r.type, base: r.base || null, sc: null, segmentId: null, status: "wolny", home: [] });
    by.get(r.id).home.push(sc);
  }
  return [...by.values()];
}
async function loadTeams(scsP) {   // scsP: promise of incident ids, needed only by the mock
  if (tryReal("teams")) {
    try { const a = await api("/api/teams"); has.teams = true; return Array.isArray(a) ? a : a.teams || []; }
    catch (e) { if (e.status === 404) missing("teams"); else throw e; }
  }
  if (!mock || !mock.length) { const scs = await scsP; await Promise.all(scs.map(loadMeta)); mock = seedMock(scs); }
  return mock;
}
async function assignTeam(team, sc) {
  if (has.teams) return api("/api/teams/assign", { team, sc, by: "operator" });
  const t = mock.find((x) => x.id === team); if (!t) return mock;
  const old = t.sc, now = new Date().toISOString();
  t.sc = sc; t.segmentId = null; t.status = sc ? "w drodze" : "wolny";
  for (const s of [old, sc]) if (s) liveBySc[s] = { seq: ((liveBySc[s] || {}).seq || 0), t: now };   // a roster move makes the incident LIVE (contract)
  return mock;
}

// ---------- state + render
let incidents = [], teams = [], hl = null, dragging = false, fitted = false;
const kindLabel = (k) => ({ pieszy: "pieszy", pies: "pies", dron: "dron", smiglowiec: "śmigłowiec", lodz: "łódź", nurkowie: "nurkowie" }[k] || k || "zespół");
const ICON = {
  pieszy: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7v7m0 0-3 7m3-7 3 7M7 11l5-3 5 3"/>',
  pies: '<path d="M5 12h9l2-4 3 1-1 3v7M5 12v7M5 12 3 9m11 3v7"/>',
  dron: '<circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M7 8l3 3m4 0 3-3M7 16l3-3m4 0 3 3M10 10h4v4h-4z"/>',
  smiglowiec: '<path d="M3 5h18M12 5v3M5 12a5 4 0 0 0 5 4h6l3-4-3-3H9a4 3 0 0 0-4 3zM21 12h-2M9 19h8"/>',
  lodz: '<path d="M3 15h18l-3 4H6zM12 4v11M12 5l6 8h-6"/>',
  nurkowie: '<circle cx="9" cy="10" r="3"/><circle cx="15" cy="10" r="3"/><path d="M4 18c2-1 4-1 6 0s4 1 6 0 4-1 6 0"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k] || '<circle cx="12" cy="12" r="6"/>'}</svg>`;
// short names for the map labels and card headings (incident text is long and not always "title - place")
const SHORT = { zawrat: "Zawrat", "morskie-oko": "Morskie Oko", kasprowy: "Kasprowy Wierch", "bieszczady-wetlinska": "Połonina Wetlińska", "karkonosze-sniezka": "Śnieżka",
  sniardwy: "Śniardwy", morzycko: "Morzycko", miedzyzdroje: "Międzyzdroje", mamry: "Mamry", krakow: "Kraków", "krakow-nowa-huta": "Kraków - Nowa Huta", "night-test": "Test nocny",
  "tragedia-w-moryniu": "Tragedia w Moryniu", "rodzina-dziecko-las": "Karpacz - dziecko w lesie" };
const short = (x) => SHORT[x.sc] || (x.place && x.place !== x.sc ? x.place.split(/[,/]/)[0].trim() : x.sc);
const longText = (x) => [x.title, x.place !== x.sc ? x.place : ""].filter(Boolean).join(" - ");
const modeOf = (x) => x.found ? "found" : x.live ? "live" : x.mode === "plan" ? "plan" : "replay";   // a live find ends the incident
const BADGE = { live: "LIVE", found: "ZNALEZIONO", plan: "PLAN", replay: "ODTWORZENIE" };
const hhmm = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" }); };
function sortIncidents(a) {
  return a.slice().sort((x, y) => (y.live - x.live) || String(y.lastEventAt || "").localeCompare(String(x.lastEventAt || "")) || (x.found - y.found) || x.place.localeCompare(y.place, "pl"));
}
let shown = "";   // what the cards / roster / markers were last built from: a poll that brings nothing new touches no DOM
function render() {
  const sig = JSON.stringify([incidents, teams, Object.keys(meta).filter((k) => meta[k]).length, has.incidents, has.teams]);
  if (sig === shown) return;
  const selectOpen = $("teams").contains(document.activeElement) && document.activeElement.tagName === "SELECT";   // renderTeams skips then: build again next poll
  if (!dragging) { renderCards(); renderTeams(); if (!selectOpen) shown = sig; }
  renderMarkers();
  advApply();   // Doradca: re-mark linked incidents after the cards / markers were rebuilt
  const nLive = incidents.filter((x) => x.live && !x.found).length, nEnded = incidents.filter((x) => x.found).length;
  $("counts").innerHTML = `${incidents.length} akcji${nLive ? ` · <b style="color:var(--rl-danger)">${nLive} LIVE</b>` : ""}${nEnded ? ` · zakończone: ${nEnded}` : ""} · zespoły wolne: ${teams.filter((t) => !t.sc).length}/${teams.length}`;
  // data source only as a tooltip on the counts (review: no technical text in the header)
  $("counts").title = "Źródło danych: " + (has.incidents ? "GET /api/incidents" : "GET /api/scenarios + /api/run/<sc> (zapas)") + " · zespoły: " + (has.teams ? "GET /api/teams" : "makieta w przeglądarce");
}
function renderCards() {
  // current incidents first, ended ones (person found) below under their own heading
  const all = sortIncidents(incidents), cur = all.filter((x) => !x.found), done = all.filter((x) => x.found);
  const card = (x) => {
    const m = modeOf(x), mine = teams.filter((t) => t.sc === x.sc);
    const when = x.lastEventAt ? `ost. zdarzenie ${hhmm(x.lastEventAt)}` : x.lastClock ? `scenariusz ${esc(x.lastClock)}` : "";
    const rf = x.replayFound && !x.found ? `<span class="mute" title="Plik scenariusza kończy się odnalezieniem; tu pokazujemy moment przed nim">odtworzenie z odnalezieniem</span>` : "";
    return `<article class="card ${m} ${hl === x.sc ? "hl" : ""}" data-sc="${esc(x.sc)}" data-drop="${esc(x.sc)}">
      <div class="ctop"><span class="badge ${m}">${BADGE[m]}</span><span class="mute">${esc(x.sc)}</span><span class="when mono">${when}</span></div>
      <h3><a href="${openURL(x.sc)}">${esc(short(x))}</a></h3><div class="sub">${esc(longText(x))}${rf ? " · " + rf : ""}</div>
      ${x.top3.length ? `<div class="top3"><div class="lbl">Gdzie szukać najpierw${x.top3.every((s) => s.areaPct != null) ? ` · top 3 to ${areaTxt(x.top3.reduce((a, s) => a + (+s.areaPct || 0), 0))} obszaru` : ""}</div>${x.top3.map((s, k) => `<div class="seg"><span class="rk">${k + 1}</span><span class="nm">${esc(s.segmentId)} ${esc(s.name)}</span>${s.areaPct != null ? `<span class="mute">${areaTxt(s.areaPct)} obszaru</span>` : ""}</div>`).join("")}</div>`
        : `<div class="loading">${x.pending ? "Liczę mapę..." : "Brak mapy dla tej akcji."}</div>`}
      <div class="cteams">${x.teams ? `Zespoły z sektorem: <span class="n">${x.teams.assigned}/${x.teams.total}</span>` : ""}
        ${mine.map((t) => `<span class="chip" title="${esc(t.name)} · ${esc(t.status)}">${esc(t.id)}</span>`).join("")}
        <a class="odpr" href="odprawa.html?sc=${encodeURIComponent(x.sc)}" title="Odprawa kierownika akcji na jednej stronie A4">Odprawa (druk)</a></div>
      <div class="drophint">Upuść tutaj, aby dołączyć zespół do tej akcji</div></article>`;
  };
  $("cards").innerHTML = (all.length ? `<h2 class="cgrp">Trwające <span class="cnt">${cur.length}</span></h2>${cur.map(card).join("") || `<div class="help">Brak trwających akcji.</div>`}`
    + (done.length ? `<h2 class="cgrp done">Zakończone <span class="cnt">${done.length}</span></h2>${done.map(card).join("")}` : "") : `<div class="help">Brak akcji na serwerze.</div>`);
  $("cards").querySelectorAll(".card").forEach((el) => {
    el.onclick = (e) => { if (!e.target.closest("a")) location.href = openURL(el.dataset.sc); };
    el.onmouseenter = () => setHl(el.dataset.sc); el.onmouseleave = () => setHl(null);
  });
  wireDrops($("cards"));
}
function renderTeams() {
  if ($("teams").contains(document.activeElement) && document.activeElement.tagName === "SELECT") return;   // do not rebuild under an open select
  const list = sortIncidents(incidents);
  const opts = (cur) => `<option value="" ${!cur ? "selected" : ""}>wolny</option>` + list.map((x) => `<option value="${esc(x.sc)}" ${cur === x.sc ? "selected" : ""}>${esc(short(x))}</option>`).join("");
  const row = (t) => `<div class="team" draggable="true" data-team="${esc(t.id)}" title="${esc(t.name)}${t.home && t.home.length ? " · baza w: " + esc(t.home.join(", ")) : ""}">
      <span class="ic">${icon(t.kind)}</span><span class="nm">${esc(t.name)}</span>
      <span class="meta"><span>${esc(kindLabel(t.kind))}</span><span class="st ${t.status === "wolny" ? "wolny" : t.status === "w akcji" ? "akcja" : ""}">${esc(t.status || (t.sc ? "w drodze" : "wolny"))}${t.segmentId ? " " + esc(t.segmentId) : ""}</span>
      <select data-team="${esc(t.id)}" aria-label="Przydziel ${esc(t.name)} do akcji">${opts(t.sc)}</select></span></div>`;
  const grp = (sc, title, ts, extra = "") => `<section class="grp" data-drop="${esc(sc)}"><h3>${title} <span class="cnt">${ts.length}</span>${extra}</h3>${ts.map(row).join("") || `<div class="help">${sc ? "Brak zespołów - przeciągnij tutaj." : "Wszystkie zespoły pracują."}</div>`}</section>`;
  const free = teams.filter((t) => !t.sc);
  const busy = list.filter((x) => teams.some((t) => t.sc === x.sc));
  $("teams").innerHTML = grp("", "Wolne", free) + busy.map((x) => grp(x.sc, esc(short(x)), teams.filter((t) => t.sc === x.sc), modeOf(x) === "live" ? ' <span class="badge live">LIVE</span>' : "")).join("")
    || `<div class="help">Brak zespołów.</div>`;
  $("teams").querySelectorAll(".team").forEach((el) => {
    el.ondragstart = (e) => { e.dataTransfer.setData("text/plain", el.dataset.team); e.dataTransfer.effectAllowed = "move"; dragging = true; document.body.classList.add("dragging"); };
    el.ondragend = () => { dragging = false; document.body.classList.remove("dragging"); document.querySelectorAll(".over").forEach((o) => o.classList.remove("over")); };
  });
  $("teams").querySelectorAll("select").forEach((s) => s.onchange = () => doAssign(s.dataset.team, s.value || null));
  wireDrops($("teams"));
  // actor drawer (CONTRACT "Zasoby i dziennik"): click a team name -> its log and data feeds
  $("teams").querySelectorAll(".team .nm").forEach((n) => {
    n.style.cursor = "pointer"; n.title = "Dziennik i źródła danych";
    n.onclick = () => { const id = n.closest(".team").dataset.team, t = teams.find((x) => x.id === id); import("./actorlog.js").then((m) => m.openActor(id, { sc: (t && t.sc) || undefined })); };
  });
}
function wireDrops(root) {
  root.querySelectorAll("[data-drop]").forEach((el) => {
    el.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; el.classList.add("over"); };
    el.ondragleave = (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove("over"); };
    el.ondrop = (e) => { e.preventDefault(); el.classList.remove("over"); const id = e.dataTransfer.getData("text/plain"); if (id) doAssign(id, el.dataset.drop || null); };
  });
}
async function doAssign(team, sc) {
  const t = teams.find((x) => x.id === team);
  if (!t || (t.sc || null) === (sc || null)) return;
  try {
    const r = await assignTeam(team, sc); teams = Array.isArray(r) ? r : r.teams || teams;
    const x = incidents.find((i) => i.sc === sc);
    toast(sc ? `${t.name} -> ${x ? short(x) : sc}. Sektor wybierz w akcji.` : `${t.name}: zwolniony`);
    dragging = false; document.body.classList.remove("dragging");
    tick();
  } catch (e) { toast("Przydział nie został zapisany: " + e.message); }
}
function setHl(sc) {
  hl = sc;
  document.querySelectorAll(".card").forEach((el) => el.classList.toggle("hl", el.dataset.sc === sc));
  for (const [k, m] of markers) m.getElement().classList.toggle("hl", k === sc);
}

// ---------- map: paper ground + rough outline of Poland; regional offline basemaps (web/basemap) load when zoomed in
const POLAND = [[14.22,53.93],[15.0,54.2],[16.2,54.45],[17.0,54.7],[18.3,54.83],[18.6,54.43],[19.6,54.45],[20.8,54.35],[22.8,54.36],[23.5,54.0],[23.9,53.2],[23.6,52.6],[23.2,52.3],[23.6,52.08],[23.7,51.6],[24.1,50.8],[23.5,50.4],[22.7,49.6],[22.9,49.1],[22.0,49.2],[21.0,49.4],[20.4,49.38],[20.0,49.18],[19.6,49.4],[19.2,49.45],[18.85,49.5],[18.6,49.9],[18.0,50.05],[17.6,50.27],[16.9,50.45],[16.7,50.2],[16.2,50.6],[15.8,50.74],[15.5,50.8],[14.8,50.85],[14.95,51.4],[14.7,52.1],[14.55,52.6],[14.15,52.85],[14.4,53.3],[14.25,53.7],[14.22,53.93]];
let mapReady = false, map = null;
async function initMap() {
  const [m, b] = await Promise.all([import("../web/vendor/maplibre-gl.mjs"), import("../web/basemap/basemap.js")]);
  maplibregl = m; ({ offlineStyle, loadBasemap, REGIONS } = b);
  const base = offlineStyle();
  map = new maplibregl.Map({
    container: "map", attributionControl: { compact: true }, center: [19.4, 52.0], zoom: 5.3, minZoom: 4,
    style: { version: 8, glyphs: base.glyphs, sprite: base.sprite,
      sources: { pl: { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [POLAND] } } } },
      layers: [{ id: "bg", type: "background", paint: { "background-color": css("--rl-bg") } },
        { id: "pl-fill", type: "fill", source: "pl", maxzoom: 8, paint: { "fill-color": css("--rl-panel-solid"), "fill-opacity": 0.75 } },
        { id: "pl-line", type: "line", source: "pl", maxzoom: 8, paint: { "line-color": css("--rl-line-strong"), "line-width": 1.5 } }] },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  map.on("load", () => { mapReady = true; renderMarkers(); fitAll(); loadRegions(); stackLabels(); advMap(); });
  map.on("moveend", loadRegions);
  map.on("zoom", () => document.body.classList.toggle("zin", map.getZoom() >= 9));   // zoomed in: labels next to their own dots
  map.on("zoomend", stackLabels);
  map.on("resize", stackLabels);
}
const loaded = new Set();
async function loadRegions() {
  if (!mapReady || map.getZoom() < 7) return;
  const b = map.getBounds();
  for (const [id, r] of Object.entries(REGIONS)) {
    const [[w, s], [e, n]] = r.bounds;
    if (loaded.has(id) || e < b.getWest() || w > b.getEast() || n < b.getSouth() || s > b.getNorth()) continue;
    loaded.add(id);
    try {
      await loadBasemap(maplibregl, r.file);
      const st = offlineStyle({ file: r.file });
      map.addSource("pm-" + id, st.sources.protomaps);
      for (const l of st.layers) if (l.type !== "background") map.addLayer({ ...l, id: id + ":" + l.id, source: "pm-" + id, minzoom: Math.max(l.minzoom || 0, 7) }, "pl-line");
    } catch (err) { console.warn("basemap " + id, err); }
  }
}
const markers = new Map();
function renderMarkers() {
  if (!map) return;   // before initMap: the map's load handler renders them
  for (const x of incidents) {
    const md = meta[x.sc]; if (!md || !md.ipp) continue;
    let m = markers.get(x.sc);
    if (!m) {
      const el = document.createElement("div");
      el.innerHTML = `<span class="dot"></span><span class="lbl"></span>`;
      el.onclick = () => location.href = openURL(x.sc);
      el.onmouseenter = () => setHl(x.sc); el.onmouseleave = () => setHl(null);
      el.dataset.drop = x.sc;
      el.ondragover = (e) => { e.preventDefault(); el.classList.add("over"); };
      el.ondragleave = () => el.classList.remove("over");
      el.ondrop = (e) => { e.preventDefault(); el.classList.remove("over"); const id = e.dataTransfer.getData("text/plain"); if (id) doAssign(id, x.sc); };
      m = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([md.ipp[1], md.ipp[0]]).addTo(map);
      markers.set(x.sc, m);
    }
    const el = m.getElement(), mode = modeOf(x);
    el.classList.add("mk"); for (const c of ["live", "found", "plan", "replay"]) el.classList.toggle(c, c === mode); el.classList.toggle("hl", hl === x.sc);
    el.title = `${short(x)}: ${longText(x)} - ${BADGE[mode]} (kliknij, aby otworzyć; upuść zespół, aby dołączyć)`;
    el.querySelector(".lbl").textContent = short(x);
    el.style.zIndex = mode === "live" ? 3 : 1;
  }
  for (const [k, m] of markers) if (!incidents.some((x) => x.sc === k)) { m.remove(); markers.delete(k); }
  fitAll();
  stackLabels();
}
// Labels that would overlap on screen (Tatra and Bieszczady incidents sit a few km apart) move down one row at a time
// until they are free; dots stay on their IPP. Recomputed after every zoom, since overlaps depend on the scale.
function stackLabels() {
  if (!mapReady) return;
  const ROW = 24, items = [...markers.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const pts = items.map(([, m]) => map.project(m.getLngLat()));
  const boxes = pts.map((p) => ({ x: p.x - 9, y: p.y - 9, w: 18, h: 18 }));   // every dot is an obstacle for every label
  // each dot's own label row is reserved for it: a shifted label never lands next to another incident's dot
  const own = items.map(([, m], i) => { const l = m.getElement().querySelector(".lbl"); return { x: pts[i].x + 14, y: pts[i].y - 11, w: (l && l.offsetWidth) || 80, h: 22 }; });
  const order = [0, 1, -1, 2, -2];   // at most two rows from the dot, else the label would sit next to a different dot
  // live incidents first, so their labels win a contested spot
  const idx = items.map((_, i) => i).sort((a, b) => (items[b][1].getElement().classList.contains("live") - items[a][1].getElement().classList.contains("live")) || a - b);
  for (const i of idx) {
    const el = items[i][1].getElement(), lbl = el.querySelector(".lbl"), p = pts[i];
    const w = (lbl && lbl.offsetWidth) || 80, h = 22, x = p.x + 14;
    const over = (b, kk) => x < b.x + b.w && x + w > b.x && p.y - 11 + kk * ROW < b.y + b.h && p.y - 11 + kk * ROW + h > b.y;
    const hit = (kk) => boxes.some((b) => over(b, kk)) || own.some((b, j) => j !== i && over(b, kk));
    const k = order.find((kk) => !hit(kk));
    if (lbl) lbl.style.visibility = k === undefined ? "hidden" : "";   // no free row: dot only (name in the tooltip, shown again when zoomed in)
    if (k !== undefined) boxes.push({ x, y: p.y - 11 + k * ROW, w, h });
    el.style.setProperty("--k", k ?? 0);
  }
}
function fitAll() {
  if (fitted || !mapReady) return;
  const pts = incidents.map((x) => meta[x.sc] && meta[x.sc].ipp).filter(Boolean);
  if (!pts.length || pts.length < Math.min(incidents.length, 2)) return;
  const lons = pts.map((p) => p[1]), lats = pts.map((p) => p[0]);
  // narrow: labels sit right of their dot, so keep room on the right or the eastern names (Bieszczady, Kraków) are cut off
  const wide = innerWidth > 900, pad = wide ? { left: 400 + 40, right: 300 + 160, top: 100, bottom: 130 } : { left: 24, right: Math.min(150, innerWidth * 0.35), top: 30, bottom: 30 };
  map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: pad, maxZoom: 9, duration: 0 });
  fitted = pts.length >= incidents.length;
}

// an incident just ended (live ZNALEZIONO): banner for the operator, the server already released its teams
function announceEnded(x) {
  let el = document.getElementById("endedBanner");
  if (!el) { el = document.createElement("div"); el.id = "endedBanner"; el.setAttribute("role", "alert"); document.body.appendChild(el); el.onclick = () => el.remove(); }
  el.innerHTML = `<b>Akcja zakończona: ${esc(short(x))}</b> - osoba odnaleziona${x.lastEventAt ? " o " + hhmm(x.lastEventAt) : ""}. Zespoły wróciły do puli wolnych. <span class="mute">(kliknij, aby zamknąć)</span>`;
  try { if ("Notification" in window && Notification.permission === "granted") new Notification("Akcja zakończona: " + short(x), { body: "Osoba odnaleziona. Zespoły wolne." }); } catch (e) {}
}

// ---------- Doradca (advisor): do several incidents share one common source? GET /api/advisor (CONTRACT.md "Advisor").
// Rules answer first (fast, cached on the server, polled every 60 s), then the model's plain-Polish summary (?llm=1) once per
// page load and on the "Zapytaj model ponownie" click only - every ?llm=1 can cost a model call (the server keeps it 5 min).
// Map: river downstream of the source (navy), the stretch the wave has not reached yet (sand, TOPR red on alarm),
// plume cone, next towns with ETA; linked incidents ringed on the map and in the list.
let adv = null, advSel = 0, advOpen = true, advSig = "", advLlmAsked = false, advLlmBusy = false, advNarr = null, advNarrSig = "", advBusy = false, advMiss = 0;
const advTowns = [];
const num2 = (v) => (Math.round((v || 0) * 100) / 100).toFixed(2).replace(".", ",");
const LEVEL = { alarm: "ALARM", ostrzezenie: "OSTRZEŻENIE", obserwacja: "DO OBSERWACJI" };
try { advOpen = localStorage.getItem("rescue-advisor-open") === "1"; } catch (e) { advOpen = false; }   // demo review 3: starts as a slim bar, never over the incident dots
async function advTick() {
  if (advBusy || Date.now() < advMiss) return; advBusy = true;
  try {
    const a = await api("/api/advisor");
    const sig = JSON.stringify((a.hypotheses || []).map((h) => [h.id, h.score, h.incidents, h.evidence.map((e) => e.text)]));
    if (sig !== advSig) { advSig = sig; if (advSel >= (a.hypotheses || []).length) advSel = 0; }
    adv = a; advRender();
    if ((a.hypotheses || []).length && !advLlmAsked) advLlm();   // the model's version: once per page load, in the background
  } catch (e) { if (e.status === 404) advMiss = Date.now() + 60000; console.warn("advisor", e); }
  advBusy = false;
}
function advLlm() {
  if (advLlmBusy) return; advLlmAsked = advLlmBusy = true; advRender();
  const sig = advSig;
  api("/api/advisor?llm=1").then((b) => { if (b.narrative) { advNarr = b.narrative; advNarrSig = sig; } }).catch(() => {}).finally(() => { advLlmBusy = false; advRender(); });
}
function advRender() {
  const el = $("advisor"); if (!el || !adv) return;
  const hs = adv.hypotheses || [], h = hs[advSel];
  el.classList.toggle("alarm", !!hs.length && hs[0].level === "alarm");
  el.classList.toggle("closed", !advOpen);
  el.hidden = false;
  const head = `<header class="advh"><h2>Doradca <span class="mute">wspólne źródło zdarzeń · ${adv.incidents} akcji</span></h2>
    ${hs.length ? `<span class="lvl ${hs[0].level}">${LEVEL[hs[0].level]}</span>` : `<span class="lvl quiet">spokojnie</span>`}
    <button class="advt" type="button" aria-expanded="${advOpen}" title="${advOpen ? "Zwiń" : "Rozwiń"} panel Doradcy">${advOpen ? "Zwiń" : "Rozwiń"}</button></header>`;
  if (!hs.length) {
    el.innerHTML = head + (advOpen ? `<p class="help">${esc(adv.summary)}</p><p class="help mono">${esc(adv.method || "")}</p>` : "");
  } else {
    const tabs = hs.length > 1 ? `<div class="advtabs">${hs.map((x, i) => `<button type="button" data-i="${i}" class="${i === advSel ? "on" : ""}">${esc(x.id)}</button>`).join("")}</div>` : "";
    const name = (sc) => { const x = incidents.find((i) => i.sc === sc); return x ? short(x) : sc; };
    const bar = h.evidence.map((e) => `<i style="flex:${e.contribution}" title="${esc(e.id)} ${esc(e.label)}"></i>`).join("");
    const narr = (advNarrSig === advSig && advNarr) || adv.narrative || {};   // the model's text only for the state it was written for
    const by = narr.by && narr.by !== "rules" ? `model (${esc(narr.by === "llm-openai" ? "chmura" : "lokalny")})` : "reguły";
    const body = `
      <div class="advtop"><div><div class="kind" title="Dla operatora: wynik ${num2(h.score)} (0-1); ${esc(h.explain)}">${esc(h.kindLabel)}</div><h3>${esc(h.title)}</h3>
        ${h.altSources && h.altSources.length ? `<div class="mute alt">albo: ${h.altSources.map((s) => esc(s.name)).join(", ")} - zgłoszenia leżą poniżej obu, z samych zgłoszeń nie da się ich rozróżnić</div>` : ""}</div>
        </div>
      <button class="advfit" type="button">Pokaż na mapie</button>
      <div class="sbar" aria-label="Skład wyniku">${bar}</div>
      <div class="cols">
        <section><h4>Dlaczego (dowody)</h4><ol class="ev">${h.evidence.map((e) => `<li><span class="eid mono">${esc(e.id)}</span><span><b>${esc(e.label)}</b> ${esc(e.text)}</span></li>`).join("")}</ol>
          <h4>Powiązane akcje <span class="mute">(${h.incidents.length})</span></h4><div class="chips">${h.incidents.map((sc) => `<a class="chip adv" data-sc="${esc(sc)}" href="${openURL(sc)}">${esc(name(sc))}</a>`).join("")}</div>
          ${h.excluded && h.excluded.length ? `<h4>Nie powiązano</h4><ul class="exc">${h.excluded.map((x) => `<li data-sc="${esc(x.sc)}"><b>${esc(name(x.sc))}</b> - ${esc(x.reason)}</li>`).join("")}</ul>` : ""}</section>
        <section>${h.predicted ? `<h4>Prognoza</h4><p class="pred">${esc(h.predicted.text)}</p>${(h.predicted.towns || []).length ? `<table class="eta"><tr><th>Miejscowość</th><th>km rzeki</th><th>fala ok.</th><th>za</th></tr>${h.predicted.towns.map((t) => `<tr class="${t.kind === "town" ? "town" : ""}"><td>${esc(t.name)}</td><td class="mono">${String(t.km).replace(".", ",")}</td><td class="mono">${esc(t.eta)}</td><td class="mono">${t.inMin} min</td></tr>`).join("")}</table><div class="help">Czas od ostatniego zgłoszenia (${esc(h.predicted.from || "")}); prędkość fali ${String(h.predicted.speedMs || "").replace(".", ",")} m/s${h.wave && !h.wave.fitted ? " (domyślna, nie dopasowana)" : " (dopasowana do zgłoszeń)"}.</div>` : ""}` : ""}
          <h4>Zalecane działania</h4><ol class="act">${h.actions.map((a) => `<li class="${a.safety ? "safety" : ""}">${esc(a.text)}</li>`).join("")}</ol></section>
      </div>
      <section class="narr"><h4>Dla operatora <span class="mute">${by}</span></h4><p>${esc(narr.summary || "")}</p>
        ${(narr.questions || []).length ? `<div class="qs"><b>Zapytaj:</b><ul>${narr.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul></div>` : ""}
        ${narr.note ? `<div class="help">${esc(narr.note)}</div>` : ""}<button class="advllm" type="button" ${advLlmBusy ? "disabled" : ""}>${advLlmBusy ? "Model pisze..." : "Zapytaj model ponownie"}</button><div class="help">To hipoteza do sprawdzenia, nie potwierdzenie. Decyzja należy do kierownika akcji.</div></section>`;
    el.innerHTML = head + (advOpen ? tabs + body : `<p class="help one">${esc(h.title)} · ${h.incidents.length} akcji · <button class="advt2" type="button">Pokaż szczegóły</button></p>`);
    el.querySelectorAll(".advtabs button").forEach((b) => b.onclick = () => { advSel = +b.dataset.i; advRender(); advFit(); });
    el.querySelectorAll("[data-sc]").forEach((c) => { c.onmouseenter = () => setHl(c.dataset.sc); c.onmouseleave = () => setHl(null); });
    const fitB = el.querySelector(".advfit"), llmB = el.querySelector(".advllm");   // both absent while the panel is collapsed (Zwiń)
    if (fitB) fitB.onclick = advFit; if (llmB) llmB.onclick = advLlm;
  }
  const t2 = el.querySelector(".advt2"); if (t2) t2.onclick = () => el.querySelector(".advt").click();
  el.querySelector(".advt").onclick = () => { advOpen = !advOpen; try { localStorage.setItem("rescue-advisor-open", advOpen ? "1" : "0"); } catch (e) {} advRender(); };
  advApply(); advMap();
}
function advLinked() { const h = adv && (adv.hypotheses || [])[advSel]; return h ? new Set(h.incidents) : new Set(); }
function advApply() {
  const s = advLinked();
  document.querySelectorAll("#cards .card").forEach((c) => c.classList.toggle("adv", s.has(c.dataset.sc)));
  for (const [k, m] of markers) m.getElement().classList.toggle("adv", s.has(k));
}
const advEmpty = { type: "FeatureCollection", features: [] };
const line = (pts) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts.map((p) => [p[1], p[0]]) } });
function advMap() {
  if (!mapReady) return;
  if (!map.getSource("adv")) {
    for (const id of ["adv-river", "adv-ahead", "adv-plume"]) map.addSource(id, { type: "geojson", data: advEmpty });
    map.addLayer({ id: "adv-plume", type: "fill", source: "adv-plume", paint: { "fill-color": css("--rl-warn"), "fill-opacity": 0.35, "fill-outline-color": css("--rl-warn-ink") } });
    map.addLayer({ id: "adv-river", type: "line", source: "adv-river", paint: { "line-color": css("--rl-accent"), "line-width": 3, "line-opacity": 0.75 } });
    map.addLayer({ id: "adv-ahead", type: "line", source: "adv-ahead", paint: { "line-color": css("--rl-warn-ink"), "line-width": 5, "line-dasharray": [1.5, 1] } });
    map.addSource("adv", { type: "geojson", data: advEmpty });
  }
  const h = adv && (adv.hypotheses || [])[advSel], g = (h && h.geometry) || {};
  map.getSource("adv-river").setData(g.river ? line(g.river) : advEmpty);
  map.getSource("adv-ahead").setData(g.riverAhead && g.riverAhead.length > 1 ? line(g.riverAhead) : advEmpty);
  map.setPaintProperty("adv-ahead", "line-color", css(h && h.level === "alarm" ? "--rl-danger" : "--rl-warn-ink"));
  map.getSource("adv-plume").setData(g.plume && g.plume.length > 2 ? { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [g.plume.map((p) => [p[1], p[0]])] } } : advEmpty);
  while (advTowns.length) advTowns.pop().remove();
  const pins = [];
  if (h && h.source && h.source.at && h.source.kind !== "cluster") pins.push({ cls: "src", at: h.source.at, text: h.source.name });
  for (const t of (h && h.predicted && h.predicted.towns) || []) pins.push({ cls: t.kind === "town" ? "town" : "", at: t.at, text: `${t.name} ~${t.eta}` });
  for (const p of pins) {
    const el = document.createElement("div"); el.className = "advpin " + p.cls; el.innerHTML = `<span class="d"></span><span class="t">${esc(p.text)}</span>`;
    advTowns.push(new maplibregl.Marker({ element: el, anchor: "left" }).setLngLat([p.at[1], p.at[0]]).addTo(map));
  }
}
function advFit() {
  const h = adv && (adv.hypotheses || [])[advSel]; if (!h || !mapReady) return;
  const pts = [...(h.geometry.river || []), ...(h.geometry.plume || []), ...h.incidents.map((sc) => meta[sc] && meta[sc].ipp).filter(Boolean)];
  if (h.source && h.source.at) pts.push(h.source.at);
  if (!pts.length) return;
  const lons = pts.map((p) => p[1]), lats = pts.map((p) => p[0]);
  const wide = innerWidth > 900;
  map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: wide ? { left: 440, right: 340, top: 90, bottom: Math.round(innerHeight * 0.48) } : 30, maxZoom: 11, duration: 600 });
}
setInterval(advTick, 60000);
advTick();

// ---------- loop: every 5 s, never overlapping
let busy = false;
async function tick() {
  if (busy) return; busy = true;
  try {
    const wasFound = new Set(incidents.filter((x) => x.found).map((x) => x.sc)), first = !incidents.length;
    // teams and the incident list in parallel; on the first load the cards, map and roster show up from the fast
    // /api/scenarios while /api/incidents still computes every incident (cold server: 10-20 s)
    const incP = loadIncidents(), teamP = loadTeams(incP.then((a) => a.map((x) => x.sc)));
    if (first && has.incidents !== false) skeleton(teamP);
    const fresh = await incP;
    if (!first) for (const x of fresh) if (x.found && !wasFound.has(x.sc)) announceEnded(x);
    incidents = fresh; teams = await teamP;
    render();   // cards and roster now, map dots once the scenario files are in (render's signature counts them)
    Promise.all(fresh.map((x) => loadMeta(x.sc))).then(render);
  } catch (e) {
    console.warn(e);
    toast(e.status === 401 ? "Podaj PIN akcji (pole PIN u góry)." : "Brak połączenia z serwerem akcji - ponawiam co 5 s.");
  }
  busy = false;
}
// first paint: scenario list (titles, places) + scenario files (map dots) + roster, cards marked "liczę mapę" until the real data lands
async function skeleton(teamP) {
  try {
    const a = await api("/api/scenarios");
    const list = (Array.isArray(a) ? a : a.scenarios || []).map((s) => typeof s === "string" ? { name: s } : s).filter((s) => s.name && !/blind/i.test(s.name));
    if (incidents.length) return;   // /api/incidents was faster
    incidents = list.map((s) => ({ sc: s.name, ...splitIncident(s.incident, s.name), live: false, found: false, replayFound: false, mode: null, lastEventAt: null,
      lastClock: s.startClock || null, top3: [], teams: null, pending: true }));
    teams = await teamP.catch(() => teams);
    if (incidents.every((x) => x.pending)) render();
    Promise.all(list.map((s) => loadMeta(s.name))).then(render);   // map dots
  } catch (e) {}
}
setInterval(() => { $("clock").textContent = new Date().toLocaleTimeString("pl-PL"); }, 1000);
setInterval(tick, POLL_MS);
tick();
window.rescueCentrum = { get incidents() { return incidents; }, get teams() { return teams; }, has, doAssign, get map() { return map; } };   // tests
initMap().catch((e) => console.warn("[centrum] map", e));
