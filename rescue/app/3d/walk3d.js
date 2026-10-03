// Free walk (Spacer, Andrzej): "Spacer", then a click on the terrain -> first-person camera at eye height on that spot.
// W/S or Up/Down walk, A/D strafe, Left/Right turn, mouse drag looks around, Shift = faster, Esc ends and restores the view.
// The eye follows the terrain mesh (eyeAt = mesh height + eye height), so it walks over ridges and into the gullies.
// World units: x/z in km, y in km x vertical exaggeration (eyeAt handles both).
export function createWalk3D({ THREE, camera, controls, eyeAt, toLat, toLon, bounds, host, wake, onStart, onStop }) {
  const EYE_M = 1.7, WALK = 0.012, RUN = 5, TURN = 1.6;   // 12 m/s walking pace on a map (Shift x5), 1.6 rad/s turn
  let armed = false, on = false, yaw = 0, pitch = 0, x = 0, z = 0, saved = null, drag = null;
  const keys = new Set();
  const hint = document.createElement('div'); hint.id = 'walkHint'; hint.hidden = true;
  hint.innerHTML = '<b>Spacer</b> W/S lub ↑/↓ idź · A/D w bok · ←/→ obrót · przeciągnij myszą: rozglądanie · Shift: szybciej · Esc: koniec';
  document.body.appendChild(hint);
  const typing = () => { const a = document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); };
  function arm(v = !armed) {
    if (on) { stop(); return; }
    armed = v; document.body.classList.toggle('walk-arm', armed);
    hint.hidden = !armed; if (armed) hint.innerHTML = '<b>Spacer</b> kliknij w teren, gdzie zacząć · Esc: anuluj';
  }
  function place() {
    x = Math.max(bounds.x0, Math.min(bounds.x1, x)); z = Math.max(bounds.z0, Math.min(bounds.z1, z));
    const eye = eyeAt(toLat(z), toLon(x), EYE_M);
    const d = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    camera.position.copy(eye); controls.target.copy(eye).addScaledVector(d, 0.05); camera.lookAt(controls.target);
  }
  function start(point) {
    armed = false; document.body.classList.remove('walk-arm');
    saved = { pos: camera.position.clone(), target: controls.target.clone(), near: camera.near };
    // face the way the camera was looking, so the first view continues the map view
    const v = new THREE.Vector3().subVectors(point, camera.position); yaw = Math.atan2(v.x, -v.z); pitch = 0;
    x = point.x; z = point.z; on = true; controls.enabled = false;
    camera.near = 0.0002; camera.updateProjectionMatrix();
    hint.innerHTML = '<b>Spacer</b> W/S lub ↑/↓ idź · A/D w bok · ←/→ obrót · przeciągnij myszą: rozglądanie · Shift: szybciej · Esc: koniec';
    hint.hidden = false; document.body.classList.add('walking');
    onStart?.(); place(); wake();
  }
  function stop() {
    if (!on && !armed) return;
    armed = false; document.body.classList.remove('walk-arm', 'walking'); hint.hidden = true; keys.clear(); drag = null;
    if (on) {
      on = false; controls.enabled = true;
      if (saved) { camera.position.copy(saved.pos); controls.target.copy(saved.target); camera.near = saved.near; camera.updateProjectionMatrix(); controls.update(); }
      saved = null; onStop?.(); wake();
    }
  }
  function tick(dt) {
    if (!on) return false;
    const k = (c) => keys.has(c), sp = WALK * (k('ShiftLeft') || k('ShiftRight') ? RUN : 1) * dt;
    yaw += ((k('ArrowRight') ? 1 : 0) - (k('ArrowLeft') ? 1 : 0)) * TURN * dt;
    const fwd = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0), side = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
    x += (Math.sin(yaw) * fwd + Math.cos(yaw) * side) * sp; z += (-Math.cos(yaw) * fwd + Math.sin(yaw) * side) * sp;
    place();
    return true;   // keep rendering while walking
  }
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (on || armed)) { stop(); return; }
    if (!on || typing()) return;
    if (/^(Key[WASD]|Arrow(Up|Down|Left|Right)|Shift(Left|Right))$/.test(e.code)) { keys.add(e.code); e.preventDefault(); wake(); }
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  host.addEventListener('pointerdown', (e) => { if (on) { drag = { x: e.clientX, y: e.clientY }; e.preventDefault(); } });
  addEventListener('pointermove', (e) => {
    if (!on || !drag) return;
    yaw += (e.clientX - drag.x) * 0.004; pitch = Math.max(-1.2, Math.min(1.2, pitch - (e.clientY - drag.y) * 0.004));
    drag = { x: e.clientX, y: e.clientY }; place(); wake();
  });
  addEventListener('pointerup', () => { drag = null; });
  // the 3D click handler asks first: while armed, a click on the terrain starts the walk; while walking, clicks only look around
  function click(hit) { if (on) return true; if (!armed) return false; if (hit) start(hit.point); return true; }
  return { arm, start, stop, tick, click, get on() { return on; }, get armed() { return armed; } };
}
