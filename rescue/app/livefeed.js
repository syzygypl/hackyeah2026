// Symulacja 24/7 (AI Mateusza #2): a fictional daily schedule of incident starts, looping every day (Europe/Warsaw), and the
// notification bell / toasts with ACK. Shared by Centrum (centrum.js) and /app (header hook). Data contract and the server
// API proposal: docs/rescue-locator/live-feed.md. All incidents are fictional.
//
// API (ES module, no dependencies, injects its own livefeed.css):
//   SIM_NOTE                         label text: "symulacja - zdarzenia fikcyjne, w pętli dobowej"
//   simEnabled() / setSimEnabled(b)  the "Symulacja 24/7" switch (localStorage rescue-sim247, default ON; ?sim=0|1 overrides)
//   loadSchedule()                   -> { entries, source: "api" | "file" }  GET /api/schedule, else /scenarios/schedule/schedule-24h.json
//   msAt(day, min)                   Warsaw wall clock (YYYY-MM-DD, minutes) -> epoch ms; warsaw(ms) -> { day, min }
//   nowMs()                          wall clock (server's `now` from /api/schedule when present; ?simAt=HH:MM pins the clock for demos/tests)
//   instancesAt(entries, ms, {pastMin}) -> [{ key, id, sc, day, start, startMs, endMs, durationMin, kind, group, elapsedMin, state }]
//                                    every schedule entry of today and yesterday that started within the last pastMin minutes
//                                    (default 24 h) or is still running; state "live" (start <= now < end) | "ended"; key = id|day
//   scenarioClock(inst, s0)          "HH:MM" on the scenario's own clock for the instance's elapsed minute (s0 = its startClock)
//   describe(sc)                     -> Promise<{ name, place, startClock, ipp, calls: [{at, title, provider}] }> from /scenarios/<sc>.json (cached)
//   notesFor(insts, infoOf, ms)      -> [{ key, type: "new" | "call", inst, ms, clock, title, n }]: what the bell announces (see "notes" below)
//   KIND_LABEL                       kind -> Polish label (góry, woda, miasto, las, droga, zapora, kolej)
//   acks                             { isAcked(key), get(key), ack(key, by) -> Promise, sync() -> Promise }: POST/GET /api/notifications
//                                    when the server has them, else localStorage rescue-live-acks (this browser only)
//   mountBell(host, opts)            bell + badge + dropdown list + toasts inside `host` (an element in a header).
//                                    opts: { openURL(inst, clock, note) -> url, onOpen(inst, clock, ev, note)? (return false = handled),
//                                    windowMin = 60, toastMin = 10, toastSince? (ms: no toast for notes older than this, the backlog stays in the list) }; filters Wszystko / Nowe akcje / Zgłoszenia
//                                    returns { update(instances), destroy() }; call update() on every tick (cheap, diffed)
// Notification rule: a note (new incident or incoming call) from the last toastMin minutes, not acked, gets a toast once per page;
// the list shows every note of the last windowMin minutes, newest first; unacked for more than 5 min = escalation (red).
// ACK key: "<entry id>|<day>" for a new incident, "<entry id>#HHMM|<day>" for a call (HHMM = scenario clock). Sound off by default.

export const SIM_NOTE = "symulacja - zdarzenia fikcyjne, w pętli dobowej";
export const KIND_LABEL = { gory: "góry", woda: "woda", miasto: "miasto", las: "las", droga: "droga", zapora: "zapora (fala)", dywersja: "kolej", "mazury-burza": "burza" };
const TZ = "Europe/Warsaw";
const ESCALATE_MIN = 5;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pad2 = (n) => String(n).padStart(2, "0");
const toMin = (c) => { const m = /^(\d{1,2}):(\d{2})/.exec(c || ""); return m ? +m[1] * 60 + +m[2] : null; };
const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

{ const l = document.createElement("link"); l.rel = "stylesheet"; l.href = new URL("livefeed.css", import.meta.url).href; document.head.appendChild(l); }

