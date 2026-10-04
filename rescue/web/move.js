/* Click-to-move (operator, live mode only): click a unit on the 2D map (its timeline dot or its live position marker) to
   select it, then click a point - the unit jumps there with a short glide, a target ring and a dashed line show the move,
   and the position goes to POST /api/positions/<sc> {unit, lat, lon, ts, source:"manual"} (fallback POST /api/fix), so
   livepos, the timeline, Zasoby and the engine see it. Esc, or clicking the selected unit again, cancels. Nothing selected:
   a click does what it did before. Drag / pan are untouched (MapLibre fires click only without a drag).
   Loaded by app.js next to livepos.js through window.__rescue2d. */
'use strict';
(function () {
  const H = window.__rescue2d; if (!H || !H.map || window.__move2d) return;
  window.__move2d = true;
  const map = H.map, empty = { type: 'FeatureCollection', features: [] };
  let sel = null, live = [], posApi = true, anim = null;
  const pin = () => { try { return (localStorage.getItem('rescue-pin') || '').replace(/^"(.*)"$/, '$1'); } catch (e) { return ''; } };
  const name = (u) => { const r = (H.units() || []).find((x) => x.id === u); return r && r.name ? r.name.split(' (')[0] : u; };
  const hint = document.createElement('div');
  hint.style.cssText = 'position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:5;background:rgba(17,24,32,.9);color:#fff;font:600 13px/1.3 system-ui,sans-serif;padding:6px 12px;border-radius:6px;pointer-events:none';
  hint.hidden = true; map.getContainer().appendChild(hint);
  function layers() {
    if (map.getSource('move2d')) return;
    map.addSource('move2d', { type: 'geojson', data: empty });
    map.addLayer({ id: 'move2d-line', type: 'line', source: 'move2d', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#e8590c', 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
    map.addLayer({ id: 'move2d-tgt', type: 'circle', source: 'move2d', filter: ['==', ['get', 'k'], 'tgt'], paint: { 'circle-radius': 9, 'circle-color': 'rgba(232,89,12,0.15)', 'circle-stroke-color': '#e8590c', 'circle-stroke-width': 2.5 } });
    map.addLayer({ id: 'move2d-unit', type: 'circle', source: 'move2d', filter: ['==', ['get', 'k'], 'unit'], paint: { 'circle-radius': 8, 'circle-color': '#e8590c', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 } });
    map.addLayer({ id: 'move2d-sel', type: 'circle', source: 'move2d', filter: ['==', ['get', 'k'], 'sel'], paint: { 'circle-radius': 14, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#e8590c', 'circle-stroke-width': 3 } });
  }
  const set = (feats) => { try { layers(); map.getSource('move2d').setData({ type: 'FeatureCollection', features: feats }); } catch (e) {} };
  const pt = (ll, k) => ({ type: 'Feature', properties: { k }, geometry: { type: 'Point', coordinates: ll } });
  function show() {
    hint.hidden = !sel;
    if (sel) hint.textContent = `${name(sel.id)}: kliknij cel na mapie · Esc anuluje`;
    if (!anim) set(sel ? [pt(sel.at, 'sel')] : []);
  }
  async function pollLive() {
    try {
      if (H.hist()) { live = []; return; }
      const h = {}; const p = pin(); if (p) h['X-Rescue-Pin'] = p;
      const r = await fetch('/api/positions/' + encodeURIComponent(H.sc()), { headers: h, cache: 'no-cache' });
      live = r.ok ? ((await r.json()).units || []) : [];
    } catch (e) {}
  }
  setInterval(pollLive, 5000); pollLive();
  function unitAt(point) {   // live markers first (newest position), then the timeline dots (tl-pos carries the actor id)
    let best = null, bd = 16;
    for (const u of live) { const q = map.project([u.lon, u.lat]), d = Math.hypot(q.x - point.x, q.y - point.y); if (d < bd) { bd = d; best = { id: u.unit, at: [u.lon, u.lat] }; } }
    if (best) return best;
    try {
      const f = map.queryRenderedFeatures([[point.x - 10, point.y - 10], [point.x + 10, point.y + 10]], { layers: ['tl-pos'] }).find((x) => x.properties && x.properties.id);
      if (f) return { id: f.properties.id, at: f.geometry.coordinates.slice() };
    } catch (e) {}
    return null;
  }
  async function post(unit, lat, lon) {
    const h = { 'Content-Type': 'application/json' }; const p = pin(); if (p) h['X-Rescue-Pin'] = p;
    const la = +lat.toFixed(6), lo = +lon.toFixed(6), sc = H.sc();
    try {
      if (posApi) {
        const r = await fetch('/api/positions/' + encodeURIComponent(sc), { method: 'POST', headers: h, body: JSON.stringify({ unit, lat: la, lon: lo, acc: 5, ts: new Date().toISOString(), source: 'manual', by: '2d-click' }) });
        if (r.ok) return true; if (r.status !== 404 && r.status !== 405) return false; posApi = false;
      }
      const r = await fetch('/api/fix', { method: 'POST', headers: h, body: JSON.stringify({ sc, actor: unit, lat: la, lon: lo, accM: 5, src: 'est' }) });
      return r.ok;
    } catch (e) { return false; }
  }
  function moveTo(u, to) {   // instant move on the server, a 1.2 s glide on screen (demo-friendly); livepos takes over at its next poll
    const from = u.at, t0 = performance.now(), D = 1200;
    post(u.id, to[1], to[0]).then((ok) => { if (!ok) { hint.hidden = false; hint.textContent = 'Nie udało się zapisać pozycji ' + name(u.id); setTimeout(show, 2500); } else pollLive(); });
    if (anim) cancelAnimationFrame(anim);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / D), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2, cur = [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e];
      set([{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [from, to] } }, pt(to, 'tgt'), pt(cur, 'unit')]);
      if (k < 1) anim = requestAnimationFrame(step);
      else { anim = null; setTimeout(() => { if (!anim) show(); }, 4000); }
    };
    anim = requestAnimationFrame(step);
  }
  map.on('click', (e) => {
    if (H.hist()) { if (sel) { sel = null; show(); } return; }
    const u = unitAt(e.point);
    if (u) { sel = sel && sel.id === u.id ? null : u; show(); return; }
    if (!sel) return;   // nothing selected: today's behaviour
    const s = sel; sel = null; hint.hidden = true;
    moveTo(s, [e.lngLat.lng, e.lngLat.lat]);
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && sel) { sel = null; show(); } });
})();
