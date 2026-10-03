// Actor drawer (CONTRACT.md "Zasoby i dziennik"): click an actor anywhere -> its log (GET /api/actors/<id>/log) and data feeds
// (GET /api/actors/<id>/feeds) in a side drawer. Shared by the app (Na żywo feed, 2D marker), Centrum (roster) and Zasoby.
//   import { openActor } from "./actorlog.js";  openActor("drone", { sc: "zawrat", at: "19:45", onTrack: (id) => ... });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const LOOPBACK = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(location.hostname);
async function get(path) {
  const h = {}; let pin = ""; try { pin = (localStorage.getItem("rescue-pin") || "").replace(/^"(.*)"$/, "$1"); } catch (e) {}
  if (!LOOPBACK && pin) h["X-Rescue-Pin"] = pin;
  const r = await fetch(path, { headers: h, cache: "no-store" });
  if (!r.ok) throw new Error(r.status === 404 ? "brak danych o tym zespole" : r.status === 401 ? "podaj klucz akcji" : "HTTP " + r.status);
  return r.json();
}
export const KIND_LABEL = { pieszy: "Patrol pieszy", pies: "Zespół z psem", dron: "Dron", smiglowiec: "Śmigłowiec", lodz: "Łódź", nurkowie: "Nurkowie" };
const TYPES = [["all", "Wszystko"], ["dispatch", "Przydziały"], ["fix", "Pozycje"], ["search", "Przeszukania"], ["report", "Meldunki"], ["clue", "Ślady"],
  ["inventory", "Sprzęt"], ["scripted", "Scenariusz"], ["ack", "Potwierdzone"]];
const TYPE_PL = { dispatch: "przydział", status: "status", fix: "pozycja", search: "przeszukanie", report: "meldunek", clue: "ślad", inventory: "sprzęt", scripted: "scenariusz" };

let el = null, cur = null;
function ensure() {
  if (el) return el;
  if (!document.querySelector('link[data-actorlog]')) {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = new URL("actorlog.css", import.meta.url).href; l.dataset.actorlog = "1"; document.head.appendChild(l);
  }
  el = document.createElement("aside"); el.id = "alDrawer"; el.setAttribute("aria-label", "Dziennik zespołu"); el.setAttribute("aria-hidden", "true");
  document.body.appendChild(el);
  addEventListener("keydown", (e) => { if (e.key === "Escape" && el.classList.contains("open")) closeActor(); });
  return el;
}
export function closeActor() { if (!el) return; el.classList.remove("open"); el.setAttribute("aria-hidden", "true"); if (cur && cur.onClose) cur.onClose(); cur = null; }

/** opts: { sc, at, onTrack(id) - "pokaż ślad na mapie" (else a link to the app), onClose() } */
export async function openActor(id, opts = {}) {
  ensure();
  cur = { id, ...opts, filter: opts.filter || "all", log: null, feeds: null, err: null, chart: false };
  el.classList.add("open"); el.setAttribute("aria-hidden", "false");
  render();
  const q = new URLSearchParams(); if (opts.sc) q.set("sc", opts.sc); if (opts.at) q.set("at", opts.at);
  const me = cur;
  try {
    const [log, feeds] = await Promise.all([get(`/api/actors/${encodeURIComponent(id)}/log?${q}`), get(`/api/actors/${encodeURIComponent(id)}/feeds?${q}`)]);
    if (me !== cur) return;
    cur.log = log; cur.feeds = feeds;
  } catch (e) { if (me !== cur) return; cur.err = e.message; }
  render();
}