// ---------- transport (PIN like centrum.js / app.js)
const LOOPBACK = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(location.hostname);
async function api(path, body) {
  const h = { "Content-Type": "application/json" };
  const pin = (ls.get("rescue-pin") || "").replace(/^"(.*)"$/, "$1"); if (!LOOPBACK && pin) h["X-Rescue-Pin"] = pin;
  const r = await fetch(path, body === undefined ? { headers: h, cache: "no-cache" } : { method: "POST", headers: h, body: JSON.stringify(body) });
  if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
  return r.json();
}

// ---------- switch
const SIM_Q = new URLSearchParams(location.search).get("sim");   // ?sim=0 / ?sim=1 overrides the stored switch (tests, links)
export const simEnabled = () => SIM_Q === "0" ? false : SIM_Q === "1" ? true : ls.get("rescue-sim247") !== "0";
export const setSimEnabled = (b) => ls.set("rescue-sim247", b ? "1" : "0");

// ---------- clock: Warsaw wall time. ?simAt=HH:MM pins "now" to that time today (demo / tests), it then runs on from there.
let skewMs = 0;
const PAGE0 = Date.now();
const SIM_AT = new URLSearchParams(location.search).get("simAt");
export function nowMs() {
  const n = Date.now() + skewMs, m = toMin(SIM_AT);
  if (m == null) return n;
  const w = warsaw(PAGE0 + skewMs);
  return msAt(w.day, m) + (n - PAGE0 - skewMs);
}
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
export function warsaw(ms) {   // { day: "YYYY-MM-DD", min: minutes since local midnight (fractional) }
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute + +p.second / 60 };
}
export function msAt(day, min) {   // Warsaw wall clock (day, minute) -> epoch ms (offset of that instant; fine outside the DST hour)
  const [y, mo, d] = day.split("-").map(Number), guess = Date.UTC(y, mo - 1, d, 0, 0) + min * 60000;
  const w = warsaw(guess), off = Math.round(((Date.UTC(...w.day.split("-").map((v, i) => i === 1 ? v - 1 : +v)) + w.min * 60000) - guess) / 60000);
  return guess - off * 60000;
}
const dayBefore = (day) => { const [y, m, d] = day.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d - 1)); return t.toISOString().slice(0, 10); };

// ---------- schedule
export async function loadSchedule() {
  try {
    const a = await api("/api/schedule");
    if (a && a.now) { const s = Date.parse(a.now); if (isFinite(s)) skewMs = s - Date.now(); }
    if (a && Array.isArray(a.entries)) return { entries: a.entries, source: "api" };
  } catch (e) { /* 404: not on the server yet */ }
  const r = await fetch("/scenarios/schedule/schedule-24h.json", { cache: "no-cache" });
  if (!r.ok) throw new Error("schedule HTTP " + r.status);
  const d = await r.json();
  return { entries: d.entries || [], source: "file" };
}
export function instancesAt(entries, ms, { pastMin = 1440 } = {}) {
  const w = warsaw(ms), out = [];
  for (const day of [dayBefore(w.day), w.day]) {
    const base = msAt(day, 0);   // once per day: cheap enough to call on every animation frame (timeline play)
    for (const e of entries) {
      const s = toMin(e.start); if (s == null) continue;
      const startMs = base + s * 60000, endMs = startMs + (e.durationMin || 30) * 60000;
      if (startMs > ms) continue;
      if (ms - startMs > pastMin * 60000 && endMs <= ms) continue;
      vdMs.set(e.id + "|" + day, { ms: startMs, type: "new" });
      out.push({ key: e.id + "|" + day, id: e.id, sc: e.sc, day, start: e.start, startMs, endMs, durationMin: e.durationMin, kind: e.kind, group: e.group || null,
        elapsedMin: Math.min(e.durationMin, (ms - startMs) / 60000), state: ms < endMs ? "live" : "ended" });
    }
  }
  return out.sort((a, b) => b.startMs - a.startMs || a.sc.localeCompare(b.sc));
}
export function scenarioClock(inst, s0) {
  const b = toMin(s0); if (b == null) return null;
  const m = (b + Math.max(0, Math.floor(inst.elapsedMin))) % 1440;
  return pad2(Math.floor(m / 60)) + ":" + pad2(m % 60);
}
const descP = {};
export function describe(sc) {
  return descP[sc] ||= api("/scenarios/" + encodeURIComponent(sc) + ".json").then((s) => {
    const t = String(s.incident || sc).replace(/\s*\(scenariusz[^)]*\)\s*/gi, " ").trim(), i = t.indexOf(" - ");
    const name = i > 0 ? t.slice(0, i) : t, place = i > 0 ? t.slice(i + 3) : "";
    const calls = (s.events || []).filter((e) => e.at && isCall(e) && !/pomijamy/i.test(e.title || "")).map((e) => ({ at: e.at.slice(0, 5), title: e.title || e.provider, provider: e.provider }));
    return { name, place, startClock: s.startClock || null, ipp: (s.ipp && s.ipp.at) || null, calls };
  }).catch(() => ({ name: sc, place: "", startClock: null, ipp: null, calls: [] }));
}

