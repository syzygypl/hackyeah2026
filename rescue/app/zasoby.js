// Zasoby (CONTRACT.md "Zasoby i dziennik"): every unit with crew, condition (fatigue, battery, fuel, maintenance, dog work),
// warnings and data feeds. GET /api/inventory?sc=&at=, POST /api/inventory/<id>/event (operator key). Click a unit -> actor drawer.
import { openActor } from "./actorlog.js";
import { unitCard } from "./unitcard.js";   // the unit card, shared with Ćwiczenia (unitcard.css)

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function toast(t, ms = 3000) { const el = $("toast"); el.textContent = t; el.style.display = "block"; clearTimeout(toast.h); toast.h = setTimeout(() => el.style.display = "none", ms); }
const LOOPBACK = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(location.hostname);
let PIN = ""; try { PIN = (localStorage.getItem("rescue-pin") || "").replace(/^"(.*)"$/, "$1"); } catch (e) {}
if (!LOOPBACK) { $("keyLock").hidden = false; $("keyLock").onclick = () => { const b = $("pinbox"); b.hidden = !b.hidden; $("keyLock").setAttribute("aria-expanded", String(!b.hidden)); if (!b.hidden) $("pin").focus(); }; $("pin").value = PIN; $("pin").onchange = () => { PIN = $("pin").value.trim(); try { localStorage.setItem("rescue-pin", PIN); } catch (e) {} keyProbe(); }; }
// sens-funkcji #15: no key field in the bar - a lock (open = this device may change, colour = role from GET /api/key, like /app) opens a small key box
const KEY_TXT = { operator: "Klucz kierownika akcji: możesz zmieniać.", field: "Klucz ratownika: tylko meldunki i ślady.", wrong: "Nieprawidłowy klucz: tylko podgląd.", none: "Brak klucza: tylko podgląd." };
async function keyProbe() { if (LOOPBACK) return; const sent = PIN; let role = null; try { const r = await fetch("/api/key", { headers: sent ? { "X-Rescue-Pin": sent } : {}, cache: "no-store" }); if (r.ok) role = (await r.json()).role; } catch (e) {} if (sent !== PIN) return; const B = document.body.classList; B.remove("key-operator", "key-field", "key-wrong", "key-none"); if (!KEY_TXT[role]) return; B.add("key-" + role); $("keyLock").title = KEY_TXT[role] + " Kliknij, aby wpisać klucz."; $("pinbox").querySelector(".kstate").textContent = KEY_TXT[role]; }
keyProbe();
addEventListener("storage", (e) => { if (e.key === "rescue-pin" || e.key === null) { PIN = ((e.key ? e.newValue : null) || "").replace(/^"(.*)"$/, "$1").trim(); if (!LOOPBACK) { $("pin").value = PIN; keyProbe(); } } });   // a key typed in /app or another tab
async function api(path, body) {
  const h = { "Content-Type": "application/json" }; if (!LOOPBACK && PIN) h["X-Rescue-Pin"] = PIN;
  const r = await fetch(path, body === undefined ? { headers: h, cache: "no-cache" } : { method: "POST", headers: h, body: JSON.stringify(body) });
  if (!r.ok) { const e = new Error(r.status === 401 ? (PIN ? "Klucz akcji jest nieprawidłowy: kliknij kłódkę u góry i wpisz klucz kierownika akcji." : "Podaj klucz akcji: kliknij kłódkę u góry.") : r.status === 403 ? "To klucz ratownika: ta zmiana wymaga klucza kierownika akcji (pole Klucz u góry)." : "HTTP " + r.status); e.status = r.status; throw e; }
  return r.json();
}
const Q = new URLSearchParams(location.search);
const state = { sc: Q.get("sc") || "", at: Q.get("at") || "", data: null };
async function load() {
  const q = new URLSearchParams(); if (state.sc) q.set("sc", state.sc); if (state.at) q.set("at", state.at);
  const oq = new URLSearchParams({ sc: state.sc || "zawrat" }); if (state.at) oq.set("t", state.at.padStart(5, "0")); $("odprLink").href = "odprawa.html?" + oq;   // briefing of the chosen action / hour
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
  const nm = ((state.data && state.data.units || []).find((u) => u.id === id) || {}).name || id;   // people read the unit name, not its id
  const note = type === "fault" ? prompt(`Usterka: ${nm} - opis (krótko)`, "") : "";
  if (note === null) return;
  const body = { type, by: "operator" }; if (note) body.note = note; if (sc) body.sc = sc; if (state.at) body.at = state.at;
  try { const r = await api(`/api/inventory/${encodeURIComponent(id)}/event`, body); toast(`${nm}: ${label} (${r.event.at}) zapisane`); load(); }
  catch (e) { toast("Nie zapisano: " + e.message, 4000); }
}
async function init() {
  // the unit cards do not wait for the scenario list: ask for the default action's inventory at the same time
  const scP = api("/api/scenarios"), guessed = !state.sc;
  if (guessed) state.sc = "zawrat";
  let loadP = load();
  try {
    const s = await scP;
    const list = (s.scenarios || []).map((x) => x.name);
    if (guessed && !list.includes("zawrat")) { state.sc = list[0] || ""; loadP = loadP.then(load); }   // this server has no Zawrat
    $("sc").innerHTML = `<option value="">wszystkie (każdy zespół w swojej akcji)</option>` + list.map((n) => `<option ${n === state.sc ? "selected" : ""}>${esc(n)}</option>`).join("");
  } catch (e) { $("sc").innerHTML = `<option>${esc(state.sc)}</option>`; }
  $("at").value = state.at;
  const sync = () => { const u = new URL(location.href); state.sc ? u.searchParams.set("sc", state.sc) : u.searchParams.delete("sc"); state.at ? u.searchParams.set("at", state.at) : u.searchParams.delete("at"); history.replaceState(null, "", u); load(); };
  $("sc").onchange = () => { state.sc = $("sc").value; sync(); };
  $("at").onchange = () => { const v = $("at").value.trim(); if (v && !/^\d{1,2}:\d{2}$/.test(v)) return toast("Godzina w formacie GG:MM"); state.at = v; sync(); };
  $("now").onclick = () => { state.at = ""; $("at").value = ""; sync(); };
  await loadP;
  setInterval(() => { if (!document.hidden) load(); }, 15000);
  if (Q.get("actor")) openActor(Q.get("actor"), { sc: state.sc || undefined, at: state.at || undefined });
}
init();
