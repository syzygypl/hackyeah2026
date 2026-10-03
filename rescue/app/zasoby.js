// Zasoby (CONTRACT.md "Zasoby i dziennik"): every unit with crew, condition (fatigue, battery, fuel, maintenance, dog work),
// warnings and data feeds. GET /api/inventory?sc=&at=, POST /api/inventory/<id>/event (operator key). Click a unit -> actor drawer.
import { openActor, KIND_LABEL } from "./actorlog.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function toast(t, ms = 3000) { const el = $("toast"); el.textContent = t; el.style.display = "block"; clearTimeout(toast.h); toast.h = setTimeout(() => el.style.display = "none", ms); }
const LOOPBACK = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(location.hostname);
let PIN = ""; try { PIN = (localStorage.getItem("rescue-pin") || "").replace(/^"(.*)"$/, "$1"); } catch (e) {}
if (!LOOPBACK) { $("pinbox").hidden = false; $("pin").value = PIN; $("pin").onchange = () => { PIN = $("pin").value.trim(); try { localStorage.setItem("rescue-pin", PIN); } catch (e) {} }; }
async function api(path, body) {
  const h = { "Content-Type": "application/json" }; if (!LOOPBACK && PIN) h["X-Rescue-Pin"] = PIN;
  const r = await fetch(path, body === undefined ? { headers: h, cache: "no-store" } : { method: "POST", headers: h, body: JSON.stringify(body) });
  if (!r.ok) { const e = new Error(r.status === 401 ? "Podaj klucz akcji (operator)." : "HTTP " + r.status); e.status = r.status; throw e; }
  return r.json();
}
const Q = new URLSearchParams(location.search);
const state = { sc: Q.get("sc") || "", at: Q.get("at") || "", data: null };
const EVENTS = {
  dron: [["battery_swap", "Wymiana baterii"], ["maintenance", "Przegląd"], ["fault", "Usterka"]],
  smiglowiec: [["refuel", "Tankowanie"], ["rest", "Zmiana / odpoczynek załogi"], ["maintenance", "Przegląd"], ["fault", "Usterka"]],
  lodz: [["refuel", "Tankowanie"], ["maintenance", "Przegląd"], ["fault", "Usterka"]],
  pies: [["rest", "Odpoczynek psa"], ["fault", "Uraz / usterka"]],
};
const eventsFor = (k) => EVENTS[k] || [["rest", "Odpoczynek"], ["fault", "Usterka sprzętu"]];

