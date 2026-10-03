// Rescue Locator - Ćwiczenia (training mode). API: CONTRACT.md "Exercise mode" (/api/exercises, /api/exercise/<sid>/...).
// The page never sees the truth until the server says the exercise is over. Map = the 2D view (web/) embedded like in the app.
import { evGroups, groupOf, grpKind, marksHTML, tickerHTML, tipHTML } from "./dock.js";   // the operator app's dock (dock.css)
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LOOPBACK = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(location.hostname);
let PIN = ""; try { PIN = (localStorage.getItem("rescue-pin") || "").replace(/^"(.*)"$/, "$1"); } catch (e) {}
if (!LOOPBACK) { $("pinbox").hidden = false; $("pin").value = PIN; $("pin").onchange = () => { PIN = $("pin").value.trim(); try { localStorage.setItem("rescue-pin", PIN); } catch (e) {} loadList(); }; }

async function api(path, body) {
  const h = { "Content-Type": "application/json" }; if (!LOOPBACK && PIN) h["X-Rescue-Pin"] = PIN;
  const r = await fetch(path, body === undefined ? { headers: h, cache: "no-cache" } : { method: "POST", headers: h, body: JSON.stringify(body) });
  let d = null; try { d = await r.json(); } catch (e) {}
  if (!r.ok) { const err = new Error((d && d.error) || `HTTP ${r.status}`); err.status = r.status; throw err; }
  return d;
}
const pct = (x) => (x > 0 && x < 0.01 ? (x * 100).toFixed(1) : Math.round(x * 100)) + "%";
const short = (n) => String(n || "").split(" (")[0];
function show(id) { for (const s of ["scrList", "scrBrief", "scrPlay", "scrScore"]) $(s).hidden = s !== id; window.scrollTo(0, 0); }

