// Display engine FOV polygons on the rendered terrain. Never feed these meshes back into POD.
export function createFov3D({ THREE, scene, actors, eyeAt, wake }) {
  const group = new THREE.Group(); scene.add(group);
  const layers = new Map(), history = []; let enabled = true, visible = true, frame = null, minute = null;
  const colorOf = (a) => new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(
    a.kind === 'pies' ? '--rl-warn' : a.kind === 'dron' ? '--rl-accent' : '--rl-ok').trim());
  const shape = (ring, center) => {
    const coordinates = [center];
    for (let k = 1; k <= 3; k++) for (const [lon, lat] of ring.slice(0, -1))
      coordinates.push([center[0] + (lat - center[0]) * k / 3, center[1] + (lon - center[1]) * k / 3]);
    return coordinates;
  };
  function create(a, ring, center, ghost = false) {
    const n = ring.length - 1, points = shape(ring, center), color = ghost ? new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--rl-ok').trim()) : colorOf(a), rgba = [], indices = [];
    for (let i = 0; i < points.length; i++) rgba.push(color.r, color.g, color.b, i === 0 ? 0.34 : 0.34 * (1 - Math.ceil(i / n) / 3 * 0.75));
    for (let j = 0; j < n; j++) indices.push(0, 1 + j, 1 + (j + 1) % n);
    for (let k = 1; k < 3; k++) for (let j = 0; j < n; j++) {
      const a = 1 + (k - 1) * n + j, b = 1 + (k - 1) * n + (j + 1) % n;
      indices.push(a, a + n, b, b, a + n, b + n);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points.length * 3), 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(rgba, 4)); geometry.setIndex(indices);
    const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true,
      side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    const edgeGeo = new THREE.BufferGeometry(); edgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const edge = new THREE.LineLoop(edgeGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
    const g = new THREE.Group(); g.userData.actorId = a.id; g.userData.ghost = ghost;
    g.add(fill); if (!ghost) g.add(edge); let cone = null;
    if (!ghost && (a.kind === 'dron' || a.kind === 'smiglowiec')) {
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 1) * 3), 3));
      const idx = []; for (let j = 0; j < n; j++) idx.push(0, 1 + j, 1 + (j + 1) % n); geo.setIndex(idx);
      cone = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true,
        opacity: a.kind === 'dron' ? 0.14 : 0.06, side: THREE.DoubleSide, depthWrite: false })); g.add(cone);
    }
    for (const o of g.children) o.frustumCulled = false;
    group.add(g); return { a, g, fill, edge, cone, n, from: points, to: points, blend: 1, ghost };
  }
  function coordinates(layer) {
    return layer.to.map((p, i) => [layer.from[i][0] + (p[0] - layer.from[i][0]) * layer.blend,
      layer.from[i][1] + (p[1] - layer.from[i][1]) * layer.blend]);
  }
  function draw(layer) {
    const ll = coordinates(layer), points = ll.map(([lat, lon]) => eyeAt(lat, lon, 1.5));
    const set = (attr, vectors) => { vectors.forEach((p, i) => attr.setXYZ(i, p.x, p.y, p.z)); attr.needsUpdate = true; };
    set(layer.fill.geometry.attributes.position, points);
    const boundary = points.slice(-layer.n); set(layer.edge.geometry.attributes.position, boundary);
    if (layer.cone) set(layer.cone.geometry.attributes.position, [eyeAt(ll[0][0], ll[0][1], layer.a.fov.observerHeightM), ...boundary]);
  }
  function remove(layer) { group.remove(layer.g); layer.g.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); if (layer.ghost) { layer.edge.geometry.dispose(); layer.edge.material.dispose(); } }
  function setFrame(next, at, animate = true) {
    if (next === frame) {
      if (at < minute) { history.forEach(remove); history.length = 0; for (const l of layers.values()) { l.blend = 1; draw(l); } }
      minute = at; return;
    }
    const forward = minute != null && at >= minute && at - minute <= 5;
    if (!forward || !next) { history.forEach(remove); history.length = 0; }
    else if (frame && next.minute > frame.minute && at - frame.minute < 3) {
      for (const x of frame.actors || []) {
        const a = actors.find((a) => a.id === x.id);
        if (a?.kind !== 'dron' || !x.fov?.length || !x.pos?.length) continue;
        const ghost = create(a, x.fov, x.pos, true); ghost.born = frame.minute; draw(ghost); history.push(ghost);
      }
      while (history.length > 4) remove(history.shift());
    }
    minute = at; frame = next; const ids = new Set();
    for (const x of next?.actors || []) {
      const a = actors.find((a) => a.id === x.id), ring = x.fov;
      if (!a || !ring || ring.length < 4 || !x.pos?.length) continue;
      ids.add(a.id); let layer = layers.get(a.id);
      if (layer && layer.n !== ring.length - 1) { remove(layer); layers.delete(a.id); layer = null; }
      if (!layer) { layer = create(a, ring, x.pos); layers.set(a.id, layer); }
      else { layer.from = coordinates(layer); layer.to = shape(ring, x.pos); layer.blend = animate && forward ? 0 : 1; }
      draw(layer);
    }
    for (const [id, layer] of layers) if (!ids.has(id)) { remove(layer); layers.delete(id); }
    wake();
  }
  function tick(dt, fpp, at) {
    let moving = false;
    for (const layer of layers.values()) {
      layer.g.visible = layer.a.id !== fpp;
      if (layer.blend < 1) { layer.blend = Math.min(1, layer.blend + dt / 0.5); draw(layer); moving = true; }
    }
    for (let i = history.length - 1; i >= 0; i--) {
      const age = at - history[i].born;
      if (age < 0 || age >= 3) { remove(history[i]); history.splice(i, 1); }
      else { history[i].fill.material.opacity = 0.6 * (1 - age / 3); history[i].g.visible = history[i].a.id !== fpp; }
    }
    return moving;
  }
  return { setFrame, tick, setVisible(on) { visible = on; group.visible = visible && enabled; },
    setEnabled(on) { enabled = on; group.visible = visible && enabled; wake(); },
    get count() { return layers.size; }, get trailCount() { return history.length; }, get frameMinute() { return frame?.minute; }, group };
}
