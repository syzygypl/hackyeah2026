// Rola "Ratownik w terenie": phone-first view inside the app. Own team, "Moje zadanie" (operator assignment wins over
// the planner), map on own GPS + own segment, big report buttons, free text + voice, offline queue.
// Reports: AI Michała's web/patrol embedded below the task (POST /report with X-Rescue-Client/Team/PIN, offline queue).
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (p) => Math.round((p || 0) * 100) + "%";
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
let C, team = new URLSearchParams(location.search).get("team") || ls.get("rescue-team", null), gps = null, gpsMarker = null, lastTaskKey = ""; // ?team=topr-a (QR code per phone) wins
const $ = (id) => document.getElementById(id);

export function initRescuer(ctx) {
  C = ctx;
  if (team) ls.set("rescue-team", team);
  $("rTeam").onchange = () => { team = $("rTeam").value; ls.set("rescue-team", team); lastTaskKey = ""; render(); C.onTeam(team); };
  $("rCenter").onclick = () => { startGps(); if (gps) C.map.flyTo({ center: [gps[1], gps[0]], zoom: 14.5, duration: 400 }); else C.toast("Brak pozycji GPS - włącz lokalizację w telefonie"); };
  setInterval(() => { if (C.store.role === "ratownik") pollTask(); }, 10000);
  initShare();
}
export const myTeam = () => team;
// own GPS: only in the Ratownik role (setRole) or on "centre on me" - the operator's desk never gets a location prompt
let gpsWatch = null;
export function startGps() {
  if (gpsWatch != null || !navigator.geolocation) return;
  gpsWatch = navigator.geolocation.watchPosition((p) => { if (SIM) return; gps = [p.coords.latitude, p.coords.longitude, p.coords.accuracy]; drawGps(); onFix(); }, (e) => { if (share && !SIM) shareStatus("Brak GPS: " + (e.code === 1 ? "brak zgody na lokalizację" : "nie ma sygnału")); }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
}

// ---------- "Udostępnij pozycję": the team's phone sends its GPS to POST /api/positions/<sc> (every 10 s, or at once after
// 25 m); the operator's 2D map shows it live (web/livepos.js). Explicit toggle, remembered on this phone. ?simgps=1 replays
// the team's scenario track (GET /api/tracks/<sc>?live=0, one track minute per 2 s) so the demo works on a laptop.
const SIM = new URLSearchParams(location.search).get("simgps") === "1";
const SEND_MS = 10000, SEND_M = 25;
let share = false, lastSent = null, sending = false, simTimer = null;
const distM = (a, b) => Math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * Math.cos(a[0] * Math.PI / 180));
function initShare() {
  const bar = $("rCenter")?.parentNode; if (!bar || $("rShare")) return;
  const b = document.createElement("button"); b.id = "rShare"; b.type = "button"; b.setAttribute("aria-pressed", "false");
  b.title = "Wysyłaj pozycję zespołu kierownikowi akcji (co 10 s albo po 25 m)";
  const s = document.createElement("div"); s.id = "rShareStatus"; s.className = "mute"; s.style.cssText = "font-size:13px;margin:4px 0 0";
  bar.appendChild(b); bar.after(s);
  b.onclick = () => setShare(!share);
  setShare(false, true);
  let resumed = false;   // remembered "on": resume once the app has set the role (initRescuer runs before setRole)
  setInterval(() => { if (!resumed && C.store.role) { resumed = true; if (C.store.role === "ratownik" && ls.get("rescue-share-pos", false)) setShare(true, true); }
    if (share) { if (gps && (!lastSent || Date.now() - lastSent.t >= SEND_MS)) send(); shareStatus(); } }, 1000);
}
function setShare(on, quiet) {
  share = !!on; if (!quiet) ls.set("rescue-share-pos", share);
  const b = $("rShare"); if (b) { b.textContent = share ? "Udostępniasz pozycję" : "Udostępnij pozycję"; b.setAttribute("aria-pressed", String(share)); b.style.cssText = share ? "background:#1f7a3f;color:#fff;border-color:#1f7a3f" : ""; }
  if (share) { if (SIM) startSim(); else startGps(); if (!quiet) C.toast(SIM ? "Symulacja GPS: odtwarzam ślad zespołu" : "Pozycja zespołu jest wysyłana do kierownika akcji"); }
  else { clearInterval(simTimer); simTimer = null; }
  shareStatus();
}
function onFix() { if (share && gps && (!lastSent || Date.now() - lastSent.t >= SEND_MS || distM(gps, lastSent.p) >= SEND_M)) send(); }
async function send() {
  if (sending || !team || !gps) return; sending = true;
  const p = gps.slice();
  try {
    await C.api("/api/positions/" + encodeURIComponent(C.store.scenario), { unit: team, lat: +p[0].toFixed(6), lon: +p[1].toFixed(6), acc: Math.round(p[2] || 0), ts: Date.now(), source: SIM ? "sim" : "gps" });
    lastSent = { t: Date.now(), p, err: null };
  } catch (e) { lastSent = { t: lastSent?.t || 0, p: lastSent?.p || p, err: e.message || "błąd sieci" }; }
  sending = false; shareStatus();
}
function shareStatus(msg) {
  const s = $("rShareStatus"); if (!s) return;
  if (!share) { s.textContent = ""; return; }
  if (msg) { s.textContent = msg; return; }
  const acc = gps ? "dokładność ±" + Math.round(gps[2] || 0) + " m" : "czekam na GPS…";
  const ago = lastSent?.t ? Math.round((Date.now() - lastSent.t) / 1000) : null;
  s.textContent = (SIM ? "Symulacja GPS · " : "") + acc + " · " + (ago == null ? "jeszcze nie wysłano" : "wysłano " + (ago < 2 ? "przed chwilą" : ago + " s temu")) + (lastSent?.err ? " · " + lastSent.err : "");
}
async function startSim() {
  if (simTimer) return;
  let path = [];
  try { const d = await C.api("/api/tracks/" + encodeURIComponent(C.store.scenario) + "?live=0"); path = ((d.actors || []).find((a) => a.id === team) || {}).path || []; } catch (e) {}
  if (!path.length) { shareStatus("Symulacja GPS: ten zespół nie ma śladu w scenariuszu"); return; }
  let i = Math.max(0, path.findIndex((q) => distM(q, path[0]) > 30) - 1);   // skip the wait at the base before the team sets off
  const step = () => { const q = path[i % path.length]; i++; gps = [q[0], q[1], Math.max(5, q[3] || 10)]; drawGps(); onFix(); };
  step(); simTimer = setInterval(step, 2000);
}

