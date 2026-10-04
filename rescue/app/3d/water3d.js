// High-resolution water mask for the 3D view (about 4 m per pixel over the whole cut).
// Rivers, streams and canals from data/<sc>-water3d.json (make_water3d.py: OSM waterway lines with a width, water
// polygons) are drawn as continuous ribbons, lakes and riverbanks as their polygons; the scenario terrain's waterMask
// (a 100 m grid over the scenario bbox) only adds the sea, i.e. its wet cells that no polygon or line explains.
// Without the water3d file the scenario terrain's own lakePolygons and streams are drawn instead.
// The result is one byte per pixel, row 0 = SOUTH (the layout fx3d.seaWaves samples), plus at(lat, lon) for isWater.

const dec = (a) => { const o = []; let la = 0, lo = 0; for (let i = 0; i < a.length; i += 2) { la += a[i]; lo += a[i + 1]; o.push([la / 1e5, lo / 1e5]); } return o; };
const MIN_PX = 2.6; // narrowest ribbon: below ~2.5 px a bilinear mask thresholded at 0.5 breaks into dashes again

export function waterRaster({ latN, latS, lonW, lonE, WKM, HKM, W3D, TER, wm, coarse, coarseRad }) {
  const t0 = performance.now();
  const W = Math.max(512, Math.min(3072, Math.round((WKM * 1000) / 4))), H = Math.max(2, Math.round((W * HKM) / WKM));
  const mPx = (WKM * 1000) / W; // metres per pixel
  const X = (lo) => ((lo - lonW) / (lonE - lonW)) * W, Y = (la) => ((latN - la) / (latN - latS)) * H;
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  // 1. polygons (white) and ribbons (grey by width: a stream reads as shallow water, a river as deep), on black
  const polys = [], lines = [];
  if (W3D && W3D.v === 1) {
    for (const [, outer, inner] of W3D.p || []) polys.push([...outer.map(dec), ...(inner || []).map(dec)]);
    for (const [, wM, l] of W3D.w || []) lines.push([wM, dec(l)]);
  }
  for (const p of TER?.lakePolygons || []) polys.push([...(p.outer || []), ...(p.inner || [])]);
  if (!W3D) for (const s of TER?.streams || []) lines.push([/wisła|odra|warta|bug|narew|san\b|dunajec|biebrza/i.test(s.name || '') ? 60 : 6, s.points]);
  const path = (c, rings, sx, sy) => { c.beginPath(); for (const r of rings) r.forEach(([la, lo], i) => (i ? c.lineTo(X(lo) * sx, Y(la) * sy) : c.moveTo(X(lo) * sx, Y(la) * sy))); };
  const draw = (w, h, polyFill, lineMin, grey) => { // one layer at w x h px: polygons, ribbons (either may be off)
    const cv = mk(w, h), c = cv.getContext('2d'), sx = w / W, sy = h / H;
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.lineCap = c.lineJoin = 'round';
    if (polyFill) for (const rings of polys) { path(c, rings, sx, sy); c.fill('evenodd'); }
    if (lineMin) for (const [wM, pts] of [...lines].sort((a, b) => a[0] - b[0])) { // wide last: a river wins over its streams
      const v = grey ? Math.round(255 * Math.min(1, 0.8 + wM / 150)) : 255; c.strokeStyle = `rgb(${v},${v},${v})`;
      c.lineWidth = Math.max(lineMin, (wM / mPx) * sx); path(c, [pts], sx, sy); c.stroke();
    }
    return cv;
  };
  // 2. sea: the coarse mask's wet cells that the polygons do not explain (512 px grid, box-blurred as before)
  // (a waterMask cell counts as explained when the polygons or ribbons, drawn on the same 512 px grid, come within ~45 m
  // of its centre, where osm_terrain.py tested it; the low-DEM sea outside the scenario bbox is never explained)
  const C = 512, Rw = Math.max(2, Math.round((C * HKM) / WKM)), m = new Float32Array(C * Rw); let nSea = 0, pd = null;
  const seen = new Map(), explained = (la, lo) => {
    if (!wm || la > wm.b.north || la < wm.b.south || lo < wm.b.west || lo > wm.b.east) return false;
    const wr = Math.min(wm.rows - 1, Math.floor(((wm.b.north - la) / (wm.b.north - wm.b.south)) * wm.rows)), wc = Math.min(wm.cols - 1, Math.floor(((lo - wm.b.west) / (wm.b.east - wm.b.west)) * wm.cols));
    const k = wr * wm.cols + wc; if (seen.has(k)) return seen.get(k);
    if (!pd) { const cv = draw(C, Rw, true, 1, false); pd = cv.getContext('2d').getImageData(0, 0, C, Rw).data; cv.width = cv.height = 0; }
    const cla = wm.b.north - ((wr + 0.5) / wm.rows) * (wm.b.north - wm.b.south), clo = wm.b.west + ((wc + 0.5) / wm.cols) * (wm.b.east - wm.b.west);
    const r0 = Math.floor(((latN - cla) / (latN - latS)) * Rw), c0 = Math.floor(((clo - lonW) / (lonE - lonW)) * C);
    let hit = false;
    for (let dr = -2; dr <= 2 && !hit; dr++) for (let dc = -2; dc <= 2; dc++) { const rr = r0 + dr, cc = c0 + dc; if (rr >= 0 && cc >= 0 && rr < Rw && cc < C && pd[(rr * C + cc) * 4] > 40) { hit = true; break; } }
    seen.set(k, hit); return hit;
  };
  for (let r = 0; r < Rw; r++) for (let c = 0; c < C; c++) {
    const la = latN - ((r + 0.5) / Rw) * (latN - latS), lo = lonW + ((c + 0.5) / C) * (lonE - lonW);
    if (coarse(la, lo) && !explained(la, lo)) { m[r * C + c] = 1; nSea++; }
  }
  const F = mk(W, H), f = F.getContext('2d');
  f.fillStyle = '#000'; f.fillRect(0, 0, W, H);
  if (nSea > 20) {
    const rad = coarseRad, blur = (src, dx, dy) => { const out = new Float32Array(src.length); for (let r = 0; r < Rw; r++) for (let c = 0; c < C; c++) { let a = 0, k = 0; for (let t = -rad; t <= rad; t++) { const rr = r + t * dy, cc = c + t * dx; if (rr >= 0 && rr < Rw && cc >= 0 && cc < C) { a += src[rr * C + cc]; k++; } } out[r * C + c] = a / k; } return out; };
    const mb = blur(blur(m, 1, 0), 0, 1), S = mk(C, Rw), sg = S.getContext('2d'), img = sg.createImageData(C, Rw);
    for (let i = 0; i < C * Rw; i++) { img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = mb[i] * 255; img.data[4 * i + 3] = 255; }
    sg.putImageData(img, 0, 0);
    f.imageSmoothingEnabled = true; f.imageSmoothingQuality = 'high'; f.drawImage(S, 0, 0, W, H);
  }
  // 3. over it: polygons softened by ~2 px (shallow shore band, deeper inside; the 0.5 edge stays on the outline),
  // ribbons by ~1 px (no stair steps)
  f.globalCompositeOperation = 'lighten';
  const Q = draw(W, H, true, 0, false), L = draw(W, H, false, MIN_PX, true);
  f.filter = 'blur(2px)'; f.drawImage(Q, 0, 0); f.filter = 'blur(1px)'; f.drawImage(L, 0, 0);
  f.filter = 'none'; f.globalCompositeOperation = 'source-over';
  const fd = f.getImageData(0, 0, W, H).data, tex = new Uint8Array(W * H); let n = 0;
  for (let y = 0; y < H; y++) { const o = (H - 1 - y) * W; for (let x = 0; x < W; x++) { const v = fd[(y * W + x) * 4]; tex[o + x] = v; if (v > 127) n++; } }
  L.width = L.height = Q.width = Q.height = F.width = F.height = 0; // free the canvases now
  performance.measure('water3d', { start: t0 }); // build time, for ?stats=1 checks
  return {
    W, H, tex, n, mPx,
    at(la, lo) {
      const x = Math.floor(((lo - lonW) / (lonE - lonW)) * W), y = Math.floor(((latN - la) / (latN - latS)) * H);
      return x >= 0 && y >= 0 && x < W && y < H && tex[(H - 1 - y) * W + x] > 127;
    },
  };
}
