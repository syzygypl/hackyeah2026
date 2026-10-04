// Rescue machines: low-poly models drawn where the engine puts a unit (timeline actors, team arcs), instead of a ball.
// Display only: position and kind come from the engine; the model adds heading, spinning rotors and a beacon.
// Kinds: helicopter ('smiglowiec' / 'heli'), drone ('dron' / 'drone'), boat ('lodz'), foot team of three ('pieszy' /
// 'ground'), dog team: handler + dog ('pies' / 'dog'), divers with a diver-down buoy ('nurkowie' / 'diver'), and the
// missing person ('osoba', the engine's estimate, a single figure). Anything else keeps its marker (null).
// People walk (legs and arms swing) while the unit moves; the lead rescuer's head lamp gets a halo at night.
// Scene units are km; the models are drawn ~1.5-3x real size, like the other markers, so they read from the overview.
const KIND = { smiglowiec: 'heli', heli: 'heli', dron: 'drone', drone: 'drone', lodz: 'boat', boat: 'boat',
  pieszy: 'team', ground: 'team', pies: 'dog', dog: 'dog', nurkowie: 'divers', diver: 'divers', osoba: 'person' };
const SURFACE = { heli: 'air', drone: 'air', boat: 'water', divers: 'water' }; // the rest walks on the ground
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
    // people, ~11 m tall like the other markers (5-6x): limbs pivot at the hip / shoulder, forward = +x, sideways = z
    leg: box(0.0011, 0.0048, 0.0011).translate(0, -0.0024, 0), arm: box(0.0008, 0.0038, 0.0008).translate(0, -0.0019, 0),
    torso: box(0.0018, 0.004, 0.003), head: new THREE.SphereGeometry(0.0013, 10, 8), helmet: new THREE.SphereGeometry(0.00145, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    lamp: new THREE.SphereGeometry(0.00045, 6, 4),
    // dog (German shepherd-ish), ~5 m at the shoulder on the same scale
    dBodyK: box(0.0072, 0.0026, 0.0022), dSaddle: box(0.0042, 0.0008, 0.0024), dVest: box(0.0028, 0.0028, 0.0025),
    dHead: box(0.0028, 0.0022, 0.0018), dSnout: box(0.0016, 0.001, 0.0011), dEar: box(0.0006, 0.0012, 0.0005),
    dTail: box(0.0035, 0.0006, 0.0006).translate(-0.00175, 0, 0), dLeg: box(0.0008, 0.0031, 0.0008).translate(0, -0.00155, 0),
    // divers: heads in the water and a diver-down buoy
    mask: box(0.0006, 0.0007, 0.0016), buoy: new THREE.SphereGeometry(0.0013, 10, 8), mast: new THREE.CylinderGeometry(0.00015, 0.00015, 0.0055, 5).translate(0, 0.00275, 0),
    flag: box(0.0034, 0.0022, 0.0002), stripe: box(0.0039, 0.0005, 0.00025),
    skin: new THREE.MeshStandardMaterial({ color: 0xe0b18f, roughness: 0.8 }), trousers: new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.8 }),
    tan: new THREE.MeshStandardMaterial({ color: 0xb07a3a, roughness: 0.85 }), saddle: new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.85 }),
    neoprene: new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.5 }), glassB: new THREE.MeshStandardMaterial({ color: 0x9ad0e6, roughness: 0.1, metalness: 0.4 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5 }), flagRed: new THREE.MeshStandardMaterial({ color: 0xd8261c, roughness: 0.6, side: THREE.DoubleSide }),
    lampOn: new THREE.MeshBasicMaterial({ color: 0xfff6d8, toneMapped: false }),
  };
  return G;
}

