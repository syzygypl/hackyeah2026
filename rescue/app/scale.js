// Shared heat scale - DECISION S2: colour by "times the average cell" on a log scale (as the 3D view),
// fixed stops 0.5x, 1x, 2x, 5x, 10x, 25x+ with the same 6 colours in 2D and 3D, plus a legend helper.
// ES module; also exposed as window.RescueScale for classic scripts.
//   import { STOPS, ratio, colorFor, paintGrid, legendHTML } from "/app/scale.js";
//   ratio(p, N) = p * N   (N = number of grid cells; 1 = the average cell)

export const STOPS = [
  { x: 0.5, color: [255, 236, 170], alpha: 0.18, label: "0,5×" },
  { x: 1, color: [255, 214, 102], alpha: 0.32, label: "1×" },
  { x: 2, color: [252, 163, 17], alpha: 0.48, label: "2×" },
  { x: 5, color: [232, 93, 4], alpha: 0.62, label: "5×" },
  { x: 10, color: [208, 0, 0], alpha: 0.72, label: "10×" },
  { x: 25, color: [157, 2, 8], alpha: 0.8, label: "25×+" },
];
export const ratio = (p, N) => p * N;

/** [r, g, b, a(0-1)] for one cell; below 0.5x average = transparent. Log-interpolated between stops. */
export function colorFor(p, N) {
  const x = ratio(p, N);
  if (!(x >= STOPS[0].x)) return [0, 0, 0, 0];
  if (x >= STOPS[STOPS.length - 1].x) { const s = STOPS[STOPS.length - 1]; return [...s.color, s.alpha]; }
  let k = 0; while (x >= STOPS[k + 1].x) k++;
  const a = STOPS[k], b = STOPS[k + 1], t = (Math.log(x) - Math.log(a.x)) / (Math.log(b.x) - Math.log(a.x));
  const m = (u, v) => u + (v - u) * t;
  return [Math.round(m(a.color[0], b.color[0])), Math.round(m(a.color[1], b.color[1])), Math.round(m(a.color[2], b.color[2])), m(a.alpha, b.alpha)];
}

/** Paint a row-major poaGrid (rescue-run/1) into a cols x rows canvas (north row first). */
export function paintGrid(grid, cols, rows, canvas = document.createElement("canvas")) {
  canvas.width = cols; canvas.height = rows;
  const g = canvas.getContext("2d"), im = g.createImageData(cols, rows), N = grid.length;
  for (let i = 0; i < N; i++) { const [r, gg, b, a] = colorFor(grid[i], N); im.data.set([r, gg, b, Math.round(a * 255)], i * 4); }
  g.putImageData(im, 0, 0);
  return canvas;
}

/** CSS gradient with the 6 stops (equal spacing, which is log spacing in x). */
export const gradientCSS = () => `linear-gradient(90deg, ${STOPS.map((s, i) => `rgba(${s.color.join(",")},${Math.max(s.alpha, 0.35)}) ${Math.round((i / (STOPS.length - 1)) * 100)}%`).join(", ")})`;

/** Legend markup: title, ramp, stop labels. Style it with the host page's tokens. */
export function legendHTML(title = "Waga mapy względem średniej komórki") {
  return `<div class="rl-legend" style="font:11px/1.3 var(--rl-font,sans-serif);color:var(--rl-ink-2,#b7c3cd)">
  <div>${title}</div>
  <div style="height:8px;border-radius:4px;margin:3px 0;background:${gradientCSS()}"></div>
  <div style="display:flex;justify-content:space-between">${STOPS.map((s) => `<span>${s.label}</span>`).join("")}</div></div>`;
}

if (typeof window !== "undefined") window.RescueScale = { STOPS, ratio, colorFor, paintGrid, gradientCSS, legendHTML };
