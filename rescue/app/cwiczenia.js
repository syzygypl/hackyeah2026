// Rescue Locator - Ćwiczenia (training mode). API: CONTRACT.md "Exercise mode" (/api/exercises, /api/exercise/<sid>/...).
// The page never sees the truth until the server says the exercise is over. Map = the 2D view (web/) embedded like in the app.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LOOPBACK = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(location.hostname);
let PIN = ""; try { PIN = (localStorage.getItem("rescue-pin") || "").replace(/^"(.*)"$/, "$1"); } catch (e) {}
if (!LOOPBACK) { $("pinbox").hidden = false; $("pin").value = PIN; $("pin").onchange = () => { PIN = $("pin").value.trim(); try { localStorage.setItem("rescue-pin", PIN); } catch (e) {} loadList(); }; }

async function api(path, body) {
  const h = { "Content-Type": "application/json" }; if (!LOOPBACK && PIN) h["X-Rescue-Pin"] = PIN;
  const r = await fetch(path, body === undefined ? { headers: h, cache: "no-store" } : { method: "POST", headers: h, body: JSON.stringify(body) });
  let d = null; try { d = await r.json(); } catch (e) {}
  if (!r.ok) { const err = new Error((d && d.error) || `HTTP ${r.status}`); err.status = r.status; throw err; }
  return d;
}
const pct = (x) => (x > 0 && x < 0.01 ? (x * 100).toFixed(1) : Math.round(x * 100)) + "%";
const short = (n) => String(n || "").split(" (")[0];
function show(id) { for (const s of ["scrList", "scrBrief", "scrPlay", "scrScore"]) $(s).hidden = s !== id; window.scrollTo(0, 0); }

const G = { st: null, team: null, busy: false, frameReady: false, runUrl: "", steps: 0 };

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
  $("exList").querySelectorAll("button").forEach((b) => (b.disabled = true));
  try { G.st = await api("/api/exercise/start", { id }); } catch (e) { alert("Nie udało się rozpocząć: " + e.message); loadList(); return; }
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
  return xs.map((f) => `<li class="${esc(f.kind)}"><span class="t">${esc(f.clock)}</span><span>${esc(f.title)}</span></li>`).join("") || `<li class="mute">brak</li>`;
}
function teamHTML(t, pick) {
  const st = t.status.replace(" ", "-");
  const free = pick && t.status === "wolny";
  const extra = t.segmentId ? `${esc(t.segmentId)} do ${esc(t.busyUntil)}` : t.status === "niedostępny" ? esc(t.reason) : "";
  return `<li class="${free ? "free" : ""}${G.team === t.id ? " sel" : ""}" data-team="${esc(t.id)}"><span class="st ${esc(st)}">${esc(t.status)}</span>
    <span class="nm">${esc(short(t.name))}<div class="why">${extra}</div></span></li>`;
}

