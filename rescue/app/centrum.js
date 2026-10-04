// Centrum - all incidents (scenarios / LIVE actions) on one view for the operator (kierownik akcji / dyspozytor).
// Overview map + incident cards + shared team roster (drag a team onto an incident). Click -> open the incident in the app.
// Data: GET /api/incidents + GET /api/teams + POST /api/teams/assign (CONTRACT.md "Live mode"). Until the server has them,
// the adapter below falls back to GET /api/scenarios + lazy GET /api/run/<sc> (+ GET /api/live if present) and an
// in-memory team roster mock seeded from the scenario files. Switching is automatic: a 404 means "not there yet".
// MapLibre (~300 kB) is imported dynamically (initMap at the bottom): cards and roster render from the API without waiting for it.
let maplibregl, offlineStyle, loadBasemap, REGIONS;
import { evKind, EV_COL, shortEv, hoverHold } from "./dock.js";
import { regionOf, pathText, MAP_DETAIL } from "./regions.js";   // naming "województwo → rejon → nazwa" + rivers / ranges / cities on the map (AI Mateusza #2)   // timeline (Oś czasu): same event kinds / colours / hover-hold as the /app dock

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// share of the search area, "1,8%" (no POA % on screen: najmocniejsze-funkcje.md "Czego NIE pokazywać", as in Akcja top 3)
const areaTxt = (a) => (+a || 0).toFixed(1).replace(".", ",") + "%";
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const POLL_MS = 10000;   // 10 s: /api/incidents + /api/teams per tick (perf round 3, wydajnosc.md)
// the card shows the live run (cursor time, e.g. "scenariusz 19:45"), so open Na żywo: the same moment and top 3 (demo review 2)
// pick mode (/app "Zmień scenariusz"): centrum.html?pick=1&return=<app url>; every link / dot then returns there with the chosen sc
// (the other params of /app, mode / view / role / time, stay as they were). Teams, Doradca panel and the timeline are hidden.
const PICK = new URLSearchParams(location.search).get("pick") === "1";
const PICK_BACK = (() => { try { const u = new URL(new URLSearchParams(location.search).get("return") || "./", location.href); if (u.origin === location.origin) return u; } catch (e) {} return new URL("./?role=operator", location.href); })();
const pickURL = (sc) => { const u = new URL(PICK_BACK); u.searchParams.set("sc", sc); return u.pathname + u.search + u.hash; };
// ?simAt=HH:MM (demo clock, livefeed.js nowMs) goes along to /app, so its bell runs on the same virtual clock (qa-wieczor #9)
const SIM_AT_Q = (() => { const v = new URLSearchParams(location.search).get("simAt"); return v ? `&simAt=${encodeURIComponent(v)}` : ""; })();
const openURL = (sc) => PICK ? pickURL(sc) : `./?role=operator&mode=akcja&time=live&sc=${encodeURIComponent(sc)}${SIM_AT_Q}`;
// embed (centrum.html?pick=1&embed=1, an iframe overlay in /app): no navigation at all, the choice goes to the parent as a
// postMessage (CONTRACT.md "Centrum pick mode, embedded"); the iframe stays alive and is reused, so polling pauses while hidden
const EMBED = PICK && new URLSearchParams(location.search).get("embed") === "1";
let pickHidden = false;
const pickPost = (m) => { if (m.type !== "rl-pick-ready") pickHidden = true; try { parent.postMessage(m, location.origin); } catch (e) {} };
const pickGo = (sc) => EMBED ? pickPost({ type: "rl-pick", sc }) : (location.href = openURL(sc));
function toast(t, ms = 3000) { const el = $("toast"); el.textContent = t; el.style.display = "block"; clearTimeout(toast.h); toast.h = setTimeout(() => el.style.display = "none", ms); }

// ---------- transport (PIN like app.js: loopback needs none)
const LOOPBACK = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(location.hostname);
{ const k = new URLSearchParams(location.search).get("key"); if (k) { try { localStorage.setItem("rescue-pin", k.trim()); } catch (e) {} const u = new URL(location.href); u.searchParams.delete("key"); history.replaceState(null, "", u); } }   // join link, as in app.js
let PIN = ""; try { PIN = (localStorage.getItem("rescue-pin") || "").replace(/^"(.*)"$/, "$1"); } catch (e) {}
if (!LOOPBACK) { $("pinbox").hidden = false; $("pin").value = PIN; $("pin").onchange = () => { PIN = $("pin").value.trim(); try { localStorage.setItem("rescue-pin", PIN); } catch (e) {} tick(); }; }
addEventListener("storage", (e) => { if (e.key === "rescue-pin" || e.key === null) { PIN = ((e.key ? e.newValue : null) || "").replace(/^"(.*)"$/, "$1").trim(); if (!LOOPBACK) $("pin").value = PIN; } });   // a key typed in /app or another tab
async function api(path, body) {
  const h = { "Content-Type": "application/json" }; if (!LOOPBACK && PIN) h["X-Rescue-Pin"] = PIN;
  const r = await fetch(path, body === undefined ? { headers: h, cache: "no-cache" } : { method: "POST", headers: h, body: JSON.stringify(body) });
  if (!r.ok) { const e = new Error(r.status === 401 ? (PIN ? "Klucz akcji jest nieprawidłowy: wpisz klucz kierownika akcji w polu Klucz." : "Podaj klucz akcji (pole Klucz u góry).") : r.status === 403 ? "To klucz ratownika: ta zmiana wymaga klucza kierownika akcji (pole Klucz u góry)." : "HTTP " + r.status); e.status = r.status; throw e; }
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
    try { const a = await api("/api/incidents?fast=1"); has.incidents = true; return (Array.isArray(a) ? a : a.incidents || []).filter((x) => !/blind|^morzycko$/i.test(x.sc)).map(normIncident); }
    catch (e) { if (e.status === 404) missing("incidents"); else throw e; }
  }
  return fallbackIncidents();
}
function normIncident(x) {
  return { sc: x.sc, title: x.title || "", place: x.place || x.sc, live: !!x.live, found: !!(x.ended ?? x.found), replayFound: !!x.replayFound, mode: x.mode || null, lastEventAt: x.lastEventAt || null,
    lastClock: x.at || x.lastClock || null, top3: (x.top3 || []).map((s) => ({ segmentId: s.segmentId, name: s.name, weight: s.weight ?? s.poa ?? 0, areaPct: s.areaPct })), teams: x.teams || null, pending: !!x.pending,
    startedAt: x.startedAt || null, endedAt: x.endedAt || null };   // timeline: the report and the end, ISO with the Warsaw offset (CONTRACT.md)
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
    scenCache = (Array.isArray(a) ? a : a.scenarios || []).map((s) => typeof s === "string" ? { name: s } : s).filter((s) => s.name && !/blind|^morzycko$/i.test(s.name));
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
    try { const s = await api("/scenarios/" + encodeURIComponent(sc) + ".json"); meta[sc] = { ipp: s.ipp && s.ipp.at, bbox: s.bbox, resources: s.resources || [],
      // timeline: report date + clock, scripted events (clock, provider, title), teams' readyAt
      date: s.date || null, startClock: s.startClock || null, lastContact: (s.subject && s.subject.lastContact) || null,
      incident: s.incident || "",
      events: (s.events || []).map((e) => ({ at: e.at, provider: e.provider, title: e.title || "" })),
      ready: (s.resources || []).filter((r) => r.readyAt).map((r) => ({ at: r.readyAt, name: r.name || r.id, id: r.id })) }; } catch (e) {}
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
  if (PICK) return [];   // pick mode: no roster, no /api/teams
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
  "tragedia-w-moryniu": "Tragedia w Moryniu", "rodzina-dziecko-las": "Karpacz - dziecko w lesie", "kajak-pieniny": "Pieniny - Dunajec",
  "auto-w-rzece-wizna": "Wizna - auto w Narwi",
  "grzybiarz-puszcza-notecka": "Puszcza Notecka - grzybiarz", "lawina-wolowiec": "Wołowiec - lawina",
  "senior-demencja-lodz": "Łódź - senior z demencją",
  "los-augustow": "Augustów - łoś na DW 664", "pozar-biebrza": "Biebrza - pożar",
  "paralotniarz-beskidy": "Skrzyczne - paralotniarz" };
