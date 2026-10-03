// Terrain texture bakes for the 3D view, off the main thread: the printed-topo base colours (before the OSM overlay) and
// the object-space normal map + ambient occlusion from the full-resolution DEM. Runs as a module worker
// (new Worker('bake3d.js', {type:'module'})) and is imported by app3d.js as the fallback when a worker cannot start.
// Pure numbers in, pixel buffers out (transferred); the arithmetic is the one app3d.js had inline, so the pixels match.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// vegetation by elevation (Tatra belts: spruce forest, dwarf pine, alpine meadow), rock by slope, snow high up
const VEG = [[900, [62, 112, 52]], [1200, [48, 98, 44]], [1450, [70, 118, 52]], [1600, [104, 138, 64]], [1800, [150, 160, 88]], [2000, [168, 166, 120]], [2300, [184, 180, 168]]];
const ROCK = [[1000, [138, 128, 116]], [1800, [156, 148, 138]], [2300, [186, 180, 172]]];
// colour stops into a reusable buffer (Float64Array keeps the exact doubles)
const VC = new Float64Array(3), RC = new Float64Array(3);
function lerpTo(stops, v, o) {
  let a = stops[stops.length - 1][1];
  if (v <= stops[0][0]) a = stops[0][1];
  else for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) {
    const e0 = stops[i - 1][0], p = stops[i - 1][1], q = stops[i][1], t = (v - e0) / (stops[i][0] - e0);
    o[0] = p[0] + (q[0] - p[0]) * t; o[1] = p[1] + (q[1] - p[1]) * t; o[2] = p[2] + (q[2] - p[2]) * t; return;
  }
  o[0] = a[0]; o[1] = a[1]; o[2] = a[2];
}
const contour = (e, right, down, st) => Math.floor(e / st) !== Math.floor(right / st) || Math.floor(e / st) !== Math.floor(down / st);

