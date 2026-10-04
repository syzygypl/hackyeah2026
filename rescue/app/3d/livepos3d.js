// Live team positions in 3D (Na żywo only): GET /api/positions/<sc> every 5 s (rescue/rs positions.rs), the same picture
// as the 2D layer web/livepos.js - a pin in the unit's colour (same hash and palette as 2D) with its name and the age of
// the fix, a trail of the last 10 min; no fix for 2 min = grey pin, dashed grey trail, "brak sygnału N min".
// Units that are timeline actors (skip) keep their machines3d model and get only the trail and the label.
// Everything sits in its own group under `parent` (dyn.live), so FPP hides it with the other live layers. The group is
// rebuilt only when a poll brings an answer, so nothing runs per frame.
const POLL_MS = 5000, TRAIL_MS = 10 * 60000, STALE_MS = 2 * 60000;
const COLORS = ['#1f77b4', '#d62728', '#2ca02c', '#9467bd', '#ff7f0e', '#17becf', '#8c564b', '#e377c2'];   // = web/livepos.js
const STALE_COL = '#9a9a9a';

export function createLivePos3D({ THREE, pin, label, v3, drape, dispose, wake, inside, esc, parent, sc, isLive, units, skip = () => false }) {
  const group = new THREE.Group(); group.name = 'livepos'; parent.add(group);
  let skew = 0, shown = '', busy = false;
  const color = (u) => { let h = 0; for (const c of u) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
  const name = (u) => { const r = (units() || []).find((x) => x.id === u); return r && r.name ? r.name.split(' (')[0] : u; };
  const ago = (ms) => (ms < 60000 ? Math.max(0, Math.round(ms / 1000)) + ' s' : Math.round(ms / 60000) + ' min');
  const pinKey = () => { try { return (localStorage.getItem('rescue-pin') || '').replace(/^"(.*)"$/, '$1'); } catch (e) { return ''; } };

  function clear() { if (group.children.length) { dispose(group); shown = ''; wake(); } }
  function draw(d) {
    const now = Date.now() + skew;
    const list = (d.units || []).filter((u) => inside([u.lat, u.lon]));
    // same picture as last time (ages rounded to what the labels show): no rebuild
    const sig = JSON.stringify(list.map((u) => [u.unit, u.ts, u.trail?.length, ago(now - u.ts)]));
    if (sig === shown) return;
    dispose(group); shown = sig;
    for (const u of list) {
      const age = now - u.ts, stale = age > STALE_MS, col = stale ? STALE_COL : color(u.unit);
      const trail = (u.trail || []).filter((p) => now - p[2] <= TRAIL_MS).map((p) => [p[0], p[1]]);
      if (trail.length > 1) drape(trail, 0.006, stale ? { color: STALE_COL, width: 2.5, opacity: 0.8, dashed: true, dash: 0.03, gap: 0.025 } : { color: col, width: 3.5, opacity: 0.9 }, group);
      const text = `${esc(name(u.unit))} · ${stale ? 'brak sygnału ' + ago(age) : ago(age) + ' temu'}`;
      const html = `<span style="border-left:3px solid ${col};padding-left:4px${stale ? ';color:#666' : ''}">${text}</span>`;
      // a timeline actor already has its model (machines3d, engine track): only the trail and the label, no second marker;
      // class patrol = declutter priority 4.5, above the estimated unit chips (team, 4): the live fix wins an overlap
      if (skip(u.unit)) group.add(label(html, 'team patrol livepos', v3(u.lat, u.lon, 0.05)));
      else group.add(pin(u.lat, u.lon, col, 0.12, html, 'team patrol livepos', 0.014));
    }
    wake();
  }
  async function poll() {
    if (busy || document.hidden) return;
    if (!isLive()) { clear(); return; }
    busy = true;
    try {
      const h = {}; const p = pinKey(); if (p) h['X-Rescue-Pin'] = p;
      const r = await fetch('/api/positions/' + encodeURIComponent(sc), { headers: h, cache: 'no-cache' });
      if (!r.ok) { clear(); return; }
      const d = await r.json();
      if (Number.isFinite(d.now)) skew = d.now - Date.now();
      if (isLive()) draw(d); else clear();
    } catch (e) { /* offline: keep the last picture */ } finally { busy = false; }
  }
  const timer = setInterval(poll, POLL_MS);
  poll();
  return { group, poll, stop() { clearInterval(timer); clear(); } };
}