const short = (x) => SHORT[x.sc] || (x.place && x.place !== x.sc ? x.place.split(/[,/]/)[0].trim() : x.sc);
const longText = (x) => [x.title, x.place !== x.sc ? x.place : ""].filter(Boolean).join(" - ");
// naming (AI Mateusza #2): "województwo → rejon → nazwa", e.g. "małopolskie → Tatry → Zaginiony turysta · Zawrat". Województwo and
// rejon from the IPP (regions.js regionOf); until the scenario file is in, just the name. x = incident or its sc (other modules:
// window.rescueCentrum.pathOf(sc), e.g. livefeed.js toasts). The map keeps short(x); the full path goes to tooltips.
const regOf = (x) => { const md = meta[x.sc]; return md && md.ipp ? regionOf(md.ipp) : null; };
const rpath = (x) => { const r = regOf(x); return r ? `${r.woj} → ${r.rejon}` : ""; };
function pathOf(x) {
  if (typeof x === "string") x = incidents.find((i) => i.sc === x) || { sc: x, title: "", place: (meta[x] && meta[x].incident) || x };
  const r = regOf(x), s = short(x), t = x.title ? x.title.charAt(0).toUpperCase() + x.title.slice(1) : "";
  return pathText(r, !t || s.includes(" - ") ? s : t + (r && s === r.rejon ? "" : " · " + s));   // "Wizna - auto w Narwi" already says what
}
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
  tlBuild();
  renderMarkers();
  tlApply();
  advApply();   // Doradca: re-mark linked incidents after the cards / markers were rebuilt
  const nLive = incidents.filter((x) => x.live && !x.found).length, nEnded = incidents.filter((x) => x.found).length;
  $("counts").innerHTML = `${akcje(incidents.length)}${nLive ? ` · <b style="color:var(--rl-danger)">${nLive} LIVE</b>` : ""}${nEnded ? ` · zakończone: ${nEnded}` : ""} · zespoły wolne: ${teams.filter((t) => !t.sc).length}/${teams.length}`;
  // data source only as a tooltip on the counts (review: no technical text in the header)
  $("counts").title = "Źródło danych: " + (has.incidents ? "GET /api/incidents" : "GET /api/scenarios + /api/run/<sc> (zapas)") + " · zespoły: " + (has.teams ? "GET /api/teams" : "makieta w przeglądarce");
}
function renderCards() {
  if (PICK) return renderPick();
  // current incidents first, ended ones (person found) below under their own heading
  const all = sortIncidents(incidents), cur = all.filter((x) => !x.found), done = all.filter((x) => x.found);
  const card = (x) => {
    const m = modeOf(x), mine = teams.filter((t) => t.sc === x.sc);
    const when = x.lastEventAt ? `ost. zdarzenie ${hhmm(x.lastEventAt)}` : x.lastClock ? `scenariusz ${esc(x.lastClock)}` : "";
    const rf = x.replayFound && !x.found ? `<span class="mute" title="Plik scenariusza kończy się odnalezieniem; tu pokazujemy moment przed nim">odtworzenie z odnalezieniem</span>` : "";
    return `<article class="card ${m} ${hl === x.sc ? "hl" : ""}" data-sc="${esc(x.sc)}" data-drop="${esc(x.sc)}">
      <div class="ctop"><span class="badge ${m}">${BADGE[m]}</span><span class="mute">${esc(x.sc)}</span><span class="when mono">${when}</span></div>
      ${rpath(x) ? `<div class="rpath">${esc(rpath(x))} →</div>` : ""}<h3><a href="${openURL(x.sc)}" title="${esc(pathOf(x))}">${esc(short(x))}</a></h3><div class="sub">${esc(longText(x))}${rf ? " · " + rf : ""}</div>
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
  document.querySelectorAll(".card, .pk").forEach((el) => el.classList.toggle("hl", el.dataset.sc === sc));
  for (const [k, m] of markers) m.getElement().classList.toggle("hl", k === sc);
  cluMark();
  document.querySelectorAll("#tl .tlr").forEach((el) => el.classList.toggle("hl", el.dataset.sc === sc));
}

// ---------- map: paper ground + outline of Poland; regional offline basemaps (web/basemap) load when zoomed in
// real border: Natural Earth 10m admin-0 (public domain), simplified to <=0.4 km (poland.json). The old hand-drawn 42-point outline
// was up to 25 km off and drew Śnieżka, Morskie Oko and Tarnica outside Poland.
const POLAND_URL = new URL("poland.json", import.meta.url).href;
let mapReady = false, map = null;
async function initMap() {
  const [m, b, pl] = await Promise.all([import("../web/vendor/maplibre-gl.mjs"), import("../web/basemap/basemap.js"),
    fetch(POLAND_URL).then((r) => r.json()).catch(() => ({ type: "FeatureCollection", features: [] }))]);   // 12 kB, in parallel with MapLibre
  maplibregl = m; ({ offlineStyle, loadBasemap, REGIONS } = b);
  const base = offlineStyle();
  map = new maplibregl.Map({
    container: "map", attributionControl: { compact: true, customAttribution: "Granica: Natural Earth · rzeki, pasma, miasta: uproszczone dane publiczne" }, center: [19.4, 52.0], zoom: 5.3, minZoom: 4,
    style: { version: 8, glyphs: base.glyphs, sprite: base.sprite,
      sources: { pl: { type: "geojson", data: pl }, "md-rivers": { type: "geojson", data: MAP_DETAIL.rivers }, "md-areas": { type: "geojson", data: MAP_DETAIL.areas }, "md-places": { type: "geojson", data: MAP_DETAIL.places }, "md-block": { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
      layers: [{ id: "bg", type: "background", paint: { "background-color": css("--rl-bg") } },
        { id: "pl-fill", type: "fill", source: "pl", maxzoom: 8, paint: { "fill-color": css("--rl-panel-solid"), "fill-opacity": 0.75 } },
        { id: "pl-line", type: "line", source: "pl", maxzoom: 8, paint: { "line-color": css("--rl-line-strong"), "line-width": 1.5 } },
        ...mapDetailLayers()] },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  map.on("load", () => { mapReady = true; renderMarkers(); fitAll(); loadRegions(); stackLabels(); advMap();
    map.getContainer().querySelector(".maplibregl-compact-show")?.classList.remove("maplibregl-compact-show"); });   // attribution as the (i) button: open, it covered Śniardwy on a phone
  map.on("moveend", loadRegions); map.on("moveend", () => advDeclutter());
  map.on("zoom", () => document.body.classList.toggle("zin", map.getZoom() >= 9));   // zoomed in: labels next to their own dots
  map.on("zoomend", stackLabels);
  map.on("resize", stackLabels);
}
// light map detail (regions.js MAP_DETAIL): main rivers, soft range / lake district labels, cities by rank; up to zoom 8, where
// the regional offline basemaps take over (their own labels collide with these, so no doubles)
function mapDetailLayers() {
  const ink = css("--rl-ink-2"), mute = css("--rl-mute"), halo = css("--rl-bg"), water = "#5b8db8";
  const rk = (n) => ["<=", ["get", "rank"], n];
  return [
    { id: "md-river", type: "line", source: "md-rivers", maxzoom: 8, layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": water, "line-opacity": 0.55, "line-width": ["interpolate", ["linear"], ["zoom"], 5, ["match", ["get", "rank"], 1, 1.4, 2, 1, 0.7], 8, ["match", ["get", "rank"], 1, 2.6, 2, 2, 1.6]] } },
    { id: "md-river-l", type: "symbol", source: "md-rivers", minzoom: 5.6, maxzoom: 8, filter: ["any", rk(2), [">=", ["zoom"], 6.8]],
      layout: { "symbol-placement": "line", "text-field": ["get", "name"], "text-font": ["Noto Sans Italic"], "text-size": 10.5, "symbol-spacing": 400, "text-max-angle": 30 },
      paint: { "text-color": water, "text-halo-color": halo, "text-halo-width": 1.4 } },
    { id: "md-area-l", type: "symbol", source: "md-areas", maxzoom: 8.5, filter: ["any", rk(1), [">=", ["zoom"], 6.3]],
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Italic"], "text-size": ["interpolate", ["linear"], ["zoom"], 5, 10.5, 8, 13], "text-letter-spacing": 0.18, "text-transform": "uppercase", "text-max-width": 8, "text-padding": 6 },
      paint: { "text-color": mute, "text-opacity": 0.75, "text-halo-color": halo, "text-halo-width": 1.2 } },
    { id: "md-place", type: "circle", source: "md-places", maxzoom: 8, filter: ["any", rk(1), ["all", rk(2), [">=", ["zoom"], 6.3]], [">=", ["zoom"], 7.2]],
      paint: { "circle-radius": ["match", ["get", "rank"], 1, 3, 2, 2.2, 1.8], "circle-color": css("--rl-panel-solid"), "circle-stroke-color": ink, "circle-stroke-width": ["match", ["get", "rank"], 1, 1.4, 1] } },
    { id: "md-place-l", type: "symbol", source: "md-places", maxzoom: 8, filter: ["any", rk(1), ["all", rk(2), [">=", ["zoom"], 6.3]], [">=", ["zoom"], 7.2]],
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Medium"], "text-size": ["match", ["get", "rank"], 1, 11.5, 10.5],
        "text-variable-anchor": ["left", "right", "top", "bottom"], "text-radial-offset": 0.55, "text-justify": "auto", "symbol-sort-key": ["get", "rank"] },
      paint: { "text-color": ink, "text-halo-color": halo, "text-halo-width": 1.4 } },
    // invisible copies of the incident dots and labels (HTML markers, stackLabels): on top, so city / range labels give way to them
    { id: "md-block", type: "symbol", source: "md-block", layout: { "text-field": ["get", "t"], "text-font": ["Noto Sans Medium"], "text-size": 12, "text-anchor": ["get", "a"],
      "text-offset": ["get", "o"], "text-padding": 3, "text-allow-overlap": true, "text-ignore-placement": false }, paint: { "text-opacity": 0 } },
  ];
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
      el.innerHTML = `<span class="ld"></span><span class="dot"></span><span class="lbl"></span>`;
      el.onclick = () => pickGo(x.sc);
      el.onmouseenter = () => setHl(x.sc); el.onmouseleave = () => setHl(null);
      el.dataset.drop = x.sc;
      el.ondragover = (e) => { e.preventDefault(); el.classList.add("over"); };
      el.ondragleave = () => el.classList.remove("over");
      el.ondrop = (e) => { e.preventDefault(); el.classList.remove("over"); const id = e.dataTransfer.getData("text/plain"); if (id) doAssign(id, x.sc); };
      m = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([md.ipp[1], md.ipp[0]]).addTo(map);
      markers.set(x.sc, m);
    }
    paintMarker(x, m);
  }
  for (const [k, m] of markers) if (!incidents.some((x) => x.sc === k)) { m.remove(); markers.delete(k); }
  fitAll();
  stackLabels();
}
// marker look for incident x: its mode now, or at the timeline cursor (markMode: "pre" = not reported yet -> hidden)
function paintMarker(x, m) {
  const el = m.getElement(), mode = markMode(x);
  el.classList.add("mk"); for (const c of ["live", "found", "plan", "replay", "pre", "idle"]) el.classList.toggle(c, c === mode); el.classList.toggle("hl", hl === x.sc);
  el.title = `${pathOf(x)}\n${longText(x)} - ${mode === "pre" ? "jeszcze nie zgłoszona" : BADGE[mode]} (kliknij, aby otworzyć; upuść zespół, aby dołączyć)`;
  el.querySelector(".lbl").textContent = short(x);
  el.style.zIndex = mode === "live" ? 3 : 1;
  if (el._mm !== undefined && el._mm !== mode) cluSoon();   // a dot appeared / changed status: its group's count and mix change
  el._mm = mode;   // timeline: tlApply repaints only the dots whose mode changed
}
// Clustering (AI Mateusza #2): dots closer than CLU_PX on screen merge into one marker with the count and the status mix
// (pie: live red, found green, the rest grey); hidden members (.inclu) keep their own marker and state (markMode stays the one
// source of a dot's mode). Recomputed with the labels after every zoom, resize, render and status change, so zooming in splits
// a group by itself; a click zooms to its members. Dots on the very same point (one IPP, several scenarios) open as a ring instead.
const CLU_PX = 24, clusters = new Map();   // key (sorted sc list) -> { m: Marker, scs }
let cluOpen = null, cluRaf = 0;            // { scs: Set, z }: an opened same-point group
function cluSoon() { if (!cluRaf && mapReady) cluRaf = requestAnimationFrame(() => { cluRaf = 0; stackLabels(); }); }
function clusterize() {
  if (cluOpen && map.getZoom() < cluOpen.z - 0.3) cluOpen = null;
  const live = (m) => m.getElement()._mm === "live";
  const order = [...markers.entries()].filter(([, m]) => m.getElement()._mm !== "pre").sort((a, b) => (live(b[1]) - live(a[1])) || a[0].localeCompare(b[0]));
  const pt = new Map(order.map(([k, m]) => [k, map.project(m.getLngLat())]));
  const isOpen = (k) => cluOpen && cluOpen.scs.has(k);
  const used = new Set(), groups = [];
  for (const [k] of order) {
    if (used.has(k)) continue;
    used.add(k); const g = [k], p = pt.get(k);
    if (!isOpen(k)) for (const [k2] of order) {
      if (used.has(k2) || isOpen(k2)) continue;
      const q = pt.get(k2); if (Math.hypot(p.x - q.x, p.y - q.y) < CLU_PX) { g.push(k2); used.add(k2); }
    }
    groups.push(g);
  }
  for (const [k, m] of markers) m.getElement().classList.add("inclu");   // reset below: solo dots shown again
  // opened same-point group: a ring of 34 px around the point
  const open = cluOpen ? [...cluOpen.scs].filter((k) => markers.has(k)).sort() : [];
  for (const [k, m] of markers) { const i = open.indexOf(k), a = i / open.length * 2 * Math.PI - Math.PI / 2; m.setOffset(i >= 0 && open.length > 1 ? [Math.cos(a) * 34, Math.sin(a) * 34] : [0, 0]); }
  const keep = new Set();
  for (const g of groups) {
    if (g.length < 2) { markers.get(g[0]).getElement().classList.remove("inclu"); continue; }
    const key = g.slice().sort().join("|"); keep.add(key);
    let c = clusters.get(key);
    if (!c) {
      const el = document.createElement("div"); el.className = "mk clu";
      el.innerHTML = `<span class="ld"></span><span class="dot"><b></b></span><span class="lbl"></span>`;
      el.tabIndex = 0; el.setAttribute("role", "button");
      el.onclick = () => cluClick(g);
      el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cluClick(g); } };
      el.onmouseenter = () => { for (const k of g) document.querySelectorAll(`.card[data-sc="${CSS.escape(k)}"], .pk[data-sc="${CSS.escape(k)}"], #tl .tlr[data-sc="${CSS.escape(k)}"]`).forEach((e) => e.classList.add("hl")); };
      el.onmouseleave = () => setHl(hl);
      const ll = g.map((k) => markers.get(k).getLngLat());
      c = { scs: g, m: new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([ll.reduce((a, p) => a + p.lng, 0) / ll.length, ll.reduce((a, p) => a + p.lat, 0) / ll.length]).addTo(map) };
      clusters.set(key, c);
    }
    cluPaint(c);
  }
  for (const [k, c] of clusters) if (!keep.has(k)) { c.m.remove(); clusters.delete(k); }
  cluMark();
}
function cluPaint(c) {
  const el = c.m.getElement(), n = { live: 0, found: 0, other: 0 };
  for (const k of c.scs) { const md = markers.get(k).getElement()._mm; n[md === "live" ? "live" : md === "found" ? "found" : "other"]++; }
  const N = c.scs.length, a = n.live / N * 360, b = a + n.found / N * 360;
  el.querySelector(".dot").style.background = `conic-gradient(var(--rl-danger) 0 ${a}deg, var(--rl-ok) ${a}deg ${b}deg, var(--rl-ink-2) ${b}deg)`;
  el.querySelector("b").textContent = N;
  el.classList.toggle("live", n.live > 0);
  el.style.zIndex = n.live ? 4 : 2;
  const xs = c.scs.map((k) => incidents.find((i) => i.sc === k)).filter(Boolean);
  const rj = [...new Set(xs.map((x) => (regOf(x) || {}).rejon || short(x)))];
  el.querySelector(".lbl").textContent = (rj.length === 1 ? rj[0] : rj.slice(0, 2).join(" / ") + (rj.length > 2 ? " …" : "")) + ` · ${N}`;
  el.title = `${N} akcji${n.live ? `, ${n.live} LIVE` : ""}${n.found ? `, ${n.found} znaleziono` : ""} (kliknij, aby przybliżyć)\n` + xs.map((x) => "• " + pathOf(x)).join("\n");
  el.setAttribute("aria-label", `Grupa ${N} akcji: ${rj.join(", ")}`);
}
function cluMark() {   // hl / adv ring of a group = any member's
  for (const [, c] of clusters) {
    const el = c.m.getElement(), mem = c.scs.map((k) => markers.get(k)?.getElement()).filter(Boolean);
    el.classList.toggle("hl", mem.some((e) => e.classList.contains("hl")));
    el.classList.toggle("adv", mem.some((e) => e.classList.contains("adv")));
  }
}
function cluClick(g) {
  const ll = g.map((k) => markers.get(k).getLngLat()), lons = ll.map((p) => p.lng), lats = ll.map((p) => p.lat);
  const span = Math.max(Math.max(...lons) - Math.min(...lons), Math.max(...lats) - Math.min(...lats));
  if (span < 0.003 || map.getZoom() >= 14) { cluOpen = { scs: new Set(g), z: map.getZoom() }; stackLabels(); return; }
  const wide = innerWidth > 900;
  map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: wide ? { left: 460, right: 360, top: 140, bottom: 200 } : 60, maxZoom: 15, duration: 600 });
}
// Labels that would overlap on screen (Tatra and Bieszczady incidents sit a few km apart) move down one row at a time
// until they are free; dots stay on their IPP. Recomputed after every zoom, since overlaps depend on the scale.
// With the clustering only what is on screen takes part: single dots and the groups.
function stackLabels() {
  if (!mapReady) return;
  clusterize();
  const ROW = 24, items = [...[...markers.entries()].filter(([, m]) => { const e = m.getElement(); return e._mm !== "pre" && !e.classList.contains("inclu"); }),
    ...[...clusters.entries()].map(([k, c]) => [k, c.m])].sort((a, b) => a[0].localeCompare(b[0]));
  const pts = items.map(([, m]) => { const p = map.project(m.getLngLat()), o = m.getOffset(); return { x: p.x + o.x, y: p.y + o.y }; });
  const block = [];   // -> md-block layer (map labels make room for the incident labels)
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
    // a label moved off its row gets a line from its own dot (centre 8,8) to the start of its 8 px tick (14, row middle):
    // without it a label 1-2 rows away read as the neighbour's name (Huzele next to Kraków, Zawrat under Morskie Oko)
    const ld = el.querySelector(".ld");
    if (lbl && k !== undefined) { const ll = items[i][1].getLngLat(), c = el.classList.contains("clu"); block.push([ll, "MM", "center", [0, 0]], [ll, lbl.textContent + "··", "left", [(c ? 19 : 14) / 12, (k * ROW + (c ? 1 : 0)) / 12]]); }
    if (ld) { const dx = el.classList.contains("clu") ? 11 : 6, dy = (k ?? 0) * ROW + 1, len = Math.hypot(dx, dy); ld.style.display = k ? "block" : "none"; ld.style.width = len + "px"; ld.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`; }
  }
  advDeclutter();
  map.getSource("md-block")?.setData({ type: "FeatureCollection", features: block.map(([ll, t, a, o]) => ({ type: "Feature", properties: { t, a, o }, geometry: { type: "Point", coordinates: [ll.lng, ll.lat] } })) });
}
function fitAll() {
  if (fitted || !mapReady) return;
  const pts = incidents.map((x) => meta[x.sc] && meta[x.sc].ipp).filter(Boolean);
  if (!pts.length || pts.length < Math.min(incidents.length, 2)) return;
  const lons = pts.map((p) => p[1]), lats = pts.map((p) => p[0]);
  // narrow: labels sit right of their dot, so keep room on the right or the eastern names (Bieszczady, Kraków) are cut off
  const wide = innerWidth > 900, pad = wide ? { left: 400 + 40 + (PICK ? 40 : 0), right: PICK ? 160 : 300 + 160, top: 100, bottom: 130 } : { left: 24, right: Math.min(150, innerWidth * 0.35), top: 30, bottom: 30 };
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
const akcje = (n) => { n = +n || 0; const d = n % 10, t = n % 100; return n + (n === 1 ? " akcja" : d >= 2 && d <= 4 && (t < 12 || t > 14) ? " akcje" : " akcji"); };   // Polish plural (QA #8: "2 akcji")
const num2 = (v) => (Math.round((v || 0) * 100) / 100).toFixed(2).replace(".", ",");
const LEVEL = { alarm: "ALARM", ostrzezenie: "OSTRZEŻENIE", obserwacja: "DO OBSERWACJI" };
try { advOpen = localStorage.getItem("rescue-advisor-open") === "1"; } catch (e) { advOpen = false; }   // demo review 3: starts as a slim bar, never over the incident dots
// Symulacja 24/7 (#1): only incidents running or just ended at the virtual clock (sim.view) count - a hypothesis shows once at
// least 2 of its incidents have started, with those only; the model's text was written for all of them, so it is not shown then
let advRaw = null, advSimSig = "";
function advView(a) {
  if (!a || !simOn()) return a;
  const act = new Set(sim.view.map((i) => i.sc)), all = a.hypotheses || [];
  const hs = all.map((h) => ({ ...h, incidents: h.incidents.filter((sc) => act.has(sc)) })).filter((h) => h.incidents.length >= 2);
  const trim = hs.length !== all.length || hs.some((h, k) => h.incidents.length !== all.find((x) => x.id === h.id).incidents.length);
  if (advSel >= hs.length) advSel = 0;
  return { ...a, hypotheses: hs, incidents: act.size, simTrim: trim,
    summary: hs.length ? a.summary : "Symulacja 24/7: wśród trwających akcji Doradca nie widzi teraz wspólnego źródła. Powiązania pokaże, gdy wystartują co najmniej 2 zdarzenia z jednej przyczyny." };
}
function advSimRefresh() {   // sim.view changed which incidents are running: re-filter without a new GET
  const sig = simOn() ? [...new Set(sim.view.map((i) => i.sc))].sort().join(",") : "off";
  if (sig === advSimSig || !advRaw) { advSimSig = sig; return; }
  advSimSig = sig; adv = advView(advRaw); advRender(); if (PICK) renderPick(); else { tlBuild(); tlApply(); }
}
async function advTick() {
  if (advBusy || Date.now() < advMiss || (EMBED && pickHidden)) return; advBusy = true;
  try {
    const a = await api("/api/advisor");
    const sig = JSON.stringify((a.hypotheses || []).map((h) => [h.id, h.score, h.incidents, h.evidence.map((e) => e.text)]));
    if (sig !== advSig) { advSig = sig; if (advSel >= (a.hypotheses || []).length) advSel = 0; }
    advRaw = a; adv = advView(a); advRender(); if (PICK) renderPick(); else { tlBuild(); tlApply(); }   // timeline: hypothesis brackets
    if ((a.hypotheses || []).length && !advLlmAsked && !PICK) advLlm();   // the model's version: once per page load, in the background
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
  const head = `<header class="advh"><h2>Doradca <span class="mute">wspólne źródło zdarzeń · ${akcje(adv.incidents)}</span></h2>
    ${hs.length ? `<span class="lvl ${hs[0].level}">${LEVEL[hs[0].level]}</span>` : `<span class="lvl quiet">spokojnie</span>`}
    <button class="advt" type="button" aria-expanded="${advOpen}" title="${advOpen ? "Zwiń" : "Rozwiń"} panel Doradcy">${advOpen ? "Zwiń" : "Rozwiń"}</button></header>`;
  if (!hs.length) {
    el.innerHTML = head + (advOpen ? `<p class="help">${esc(adv.summary)}</p><p class="help mono">${esc(adv.method || "")}</p>` : "");
  } else {
    const tabs = hs.length > 1 ? `<div class="advtabs">${hs.map((x, i) => `<button type="button" data-i="${i}" class="${i === advSel ? "on" : ""}">${esc(x.id)}</button>`).join("")}</div>` : "";
    const name = (sc) => { const x = incidents.find((i) => i.sc === sc); return x ? short(x) : sc; };
    const bar = h.evidence.map((e) => `<i style="flex:${e.contribution}" title="${esc(e.id)} ${esc(e.label)}"></i>`).join("");
    const narr = adv.simTrim ? { summary: "Symulacja 24/7: opis modelu dotyczy pełnego zestawu akcji, część jeszcze się nie zaczęła - liczą się dowody powyżej.", by: "rules" } : (advNarrSig === advSig && advNarr) || adv.narrative || {};   // the model's text only for the state it was written for
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
    el.innerHTML = head + (advOpen ? tabs + body : advCollapsedHTML(hs, h));   // collapsed: every alarm hypothesis (#1 block)
    el.querySelectorAll(".advtabs button, .advrow").forEach((b) => b.onclick = () => { advSel = +b.dataset.i; advRender(); advFit(); });
    el.querySelectorAll("[data-sc]").forEach((c) => { c.onmouseenter = () => setHl(c.dataset.sc); c.onmouseleave = () => setHl(null); });
    const fitB = el.querySelector(".advfit"), llmB = el.querySelector(".advllm");   // both absent while the panel is collapsed (Zwiń)
    if (fitB) fitB.onclick = advFit; if (llmB) llmB.onclick = advLlm;
  }
  const t2 = el.querySelector(".advt2"); if (t2) t2.onclick = () => el.querySelector(".advt").click();
  el.querySelector(".advt").onclick = () => { advOpen = !advOpen; try { localStorage.setItem("rescue-advisor-open", advOpen ? "1" : "0"); } catch (e) {} advRender(); };
  advApply(); advMap();
}
function advLinked() { if (PICK) return new Set(((adv && adv.hypotheses) || []).flatMap((h) => h.incidents)); const h = adv && (adv.hypotheses || [])[advSel]; return h ? new Set(h.incidents) : new Set(); }
function advApply() {
  const s = advLinked();
  document.querySelectorAll("#cards .card").forEach((c) => c.classList.toggle("adv", s.has(c.dataset.sc)));
  for (const [k, m] of markers) m.getElement().classList.toggle("adv", s.has(k));
  cluMark();
  if (PICK) pickMarkers();
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
    el.title = p.text;
    advTowns.push(new maplibregl.Marker({ element: el, anchor: "left", offset: [p.cls === "src" ? -6 : -4, 0] }).setLngLat([p.at[1], p.at[0]]).addTo(map));
  }
  advDeclutter();
}
// Doradca pins (source, towns with ETA) vs the incident dots and labels (qa-wieczor #11: "Linia kolejowa nr 96" lay over Huzele
// and ran off a phone screen): a pin's text goes left of its dot when the right side is taken or off the map, else it hides
// (the dot stays; the text is in the Doradca panel). Incident labels win: they are placed first (stackLabels).
function advDeclutter() {
  if (!mapReady || !advTowns.length) return;
  const box = map.getContainer().getBoundingClientRect(), taken = [];
  for (const e of map.getContainer().querySelectorAll(".mk:not(.inclu):not(.pre) .dot, .mk:not(.inclu):not(.pre) .lbl")) {
    if (e.style.visibility === "hidden") continue; const r = e.getBoundingClientRect(); if (r.width) taken.push(r);
  }
  const hit = (r) => r.left < box.left + 2 || r.right > box.right - 2 || taken.some((t) => r.left < t.right && r.right > t.left && r.top < t.bottom && r.bottom > t.top);
  for (const m of advTowns.slice().sort((a, b) => b.getElement().classList.contains("src") - a.getElement().classList.contains("src"))) {
    const el = m.getElement(), t = el.querySelector(".t");
    el.classList.remove("flip", "notext");
    let r = t.getBoundingClientRect();
    if (hit(r)) { el.classList.add("flip"); r = t.getBoundingClientRect(); if (hit(r)) { el.classList.remove("flip"); el.classList.add("notext"); continue; } }
    taken.push(r);
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

// ---------- Oś czasu (timeline, AI Mateusza #2 2026-10-04): when every incident STARTED and ENDED, a Gantt row each.
// Derived client-side, read-only, from each scenario file (loadMeta: date + startClock = the report, events[].at, resources[].readyAt)
// and /api/incidents (found = a live find ended it, at = the live moment). Nothing per sc is hardcoded: a new scenario file shows up
// by itself. Start = date + startClock; end = the file's "Found" event, or the live moment of a live find (zakończona); else the
// bar is open (trwa). Cursor (scrub / ▶ 1x-30x, 1x = 1 minute per second) re-paints the map dots: hidden before the report, red
// while it runs, green after the end; cards get "T+1:20: trwa". "Na żywo" = no cursor, the normal live view. Two axes: "od zgłoszenia"
// (every incident at T0) and "czas rzeczywisty" (date + clock); default = real time when all reports fall within 24 h.
// Collapsed = a thin strip with the cursor; hover (dock.js hoverHold, held 3 s) = full Gantt. Phone: a button instead of hover.
const PROV_KIND = { Found: "found", SegmentSearched: "searched", DronePassEmpty: "searched", Weather: "weather", WeatherConditions: "conditions",
  Terrain: "terrain", TerrainDifficulty: "difficulty", KoesterRings: "rings", TripPlan: "route", WaterDrift: "route", TrailheadCar: "containment", Cell112Fix: "sector", RatunekPing: "fix", Clue: "clue" };
const toMin = (c) => { const m = /^(\d{1,2}):(\d{2})/.exec(c || ""); return m ? +m[1] * 60 + +m[2] : null; };
const TL_SPEEDS = [1, 2, 5, 10, 30, 60];
const tl = { mode: null, auto: true, cur: null, speed: 1, play: 0, items: [], by: {}, off: new Set(), day: null, lo: 0, hi: 60, built: "" };
try { const v = +localStorage.getItem("rescue-centrum-tl-speed"); if (TL_SPEEDS.includes(v)) tl.speed = v; } catch (e) {}
// axis value of an incident's report: "abs" = real date + clock, "day" = its slot on the show day (tlDaySlots), "rel" = T0 for all.
// Everything else (state at the cursor, #1's Historia clock tlClockAt) works on v - tlBase(it) = minutes since the REAL report.
const tlBase = (it) => tl.mode === "abs" ? it.t0 : tl.mode === "day" ? (it.d ?? 0) : 0;
const TL_DAY_NOTE = "układ pokazowy - godziny przesunięte, czasy zdarzeń w akcjach bez zmian";
// "Dzień w Centrum": every incident on ONE synthetic day. Units = a Doradca hypothesis or the same first word of the id
// (zapora-*, mazury-burza-*, dywersja-poprad*) within 24 h of real time; a unit keeps its members' REAL relative offsets, so the
// hypotheses still line up. Units sorted by the real report, starts spread over 06:00-20:00 (overlapping like a busy day).
// Durations and the events inside each incident stay as they are; only the report moves.
function tlDaySlots(its, hyps) {
  const key = {};
  for (const it of its) key[it.sc] = it.sc.split("-")[0];
  for (const h of hyps) { const k = h.scs.map((sc) => key[sc]).find(Boolean); if (k) { const old = new Set(h.scs.map((sc) => key[sc])); for (const sc in key) if (old.has(key[sc])) key[sc] = k; } }
  const by = {}; for (const it of its) (by[key[it.sc]] ||= []).push(it);
  const units = [];
  for (const g of Object.values(by)) {
    g.sort((a, b) => a.t0 - b.t0 || a.sc.localeCompare(b.sc));
    let u = null; for (const it of g) { if (!u || it.t0 - u[0].t0 > 1440) units.push(u = []); u.push(it); }
  }
  units.sort((a, b) => a[0].t0 - b[0].t0 || a[0].sc.localeCompare(b[0].sc));
  units.forEach((u, i) => { const s = units.length > 1 ? 360 + Math.round(i * 840 / (units.length - 1)) : 600; for (const it of u) it.d = s + (it.t0 - u[0].t0); });
}
function tlItem(x) {
  // start / end: /api/incidents startedAt / endedAt (server, Europe/Warsaw offset). Without them (fallback list, older server)
  // the same rule from the scenario file: start = date + startClock, end = the live find (at), else the file's find event.
  const api0 = x.startedAt ? Date.parse(x.startedAt) / 60000 : NaN, sa = isFinite(api0) ? new Date(api0 * 60000) : null;
  // scenario file not in (yet): the bar from the API alone, no markers
  const md = meta[x.sc] || (sa && { startClock: pad2(sa.getHours()) + ":" + pad2(sa.getMinutes()), date: x.startedAt.slice(0, 10), events: [], ready: [] });
  const s0 = md && toMin(md.startClock); if (s0 == null) return null;
  const off = (c) => { const m = toMin(c); if (m == null) return null; let d = m - s0; if (d < -180) d += 1440; return d; };   // past midnight
  const t0 = isFinite(api0) ? api0 : new Date(`${md.date || "2026-10-04"}T${md.startClock.slice(0, 5).padStart(5, "0")}:00`).getTime() / 60000;
  if (!isFinite(t0)) return null;
  const evs = [];
  for (const e of md.events || []) {
    const m = off(e.at), kind = PROV_KIND[e.provider] || "clue", k = evKind({ kind, source: e.provider, label: e.title });
    if (m != null && k !== "baza") evs.push({ m, at: e.at, k, kind, title: e.title || e.provider, prov: e.provider });
  }
  for (const r of md.ready || []) { const m = off(r.at); if (m != null && m >= 0) evs.push({ m, at: r.at, k: "zespol", kind: "dispatch", title: `${r.name}: na miejscu / gotowy`, team: r.id }); }
  evs.sort((a, b) => a.m - b.m);
  const f = evs.find((e) => e.k === "found"), now = off(x.lastClock), last = Math.max(0, now ?? 0, ...evs.map((e) => e.m));
  let end = null, endKind = null;
  const apiEnd = x.endedAt && isFinite(api0) ? Math.round(Date.parse(x.endedAt) / 60000 - api0) : NaN;
  if (isFinite(apiEnd) && apiEnd >= 0) { end = apiEnd; endKind = x.found ? "ended" : "found"; }
  else if (x.found) { end = now ?? (f ? f.m : last); endKind = "ended"; }   // a live ZNALEZIONO: zakończona
  else if (f) { end = f.m; endKind = "found"; }                       // the scenario file ends with a find: znaleziono
  // last contact (subject.lastContact) comes before the report: a faint lead-in on the bar and "ostatni kontakt" in the feed
  let lc = toMin(md.lastContact); if (lc != null) { lc -= s0; if (lc > 0) lc -= 1440; if (lc < -1440 || lc === 0) lc = null; }
  // the incident's own teams (scenario file): on site from readyAt (or the report), for the team pool at the cursor
  const res = (md.resources || []).map((r) => ({ id: r.id, m: r.readyAt ? Math.max(0, off(r.readyAt) ?? 0) : 0 }));
  return { sc: x.sc, x, t0, end, endKind, last: Math.max(last, end ?? 0), evs, start: md.startClock, date: md.date, lastContact: md.lastContact, lc, res };
}
function tlState(it, v) { const o = v - tlBase(it); return o < 0 ? "pre" : it.end != null && o >= it.end ? it.endKind : "live"; }
function markMode(x) {
  if (simMarks()) return simMarkMode(x.sc);   // Symulacja 24/7: the dot follows the scheduled occurrences (block at the end)
  const it = tl.cur != null && !tl.off.has(x.sc) && tl.by[x.sc];
  if (!it) return modeOf(x);
  const s = tlState(it, tl.cur); return s === "pre" ? "pre" : s === "live" ? "live" : "found";
}
const pad2 = (n) => String(n).padStart(2, "0");
function tlFmt(v, axis) {
  if (tl.mode === "rel") { const a = Math.round(Math.abs(v)); return (v < 0 ? "T-" : "T+") + Math.floor(a / 60) + ":" + pad2(a % 60); }
  if (tl.mode === "day" || tl.mode === "sim") { const m = ((Math.floor(v) % 1440) + 1440) % 1440; return pad2(Math.floor(m / 60)) + ":" + pad2(m % 60); }
  const d = new Date(v * 60000), hm = pad2(d.getHours()) + ":" + pad2(d.getMinutes()), dm = d.getDate() + "." + pad2(d.getMonth() + 1);
  return axis === "day" ? dm : axis === "hm" ? hm : dm + " " + hm;
}
const TL_STATE = { pre: "jeszcze nie zgłoszona", live: "trwa", found: "znaleziono", ended: "zakończona" };
// story at the cursor (#2): a short feed of what happened in Centrum, the active-incident count, the team pool, Doradca's
// hypotheses bracketing their incidents' rows. Setup events of a file (terrain, rings, start weather) are not news.
const TL_SETUP = new Set(["Terrain", "TerrainDifficulty", "KoesterRings", "Weather"]);
function tlHyps() {   // Doradca hypotheses (GET /api/advisor), best first: their incidents share one source
  return ((adv && adv.hypotheses) || []).map((h) => ({ id: h.id, level: h.level, title: h.title, kind: h.kindLabel, scs: h.incidents || [] }));
}
function tlBuild() {
  let its = incidents.map(tlItem).filter(Boolean).sort((a, b) => a.t0 - b.t0 || a.sc.localeCompare(b.sc));
  tl.items = its; tl.by = Object.fromEntries(its.map((i) => [i.sc, i]));
  if (tl.auto) tl.mode = simOn() ? "sim" : "day";   // default: Dzień w Centrum (Mateusz: bars spread like a busy day, not at T0 or across months); Symulacja 24/7 on: today's schedule
  if (tl.mode === "sim" && !simOn()) tl.mode = "day";
  if (tl.mode === "sim") { tl.items = []; tl.by = {}; tl.off = new Set(); return simTlBuild(); }
  const hyps = PICK ? [] : tlHyps();
  tlDaySlots(its, hyps);
  const sig = JSON.stringify([tl.mode, its.map((i) => [i.sc, i.t0, i.end, i.endKind, i.last, i.lc, i.evs.length, short(i.x)]), hyps.map((h) => [h.id, h.level, h.title, h.scs])]);
  const el = $("tl"); if (!el) return;
  el.hidden = !its.length;
  if (sig === tl.built) return; tl.built = sig;
  // real time over several days: the axis shows the day with the most reports (e.g. the zapora-* wave), the rest are greyed rows
  let focus = its; tl.day = null;
  if (tl.mode === "abs" && its.length) {
    const byDay = {}; for (const it of its) (byDay[new Date(it.t0 * 60000).toDateString()] ||= []).push(it);
    const ks = Object.keys(byDay);
    if (ks.length > 1) { const best = ks.sort((a, b) => byDay[b].length - byDay[a].length || new Date(b) - new Date(a))[0]; focus = byDay[best]; tl.day = { label: tlFmt(focus[0].t0, "day"), n: focus.length, other: its.length - focus.length }; }
  }
  tl.off = new Set(its.filter((it) => !focus.includes(it)).map((it) => it.sc));
  if (tl.off.size) { tl.items = its = [...focus, ...its.filter((it) => tl.off.has(it.sc))]; }
  if (its.length) {
    const r0 = Math.min(...focus.map(tlBase)), lo = Math.max(r0 - 60, Math.min(...focus.map((it) => tlBase(it) + Math.min(0, it.lc ?? 0)))), hi = Math.max(...focus.map((it) => tlBase(it) + it.last)), pad = Math.max(10, (hi - lo) * 0.03);
    tl.lo = lo - pad / 2; tl.hi = hi + pad;
    if (tl.cur != null) tl.cur = Math.min(tl.hi, Math.max(tl.lo, tl.cur));
  }
  // a hypothesis' incidents sit together (at the place of its first one) under a bracket with the hypothesis label; it lights up
  // once the second of them has been reported (from then on Doradca could see the pattern). "od zgłoszenia": from T0.
  const hOf = {};
  for (const h of hyps) for (const sc of h.scs) if (!(sc in hOf) && tl.by[sc] && !tl.off.has(sc)) hOf[sc] = h;
  const groups = [], seen = new Set();
  for (const it of focus) {
    if (seen.has(it.sc)) continue;
    const h = hOf[it.sc], g = h ? focus.filter((f) => hOf[f.sc] === h) : [it];
    g.forEach((f) => seen.add(f.sc));
    groups.push({ h: g.length >= 2 ? h : null, its: g, since: g.length >= 2 ? g.map(tlBase).sort((a, b) => a - b)[1] : null, rep: g.length >= 2 ? g.slice().sort((a, b) => tlBase(a) - tlBase(b))[1] : null });
  }
  const P = (v) => (v - tl.lo) / (tl.hi - tl.lo) * 100, pc = (v) => P(v).toFixed(3) + "%";
  const row = (it) => {
    const b = tlBase(it), to = b + (it.end ?? it.last), cls = it.endKind || "open";
    const tip = `${pathOf(it.x)}: zgłoszenie ${it.date || ""} ${it.start}${it.lastContact ? ` (ostatni kontakt ${it.lastContact})` : ""}${it.end != null ? ` · ${TL_STATE[it.endKind]} po ${tlFmtDur(it.end)}` : " · trwa (brak końca w danych)"}`;
    const mk = it.evs.map((e) => `<i class="tlk k-${e.k}" data-v="${b + e.m}" data-sc="${esc(it.sc)}" data-at="${esc(e.at)}" data-tip="${esc(e.k === "zespol" ? e.title : shortEv(e.title, e.k))}" style="left:${pc(b + e.m)}${e.k !== "found" && EV_COL[e.kind] ? `;--c:var(${EV_COL[e.kind]})` : ""}"></i>`).join("");   // tooltip + click: #1 block below tlInit()
    if (tl.off.has(it.sc)) return `<div class="tlr off" data-sc="${esc(it.sc)}"><a class="tln" href="${openURL(it.sc)}" title="${esc(tip)}">${esc(short(it.x))}</a><div class="trk" title="${esc(tip)}"><span class="offd">inny dzień: ${esc(tlFmt(it.t0))}</span></div></div>`;
    const pre = it.lc != null ? `<i class="tlpre" style="left:${pc(b + it.lc)};width:${(P(b) - P(b + it.lc)).toFixed(3)}%" title="Od ostatniego kontaktu (${esc(it.lastContact)}) do zgłoszenia"></i>` : "";
    return `<div class="tlr" data-sc="${esc(it.sc)}"><a class="tln" href="${openURL(it.sc)}" title="${esc(tip)}">${esc(short(it.x))}</a><div class="trk" title="${esc(tip)}">`
      + `${pre}<i class="tlb ${cls}" style="left:${pc(b)};width:${Math.max(0.4, P(to) - P(b)).toFixed(3)}%"></i>${it.end == null ? `<i class="tlt" style="left:${pc(to)};width:${Math.max(0, Math.min(100, P(to + 90)) - P(to)).toFixed(3)}%"></i>` : ""}${mk}</div></div>`;   // open end: a 90 min fading tail, not across the whole day
  };
  const rows = groups.map((g) => {
    if (!g.h) return g.its.map(row).join("");
    const p = P(g.since), lab = `${esc(g.h.title)} · ${akcje(g.its.length)}`;
    return `<div class="tlhg ${esc(g.h.level)}" data-h="${esc(g.h.id)}" data-since="${g.since}"><div class="tlhl"><span class="tln" title="Doradca: hipoteza ${esc(g.h.id)} (${esc(g.h.kind || "")}). Świeci od chwili, gdy zgłoszono drugą z tych akcji.">Doradca ${esc(g.h.id)}</span>`
      + `<div class="trk"><span class="hyx" style="${p > 55 ? `left:0;right:${(100 - p).toFixed(3)}%;text-align:right` : `left:${p.toFixed(3)}%`}" title="${esc(g.h.kind || "")}: ${esc(g.h.title)}">${p > 55 ? lab + " ◆" : "◆ " + lab}</span></div></div>${g.its.map(row).join("")}</div>`;
  }).join("") + its.filter((it) => tl.off.has(it.sc)).map(row).join("");
  const mini = focus.map((it) => { const b = tlBase(it); return `<i class="ms" style="left:${pc(b)}"></i>${it.end != null ? `<i class="me ${it.endKind}" style="left:${pc(b + it.end)}"></i>` : ""}`; }).join("");
  // axis ticks: a round step giving at most ~7 labels; real time aligned to the local clock
  const span = tl.hi - tl.lo, step = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10080, 20160, 43200, 86400].find((s) => span / s <= 7) || 172800;
  const tz = tl.mode === "abs" ? new Date(tl.lo * 60000).getTimezoneOffset() : 0, ticks = [];
  for (let v = Math.ceil((tl.lo - tz) / step) * step + tz; v <= tl.hi && ticks.length < 12; v += step) ticks.push(v);
  const fmtTick = (v) => tl.mode === "rel" ? tlFmt(v) : step >= 1440 ? tlFmt(v, "day") : tlFmt(v, new Date(v * 60000).getHours() === 0 && new Date(v * 60000).getMinutes() === 0 ? "day" : "hm");
  $("tlRows").innerHTML = `<div class="tllg"><span><i class="sw live"></i>trwa</span><span><i class="sw found"></i>znaleziono</span><span><i class="sw ended"></i>zakończona</span><span><i class="sw open"></i>brak końca w danych</span><span><i class="sw pre"></i>od ostatniego kontaktu do zgłoszenia</span>`
    + `<span><i class="tlk k-zespol"></i>zespół na miejscu</span><span><i class="tlk k-nic"></i>przeszukano, nic</span><span><i class="tlk k-found"></i>ZNALEZIONO</span>${groups.some((g) => g.h) ? `<span><i class="sw hyp"></i>Doradca: wspólne źródło</span>` : ""}${tl.day ? `<span>Czas rzeczywisty: dzień ${esc(tl.day.label)} (${tl.day.n} akcji), pozostałe ${tl.day.other} w innych dniach</span>` : ""}${tl.mode === "day" ? `<span class="daynote"><b>Dzień w Centrum:</b> ${TL_DAY_NOTE}. Klik otwiera akcję w Historii o jej prawdziwej godzinie.</span>` : ""}`
    + `<span class="keys">Klawisze: ← → krok, Shift = duży krok, spacja = odtwórz, Home / End, Esc = na żywo</span></div>` + rows;
  $("tlMini").innerHTML = `<span class="tln"${tl.mode === "day" ? ` title="Dzień w Centrum: ${TL_DAY_NOTE}"` : ""}>${tl.day ? `Dzień ${esc(tl.day.label)} <b>${tl.day.n}</b>` : `Wszystkie <b>${its.length}</b>`}</span><div class="trk">${mini}</div>`;
  $("tlAxis").innerHTML = `<span class="tln"></span><div class="trk">${ticks.map((v) => `<span style="left:${pc(v)}">${fmtTick(v)}</span>`).join("")}</div>`;
  $("tl").querySelectorAll(".tlr").forEach((r) => { r.onmouseenter = () => setHl(r.dataset.sc); r.onmouseleave = () => setHl(null); });
  for (const b of $("tl").querySelectorAll("[data-mode]")) b.classList.toggle("on", b.dataset.mode === tl.mode);
  // element caches for tlApply (every animation frame while playing touches only what changed)
  tl.rowEls = [...$("tlRows").querySelectorAll(".tlr")];
  tl.kEls = [...$("tlRows").querySelectorAll(".tlr .tlk")]; for (const k of tl.kEls) k._v = +k.dataset.v;
  tl.hEls = [...$("tlRows").querySelectorAll(".tlhg")]; for (const g of tl.hEls) g._since = +g.dataset.since;
  // the feed: every incident's last contact, report, scripted events (not the setup), teams on site, end; Doradca's hypotheses
  const feed = [];
  for (const it of focus) {
    const b = tlBase(it), name = short(it.x);
    if (it.lc != null) feed.push({ v: b + it.lc, clock: it.lastContact, sc: it.sc, name, k: "lc", text: "ostatni kontakt z osobą" });
    feed.push({ v: b, clock: it.start, sc: it.sc, name, k: "rep", text: "zgłoszenie" + (it.x.title ? ": " + it.x.title : "") });
    let fe = false;
    for (const e of it.evs) {
      if (TL_SETUP.has(e.prov) || (e.m === 0 && e.k === "pogoda")) continue;
      fe ||= e.k === "found";
      feed.push({ v: b + e.m, clock: e.at, sc: it.sc, name, k: e.k, text: e.title });
    }
    if (it.end != null && !fe) feed.push({ v: b + it.end, clock: tlClockAt(it, b + it.end), sc: it.sc, name, k: "found", text: it.endKind === "ended" ? "akcja zakończona: osoba odnaleziona" : "ZNALEZIONO" });
  }
  for (const g of groups) if (g.h) feed.push({ v: g.since, clock: g.rep.start, sc: null, name: "Doradca", k: "hyp", text: `${g.h.title} (${akcje(g.its.length)}, ${(g.h.kind || "").toLowerCase()})`, h: g.h.id });
  tl.feed = feed.map((f, i) => ({ ...f, i })).sort((a, b) => a.v - b.v || a.i - b.i);
  tl.feedKey = null;
}
function tlFmtDur(m) { m = Math.round(m); return m >= 1440 ? `${Math.floor(m / 1440)} d ${Math.floor(m % 1440 / 60)} h` : `${Math.floor(m / 60)} h ${pad2(m % 60)} min`; }
const setTxt = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
const setHtml = (el, h) => { if (el && el._h !== h) { el._h = h; el.innerHTML = h; } };
// team pool at the cursor: teams of the incidents running then, on site (readyAt passed) or on the way; free = roster minus both
function tlPool(c, st) {
  let on = 0, way = 0;
  for (const it of tl.items) {
    if (st[it.sc] !== "live") continue;
    const o = c - tlBase(it);
    for (const r of it.res || []) r.m <= o ? on++ : way++;
  }
  const n = teams.length;
  if (tl.mode === "rel") return `zespoły przy trwających: <b>${on}</b>${way ? ` + ${way} w drodze` : ""}`;
  return `zespoły: <b>${on}</b> na miejscu${way ? ` · ${way} w drodze` : ""}${n ? ` · wolne <b>${Math.max(0, n - on - way)}</b>/${n}` : ""}`;
}
function tlFeedApply(c) {
  const box = $("tlFeed"); if (!box) return;
  if (c == null) { if (!box.hidden) { box.hidden = true; tl.feedKey = null; } return; }
  let i = -1; for (let j = 0; j < (tl.feed || []).length && tl.feed[j].v <= c; j++) i = j;
  const fresh = i >= 0 && c - tl.feed[i].v <= Math.max(5, (tl.hi - tl.lo) / 40), key = i + "|" + fresh;
  if (box.hidden) box.hidden = false;
  if (key === tl.feedKey) return; tl.feedKey = key;
  const show = i < 0 ? [] : tl.feed.slice(Math.max(0, i - 2), i + 1).reverse();
  box.innerHTML = show.length ? show.map((f, j) => `<div class="fe k-${f.k}${j === 0 && fresh ? " new" : ""}"${f.sc ? ` data-sc="${esc(f.sc)}" data-at="${esc(f.clock || "")}" title="Kliknij: Historia tej akcji o ${esc(f.clock || "")}${tl.mode === "day" ? " (godzina w akcji)" : ""}"` : ""}><span class="ft mono">${esc(tl.mode === "day" ? tlFmt(f.v) : f.clock || "")}</span><b>${esc(f.name)}</b><span class="fx">${esc(f.text)}</span></div>`).join("")
    : `<div class="fe"><span class="fx mute">Nic się jeszcze nie wydarzyło.</span></div>`;
}
// top 3 at the cursor on the cards of running incidents: one frame per incident and 5 minutes (GET /api/run/<sc>?t=HH:MM),
// cached, at most 2 requests at once, one new request per 1.5 s while playing. Until it lands the last answer stays up.
const t3 = { cache: {}, busy: 0, last: 0 };
function tl3Clock(it, c) { const s0 = toMin(it.start), o = Math.max(0, Math.min(it.end ?? it.last, Math.round((c - tlBase(it)) / 5) * 5)), m = (s0 + o) % 1440; return pad2(Math.floor(m / 60)) + ":" + pad2(m % 60); }
function tl3Fetch(sc, clk, key) {
  if (t3.busy >= 2 || (tl.play && performance.now() - t3.last < 1500)) return;
  t3.busy++; t3.last = performance.now(); t3.cache[key] = null;
  api(`/api/run/${encodeURIComponent(sc)}?t=${encodeURIComponent(clk)}`)
    .then((f) => { t3.cache[key] = (f.segments || []).slice().sort((a, b) => (b.poa || 0) - (a.poa || 0)).slice(0, 3).map((s) => ({ id: s.id, name: s.name })); })
    .catch(() => { t3.cache[key] = "err"; })
    .finally(() => { t3.busy--; if (!tl.play) tlApply(); });
}
function tl3Apply(card, it, c, s) {
  let box = card.querySelector(".tl3");
  if (c == null || !it || s !== "live") { if (box) box.remove(); card.classList.remove("tl3on"); card._t3 = null; return; }
  const clk = tl3Clock(it, c), key = it.sc + "|" + clk, v = t3.cache[key];
  if (v === undefined) tl3Fetch(it.sc, clk, key);
  if (Array.isArray(v)) card._t3 = { clk, segs: v };
  const d = card._t3;
  const html = d ? `<div class="lbl">Gdzie szukać najpierw o ${esc(d.clk)}</div>${d.segs.map((x, k) => `<div class="seg"><span class="rk">${k + 1}</span><span class="nm">${esc(x.id)} ${esc(x.name)}</span></div>`).join("")}`
    : `<div class="lbl">Gdzie szukać najpierw o ${esc(clk)}</div><div class="loading">Liczę mapę na ${esc(clk)}...</div>`;
  if (!box) { box = document.createElement("div"); box.className = "top3 tl3"; const ref = card.querySelector(".top3, .loading"); ref ? ref.after(box) : card.querySelector(".cteams").before(box); }
  setHtml(box, html); card.classList.add("tl3on");
}
function tlApply() {
  const el = $("tl"); if (PICK || !el || el.hidden) return;
  const c = tl.cur, P = (v) => (v - tl.lo) / (tl.hi - tl.lo);
  el.classList.toggle("scrub", c != null);
  document.body.classList.toggle("tlplaying", !!tl.play);   // no backdrop blur while playing: re-blurring the map every frame halved the frame rate
  $("tlLive").classList.toggle("on", c == null);
  setTxt($("tlPlay"), tl.play ? "❚❚" : "▶"); const pt = tl.play ? "Pauza (spacja)" : "Odtwórz wszystkie akcje (spacja; 1× = 1 minuta na sekundę)"; if ($("tlPlay").title !== pt) $("tlPlay").title = pt;
  setTxt($("tlSpeed"), tl.speed + "×");
  const cur = $("tlCur"); if (cur.hidden !== (c == null)) cur.hidden = c == null;
  if (c != null) cur.style.setProperty("--p", Math.min(1, Math.max(0, P(c))).toFixed(5));
  const n = { pre: 0, live: 0, found: 0, ended: 0 }, st = {};
  for (const it of tl.items) if (!tl.off.has(it.sc)) { const s = tlState(it, c ?? tl.hi); st[it.sc] = s; n[s]++; }
  const tag = tl.mode === "day" ? ` <span class="tlday" title="Dzień w Centrum: ${TL_DAY_NOTE}">układ pokazowy</span>` : "";
  setHtml($("tlNow"), c == null ? `<b>Na żywo</b>${tag} <span class="mute">przesuń kursor albo naciśnij ▶, aby zobaczyć, jak toczyły się akcje</span>`
    : `<b class="mono">${tlFmt(c)}</b>${tag} <span class="tlc">trwa <b>${n.live}</b>${n.found + n.ended ? ` · znaleziono ${n.found + n.ended}` : ""}${n.pre ? ` · jeszcze nie zgłoszone ${n.pre}` : ""}</span> <span class="tlp">${tlPool(c, st)}</span>`);
  for (const r of tl.rowEls || []) { const s = c == null ? "" : st[r.dataset.sc] || ""; if (r.dataset.s !== s) r.dataset.s = s; }
  for (const k of tl.kEls || []) { const f = c != null && k._v > c; if (k._f !== f) { k._f = f; k.classList.toggle("fut", f); } }
  for (const g of tl.hEls || []) g.classList.toggle("on", c == null || g._since <= c);
  for (const [k, m] of markers) { const x = incidents.find((i) => i.sc === k); if (x && m.getElement()._mm !== markMode(x)) paintMarker(x, m); }
  tlFeedApply(c);
  document.querySelectorAll("#cards .card").forEach((card) => {
    const sc = card.dataset.sc, it = !tl.off.has(sc) && tl.by[sc], s = c != null && it ? st[sc] : null;
    card.classList.toggle("tl-pre", s === "pre");
    tl3Apply(card, it, c, s);
    let b = card.querySelector(".tlst");
    if (!s) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement("span"); b.className = "tlst"; card.querySelector(".ctop").appendChild(b); }
    const bc = "tlst " + s; if (b.className !== bc) b.className = bc; // day mode: the incident's own (real) clock at the cursor, as in Historia
    setTxt(b, s === "pre" && tl.mode === "day" ? "przed zgłoszeniem" : `${tl.mode === "abs" ? tlFmt(c, "hm") : tl.mode === "day" ? tlClockAt(it, c) : tlFmt(c)}: ${s === "pre" ? "przed zgłoszeniem" : TL_STATE[s]}`);
  });
  if (tl.mode === "sim") simTlApply(c);
}
function tlSet(v) { tl.cur = v == null ? null : Math.min(tl.hi, Math.max(tl.lo, v)); tlApply(); }
function tlStop() { if (tl.play) cancelAnimationFrame(tl.play); tl.play = 0; }
// playback on requestAnimationFrame: the cursor moves every frame, tlApply writes only what changed
function tlPlay() {
  if (tl.play) { tlStop(); tlApply(); return; }
  if (tl.cur == null || tl.cur >= tl.hi) tl.cur = tl.lo;
  let t = performance.now();
  const step = (now) => {
    const dt = Math.min(0.25, Math.max(0, now - t) / 1000); t = now;
    tl.cur = Math.min(tl.hi, tl.cur + dt * tl.speed);
    tl.play = tl.cur >= tl.hi ? 0 : requestAnimationFrame(step);
    tlApply();
  };
  tl.play = requestAnimationFrame(step);
  tlApply();
}
function tlSpeed(d) { const i = TL_SPEEDS.indexOf(tl.speed); tl.speed = TL_SPEEDS[d > 0 ? (i + 1) % TL_SPEEDS.length : Math.max(0, i - 1)]; try { localStorage.setItem("rescue-centrum-tl-speed", String(tl.speed)); } catch (e) {} tlApply(); }
function tlInit() {
  const el = $("tl"); if (!el) return;
  $("tlPlay").onclick = tlPlay;
  $("tlSpeed").onclick = () => tlSpeed(1);
  $("tlLive").onclick = () => { tlStop(); tlSet(null); };
  el.querySelectorAll("[data-mode]").forEach((b) => b.onclick = () => { if (tl.mode === b.dataset.mode) return; tl.auto = false; tl.mode = b.dataset.mode; tlStop(); tl.cur = null; tlBuild(); tlApply(); });
  // scrub: press / drag anywhere over the tracks column (the mini strip, the axis or the Gantt rows)
  const body = $("tlBody"), vAt = (e) => { const r = $("tlMini").querySelector(".trk").getBoundingClientRect(); return tl.lo + (tl.hi - tl.lo) * Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
  let drag = false;
  body.addEventListener("pointerdown", (e) => {
    const trk = $("tlMini").querySelector(".trk"); if (!trk || e.button > 0 || e.target.closest("a,button")) return;
    if (e.clientX < trk.getBoundingClientRect().left - 4 || e.target.closest(".tlk[data-at]")) return;   // a marker opens Historia (#1 block)
    drag = true; tlStop(); try { body.setPointerCapture(e.pointerId); } catch (er) {} tlSet(vAt(e)); e.preventDefault();
  });
  body.addEventListener("pointermove", (e) => { if (drag) tlSet(vAt(e)); });
  for (const t of ["pointerup", "pointercancel"]) body.addEventListener(t, () => drag = false);
  // keyboard, while nothing else has the focus (or the focus is in the timeline): ← → step, Shift = 10x, space play / pause,
  // Home / End, Esc back to Na żywo, + / - speed
  document.addEventListener("keydown", (e) => {
    if (PICK || el.hidden || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const t = e.target, inTl = el.contains(t);
    if (!inTl && t !== document.body && t !== document.documentElement && t !== document) return;
    const onBtn = t.closest && t.closest("button,a"), span = tl.hi - tl.lo;
    const go = (v) => { tlStop(); tlSet(v); e.preventDefault(); };
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") go((tl.cur ?? tl.hi) + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? span / 10 : Math.max(1, span / 100)));
    else if (e.key === "Home") go(tl.lo);
    else if (e.key === "End") go(tl.hi);
    else if ((e.key === " " || e.key === "k") && !onBtn) { e.preventDefault(); tlPlay(); }
    else if (e.key === "Escape" && tl.cur != null) { e.preventDefault(); tlStop(); tlSet(null); }
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); tlSpeed(1); }
    else if (e.key === "-") { e.preventDefault(); tlSpeed(-1); }
  });
  // feed: hover marks the incident, a click opens it in Historia at that moment (histURL from the #1 block)
  const feed = $("tlFeed");
  if (feed) {
    feed.addEventListener("mouseover", (e) => { const f = e.target.closest(".fe[data-sc]"); setHl(f ? f.dataset.sc : null); });
    feed.addEventListener("mouseleave", () => setHl(null));
    feed.addEventListener("click", (e) => { const f = e.target.closest(".fe[data-sc]"); if (f) location.href = histURL(f.dataset.sc, f.dataset.at); });
  }
  const narrow = matchMedia("(max-width:900px)");
  if (!narrow.matches) hoverHold(el, { holdMs: 3000 });
  $("tlMore").onclick = () => { const on = el.classList.toggle("peek"); $("tlMore").textContent = on ? "Zwiń oś" : "Oś czasu"; $("tlMore").setAttribute("aria-expanded", on); };
  // the Doradca panel sits just above the collapsed strip
  const ro = new ResizeObserver(() => { if (!el.classList.contains("peek")) document.documentElement.style.setProperty("--tl-h", el.hidden ? "0px" : el.offsetHeight + 12 + "px"); });
  ro.observe(el);
}
tlInit();
// --- #1 (AI Mateusza #1, ASK AI Andrzeja): the collapsed Doradca shows EVERY alarm-level hypothesis, one row each (level,
// title, score 0-1, linked incidents), so a second alarm (e.g. kolej 0,83 next to zapora 0,97) is visible without "Rozwiń".
// A row selects that hypothesis (map + linked cards) like the tabs of the open panel. No alarm: the old one-line summary.
// Doradca ALARM -> the bell (#1, feature A): one note per alarm hypothesis; in Symulacja 24/7 its time is the start of its 2nd
// incident (the moment Doradca could link them), else when this page first saw it. Otwórz selects it here (panel open, map fit).
// escalation on the cards (#1, feature C, client side only): a running incident with a note (its report or a call) unacked for more
// than 5 min gets a red badge with the age; the bell has the same rule (livefeed ESCALATE_MIN), Potwierdź there clears it
function simEscPaint() {
  const box = $("simCards"); if (!box || !sim.bell || !sim.lf) return;
  const now = sim.lf.nowMs(), late = new Map();
  for (const n of sim.bell.notes || []) {
    if (n.type === "adv" || !n.inst || sim.lf.acks.isAcked(n.key) || now - n.ms <= 5 * 60000 || now - n.ms > 60 * 60000) continue;
    const m = Math.floor((now - n.ms) / 60000); if (!late.has(n.inst.key) || late.get(n.inst.key) < m) late.set(n.inst.key, m);
  }
  box.querySelectorAll(".card[data-key]").forEach((el) => {
    const m = late.get(el.dataset.key), b = el.querySelector(".escb");
    el.classList.toggle("esc", m != null);
    if (m == null) { if (b) b.remove(); return; }
    const t = `bez potwierdzenia ${m} min`;
    if (!b) { const s = document.createElement("span"); s.className = "escb"; s.textContent = t; s.title = "Zgłoszenie tej akcji czeka na potwierdzenie w dzwonku ponad 5 min"; el.prepend(s); }
    else if (b.textContent !== t) b.textContent = t;
  });
}
const advSeen = new Map();
function advNotes(now) {
  const hs = ((adv && adv.hypotheses) || []).filter((h) => h.level === "alarm" && h.incidents.length >= 2);
  return hs.map((h) => {
    let ms = null;
    if (simOn()) { const st = h.incidents.map((sc) => Math.min(...sim.view.filter((i) => i.sc === sc).map((i) => i.startMs))).filter(isFinite).sort((a, b) => a - b); if (st.length >= 2) ms = st[1]; }
    const id = h.id + ":" + h.incidents.slice().sort().join("+");
    if (ms == null) { if (!advSeen.has(id)) advSeen.set(id, now); ms = advSeen.get(id); }
    const name = (sc) => { const x = incidents.find((i) => i.sc === sc); return x ? short(x) : sc; };
    return { key: `adv:${id}|${sim.lf ? sim.lf.warsaw(ms).day : ""}`, type: "adv", ms, title: h.title, sub: h.incidents.map(name).join(", "),
      st: `${LEVEL[h.level] || h.level} · ${akcje(h.incidents.length)} · wynik ${num2(h.score)}`,
      onOpen: () => { const i = (adv.hypotheses || []).findIndex((x) => x.id === h.id); if (i < 0) return; advSel = i; advOpen = true; try { localStorage.setItem("rescue-advisor-open", "1"); } catch (e) {} const b = document.querySelector(".lfbell[aria-expanded=true]"); if (b) b.click(); advRender(); advFit(); } };
  });
}
function advCollapsedHTML(hs, h) {
  const al = hs.map((x, i) => [x, i]).filter(([x]) => x.level === "alarm");
  if (al.length < 2) return `<p class="help one">${esc(h.title)} · ${akcje(h.incidents.length)} · <button class="advt2" type="button">Pokaż szczegóły</button></p>`;
  return `<ul class="advrows">${al.map(([x, i]) => `<li><button type="button" class="advrow${i === advSel ? " on" : ""}" data-i="${i}" title="Dla operatora: wynik ${num2(x.score)} (0-1). Kliknij: pokaż powiązane akcje na mapie.">`
    + `<span class="lvl ${esc(x.level)}">${esc(x.id)}</span><span class="t">${esc(x.title)}</span><span class="n mono">${num2(x.score)}</span><span class="mute">${akcje(x.incidents.length)}</span></button></li>`).join("")}</ul>`
    + `<p class="help one"><button class="advt2" type="button">Pokaż szczegóły</button></p>`;
}
// --- #1 (AI Mateusza #1, for #2's timeline): a marker or a row name opens the incident in Historia at that moment
// (/app ?time=hist&t=HH:MM, app.js boot), markers get the dock-style tooltip "HH:MM · title". Phone: a tap opens.
const histURL = (sc, clock) => PICK ? openURL(sc) : `./?role=operator&mode=akcja&time=hist&sc=${encodeURIComponent(sc)}${clock ? `&t=${encodeURIComponent(clock)}` : ""}${SIM_AT_Q}`;
function tlClockAt(it, v) {   // the scenario clock of timeline value v in this incident (clamped to its report .. end)
  const s0 = toMin(it.start); if (s0 == null) return null;
  const o = Math.max(0, Math.min(it.end ?? it.last, Math.round(v - tlBase(it)))), m = (s0 + o) % 1440;
  return pad2(Math.floor(m / 60)) + ":" + pad2(m % 60);
}
(() => {
  const el = $("tl"); if (!el) return;
  const tip = document.createElement("div"); tip.className = "tltip"; tip.hidden = true; document.body.appendChild(tip);
  const hide = () => { tip.hidden = true; };
  el.addEventListener("mouseover", (e) => {
    const k = e.target.closest(".tlk[data-at]"); if (!k) return;
    tip.innerHTML = `<div>${esc(k.dataset.at)} · ${esc(k.dataset.tip || "")}</div><div style="opacity:.75;font-weight:400">kliknij: Historia w tej chwili</div>`;
    tip.hidden = false;
    const r = k.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2)) + "px";
    tip.style.top = Math.max(6, r.top - h - 8) + "px";
  });
  el.addEventListener("mouseout", (e) => { if (e.target.closest(".tlk[data-at]")) hide(); });
  el.addEventListener("click", (e) => {
    const k = e.target.closest(".tlk[data-at]");
    if (k) { e.preventDefault(); hide(); location.href = histURL(k.dataset.sc, k.dataset.at); return; }
    const n = e.target.closest(".tlr .tln"), it = n && tl.by[n.closest(".tlr").dataset.sc];   // a name with the cursor set: Historia at the cursor
    if (it && tl.cur != null && !tl.off.has(it.sc) && tlState(it, tl.cur) !== "pre") { e.preventDefault(); location.href = histURL(it.sc, tlClockAt(it, tl.cur)); }
  });
  addEventListener("scroll", hide, true);
})();

// ---------- pick mode (/app "Zmień scenariusz", see PICK at the top): compact list next to the same map. Plain list first (from
// /api/scenarios, then /api/incidents); when /api/advisor answers, incidents linked by a hypothesis move to the top as one group
// (alarm first), ringed on the map like "linked" in Doradca. Advisor down = the plain list keeps working. Esc / Wróć = no change.
const PK_ST = { live: "LIVE", ended: "ZAKOŃCZONA", replay: "ODTWORZENIE" };
let pickStudio = false, pickFocused = false, pickCur = new URLSearchParams(location.search).get("sc") || PICK_BACK.searchParams.get("sc");
function renderPick() {
  if (!incidents.length) return;
  const pos = (adv && adv.positions) || {}, cur = pickCur;
  const stOf = (x) => x.found ? "ended" : x.live ? "live" : (pos[x.sc] && PK_ST[pos[x.sc].status] && pos[x.sc].status) || "replay";   // incidents first (fresher), advisor positions.status as fallback
  const timeOf = (x) => (pos[x.sc] && pos[x.sc].time) || (x.lastEventAt ? hhmm(x.lastEventAt) : x.lastClock || "");
  const linked = advLinked();
  const item = (x) => { const st = stOf(x), me = x.sc === cur;
    return `<a class="pk ${st}${linked.has(x.sc) ? " adv" : ""}${hl === x.sc ? " hl" : ""}${me ? " cur" : ""}" href="${esc(openURL(x.sc))}" data-sc="${esc(x.sc)}"${me ? ' aria-current="true"' : ""}>
      <span class="badge ${st === "ended" ? "found" : st}">${PK_ST[st]}</span><span class="pkt mono" title="Czas zdarzenia">${esc(timeOf(x))}</span>
      <span class="pkn" title="${esc(pathOf(x))}"><b>${esc(short(x))}</b><span>${rpath(x) ? `<span class="rpath">${esc(rpath(x))}</span> · ` : ""}${esc(longText(x))}</span></span>${me ? '<span class="pkc">obecny</span>' : ""}</a>`; };
  const all = sortIncidents(incidents), used = new Set();
  const hs = ((adv && adv.hypotheses) || []).slice().sort((a, b) => (b.level === "alarm") - (a.level === "alarm") || b.score - a.score);
  let html = "";
  for (const h of hs) {
    const xs = h.incidents.map((sc) => all.find((x) => x.sc === sc)).filter(Boolean); if (!xs.length) continue;
    xs.forEach((x) => used.add(x.sc));
    html += `<section class="pkg ${esc(h.level)}" aria-label="${esc(h.kindLabel)}"><h3><span class="lvl ${esc(h.level)}">${LEVEL[h.level] || esc(h.level)}</span>${esc(h.kindLabel)}
      <span class="mute mono" title="Wynik hipotezy Doradcy (0-1)">${num2(h.score)}</span></h3><div class="pkh">${esc(h.title)} · ${akcje(xs.length)}</div>${xs.map(item).join("")}</section>`;
  }
  const rest = all.filter((x) => !used.has(x.sc));
  html += (used.size ? `<h3 class="pkr">Pozostałe <span class="cnt">${rest.length}</span></h3>` : "") + rest.map(item).join("");
  if (pickStudio) html += `<h3 class="pkr">Inne</h3><a class="pk" href="${esc(pickURL("studio"))}" data-sc="studio"><span class="badge plan">PLAN</span><span class="pkt"></span><span class="pkn"><b>Studio</b><span>edycja na żywo</span></span></a>`;
  const f = document.activeElement && document.activeElement.closest && document.activeElement.closest("#cards .pk"), fsc = f && f.dataset.sc;
  $("cards").innerHTML = html;
  $("cards").querySelectorAll(".pk").forEach((el) => {
    el.onmouseenter = el.onfocus = () => setHl(el.dataset.sc); el.onmouseleave = el.onblur = () => setHl(null);
  });
  const again = fsc && $("cards").querySelector(`.pk[data-sc="${CSS.escape(fsc)}"]`);
  if (again) again.focus({ preventScroll: true });
  else if (!pickFocused) { pickFocused = true; const c = $("cards").querySelector(".pk.cur") || $("cards").querySelector(".pk"); if (c) c.focus(); }
}
function pickMarkers() {   // dots reachable with Tab, Enter opens like a click
  for (const [k, m] of markers) {
    const el = m.getElement(); if (el.dataset.pick) continue;
    el.dataset.pick = "1"; el.tabIndex = 0; el.setAttribute("role", "link");
    el.setAttribute("aria-label", "Wybierz: " + (el.querySelector(".lbl").textContent || k));
    el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickGo(k); } };
    el.onfocus = () => setHl(k); el.onblur = () => setHl(null);
  }
}
if (PICK) {
  const back = PICK_BACK.pathname + PICK_BACK.search + PICK_BACK.hash;
  document.body.classList.add("pick");
  document.title = "Wybierz scenariusz - Rescue Locator";
  $("bar").querySelector("h1").textContent = "Wybierz scenariusz";
  $("bar").querySelector(".brand").href = back;
  $("list").setAttribute("aria-label", "Scenariusze");
  $("list").querySelector("h2").innerHTML = 'Scenariusze <span class="mute">kliknij, aby otworzyć · Esc wraca</span>';
  const b = document.createElement("a"); b.id = "pickBack"; b.href = back; b.textContent = "Wróć"; b.title = "Wróć bez zmiany scenariusza (Esc)";
  $("bar").querySelector("h1").after(b);
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !e.defaultPrevented) { if (EMBED) pickPost({ type: "rl-pick-cancel" }); else location.href = back; } });
  if (EMBED) pickEmbed(b);
  fetch("/modules", { cache: "no-cache" }).then((r) => r.ok ? r.json() : null).then((m) => { if (m && m.modules) { pickStudio = true; renderPick(); } }).catch(() => {});   // Studio, as on the old dropdown
}

// embed: the parent's overlay hosts this page in a reused iframe (contract in CONTRACT.md, Centrum pick mode, embedded)
function pickEmbed(b) {
  document.body.classList.add("embed");
  b.removeAttribute("href"); b.setAttribute("role", "button"); b.tabIndex = 0;
  b.onclick = (e) => { e.preventDefault(); pickPost({ type: "rl-pick-cancel" }); };
  b.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); b.click(); } };
  $("list").querySelector("h2").append(b);   // the header is hidden: Wróć sits on the list
  // list items stay <a href> (middle click = the old full-page flow), a plain click / Enter only tells the parent
  $("cards").addEventListener("click", (e) => {
    const a = e.target.closest(".pk[data-sc]"); if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
    e.preventDefault(); pickGo(a.dataset.sc);
  });
  const setCur = (sc) => { if (sc === undefined) return; pickCur = sc || null; pickFocused = false; renderPick(); };
  addEventListener("message", (e) => {
    const d = e.data; if (e.origin !== location.origin || e.source !== parent || !d || typeof d !== "object") return;
    if (d.type === "rl-pick-current") setCur(d.sc);
    else if (d.type === "rl-pick-hide") pickHidden = true;
    else if (d.type === "rl-pick-show") {
      pickHidden = false; setCur(d.sc);
      if (map) { map.resize(); fitAll(); }   // the iframe may have been display:none
      tick(); advTick();   // the cached list is already on screen, fresh data lands in the background
    }
  });
  pickPost({ type: "rl-pick-ready" });
}

// ---------- loop: every 5 s, never overlapping
let busy = false;
async function tick() {
  if (busy || (EMBED && pickHidden)) return; busy = true;
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
    toast(e.status === 401 || e.status === 403 ? e.message : "Brak połączenia z serwerem akcji - ponawiam co 5 s.");
  }
  busy = false;
}
// first paint: scenario list (titles, places) + scenario files (map dots) + roster, cards marked "liczę mapę" until the real data lands
async function skeleton(teamP) {
  try {
    const a = await api("/api/scenarios");
    const list = (Array.isArray(a) ? a : a.scenarios || []).map((s) => typeof s === "string" ? { name: s } : s).filter((s) => s.name && !/blind|^morzycko$/i.test(s.name));
    if (incidents.length) return;   // /api/incidents was faster
    incidents = list.map((s) => ({ sc: s.name, ...splitIncident(s.incident, s.name), live: false, found: false, replayFound: false, mode: null, lastEventAt: null,
      lastClock: s.startClock || null, top3: [], teams: null, pending: true }));
    teams = await teamP.catch(() => teams);
    if (incidents.every((x) => x.pending)) render();
    Promise.all(list.map((s) => loadMeta(s.name))).then(render);   // map dots
  } catch (e) {}
}
setInterval(() => {   // ?simAt: the header shows the virtual clock (the one the timeline and the bell use), marked "sym."
  if (SIM_AT_Q && sim.lf) { const m = sim.lf.warsaw(sim.lf.nowMs()).min, s = Math.floor(m * 60) % 86400;
    $("clock").innerHTML = `<span class="symb" title="Zegar symulacji (?simAt w adresie), nie czas rzeczywisty">sym.</span> ${pad2(Math.floor(s / 3600))}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`; }
  else $("clock").textContent = new Date().toLocaleTimeString("pl-PL");
}, 1000);
setInterval(tick, POLL_MS);
tick();
window.rescueCentrum = { get incidents() { return incidents; }, get teams() { return teams; }, has, doAssign, get map() { return map; }, tl, tlSet, pathOf, regionOf };   // tests; pathOf(sc) for other modules
initMap().catch((e) => console.warn("[centrum] map", e));

// ---------- Symulacja 24/7 (AI Mateusza #2, livefeed.js, docs/rescue-locator/live-feed.md): a fictional daily schedule of
// incident starts (>= 100 a day, looping, Europe/Warsaw). On: (1) the bell in the header announces every new incident and every
// incoming call inside a running one (toast), operators open or ACK it; (2) the occurrences running now are live cards on top of
// the list ("Trwają teraz", one card per occurrence, so two runs of one scenario are two cards) with the top 3 from the frame at
// their minute (GET /api/run/<sc>?t=HH:MM, cached per 5 min, at most 2 requests at once); recently ended ones fade out;
// (3) the map dot of a scenario is live while any of its occurrences runs, idle (dim) otherwise; (4) the timeline's default
// mode "Grafik 24/7" = today's schedule, one row per scenario; its cursor (scrub / play) moves the virtual clock of (2) and (3).
const sim = { on: false, entries: [], source: null, insts: [], bell: null, lf: null, view: [], cardSig: "", frames: {}, fbusy: 0, info: {} };
const simOn = () => !PICK && !!sim.lf && sim.on;
const simMarks = () => simOn() && (tl.mode === "sim" || tl.cur == null);
const SIM_FADE_MIN = 30;   // an ended occurrence stays (faded) this long
function simNowAt() {   // the virtual clock: the timeline cursor in Grafik 24/7, else the wall clock
  const n = sim.lf.nowMs();
  if (tl.mode !== "sim" || tl.cur == null) return n;
  return sim.lf.msAt(sim.lf.warsaw(n).day, tl.cur);
}
function simView() {   // occurrences running at the virtual clock + ended within SIM_FADE_MIN
  if (!simOn()) return [];
  const ms = simNowAt();
  return sim.lf.instancesAt(sim.entries, ms, { pastMin: 0 }).concat(sim.lf.instancesAt(sim.entries, ms, { pastMin: SIM_FADE_MIN }).filter((i) => i.state === "ended"))
    .filter((i, k, a) => a.findIndex((j) => j.key === i.key) === k);
}
function simMarkMode(sc) {
  let m = "idle";
  for (const i of sim.view) if (i.sc === sc) { if (i.state === "live") return "live"; m = "found"; }
  return m;
}
async function simInit() {
  if (PICK) return;
  const lf = sim.lf = await import("./livefeed.js");
  const host = document.createElement("span"); host.id = "simBox";
  host.innerHTML = `<button id="simTog" type="button" aria-pressed="false" title="Symulacja 24/7: fikcyjne zgłoszenia według dobowego grafiku (ponad 100 na dobę, w pętli). Kliknij, aby włączyć / wyłączyć.">Symulacja 24/7</button><span id="simNote">${esc(lf.SIM_NOTE)}</span>`;
  $("clock").before(host);
  const box = document.createElement("div"); box.id = "simCards"; $("cards").before(box);
  $("simTog").onclick = () => { lf.setSimEnabled(!sim.on); if (new URLSearchParams(location.search).has("sim")) { const u = new URL(location.href); u.searchParams.delete("sim"); history.replaceState(null, "", u); location.reload(); return; } simApply(); };
  try { const s = await lf.loadSchedule(); sim.entries = s.entries; sim.source = s.source; } catch (e) { console.warn("[centrum] schedule", e); }
  sim.bell = lf.mountBell(host, { openURL: (i, clock) => histURL(i.sc, clock), extraNotes: advNotes });   // advNotes: Doradca ALARM in the bell (#1)
  simApply();
  setInterval(simTick, 5000);
  setInterval(() => lf.acks.sync(), 15000); lf.acks.sync();
}
function simApply() {
  sim.on = sim.lf.simEnabled();
  $("simTog").setAttribute("aria-pressed", sim.on); $("simTog").classList.toggle("on", sim.on);
  $("simBox").classList.toggle("on", sim.on); document.body.classList.toggle("sim", sim.on);
  const w = $("simBox").querySelector(".lfw"); if (w) w.hidden = !sim.on;
  const b = $("tl").querySelector('[data-mode="sim"]'); if (b) b.hidden = !sim.on;
  if (sim.on && tl.mode !== "sim") { tl.auto = true; tlStop(); tl.cur = null; }
  tl.built = ""; tlBuild(); tlApply();
  simTick();
}
function simTick() {
  if (!sim.lf) return;
  sim.insts = sim.on ? sim.lf.instancesAt(sim.entries, sim.lf.nowMs(), { pastMin: 120 }) : [];
  if (sim.bell) sim.bell.update(sim.insts);
  simPaint(); simEscPaint();
}
// cards + dots at the virtual clock (cheap when nothing changed: signature of keys, states and 5-min clocks)
function simPaint() {
  sim.view = simView(); advSimRefresh();
  for (const [k, m] of markers) {
    const x = incidents.find((i) => i.sc === k); if (!x) continue;
    if (m.getElement()._mm !== markMode(x)) paintMarker(x, m);
    const n = sim.view.filter((i) => i.sc === k && i.state === "live").length, el = m.getElement();
    if (el.dataset.simN !== String(n > 1 ? n : "")) el.dataset.simN = n > 1 ? n : "";
  }
  const box = $("simCards"); if (!box) return;
  if (!simOn()) { if (box.innerHTML) { box.innerHTML = ""; sim.cardSig = ""; } return; }
  const need = [...new Set(sim.view.map((i) => i.sc))].filter((sc) => !sim.info[sc]);
  if (need.length) Promise.all(need.map((sc) => sim.lf.describe(sc).then((d) => { sim.info[sc] = d; }))).then(() => { sim.cardSig = ""; simPaint(); });
  const rows = sim.view.map((i) => { const d = sim.info[i.sc], clk = d && d.startClock ? sim.lf.scenarioClock(i, d.startClock) : null, c5 = clk && simClock5(i, d.startClock); return { i, d, clk, c5, f: c5 ? sim.frames[i.sc + "|" + c5] : undefined }; });
  for (const r of rows) if (r.c5 && r.i.state === "live" && r.f === undefined) {   // the scenario file first: simClock5 clamps to its last event
    if (meta[r.i.sc]) simFetch(r.i.sc, r.c5);
    else if (!sim.mwait?.[r.i.sc]) { (sim.mwait ||= {})[r.i.sc] = 1; loadMeta(r.i.sc).then((md) => { if (md) { sim.cardSig = ""; simPaint(); } else simFetch(r.i.sc, r.c5); }); }
  }
  const sig = JSON.stringify([rows.map((r) => [r.i.key, r.i.state, tl.play ? r.c5 : r.clk, r.f === undefined ? 0 : r.f, !!r.d]), tl.cur == null]);
  if (sig === sim.cardSig) return; sim.cardSig = sig;
  const live = rows.filter((r) => r.i.state === "live"), ended = rows.filter((r) => r.i.state !== "live");
  const hm = (ms) => { const m = Math.floor(sim.lf.warsaw(ms).min); return pad2(Math.floor(m / 60)) + ":" + pad2(m % 60); };
  const card = (r) => {
    const { i, d, clk, f } = r, x = incidents.find((y) => y.sc === i.sc) || { sc: i.sc, place: (d && d.place) || i.sc, title: "" };
    const t3 = Array.isArray(f) ? f : f === "err" ? x.top3 || [] : null;
    const el = Math.floor((Math.min(simNowAt(), i.endMs) - i.startMs) / 60000);
    return `<article class="card simc ${i.state === "live" ? "live" : "found ended"}" data-sc="${esc(i.sc)}" data-key="${esc(i.key)}">
      <div class="ctop"><span class="badge ${i.state === "live" ? "live" : "found"}">${i.state === "live" ? "LIVE" : "ZAKOŃCZONA"}</span><span class="simtag" title="${esc(sim.lf.SIM_NOTE)}">symulacja</span><span class="when mono">zgł. ${hm(i.startMs)}</span></div>
      ${rpath(x) ? `<div class="rpath">${esc(rpath(x))} →</div>` : ""}<h3><a href="${esc(histURL(i.sc, clk))}" title="${esc(pathOf(x))}">${esc(short(x))}</a></h3><div class="sub">${esc(d ? d.name : i.sc)}${d && d.place ? " - " + esc(d.place) : ""}</div>
      <div class="simt mono">${i.state === "live" ? `T+${Math.floor(el / 60)}:${pad2(el % 60)} · w scenariuszu ${esc(clk || "")}` : `zakończona ${hm(i.endMs)} · po ${i.durationMin} min`}</div>
      ${i.state !== "live" ? "" : t3 ? (t3.length ? `<div class="top3"><div class="lbl">Gdzie szukać najpierw o ${esc(r.c5)}</div>${t3.slice(0, 3).map((s, k) => `<div class="seg"><span class="rk">${k + 1}</span><span class="nm">${esc(s.id || s.segmentId)} ${esc(s.name)}</span></div>`).join("")}</div>` : `<div class="loading">Brak mapy dla tej chwili.</div>`)
        : `<div class="loading">Liczę mapę na ${esc(r.c5 || "...")}...</div>`}</article>`;
  };
  box.innerHTML = `<h2 class="cgrp sim">${tl.mode === "sim" && tl.cur != null ? "Trwają o " + esc(tlFmt(tl.cur)) : "Trwają teraz"} <span class="cnt">${live.length}</span><span class="simh">${esc(sim.lf.SIM_NOTE)}</span></h2>`
    + (live.map(card).join("") || `<div class="help">Teraz nic nie trwa. Następne zgłoszenie: ${esc(simNext())}.</div>`) + ended.map(card).join("")
    + `<h2 class="cgrp">Wszystkie scenariusze <span class="mute">nagrania</span></h2>`;
  box.querySelectorAll(".card").forEach((el) => {
    el.onclick = (e) => { if (!e.target.closest("a")) location.href = el.querySelector("h3 a").getAttribute("href"); };
    el.onmouseenter = () => setHl(el.dataset.sc); el.onmouseleave = () => setHl(null);
  });
  simEscPaint();
}
function simNext() {
  const ms = simNowAt(), w = sim.lf.warsaw(ms), m = w.min;
  const e = sim.entries.map((x) => ({ x, d: ((toMin(x.start) - m) % 1440 + 1440) % 1440 })).sort((a, b) => a.d - b.d)[0];
  return e ? `${e.x.start} (${short({ sc: e.x.sc, place: e.x.sc })})` : "-";
}
// frame clock: 5-min steps, never past the scenario's last scripted event (GET /api/run/<sc>?t= answers 404 there, qa-wieczor #7)
function simLastOff(sc, b) {
  const md = meta[sc]; if (!md) return Infinity;
  const offs = [...(md.events || []).map((e) => e.at), ...(md.ready || []).map((r) => r.at)].map(toMin).filter((m) => m != null).map((m) => { let d = m - b; if (d < -180) d += 1440; return d; });
  return offs.length ? Math.max(0, ...offs) : Infinity;
}
function simClock5(i, s0) { const b = toMin(s0), m = (b + Math.floor(Math.min(Math.max(0, i.elapsedMin), simLastOff(i.sc, b)) / 5) * 5) % 1440; return pad2(Math.floor(m / 60)) + ":" + pad2(m % 60); }
function simFetch(sc, clk) {
  const key = sc + "|" + clk;
  if (sim.fbusy >= 2 || key in sim.frames || (tl.play && performance.now() - (sim.flast || 0) < 1500)) return;
  sim.flast = performance.now();
  sim.fbusy++; sim.frames[key] = undefined;
  api(`/api/run/${encodeURIComponent(sc)}?t=${encodeURIComponent(clk)}`)
    .then((f) => { sim.frames[key] = (f.segments || []).slice().sort((a, b) => (b.poa || 0) - (a.poa || 0)).slice(0, 3).map((s) => ({ id: s.id, name: s.name })); })
    .catch(() => { sim.frames[key] = "err"; })
    .finally(() => { sim.fbusy--; sim.cardSig = ""; if (!tl.play) simPaint(); });
}
// timeline "Grafik 24/7": 0..1440 min of today, one row per scenario, a bar per occurrence (the one from yesterday that runs past
// midnight starts at 0:00); bars red while running at the cursor, green after, faint before
function simTlBuild() {
  tl.lo = 0; tl.hi = 1440;
  if (tl.cur != null) tl.cur = Math.min(tl.hi, Math.max(tl.lo, tl.cur));
  const byS = {};
  for (const e of sim.entries) { const s = toMin(e.start); if (s == null) continue; (byS[e.sc] ||= []).push([s, s + (e.durationMin || 30), e]); }
  const scs = Object.keys(byS).sort((a, b) => Math.min(...byS[a].map((v) => v[0])) - Math.min(...byS[b].map((v) => v[0])));
  const sig = JSON.stringify(["sim", scs.length, sim.entries.length]);
  const el = $("tl"); el.hidden = !sim.entries.length;
  if (sig === tl.built) return; tl.built = sig;
  const pc = (v) => (v / 1440 * 100).toFixed(3) + "%";
  const nameOf = (sc) => { const x = incidents.find((y) => y.sc === sc) || { sc, place: sc }; let p = null; try { p = window.rescueCentrum.pathOf && window.rescueCentrum.pathOf(x); } catch (e) {} return { s: short(x), p: p || longText(x) }; };
  const rows = scs.map((sc) => {
    const n = nameOf(sc), bars = [];
    for (const [a, b, e] of byS[sc]) {
      const tip = `${n.s}: zgłoszenie ${e.start}, ${e.durationMin} min`;
      bars.push([a, Math.min(b, 1440), tip]); if (b > 1440) bars.push([a - 1440, b - 1440, tip + " (od wczoraj)"]);
    }
    return `<div class="tlr" data-sc="${esc(sc)}"><a class="tln" href="${openURL(sc)}" title="${esc(n.p)}">${esc(n.s)}</a><div class="trk">`
      + bars.map(([a, b, tip]) => `<i class="tlb sb" data-a="${a}" data-b="${b}" title="${esc(tip)}" style="left:${pc(Math.max(0, a))};width:${Math.max(0.3, (b - Math.max(0, a)) / 14.4).toFixed(3)}%"></i>`).join("") + `</div></div>`;
  }).join("");
  const ticks = []; for (let v = 0; v <= 1440; v += 180) ticks.push(v);
  $("tlRows").innerHTML = `<div class="tllg"><span><i class="sw live"></i>trwa</span><span><i class="sw found"></i>zakończona</span><span><i class="sw simpre"></i>jeszcze nie zgłoszona</span>`
    + `<span class="daynote"><b>Grafik 24/7:</b> ${esc(sim.lf.SIM_NOTE)} · ${sim.entries.length} zgłoszeń na dobę. Kursor = co trwało o tej godzinie (karty i mapa).</span>`
    + `<span class="keys">Klawisze: ← → krok, Shift = duży krok, spacja = odtwórz, Home / End, Esc = teraz</span></div>` + rows;
  $("tlMini").innerHTML = `<span class="tln" title="${esc(sim.lf.SIM_NOTE)}">Doba <b>${sim.entries.length}</b></span><div class="trk">${sim.entries.map((e) => `<i class="ms" style="left:${pc(toMin(e.start))}"></i>`).join("")}<i class="simnow"></i></div>`;
  $("tlAxis").innerHTML = `<span class="tln"></span><div class="trk">${ticks.map((v) => `<span style="left:${pc(v)}">${tlFmt(v % 1440 === 0 && v ? 1439.99 : v)}</span>`).join("")}</div>`;
  $("tl").querySelectorAll(".tlr").forEach((r) => { r.onmouseenter = () => setHl(r.dataset.sc); r.onmouseleave = () => setHl(null); });
  for (const b of $("tl").querySelectorAll("[data-mode]")) b.classList.toggle("on", b.dataset.mode === tl.mode);
  tl.rowEls = []; tl.kEls = []; tl.hEls = []; tl.feed = []; tl.feedKey = null;
  tl.simBars = [...$("tlRows").querySelectorAll(".sb")].map((b) => ({ b, a: +b.dataset.a, z: +b.dataset.b }));
}
function simTlApply(c) {
  if (!sim.lf) return;
  const nowMin = sim.lf.warsaw(sim.lf.nowMs()).min, v = c ?? nowMin;
  for (const o of tl.simBars || []) { const s = v < o.a ? "pre" : v < o.z ? "live" : "found"; if (o.s !== s) { o.s = s; o.b.className = "tlb sb " + s; } }
  const fd = $("tlFeed"); if (fd && !fd.hidden) fd.hidden = true;   // the incident feed of the other modes; the bell is the feed here
  const nw = $("tlMini").querySelector(".simnow"); if (nw) nw.style.left = (nowMin / 14.4).toFixed(3) + "%";
  simPaint();
  const n = sim.view.filter((i) => i.state === "live").length;
  setHtml($("tlNow"), c == null ? `<b>Teraz ${esc(tlFmt(nowMin))}</b> <span class="tlday" title="${esc(sim.lf.SIM_NOTE)}">symulacja</span> <span class="tlc">trwa <b>${n}</b></span> <span class="mute">przesuń kursor albo ▶, aby zobaczyć dobę</span>`
    : `<b class="mono">${tlFmt(c)}</b> <span class="tlday" title="${esc(sim.lf.SIM_NOTE)}">symulacja</span> <span class="tlc">trwa <b>${n}</b></span>`);
}
simInit().catch((e) => console.warn("[centrum] sim", e));
window.rescueSim = sim;   // tests