// ---------- ACK: server (shared across operators) or this browser
const ackLocal = (() => { try { return JSON.parse(ls.get("rescue-live-acks") || "{}") || {}; } catch (e) { return {}; } })();
let ackServer = null;   // null = not probed, true / false
let ackSince = 0;
const ackListeners = new Set();
// virtual dispatcher (sens-funkcji #5): in Symulacja 24/7 nobody sits at the desk, so every schedule note (a new incident or a
// call) is acknowledged by a simulated dispatcher 1-3 min after it arrives (deterministic from its key); about 1 new incident in 16
// (~one every 3 h, also deterministic) is left unacknowledged on purpose: that one escalates. Doradca notes (adv:) and anything
// not from the schedule keep the human ACK. ?dyzurny=0 switches it off (tests of the human ACK / escalation path).
const VD_Q = new URLSearchParams(location.search).get("dyzurny");
export const virtualDispatcher = () => VD_Q !== "0" && simEnabled();
export const VD_BY = "dyżurny wirtualny (symulacja)";
const vdMs = new Map();   // key -> { ms, type } of schedule notes (filled by instancesAt / notesFor)
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
export const vdEscalates = (key) => !key.includes("#") && hash("esc" + key) % 16 === 0;
function vdAck(key) {
  if (!virtualDispatcher()) return null;
  const v = vdMs.get(key); if (!v) return null;
  const head = key.split("#")[0].split("|")[0] + "|" + key.split("|")[1];
  if (vdEscalates(head)) return null;   // the incident left for the human, with all its calls
  const at = v.ms + (60 + hash(key) % 121) * 1000;
  return nowMs() >= at ? { at: new Date(at).toISOString(), by: VD_BY, virtual: true } : null;
}
export const acks = {
  get shared() { return ackServer === true; },
  isAcked: (key) => !!(ackLocal[key] || vdAck(key)),
  get: (key) => ackLocal[key] || vdAck(key),
  async ack(key, by = "operator") {
    const [id, day] = key.split("|");
    ackLocal[key] = { at: new Date(nowMs()).toISOString(), by };
    if (ackServer !== false && !id.startsWith("adv:")) {   // Doradca notes (#1) are not schedule ids: the server would 404 and switch shared ACKs off
      try { const r = await api(`/api/notifications/${encodeURIComponent(id)}/ack`, { day, by }); ackServer = true; if (r && r.ackedAt) ackLocal[key] = { at: r.ackedAt, by: r.by || by }; }
      catch (e) { if (e.status === 404 || e.status === 405) ackServer = false; }
    }
    persist(); ackListeners.forEach((f) => f());
  },
  async sync() {
    if (ackServer === false) return;
    try {
      const r = await api("/api/notifications?since=" + ackSince); ackServer = true;
      for (const a of r.acks || []) { const k = a.id + "|" + a.day; if (!ackLocal[k]) ackLocal[k] = { at: a.ackedAt, by: a.by }; }
      if (r.now) { const n = Date.parse(r.now); if (isFinite(n)) ackSince = n; }
      persist(); ackListeners.forEach((f) => f());
    } catch (e) { if (e.status === 404 || e.status === 405) ackServer = false; }
  },
};
function persist() {   // keep two days of local ACKs
  const cut = dayBefore(warsaw(nowMs()).day);
  for (const k of Object.keys(ackLocal)) if ((k.split("|")[1] || "") < cut) delete ackLocal[k];
  ls.set("rescue-live-acks", JSON.stringify(ackLocal));
}

