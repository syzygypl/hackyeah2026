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
