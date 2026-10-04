// Rescue Locator - compact dock: event kinds, groups, timeline markers, ticker and the group card. Pure functions (no DOM state),
// shared by the operator app (app.js, #tlMarks / #ticker / #tlTip in index.html) and Ćwiczenia (cwiczenia.js). Styles: dock.css.
// Moved out of app.js unchanged (refactor, AI Marcina 2026-10-03); the dock behaviour and its owner (AI Mateusza) stay the same.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// ---------- compact dock (Mateusz): kind markers on the timeline, a tiny tooltip "HH:MM · short title", a ticker of the last
// events (newest first; the current one is the #clock line). Cards stay behind ☰ Sygnały. Kinds: ślad, nic (searched), pogoda,
// zespół (live dispatch / report), znaleziono (TOPR red), baza (terrain / rings / cost at the start, a small dot).
export function evKind(s) {
  const k = s.kind || "";
  if (k === "found" || s.source === "Found" || /^ZNALEZIONO/i.test(s.label || "")) return "found";
  if (k === "searched") return "nic";
  if (k === "weather" || k === "conditions") return "pogoda";
  if (["terrain", "cost", "difficulty", "rings", "behaviour"].includes(k)) return "baza";
  return "slad";
}
export function shortEv(label, k) {
  const t = String(label || "").replace(/\s+/g, " ").trim(), w = (x) => x.split(" ").filter(Boolean), cut = (a) => a.join(" ").replace(/[,.;:]+$/, "");
  if (k === "found") return "Znaleziono";
  const [p, ...r] = t.split(": "), rest = r.join(": ").split(",")[0];
  if (k === "nic") return cut(w(p).slice(0, 2)) + " - nic";
  if (rest && w(p).length <= 3) return w(p).length >= 2 ? cut(w(p)) : p + ": " + cut(w(rest).slice(0, 3));
  return cut(w(t.split(",")[0]).slice(0, 4));
}
// marker colour per step kind from the --rl-ev-* tokens (ported from b069c21, AI Andrzeja); our kind class keeps the shape
export const EV_COL = { terrain: "--rl-ev-terrain", cost: "--rl-ev-terrain", difficulty: "--rl-ev-terrain", conditions: "--rl-ev-weather", weather: "--rl-ev-weather",
  rings: "--rl-ev-rings", route: "--rl-ev-route", containment: "--rl-ev-car", sector: "--rl-ev-phone", corridor: "--rl-ev-phone", fix: "--rl-ev-phone",
  searched: "--rl-ok", found: "--rl-danger", clue: "--rl-accent", report: "--rl-accent" };
