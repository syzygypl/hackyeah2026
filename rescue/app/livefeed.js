// Symulacja 24/7 (AI Mateusza #2): a fictional daily schedule of incident starts, looping every day (Europe/Warsaw), and the
// notification bell / toasts with ACK. Shared by Centrum (centrum.js) and /app (header hook). Data contract and the server
// API proposal: docs/rescue-locator/live-feed.md. All incidents are fictional.
//
// API (ES module, no dependencies, injects its own livefeed.css):
//   SIM_NOTE                         label text: "symulacja - zdarzenia fikcyjne, w pętli dobowej"
//   simEnabled() / setSimEnabled(b)  the "Symulacja 24/7" switch (localStorage rescue-sim247, default ON)
//   loadSchedule()                   -> { entries, source: "api" | "file" }  GET /api/schedule, else /scenarios/schedule/schedule-24h.json
//   nowMs()                          wall clock (server's `now` from /api/schedule when present; ?simAt=HH:MM pins the clock for demos/tests)
//   instancesAt(entries, ms, {pastMin}) -> [{ key, id, sc, day, start, startMs, endMs, durationMin, kind, group, elapsedMin, state }]
//                                    every schedule entry of today and yesterday that started within the last pastMin minutes
//                                    (default 24 h) or is still running; state "live" (start <= now < end) | "ended"; key = id|day
//   scenarioClock(inst, s0)          "HH:MM" on the scenario's own clock for the instance's elapsed minute (s0 = its startClock)
//   describe(sc)                     -> Promise<{ name, place, startClock, ipp }> from /scenarios/<sc>.json (cached)
//   KIND_LABEL                       kind -> Polish label (góry, woda, miasto, las, droga, zapora, kolej)
//   acks                             { isAcked(key), get(key), ack(key, by) -> Promise, sync() -> Promise }: POST/GET /api/notifications
//                                    when the server has them, else localStorage rescue-live-acks (this browser only)
//   mountBell(host, opts)            bell + badge + dropdown list + toasts inside `host` (an element in a header).
//                                    opts: { openURL(inst, clock) -> url, onOpen(inst, clock, ev)?, windowMin = 60, toastMin = 15 }
//                                    returns { update(instances), destroy() }; call update() on every tick (cheap, diffed)
// Notification rule: an instance that started within toastMin and is not acked gets a toast once per page; the list shows every
// instance started within windowMin, newest first; unacked for more than 5 min = escalation (red). Sound off by default.

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
export const simEnabled = () => ls.get("rescue-sim247") !== "0";
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
function msAt(day, min) {   // Warsaw wall clock (day, minute) -> epoch ms (offset of that instant; fine outside the DST hour)
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
    for (const e of entries) {
      const s = toMin(e.start); if (s == null) continue;
      const startMs = msAt(day, s), endMs = startMs + (e.durationMin || 30) * 60000;
      if (startMs > ms) continue;
      if (ms - startMs > pastMin * 60000 && endMs <= ms) continue;
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
    return { name, place, startClock: s.startClock || null, ipp: (s.ipp && s.ipp.at) || null };
  }).catch(() => ({ name: sc, place: "", startClock: null, ipp: null }));
}

