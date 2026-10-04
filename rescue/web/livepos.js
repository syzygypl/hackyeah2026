/* Live team positions on the operator's 2D map: GET /api/positions/<sc> every 5 s (rescue/rs positions.rs).
   Each unit = a marker in its colour with its name and the age of the fix, plus a trail of the last 10 min.
   No fix for 2 min = "stale" (grey, dashed trail). Hidden in Historia (run ?live=0): these are wall-clock positions.
   Loaded by app.js after the map is ready (window.__rescue2d: map, sc(), hist(), units()). */
'use strict';
(function () {
  const H = window.__rescue2d; if (!H || !H.map || window.__livepos) return;
  window.__livepos = true;
  const map = H.map, POLL_MS = 5000, TRAIL_MS = 10 * 60000, STALE_MS = 2 * 60000;
  const COLORS = ['#1f77b4', '#d62728', '#2ca02c', '#9467bd', '#ff7f0e', '#17becf', '#8c564b', '#e377c2'];
  const empty = { type: 'FeatureCollection', features: [] };
  const markers = new Map();   // unit -> { m: maplibregl.Marker, el }
  let skew = 0;                // server now - local now (ms), so ages do not depend on the operator's clock
  const color = (u) => { let h = 0; for (const c of u) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
  const name = (u) => { const r = (H.units() || []).find((x) => x.id === u); return r && r.name ? r.name.split(' (')[0] : u; };
  const ago = (ms) => ms < 60000 ? Math.max(0, Math.round(ms / 1000)) + ' s' : Math.round(ms / 60000) + ' min';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function pin() { try { return (localStorage.getItem('rescue-pin') || '').replace(/^"(.*)"$/, '$1'); } catch (e) { return ''; } }

  function ensureLayers() {
    if (map.getSource('livepos')) return;
    map.addSource('livepos', { type: 'geojson', data: empty });
    map.addLayer({ id: 'livepos-trail', type: 'line', source: 'livepos', filter: ['==', ['get', 'stale'], false],
      layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.85 } });
    map.addLayer({ id: 'livepos-trail-stale', type: 'line', source: 'livepos', filter: ['==', ['get', 'stale'], true],
      layout: { 'line-join': 'round' }, paint: { 'line-color': '#8a8a8a', 'line-width': 2.5, 'line-opacity': 0.7, 'line-dasharray': [2, 2] } });
  }
  function clearAll() {
    const src = map.getSource('livepos'); if (src) src.setData(empty);
    for (const v of markers.values()) v.m.remove();
    markers.clear();
  }
  function draw(d) {
    try { ensureLayers(); } catch (e) { return; }   // style being swapped (base layer change): next poll adds them again
    const now = Date.now() + skew, seen = new Set(), feats = [];
    for (const u of d.units || []) {
      const age = now - u.ts, stale = age > STALE_MS, col = color(u.unit);
      seen.add(u.unit);
      const pts = (u.trail || []).filter((p) => now - p[2] <= TRAIL_MS).map((p) => [p[1], p[0]]);
      if (pts.length > 1) feats.push({ type: 'Feature', properties: { unit: u.unit, color: col, stale }, geometry: { type: 'LineString', coordinates: pts } });
      let v = markers.get(u.unit);
      if (!v) {
        const el = document.createElement('div');
        el.style.cssText = 'display:flex;align-items:center;gap:4px;pointer-events:none;font:600 12px/1.2 system-ui,sans-serif';
        v = { el, m: new window.maplibregl.Marker({ element: el, anchor: 'left', offset: [-8, 0] }).setLngLat([u.lon, u.lat]).addTo(map) };
        markers.set(u.unit, v);
      }
      v.m.setLngLat([u.lon, u.lat]);
      const dot = stale ? '#9a9a9a' : col;
      v.el.title = `${name(u.unit)}: ±${Math.round(u.acc)} m, ${ago(age)} temu`;
      v.el.innerHTML = `<span style="width:14px;height:14px;border-radius:50%;background:${dot};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35)${stale ? ';opacity:.7' : ''}"></span>`
        + `<span style="background:rgba(255,255,255,.92);color:${stale ? '#666' : '#111'};padding:1px 5px;border-radius:4px;border-left:3px solid ${dot};white-space:nowrap">`
        + `${esc(name(u.unit))} · ${stale ? 'brak sygnału ' + ago(age) : ago(age) + ' temu'}</span>`;
    }
    for (const [k, v] of markers) if (!seen.has(k)) { v.m.remove(); markers.delete(k); }
    const src = map.getSource('livepos'); if (src) src.setData({ type: 'FeatureCollection', features: feats });
  }
  async function poll() {
    try {
      if (document.hidden) return;
      if (H.hist()) { clearAll(); return; }
      const sc = H.sc(); if (!sc || !/^[\w-]+$/.test(sc)) return;
      const h = {}; const p = pin(); if (p) h['X-Rescue-Pin'] = p;
      const r = await fetch('/api/positions/' + encodeURIComponent(sc), { headers: h, cache: 'no-cache' });
      if (!r.ok) { clearAll(); return; }
      const d = await r.json();
      if (Number.isFinite(d.now)) skew = d.now - Date.now();
      draw(d);
    } catch (e) { /* offline or no server: keep the last picture */ }
  }
  setInterval(poll, POLL_MS);
  poll();
})();