function teamName() { const r = res().find((x) => x.id === team); return r ? r.name.split(" (")[0] : team || "Zespół"; }
function res() { const S = C.curStep(); return (S && S.resources) || []; }
function seg() { return task()?.segmentId; }
function task() {
  const S = C.curStep(); if (!S || !team) return null;
  const m = (C.store.manual || []).find((a) => a.resourceId === team && (!a.scenario || a.scenario === C.store.scenario));
  const p = (S.assignments || []).find((a) => a.resourceId === team);
  if (m) return { ...p, ...m, fromOperator: true, reason: m.note || (p && p.segmentId === m.segmentId ? p.reason : "Zadanie od kierownika akcji") , segmentName: m.segmentName || p?.segmentName };
  return p ? { ...p, fromOperator: false } : null;
}

export async function pollTask() {
  try { const a = await C.api("/story/assign"); C.store.manual = a.assignments || []; } catch (e) {}
  render();
}

export function render() {
  if (!C || C.store.role !== "ratownik") return;
  const R = res(), S = C.curStep();
  if (!team || !R.some((r) => r.id === team)) team = R[0]?.id || null;
  $("rTeam").innerHTML = R.map((r) => `<option value="${esc(r.id)}" ${r.id === team ? "selected" : ""}>${esc(r.name)}</option>`).join("");
  const me = R.find((r) => r.id === team), t = task();
  const key = t ? t.segmentId + (t.fromOperator ? "op" : "") : "";
  if (key && lastTaskKey && key !== lastTaskKey) { C.toast("Nowe zadanie: " + t.segmentId + " " + (t.segmentName || ""), 6000); try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) {} }
  lastTaskKey = key;
  const W = (S && S.weather) || {};
  $("rTask").innerHTML = !me ? `<div class="help">Ten scenariusz nie ma jeszcze zespołów.</div>`
    : !me.available && !(t && t.fromOperator) ? `<div class="rbig off">Zespół niedostępny</div><div>${esc(me.reason)}</div>`
    : !t ? `<div class="rbig">Czekasz na zadanie</div><div class="help">Kierownik akcji przydzieli Wam sektor - pojawi się tutaj.</div>`
    : `<div class="rlabel">${t.fromOperator ? "Przydział od kierownika akcji" : "Zadanie z planu"}</div>
       <div class="rbig">${esc(t.segmentId)} ${esc(t.segmentName || "")}</div>
       ${t.travelMin != null ? `<div>Dojście ok. ${Math.round(t.travelMin)} min${t.sweepMin ? `, przeszukanie ok. ${Math.round(t.sweepMin)} min` : ""}${t.expectedFind != null ? `, szansa ${pct(t.expectedFind)}` : ""}</div>` : ""}
       ${!me.available ? `<div class="rflag">Plan: ${esc(me.reason)}</div>` : ""}
       ${(t.safety || []).map((f) => `<div class="rflag">! ${esc(f)}</div>`).join("")}
       <details><summary>Szczegóły: dlaczego tutaj</summary>${esc(t.reason || "")}</details>`;
  $("rSurv").textContent = W.survival ? "Hipotermia: " + W.survival.text : "";
  if (t && t.segmentId !== C.store.selSeg) C.selectSeg(t.segmentId, "rescuer");
}

function drawGps() {
  if (!gps || !C) return;
  if (!gpsMarker) { const el = document.createElement("div"); el.className = "gpsdot"; gpsMarker = new C.maplibregl.Marker({ element: el }).setLngLat([gps[1], gps[0]]).addTo(C.map); }
  else gpsMarker.setLngLat([gps[1], gps[0]]);
}