// ---------- sound (off by default), one short beep via WebAudio
const soundOn = () => ls.get("rescue-live-sound") === "1";
// system notifications (#1): only after the operator ticks the box (browser permission), only while the tab is in the background
const NOTIF = typeof Notification !== "undefined";
const notifyOn = () => NOTIF && ls.get("rescue-live-notify") === "1" && Notification.permission === "granted";
function sysNotify(title, body, tag, onclick) {
  if (!notifyOn() || !document.hidden) return;
  try { const x = new Notification(title, { body, tag, renotify: false }); x.onclick = () => { try { window.focus(); } catch (e) {} x.close(); if (onclick) onclick(); }; } catch (e) {}
}
let actx = null;
function beep() {
  if (!soundOn()) return;
  try { actx ||= new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(0.08, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.35);
    o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.36); } catch (e) {}
}

// ---------- notes: what the bell announces. Two types:
//   "new"  = a schedule occurrence starts (the 112 report that opens the incident)
//   "call" = an incoming call inside a running occurrence: the scenario's own call-like events (CPR 112 / BTS = Cell112Fix,
//            witnesses, "Zgłoszenie", "Widziałem", family, club radio, RatunekPing) at their scenario clock mapped onto the wall clock
//            of the occurrence; calls of one occurrence within 2 min are grouped into one note (bursts)
// note = { key, type, inst, ms, clock (scenario clock, Historia at that minute), title, n }
const CALL_RX = /świad|zgłosze|zgłasza|widział|telefon|dzwoni|\b112\b|radio|relacja|partner|rodzin|mieszka|kierowc|SMS/i;
export const isCall = (e) => e.provider === "Cell112Fix" || e.provider === "RatunekPing" || (e.provider === "Clue" && CALL_RX.test(e.title || ""));
export function notesFor(insts, infoOf, ms) {
  const out = [];
  for (const i of insts) {
    const d = infoOf(i.sc), s0 = d && toMin(d.startClock);
    out.push({ key: i.key, type: "new", inst: i, ms: i.startMs, clock: d && d.startClock, title: d ? d.name : i.sc, n: 1 });
    if (s0 == null) continue;
    let g = null;
    for (const c of d.calls || []) {
      const off = ((toMin(c.at) - s0) % 1440 + 1440) % 1440, t = i.startMs + off * 60000;
      if (off === 0 || off > i.durationMin || t > ms) continue;   // the report itself is the "new" note
      if (g && t - g.last <= 2 * 60000) { g.n++; g.last = t; g.title += " · " + c.title; continue; }
      g = { key: `${i.id}#${c.at.replace(":", "")}|${i.day}`, type: "call", inst: i, ms: t, last: t, clock: c.at, title: c.title, n: 1 };
      out.push(g); vdMs.set(g.key, { ms: t, type: "call" });
    }
  }
  return out.sort((a, b) => b.ms - a.ms || (a.type === "new") - (b.type === "new"));
}