// ---------- ACK: server (shared across operators) or this browser
const ackLocal = (() => { try { return JSON.parse(ls.get("rescue-live-acks") || "{}") || {}; } catch (e) { return {}; } })();
let ackServer = null;   // null = not probed, true / false
let ackSince = 0;
const ackListeners = new Set();
export const acks = {
  get shared() { return ackServer === true; },
  isAcked: (key) => !!ackLocal[key],
  get: (key) => ackLocal[key] || null,
  async ack(key, by = "operator") {
    const [id, day] = key.split("|");
    ackLocal[key] = { at: new Date(nowMs()).toISOString(), by };
    if (ackServer !== false) {
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
let actx = null;
function beep() {
  if (!soundOn()) return;
  try { actx ||= new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(0.08, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.35);
    o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.36); } catch (e) {}
}

// ---------- bell + list + toasts
const hm = (ms) => { const m = Math.floor(warsaw(ms).min); return pad2(Math.floor(m / 60)) + ":" + pad2(m % 60); };
export function mountBell(host, opts = {}) {
  const windowMin = opts.windowMin ?? 60, toastMin = opts.toastMin ?? 15;
  const openURL = opts.openURL || ((i, clock) => `./?role=operator&mode=akcja&time=hist&sc=${encodeURIComponent(i.sc)}${clock ? "&t=" + encodeURIComponent(clock) : ""}`);
  const wrap = document.createElement("span"); wrap.className = "lfw";
  wrap.innerHTML = `<button type="button" class="lfbell" aria-haspopup="true" aria-expanded="false" title="Powiadomienia: nowe zgłoszenia (${SIM_NOTE})">`
    + `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21h4"/></svg><span class="lfbadge" hidden>0</span><span class="lfsr">Powiadomienia</span></button>`
    + `<div class="lfpanel" role="dialog" aria-label="Powiadomienia o nowych zgłoszeniach" hidden><div class="lfhead"><b>Nowe zgłoszenia</b><span class="lfsim">${esc(SIM_NOTE)}</span></div>`
    + `<div class="lflist"></div><div class="lffoot"><label><input type="checkbox" class="lfsound"> dźwięk</label><button type="button" class="lfall">Potwierdź wszystkie</button><span class="lfstore"></span></div></div>`;
  host.appendChild(wrap);
  let stack = document.querySelector(".lftoasts");
  if (!stack) { stack = document.createElement("div"); stack.className = "lftoasts"; stack.setAttribute("aria-live", "polite"); document.body.appendChild(stack); }
  const bell = wrap.querySelector(".lfbell"), panel = wrap.querySelector(".lfpanel"), list = wrap.querySelector(".lflist"), badge = wrap.querySelector(".lfbadge");
  wrap.querySelector(".lfsound").checked = soundOn();
  wrap.querySelector(".lfsound").onchange = (e) => ls.set("rescue-live-sound", e.target.checked ? "1" : "0");
  const toggle = (on) => { panel.hidden = !on; bell.setAttribute("aria-expanded", on); document.body.classList.toggle("lfopen", on); if (on) render(); };
  bell.onclick = (e) => { e.stopPropagation(); toggle(panel.hidden); };
  const outside = (e) => { if (!panel.hidden && !wrap.contains(e.target)) toggle(false); };
  const onKey = (e) => { if (e.key === "Escape" && !panel.hidden) { toggle(false); bell.focus(); } };
  document.addEventListener("click", outside); document.addEventListener("keydown", onKey);
  let insts = [], shownSig = "";
  const toasted = new Set();
  const info = {};   // sc -> describe()
  const label = (i) => { const d = info[i.sc]; return d ? d : { name: i.sc, place: "" }; };
  const clockOf = (i) => { const d = info[i.sc]; return d && d.startClock ? scenarioClock(i, d.startClock) : null; };
  const open = (i, ev) => { const c = clockOf(i); if (opts.onOpen && opts.onOpen(i, c, ev) === false) return; location.href = openURL(i, c); };
  function itemHTML(i, now, cls) {
    const d = label(i), a = acks.get(i.key), late = !a && now - i.startMs > ESCALATE_MIN * 60000;
    return `<div class="${cls}${a ? " acked" : ""}${late ? " late" : ""}" data-key="${esc(i.key)}">`
      + `<span class="lft mono">${hm(i.startMs)}</span><span class="lfn"><b>${esc(d.name)}</b><span>${esc(KIND_LABEL[i.kind] || i.kind || "")}${d.place ? " · " + esc(d.place) : ""}</span>`
      + `<span class="lfst">${i.state === "live" ? "trwa" : "zakończona"}${a ? ` · potwierdzone ${hm(Date.parse(a.at))}${a.by && a.by !== "operator" ? " (" + esc(a.by) + ")" : ""}` : late ? ` · bez potwierdzenia od ${Math.floor((now - i.startMs) / 60000)} min` : ""}</span></span>`
      + `<span class="lfb"><button type="button" class="lfopen">Otwórz</button>${a ? "" : `<button type="button" class="lfack">Potwierdź</button>`}</span></div>`;
  }
  function wire(root) {
    root.querySelectorAll("[data-key]").forEach((el) => {
      const i = insts.find((x) => x.key === el.dataset.key); if (!i) return;
      const o = el.querySelector(".lfopen"), k = el.querySelector(".lfack");
      if (o) o.onclick = (ev) => { ev.stopPropagation(); open(i, ev); };
      if (k) k.onclick = (ev) => { ev.stopPropagation(); el.classList.add("acked"); const t = el.closest(".lftoast"); if (t) t.remove(); acks.ack(i.key).then(render); };
    });
  }
  function recent(now) { return insts.filter((i) => now - i.startMs <= windowMin * 60000); }
  function render() {
    const now = nowMs(), rec = recent(now), un = rec.filter((i) => !acks.isAcked(i.key));
    const late = un.some((i) => now - i.startMs > ESCALATE_MIN * 60000);
    const n = un.length; badge.hidden = !n; badge.textContent = n > 99 ? "99+" : String(n);
    bell.classList.toggle("has", n > 0); bell.classList.toggle("late", late);
    bell.setAttribute("aria-label", `Powiadomienia: ${n} niepotwierdzonych`);
    // toasts: once per page for fresh unacked starts; a toast's escalation / ack is refreshed in place
    for (const i of rec.slice().reverse()) {
      if (toasted.has(i.key) || acks.isAcked(i.key) || now - i.startMs > toastMin * 60000) continue;
      toasted.add(i.key); const el = document.createElement("div"); el.dataset.key = i.key; stack.prepend(el); beep();
      while (stack.children.length > 4) stack.lastElementChild.remove();
    }
    for (const el of [...stack.children]) {
      const i = insts.find((x) => x.key === el.dataset.key);
      if (!i || acks.isAcked(i.key)) { el.remove(); continue; }
      const h = `<button type="button" class="lfx" title="Zamknij (zostaje w dzwonku)" aria-label="Zamknij">×</button><span class="lfnew">Nowe zgłoszenie</span>` + itemHTML(i, now, "lfti");
      if (el._h !== h) { el._h = h; el.className = "lftoast" + (h.includes(" late\"") ? " late" : ""); el.innerHTML = h; el.querySelector(".lfx").onclick = () => el.remove(); }
    }
    wire(stack);
    wrap.querySelector(".lfstore").textContent = acks.shared ? "potwierdzenia wspólne (serwer)" : "potwierdzenia tylko w tej przeglądarce";
    if (panel.hidden) return;
    const sig = JSON.stringify(rec.map((i) => [i.key, i.state, acks.get(i.key), Math.floor((now - i.startMs) / 60000) > ESCALATE_MIN, !!info[i.sc]]));
    if (sig === shownSig) return; shownSig = sig;
    list.innerHTML = rec.length ? rec.map((i) => itemHTML(i, now, "lfi")).join("") : `<div class="lfempty">Brak zgłoszeń w ostatnich ${windowMin} min.</div>`;
    wire(list);
  }
  wrap.querySelector(".lfall").onclick = () => { const now = nowMs(); Promise.all(recent(now).filter((i) => !acks.isAcked(i.key)).map((i) => acks.ack(i.key))).then(render); };
  const onAck = () => render(); ackListeners.add(onAck);
  return {
    update(list2) {
      insts = list2 || [];
      const need = [...new Set(insts.filter((i) => nowMs() - i.startMs <= windowMin * 60000).map((i) => i.sc))].filter((sc) => !info[sc]);
      if (need.length) Promise.all(need.map((sc) => describe(sc).then((d) => { info[sc] = d; }))).then(() => { shownSig = ""; for (const el of stack.children) el._h = ""; render(); });
      render();
    },
    render,
    destroy() { ackListeners.delete(onAck); document.removeEventListener("click", outside); document.removeEventListener("keydown", onKey); wrap.remove(); },
  };
}
