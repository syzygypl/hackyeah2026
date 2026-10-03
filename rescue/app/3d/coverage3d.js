// Display-only POD crossfade. Engine sparse coverage remains the source of truth.
export function createCoverage3D({ THREE, rows, cols, rect }) {
  const from = new Uint8Array(rows * cols), to = new Uint8Array(rows * cols);
  const texture = (data) => {
    const t = new THREE.DataTexture(data, cols, rows, THREE.RedFormat);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.unpackAlignment = 1; t.needsUpdate = true;
    return t;
  };
  const a = texture(from), b = texture(to), mix = { value: 1 }, enabled = { value: 1 };
  let previous = null, lastMinute = null;
  const effect = { name: 'pod', uniforms: { uPodFrom: { value: a }, uPodTo: { value: b }, uPodT: mix,
    uPodRect: rect, uPodOn: enabled, uPodColor: { value: new THREE.Color('#4ba0a5') } }, hooks: { color: `
    if (uPodOn > 0.0) {
      vec2 pu = (vec2(vMapUv.x, 1.0 - vMapUv.y) - uPodRect.xy) / uPodRect.zw;
      if (pu.x >= 0.0 && pu.x <= 1.0 && pu.y >= 0.0 && pu.y <= 1.0) {
        // DataTexture rows start north; unlike a CanvasTexture it is not flipped on upload.
        float pod = mix(texture2D(uPodFrom, pu).r, texture2D(uPodTo, pu).r, uPodT);
        diffuseColor.rgb = mix(diffuseColor.rgb, uPodColor, 0.55 * pod);
      }
    }` } };
  function set(cov, minute) {
    const animate = lastMinute != null && minute >= lastMinute && minute - lastMinute <= 5;
    lastMinute = minute;
    if (cov === previous) { if (!animate) mix.value = 1; return; }
    for (let i = 0; i < from.length; i++) from[i] = Math.round(from[i] * (1 - mix.value) + to[i] * mix.value);
    to.fill(0);
    for (const [k, pod] of cov || []) if (Number.isInteger(k) && k >= 0 && k < to.length) to[k] = Math.round(Math.max(0, Math.min(1, pod)) * 255);
    previous = cov;
    mix.value = animate ? 0 : 1;
    if (!animate) from.set(to);
    a.needsUpdate = b.needsUpdate = true;
  }
  function tick(dt) { const moving = mix.value < 1; mix.value = Math.min(1, mix.value + dt / 0.5); return moving; }
  return { effect, set, tick, setVisible(on) { enabled.value = on ? 1 : 0; }, get blend() { return mix.value; } };
}