// returns { obj, tick(dt) } or null; obj's local +x is forward, y up; face it with setHeading
export function createMachine(THREE, kind, color) {
  const k = machineKind(kind); if (!k) return null;
  const g = shared(THREE), obj = new THREE.Group(), paint = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15 });
  obj.rotation.order = 'YXZ'; obj.name = 'unit-' + k; // yaw, then roll about the long axis, then pitch
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); obj.add(m); return m; };
  let spin = [], beacon = null, t = Math.random() * 10, bob = 0, moving = false, phase = Math.random() * 6;
  const limbs = []; // [pivot, axis, amplitude, phase offset]: swung while walking
  const figure = (jacket, x, z, helmet = true, lamp = false) => { // one person at (x, z), facing +x
    const f = new THREE.Group(); f.position.set(x, 0, z); obj.add(f);
    const part = (geo, m, px, py, pz) => { const o = new THREE.Mesh(geo, m); o.position.set(px, py, pz); f.add(o); return o; };
    part(g.torso, jacket, 0, 0.0068, 0); part(g.head, g.skin, 0, 0.0101, 0);
    if (helmet) part(g.helmet, g.white, 0, 0.0104, 0);
    if (lamp) { const l = part(g.lamp, g.lampOn, 0.0013, 0.0107, 0); l.userData.glow = ['#fff6d8', 38]; }
    for (const sz of [1, -1]) {
      limbs.push([part(g.leg, g.trousers, 0, 0.0048, sz * 0.0007), 'z', 0.55, sz > 0 ? 0 : Math.PI]);
      limbs.push([part(g.arm, jacket, 0, 0.0086, sz * 0.0019), 'z', 0.45, sz > 0 ? Math.PI : 0]);
    }
    return f;
  };
  if (k === 'team') {
    figure(paint, 0.006, 0.0006, true, true); figure(paint, 0, -0.0012); figure(paint, -0.006, 0.0009);
  } else if (k === 'person') {
    figure(paint, 0, 0, false);
  } else if (k === 'dog') {
    figure(paint, -0.002, -0.0035, true, true);
    const d = new THREE.Group(); d.position.set(0.003, 0, 0.0035); obj.add(d);
    const part = (geo, m, px, py, pz) => { const o = new THREE.Mesh(geo, m); o.position.set(px, py, pz); d.add(o); return o; };
    part(g.dBodyK, g.tan, 0, 0.0043, 0); part(g.dSaddle, g.saddle, -0.0005, 0.0058, 0); part(g.dVest, paint, 0.0012, 0.0044, 0);
    part(g.dHead, g.tan, 0.0045, 0.0062, 0); part(g.dSnout, g.saddle, 0.0064, 0.0057, 0);
    part(g.dEar, g.saddle, 0.0042, 0.0078, 0.0005); part(g.dEar, g.saddle, 0.0042, 0.0078, -0.0005);
    const tail = part(g.dTail, g.tan, -0.0036, 0.0051, 0); tail.rotation.z = -0.5; limbs.push([tail, 'y', 0.35, 0]);
    for (const [lx, lz, o] of [[0.0026, 0.0007, 0], [0.0026, -0.0007, Math.PI], [-0.0026, 0.0007, Math.PI], [-0.0026, -0.0007, 0]]) limbs.push([part(g.dLeg, g.tan, lx, 0.0031, lz), 'z', 0.6, o]);
  } else if (k === 'divers') {
    for (const [x, z] of [[0.003, 0.0022], [0.0005, -0.0024]]) { add(g.head, g.neoprene, x, 0.0006, z); add(g.mask, g.glassB, x + 0.0011, 0.0009, z); }
    add(g.buoy, g.orange, -0.004, 0.0006, 0); add(g.mast, g.dark, -0.004, 0.0012, 0);
    add(g.flag, g.flagRed, -0.0023, 0.0055, 0); const st = add(g.stripe, g.white, -0.0023, 0.0055, 0); st.rotation.z = -0.55;
    bob = 0.0004;
  } else if (k === 'heli') {
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
      if (limbs.length) { // walk while moving, ease back to standing when still
        phase += dt * (moving ? 7 : 0);
        for (const [o, axis, amp, off] of limbs) { const want = moving ? Math.sin(phase + off) * amp : 0; o.rotation[axis] += (want - o.rotation[axis]) * Math.min(1, dt * 10); }
      }
    },
    // heading from a direction in the x/z plane; a small nose-down pitch while it moves (aircraft)
    setHeading(dx, dz, mv = true) {
      moving = mv;
      if (Math.hypot(dx, dz) < 1e-9) return;
      obj.rotation.y = Math.atan2(-dz, dx);
      if (SURFACE[k] === 'air') obj.rotation.z = mv ? -0.12 : 0;
    },
    surface: SURFACE[k] || 'ground',
    // the bob offset is part of position.y: callers set the position, then tick adds the bob again
    place(p) { obj.position.copy(p); obj.position.y += base.y; },
  };
}