// p: { full: {lat0, lon0, step, stepLat, rows, cols, z: Float64Array row-major}, dem: {same, decimated mesh grid},
//      TS, KX, KM, EX, LOW, WM: {m: Uint8Array, rows, cols, b: {north, south, east, west}} | null,
//      part: {rows: [y0, y1]} = base colours of those texture rows only | {nao: true} = normal map + AO only | absent = all }
// Parts let app3d.js run the bake on three workers at once; every pixel is computed exactly as in the whole bake.
export function bakeTerrain(p) {
  const { full: F, TS, KX, KM, EX, LOW, WM } = p, D = p.dem || F; // dem: the decimated mesh grid, null when it is the full one
  const stLon = D.step, stLat = D.stepLat || D.step, TW = D.cols * TS, TH = D.rows * TS;
  const FZ = F.z, FC = F.cols, FR = F.rows, fsl = F.stepLat || F.step;
  function elevFull(lat, lon) {
    const r = clamp((F.lat0 - lat) / fsl - 0.5, 0, FR - 1), c = clamp((lon - F.lon0) / F.step - 0.5, 0, FC - 1);
    const r0 = Math.floor(r), c0 = Math.floor(c), r1 = Math.min(r0 + 1, FR - 1), c1 = Math.min(c0 + 1, FC - 1), fr = r - r0, fc = c - c0;
    return (FZ[r0 * FC + c0] * (1 - fc) + FZ[r0 * FC + c1] * fc) * (1 - fr) + (FZ[r1 * FC + c0] * (1 - fc) + FZ[r1 * FC + c1] * fc) * fr;
  }
  const DZ = D.z, DC = D.cols, DR = D.rows;
  function elevM(lat, lon) { // the mesh grid, as app3d.js elevM
    const r = clamp((D.lat0 - lat) / stLat - 0.5, 0, DR - 1), c = clamp((lon - D.lon0) / stLon - 0.5, 0, DC - 1);
    const r0 = Math.floor(r), c0 = Math.floor(c), r1 = Math.min(r0 + 1, DR - 1), c1 = Math.min(c0 + 1, DC - 1), fr = r - r0, fc = c - c0;
    return (DZ[r0 * DC + c0] * (1 - fc) + DZ[r0 * DC + c1] * fc) * (1 - fr) + (DZ[r1 * DC + c0] * (1 - fc) + DZ[r1 * DC + c1] * fc) * fr;
  }
  function isWater(la, lo) { // as app3d.js isWater
    if (WM && la <= WM.b.north && la >= WM.b.south && lo >= WM.b.west && lo <= WM.b.east) {
      const r = Math.min(WM.rows - 1, Math.floor(((WM.b.north - la) / (WM.b.north - WM.b.south)) * WM.rows)), c = Math.min(WM.cols - 1, Math.floor(((lo - WM.b.west) / (WM.b.east - WM.b.west)) * WM.cols));
      return !!WM.m[r * WM.cols + c];
    }
    return LOW && elevM(la, lo) <= 0.3;
  }

  // printed-topo look: vegetation/rock tint, warm-lit / cool-shadow hillshade, brown contours every 50 m (bold every 250 m)
  const part = p.part || {}, [y0, y1] = part.nao ? [0, 0] : part.rows || [0, TH];
  const base = new Uint8ClampedArray(TW * (y1 - y0) * 4), d = base;
  const ey0 = Math.max(0, y0 - 1), ey1 = Math.min(TH, y1 + 1); // elevation rows: the band plus one row each side (gradients)
  const E = new Float32Array(TW * Math.max(0, ey1 - ey0));
  for (let y = ey0; y < ey1; y++) for (let x = 0; x < TW; x++) E[(y - ey0) * TW + x] = elevFull(D.lat0 - ((y + 0.5) / TS) * stLat, D.lon0 + ((x + 0.5) / TS) * stLon);
  const px = (stLon * KX * KM * 1000) / TS, py = (stLat * KM * 1000) / TS;
  for (let y = y0; y < y1; y++) for (let x = 0; x < TW; x++) {
    const i = (y - y0) * TW + x, ei = (y - ey0) * TW, e = E[ei + x];
    const right = E[ei + Math.min(x + 1, TW - 1)], left = E[ei + Math.max(x - 1, 0)];
    const down = E[(Math.min(y + 1, TH - 1) - ey0) * TW + x], up = E[(Math.max(y - 1, 0) - ey0) * TW + x];
    const gx = (right - left) / (2 * px), gy = (down - up) / (2 * py), slope = (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI;
    const len = Math.hypot(gx, gy, 1), shade = clamp((0.62 * gx - 0.62 * gy + 0.5) / len / 0.78, 0, 1.4);
    const wla = D.lat0 - ((y + 0.5) / TS) * stLat, wlo = D.lon0 + ((x + 0.5) / TS) * stLon;
    if ((LOW || WM) && isWater(wla, wlo)) { const k = 0.9 + 0.1 * Math.sin(x * 0.07 + y * 0.05); d[i * 4] = 92 * k; d[i * 4 + 1] = 142 * k; d[i * 4 + 2] = 166 * k; d[i * 4 + 3] = 255; continue; }
    // mix / colour-stop arithmetic on scalars: no arrays per pixel (this loop runs ~6M times)
    let r, gr, b, t;
    if (LOW) { t = smooth(14, 30, slope); r = 168 + (150 - 168) * t; gr = 178 + (142 - 178) * t; b = 132 + (120 - 132) * t; }
    else { lerpTo(VEG, e, VC); lerpTo(ROCK, e, RC); t = smooth(26, 42, slope); r = VC[0] + (RC[0] - VC[0]) * t; gr = VC[1] + (RC[1] - VC[1]) * t; b = VC[2] + (RC[2] - VC[2]) * t; }
    t = smooth(2350, 2550, e) * 0.8; r = r + (236 - r) * t; gr = gr + (238 - gr) * t; b = b + (242 - b) * t;
    const m = 0.62 + 0.42 * shade; r *= m; gr *= m; b *= m;
    if (shade < 0.75) { t = (0.75 - shade) * 0.45; r = r + (58 - r) * t; gr = gr + (74 - gr) * t; b = b + (112 - b) * t; }
    else if (shade > 1) { t = (shade - 1) * 0.3; r = r + (255 - r) * t; gr = gr + (236 - gr) * t; b = b + (204 - b) * t; }
    const w = contour(e, right, down, 250) ? 0.3 : contour(e, right, down, 50) ? 0.12 : 0;
    if (w) { r = r + (110 - r) * w; gr = gr + (76 - gr) * w; b = b + (44 - b) * w; }
    d[i * 4] = r; d[i * 4 + 1] = gr; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
  }

  if (part.rows) return { base, y0, y1, TW, TH };
  // object-space normal map from the full-resolution DEM (the mesh is averaged 2x2 on wide cuts, the shading keeps every ridge)
  const k = FC / DC >= 1.5 ? 2 : 1, C = DC * k, Rr = DR * k;
  const sx = 2 * (F.step * KX * KM), sz = 2 * (fsl * KM), f = EX / 1000;
  const at = (r, c) => FZ[clamp(r, 0, Rr - 1) * FC + clamp(c, 0, C - 1)];
  const normal = new Uint8Array(C * Rr * 4);
  for (let r = 0; r < Rr; r++) for (let c = 0; c < C; c++) {
    const gx = ((at(r, c + 1) - at(r, c - 1)) * f) / sx, gz = ((at(r + 1, c) - at(r - 1, c)) * f) / sz, l = Math.hypot(gx, 1, gz);
    const o = ((Rr - 1 - r) * C + c) * 4; // texture row 0 = south (v = 0)
    normal[o] = (-gx / l * 0.5 + 0.5) * 255; normal[o + 1] = (1 / l * 0.5 + 0.5) * 255; normal[o + 2] = (-gz / l * 0.5 + 0.5) * 255; normal[o + 3] = 255;
  }
  // baked ambient occlusion: horizon angle in 8 directions out to ~1 km, so gullies and cirques sit in their own shade
  const H = new Float32Array(C * Rr); for (let r = 0; r < Rr; r++) for (let c = 0; c < C; c++) H[r * C + c] = FZ[r * FC + c] * f;
  const ao = new Uint8Array(C * Rr * 4), apx = sx / 2, apz = sz / 2, DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]], STEPS = [1, 2, 3, 5, 8, 12, 18, 27, 40];
  const DL = DIRS.map(([dc, dr]) => Math.hypot(dc * apx, dr * apz));
  for (let r = 0; r < Rr; r++) for (let c = 0; c < C; c++) {
    const h0 = H[r * C + c]; let occ = 0;
    for (let j = 0; j < 8; j++) {
      const dc = DIRS[j][0], dr = DIRS[j][1], dl = DL[j]; let mx = 0;
      for (let si = 0; si < STEPS.length; si++) { const s = STEPS[si], rr = r + dr * s, cc = c + dc * s; if (rr < 0 || cc < 0 || rr >= Rr || cc >= C) break; const tn = (H[rr * C + cc] - h0) / (dl * s); if (tn > mx) mx = tn; }
      occ += mx / Math.sqrt(1 + mx * mx); // sin(horizon angle)
    }
    const v = clamp(1 - (occ / 8) * 1.35, 0.25, 1) * 255, o = ((Rr - 1 - r) * C + c) * 4;
    ao[o] = ao[o + 1] = ao[o + 2] = v; ao[o + 3] = 255;
  }
  return { base, y0, y1, normal, ao, TW, TH, C, Rr };
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = (e) => {
    try { const r = bakeTerrain(e.data); self.postMessage(r, [r.base.buffer, r.normal?.buffer, r.ao?.buffer].filter(Boolean)); }
    catch (err) { self.postMessage({ error: String(err?.message || err) }); }
  };
}
