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
  $("rCenter").onclick = () => { if (gps) C.map.flyTo({ center: [gps[1], gps[0]], zoom: 14.5, duration: 400 }); else C.toast("Brak pozycji GPS - włącz lokalizację w telefonie"); };
  if (navigator.geolocation) navigator.geolocation.watchPosition((p) => { gps = [p.coords.latitude, p.coords.longitude, p.coords.accuracy]; drawGps(); }, () => {}, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
  setInterval(() => { if (C.store.role === "ratownik") pollTask(); }, 10000);
}
export const myTeam = () => team;

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