// ---------- bell + list + toasts
const hm = (ms) => { const m = Math.floor(warsaw(ms).min); return pad2(Math.floor(m / 60)) + ":" + pad2(m % 60); };
const ICON = {
  adv: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20h20zM12 10v4M12 17v.5"/></svg>',
  new: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18v-5a5 5 0 0 1 10 0v5M5 18h14v3H5zM12 3v2M4.5 6.5 6 8M19.5 6.5 18 8"/></svg>',
  call: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>',
};
const TYPE_LABEL = { new: "Nowa akcja", call: "Zgłoszenie", adv: "Doradca: wspólne źródło" };
// path "województwo → rejon → nazwa" from the Centrum map block when it is there (window.rescueCentrum.incidentPath / pathOf)
function pathOf(sc, d) {
  try {
    const rc = window.rescueCentrum, p = rc && (rc.incidentPath ? rc.incidentPath(sc) : rc.pathOf ? rc.pathOf({ sc, place: d.place, title: d.name }) : null);
    if (p && p !== sc) return String(p);
  } catch (e) {}
  return null;
}
export function mountBell(host, opts = {}) {
  const windowMin = opts.windowMin ?? 60, toastMin = opts.toastMin ?? 10;
  const openURL = opts.openURL || ((i, clock) => `./?role=operator&mode=akcja&time=hist&sc=${encodeURIComponent(i.sc)}${clock ? "&t=" + encodeURIComponent(clock) : ""}`);
  const wrap = document.createElement("span"); wrap.className = "lfw";
  wrap.innerHTML = `<button type="button" class="lfbell" aria-haspopup="true" aria-expanded="false" title="Powiadomienia: nowe akcje i zgłoszenia (${SIM_NOTE})">`
    + `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21h4"/></svg><span class="lfbadge" hidden>0</span><span class="lfsr">Powiadomienia</span></button>`
    + `<div class="lfpanel" role="dialog" aria-label="Powiadomienia: nowe akcje i zgłoszenia" hidden><div class="lfhead"><b>Powiadomienia</b><span class="lfsim">${esc(SIM_NOTE)}</span><span class="lfkpi" hidden></span>`
    + `<span class="lffil" role="group" aria-label="Filtr"><button type="button" data-f="all" class="on">Wszystko</button><button type="button" data-f="new">Nowe akcje</button><button type="button" data-f="call">Zgłoszenia</button></span></div>`
    + `<div class="lflist"></div><div class="lffoot"><label><input type="checkbox" class="lfsound"> dźwięk</label>${NOTIF ? `<label title="Powiadomienie systemowe, gdy karta jest w tle (przeglądarka zapyta o zgodę)"><input type="checkbox" class="lfnotify"> powiadomienia systemowe</label>` : ""}<button type="button" class="lfall">Potwierdź wszystkie</button><span class="lfstore"></span></div></div>`;
  host.appendChild(wrap);
  let stack = document.querySelector(".lftoasts");
  if (!stack) { stack = document.createElement("div"); stack.className = "lftoasts"; stack.setAttribute("aria-live", "polite"); document.body.appendChild(stack); }
  const bell = wrap.querySelector(".lfbell"), panel = wrap.querySelector(".lfpanel"), list = wrap.querySelector(".lflist"), badge = wrap.querySelector(".lfbadge");
  let filter = "all";
  wrap.querySelectorAll(".lffil button").forEach((b) => b.onclick = (e) => { e.stopPropagation(); filter = b.dataset.f; wrap.querySelectorAll(".lffil button").forEach((x) => x.classList.toggle("on", x === b)); shownSig = ""; render(); });
  wrap.querySelector(".lfsound").checked = soundOn();
  wrap.querySelector(".lfsound").onchange = (e) => ls.set("rescue-live-sound", e.target.checked ? "1" : "0");
  const nb = wrap.querySelector(".lfnotify");
  if (nb) {
    nb.checked = notifyOn();
    nb.onchange = async (e) => {
      if (!e.target.checked) { ls.set("rescue-live-notify", "0"); return; }
      let p = Notification.permission; if (p === "default") { try { p = await Notification.requestPermission(); } catch (err) { p = "denied"; } }
      ls.set("rescue-live-notify", p === "granted" ? "1" : "0"); e.target.checked = p === "granted";
      if (p === "denied") e.target.title = "Przeglądarka blokuje powiadomienia dla tej strony - zmień w ustawieniach witryny";
    };
  }
  const toggle = (on) => { panel.hidden = !on; bell.setAttribute("aria-expanded", on); document.body.classList.toggle("lfopen", on); if (on) render(); };
  bell.onclick = (e) => { e.stopPropagation(); toggle(panel.hidden); };
  const outside = (e) => { if (!panel.hidden && !wrap.contains(e.target)) toggle(false); };
  const onKey = (e) => { if (e.key === "Escape" && !panel.hidden) { toggle(false); bell.focus(); } };
  document.addEventListener("click", outside); document.addEventListener("keydown", onKey);
  let insts = [], notes = [], shownSig = "";
  const toasted = new Set(), escalated = new Set();   // escalated (#1, feature C): a note that just passed 5 min unacked toasts once more, red
  const info = {};   // sc -> describe()
  const open = (n, ev) => { if (n.type === "adv") { if (n.onOpen) n.onOpen(ev); else if (n.url) location.href = n.url; return; } if (opts.onOpen && opts.onOpen(n.inst, n.clock, ev, n) === false) return; location.href = openURL(n.inst, n.clock, n); };
  function itemHTML(n, now, cls) {
    if (n.type === "adv") {   // { key, type: "adv", ms, title, sub, st, onOpen?, url? } from opts.extraNotes
      const a = acks.get(n.key), late = !a && now - n.ms > ESCALATE_MIN * 60000;
      return `<div class="${cls} t-adv${a ? " acked" : ""}${late ? " late" : ""}" data-key="${esc(n.key)}">`
        + `<span class="lft"><span class="lfic" title="Doradca">${ICON.adv}</span><span class="mono">${hm(n.ms)}</span></span>`
        + `<span class="lfn"><span class="lfty">${TYPE_LABEL.adv}</span><b>${esc(n.title)}</b><span class="lfp">${esc(n.sub || "")}</span>`
        + `<span class="lfst">${esc(n.st || "")}${a ? ` · potwierdzone ${hm(Date.parse(a.at))}` : late ? ` · bez potwierdzenia od ${Math.floor((now - n.ms) / 60000)} min` : ""}</span></span>`
        + `<span class="lfb"><button type="button" class="lfopen">Otwórz</button>${a ? "" : `<button type="button" class="lfack">Potwierdź</button>`}</span></div>`;
    }
    const d = info[n.inst.sc] || { name: n.inst.sc, place: "" }, a = acks.get(n.key), late = !a && now - n.ms > ESCALATE_MIN * 60000;
    const path = pathOf(n.inst.sc, d) || [KIND_LABEL[n.inst.kind] || n.inst.kind, d.place].filter(Boolean).join(" · ");
    const head = n.type === "new" ? d.name : (n.n > 1 ? `${n.n} zgłoszenia: ` : "") + n.title;
    const st = n.type === "new" ? (n.inst.state === "live" ? "trwa" : "zakończona") : d.name;   // R3-12: only the wall clock is visible, the scenario clock in the title
    return `<div class="${cls} t-${n.type}${a ? " acked" : ""}${late ? " late" : ""}" data-key="${esc(n.key)}">`
      + `<span class="lft"><span class="lfic" title="${TYPE_LABEL[n.type]}">${ICON[n.type]}</span><span class="mono">${hm(n.ms)}</span></span>`
      + `<span class="lfn"><span class="lfty">${TYPE_LABEL[n.type]}</span><b>${esc(head)}</b><span class="lfp">${esc(path)}</span>`
      + `<span class="lfst"${n.type !== "new" && n.clock ? ` title="godzina w scenariuszu ${esc(n.clock)}"` : ""}>${esc(st)}${a && a.virtual ? ` · potwierdził: ${esc(VD_BY)}, ${hm(Date.parse(a.at))}` : a ? ` · potwierdzone ${hm(Date.parse(a.at))}${a.by && a.by !== "operator" ? " (" + esc(a.by) + ")" : ""}` : late ? ` · bez potwierdzenia od ${Math.floor((now - n.ms) / 60000)} min` : ""}</span></span>`
      + `<span class="lfb"><button type="button" class="lfopen">Otwórz</button>${a ? "" : `<button type="button" class="lfack">Potwierdź</button>`}</span></div>`;
  }
  function wire(root) {
    root.querySelectorAll(".lfi[data-key], .lfti[data-key]").forEach((el) => {
      const n = notes.find((x) => x.key === el.dataset.key); if (!n) return;
      const o = el.querySelector(".lfopen"), k = el.querySelector(".lfack");
      if (o) o.onclick = (ev) => { ev.stopPropagation(); open(n, ev); };
      if (k) k.onclick = (ev) => { ev.stopPropagation(); el.classList.add("acked"); const t = el.closest(".lftoast"); if (t) t.remove(); acks.ack(n.key).then(render); };
    });
  }
  const recent = (now) => notes.filter((n) => now - n.ms <= windowMin * 60000);
  // sens-funkcji #25: with many incidents the bell held one row per call. Calls of one action (occurrence) are grouped into one
  // row "Huzele: 3 zgłoszenia" with "Potwierdź 3"; the single calls open under it (details). One call = the plain row as before.
  const openG = new Set();
  const zgl = (n) => { const d = n % 10, t = n % 100; return n + (n === 1 ? " zgłoszenie" : d >= 2 && d <= 4 && (t < 12 || t > 14) ? " zgłoszenia" : " zgłoszeń"); };
  function groupHTML(ns, now) {
    const i = ns[0].inst, d = info[i.sc] || { name: i.sc }, un = ns.filter((n) => !acks.isAcked(n.key)).length;
    const late = ns.some((n) => !acks.isAcked(n.key) && now - n.ms > ESCALATE_MIN * 60000);
    return `<details class="lfgrp" data-g="${esc(i.key)}"${openG.has(i.key) ? " open" : ""}><summary class="lfi lfgs t-call${un ? "" : " acked"}${late ? " late" : ""}">`
      + `<span class="lft"><span class="lfic" title="${TYPE_LABEL.call}">${ICON.call}</span><span class="mono">${hm(ns[0].ms)}</span></span>`
      + `<span class="lfn"><span class="lfty">Zgłoszenia</span><b>${esc(String(d.place || d.name).split(/[,:]/)[0])}: ${zgl(ns.length)}</b><span class="lfp">${esc(d.name)}</span><span class="lfst">${un ? `niepotwierdzone: ${un}` : "wszystkie potwierdzone"} · kliknij, aby rozwinąć</span></span>`
      + `<span class="lfb">${un ? `<button type="button" class="lfgack">Potwierdź ${un}</button>` : ""}</span></summary>${ns.map((n) => itemHTML(n, now, "lfi")).join("")}</details>`;
  }
  function listHTML(shown, now) {
    const rows = [], by = new Map();
    for (const n of shown) {
      if (n.type === "call" && n.inst) { const g = by.get(n.inst.key); if (g) { g.push(n); continue; } const ng = [n]; by.set(n.inst.key, ng); rows.push(ng); }
      else rows.push([n]);
    }
    return rows.map((g) => g.length < 2 ? itemHTML(g[0], now, "lfi") : groupHTML(g, now)).join("");
  }
  function kpi() {   // time from a note to its ACK over the notes the bell holds (#1: the pitch's response number); minutes, rounded
    const d = notes.map((n) => { const a = acks.get(n.key); return a ? (Date.parse(a.at) - n.ms) / 60000 : null; }).filter((x) => x != null && x >= 0).sort((a, b) => a - b);
    if (!d.length) return { n: 0 };
    const med = d.length % 2 ? d[(d.length - 1) / 2] : (d[d.length / 2 - 1] + d[d.length / 2]) / 2, r1 = (x) => (Math.round(x * 10) / 10).toString().replace(".", ",");
    return { n: d.length, med: r1(med), max: r1(d[d.length - 1]) };
  }
  function render() {
    const now = nowMs();
    notes = notesFor(insts, (sc) => info[sc], now);
    if (opts.extraNotes) { try { notes = notes.concat(opts.extraNotes(now) || []).sort((a, b) => b.ms - a.ms); } catch (e) {} }   // host notes (Centrum: Doradca ALARM, #1)
    const rec = recent(now), un = rec.filter((n) => !acks.isAcked(n.key));
    const late = un.some((n) => now - n.ms > ESCALATE_MIN * 60000);
    const cnt = un.length; badge.hidden = !cnt; badge.textContent = cnt > 99 ? "99+" : String(cnt);
    bell.classList.toggle("has", cnt > 0); bell.classList.toggle("late", late);
    bell.setAttribute("aria-label", `Powiadomienia: ${cnt} niepotwierdzonych`);
    // toasts: once per page for fresh unacked notes (scenario info loaded, so the text is final); refreshed in place
    for (const n of rec.slice().reverse()) {
      if (toasted.has(n.key) || acks.isAcked(n.key) || now - n.ms > toastMin * 60000 || (opts.toastSince && n.ms < opts.toastSince) || (n.type !== "adv" && !info[n.inst.sc])) continue;
      toasted.add(n.key); const el = document.createElement("div"); el.dataset.key = n.key; stack.prepend(el); beep();
      { const d = (n.inst && info[n.inst.sc]) || { place: n.sub }; sysNotify(`${TYPE_LABEL[n.type] || "Powiadomienie"}: ${n.title}`, [d.place, SIM_NOTE].filter(Boolean).join(" · "), n.key, () => open(n)); }
      while (stack.children.length > 3) stack.lastElementChild.remove();
    }
    for (const n of rec) {   // client side only: no chat posts, no server writes
      const age = now - n.ms;
      if (escalated.has(n.key) || acks.isAcked(n.key) || age <= ESCALATE_MIN * 60000 || age > (ESCALATE_MIN + 2) * 60000 || (opts.toastSince && n.ms < opts.toastSince) || (n.type !== "adv" && !info[n.inst.sc])) continue;
      escalated.add(n.key); toasted.add(n.key);
      if (![...stack.children].some((el) => el.dataset.key === n.key)) { const el = document.createElement("div"); el.dataset.key = n.key; stack.prepend(el); beep(); while (stack.children.length > 3) stack.lastElementChild.remove(); }
    }
    for (const el of [...stack.children]) {
      const n = notes.find((x) => x.key === el.dataset.key);
      if (!n || acks.isAcked(n.key)) { el.remove(); continue; }
      const h = `<button type="button" class="lfx" title="Zamknij (zostaje w dzwonku)" aria-label="Zamknij">×</button>` + itemHTML(n, now, "lfti");
      if (el._h !== h) { el._h = h; el.className = `lftoast t-${n.type}` + (h.includes(" late\"") ? " late" : ""); el.innerHTML = h; el.querySelector(".lfx").onclick = () => el.remove(); }
    }
    wire(stack);
    const k = kpi(); const ke = wrap.querySelector(".lfkpi");
    if (ke) { ke.hidden = !k.n; ke.textContent = k.n ? `${notes.some((n) => (acks.get(n.key) || {}).virtual) ? "Symulacja (dyżurny wirtualny) - " : ""}Czas do potwierdzenia: mediana ${k.med} min, najdłużej ${k.max} min (${k.n} potw.)` : ""; }
    wrap.querySelector(".lfstore").textContent = acks.shared ? "potwierdzenia wspólne (serwer)" : "potwierdzenia tylko w tej przeglądarce";
    if (panel.hidden) return;
    const shown = rec.filter((n) => filter === "all" || n.type === filter);
    const sig = JSON.stringify([filter, shown.map((n) => [n.key, n.inst ? n.inst.state : n.st, acks.get(n.key), Math.floor((now - n.ms) / 60000) > ESCALATE_MIN, !!(n.inst && info[n.inst.sc]), n.n])]);
    if (sig === shownSig) return; shownSig = sig;
    list.innerHTML = shown.length ? listHTML(shown, now) : `<div class="lfempty">Brak ${filter === "call" ? "zgłoszeń" : filter === "new" ? "nowych akcji" : "powiadomień"} w ostatnich ${windowMin} min.</div>`;
    wire(list);
    list.querySelectorAll("details.lfgrp").forEach((g) => {
      g.ontoggle = () => { if (g.open) openG.add(g.dataset.g); else openG.delete(g.dataset.g); };
      const b = g.querySelector(".lfgack"); if (b) b.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); Promise.all(shown.filter((n) => n.type === "call" && n.inst && n.inst.key === g.dataset.g && !acks.isAcked(n.key)).map((n) => acks.ack(n.key))).then(render); };
    });
  }
  wrap.querySelector(".lfall").onclick = () => { const now = nowMs(); Promise.all(recent(now).filter((n) => !acks.isAcked(n.key) && (filter === "all" || n.type === filter)).map((n) => acks.ack(n.key))).then(render); };
  const onAck = () => render(); ackListeners.add(onAck);
  return {
    update(list2) {
      insts = list2 || [];
      const need = [...new Set(insts.filter((i) => i.state === "live" || nowMs() - i.startMs <= windowMin * 60000).map((i) => i.sc))].filter((sc) => !info[sc]);
      if (need.length) Promise.all(need.map((sc) => describe(sc).then((d) => { info[sc] = d; }))).then(() => { shownSig = ""; for (const el of stack.children) el._h = ""; render(); });
      render();
    },
    render,
    get notes() { return notes; },
    kpi,
    destroy() { ackListeners.delete(onAck); document.removeEventListener("click", outside); document.removeEventListener("keydown", onKey); wrap.remove(); },
  };
}
