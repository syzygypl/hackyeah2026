// Rescue machines: low-poly models drawn where the engine puts a unit (timeline actors, team arcs), instead of a ball.
// Display only: position and kind come from the engine; the model adds heading, spinning rotors and a beacon.
// Kinds: helicopter ('smiglowiec' / 'heli'), drone ('dron' / 'drone'), boat ('lodz'). Other kinds (foot teams, dogs,
// divers, the missing person) keep their markers: createMachine returns null for them.
// Scene units are km; the models are drawn ~1.5-3x real size, like the other markers, so they read from the overview.
const KIND = { smiglowiec: 'heli', heli: 'heli', dron: 'drone', drone: 'drone', lodz: 'boat', boat: 'boat' };
export const machineKind = (k) => KIND[k] || null;

let G = null; // shared geometries and materials, built once per page
function shared(THREE) {
  if (G) return G;
  const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
  const hull = (() => { // boat hull: a pointed outline extruded, bow at +x
    const s = new THREE.Shape(); s.moveTo(-0.009, -0.0035); s.lineTo(0.005, -0.0035); s.lineTo(0.011, 0); s.lineTo(0.005, 0.0035); s.lineTo(-0.009, 0.0035); s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: 0.0025, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, 0.0025, 0);
  })();
  G = {
    // helicopter, ~40 m with the rotor (a TOPR Sokół is ~20 m): fuselage, tail boom, fin, skids
    body: new THREE.SphereGeometry(0.006, 12, 8).scale(1.6, 0.95, 0.85),
    boom: new THREE.CylinderGeometry(0.0009, 0.0016, 0.014, 6).rotateZ(Math.PI / 2).translate(-0.014, 0.0015, 0),
    fin: box(0.004, 0.0055, 0.0006).translate(-0.0205, 0.0035, 0),
    skid: box(0.016, 0.0006, 0.0006),
    mast: new THREE.CylinderGeometry(0.0006, 0.0006, 0.0025, 6).translate(0, 0.0062, 0),
    blade: box(0.044, 0.0003, 0.0018),
    tailBlade: box(0.0065, 0.0012, 0.0003),
    disc: new THREE.CircleGeometry(0.022, 32).rotateX(-Math.PI / 2),
    // drone, ~25 m across: body, two crossed arms, four props
    dBody: box(0.006, 0.0025, 0.006),
    arm: box(0.026, 0.0008, 0.0012),
    prop: box(0.0085, 0.0002, 0.0012),
    pDisc: new THREE.CircleGeometry(0.0045, 20).rotateX(-Math.PI / 2),
    // boat, ~20 m: hull, cabin, windscreen
    hull, cabin: box(0.006, 0.0035, 0.0052).translate(-0.002, 0.0042, 0),
    beacon: new THREE.SphereGeometry(0.0012, 8, 6),
    dark: new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.6, metalness: 0.3 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf1f1ee, roughness: 0.5 }),
    blur: new THREE.MeshBasicMaterial({ color: 0x202428, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }),
    red: new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false }),
  };
  return G;
}

// returns { obj, tick(dt) } or null; obj's local +x is forward, y up; face it with setHeading
export function createMachine(THREE, kind, color) {
  const k = machineKind(kind); if (!k) return null;
  const g = shared(THREE), obj = new THREE.Group(), paint = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15 });
  obj.rotation.order = 'YXZ'; // yaw, then roll about the long axis, then pitch
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); obj.add(m); return m; };
  let spin = [], beacon = null, t = Math.random() * 10, bob = 0;
  if (k === 'heli') {
    add(g.body, paint); add(g.boom, paint); add(g.fin, paint);
    add(g.skid, g.dark, 0, -0.0065, 0.0042); add(g.skid, g.dark, 0, -0.0065, -0.0042); add(g.mast, g.dark);
    const rotor = new THREE.Group(); rotor.position.y = 0.0075;
    rotor.add(new THREE.Mesh(g.blade, g.dark), new THREE.Mesh(g.blade, g.dark).rotateY(Math.PI / 2), new THREE.Mesh(g.disc, g.blur)); obj.add(rotor);
    const tail = new THREE.Group(); tail.position.set(-0.0205, 0.0035, 0.0008); tail.add(new THREE.Mesh(g.tailBlade, g.dark)); obj.add(tail);
    spin = [[rotor, 'y', 28], [tail, 'z', 60]];
    beacon = add(g.beacon, g.red, -0.002, -0.006, 0); beacon.userData.glow = ['#ff3b30', 70];
  } else if (k === 'drone') {
    add(g.dBody, paint); add(g.arm, g.dark).rotation.y = Math.PI / 4; add(g.arm, g.dark).rotation.y = -Math.PI / 4;
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const p = new THREE.Group(); p.position.set(x * 0.0092, 0.0008, z * 0.0092);
      p.add(new THREE.Mesh(g.prop, g.dark), new THREE.Mesh(g.pDisc, g.blur)); obj.add(p); spin.push([p, 'y', 45 * x * z]);
    }
    beacon = add(g.beacon, g.red, 0, -0.0016, 0); beacon.scale.setScalar(0.6); beacon.userData.glow = ['#ff3b30', 45];
    bob = 0.0008;
  } else {
    add(g.hull, paint); add(g.cabin, g.white);
    bob = 0.0004;
  }
  const base = new THREE.Vector3();
  return {
    obj,
    tick(dt) {
      t += dt;
      for (const [o, axis, w] of spin) o.rotation[axis] += w * dt;
      if (beacon) beacon.visible = t % 1.2 < 0.12; // anti-collision strobe (and its night halo)
      if (bob) { obj.position.y -= base.y; base.y = Math.sin(t * (k === 'boat' ? 1.7 : 2.3)) * bob; obj.position.y += base.y; }
      if (k === 'boat') obj.rotation.x = Math.sin(t * 1.3) * 0.06;
    },
    // heading from a direction in the x/z plane; a small nose-down pitch while it moves (aircraft)
    setHeading(dx, dz, moving = true) {
      if (Math.hypot(dx, dz) < 1e-9) return;
      obj.rotation.y = Math.atan2(-dz, dx);
      if (k !== 'boat') obj.rotation.z = moving ? -0.12 : 0;
    },
    // the bob offset is part of position.y: callers set the position, then tick adds the bob again
    place(p) { obj.position.copy(p); obj.position.y += base.y; },
  };
}
