// Rescue Locator - unit card (Zasoby): name, kind, status, condition bars, crew, data feeds, warnings, event buttons. Pure markup,
// shared by Zasoby (zasoby.js) and Ćwiczenia (cwiczenia.js). Styles: unitcard.css. Moved out of zasoby.js unchanged (refactor, AI Marcina
// 2026-10-04); the card and its owner (AI Mateusza) stay the same.
import { KIND_LABEL } from "./actorlog.js";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export const EVENTS = {
  dron: [["battery_swap", "Wymiana baterii"], ["maintenance", "Przegląd"], ["fault", "Usterka"]],
  smiglowiec: [["refuel", "Tankowanie"], ["rest", "Zmiana / odpoczynek załogi"], ["maintenance", "Przegląd"], ["fault", "Usterka"]],
  lodz: [["refuel", "Tankowanie"], ["maintenance", "Przegląd"], ["fault", "Usterka"]],
  pies: [["rest", "Odpoczynek psa"], ["fault", "Uraz / usterka"]],
};
export const eventsFor = (k) => EVENTS[k] || [["rest", "Odpoczynek"], ["fault", "Usterka sprzętu"]];

export function bar(label, pct, value, level) {
  const p = Math.max(0, Math.min(100, pct));
  return `<div class="bar ${level || ""}"><div class="lab"><span>${esc(label)}</span><b>${esc(value)}</b></div><div class="tr"><div class="fi" style="width:${p}%"></div></div></div>`;
}
export function codeLevel(u, codes) { const w = (u.warnings || []).filter((x) => codes.includes(x.code)); return w.some((x) => x.level === "red") ? "red" : w.length ? "amber" : ""; }
export function unitCard(u) {
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