function sparkline(series, kind) {
  if (!series || series.length < 2) return `<div class="help">Za mało danych do wykresu.</div>`;
  const W = 380, H = 90, m0 = series[0][0], m1 = series[series.length - 1][0] || m0 + 1;
  const X = (m) => 4 + ((m - m0) / Math.max(1, m1 - m0)) * (W - 8), Y = (v) => H - 14 - (Math.max(0, Math.min(100, v)) / 100) * (H - 22);
  const d = series.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
  const label = kind === "dron" ? "bateria %" : kind === "smiglowiec" || kind === "lodz" ? "paliwo %" : "zmęczenie % (szacunek)";
  const hard = kind === "dron" || kind === "smiglowiec" || kind === "lodz" ? `<line x1="4" x2="${W - 4}" y1="${Y(20)}" y2="${Y(20)}" style="stroke:var(--rl-danger)" stroke-dasharray="3 3" stroke-width="1"/>` : "";
  const last = series[series.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${hard}<path d="${d}" fill="none" style="stroke:var(--rl-accent)" stroke-width="2"/>
    <circle cx="${X(last[0])}" cy="${Y(last[1])}" r="3" style="fill:var(--rl-accent)"/>
    <text x="4" y="${H - 2}" style="fill:var(--rl-mute);font:11px var(--rl-mono)">${label}</text>
    <text x="${W - 4}" y="12" text-anchor="end" style="fill:var(--rl-ink);font:600 12px var(--rl-mono)">${Math.round(last[1])}%</text></svg>`;
}
function kv(h, kind) {
  const c = [];
  const add = (v, l) => { if (v !== undefined && v !== null) c.push(`<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`); };
  if (h.dutyMin != null) add(`${Math.floor(h.dutyMin / 60)}:${String(h.dutyMin % 60).padStart(2, "0")}`, "na służbie (h:min)");
  if (h.fatiguePct != null) add(h.fatiguePct + "%", "zmęczenie (szac.)");
  if (h.distanceKm != null) add(h.distanceKm + " km", `przejście, +${h.climbM} m`);
  if (h.workMin != null) add(`${h.workMin}/${h.workLimitMin}`, "pies: min pracy / limit");
  if (h.batteryPct != null) add(h.batteryPct + "%", `bateria, ~${h.flightMinLeft} min lotu`);
  if (h.spareBatteries != null) add(h.spareBatteries, "zapasowe baterie");
  if (h.fuelPct != null) add(h.fuelPct + "%", `paliwo, ~${h.enduranceMinLeft} min`);
  if (h.maintenanceDueInH != null) add(h.maintenanceDueInH + " h", "do przeglądu");
  return c.length ? `<div class="kv">${c.join("")}</div>` : "";
}
function matches(e, f) {
  if (f === "all") return true;
  if (f === "ack") return e.acked === true;
  if (f === "radio") return e.feed === "radio";
  if (f === "dispatch") return e.type === "dispatch" || e.type === "status";
  return e.type === f;
}
function entriesHTML(entries, f) {
  const list = entries.filter((e) => matches(e, f));
  if (!list.length) return `<div class="help">Brak wpisów tego rodzaju.</div>`;
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    // runs of 3+ plain GPS fixes collapse into one line in "Wszystko"
    if (f === "all" && e.type === "fix" && e.feed !== "radio") {
      let j = i; while (j + 1 < list.length && list[j + 1].type === "fix" && list[j + 1].feed !== "radio") j++;
      if (j - i >= 2) { out.push(`<div class="ent"><span class="t">${esc(e.t)}</span><span><span class="ty">pozycje</span>${j - i + 1} pozycji GPS ${esc(e.t)}-${esc(list[j].t)}</span><span class="d">filtr „Pozycje” pokazuje każdą</span></div>`); i = j; continue; }
    }
    out.push(`<div class="ent"><span class="t">${esc(e.t)}</span><span><span class="ty ${esc(e.type)}">${esc(TYPE_PL[e.type] || e.type)}</span>${esc(e.title)}${e.acked ? ' <span class="ack" title="Potwierdzone przez operatora">✓</span>' : ""}</span>${e.detail ? `<span class="d">${esc(e.detail)}</span>` : ""}</div>`);
  }
  return out.join("");
}
function render() {
  if (!el || !cur) return;
  const L = cur.log, F = cur.feeds, kind = (L && L.kind) || "";
  const level = F && F.level, h = (F && F.health) || {};
  const lvl = level ? `<span class="lvl ${esc(level)}">${level === "red" ? "ALARM" : level === "amber" ? "UWAGA" : "OK"}</span>` : "";
  let body = "";
  if (cur.err) body = `<div class="help">Nie udało się wczytać: ${esc(cur.err)}</div>`;
  else if (!L) body = `<div class="help">Wczytuję dziennik…</div>`;
  else {
    const warns = ((F && F.warnings) || []).map((w) => `<div class="warn ${esc(w.level)}">${esc(w.text)}</div>`).join("");
    const feeds = ((F && F.feeds) || []).map((f) => {
      const st = f.status === "live" ? "na żywo" : f.status === "stale" ? "nieaktualne" : "brak";
      let btn = "";
      if ((f.kind === "gps" || f.kind === "collar") && f.status !== "off") btn = `<button data-act="track">Ślad na mapie</button>`;
      else if (f.kind === "reports") btn = `<button data-act="filter" data-f="report">W dzienniku</button>`;
      else if (f.kind === "radio") btn = `<button data-act="filter" data-f="radio">W dzienniku</button>`;
      else if (f.kind === "clues") btn = `<button data-act="filter" data-f="clue">W dzienniku</button>`;
      else if (f.kind === "telemetry") btn = `<button data-act="chart">${cur.chart ? "Ukryj wykres" : "Wykres"}</button>`;
      return `<div class="feed"><span class="dot ${esc(f.status)}" title="${st}"></span><span class="fl">${esc(f.label)}<div class="fm">${st}${f.lastAt ? ` · ostatnio ${esc(f.lastAt)}` : ""}${f.count ? ` · ${f.count}` : ""}${f.note ? ` · ${esc(f.note)}` : ""}</div></span>${btn}</div>`;
    }).join("");
    const counts = {}; for (const e of L.entries) { counts[e.type] = (counts[e.type] || 0) + 1; if (e.acked) counts.ack = (counts.ack || 0) + 1; if (e.type === "status") counts.dispatch = (counts.dispatch || 0) + 1; }
    const chips = TYPES.filter(([k]) => k === "all" || counts[k]).map(([k, l]) => `<button data-f="${k}" aria-pressed="${cur.filter === k}">${l}<span class="n">${k === "all" ? L.entries.length : counts[k]}</span></button>`).join("")
      + (cur.filter === "radio" ? `<button data-f="radio" aria-pressed="true">Radio</button>` : "");
    body = `${warns}${kv(h, kind)}
      <h3>Źródła danych</h3>${feeds || '<div class="help">Brak źródeł.</div>'}
      ${cur.chart ? `<div class="chart">${sparkline(h.series, kind)}</div>` : ""}
      <h3>Dziennik <span class="mute" style="text-transform:none;letter-spacing:0;font-weight:400">do ${esc(L.at || L.liveAt)}</span></h3>
      <div class="chips">${chips}</div>${entriesHTML(L.entries, cur.filter)}
      <div class="note">${esc(L.note || "")} Dane sprzętu i załóg są fikcyjne; zmęczenie, bateria i paliwo to szacunki z osi czasu.</div>`;
  }
  el.innerHTML = `<div class="al-h"><div><h2>${esc((L && L.name) || cur.id)}</h2>
      <div class="al-sub">${esc(KIND_LABEL[kind] || kind)}${L ? ` · ${esc(L.sc)} · ${esc(L.status || "")}` : ""} ${lvl}</div></div>
      <button class="al-x" title="Zamknij (Esc)" aria-label="Zamknij">✕</button></div><div class="al-body">${body}</div>`;
  el.querySelector(".al-x").onclick = closeActor;
  el.querySelectorAll(".chips button").forEach((b) => b.onclick = () => { cur.filter = b.dataset.f; render(); });
  el.querySelectorAll(".feed button").forEach((b) => b.onclick = () => {
    if (b.dataset.act === "filter") { cur.filter = b.dataset.f; render(); }
    else if (b.dataset.act === "chart") { cur.chart = !cur.chart; render(); }
    else if (b.dataset.act === "track") {
      if (cur.onTrack) cur.onTrack(cur.id);
      else location.href = `./?role=operator&mode=akcja&sc=${encodeURIComponent(cur.sc || (L && L.sc) || "")}&actor=${encodeURIComponent(cur.id)}`;
    }
  });
}