const G = { st: null, team: null, seg: null, sent: null, pending: null, busy: false, frameReady: false, runUrl: "", steps: 0 };
// team ids (gopr-a, dog...) as the trainee sees them: the short team name (feed, messages, decisions come from the server with ids)
function tName(id) { const t = G.st && G.st.teams.find((x) => x.id === id); return t ? short(t.name) : id; }
function named(text) {
  let out = String(text ?? "");
  for (const t of (G.st && G.st.teams) || []) out = out.replace(new RegExp(`(^|[^\\w-])${t.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "g"), `$1${short(t.name)}`);
  return out;
}

// ---------- 1. list
async function loadList() {
  show("scrList"); $("hdrInfo").textContent = "";
  try {
    const xs = await api("/api/exercises");
    $("exList").innerHTML = xs.map((x) => `<div class="excard">
      <span class="tag">${esc(x.kind)}</span><h4>${esc(x.place)}</h4>
      <div class="small">${esc(x.who)}</div>
      <div class="meta">przejęcie ${esc(x.pickupClock)} · ${Math.round(x.budgetMin / 60)} h na decyzje · ${x.teams} zespołów</div>
      <button class="primary" data-id="${esc(x.id)}">Odprawa</button></div>`).join("") || `<p class="mute">Brak ćwiczeń na serwerze.</p>`;
  } catch (e) { $("exList").innerHTML = `<p class="mute">Nie udało się wczytać ćwiczeń: ${esc(e.message)}${e.status === 401 ? " (wpisz PIN u góry)" : ""}</p>`; }
}
$("exList").onclick = (e) => { const b = e.target.closest("button[data-id]"); if (b) start(b.dataset.id); };

// ---------- 2. briefing (the session starts here: the clock waits until the first decision or "Czekaj")
async function start(id) {
  $("exList").querySelectorAll("button").forEach((b) => { b.disabled = true; if (b.dataset.id === id) b.textContent = "Przygotowuję odprawę..."; });
  G.team = null; G.seg = null; G.sent = null; G.pending = null; G.shownEnd = false; msg("");
  // B4: the start takes a few seconds (the engine computes the first map); opened via ?ex= there is no list button to relabel
  $("hdrInfo").textContent = "Uruchamiam sesję ćwiczenia...";
  if (!$("exList").querySelector(`button[data-id="${CSS.escape(id)}"]`)) $("exList").innerHTML = `<p class="mute">Uruchamiam sesję ćwiczenia, to potrwa kilka sekund...</p>`;
  try { G.st = await api("/api/exercise/start", { id }); } catch (e) { $("hdrInfo").textContent = ""; alert("Nie udało się rozpocząć: " + e.message); loadList(); return; }
  $("hdrInfo").textContent = "";
  const s = G.st;
  try { history.replaceState(null, "", "?ex=" + encodeURIComponent(id)); } catch (e) {}
  $("bTitle").textContent = s.title; $("bPlace").textContent = `${s.place} · ${s.date} · scenariusz fikcyjny`;
  $("bWho").textContent = s.who;
  $("bClock").textContent = s.pickupClock;
  $("bBudget").textContent = `masz czas do ${s.endClock} (${s.budget.hours} h), ${s.budget.teams} zespołów; ${s.survival && s.survival.text ? s.survival.text : ""}`;
  $("bKnown").innerHTML = feedHTML(s.feed, false);
  $("bTeams").innerHTML = s.teams.map((t) => teamHTML(t, false)).join("");
  show("scrBrief");
}
$("briefBack").onclick = () => { try { history.replaceState(null, "", location.pathname); } catch (e) {} loadList(); };
$("briefGo").onclick = () => { show("scrPlay"); G.frameReady = false; G.runUrl = ""; renderPlay(); };

function feedHTML(feed, newestFirst) {
  const xs = newestFirst ? [...feed].reverse() : feed;
  return xs.map((f) => `<li class="${esc(f.kind)} k-${dockKind(f)}" data-seq="${esc(f.seq)}"${f.segmentId ? ` data-seg="${esc(f.segmentId)}"` : ""}><i></i><span class="t">${esc(f.clock)}</span><span>${esc(named(f.title))}</span></li>`).join("") || `<li class="mute">brak</li>`;
}

// ---------- dock (same code as the operator app: dock.js): the exercise feed as the event list, the game minute as the cursor
const FEED_KIND = { dispatch: "report", searched: "searched", clue: "clue", found: "found", info: "conditions" };   // feed kind -> run step kind
const dockKind = (f) => f.kind === "dispatch" ? "zespol" : grpKind({ steps: [{ kind: FEED_KIND[f.kind] || "clue", label: f.title }] }, { ks: [1] });
function dockDoc(s) {
  const toMin = (c) => { const [h, m] = String(c).split(":").map(Number); return h * 60 + m; };
  const f0 = s.feed[0], off = f0 ? toMin(f0.clock) - f0.minute : toMin(s.pickupClock);   // feed minutes count from the scenario start
  const rel = (c) => { let m = toMin(c) - off; while (m < -720) m += 1440; return m; };
  const steps = s.feed.map((e) => ({ t: e.clock, minute: e.minute, label: named(e.title), kind: FEED_KIND[e.kind] || "clue", feedKind: e.kind, seq: e.seq, segmentId: e.segmentId }));
  const now = rel(s.clock), start = Math.min(rel(s.pickupClock), steps.length ? steps[0].minute : now);
  return { R: { steps }, now, start, end: Math.max(now, rel(s.endClock)) };
}
function renderDock() {
  const s = G.st; if (!s) return;
  const D = dockDoc(s), Gs = evGroups(D.R), span = Math.max(1, D.end - D.start), frac = (m) => Math.max(0, Math.min(1, (m - D.start) / span));
  let cg = -1; Gs.forEach((g, j) => { if (g.first != null && g.first <= D.now) cg = j; });
  G.dock = { D, Gs, frac };
  $("tlMarks").innerHTML = marksHTML(D.R, Gs, cg, (g) => g.first != null && g.first > D.now, (g) => (frac(g.minute ?? D.start) * 100).toFixed(2));
  $("tlFill").style.width = `calc((100% - 16px) * ${frac(D.now).toFixed(4)})`;
  $("dkStep").innerHTML = `gra <b>${esc(s.clock)}</b> · do ${esc(s.endClock)}`;
  $("ticker").innerHTML = tickerHTML(Gs.slice(0, cg + 1).slice(-4).reverse().map((g) => {
    const last = g.ks[g.ks.length - 1], st = D.R.steps[last - 1];
    return { at: st.t, label: st.label, more: g.ks.length - 1, title: g.ks.map((k) => D.R.steps[k - 1].t + " · " + D.R.steps[k - 1].label).join("\n"),
             k: st.feedKind === "dispatch" ? "zespol" : grpKind(D.R, g), step: last };
  }));
}
// group card: hover = preview, click = pinned for a moment + the event's sector on the map (the game clock does not move)
function dockTip(j) {
  const tip = $("tlTip"), g = j && G.dock && G.dock.Gs[j - 1], m = g && $("tlMarks").children[j - 1];
  if (!m) { tip.hidden = true; return; }
  tip.innerHTML = tipHTML(G.dock.D.R, g); tip.hidden = false;
  const r = m.getBoundingClientRect();
  tip.style.left = Math.max(8, Math.min(innerWidth - tip.offsetWidth - 8, r.left + r.width / 2 - tip.offsetWidth / 2)) + "px";
  tip.style.top = Math.max(8, r.top - tip.offsetHeight - 10) + "px";
}
function dockIndexAt(x) {
  const r = $("tlMarks").getBoundingClientRect(), f = Math.max(0, Math.min(1, (x - r.left) / (r.width || 1)));
  let best = 0, bd = 1e9; (G.dock ? G.dock.Gs : []).forEach((g, j) => { const d = Math.abs(G.dock.frac(g.minute ?? 0) - f); if (d < bd) { bd = d; best = j + 1; } });
  return best;
}
function previewEvent(k) {   // k = 1-based step (feed item) of the dock document
  if (!G.dock) return;
  const j = groupOf(G.dock.Gs, k) + 1, st = G.dock.D.R.steps[k - 1];
  dockTip(j); clearTimeout(dockTip.h); dockTip.h = setTimeout(() => dockTip(0), 2600);
  document.querySelectorAll("#pFeed li.cur").forEach((x) => x.classList.remove("cur"));
  const li = st && document.querySelector(`#pFeed li[data-seq="${st.seq}"]`); if (li) li.classList.add("cur");
  if (st && st.segmentId) post({ type: "select", segmentId: st.segmentId });
}
$("tl").addEventListener("pointermove", (e) => { if (G.dock) { clearTimeout(dockTip.h); dockTip(dockIndexAt(e.clientX)); } });
$("tl").addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") dockTip(0); });
$("tl").addEventListener("click", (e) => { const j = dockIndexAt(e.clientX), g = G.dock && G.dock.Gs[j - 1]; if (g) previewEvent(g.ks[g.ks.length - 1]); });
$("ticker").onclick = (e) => { const t = e.target.closest("[data-step]"); if (t) previewEvent(+t.dataset.step); };
$("pFeed").onclick = (e) => { const li = e.target.closest("li[data-seq]"); if (!li || !G.dock) return; const k = G.dock.D.R.steps.findIndex((x) => String(x.seq) === li.dataset.seq) + 1; if (k) previewEvent(k); };
function teamHTML(t, pick) {
  const st = t.status.replace(" ", "-");
  const free = pick && t.status === "wolny";
  const extra = t.segmentId ? `${esc(t.segmentId)} do ${esc(t.busyUntil)}` : t.status === "niedostępny" ? esc(t.reason) : "";
  const sel = pick && G.team === t.id, sent = pick && !sel && G.sent && G.sent.team === t.id && t.segmentId === G.sent.seg;
  return `<li class="${free ? "free" : ""}${sel ? " sel" : ""}${sent ? " sent" : ""}" data-team="${esc(t.id)}"${sel ? ' aria-selected="true"' : ""}><span class="st ${esc(st)}">${esc(t.status)}</span>
    <span class="nm">${esc(short(t.name))}<div class="why">${extra}</div></span>${sel ? '<span class="tag">wybrany</span>' : sent ? '<span class="tag">wysłany</span>' : ""}</li>`;
}

// ---------- 3. play
function mapURL(s) {
  const po = encodeURIComponent(location.origin), ins = insets().join(",");
  return `../web/index.html?embed=scene&parentOrigin=${po}&sc=${encodeURIComponent(s.region)}&run=${encodeURIComponent(s.run)}` +
    `&scenario=${encodeURIComponent("/scenarios/" + s.region + ".json")}&live=${encodeURIComponent("/api/exercise/" + s.sid + "/live")}&step=9999&insets=${ins}`;
}
function insets() {
  const h = document.querySelector("header").getBoundingClientRect(), c = $("ctl").getBoundingClientRect();
  const dk = $("exDock").getBoundingClientRect();   // the dock at the bottom covers the map like the operator app's dock
  return innerWidth > 700 ? [Math.round(h.height), Math.round(innerWidth - c.left), dk.height ? Math.round(innerHeight - dk.top) : 0, 0] : [Math.round(h.height), 0, Math.round(innerHeight - c.top), 0];
}
function post(msg) { const w = $("map").contentWindow; if (G.frameReady && w) w.postMessage({ source: "rescue-app", ...msg }, location.origin); }
// the map's team overlay = the run's last step "assignments"; rebuilt from the session state (+ one pending dispatch shown at once)
function postTeams(pending) {
  const s = G.st; if (!s || !G.frameReady || !G.steps) return;
  const name = (id) => (s.segments.find((g) => g.id === id) || {}).name || id;
  const a = s.teams.filter((t) => t.segmentId).map((t) => ({ resourceId: t.id, segmentId: t.segmentId, segmentName: name(t.segmentId), reason: "decyzja ćwiczącego" }));
  if (pending) a.push({ resourceId: pending.team, segmentId: pending.seg, segmentName: name(pending.seg), reason: "wysyłam..." });
  post({ type: "assignments", steps: Array(G.steps - 1).fill(null).concat([a]) });   // null = keep that step as it is
}
// run URL = .../run?v=<events>-<jobs>: the heat changes only with the events; a dispatch alone changes only the team overlay
const heatOf = (u) => (/[?&]v=(\d+)-/.exec(u || "") || [])[1];
async function syncMap() {
  const s = G.st; if (!s || $("scrPlay").hidden) return;
  if (s.run === G.runUrl) return;
  const prev = G.runUrl; G.runUrl = s.run;
  if (G.frameReady && prev && heatOf(prev) === heatOf(s.run)) { postTeams(); return; }   // A: same heat -> teams in place, no reload
  $("mapBusy").hidden = false;
  if (G.frameReady) { G.frameReady = false; post2({ type: "run", url: s.run }); } else $("map").src = mapURL(s);
}
function post2(msg) { const w = $("map").contentWindow; if (w) w.postMessage({ source: "rescue-app", ...msg }, location.origin); }
addEventListener("message", (e) => {
  if (e.origin !== location.origin || e.source !== $("map").contentWindow || !e.data || e.data.source !== "rescue2d") return;
  const m = e.data;
  if (m.type === "ready") {
    G.frameReady = true; G.steps = m.steps || 0;
    if (G.steps) post({ type: "step", i: G.steps - 1 });   // the moment of now: the last thing that happened
    post({ type: "insets", insets: insets() });
    $("mapBusy").hidden = true;
    if (G.seg) post({ type: "select", segmentId: G.seg });   // the map reloads after every change: keep the chosen / dispatched sector outlined
  }
  if (m.type === "select" && typeof m.segmentId === "string") pickSegment(m.segmentId, true);
  // the map toggles a sector off on a second click: with a team chosen that click means "send it there"
  if (m.type === "select" && m.segmentId === null) { if (G.team && G.seg) pickSegment(G.seg); else { G.seg = null; renderPlay(); } }
});
addEventListener("resize", () => post({ type: "insets", insets: insets() }));

function renderPlay() {
  const s = G.st; if (!s) return;
  $("hdrInfo").textContent = `${s.place} · ćwiczenie fikcyjne`;
  $("pClock").textContent = s.clock;
  $("pLeft").textContent = s.over ? "koniec ćwiczenia" : `zostało ${Math.floor(s.minutesLeft / 60)} h ${s.minutesLeft % 60} min (do ${s.endClock})`;
  $("pCond").innerHTML = `${s.dark ? "<b>ciemno</b><br>" : ""}${s.survival && s.survival.level ? `ryzyko: <b>${esc(s.survival.level)}</b>` : ""}`;
  if (G.team && !s.teams.some((t) => t.id === G.team && t.status === "wolny")) G.team = null;
  $("pTeams").innerHTML = s.teams.map((t) => teamHTML(t, true)).join("");
  const sel = s.teams.find((t) => t.id === G.team);
  const where = {}; for (const t of s.teams) if (t.segmentId) (where[t.segmentId] = where[t.segmentId] || []).push(short(t.name).split(" ").slice(-2).join(" "));
  $("pSegs").innerHTML = s.segments.map((g) => {
    const eta = sel ? sel.eta[g.id] : null, no = sel && eta == null, tr = sel && sel.travel ? sel.travel[g.id] : null;
    const cls = [no ? "no" : "", G.seg === g.id ? "sel" : "", G.pending && G.pending.seg === g.id ? "pending" : ""].filter(Boolean).join(" ");
    const etaTxt = eta == null ? "nie dojdzie" : tr != null ? `dojście ${tr} min` : eta + " min";
    const etaTip = eta == null ? "" : tr != null ? `dojście ${tr} min + przeszukanie ${eta - tr} min` : `dojście i przeszukanie ${eta} min`;
    return `<li class="${cls}" data-seg="${esc(g.id)}" title="${esc(g.name)}${etaTip ? " - " + etaTip : ""}"><span class="rk">${g.rank}</span><span class="w">${pct(g.weight)}</span>
      <span class="nm"><b>${esc(g.id)}</b> ${esc(g.name)}</span>${where[g.id] ? `<span class="who">${esc(where[g.id].join(", "))}</span>` : ""}
      ${sel ? `<span class="eta">${etaTxt}</span>` : ""}</li>`;
  }).join("");
  $("pFeed").innerHTML = feedHTML(s.feed, true);
  renderDock();
  for (const b of ["pWait", "pWait60"]) $(b).disabled = s.over || G.busy;
  $("pEnd").textContent = s.over ? "Zobacz ocenę" : "Zakończ i oceń";
  syncMap();
  if (s.over && !G.shownEnd) {
    G.shownEnd = true;
    const last = $("pMsg").hidden || /^Czekam/.test($("pMsg").textContent) ? "" : $("pMsg").textContent + " · ";
    msg(last + (s.found ? "ZNALEZIONO. Ćwiczenie zakończone - zobacz ocenę." : "Koniec czasu na decyzje - zobacz ocenę."), !s.found);
    setTimeout(showScore, s.found ? 1800 : 3500);
  }
}
function msg(t, bad, ok) { const m = $("pMsg"); m.hidden = !t; m.textContent = named(t || ""); m.classList.toggle("bad", !!bad); m.classList.toggle("ok", !bad && !!ok); }

$("pTeams").onclick = (e) => {
  const li = e.target.closest("li[data-team]"); if (!li) return;
  const t = G.st.teams.find((x) => x.id === li.dataset.team);
  if (!t || t.status !== "wolny") { msg(t ? `${short(t.name)}: ${t.status === "niedostępny" ? t.reason : t.status + (t.segmentId ? " " + t.segmentId : "")}` : ""); return; }
  G.team = G.team === t.id ? null : t.id;
  msg(G.team ? `Wybrany: ${short(t.name)}. Teraz kliknij sektor na liście albo na mapie.` : "");
  renderPlay();
};
$("pSegs").onclick = (e) => { const li = e.target.closest("li[data-seg]"); if (li) pickSegment(li.dataset.seg); };
// fromMap: the 2D view already outlined the sector itself (user click), so it is not echoed back
async function pickSegment(seg, fromMap) {
  if (!G.st || G.busy) return;
  G.seg = seg;
  if (!fromMap) post({ type: "select", segmentId: seg });
  if (!G.team) { msg(`Sektor ${seg} zaznaczony. Wybierz wolny zespół, potem kliknij sektor jeszcze raz, żeby go wysłać.`); renderPlay(); return; }
  if (G.st.over) return;
  const t = G.st.teams.find((x) => x.id === G.team);
  if (t && t.eta && t.eta[seg] == null) { msg(`${short(t.name)} nie dojdzie do sektora ${seg} w tych warunkach. Wybierz inny sektor.`, true); renderPlay(); return; }
  const team = G.team;
  G.busy = true; G.pending = { team, seg };
  postTeams(G.pending);   // A: the team is on the map at once; the server's answer confirms (or rolls back) below
  msg(`Wysyłam: ${tName(team)} -> sektor ${seg}...`); renderPlay();
  try {
    G.st = await api(`/api/exercise/${G.st.sid}/act`, { team, segmentId: seg });
    const d = G.st.decision || {};
    G.team = null; G.sent = { team, seg };
    msg(`${tName(team)} -> sektor ${seg}: wysłany (dojście ${d.etaMin} min, przeszukanie ${d.sweepMin} min)`, false, true);
  } catch (e) { msg(e.message, true); postTeams(); }
  G.busy = false; G.pending = null; renderPlay();
}
async function wait(minutes) {
  if (G.busy || G.st.over) return;
  G.busy = true; renderPlay(); msg(`Czekam ${minutes} min...`);
  try {
    G.st = await api(`/api/exercise/${G.st.sid}/advance`, { minutes });
    const ev = G.st.events || [];
    msg(ev.length ? ev.map((x) => `${x.clock} ${x.title}`).join(" · ") : `Nic nowego do ${G.st.clock}`, ev.some((x) => x.kind === "found"));
  } catch (e) { msg(e.message, true); }
  G.busy = false; renderPlay();
}
$("pWait").onclick = () => wait(30);
$("pWait60").onclick = () => wait(60);
$("pEnd").onclick = () => { if (G.st.over || confirm("Zakończyć teraz? Ćwiczenie zostanie ocenione w tym miejscu i pokażemy, gdzie była osoba.")) showScore(); };

// ---------- 4. score
const PARTS = { found: ["Znalezienie i czas", 50], coverage: ["Pokrycie mapy", 15], decisions: ["Jakość decyzji", 25], safety: ["Bezpieczeństwo", 10] };
const POL = { engine: "Plan silnika", expert: "Prosty ekspert (ostatni ślad)", naive: "Naiwnie (najbliżej IPP)" };
function resLine(x) { return x.found ? `znaleziono ${esc(x.foundAt)} (po ${x.timeToFind} min)` : `nie znaleziono, pokrycie mapy ${Math.round((x.coverage || 0) * 100)}%`; }
async function showScore() {
  show("scrScore");
  const s = G.st;
  $("sTitle").textContent = s.title;
  let sc;
  try { sc = await api(`/api/exercise/${s.sid}/score?reveal=1`); } catch (e) { $("sTotal").textContent = "?"; $("sFound").textContent = e.message; return; }
  G.st.over = true;
  $("sTotal").textContent = sc.total;
  const f = $("sFound"); f.className = "foundline" + (sc.found ? " yes" : "");
  f.textContent = sc.found ? `ZNALEZIONO o ${sc.foundAt} (${esc(short((s.teams.find((t) => t.id === sc.foundBy) || {}).name || sc.foundBy))}), ${sc.timeToFind} min od przejęcia` : `Nie znaleziono do ${sc.clock}`;
  // D: safety is scored only for dispatched teams; with no dispatch say so instead of an empty bar next to "0 decisions with a safety note"
  const nDisp = (sc.decisions || []).filter((d) => d.action !== "wait").length;
  $("sParts").innerHTML = Object.entries(PARTS).map(([k, [l, max]]) => { const v = (sc.parts || {})[k] || 0, na = k === "safety" && !nDisp;
    return `<div class="part${na ? " na" : ""}"><span>${l}</span><span class="bar"><i style="width:${Math.max(0, Math.min(100, (v / max) * 100))}%"></i></span><span class="n">${na ? "-" : v}/${max}</span></div>`; }).join("") +
    `<p class="mute small">${!(sc.decisions || []).length ? "<b>Brak decyzji</b>: nikt nie został wysłany i zegar nie ruszył, dlatego 0 pkt. " : !nDisp ? "Żaden zespół nie został wysłany: bezpieczeństwo (0/10) liczymy tylko dla wysłanych zespołów. " : ""}` +
    `Pokrycie mapy ${Math.round((sc.coverage || 0) * 100)}% (waga przeszukanych miejsc), przeszukano ${sc.areaSearchedPct}% powierzchni, ${sc.searches} przeszukań` +
    `${nDisp ? `, ${sc.unsafeDecisions} z ${nDisp} wysłań z uwagą bezpieczeństwa` : ""}.</p>`;
  $("sDec").innerHTML = (sc.decisions || []).map((d) => `<li><span class="t">${esc(d.t)}</span><span class="verdict ${esc(d.verdict)}">${esc(d.verdict)}</span>
    <span><b>${d.action === "wait" ? "Czekaj" : `${esc(tName(d.team))} → ${esc(d.segment)}`}</b> ${d.action === "wait" ? "" : esc(d.segmentName)}<div class="why">${esc(named(d.why))}</div></span></li>`).join("") ||
    `<li class="mute">Brak decyzji: żaden zespół nie został wysłany.</li>`;
  const t = sc.truth;
  $("sTruth").innerHTML = t ? `Sektor <b>${esc(t.segmentId)}</b> (teraz #${t.rankNow ?? "?"} na mapie, waga ${t.weightNow != null ? pct(t.weightNow) : "?"}), punkt ${t.lat.toFixed(5)}, ${t.lon.toFixed(5)}.` : "";
  renderVs(sc);
  if (sc.vsPending) pollVs(s.sid);
}
function renderVs(sc) {
  if (!sc.vs) { $("sVs").innerHTML = `<p class="mute">Liczę plan silnika i strategie porównawcze na tych samych danych...</p>`; return; }
  const rows = [["me", "Ty", sc], ...Object.keys(POL).map((k) => [k, POL[k], sc.vs[k]])].filter((r) => r[2]);
  $("sVs").innerHTML = rows.map(([k, l, x]) => `<div class="vs${k === "me" ? " me" : ""}"><span class="lbl">${l}</span><span class="bar"><i style="width:${x.total}%"></i></span>
    <span class="n">${x.total}</span><span class="res">${resLine(x)}</span></div>`).join("");
  $("sVsNote").textContent = "Te same zespoły, ten sam czas i ten sam los (rzut kością zależy od zespołu, sektora i chwili). Plan silnika z definicji dostaje pełne punkty za decyzje - porównuj go po znalezieniu i czasie.";
}
async function pollVs(sid) {
  for (let i = 0; i < 40 && !$("scrScore").hidden; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try { const sc = await api(`/api/exercise/${sid}/score?reveal=1`); if (sc.vs) { renderVs(sc); return; } } catch (e) { return; }
  }
}
$("scoreBack").onclick = () => { G.st = null; G.shownEnd = false; $("map").src = "about:blank"; try { history.replaceState(null, "", location.pathname); } catch (e) {} loadList(); };
$("sAgain").onclick = () => { const id = G.st && G.st.id; G.shownEnd = false; $("map").src = "about:blank"; if (id) start(id); else loadList(); };

// ---------- boot (?ex=<id> opens that briefing)
const want = new URLSearchParams(location.search).get("ex");
if (want) start(want); else loadList();