// operator livery for a helicopter or boat from the unit's name (null: keep the legend colour of its kind)
export function operatorPaint(name = '') {
  if (/Policj/i.test(name)) return '#1d3b6e';
  if (/SAR|Marynark/i.test(name)) return '#e8641b';
  if (/LPR|TOPR|GOPR/.test(name)) return '#c8102e';
  if (/WOPR/.test(name)) return '#e2231a';
  if (/PSP|OSP|JRG/.test(name)) return '#c4161c';
  return null;
}

// Ground units' vehicles, parked at the unit's base (app3d places them on the nearest public road): police car,
// city guard car, fire engine (PSP / OSP), mountain rescue off-roader (GOPR / TOPR). Units with another name (or none
// of these services) get no vehicle. Blue lights flash while the unit is deployed (setActive).
export function vehicleKind(name = '') {
  if (/Straż Miejska/i.test(name)) return 'guard';
  if (/Policj/i.test(name)) return 'police';
  if (/PSP|OSP|JRG|Straż Pożarna/i.test(name)) return 'fire';
  if (/GOPR|TOPR/.test(name)) return 'mountain';
  return null;
}

let V = null;
function sharedV(THREE) {
  if (V) return V;
  const box = (x, y, z, ty = 0, tx = 0) => new THREE.BoxGeometry(x, y, z).translate(tx, ty, 0);
  const mat = (c, r = 0.45) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0.2 });
  V = {
    // real size in km (a car 4.6 m, a fire engine 8 m); the caller scales the group like the other markers
    carBody: box(0.0046, 0.0008, 0.0018, 0.0006), carCab: box(0.0026, 0.0006, 0.0016, 0.0013, -0.0003),
    suvBody: box(0.0047, 0.001, 0.0019, 0.0007), suvCab: box(0.0029, 0.00075, 0.0017, 0.00155, -0.0004),
    truckCab: box(0.0022, 0.0017, 0.0024, 0.0013, 0.0029), truckBody: box(0.0056, 0.0021, 0.0024, 0.00145, -0.0011),
    wheel: new THREE.CylinderGeometry(0.00034, 0.00034, 0.0019, 10).rotateX(Math.PI / 2),
    bar: box(0.0005, 0.00016, 0.00045),
    tyre: mat(0x1d1f22, 0.8), white: mat(0xf2f2ef), glass: mat(0x2a3440, 0.2),
    police: mat(0x2b4fa3), guard: mat(0xe6e9e4), fire: mat(0xc4161c), mountain: mat(0xb3121b),
    blueOn: new THREE.MeshBasicMaterial({ color: 0x3d7bff, toneMapped: false }), blueOff: mat(0x1e2b4a, 0.3),
  };
  return V;
}

export function createVehicle(THREE, kind) {
  const g = sharedV(THREE), obj = new THREE.Group(), add = (geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); obj.add(o); return o; };
  obj.rotation.order = 'YXZ';
  let barY, barX = 0, len;
  if (kind === 'fire') {
    add(g.truckCab, g.fire); add(g.truckBody, g.fire); barY = 0.00225; barX = 0.0029; len = 0.0039;
  } else if (kind === 'mountain') {
    add(g.suvBody, g.mountain); add(g.suvCab, g.white); barY = 0.002; barX = -0.0004; len = 0.0021;
  } else {
    add(g.carBody, g[kind] || g.police); add(g.carCab, kind === 'guard' ? g.glass : g.white); barY = 0.00168; barX = -0.0003; len = 0.0021;
  }
  for (const x of [len * 0.6, -len * 0.6]) for (const z of [0.0008, -0.0008]) add(g.wheel, g.tyre, x + (kind === 'fire' ? 0.0006 : 0), 0.00034, z);
  const lamps = [add(g.bar, g.blueOff, barX, barY, 0.0003), add(g.bar, g.blueOff, barX, barY, -0.0003)];
  lamps.forEach((l) => { l.userData.glow = null; });
  let t = Math.random(), on = false;
  return {
    obj,
    setActive(v) { on = v; if (!v) lamps.forEach((l) => { l.material = g.blueOff; l.userData.glow = null; }); },
    tick(dt) {
      if (!on) return;
      t += dt; const ph = Math.floor(t * 6) % 2; // alternating blue flashes, 3 per second each
      lamps.forEach((l, i) => { const lit = (i === ph); l.material = lit ? g.blueOn : g.blueOff; l.userData.glow = lit ? ['#3d7bff', 55] : null; });
    },
    setHeading(dx, dz) { if (Math.hypot(dx, dz) > 1e-9) obj.rotation.y = Math.atan2(-dz, dx); },
  };
}
