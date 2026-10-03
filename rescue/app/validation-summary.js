// Walidacja: summary card for /eval/summary.json (rescue/eval/summary.py, schema rescue-eval-summary/2).
// Mountains and water side by side: per environment one big number (true segment in the engine's top 3, 95% Wilson
// interval in small text) with the baseline (and the expert where it exists) next to it; one inline SVG chart with two
// engine lines (land, water) and two dashed baseline lines; a data-chosen "gdzie nie pomaga" line per environment;
// footnotes (simulation, overconfident POA percentages). Colours only via --rl-* tokens; no global CSS, styles are
// inline on the card's own nodes; the host gives the container (id="validation-summary") its layout.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (x, d = 0) => (x == null || isNaN(x) ? "-" : (Math.floor(x * 100 * 10 ** d + 0.5 + 1e-9) / 10 ** d).toFixed(d).replace(".", ",") + "%");
const ENV_COL = { land: "var(--rl-accent)", water: "var(--rl-ok)" };
const ci = (t) => (t && t.ci95 ? `${pct(t.ci95[0])}-${pct(t.ci95[1])}` : "");

function chart(d) {
  const W = 440, H = 220, L = 42, R = 12, T = 12, B = 34;
  const xs = d.chart.x, xmax = xs[xs.length - 1] || 1;
  const px = (x) => L + (x / xmax) * (W - L - R), py = (y) => T + (1 - y) * (H - T - B);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((y) =>
    `<line x1="${L}" x2="${W - R}" y1="${py(y)}" y2="${py(y)}" stroke="var(--rl-line)" stroke-width="1"/>` +
    `<text x="${L - 6}" y="${py(y) + 4}" text-anchor="end" font-size="11" fill="var(--rl-mute)">${pct(y)}</text>`).join("");
  const xt = xs.filter((_, i) => i % 5 === 0).map((x) =>
    `<text x="${px(x)}" y="${H - B + 16}" text-anchor="middle" font-size="11" fill="var(--rl-mute)">${String(x).replace(".", ",")}%</text>`).join("");
  const lines = [];
  for (const [env, e] of Object.entries(d.envs || {})) {
    if (!e) continue;
    for (const m of ["naive", "engine"]) {
      const y = e.cdf && e.cdf[m]; if (!y) continue;
      const path = y.map((v, i) => `${i ? "L" : "M"}${px(xs[i]).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
      lines.push(`<path data-env="${env}" data-m="${m}" d="${path}" fill="none" stroke="${ENV_COL[env] || "var(--rl-ink)"}" stroke-width="${m === "engine" ? 2.5 : 1.8}"${m === "naive" ? ' stroke-dasharray="5 4" opacity="0.8"' : ""}><title>${esc(e.label)}: ${m === "engine" ? "silnik" : e.baselineLabel}</title></path>`);
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(d.chart.title)}" style="display:block;max-width:${W}px">
    ${grid}${xt}${lines.join("")}
    <text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle" font-size="11" fill="var(--rl-mute)">${esc(d.chart.xLabel)}</text>
  </svg>`;
}

function legend(d) {
  const item = (col, dash, label) => `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:var(--rl-sp-3,12px)">
    <svg width="22" height="8" aria-hidden="true"><line x1="0" x2="22" y1="4" y2="4" stroke="${col}" stroke-width="2.5"${dash ? ' stroke-dasharray="5 4"' : ""}/></svg>${esc(label)}</span>`;
  const out = [];
  for (const [env, e] of Object.entries(d.envs || {})) {
    if (!e) continue;
    out.push(item(ENV_COL[env], false, `${e.label}: silnik`), item(ENV_COL[env], true, `${e.label}: ${e.baselineLabel}`));
  }
  return out.join("");
}

function envBlock(env, e) {
  const t = e.top3 || {};
  const exp = t.expert ? `<div style="font-size:var(--rl-fs-xs,12px);color:var(--rl-mute)">ekspert ${pct(t.expert.share)} <span style="opacity:.8">(95% CI ${ci(t.expert)})</span></div>` : "";
  return `<div data-env="${env}" style="flex:1 1 180px;min-width:0">
    <div style="font-size:var(--rl-fs-s,13px);color:var(--rl-mute)">${esc(e.label)} <span style="opacity:.8">(N=${e.n})</span></div>
    <div style="display:flex;align-items:baseline;gap:var(--rl-sp-2,8px);flex-wrap:wrap">
      <span style="font-family:var(--rl-font-num,inherit);font-size:calc(var(--rl-fs-xl,28px) * 1.5);font-weight:700;color:${ENV_COL[env] || "var(--rl-ink)"};line-height:1.1">${pct(t.engine && t.engine.share)}</span>
      <span style="font-size:var(--rl-fs-s,13px);color:var(--rl-mute)">vs <b style="color:var(--rl-ink-2,inherit)">${pct(t.naive && t.naive.share)}</b> ${esc(e.baselineLabel)}</span>
    </div>
    <div style="font-family:var(--rl-mono,inherit);font-size:var(--rl-fs-xs,12px);color:var(--rl-mute)">silnik ${ci(t.engine)} · odniesienie ${ci(t.naive)} (95% CI)</div>
    ${exp}
  </div>`;
}

export function renderCard(d) {
  const envs = Object.entries((d && d.envs) || {}).filter(([, e]) => e);
  if (!envs.length) return `<section data-rl="validation-summary" style="padding:var(--rl-sp-4,16px);color:var(--rl-mute)">Brak danych walidacyjnych. Uruchom: python3 rescue/eval/summary.py</section>`;
  const box = "background:var(--rl-panel);color:var(--rl-ink);border:1px solid var(--rl-line);border-radius:var(--rl-radius-l,10px);box-shadow:var(--rl-shadow,none);padding:var(--rl-sp-4,16px);font-family:var(--rl-font,inherit)";
  const losses = envs.map(([env, e]) => e.loss && e.loss.text
    ? `<div data-loss="${env}" style="border-left:3px solid ${ENV_COL[env] || "var(--rl-warn)"};padding:2px 0 2px var(--rl-sp-2,8px);margin-bottom:6px"><b>${esc(e.label)}:</b> ${esc(e.loss.text)}</div>` : "").join("");
  return `<section data-rl="validation-summary" style="${box}">
    <div style="font-size:var(--rl-fs,15px);font-weight:600;margin-bottom:var(--rl-sp-2,8px)">${esc(d.label || "Prawdziwy segment w top 3")}</div>
    <div style="display:flex;gap:var(--rl-sp-4,16px);flex-wrap:wrap;margin-bottom:var(--rl-sp-3,12px)">${envs.map(([env, e]) => envBlock(env, e)).join("")}</div>
    <div style="font-size:var(--rl-fs-s,13px);margin-bottom:4px">${esc(d.chart && d.chart.title)}</div>
    ${d.chart ? chart(d) : ""}
    <div style="font-size:var(--rl-fs-xs,12px);color:var(--rl-ink-2,inherit);margin:4px 0 var(--rl-sp-3,12px);line-height:1.8">${legend(d)}</div>
    <div style="font-size:var(--rl-fs-s,13px);font-weight:600;margin-bottom:4px">${esc(d.lossTitle || "Gdzie nie pomaga")}</div>
    <div style="font-size:var(--rl-fs-s,13px);margin-bottom:var(--rl-sp-3,12px)">${losses}</div>
    ${(d.footnotes || []).map((f) => `<div style="font-size:var(--rl-fs-xs,12px);color:var(--rl-mute);margin-top:2px">${esc(f)}</div>`).join("")}
  </section>`;
}

// el: any container (the shell uses <div id="validation-summary">); the card replaces its content.
export async function renderSummary(el, url = "/eval/summary.json") {
  if (!el) return;
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(r.status + " " + url);
    el.innerHTML = renderCard(await r.json());
  } catch (e) {
    el.innerHTML = `<section data-rl="validation-summary" style="color:var(--rl-mute);font-size:var(--rl-fs-s,13px)">Podsumowanie walidacji niedostępne (${esc(e.message)}). Uruchom: python3 rescue/eval/summary.py</section>`;
  }
}