// event groups (Mateusz): events at (nearly) the same moment - the start setup (terrain, weather, rings, IPP) or several events within
// EV_GROUP_MIN minutes of the group's first one - are ONE marker on the timeline (count badge, tooltip lists them all), one ticker
// item and one event card; a click lands on the group's last minute, so all of its events are in force. Steps without a minute
// are groups of their own. Same rule for Kino (AI Andrzeja): window.rescueApp.eventGroups().
export const EV_GROUP_MIN = 2;
export function evGroups(R) {
  const out = [];
  (R && R.steps || []).forEach((s, i) => {
    const m = Number.isFinite(s.minute) ? s.minute : null, g = out[out.length - 1];
    if (g && m != null && g.first != null && m - g.first <= EV_GROUP_MIN) { g.ks.push(i + 1); g.minute = m; }
    else out.push({ first: m, minute: m, ks: [i + 1] });
  });
  return out;
}
export const groupOf = (gs, k) => gs.findIndex((g) => g.ks.includes(k));
// the kind a group's marker shows: a find wins, else the last event that is not background ("baza")
export function grpKind(R, g) { const ks = g.ks.map((k) => evKind(R.steps[k - 1])); return ks.includes("found") ? "found" : [...ks].reverse().find((x) => x !== "baza") || ks[ks.length - 1]; }
// timeline markers: one <i class="tlk"> per group; fut(g) = after the cursor, left(g, j) = position in % on the track
export function marksHTML(R, G, cg, fut, left) {
  return G.map((g, j) => {
    const last = g.ks[g.ks.length - 1], kind = grpKind(R, g), ks = R.steps[(g.ks.find((k) => evKind(R.steps[k - 1]) === kind) || last) - 1];
    return `<i class="tlk k-${kind}${g.ks.length > 1 ? " grp" : ""}${j === cg ? " cur" : fut(g) ? " fut" : ""}"${g.ks.length > 1 ? ` data-n="${g.ks.length}"` : ""} style="left:${left(g, j)}%${kind !== "found" && EV_COL[ks.kind] ? `;--c:var(${EV_COL[ks.kind]})` : ""}"></i>`;
  }).join("");
}
// ticker items {at, label, title, k, more?, step?, min?} -> pills, newest first as given
export function tickerHTML(items) {
  return items.map((it) => `<span class="tk k-${it.k}"${it.step ? ` data-step="${it.step}"` : ""}${it.min != null ? ` data-min="${it.min}"` : ""} title="${esc(it.title.includes("\n") ? it.title : it.at + " · " + it.title)}"><i></i><b>${esc(it.at)}</b><span class="tx">${esc(shortEv(it.label, it.k))}${it.more ? ` <em class="more">+${it.more}</em>` : ""}</span></span>`).join("");
}
// the group card (tooltip): one line per event "HH:MM · short title"
export function tipHTML(R, g) {
  return g.ks.map((k) => { const s = R.steps[k - 1]; return `<div>${esc(s.t)} · ${esc(shortEv(s.label, evKind(s)))}</div>`; }).join("");
}
// ---------- event focus (ASK Mateusza): a click on a timeline event zooms the 2D map onto the area that event changed.
// focusTarget(ev, R, k) -> { bbox: [[w, s], [e, n]], kind, segIds } | null. ev = an optional feed / live event ({kind, segmentId,
// team, lat, lon}: Ćwiczenia feed, Na żywo), R = the run document, k = 1-based step. Weather and the start setup do not zoom.
// focusUnion(targets) joins a group's areas (events within EV_GROUP_MIN minutes).
const M_LAT = 111320, MIN_R = 150;
function circleBox(lat, lon, r) { const d = Math.max(MIN_R, +r || 0), dy = d / M_LAT, dx = d / (M_LAT * Math.cos(lat * Math.PI / 180)); return [[lon - dx, lat - dy], [lon + dx, lat + dy]]; }
function ptsBox(lonlat) { if (!lonlat.length) return null; let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity; for (const [x, y] of lonlat) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); } return [[w, s], [e, n]]; }
function joinBox(a, b) { return !a ? b : !b ? a : [[Math.min(a[0][0], b[0][0]), Math.min(a[0][1], b[0][1])], [Math.max(a[1][0], b[1][0]), Math.max(a[1][1], b[1][1])]]; }
function segPolys(R, k, ids) {   // [lon, lat] rings of the given segments (the step's own list, else any step that has them)
  const out = [];
  for (const id of ids) {
    const s = (R.steps[k - 1] && R.steps[k - 1].segments || []).find((x) => x.id === id) || (R.steps.flatMap((st) => st.segments || []).find((x) => x.id === id));
    if (s && Array.isArray(s.polygon)) out.push(...s.polygon);
  }
  return out;
}
function teamPos(R, k, team) { const r = team && (R.steps[k - 1] && R.steps[k - 1].resources || []).find((x) => x.id === team); return r && Array.isArray(r.position) ? r.position : null; }
export function focusTarget(ev, R, k) {
  if (!R || !Array.isArray(R.steps)) return null;
  const s = R.steps[k - 1], prev = R.steps[k - 2];
  if (ev && Number.isFinite(+ev.lat) && Number.isFinite(+ev.lon) && ev.lat !== null) return { bbox: circleBox(+ev.lat, +ev.lon, ev.radiusM), kind: ev.kind === "found" ? "found" : "clue", segIds: [] };
  if (ev && ev.segmentId) {
    let b = ptsBox(segPolys(R, k || R.steps.length, [ev.segmentId])); const p = teamPos(R, k || R.steps.length, ev.team);
    if (p) b = joinBox(b, circleBox(p[0], p[1], MIN_R));
    return b ? { bbox: b, kind: ev.kind === "dispatch" ? "dispatch" : "search", segIds: [ev.segmentId] } : null;
  }
  if (!s) return null;
  const kind = evKind(s);
  if (kind === "pogoda" || kind === "baza") return null;
  const h = (R.hints || []).find((x) => x.id === s.hintId) || {};
  if (kind === "nic") {   // searched / coverage: the hint's segments, else the segments whose cumulative POD rose at this step
    let ids = Array.isArray(h.segments) ? h.segments : [];
    if (!ids.length && s.segmentHistory) ids = Object.keys(s.segmentHistory).filter((id) => (s.segmentHistory[id].cumPod || 0) > ((prev && prev.segmentHistory && prev.segmentHistory[id] || {}).cumPod || 0));
    const b = ptsBox(segPolys(R, k, ids));
    return b ? { bbox: b, kind: "search", segIds: ids } : null;
  }
  // a dispatch step: a team whose assigned segment changed -> that segment + the team's position
  const asg = (a) => new Map((a || []).map((x) => [x.resourceId || x.team || x.id, x.segmentId]));
  const now = asg(s.assignments), was = asg(prev && prev.assignments);
  const moved = [...now].filter(([t, seg]) => seg && was.get(t) !== seg);
  if (moved.length && !h.center && !h.marker && !h.points) {
    let b = null; for (const [t, seg] of moved) { b = joinBox(b, ptsBox(segPolys(R, k, [seg]))); const p = teamPos(R, k, t); if (p) b = joinBox(b, circleBox(p[0], p[1], MIN_R)); }
    return b ? { bbox: b, kind: "dispatch", segIds: moved.map(([, seg]) => seg) } : null;
  }
  // a point (clue, sighting, report, phone sector, find) with its accuracy radius; a line (route, corridor, containment)
  let b = null;
  if (Array.isArray(h.center)) b = circleBox(h.center[0], h.center[1], h.radiusM);
  if (Array.isArray(h.marker)) b = joinBox(b, circleBox(h.marker[0], h.marker[1], MIN_R));
  if (Array.isArray(h.points) && h.points.length) b = joinBox(b, ptsBox(h.points.map((p) => [p[1], p[0]])));
  return b ? { bbox: b, kind: kind === "found" ? "found" : "clue", segIds: [] } : null;
}
export function focusUnion(ts) {
  const t = ts.filter(Boolean); if (!t.length) return null;
  return { bbox: t.reduce((b, x) => joinBox(b, x.bbox), null), kind: t.some((x) => x.kind === "found") ? "found" : t[t.length - 1].kind, segIds: [...new Set(t.flatMap((x) => x.segIds || []))] };
}
// hover-hold (Mateusz 2026-10-04): a panel opens on hover and stays open a while after the pointer leaves. Shared helper - the dock
// uses it, the right panels and the 2D legend may too. hoverHold(el, {intentMs, holdMs, onOpen, onClose, cls}) toggles `cls`
// (default "peek") on el: mouse/pen = open after intentMs over el (passing over does nothing), close holdMs after leaving, re-entry
// cancels; keyboard = open on focus inside, close holdMs after focus leaves; touch = a tap opens, close holdMs after the last touch
// or at once on a tap outside; held open while a pointer is pressed inside (slider scrub). Esc closes. Reduced motion: the CSS
// (@media prefers-reduced-motion) drops the animation, the timing stays. Returns {open, close, isOpen}.
export function hoverHold(el, { intentMs = 150, holdMs = 3000, onOpen, onClose, cls = "peek" } = {}) {
  if (!el) return null;
  let on = false, t = 0, down = false, hover = false;
  const set = (v) => { clearTimeout(t); if (v === on) return; on = v; el.classList.toggle(cls, v); const f = v ? onOpen : onClose; if (f) f(el); };
  const later = (v, ms) => { clearTimeout(t); if (v !== on) t = setTimeout(() => set(v), ms); };
  el.addEventListener("pointerenter", (e) => { if (e.pointerType === "touch") return; hover = true; if (on) clearTimeout(t); else later(true, intentMs); });
  el.addEventListener("pointerleave", (e) => { if (e.pointerType === "touch") return; hover = false; if (down) return; if (on) later(false, holdMs); else clearTimeout(t); });
  el.addEventListener("pointerdown", () => { down = true; set(true); });
  addEventListener("pointerup", (e) => { if (!down) return; down = false; if (on && (e.pointerType === "touch" || !hover)) later(false, holdMs); }, true);
  addEventListener("pointercancel", () => { if (!down) return; down = false; if (on) later(false, holdMs); }, true);
  addEventListener("pointermove", (e) => { if (down && !e.buttons) { down = false; if (on && !hover) later(false, holdMs); } }, true);   // released over the map iframe
  document.addEventListener("pointerdown", (e) => { if (on && !el.contains(e.target)) set(false); }, true);   // a tap / click outside
  addEventListener("blur", () => { if (on && !hover && !down) set(false); });   // ... also on the map, which is an iframe (focus leaves the page)
  el.addEventListener("focusin", () => { if (!down) set(true); });
  el.addEventListener("focusout", (e) => { if (on && !hover && !down && !el.contains(e.relatedTarget)) later(false, holdMs); });
  el.addEventListener("keydown", (e) => { if (e.key === "Escape" && on) set(false); });
  return { open: () => set(true), close: () => set(false), isOpen: () => on };
}
// foldPanel (Mateusz 2026-10-04, AI Mateusza #1): ONE way for every overlay panel over the map / scene in /app (the right panel,
// the 2D and 3D legends and control boxes) to collapse: a slim strip "<title> <summary chip> <pin>" until hover / focus / tap
// (hoverHold: open after 150 ms, held 3 s after leaving, Esc closes, tap outside closes), the pin keeps it open (localStorage
// `key`, try/catch). The panel's box keeps its anchor and width in both states, so nothing else moves (insets, camera, map).
// Children with .fold-keep stay visible when collapsed (the right panel's Top 3). The strip is shown only while el has
// .fold-live (callers turn it off where the panel is not collapsible, e.g. Plan). Phones (top window <= 600 px) keep their own
// layout: no-op. sum(el) -> the chip text, re-read when the panel's content changes (innerHTML rewrites keep the strip on top).
// Styles are injected once per document (the 2D and 3D frames are separate documents). Returns {open, close, isOpen, setPin, sync}.
const FOLD_CSS = `.fold-head{display:flex;align-items:center;gap:3px;min-height:26px;margin:0;padding:0;font:600 12px/1.2 var(--rl-font,system-ui,sans-serif);color:var(--rl-ink,#23272a);box-sizing:border-box;width:100%}
.fold-ttl{appearance:none;flex:none;display:flex;align-items:center;gap:4px;min-height:26px;margin:0;padding:0 2px;border:0;border-radius:6px;background:transparent;color:inherit;font:700 12px/1.2 var(--rl-font,system-ui,sans-serif);letter-spacing:0;text-transform:none;white-space:nowrap;cursor:pointer}
.fold-ttl::before{content:"";width:6px;height:6px;border-right:1.6px solid currentColor;border-bottom:1.6px solid currentColor;transform:rotate(45deg) translate(-1px,-1px);opacity:.6;transition:transform .15s}
.fold.peek .fold-ttl::before,.fold.pinned .fold-ttl::before{transform:rotate(-135deg) translate(-1px,-1px)}
.fold-ttl:focus-visible,.fold-pin:focus-visible{outline:2px solid var(--rl-accent,#1f4e79);outline-offset:1px}
.fold-sum{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;font-weight:600;padding:1px 4px;border-radius:999px;text-align:center;background:color-mix(in srgb,var(--rl-ink,#23272a) 8%,transparent);color:var(--rl-ink-2,#4a5054)}
.fold-sum:empty{visibility:hidden}
.fold-pin{appearance:none;flex:none;display:grid;place-items:center;width:24px;height:24px;margin:0;padding:0;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--rl-ink-2,#4a5054);cursor:pointer;opacity:.55}
.fold-pin:hover{opacity:1;border-color:var(--rl-line-strong,rgba(35,39,42,.22))}
.fold.pinned .fold-pin{opacity:1;color:var(--rl-accent,#1f4e79);background:color-mix(in srgb,var(--rl-accent,#1f4e79) 12%,transparent)}
.fold:not(.fold-live)>.fold-head{display:none!important}
.fold.fold-live:not(.peek):not(.pinned)>:not(.fold-head):not(.fold-keep){display:none!important}
.fold.fold-live:not(.peek):not(.pinned):not(:has(>.fold-keep)){padding-top:4px!important;padding-bottom:4px!important}
.fold.fold-live.peek:not(.pinned)>:not(.fold-head):not(.fold-keep){animation:fold-unfold .15s ease both}
@keyframes fold-unfold{from{opacity:.5;transform:translateY(-3px)}}
@media (prefers-reduced-motion:reduce){.fold.fold-live.peek>*{animation:none!important}.fold-ttl::before{transition:none}}
@media (pointer:coarse){.fold-ttl{min-height:36px}.fold-pin{width:36px;height:36px}}`;
const PIN_SVG = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M6 1.5h4l-.6 4.2 2.6 2.3v1.2H8.6V15h-1.2V9.2H4V8l2.6-2.3z" fill="currentColor"/></svg>';
export function foldPanel(el, { title, key, sum, live = true, holdMs = 3000 } = {}) {
  if (!el || el.__fold) return el && el.__fold;
  let topW = innerWidth; try { topW = window.top.innerWidth; } catch (e) {}
  if (topW <= 600) return null;
  const doc = el.ownerDocument;
  if (!doc.getElementById("rl-fold-css")) { const st = doc.createElement("style"); st.id = "rl-fold-css"; st.textContent = FOLD_CSS; doc.head.appendChild(st); }
  const head = doc.createElement("div"); head.className = "fold-head";
  head.innerHTML = `<button type="button" class="fold-ttl" aria-expanded="false">${esc(title)}</button><span class="fold-sum" aria-hidden="true"></span><button type="button" class="fold-pin" aria-pressed="false" title="Przypnij panel (zostaje rozwinięty)" aria-label="Przypnij panel: ${esc(title)}">${PIN_SVG}</button>`;
  el.prepend(head); el.classList.add("fold"); if (live) el.classList.add("fold-live");
  const ttl = head.querySelector(".fold-ttl"), pin = head.querySelector(".fold-pin"), chip = head.querySelector(".fold-sum");
  const aria = () => { const o = el.classList.contains("peek") || el.classList.contains("pinned"); ttl.setAttribute("aria-expanded", String(o)); ttl.title = o ? "" : "Rozwiń: " + title; };
  const hh = hoverHold(el, { holdMs, onOpen: aria, onClose: aria });
  const setPin = (v) => { el.classList.toggle("pinned", v); pin.setAttribute("aria-pressed", String(v)); aria(); if (key) try { localStorage.setItem(key, v ? "1" : "0"); } catch (e) {} };
  if (key) try { if (localStorage.getItem(key) === "1") setPin(true); } catch (e) {}
  pin.addEventListener("click", (e) => { e.stopPropagation(); setPin(!el.classList.contains("pinned")); if (!el.classList.contains("pinned")) hh.close(); });
  ttl.addEventListener("click", () => hh.open());
  const sync = () => { if (el.firstElementChild !== head) el.prepend(head); if (sum) { const s = sum(el) || ""; if (chip.textContent !== s) chip.textContent = s; } };
  new MutationObserver(sync).observe(el, { childList: true, subtree: !!sum, characterData: !!sum });
  sync(); aria();
  return (el.__fold = { ...hh, setPin, sync, head });
}
