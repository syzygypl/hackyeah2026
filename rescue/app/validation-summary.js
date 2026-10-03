// Walidacja: summary card for /eval/summary.json (rescue/eval/summary.py, schema rescue-eval-summary/1).
// One big number (true segment in the engine's top 3), the baseline next to it, one inline SVG chart
// (cumulative share of cases vs % of area searched, engine vs baseline), the data-chosen "where it doesn't help"
// line and the footnote. Colours only via --rl-* tokens; no global CSS, styles are inline on the card's own nodes.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (x, d = 0) => (x == null || isNaN(x) ? "-" : (x * 100).toFixed(d).replace(".", ",") + "%");
const COL = { engine: "var(--rl-accent)", baseline: "var(--rl-mute)" };

function chart(c) {
  const W = 420, H = 210, L = 42, R = 12, T = 12, B = 34;
  const xs = c.x, xmax = xs[xs.length - 1] || 1;
  const px = (x) => L + (x / xmax) * (W - L - R), py = (y) => T + (1 - y) * (H - T - B);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((y) =>
    `<line x1="${L}" x2="${W - R}" y1="${py(y)}" y2="${py(y)}" stroke="var(--rl-line)" stroke-width="1"/>` +
    `<text x="${L - 6}" y="${py(y) + 4}" text-anchor="end" font-size="11" fill="var(--rl-mute)">${pct(y)}</text>`).join("");
  const xt = xs.filter((_, i) => i % 5 === 0).map((x) =>
    `<text x="${px(x)}" y="${H - B + 16}" text-anchor="middle" font-size="11" fill="var(--rl-mute)">${String(x).replace(".", ",")}%</text>`).join("");
  const lines = c.series.map((s) => {
    const d = s.y.map((y, i) => `${i ? "L" : "M"}${px(xs[i]).toFixed(1)},${py(y).toFixed(1)}`).join(" ");
    const dash = s.id === "baseline" ? ' stroke-dasharray="5 4"' : "";
    return `<path d="${d}" fill="none" stroke="${COL[s.id] || "var(--rl-ink)"}" stroke-width="2.5"${dash}><title>${esc(s.label)}</title></path>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(c.title)}" style="display:block;max-width:${W}px">
    ${grid}${xt}${lines}
    <text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle" font-size="11" fill="var(--rl-mute)">${esc(c.xLabel)}</text>
  </svg>`;
}

function legend(c) {
  return c.series.map((s) => `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:var(--rl-sp-3,12px)">
    <svg width="22" height="8" aria-hidden="true"><line x1="0" x2="22" y1="4" y2="4" stroke="${COL[s.id] || "var(--rl-ink)"}" stroke-width="2.5"${s.id === "baseline" ? ' stroke-dasharray="5 4"' : ""}/></svg>${esc(s.label)}</span>`).join("");
}

export function renderCard(d) {
  const h = d.headline || {}, a = h.all;
  if (!a) return `<section data-rl="validation-summary" style="padding:var(--rl-sp-4,16px);color:var(--rl-mute)">${esc(h.text || "Brak danych walidacyjnych.")}</section>`;
  const box = "background:var(--rl-panel);color:var(--rl-ink);border:1px solid var(--rl-line);border-radius:var(--rl-radius-l,10px);box-shadow:var(--rl-shadow,none);padding:var(--rl-sp-4,16px);font-family:var(--rl-font,inherit)";
  return `<section data-rl="validation-summary" style="${box}">
    <div style="font-size:var(--rl-fs-s,13px);color:var(--rl-mute)">${esc(h.label)}</div>
    <div style="display:flex;align-items:baseline;gap:var(--rl-sp-3,12px);flex-wrap:wrap">
      <span style="font-size:calc(var(--rl-fs-xl,28px) * 1.6);font-weight:700;color:var(--rl-accent);line-height:1.1">${pct(a.engineTop3)}</span>
      <span style="font-size:var(--rl-fs,15px);color:var(--rl-mute)">vs <b style="color:var(--rl-ink-2,inherit)">${pct(a.baselineTop3)}</b> ${esc(h.baselineLabel)}</span>
    </div>
    <div style="font-size:var(--rl-fs-xs,12px);color:var(--rl-mute);margin:2px 0 var(--rl-sp-3,12px)">${esc(h.breakdown)}</div>
    <div style="font-size:var(--rl-fs-s,13px);margin-bottom:4px">${esc(d.chart.title)}</div>
    ${chart(d.chart)}
    <div style="font-size:var(--rl-fs-xs,12px);color:var(--rl-ink-2,inherit);margin:4px 0 var(--rl-sp-3,12px)">${legend(d.chart)}</div>
    <div style="font-size:var(--rl-fs-s,13px);border-left:3px solid var(--rl-warn);padding:2px 0 2px var(--rl-sp-2,8px);margin-bottom:var(--rl-sp-3,12px)">${esc(d.loss && d.loss.text)}</div>
    <div style="font-size:var(--rl-fs-xs,12px);color:var(--rl-mute)">${esc(d.footnote)}</div>
  </section>`;
}

// el: any container; the card replaces its content. url: override for tests.
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
