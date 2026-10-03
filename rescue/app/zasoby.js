// Zasoby (CONTRACT.md "Zasoby i dziennik"): every unit with crew, condition (fatigue, battery, fuel, maintenance, dog work),
// warnings and data feeds. GET /api/inventory?sc=&at=, POST /api/inventory/<id>/event (operator key). Click a unit -> actor drawer.
import { openActor } from "./actorlog.js";
import { unitCard } from "./unitcard.js";   // the unit card, shared with Ćwiczenia (unitcard.css)

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function toast(t, ms = 3000) { const el = $("toast"); el.textContent = t; el.style.display = "block"; clearTimeout(toast.h); toast.h = setTimeout(() => el.style.display = "none", ms); }
const LOOPBACK = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(location.hostname);
let PIN = ""; try { PIN = (localStorage.getItem("rescue-pin") || "").replace(/^"(.*)"$/, "$1"); } catch (e) {}
if (!LOOPBACK) { $("pinbox").hidden = false; $("pin").value = PIN; $("pin").onchange = () => { PIN = $("pin").value.trim(); try { localStorage.setItem("rescue-pin", PIN); } catch (e) {} }; }
async function api(path, body) {
  const h = { "Content-Type": "application/json" }; if (!LOOPBACK && PIN) h["X-Rescue-Pin"] = PIN;
  const r = await fetch(path, body === undefined ? { headers: h, cache: "no-cache" } : { method: "POST", headers: h, body: JSON.stringify(body) });
  if (!r.ok) { const e = new Error(r.status === 401 ? "Podaj klucz akcji (operator)." : "HTTP " + r.status); e.status = r.status; throw e; }
  return r.json();
}
const Q = new URLSearchParams(location.search);
const state = { sc: Q.get("sc") || "", at: Q.get("at") || "", data: null };
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
  const nm = ((state.data && state.data.units || []).find((u) => u.id === id) || {}).name || id;   // people read the unit name, not its id
  const note = type === "fault" ? prompt(`Usterka: ${nm} - opis (krótko)`, "") : "";
  if (note === null) return;
  const body = { type, by: "operator" }; if (note) body.note = note; if (sc) body.sc = sc; if (state.at) body.at = state.at;
  try { const r = await api(`/api/inventory/${encodeURIComponent(id)}/event`, body); toast(`${nm}: ${label} (${r.event.at}) zapisane`); load(); }
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
