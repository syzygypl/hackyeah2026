// Display only: consume the engine's minute samples, never simulator truth or inferred coverage.
export function sampleAt(path, minute) {
  if (!path?.length || minute < path[0][2]) return null;
  let lo = 0, hi = path.length - 1;
  while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (path[m][2] <= minute) lo = m; else hi = m - 1; }
  const a = path[lo], b = path[Math.min(lo + 1, path.length - 1)];
  const u = b[2] > a[2] ? Math.min(1, (minute - a[2]) / (b[2] - a[2])) : 0;
  return { lat: a[0] + (b[0] - a[0]) * u, lon: a[1] + (b[1] - a[1]) * u,
    accM: a[3] + (b[3] - a[3]) * u, est: u > 0 ? true : !!a[4], minute };
}

export function earlierFrame(frames, minute) {
  let out = null;
  for (const f of frames || []) { if (f.minute > minute) break; out = f; }
  return out;
}

export function timelineClock(timeline, minute) {
  const m = /^(?:\+(\d+)\s+)?(\d{2}):(\d{2})$/.exec(timeline.start || '');
  if (!m || !Number.isFinite(timeline.startMinute)) return timeline.start || '';
  const total = Math.round((Number(m[1] || 0) * 1440 + Number(m[2]) * 60 + Number(m[3])) + minute - timeline.startMinute);
  const day = Math.floor(total / 1440), clock = ((total % 1440) + 1440) % 1440;
  return `${day ? (day > 0 ? '+' : '') + day + ' ' : ''}${String(Math.floor(clock / 60)).padStart(2, '0')}:${String(clock % 60).padStart(2, '0')}`;
}

