// Co zmienia jedna relacja: the zawrat scenario at 19:20/19:22 run twice by the same engine (POST /api/run, stateless:
// nothing is written to the shared live action), once as is and once with one fictional witness. Both maps are the 2D
// view (web/) embedded like in Ćwiczenia; run B's step before the witness equals run A's last step, so "Dodaj relację"
// just moves map B one step forward. If the server can't run it, precomputed runs from porownanie-data/ are used.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const Q = new URLSearchParams(location.search);
  const SC = "zawrat", CUT = "19:20";
  // the fictional witness; porownanie-data/ holds both runs computed with this exact event (fallback when the server is down)
  const WITNESS = {
    provider: "Clue", at: "19:22", seenAt: "14:35", point: [49.2150, 20.0183], radiusM: 300,
    title: "Świadek: turystka widziała go o 14:35 na zakosach niebieskiego szlaku pod Zawratem, szedł w górę",
    detail: "Telefon na 112 po apelu TOPR (osoba fikcyjna). Mężczyzna w czerwonej kurtce, sam, ok. 15 min poniżej przełęczy, szedł w stronę Zawratu.",
  };
  const G = { on: false, ready: {}, A: null, B: null, scen: null };

  const pct = (v) => (Math.round(v * 10) / 10).toFixed(1).replace(".", ",") + "%";
  const km = (a, b) => { const R = 6371, r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r;
    const h = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const km1 = (v) => v.toFixed(1).replace(".", ",") + " km";

  async function getJSON(u) { const r = await fetch(u, { cache: "no-cache" }); if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }
  async function runEngine(scen) {
    const r = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(scen) });
    if (!r.ok) throw new Error("POST /api/run " + r.status);
    const t = await r.text(); const j = JSON.parse(t); if (!j.steps || !j.steps.length) throw new Error("pusty run");
    return { j, t };
  }

  async function load() {
    let A, B, live = true;
    try {
      const [scen, terr] = await Promise.all([getJSON("/scenarios/" + SC + ".json"), getJSON("/scenarios/" + SC + "-terrain.json")]);
      G.scen = scen;
      const base = Object.assign({}, scen, { terrain: terr });
      base.events = scen.events.filter((e) => e.provider !== "Found" && e.provider !== "RatunekPing" && e.at <= CUT);
      const withW = Object.assign({}, base, { events: base.events.concat([WITNESS]) });
      [A, B] = await Promise.all([runEngine(base), runEngine(withW)]);
    } catch (e) {
      console.warn("live run failed, precomputed fallback:", e.message);
      live = false;
      const [a, b] = await Promise.all(["bez", "z"].map((k) => fetch("porownanie-data/" + SC + "-" + k + ".json").then((r) => r.text())));
      A = { t: a, j: JSON.parse(a) }; B = { t: b, j: JSON.parse(b) };
      if (!G.scen) try { G.scen = await getJSON("/scenarios/" + SC + ".json"); } catch (e2) { G.scen = null; }
    }
    G.A = A.j; G.B = B.j;
    G.bBefore = G.B.steps.findIndex((s) => s.source === "Clue") - 1;
    G.bAfter = G.B.steps.length - 1;
    $("source").textContent = live
      ? "Obie mapy policzone przed chwilą tym samym silnikiem (POST /api/run). Wspólna akcja na żywo nie jest zmieniana."
      : "Serwer nie odpowiedział: pokazuję mapy obliczone wcześniej tym samym silnikiem (porownanie-data/).";
    // the 2D view takes a parent-supplied run from sessionStorage (?runInline=1, same tab = same storage, no polling);
    // one key for both frames, so B is parked only after A has read it (A's "ready")
    G.textB = B.t;
    sessionStorage.setItem("rescue2d-run", A.t);
    $("mapA").src = mapURL(G.A.steps.length - 1);
    render(false);
  }

  function mapURL(step) {
    const po = encodeURIComponent(location.origin);
    return `../web/index.html?embed=bare&theme=light&parentOrigin=${po}&sc=${SC}&runInline=1` +
      `&scenario=${encodeURIComponent("/scenarios/" + SC + ".json")}&live=${encodeURIComponent("data:application/json,[]")}&step=${step}&insets=0,0,0,0`;
  }
  function post(frame, msg) { const w = $(frame).contentWindow; if (w) w.postMessage({ source: "rescue-app", ...msg }, location.origin); }
  addEventListener("message", (e) => {
    if (e.origin !== location.origin || !e.data || e.data.source !== "rescue2d" || e.data.type !== "ready") return;
    const k = e.source === $("mapA").contentWindow ? "A" : e.source === $("mapB").contentWindow ? "B" : null;
    if (!k) return;
    G.ready[k] = true; $("busy" + k).hidden = true;
    if (NARROW()) compactFrame($("map" + k));
    if (k === "A" && !$("mapB").src) { sessionStorage.setItem("rescue2d-run", G.textB); $("mapB").src = mapURL(G.bBefore); }
    if (G.ready.A && G.ready.B && !G.started) {
      G.started = true;
      $("toggle").disabled = false; $("status").textContent = "Obie mapy gotowe.";
      // phone (stacked columns): map B is a screen below the button, so the auto-toggle would happen out of sight; wait for the tap
      if (Q.get("auto") !== "0" && !NARROW()) setTimeout(() => { if (!G.on) toggle(); }, 1500);
      else if (NARROW()) $("status").textContent = "Obie mapy gotowe. Dotknij, aby dodać relację.";
    }
  });

  const names = (st) => Object.fromEntries((st.resources || []).map((r) => [r.id, r.name]));
  const short = (n) => String(n || "").replace(/\s*\(.*\)\s*$/, "");
  const rankOf = (st, id) => st.segments.findIndex((s) => s.id === id) + 1;
  const areaSum = (st) => st.segments.slice(0, 3).reduce((a, s) => a + (+s.areaPct || 0), 0);

  function topHTML(st, ref) {
    return st.segments.slice(0, 3).map((s, i) => {
      let mv = "";
      if (ref) { const r0 = rankOf(ref, s.id); if (r0 > 3) mv = `<span class="mv new">nowy, był ${r0}.</span>`; else if (r0 > i + 1) mv = `<span class="mv up">▲ był ${r0}.</span>`; else if (r0 < i + 1) mv = `<span class="mv down">▼ był ${r0}.</span>`; }
      return `<li data-id="${esc(s.id)}" class="${mv && !mv.includes("down") ? "hit" : ""}"><span class="rk">${i + 1}</span><span class="nm"><b>${esc(s.id)}</b> ${esc(s.name)}</span>${mv}<span class="ar">${pct(+s.areaPct)} obszaru</span></li>`;
    }).join("");
  }
  function teamsHTML(st, ref) {
    const nm = names(st), before = ref ? Object.fromEntries(ref.assignments.map((a) => [a.resourceId, a.segmentId])) : null;
    if (!st.assignments.length) return `<li class="mute">brak wolnych zespołów</li>`;
    return st.assignments.map((a) => {
      const ch = before && before[a.resourceId] !== a.segmentId;
      return `<li data-id="${esc(a.resourceId)}" class="${ch ? "hit" : ""}"><span class="tn">${esc(short(nm[a.resourceId] || a.resourceId))}</span><span class="ts">→ <b>${esc(a.segmentId)}</b> ${esc(a.segmentName)}${ch ? ` <span class="mute">(bez relacji: ${esc(before[a.resourceId] || "-")})</span>` : ""}</span><span class="te">dojście ${Math.round(a.travelMin != null ? a.travelMin : a.etaMin)} min</span></li>`;
    }).join("");
  }
  // FLIP: rows keep their place for one frame, then slide to the new order
  function flip(ul, html, animate) {
    const old = {}; if (animate) for (const li of ul.children) if (li.dataset.id) old[li.dataset.id] = li.getBoundingClientRect().top;
    ul.innerHTML = html;
    if (!animate) return;
    for (const li of ul.children) {
      const y0 = old[li.dataset.id], y1 = li.getBoundingClientRect().top;
      li.style.transition = "none";
      li.style.transform = y0 != null ? `translateY(${y0 - y1}px)` : "translateX(40px)";
      li.style.opacity = y0 != null ? "1" : "0";
    }
    requestAnimationFrame(() => requestAnimationFrame(() => { for (const li of ul.children) { li.style.transition = ""; li.style.transform = ""; li.style.opacity = ""; li.style.transition = "transform .7s cubic-bezier(.2,.8,.2,1),opacity .7s,background .6s"; } }));
  }

  function render(animate) {
    const a = G.A.steps[G.A.steps.length - 1], b = G.B.steps[G.on ? G.bAfter : G.bBefore];
    flip($("topA"), topHTML(a), false); flip($("teamsA"), teamsHTML(a), false);
    $("areaA").textContent = `· top 3 to ${pct(areaSum(a))} obszaru`;
    flip($("topB"), topHTML(b, G.on ? a : null), animate); flip($("teamsB"), teamsHTML(b, G.on ? a : null), animate);
    $("areaB").textContent = `· top 3 to ${pct(areaSum(b))} obszaru`;
    $("pillB").textContent = G.on ? "relacja dodana" : "jeszcze bez relacji"; $("pillB").classList.toggle("on", G.on);
    $("colB").classList.toggle("dim", !G.on && G.started);
    $("witness").classList.toggle("on", G.on);
    const t = $("toggle"); t.textContent = G.on ? "Cofnij relację" : "Dodaj relację"; t.classList.toggle("undo", G.on);
    $("why").hidden = !G.on;
    if (G.on) $("whyList").innerHTML = whyHTML(a, b);
  }

  function whyHTML(a, b) {
    const out = [], s = G.scen;
    const ipp = s ? (s.events.find((e) => e.provider === "KoesterRings") || {}).point || s.ipp.at : null;
    out.push(`Turystka widziała go o <b>14:35</b>, 23 minuty po ostatnim sygnale telefonu, na zakosach pod Zawratem${ipp ? `, <b>${km1(km(ipp, WITNESS.point))}</b> od schroniska, gdzie widziano go o 12:10` : ""}. Bez relacji silnik wie tylko, że telefon był w zasięgu stacji o promieniu 1,2 km, więc część wagi zostaje nisko, przy stawach.`);
    out.push(`Silnik przesuwa <b>ostatni znany punkt</b> na jej obserwację: 70% wagi odległości liczy od miejsca, gdzie go minęła, 30% zostaje przy schronisku na wypadek, gdyby się myliła.`);
    const ids = [...new Set(a.segments.slice(0, 3).map((x) => x.id).concat(b.segments.slice(0, 3).map((x) => x.id)))];
    const moves = ids.map((id) => ({ id, r0: rankOf(a, id), r1: rankOf(b, id), name: (b.segments.find((x) => x.id === id) || {}).name }))
      .filter((m) => m.r0 !== m.r1).sort((x, y) => x.r1 - y.r1)
      .map((m) => `<b>${esc(m.id)}</b> ${esc(m.name)}: ${m.r0}. → ${m.r1}.`);
    if (moves.length) out.push(`Kolejność sektorów: ${moves.join("; ")}`);
    const nm = names(b), before = Object.fromEntries(a.assignments.map((x) => [x.resourceId, x.segmentId]));
    const tm = b.assignments.filter((x) => before[x.resourceId] !== x.segmentId).map((x) => `${esc(short(nm[x.resourceId]))}: ${esc(before[x.resourceId] || "-")} → <b>${esc(x.segmentId)}</b>`);
    if (tm.length) out.push(`Zespoły: ${tm.join("; ")}.`);
    out.push(`Kierunek („pod górę, w stronę Zawratu”) zgadza się z planem od żony, który silnik już znał. O zmianie decydują miejsce i godzina obserwacji.`);
    const seg = truthSeg(G.A);
    if (seg) {
      const n = (b.segments.find((x) => x.id === seg) || {}).name || "";
      const firstA = a.assignments.find((x) => x.segmentId === seg), firstB = b.assignments.find((x) => x.segmentId === seg);
      out.push(`Epilog tej fikcyjnej historii: o 20:03 śmigłowiec znalazł go w <b>${esc(seg)} ${esc(n)}</b>. Bez relacji to ${rankOf(a, seg)}. sektor` +
        `${firstA ? ` (idzie tam ${esc(short(names(a)[firstA.resourceId]))}, dojście ${Math.round(firstA.travelMin)} min)` : ""}, z relacją ${rankOf(b, seg)}.` +
        `${firstB ? ` (idzie tam ${esc(short(nm[firstB.resourceId]))}, dojście ${Math.round(firstB.travelMin)} min)` : ""}. Silnik tej odpowiedzi nie znał.`);
    }
    return out.map((x) => `<li>${x}</li>`).join("");
  }
  // segment of the scenario's (fictional) find spot, from the grid; the engine never sees it (Found was removed)
  function truthSeg(R) {
    const t = G.scen && G.scen.truth && G.scen.truth.at; if (!t || !R.bbox) return null;
    const bb = R.bbox, r = Math.floor((bb.north - t[0]) / (bb.north - bb.south) * R.rows), c = Math.floor((t[1] - bb.west) / (bb.east - bb.west) * R.cols);
    return r >= 0 && c >= 0 && r < R.rows && c < R.cols ? R.segOf[r * R.cols + c] : null;
  }

  function toggle() {
    G.on = !G.on;
    post("mapB", { type: "step", i: G.on ? G.bAfter : G.bBefore });
    const f = $("flashB"); f.classList.remove("go"); void f.offsetWidth; f.classList.add("go");
    render(true);
  }
  const NARROW = () => matchMedia("(max-width:860px)").matches;
  // phone: the 2D view's legend takes a third of a 330 px map; same-origin frame, so shrink it from here (web/ stays as is)
  function compactFrame(f) {
    try {
      const d = f.contentDocument; if (!d || d.getElementById("porCompact")) return;
      const st = d.createElement("style"); st.id = "porCompact";
      st.textContent = "#legend{padding:4px 7px!important;font-size:10px!important}#legend .lg-title{font-size:10.5px;margin-bottom:1px}" +
        "#legend .lg-ramp,#legend .lg-stops{width:150px!important}#legend .lg-ramp{height:6px}#legend .lg-stops{font-size:9px}#legend .lg-keys{gap:8px;margin-top:2px}" +
        ".maplibregl-ctrl-scale{display:none}";
      d.head.appendChild(st);
    } catch (e) { /* not reachable: leave the frame as is */ }
  }
  // phone: the user taps at the top, the change happens in map B below - bring it into view first
  $("toggle").onclick = () => { toggle(); if (NARROW()) $("colB").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion:reduce)").matches ? "auto" : "smooth", block: "start" }); };
  load().catch((e) => { $("status").textContent = "Nie udało się wczytać: " + e.message; console.error(e); });
})();