function bar(label, pct, value, level) {
  const p = Math.max(0, Math.min(100, pct));
  return `<div class="bar ${level || ""}"><div class="lab"><span>${esc(label)}</span><b>${esc(value)}</b></div><div class="tr"><div class="fi" style="width:${p}%"></div></div></div>`;
}
function codeLevel(u, codes) { const w = (u.warnings || []).filter((x) => codes.includes(x.code)); return w.some((x) => x.level === "red") ? "red" : w.length ? "amber" : ""; }
function unitCard(u) {
  const h = u.health || {}, kind = u.kind;
  const bars = [];
  if (h.batteryPct != null) bars.push(bar(`Bateria (~${h.flightMinLeft} min lotu, zapas ${h.spareBatteries} szt.)`, h.batteryPct, h.batteryPct + "%", codeLevel(u, ["battery"])));
  if (h.fuelPct != null) bars.push(bar(`Paliwo (~${h.enduranceMinLeft} min)`, h.fuelPct, h.fuelPct + "%", codeLevel(u, ["fuel"])));
  if (h.fatiguePct != null) bars.push(bar(`Zmęczenie - szacunek (${h.distanceKm} km, +${h.climbM} m)`, h.fatiguePct, h.fatiguePct + "%", codeLevel(u, ["fatigue"])));
  if (h.workMin != null) bars.push(bar(`Pies: praca bez przerwy (limit ${h.workLimitMin} min)`, (h.workMin / h.workLimitMin) * 100, `${h.workMin} min`, codeLevel(u, ["dogwork"])));
  if (h.dutyMin != null) bars.push(bar(`Służba załogi (limit ${Math.round(h.dutyLimitMin / 60)} h)`, (h.dutyMin / h.dutyLimitMin) * 100, `${Math.floor(h.dutyMin / 60)} h ${String(h.dutyMin % 60).padStart(2, "0")} min`, codeLevel(u, ["duty"])));
  if (h.maintenanceDueInH != null) bars.push(bar(`Do przeglądu (co ${h.maintenanceEveryH} h, ostatni ${h.lastMaintenance || "?"})`, (Math.max(0, h.maintenanceDueInH) / h.maintenanceEveryH) * 100, `${h.maintenanceDueInH} h`, codeLevel(u, ["maintenance"])));
  const crew = (u.crew || []).map((c) => `${esc(c.name)} <span class="mute">(${esc(c.role)})</span>`).join(", ");
  const dog = u.dog ? ` · pies: <b>${esc(u.dog.name)}</b> ${esc(u.dog.breed || "")}` : "";
  const feeds = (u.feeds || []).map((f) => `<span title="${esc(f.label)}: ${f.status === "live" ? "na żywo" : f.status === "stale" ? "nieaktualne" : "brak"}${f.lastAt ? ", ostatnio " + esc(f.lastAt) : ""}${f.note ? " - " + esc(f.note) : ""}"><i class="dot ${esc(f.status)}"></i>${esc(f.label.split(" ")[0])}</span>`).join("");
  const warns = (u.warnings || []).map((w) => `<div class="warn ${esc(w.level)}">${esc(w.text)}</div>`).join("");
  const plan = !u.sc && u.atSc && (u.home || []).includes(u.atSc);   // untouched incident: the team works there from its scenario file
  const status = plan ? "w planie" : u.status;
  const st = plan ? "akcja" : u.status === "wolny" ? "wolny" : u.status === "w akcji" ? "akcja" : "";
  const where = u.sc ? `${esc(u.sc)}${u.segmentId ? " · " + esc(u.segmentId) : ""}` : (u.atSc ? `w planie ${esc(u.atSc)} (ze scenariusza)` : (u.home || []).length ? "baza w: " + esc(u.home.slice(0, 3).join(", ")) : "");
  const spares = (u.spares || []).map((s) => `${esc(s.item)} × ${esc(s.qty)}`).join(", ");
  return `<article class="unit ${esc(u.level)}" data-id="${esc(u.id)}" data-sc="${esc(u.atSc || u.sc || "")}" tabindex="0" title="Kliknij: dziennik i źródła danych">
    <div class="u-top"><h3>${esc(u.name)}</h3><span class="id">${esc(u.id)}${u.callsign ? " · " + esc(u.callsign) : ""}</span></div>
    <div class="u-sub">${esc(KIND_LABEL[kind] || kind)} · <span class="st ${st}">${esc(status)}</span> ${where}${u.base ? ` · ${esc(u.base)}` : ""}</div>
    ${warns}${bars.join("")}
    ${crew ? `<div class="crew">Załoga: ${crew}${dog}</div>` : ""}
    ${spares || u.model ? `<div class="facts">${u.model ? esc(u.model) : ""}${spares ? `${u.model ? " · " : ""}zapas: ${spares}` : ""}</div>` : ""}
    <div class="feeds">${feeds}</div>
    ${u.inventory === false ? '<div class="facts">Brak wpisu w inwentarzu (tylko dane z listy zespołów).</div>' : ""}
    <div class="acts">${eventsFor(kind).map(([t, l]) => `<button data-ev="${t}" class="${t === "fault" ? "fault" : ""}" title="Zapisz zdarzenie: ${esc(l)} (trafia do dziennika i kanału na żywo)">${esc(l)}</button>`).join("")}</div>
  </article>`;
}
async function load() {
  const q = new URLSearchParams(); if (state.sc) q.set("sc", state.sc); if (state.at) q.set("at", state.at);
  try { state.data = await api("/api/inventory?" + q); }
  catch (e) { $("onSc").innerHTML = `<div class="help">Nie udało się wczytać zasobów: ${esc(e.message)}</div>`; return; }
  render();
}
function render() {
  const d = state.data; if (!d) return;
  const on = d.units.filter((u) => u.atSc && (!state.sc || u.atSc === state.sc)), off = d.units.filter((u) => !on.includes(u));
  $("onSc").innerHTML = on.map(unitCard).join("") || `<div class="help">Żaden zespół nie pracuje przy tej akcji.</div>`;
  $("others").innerHTML = off.map(unitCard).join("") || `<div class="help">Brak.</div>`;
  $("atLabel").textContent = d.at ? `godzina akcji ${d.at}${state.at ? "" : " (na żywo)"}` : "";
  const red = d.units.filter((u) => u.level === "red").length, amber = d.units.filter((u) => u.level === "amber").length;
  $("counts").innerHTML = `${d.units.length} zasobów${red ? ` · <b style="color:var(--rl-danger)">${red} alarm</b>` : ""}${amber ? ` · ${amber} uwaga` : ""}`;
  // data source only as a tooltip on the banner (review: no technical text on screen)
  $("src").closest(".banner").title = `Źródło: GET /api/inventory${d.inventoryFile ? " + scenarios/inventory/inventory.json" : " (brak pliku inwentarza)"}`;
  document.querySelectorAll(".unit").forEach((el) => {
    const open = () => openActor(el.dataset.id, { sc: el.dataset.sc || state.sc || undefined, at: state.at || undefined });
    el.onclick = (e) => { if (!e.target.closest("button")) open(); };
    el.onkeydown = (e) => { if (e.key === "Enter" && e.target === el) open(); };
    el.querySelectorAll("button[data-ev]").forEach((b) => b.onclick = () => addEvent(el.dataset.id, el.dataset.sc, b.dataset.ev, b.textContent));
  });
}
async function addEvent(id, sc, type, label) {
  const note = type === "fault" ? prompt(`Usterka: ${id} - opis (krótko)`, "") : "";
  if (note === null) return;
  const body = { type, by: "operator" }; if (note) body.note = note; if (sc) body.sc = sc; if (state.at) body.at = state.at;
  try { const r = await api(`/api/inventory/${encodeURIComponent(id)}/event`, body); toast(`${id}: ${label} (${r.event.at}) zapisane`); load(); }
  catch (e) { toast("Nie zapisano: " + e.message, 4000); }
}
async function init() {
  try {
    const s = await api("/api/scenarios");
    const list = (s.scenarios || []).map((x) => x.name);
    if (!state.sc) state.sc = list.includes("zawrat") ? "zawrat" : list[0] || "";
    $("sc").innerHTML = `<option value="">wszystkie (każdy zespół w swojej akcji)</option>` + list.map((n) => `<option ${n === state.sc ? "selected" : ""}>${esc(n)}</option>`).join("");
  } catch (e) { $("sc").innerHTML = `<option>${esc(state.sc)}</option>`; }
  $("at").value = state.at;
  const sync = () => { const u = new URL(location.href); state.sc ? u.searchParams.set("sc", state.sc) : u.searchParams.delete("sc"); state.at ? u.searchParams.set("at", state.at) : u.searchParams.delete("at"); history.replaceState(null, "", u); load(); };
  $("sc").onchange = () => { state.sc = $("sc").value; sync(); };
  $("at").onchange = () => { const v = $("at").value.trim(); if (v && !/^\d{1,2}:\d{2}$/.test(v)) return toast("Godzina w formacie GG:MM"); state.at = v; sync(); };
  $("now").onclick = () => { state.at = ""; $("at").value = ""; sync(); };
  await load();
  setInterval(() => { if (!document.hidden) load(); }, 15000);
  if (Q.get("actor")) openActor(Q.get("actor"), { sc: state.sc || undefined, at: state.at || undefined });
}
init();