export function createTimeline3D({ THREE, run, scene, camera, controls, v3, eyeAt, line, drape, dispose, label,
  esc, nf, wake, onFrame, onStopCamera, onCamera, onActor, getFrame }) {
  const timeline = run.timeline;
  if (!timeline?.actors?.length) return null;
  const colors = { pieszy: '#b8860b', pies: '#8d5524', dron: '#6c4ab6', smiglowiec: '#1f4e79', lodz: '#168aad', osoba: '#cf473f' };
  const token = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const danger = () => token('--rl-danger', '#b8322a');
  let labelDown = null;
  const group = new THREE.Group(), trail = new THREE.Group(), area = new THREE.Group();
  scene.add(group, trail, area);
  const actors = timeline.actors.map((a) => {
    const g = new THREE.Group(), dot = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8),
      new THREE.MeshStandardMaterial({ color: colors[a.kind] || '#555' }));
    const tag = label('', 'team', new THREE.Vector3()); tag.position.y = 0.035;
    dot.userData.actorId = a.id;
    tag.element.dataset.actorId = a.id; tag.element.tabIndex = 0; tag.element.setAttribute('role', 'button');
    tag.element.title = 'Pokaż ślad i dziennik jednostki';
    tag.element.style.pointerEvents = 'auto'; tag.element.style.cursor = 'pointer';
    tag.element.onpointerdown = (e) => { labelDown = { id: a.id, x: e.clientX, y: e.clientY }; };
    tag.element.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectActor(a.id); } };
    g.add(dot, tag); group.add(g);
    return { ...a, g, tag, dot, color: colors[a.kind] || '#555' };
  });
  let target = null, shown = null, from = null, blend = 1, lastFrame = null, request = 0, fpp = null, savedCamera = null, selected = null, visible = true;
  const panel = document.createElement('div'); panel.id = 'timeline3dCtl'; panel.className = 'floating';
  panel.innerHTML = `<div class="tl3d-title">Perspektywa jednostki</div><select aria-label="Jednostka dla kamery FPP">${actors.map((a) => `<option value="${esc(a.id)}">${esc(a.name || a.id)}</option>`).join('')}</select><button class="btn full" type="button" title="Kamera na wysokości oczu; Esc wraca do mapy">FPP</button><div class="tl3d-key">● ślad GPS · - - ślad szacowany<br>okrąg: dokładność · obrys: pole widzenia</div><div class="tl3d-clock" aria-live="polite"></div>`;
  (document.getElementById('sceneCtl') || document.body).appendChild(panel);
  const select = panel.querySelector('select'), button = panel.querySelector('button'), status = panel.querySelector('.tl3d-clock');
  function stopFpp() {
    if (!fpp) return;
    fpp = null; controls.enabled = true;
    if (savedCamera) { camera.position.copy(savedCamera.position); controls.target.copy(savedCamera.target);
      camera.near = savedCamera.near; camera.updateProjectionMatrix(); controls.update(); }
    savedCamera = null; button.classList.remove('on'); button.textContent = 'FPP'; onCamera(false); wake();
  }
  function startFpp(id) {
    const a = actors.find((a) => a.id === id);
    if (!a || shown == null || !sampleAt(a.path, shown)) return false;
    if (!fpp) savedCamera = { position: camera.position.clone(), target: controls.target.clone(), near: camera.near };
    onStopCamera(); fpp = a.id; select.value = a.id; controls.enabled = false;
    camera.near = 0.0002; camera.updateProjectionMatrix();
    button.classList.add('on'); button.textContent = 'Wróć do mapy'; onCamera(true, a.id); wake(); return true;
  }
  button.onclick = () => { if (fpp) stopFpp(); else startFpp(select.value); };
  select.onchange = () => { if (fpp) { if (!startFpp(select.value)) stopFpp(); } };
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { stopFpp(); selectActor(null); } });
  addEventListener('pointerup', (e) => {
    const d = labelDown; labelDown = null;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= 5) selectActor(d.id);
  });
  addEventListener('pointercancel', () => { labelDown = null; });
  function selectActor(id, notify = true) {
    if (notify && id === selected) id = null;
    if (id != null && !actors.some((a) => a.id === id)) return false;
    selected = id; if (id != null) select.value = id;
    for (const a of actors) {
      a.tag.element.setAttribute('aria-pressed', String(a.id === id));
      a.tag.element.style.outline = a.id === id ? `2px solid ${danger()}` : '';
      a.dot.material.color.set(a.id === id ? danger() : a.color); a.dot.scale.setScalar(a.id === id ? 1.5 : 1);
    }
    if (target != null) trails(target);
    if (notify) onActor?.(id); wake(); return true;
  }
  function pickActor(ray, terrainDistance = Infinity) {
    const hit = ray.intersectObjects(actors.filter((a) => a.g.visible && a.dot.visible).map((a) => a.dot), false)[0];
    return hit && hit.distance <= terrainDistance + 0.02 ? selectActor(hit.object.userData.actorId) : false;
  }

  function rings(frame, minute) {
    dispose(area);
    for (const a of actors) {
      const p = sampleAt(a.path, minute); if (!p) continue;
      const ring = Array.from({ length: 49 }, (_, i) => { const angle = i / 48 * Math.PI * 2;
        return [p.lat + Math.cos(angle) * p.accM / 111320, p.lon + Math.sin(angle) * p.accM / (111320 * Math.cos(p.lat * Math.PI / 180))]; });
      drape(ring, 0.014, { color: a.color, width: 1, opacity: 0.45, dashed: true }, area);
      const outline = frame?.actors?.find((x) => x.id === a.id)?.fov;
      if (outline?.length > 2) drape(outline.map(([lon, lat]) => [lat, lon]), 0.018,
        { color: a.color, width: 1.7, opacity: 0.8 }, area);
    }
  }
  function trails(minute) {
    dispose(trail);
    for (const a of actors) {
      const color = selected === a.id ? danger() : a.color, opacity = selected && selected !== a.id ? 0.25 : 0.9;
      const path = a.path || []; let pts = [], dashed = null;
      const flush = () => {
        if (pts.length < 2) return;
        if (selected === a.id) trail.add(line(pts, { color: token('--rl-panel-solid', '#faf8f3'), width: 8, opacity: 0.95, dashed, dash: 0.025, gap: 0.02 }));
        trail.add(line(pts, { color, width: selected === a.id ? 4 : 2, opacity, dashed, dash: 0.025, gap: 0.02 }));
      };
      for (let i = 1; i < path.length && path[i - 1][2] < minute; i++) {
        const p = path[i - 1], q = path[i], end = q[2] <= minute ? { lat: q[0], lon: q[1] } : sampleAt(path, minute);
        // A GPS trace connects two GPS fixes; everything based on an estimate remains dashed.
        const est = !!p[4] || !!q[4];
        if (est !== dashed) { flush(); pts = [v3(p[0], p[1], 0.025)]; dashed = est; }
        pts.push(v3(end.lat, end.lon, 0.025));
      }
      flush();
      // Observed GPS fixes are solid dots, not invented one-minute GPS samples.
      const fixes = (a.fixes || []).filter((f) => f.minute <= minute && f.src === 'gps');
      if (fixes.length) {
        const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.005, 6, 4),
          new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity }), fixes.length);
        fixes.forEach((f, i) => { const p = v3(f.lat, f.lon, 0.027); dots.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)); });
        dots.instanceMatrix.needsUpdate = true; trail.add(dots);
      }
    }
  }
  function apply(frame, minute) {
    lastFrame = frame; onFrame(frame, minute);
    rings(frame, minute); trails(minute); wake();
  }
  function setTime(minute, t, animate = true, suppliedFrame = null) {
    if (!Number.isFinite(minute)) return;
    const previous = target;
    target = Math.min(timeline.endMinute, minute); from = shown ?? target;
    blend = animate && previous != null && target >= previous && target - previous <= 2 ? 0 : 1;
    if (blend === 1) shown = target;
    const frame = suppliedFrame || earlierFrame(timeline.frames, target);
    const clock = t || timelineClock(timeline, target);
    status.textContent = `${clock}${frame ? ' · pokrycie (POD)' : ''}`;
    apply(frame, target);
    const gen = ++request;
    // A frames=0 run still works: fetch the exact frame on this origin; ignore late responses after a scrub.
    if (!frame && getFrame && clock && target >= timeline.startMinute) getFrame(clock).then((f) => { if (gen === request && f) apply(f, target); }).catch(() => {});
  }
  function tick(dt) {
    if (target == null || !visible) return false;
    const moving = blend < 1;
    blend = Math.min(1, blend + dt / 0.5); shown = from + (target - from) * blend;
    for (const a of actors) {
      const p = sampleAt(a.path, shown); a.g.visible = !!p;
      a.dot.visible = a.tag.visible = fpp !== a.id;
      if (!p) continue;
      const lift = a.kind === 'dron' || a.kind === 'smiglowiec' ? (a.fov?.eyeM || 80) / 1000 : 0.023;
      a.g.position.copy(v3(p.lat, p.lon, lift));
      const short = (a.name || a.id).split(' (')[0].replace(/^Patrol /, '').replace('Zespół z psem', 'Pies').replace('Dron termowizyjny', 'Dron').replace('Śmigłowiec ', '');
      const text = esc(short);
      if (a.tag.element.innerHTML !== text) a.tag.element.innerHTML = text;
      a.tag.element.title = `${a.name || a.id} · ${p.est ? 'szacunek' : 'GPS'} · dokładność ±${nf(p.accM, 0)} m · pokaż ślad i dziennik`;
      if (fpp === a.id) {
        const next = sampleAt(a.path, Math.min(shown + 0.5, a.path.at(-1)[2]));
        const eye = eyeAt(p.lat, p.lon, a.fov?.eyeM || 1.7);
        const heading = lastFrame?.actors?.find((x) => x.id === a.id)?.headingDeg ?? 0;
        let look = next ? eyeAt(next.lat, next.lon, a.fov?.eyeM || 1.7) : eye.clone();
        if (look.distanceTo(eye) < 0.001) { const rad = heading * Math.PI / 180; look = eye.clone().add(new THREE.Vector3(Math.sin(rad) * 0.05, 0, -Math.cos(rad) * 0.05)); }
        camera.position.copy(eye); controls.target.copy(look); camera.lookAt(look);
      }
    }
    if (fpp && !actors.find((a) => a.id === fpp)?.g.visible) stopFpp();
    return moving || !!fpp;
  }
  function setVisible(on) { visible = on; group.visible = trail.visible = area.visible = on; panel.hidden = !on; if (!on) stopFpp(); }
  function layoutLabels() {
    const placed = [];
    const order = [...actors].sort((a, b) => Number(b.id === selected) - Number(a.id === selected));
    for (const a of order) {
      const el = a.tag.element;
      const p = a.tag.getWorldPosition(new THREE.Vector3()).project(camera);
      const x = (p.x + 1) * innerWidth / 2, y = (1 - p.y) * innerHeight / 2;
      const w = el.offsetWidth, h = el.offsetHeight;
      const r = { l: x - w / 2 - 3, r: x + w / 2 + 3, t: y - h / 2 - 3, b: y + h / 2 + 3 };
      const hide = !visible || document.body.classList.contains('cinema') || !a.g.visible || !a.tag.visible || p.z > 1 || p.z < -1 ||
        placed.some((b) => r.l < b.r && r.r > b.l && r.t < b.b && r.b > b.t);
      el.style.visibility = hide ? 'hidden' : 'visible';
      el.style.pointerEvents = hide ? 'none' : 'auto';
      if (a.id === selected) el.style.zIndex = '10000';
      if (!hide) placed.push(r);
    }
  }
  return { setTime, tick, startFpp, stopFpp, selectActor, pickActor, setVisible, layoutLabels, get selected() { return selected; }, get minute() { return shown; }, get frame() { return lastFrame; },
    get following() { return fpp; }, get actorCount() { return actors.filter((a) => a.g.visible).length; } };
}
