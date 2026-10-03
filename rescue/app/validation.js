// Walidacja: read-only view of rescue/eval/ outputs (calibration harness, simulator). Shape: CONTRACT.md "eval".
// Reads /eval/report.json (index) and per-run files it lists. Inline SVG charts, no libraries.
import { renderSummary as renderSummaryCard } from "./validation-summary.js"; // summary card (/eval/summary.json, rescue/eval/summary.py)
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (x, d = 0) => (x == null || isNaN(x) ? "-" : (x * 100).toFixed(d).replace(".", ",") + "%");
const num = (x, d = 3) => (x == null || isNaN(x) ? "-" : (+x).toFixed(d).replace(".", ","));
const COL = { engine: "var(--rl-accent)", naive: "var(--rl-mute)", ideal: "var(--rl-line)" };
let loaded = null, simRuns = null, curSim = null;
const METHODS = [["engine", "Silnik", "var(--rl-accent)"], ["expert", "Ekspert", "var(--rl-warn)"], ["naive", "Naiwnie", "var(--rl-mute)"]];

async function getJSON(u) { const r = await fetch(u, { cache: "no-store" }); if (!r.ok) throw new Error(r.status + " " + u); return r.json(); }
async function getText(u) { const r = await fetch(u, { cache: "no-store" }); if (!r.ok) throw new Error(r.status + " " + u); return r.text(); }