// ---------- 3. play
function mapURL(s) {
  const po = encodeURIComponent(location.origin), ins = insets().join(",");
  return `../web/index.html?embed=scene&parentOrigin=${po}&sc=${encodeURIComponent(s.region)}&run=${encodeURIComponent(s.run)}` +
    `&scenario=${encodeURIComponent("/scenarios/" + s.region + ".json")}&live=${encodeURIComponent("/api/exercise/" + s.sid + "/live")}&step=9999&insets=${ins}`;
}
function insets() {
  const h = document.querySelector("header").getBoundingClientRect(), c = $("ctl").getBoundingClientRect();
  return innerWidth > 700 ? [Math.round(h.height), Math.round(innerWidth - c.left), 0, 0] : [Math.round(h.height), 0, Math.round(innerHeight - c.top), 0];
}
function post(msg) { const w = $("map").contentWindow; if (G.frameReady && w) w.postMessage({ source: "rescue-app", ...msg }, location.origin); }
function syncMap() {
  const s = G.st; if (!s || $("scrPlay").hidden) return;
  if (s.run === G.runUrl) return;
  G.runUrl = s.run;
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
  }
  if (m.type === "select" && typeof m.segmentId === "string") pickSegment(m.segmentId);
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
    const eta = sel ? sel.eta[g.id] : null, no = sel && eta == null;
    return `<li class="${no ? "no" : ""}" data-seg="${esc(g.id)}" title="${esc(g.name)}"><span class="rk">${g.rank}</span><span class="w">${pct(g.weight)}</span>
      <span class="nm"><b>${esc(g.id)}</b> ${esc(g.name)}</span>${where[g.id] ? `<span class="who">${esc(where[g.id].join(", "))}</span>` : ""}
      ${sel ? `<span class="eta">${eta == null ? "nie dojdzie" : eta + " min"}</span>` : ""}</li>`;
  }).join("");
  $("pFeed").innerHTML = feedHTML(s.feed, true);
  for (const b of ["pWait", "pWait60"]) $(b).disabled = s.over || G.busy;
  $("pEnd").textContent = s.over ? "Zobacz ocenę" : "Zakończ i oceń";
  syncMap();
  if (s.over && !G.shownEnd) { G.shownEnd = true; msg(s.found ? "ZNALEZIONO. Ćwiczenie zakończone - zobacz ocenę." : "Koniec czasu na decyzje - zobacz ocenę.", !s.found); setTimeout(showScore, 1800); }
}
function msg(t, bad) { const m = $("pMsg"); m.hidden = !t; m.textContent = t || ""; m.classList.toggle("bad", !!bad); }

$("pTeams").onclick = (e) => {
  const li = e.target.closest("li[data-team]"); if (!li) return;
  const t = G.st.teams.find((x) => x.id === li.dataset.team);
  if (!t || t.status !== "wolny") { msg(t ? `${short(t.name)}: ${t.status === "niedostępny" ? t.reason : t.status + (t.segmentId ? " " + t.segmentId : "")}` : ""); return; }
  G.team = G.team === t.id ? null : t.id;
  msg(G.team ? `${short(t.name)}: kliknij sektor na liście albo na mapie` : "");
  renderPlay();
};
$("pSegs").onclick = (e) => { const li = e.target.closest("li[data-seg]"); if (li) pickSegment(li.dataset.seg); };
async function pickSegment(seg) {
  if (!G.team) { post({ type: "select", segmentId: seg }); msg(`Sektor ${seg}: najpierw wybierz wolny zespół`); return; }
  if (G.busy || G.st.over) return;
  G.busy = true;
  try {
    const team = G.team;
    G.st = await api(`/api/exercise/${G.st.sid}/act`, { team, segmentId: seg });
    const d = G.st.decision || {};
    G.team = null; msg(`${team} → ${seg}: dojście ${d.etaMin} min, przeszukanie ${d.sweepMin} min`);
  } catch (e) { msg(e.message, true); }
  G.busy = false; renderPlay();
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
function resLine(x) { return x.found ? `znaleziono ${esc(x.foundAt)} (po ${x.timeToFind} min)` : `nie znaleziono, pokrycie ${Math.round((x.coverage || 0) * 100)}%`; }
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
  $("sParts").innerHTML = Object.entries(PARTS).map(([k, [l, max]]) => { const v = (sc.parts || {})[k] || 0;
    return `<div class="part"><span>${l}</span><span class="bar"><i style="width:${Math.max(0, Math.min(100, (v / max) * 100))}%"></i></span><span class="n">${v}/${max}</span></div>`; }).join("") +
    `<p class="mute small">Przeszukano ${sc.areaSearchedPct}% obszaru, ${sc.searches} przeszukań, ${sc.unsafeDecisions} decyzji z uwagą bezpieczeństwa.</p>`;
  $("sDec").innerHTML = (sc.decisions || []).map((d) => `<li><span class="t">${esc(d.t)}</span><span class="verdict ${esc(d.verdict)}">${esc(d.verdict)}</span>
    <span><b>${d.action === "wait" ? "Czekaj" : `${esc(d.team)} → ${esc(d.segment)}`}</b> ${d.action === "wait" ? "" : esc(d.segmentName)}<div class="why">${esc(d.why)}</div></span></li>`).join("") ||
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