let ablation, detailsOpen = false;
export async function showValidation() {
  const el = document.getElementById("val");
  renderSummaryCard(document.getElementById("validation-summary")); // own container, styled by the shell
  if (ablation === undefined) { try { ablation = await getJSON("/eval/ablation.json"); } catch (e) { ablation = null; } }
  await showMain(el);
  const btn = el.querySelector("#val-details-toggle");
  if (btn) btn.onclick = () => { detailsOpen = !detailsOpen; showValidation(); };
}
// rescue/eval/ablation.json (AI Marcina, ablation.py): blind rounds, engine vs expert vs naive vs what happened
function renderAblation(A) {
  const M = [["engine", "Silnik", "var(--rl-accent)"], ["expert", "Ekspert", "var(--rl-warn)"], ["naive", "Naiwnie od IPP", "var(--rl-mute)"]];
  const bar = (v, c) => `<div class="bar" title="${pct(v, 1)}"><i style="width:${Math.min(100, (v || 0) * 100).toFixed(1)}%;background:${c}"></i></div>`;
  return `<div class="vcard" style="margin-bottom:12px"><h3>Rundy na ślepo: % obszaru przeszukanego w kolejności POA, zanim trafi się w prawdziwą komórkę (główna miara)</h3>
  <table class="cases"><tr><th>runda</th>${M.map(([, l]) => `<th>${l}</th>`).join("")}<th>plan silnika</th><th>w rzeczywistości</th></tr>
  ${A.map((r) => `<tr><td><b>${esc(r.round)}</b><div class="help">${esc(r.segments)} segm., ${esc(r.cells)} komórek</div></td>
    ${M.map(([k, , c]) => `<td>${pct(r[k] && r[k].area, 1)} · segment #${esc(r[k] && r[k].segRank)}${bar(r[k] && r[k].area, c)}</td>`).join("")}
    <td>${r.planner ? `${r.planner.found ? "znaleziono" : "nie znaleziono"}, ${esc(r.planner.searches)} przeszukań, ${esc(r.planner.minutes)} min` : "-"}</td>
    <td>${r.actual ? `${r.actual.found ? "znaleziono" : "nie"}, ${esc(r.actual.searches)} przeszukań, ${esc(r.actual.minutes)} min${r.actual.by ? " (" + esc(r.actual.by) + ")" : ""}` : "-"}</td></tr>`).join("")}</table>
  <div class="help">Niżej = lepiej. Segment # = miejsce prawdziwego segmentu w rankingu metody. Źródło: rescue/eval/ablation.json.</div></div>`;
}
async function showMain(el) {
  if (!loaded) {
    try { loaded = await getJSON("/eval/calibration/results.json"); }
    catch (e) {
      try { loaded = await getJSON("/eval/calibration/results-water.json"); loaded.water = true; }
      catch (e2) { loaded = { missing: e.message }; }
    }
  }
  if (!loaded.missing) {
    el.innerHTML = renderSummary(loaded) +
      `<p class="row"><button id="val-details-toggle">${detailsOpen ? "Ukryj szczegóły" : "Szczegóły"}</button></p>` +
      (detailsOpen ? (ablation && ablation.length ? renderAblation(ablation) : "") + renderResults(loaded) : "");
    return;
  }
  // no calibration yet: show the simulator runs (manifest + run.json)
  if (!simRuns) { try { simRuns = await getJSON("/eval/sim-runs"); } catch (e) { simRuns = []; } }
  const head = `<h2>Walidacja silnika</h2><div class="vcard note" style="margin-bottom:10px">Wyniki kalibracji jeszcze się liczą. Na razie pokazujemy przypadki z symulatora.</div>`;
  if (!simRuns.length) { el.innerHTML = head + `<div class="vcard">Brak przebiegów symulatora w <code>rescue/eval/sim/out/</code> (<code>python3 rescue/eval/sim/sim.py --region zawrat --n 200 --seed 1 --out rescue/eval/sim/out/v1-zawrat</code>).</div>`; return; }
  if (!curSim) curSim = simRuns[0].id;
  const r = simRuns.find((x) => x.id === curSim) || simRuns[0];
  let run = null, rows = [];
  try { run = await getJSON(r.run); } catch (e) {}
  try { rows = csv(await getText(r.manifest)); } catch (e) {}
  el.innerHTML = head + `<div class="row" style="margin-bottom:10px">${simRuns.map((x) => `<button data-sim="${esc(x.id)}" class="${x.id === r.id ? "primary" : ""}">${esc(x.id)}</button>`).join("")}</div>` + renderSim(r, run, rows);
  el.querySelectorAll("[data-sim]").forEach((b) => b.onclick = () => { curSim = b.dataset.sim; showValidation(); });
}
function csv(t) { const L = t.trim().split(/\r?\n/), h = L.shift().split(","); return L.map((l) => Object.fromEntries(l.split(",").map((v, i) => [h[i], v]))); }
function countBy(rows, k) { const o = {}; rows.forEach((r) => o[r[k]] = (o[r[k]] || 0) + 1); return Object.entries(o).sort((a, b) => b[1] - a[1]); }
function bars(entries, title) {
  if (!entries.length) return "";
  const mx = Math.max(...entries.map((e) => e[1]));
  return `<div class="vcard"><h3>${esc(title)}</h3>${entries.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${v}</b></div><div class="bar"><i style="width:${(100 * v / mx).toFixed(0)}%;background:var(--rl-accent)"></i></div>`).join("")}</div>`;
}
function renderSim(r, run, rows) {
  const d = rows.map((x) => +x.dist_km_from_ipp).filter((x) => !isNaN(x)).sort((a, b) => a - b), med = d.length ? d[Math.floor(d.length / 2)] : null;
  const mis = rows.filter((x) => +x.misleading_clues > 0).length, bts = rows.filter((x) => x.has_bts === "1" || x.has_bts === "true").length;
  return `<div class="vcard" style="margin-bottom:12px">
    <span class="stat"><b>${rows.length}</b><span>przypadków ${run && run.region ? "(" + esc(run.region) + ")" : ""}</span></span>
    <span class="stat"><b>${med != null ? num(med, 1) + " km" : "-"}</b><span>mediana odległości od IPP</span></span>
    <span class="stat"><b>${rows.length ? pct(mis / rows.length) : "-"}</b><span>z mylącą wskazówką</span></span>
    <span class="stat"><b>${rows.length ? pct(bts / rows.length) : "-"}</b><span>z lokalizacją 112</span></span>
    ${run && run.seed != null ? `<div class="help">seed ${esc(run.seed)}${run.commit ? " · " + esc(run.commit) : ""}</div>` : ""}</div>
  <div class="vgrid">${bars(countBy(rows, "category"), "Kategorie")}${bars(countBy(rows, "behaviour"), "Zachowanie po zgubieniu się")}${bars(countBy(rows, "stop_reason"), "Powód zatrzymania")}</div>
  <div class="vcard" style="margin-top:12px"><h3>Przypadki</h3><table class="cases"><tr><th>przypadek</th><th>kategoria</th><th>zachowanie</th><th>zatrzymanie</th><th>km od IPP</th><th>odejście od trasy m</th><th>112</th><th>mylące</th></tr>
  ${rows.slice(0, 300).map((x) => `<tr><td>${esc(x.case)}</td><td>${esc(x.category)}</td><td>${esc(x.behaviour)}</td><td>${esc(x.stop_reason)}</td><td>${esc(x.dist_km_from_ipp)}</td><td>${esc(x.track_offset_m)}</td><td>${esc(x.has_bts)}</td><td>${esc(x.misleading_clues)}</td></tr>`).join("")}</table></div>`;
}

// Default Walidacja view: one card, one headline number, one chart. Full breakdown (per-round
// ablation, top-k/calibration/Brier charts, per-category tables, case list) is behind "Szczegóły".
function renderSummary(d) {
  const M = d.methods || {}, ms = METHODS.filter(([k]) => M[k]);
  const e = M.engine, n = M.naive;
  const eArea = e && e.areaToFind ? e.areaToFind.median : null;
  const nArea = n && n.areaToFind ? n.areaToFind.median : null;
  const factor = eArea && nArea && eArea > 0 ? nArea / eArea : null;
  const scope = d.water ? "akcje na wodzie" : (d.region ? "góry, " + d.region : "symulowane przypadki");
  return `<div class="vcard" style="text-align:center;padding:24px 16px">
    <div class="help">${esc(scope)} · N=${esc(d.n ?? "-")}${d.generated ? " · " + esc(d.generated) : ""}</div>
    <div style="font-size:40px;font-weight:700;margin:4px 0">${factor != null ? num(factor, 1) + "x" : "-"}</div>
    <div>${factor != null
      ? "mniejszy obszar do przeszukania niż szukanie od zgłoszenia (IPP/LKP)"
      : "za mało danych na porównanie"}</div>
    ${eArea != null && nArea != null ? `<div class="help" style="margin-top:4px">mediana obszaru do znalezienia: silnik ${num(eArea, 1)}% vs naiwnie ${num(nArea, 1)}%</div>` : ""}
  </div>
  <div class="vcard" style="margin-top:10px"><h3>Obszar przeszukany do znalezienia</h3>${histChart(ms, M)}${legend(ms)}</div>`;
}

function renderResults(d) {
  const M = d.methods || {}, ms = METHODS.filter(([k]) => M[k]);
  const e = M.engine || {}, n3 = (m) => m && m.topk ? m.topk["3"] : null;
  return `<div class="row" style="justify-content:space-between;margin-bottom:8px"><h2 style="margin:0">Walidacja silnika</h2><span class="help">${esc(d.generated || "")}${d.engine ? " · silnik " + esc(d.engine) : ""}${d.simRun ? " · symulator " + esc(d.simRun) : ""}</span></div>
  <div class="vcard" style="margin-bottom:12px">
    <span class="stat"><b>${esc(d.n ?? "-")}</b><span>przypadków ${d.region ? "(" + esc(d.region) + ")" : ""}</span></span>
    ${ms.map(([k, l]) => `<span class="stat"><b>${M[k].areaToFind && M[k].areaToFind.median != null ? num(M[k].areaToFind.median, 1) + "%" : "-"}</b><span>${l}: mediana obszaru do znalezienia</span></span>`).join("")}
    <span class="stat"><b>${num(e.brier)}</b><span>Brier silnika (niżej = lepiej)</span></span>
    <span class="stat" style="opacity:.7"><b>${pct(n3(e))}</b><span>segment w top-3 (pomocniczo)</span></span>
    ${d.note ? `<div class="help">${esc(d.note)}</div>` : ""}</div>
  <div class="vgrid">
    <div class="vcard"><h3>Obszar przeszukany do znalezienia</h3>${histChart(ms, M)}${legend(ms)}<div class="help">Główna miara: ile % obszaru (komórki w kolejności POA) trzeba przeszukać, zanim trafi się w prawdziwą komórkę.</div></div>
    <div class="vcard"><h3>Trafienia segmentu top-1 / 3 / 5 (pomocniczo)</h3>${topkChart(ms, M)}${legend(ms)}<div class="help">Siatka rozszerza się automatycznie, więc miary segmentowe są łatwiejsze niż komórkowe.</div></div>
    <div class="vcard"><h3>Krzywa kalibracji</h3>${calibChart(ms, M)}${legend(ms)}<div class="help">Przewidziane POA segmentu vs. jak często osoba tam była. Przekątna = idealnie.</div></div>
    <div class="vcard"><h3>Brier</h3>${ms.map(([k, l]) => `<div class="kv"><span>${l}</span><b>${num(M[k].brier)}</b></div>`).join("")}<div class="help">Średni błąd kwadratowy przewidzianych POA (0 = idealnie).</div></div>
    ${groupTable("Według kategorii", "category", d.byCategory, ms)}
    ${groupTable("Według liczby mylących wskazówek", "misleading", d.byMisleading, ms)}
  </div>
  ${caseTable(d.cases || [], ms)}`;
}
const legend = (ms) => `<div class="help">${ms.map(([, l, c]) => `<span style="color:${c}">■</span> ${l}`).join(" &nbsp; ")}</div>`;

function topkChart(ms, M) {
  const ks = ["1", "3", "5"], W = 360, H = 170, P = 28, gw = (W - P - 8) / ks.length, bw = (gw - 12) / Math.max(1, ms.length);
  const y = (v) => H - P - (v || 0) * (H - P - 10);
  return `<svg viewBox="0 0 ${W} ${H}">${[0, 0.5, 1].map((v) => `<line x1="${P}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--rl-line)"/><text x="2" y="${y(v) + 4}">${v * 100}%</text>`).join("")}
    ${ks.map((k, i) => ms.map(([m, l, c], j) => { const v = M[m].topk ? M[m].topk[k] : null; const x = P + i * gw + 6 + j * bw;
      return `<rect x="${x}" y="${y(v)}" width="${bw - 2}" height="${H - P - y(v)}" fill="${c}"><title>${l} top-${k}: ${pct(v)}</title></rect>`; }).join("") + `<text x="${P + i * gw + gw / 2}" y="${H - P + 14}" text-anchor="middle">top-${k}</text>`).join("")}</svg>`;
}
function histChart(ms, M) {
  const A = (M.engine || {}).areaToFind; if (!A || !A.bins) return `<p class="help">brak areaToFind</p>`;
  const W = 360, H = 170, P = 28, n = A.bins.length - 1, mx = Math.max(1, ...ms.flatMap(([m]) => (M[m].areaToFind || {}).counts || [0])), bw = (W - P - 8) / n;
  const y = (v) => H - P - (v / mx) * (H - P - 10);
  return `<svg viewBox="0 0 ${W} ${H}"><line x1="${P}" x2="${W}" y1="${H - P}" y2="${H - P}" stroke="var(--rl-line)"/>
    ${(A.counts || []).map((c, i) => `<rect x="${P + i * bw + 2}" y="${y(c)}" width="${bw - 4}" height="${H - P - y(c)}" fill="var(--rl-accent)" fill-opacity=".8"><title>${A.bins[i]}-${A.bins[i + 1]}%: ${c}</title></rect>`).join("")}
    ${ms.filter(([m]) => m !== "engine" && M[m].areaToFind && M[m].areaToFind.counts).map(([m, l, c]) => `<polyline fill="none" stroke="${c}" stroke-width="2" points="${M[m].areaToFind.counts.map((v, i) => `${P + i * bw + bw / 2},${y(v)}`).join(" ")}"><title>${l}</title></polyline>`).join("")}
    ${A.bins.map((b, i) => (i % Math.ceil(A.bins.length / 6) === 0 ? `<text x="${P + i * bw}" y="${H - P + 14}">${b}%</text>` : "")).join("")}</svg>`;
}
function calibChart(ms, M) {
  const W = 360, H = 220, P = 30, x = (v) => P + v * (W - P - 10), y = (v) => H - P - v * (H - P - 10);
  return `<svg viewBox="0 0 ${W} ${H}"><line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" stroke="var(--rl-line)" stroke-dasharray="4 3"/>
    <line x1="${P}" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="var(--rl-line)"/><line x1="${P}" x2="${P}" y1="${y(0)}" y2="${y(1)}" stroke="var(--rl-line)"/>
    ${ms.filter(([m]) => (M[m].calibration || []).length).map(([m, l, c]) => { const C = M[m].calibration, mx = Math.max(...C.map((b) => b.n || 1));
      return `<polyline fill="none" stroke="${c}" stroke-width="2" points="${C.map((b) => `${x(b.p)},${y(b.observed)}`).join(" ")}"/>` +
        C.map((b) => `<circle cx="${x(b.p)}" cy="${y(b.observed)}" r="${2 + 4 * Math.sqrt((b.n || 1) / mx)}" fill="${c}" fill-opacity=".55"><title>${l}: przewidziane ${pct(b.p)}, było ${pct(b.observed)}, n=${b.n}</title></circle>`).join(""); }).join("")}
    <text x="${P}" y="${H - 8}">przewidziane POA</text><text x="2" y="12">obserwowane</text></svg>`;
}
function groupTable(title, key, rows, ms) {
  if (!rows || !rows.length) return "";
  return `<div class="vcard"><h3>${esc(title)}</h3><table class="cases"><tr><th>${esc(key)}</th><th>n</th>${ms.map(([, l]) => `<th>${l} top-3</th>`).join("")}</tr>
    ${rows.map((r) => `<tr><td>${esc(r[key])}</td><td>${esc(r.n)}</td>${ms.map(([m]) => `<td>${pct(r.top3 && r.top3[m])}</td>`).join("")}</tr>`).join("")}</table></div>`;
}
function caseTable(C, ms) {
  if (!C.length) return "";
  const rows = C.slice(0, 300);
  return `<div class="vcard" style="margin-top:12px"><h3>Przypadki</h3><table class="cases"><tr><th>przypadek</th><th>kategoria</th><th>zachowanie</th><th>mylące</th>${ms.map(([, l]) => `<th>${l}: miejsce prawdziwego segmentu</th>`).join("")}<th>obszar do znalezienia (silnik)</th></tr>
    ${rows.map((c) => `<tr><td>${esc(c.case)}</td><td>${esc(c.category)}</td><td>${esc(c.behaviour)}</td><td>${esc(c.misleading ?? "")}</td>${ms.map(([m]) => `<td>${esc(c.rank && c.rank[m])}</td>`).join("")}<td>${c.areaPctToFind && c.areaPctToFind.engine != null ? num(c.areaPctToFind.engine, 1) + "%" : "-"}</td></tr>`).join("")}</table>
    ${C.length > rows.length ? `<p class="help">pokazano ${rows.length} z ${C.length}</p>` : ""}</div>`;
}
