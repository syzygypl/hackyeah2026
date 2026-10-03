// fx3d - vertex and pixel (fragment) shader effects for three.js materials.
// An effect is a named unit of GLSL: code for named hook points in the vertex and pixel stage of a built-in material
// (MeshStandardMaterial keeps lights, shadows, fog and tone mapping), its uniforms (declared automatically from their
// JS values) and optional rewrites of whole three.js chunks. applyFx() puts several effects on one material and builds
// one shader program per effect combination. ?fx=-name,-name switches effects off (A/B of pixel cost, debugging).
//
//   applyFx(material, [FX.treeWind(U), myEffect])
//   const myEffect = { name: 'tint', uniforms: { uTint: { value: new THREE.Color('#f00') } },
//     hooks: { color: 'diffuseColor.rgb *= uTint;' } };
//
// Every effect sees fxWorld (world position, instancing included) and fxObjNormal (object-space normal) in both stages,
// plus the noise helpers in FX_LIB.
import * as THREE from 'three';

// hook -> [stage, three.js chunk the code is inserted after]
const HOOKS = {
  vertex: ['v', 'begin_vertex'], // object space: edit `transformed` (before projection, shadows ignore it)
  view: ['v', 'project_vertex'], // `mvPosition` (view space) and `gl_Position` are set
  color: ['f', 'map_fragment'], // albedo: edit `diffuseColor`; declare values later hooks use here
  albedo: ['f', 'color_fragment'], // albedo after vertex / instance colours (snow cover must come after the foliage tint)
  normal: ['f', 'normal_fragment_maps'], // shading normal `normal` (view space)
  emissive: ['f', 'emissivemap_fragment'], // add light to `totalEmissiveRadiance`
  output: ['f', 'opaque_fragment'], // final `gl_FragColor`, before tone mapping and fog
};

export const FX_OFF = new Set((new URLSearchParams(location.search).get('fx') || '').split(',').filter((s) => s.startsWith('-')).map((s) => s.slice(1)));

export const FX_LIB = `
float fxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fxNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fxHash(i), fxHash(i + vec2(1, 0)), f.x), mix(fxHash(i + vec2(0, 1)), fxHash(i + vec2(1, 1)), f.x), f.y); }
// 4 octaves, the fine ones fade out with lod (0 near .. 1 far) so distant pixels do not shimmer
float fxFbm(vec2 p, float lod) { float a = 0.0, w = 0.5; for (int k = 0; k < 4; k++) { a += w * fxNoise(p) * (1.0 - smoothstep(0.6, 1.0, lod * float(k + 1) * 0.35)); p *= 2.03; w *= 0.5; } return a; }
`;

const glslType = (v) => (typeof v === 'number' ? 'float' : typeof v === 'boolean' ? 'bool' : v?.isColor || v?.isVector3 ? 'vec3' : v?.isVector2 ? 'vec2'
  : v?.isVector4 ? 'vec4' : v?.isMatrix4 ? 'mat4' : v?.isMatrix3 ? 'mat3' : v?.isTexture ? 'sampler2D' : null);
export function declareUniforms(uniforms) {
  return Object.entries(uniforms).map(([n, u]) => {
    const t = glslType(u.value); if (!t) throw new Error(`fx3d: uniform ${n} has no GLSL type`);
    return `uniform ${t} ${n};`;
  }).join('\n');
}

// effects every applyFx material gets (installHeightFog registers the atmosphere: valley fog, alpenglow, sun haze)
export const FX_GLOBAL = [];

export function applyFx(material, effects) {
  const on = [...effects, ...FX_GLOBAL].filter((e) => e && !FX_OFF.has(e.name));
  const list = on.filter((e) => (e.requires || []).every((r) => on.some((x) => x.name === r)));
  const uniforms = Object.assign({}, ...list.map((e) => e.uniforms || {}));
  const head = `${declareUniforms(uniforms)}\nvarying vec3 fxWorld; varying vec3 fxObjNormal;\n${FX_LIB}\n${list.map((e) => e.glsl || '').join('\n')}`;
  const chunks = {}; // chunk -> rewritten source (several effects may rewrite the same chunk, in order)
  for (const e of list) for (const [c, fn] of Object.entries(e.chunks || {})) chunks[c] = fn(chunks[c] ?? THREE.ShaderChunk[c]);
  const at = (stage, chunk) => list.map((e) => Object.entries(e.hooks || {}).filter(([h]) => HOOKS[h][0] === stage && HOOKS[h][1] === chunk).map(([, code]) => `// fx ${e.name}\n${code}`).join('\n')).join('\n');
  const inject = (src, stage) => {
    src = src.replace('#include <common>', `#include <common>\n${head}`);
    for (const [c, body] of Object.entries(chunks)) src = src.replace(`#include <${c}>`, body);
    for (const [h, [st, c]] of Object.entries(HOOKS)) if (st === stage) {
      let code = at(stage, c);
      if (h === 'vertex') code += `
  { vec4 fxW = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    fxW = instanceMatrix * fxW;
  #endif
    fxWorld = (modelMatrix * fxW).xyz; fxObjNormal = objectNormal; }`;
      if (code.trim()) src = src.replace(`#include <${c}>`, `#include <${c}>\n${code}`);
    }
    return src;
  };
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = inject(sh.vertexShader, 'v');
    sh.fragmentShader = inject(sh.fragmentShader, 'f');
  };
  material.customProgramCacheKey = () => 'fx:' + list.map((e) => e.name).join('+');
  material.userData.fx = list.map((e) => e.name);
  material.needsUpdate = true;
  return material;
}

// a full custom shader (no three.js lighting): uniforms declared automatically, FX_LIB available in both stages
export function fxShader({ uniforms = {}, vertex, fragment, ...opts }) {
  const head = `${declareUniforms(uniforms)}\n${FX_LIB}\n`;
  return new THREE.ShaderMaterial({ uniforms, vertexShader: head + vertex, fragmentShader: head + fragment, ...opts });
}

// ---------- global: aerial perspective, alpenglow ----------
// three's fog chunks, replaced once before any material compiles. Every fogged material gets aerial perspective: clear-air
// haze with an exponential height profile integrated along the view ray (thin up high, thick in the valleys), blue
// scattered out first, denser in bad weather (read from fogNear: 9 clear, 6 fog, 5 thick); then the weather fog
// (near / far). applyFx materials (terrain, trees, buildings, water) also get the atmosphere effect returned here: a warm
// Mie lobe in the haze towards the sun and alpenglow on the high peaks. World position comes from the view matrix's
// rotation rows (the camera is rigid), not a per-vertex inverse(viewMatrix).
export function installHeightFog() {
  const U = { uAtmoSun: { value: new THREE.Vector3(0, 1, 0) }, uAtmoSunCol: { value: new THREE.Color(0, 0, 0) },
    uAlpen: { value: new THREE.Color(0, 0, 0) }, uAlpenY: { value: new THREE.Vector2(1, 2) } };
  FX_GLOBAL.push({ name: 'atmo', uniforms: U, glsl: '#define FX_ATMO 1' });
  THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying float vFogDepth; varying float vFogY; varying vec3 vFogW;\n#endif';
  THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
 vFogDepth = - mvPosition.z;
 vFogW = vec3( dot( viewMatrix[0].xyz, mvPosition.xyz ), dot( viewMatrix[1].xyz, mvPosition.xyz ), dot( viewMatrix[2].xyz, mvPosition.xyz ) ); // R^T . view = world offset from the camera
 vFogY = dot(viewMatrix[1].xyz, mvPosition.xyz - viewMatrix[3].xyz); // world y = column 1 of R . (view - t)
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = '#ifdef USE_FOG\n uniform vec3 fogColor; varying float vFogDepth; varying float vFogY; varying vec3 vFogW;\n #ifdef FOG_EXP2\n uniform float fogDensity;\n #else\n uniform float fogNear; uniform float fogFar;\n #endif\n#endif';
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  {
  float fogDist = length( vFogW ), fogCamY = vFogY - vFogW.y;
  vec3 fogV = vFogW / max( fogDist, 1e-5 );
  #ifdef FX_ATMO
    vec3 fogSunD = uAtmoSun, fogSunC = uAtmoSunCol;
    // alpenglow: the last light of the day on the high peaks (pink, more on bright rock and snow)
    gl_FragColor.rgb += uAlpen * smoothstep( uAlpenY.x, uAlpenY.y, vFogY ) * ( 0.3 + dot( gl_FragColor.rgb, vec3( 0.3, 0.5, 0.2 ) ) );
  #else
    vec3 fogSunD = vec3( 0.0, 1.0, 0.0 ), fogSunC = vec3( 0.0 );
  #endif
  #ifdef FOG_EXP2
    float hzK = 1.0;
  #else
    float hzK = clamp( ( 14.0 - fogNear ) / 5.0, 1.0, 1.9 );
  #endif
  // aerial perspective: density a * exp(-b y), integrated from the camera to the pixel
  float hzB = 0.45, hzF = abs( vFogW.y ) > 1e-3 ? ( exp( - hzB * fogCamY ) - exp( - hzB * vFogY ) ) / ( hzB * vFogW.y ) : exp( - hzB * vFogY );
  vec3 hzT = exp( - 0.065 * hzK * fogDist * hzF * vec3( 0.45, 0.68, 1.0 ) );
  vec3 hzSun = fogSunC * ( 0.009 / pow( 1.49 - 1.4 * dot( fogV, fogSunD ), 1.5 ) ); // Henyey-Greenstein g = 0.7
  gl_FragColor.rgb = gl_FragColor.rgb * hzT + ( fogColor * vec3( 0.86, 0.94, 1.06 ) + hzSun ) * ( 1.0 - hzT );
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor + hzSun * 0.6, fogFactor );
  }
#endif`;
  return U;
}

// ---------- shared water shading (lakes and sea) ----------
// waves: three directions, wavenumbers scaled by uWaveK (1 = Tatra lakes, < 1 = longer swell), height grows with wind
const WAVE_GLSL = `
    float fxWaveAmp() { return (0.0012 + uWind * 0.02) / sqrt(uWaveK); }
    // height and its x/z slope, world units (km)
    vec3 fxWave(vec2 p, float t, float a) {
      vec3 r = vec3(0.0);
      vec2 D[3]; D[0] = vec2(0.8, 0.6); D[1] = vec2(-0.42, 0.91); D[2] = vec2(0.96, -0.28);
      float K[3]; K[0] = 48.0; K[1] = 74.0; K[2] = 118.0;
      float W[3]; W[0] = 1.15; W[1] = 1.7; W[2] = 2.4;
      float A[3]; A[0] = 1.0; A[1] = 0.55; A[2] = 0.3;
      // slow noise groups the waves into sets, so the three trains never show as a regular grid
      a *= 0.35 + 1.1 * fxNoise(p * 9.0 * uWaveK + vec2(t * 0.03, -t * 0.02));
      for (int i = 0; i < 3; i++) {
        float k = K[i] * uWaveK, ph = k * dot(D[i], p) + W[i] * sqrt(uWaveK) * t + fxNoise(p * 20.0 * uWaveK) * 2.5 * float(i), ai = a * A[i];
        r.x += ai * sin(ph); r.yz += ai * k * cos(ph) * D[i];
      }
      return r;
    }`;
// expects waveEdge (0 calm .. 1 full waves), waterDeep (0 shallow .. 1 deep), waterShore (foam band) and wv = fxWave(...)
const WATER_COLOR = `{
      vec3 deep = vec3(0.01, 0.07, 0.12), shallow = vec3(0.06, 0.32, 0.34);
      diffuseColor.rgb = mix(shallow, deep, waterDeep);
      float near = 1.0 - smoothstep(1.5, 6.0, length(fxWorld - cameraPosition)); // crest foam only where it reads as foam
      float streak = smoothstep(0.62, 0.9, fxNoise(fxWorld.xz * vec2(900.0, 300.0) + uTime * 1.5) * fxNoise(fxWorld.xz * 140.0 - uTime * 0.4) * 1.6);
      float crest = smoothstep(0.7, 1.0, wv.x / fxWaveAmp()) * streak * smoothstep(0.03, 0.09, uWind) * near;
      float shore = waterShore * (0.35 + 0.65 * fxNoise(fxWorld.xz * 380.0 - uTime * 0.8));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.94, 0.95), clamp(shore * 0.8 + crest * 0.55, 0.0, 1.0));
    }`;
const WATER_NORMAL = `
    vec3 waterN;
    { vec2 p = fxWorld.xz * 260.0; float t = uTime, a = (0.25 + uWind * 6.0) * 0.07;
      vec2 q = p + vec2(sin(p.y * 0.37 + t * 0.4), cos(p.x * 0.41 - t * 0.3)) * 2.2; // domain-warped ripples: no regular grid
      vec2 rip = vec2(sin(q.x + t * 1.3) * 0.5 + sin((q.x * 0.6 + q.y) * 1.3 - t * 1.1) * 0.35, sin(q.y * 0.9 + t * 0.9) * 0.5 + sin((q.x - q.y * 0.7) * 1.1 + t * 1.6) * 0.3) * a;
      waterN = normalize(vec3(-wv.y + rip.x, 1.0, -wv.z + rip.y));
      normal = normalize((viewMatrix * vec4(waterN, 0.0)).xyz); }`;
const WATER_GLITTER = `
    { vec3 V = normalize(cameraPosition - fxWorld), Rf = reflect(-V, waterN);
      float sd = max(dot(Rf, normalize(uSunDir)), 0.0);
      float tw = step(0.8, fxHash(floor(fxWorld.xz * 1400.0) + floor(uTime * 7.0)));
      totalEmissiveRadiance += vec3(1.0, 0.88, 0.7) * (pow(sd, 1200.0) * 1.6 + pow(sd, 90.0) * 0.12 + pow(sd, 400.0) * tw * 1.4) * uDay * waveEdge; }`;

// ---------- effects ----------
// U: shared uniforms owned by the page (time, wind, heat textures...), so one value drives every material using it
export const FX = {
  // sky dome (full custom shader on the inside of a sphere), cheap analytic scattering instead of lookup tables:
  // zenith -> horizon gradient (top / bottom from the time-of-day palette), Rayleigh (1 + mu^2) brightness, a warm
  // horizon glow under the sun while it is low, the pink belt of Venus over the blue earth shadow opposite it at dusk,
  // sun disk with a Mie halo (Henyey-Greenstein), the moon, and the horizon melting into the aerial-perspective haze
  // (uHaze = the terrain fog colour), so far ridges and sky meet in one colour.
  // Clouds: a high streaky layer that keeps the light longest at dusk and a main layer drifting with the wind
  // (uCloudOff), cover from the step's weather (uCloud 0..1); lit by a second density tap towards the sun (bright tops,
  // self-shadowed bases), silver lining near the sun, orange undersides at sunset; uFlash = lightning in the clouds.
  sky: (sunDir) => fxShader({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() }, uHaze: { value: new THREE.Color('#c9d8e6') }, sunDir: { value: sunDir },
      sunCol: { value: new THREE.Color('#ffd9a0') }, sunAmt: { value: 1 }, uCloud: { value: 0.35 }, uCloudOff: { value: new THREE.Vector2() },
      uCloudLit: { value: new THREE.Color(0.9, 0.9, 0.92) }, uCloudDark: { value: new THREE.Color(0.5, 0.55, 0.62) },
      uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uMoon: { value: 0 }, uFlash: { value: 0 } },
    vertex: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragment: `varying vec3 vP;
    float cloudN(vec2 uv, float lod) { return fxFbm(uv * 1.4, lod) + 0.22 * fxNoise(uv * 7.0); }
    void main(){
      vec3 v = normalize(vP);
      float y = v.y, yy = max(y, 0.0), mu = dot(v, sunDir), sy = sunDir.y;
      vec3 c = mix(bottom, top, pow(clamp(y * 1.5 + 0.1, 0.0, 1.0), 0.75));
      c *= 0.93 + 0.09 * mu * mu; // Rayleigh phase
      vec2 sh = normalize(sunDir.xz + 1e-5);
      float az = dot(normalize(v.xz + 1e-5), sh) * 0.5 + 0.5; // 1 under the sun, 0 opposite
      float tw = smoothstep(0.42, 0.02, sy) * smoothstep(-0.24, -0.03, sy); // sun near the horizon
      float band = exp(-yy * mix(9.0, 3.5, pow(az, 6.0)));
      c += sunCol * band * tw * (0.08 + 0.92 * pow(az, 5.0)) * sunAmt;
      float dusk = smoothstep(0.1, -0.01, sy) * smoothstep(-0.22, -0.05, sy) * pow(1.0 - az, 2.0);
      c = mix(c, vec3(0.9, 0.58, 0.64) * (0.35 + 0.8 * dot(bottom, vec3(0.33))), dusk * smoothstep(0.02, 0.09, y) * (1.0 - smoothstep(0.12, 0.32, y)) * 0.55 * sunAmt);
      c = mix(c, c * vec3(0.7, 0.77, 0.95), dusk * (1.0 - smoothstep(0.0, 0.07, y)) * sunAmt);
      float up = smoothstep(-0.1, 0.02, sy);
      float halo = (0.4224 / pow(1.5776 - 1.52 * mu, 1.5) * 0.016 + pow(max(mu, 0.0), 6.0) * 0.12) * sunAmt * up;
      c = mix(c, sunCol * 1.15, clamp(halo, 0.0, 0.85)); // blended, not added: no green where yellow meets blue
      c += (sunCol * 1.6 + 0.5) * smoothstep(0.99976, 0.99986, mu) * smoothstep(-0.01, 0.01, y) * sunAmt * up;
      float md = dot(v, uMoonDir);
      c += vec3(0.82, 0.88, 1.0) * (smoothstep(0.99975, 0.99988, md) * 1.5 + pow(max(md, 0.0), 400.0) * 0.2 + pow(max(md, 0.0), 24.0) * 0.05) * uMoon;
      c = mix(c, uHaze, 0.45 * exp(-yy * 14.0));
      c = mix(c, uHaze, smoothstep(0.0, -0.1, y));
      if (y > -0.02 && uCloud > 0.01) {
        float yc = max(y, 0.0), lod = 1.0 - smoothstep(0.03, 0.3, yc);
        vec2 uv = v.xz / (yc + 0.12) * 1.3 + uCloudOff;
        vec2 cu = uv * 0.45 + uCloudOff * 0.3;
        float ci = fxNoise(vec2(cu.x * 0.7 + cu.y * 0.5, (cu.y - cu.x * 0.3) * 4.0)) * fxNoise(cu * 1.7 + 3.1);
        float cir = smoothstep(0.3, 0.68, ci) * smoothstep(0.03, 0.22, yc) * (0.35 + 0.5 * uCloud) * (1.0 - smoothstep(0.6, 0.9, uCloud));
        c = mix(c, uCloudLit + sunCol * tw * 0.45 * sunAmt, cir * 0.4);
        float n = cloudN(uv, lod);
        float cov = smoothstep(0.78 - uCloud * 0.42, 0.98 - uCloud * 0.3, n) * smoothstep(-0.02, 0.12, y);
        if (cov > 0.002) {
          float lit = clamp(0.62 + (n - cloudN(uv + sh * 0.09, lod)) * 5.0, 0.0, 1.0);
          float thick = smoothstep(0.6, 1.25, n + uCloud * 0.25);
          vec3 cc = mix(uCloudDark, uCloudLit, lit * (1.0 - thick * 0.55));
          cc += sunCol * (pow(max(mu, 0.0), 10.0) * (1.0 - cov) * 2.2 * up + tw * band * 0.55 * (1.0 - lit * 0.5)) * sunAmt;
          cc = mix(cc, uHaze, (1.0 - smoothstep(0.0, 0.22, yc)) * 0.55);
          c = mix(c, cc, cov * 0.95);
        }
      }
      c += vec3(0.75, 0.8, 1.0) * uFlash * (0.2 + 0.8 * uCloud) * smoothstep(-0.05, 0.3, y);
      gl_FragColor = vec4(c, 1.0);
    }`,
  }),

  // close-up detail: procedural world-space noise on the albedo, fading in near the camera (meadow speckle on flat
  // ground, horizontal strata on cliffs, finer grain on scree), so the topo texture does not turn to mush when zoomed in
  terrainDetail: () => ({ name: 'detail', hooks: { color: `
    {
      float dist = length(fxWorld - cameraPosition), near = 1.0 - smoothstep(1.2, 7.0, dist);
      if (near > 0.0) {
        float lod = clamp(dist / 3.0, 0.0, 1.0), slope = 1.0 - clamp(fxObjNormal.y, 0.0, 1.0);
        float fl = fxFbm(fxWorld.xz * 160.0, lod);
        float side = fxFbm(vec2(fxWorld.x + fxWorld.z, fxWorld.y * 9.0) * 90.0, lod); // strata: stretched along the contour
        float strata = 0.5 + 0.5 * sin(fxWorld.y * 420.0 + side * 6.0);
        float rock = smoothstep(0.25, 0.55, slope);
        float d = mix(fl, mix(side, strata, 0.45), rock);
        vec3 tint = mix(vec3(1.06, 1.04, 0.9), vec3(0.92, 1.0, 1.02), fl); // dry / lush patches on meadows
        diffuseColor.rgb *= mix(vec3(1.0), mix(tint, vec3(1.0), rock) * (0.55 + 0.9 * d), near * 0.9);
      }
    }` } }),

  // POA heat: two canvas textures (previous / current step) crossfaded by uHeatT, contour edges at the 2x / 5x / 10x
  // stops of the shared scale, a slow pulse on the hotspot, and a glow at night (uEmis)
  poaHeat: (U) => ({ name: 'heat',
    uniforms: { uHeatFrom: U.uHeatFrom, uHeatTo: U.uHeatTo, uHeatT: U.uHeatT, uHeatOn: U.uHeatOn, uHeatRect: U.uHeatRect, uHeatEdges: U.uHeatEdges, uTime: U.uTime, uEmis: U.uEmis },
    hooks: {
      color: `
    vec3 heatEmit = vec3(0.0);
    {
      vec2 hu = (vec2(vMapUv.x, 1.0 - vMapUv.y) - uHeatRect.xy) / uHeatRect.zw;
      if (hu.x > 0.0 && hu.x < 1.0 && hu.y > 0.0 && hu.y < 1.0) {
        vec2 st = vec2(hu.x, 1.0 - hu.y);
        vec4 ha = texture2D(uHeatFrom, st); vec4 hb = texture2D(uHeatTo, st);
        float wa = ha.a * uHeatOn.x * (1.0 - uHeatT), wb = hb.a * uHeatOn.y * uHeatT, al = wa + wb;
        if (al > 0.002) {
          vec3 col = (ha.rgb * wa + hb.rgb * wb) / al;
          float fw = fwidth(al) * 1.3 + 1e-4;
          float edge = max(max(1.0 - smoothstep(0.0, fw, abs(al - uHeatEdges.x)), 1.0 - smoothstep(0.0, fw, abs(al - uHeatEdges.y))), 1.0 - smoothstep(0.0, fw, abs(al - uHeatEdges.z)));
          al = clamp(al * (1.0 + smoothstep(uHeatEdges.y, uHeatEdges.z + 0.04, al) * 0.1 * sin(uTime * 2.2)), 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, col, al);
          diffuseColor.rgb = mix(diffuseColor.rgb, min(col * 1.4 + 0.06, vec3(1.0)), edge * 0.45);
          heatEmit = col * (al + edge * 0.5);
        }
      }
    }`,
      emissive: 'totalEmissiveRadiance += heatEmit * uEmis;',
    } }),

  // the sun's shadow is the darker of the baked far cascade (ray-marched from the DEM, re-baked when the sun or moon
  // moves; two masks crossfaded by uSunMaskT) and the near shadow map (which is 1 outside its box)
  bakedSun: (U) => ({ name: 'sun', uniforms: { uSunMask: U.uSunMask, uSunMask2: U.uSunMask2, uSunMaskT: U.uSunMaskT },
    hooks: { color: 'float bakedSun = mix(texture2D(uSunMask, vMapUv).r, texture2D(uSunMask2, vMapUv).r, uSunMaskT);' },
    chunks: { lights_fragment_begin: (src) => src
      .replace('? getShadow( directionalShadowMap[ i ],', '? min( bakedSun, getShadow( directionalShadowMap[ i ],')
      .replace('vDirectionalShadowCoord[ i ] ) : 1.0;', 'vDirectionalShadowCoord[ i ] ) ) : bakedSun;') } }),

  // snow cover, the way open-world games do it (RDR2, Horizon): coverage from the up-facing normal, broken up by fbm noise,
  // thicker above the snowline, wind-scoured on steep rock, cold blue in the thin patches; uSnowCover (0..1) grows while it
  // snows (app3d accumulates it slowly). bias lifts thin geometry: tree crowns and roofs catch snow on their tops.
  snowCover: (U, bias = 0) => ({ name: 'snowcover', uniforms: { uSnowCover: U.uSnowCover, uSnowY: U.uSnowY },
    hooks: { albedo: `
    {
      if (uSnowCover > 0.001) {
        float up = clamp(fxObjNormal.y + ${bias.toFixed(2)}, 0.0, 1.0);
        float n = fxFbm(fxWorld.xz * 38.0, clamp(length(fxWorld - cameraPosition) / 6.0, 0.0, 1.0));
        float lvl = uSnowCover * mix(0.8, 1.15, smoothstep(uSnowY - 0.6, uSnowY, fxWorld.y));
        float cov = smoothstep(0.55, 0.85, up + (lvl - 0.75) * 0.9 + (n - 0.5) * 0.45) * clamp(lvl, 0.0, 1.0);
        vec3 snowCol = mix(vec3(0.78, 0.85, 0.95), vec3(0.97, 0.98, 1.0), smoothstep(0.3, 0.8, n));
        diffuseColor.rgb = mix(diffuseColor.rgb, snowCol, cov);
      }
    }` } }),

  // near snow: flakes anchored in world space in a small box that tiles around the camera (parallax when the camera
  // moves, as in games), big soft out-of-focus flakes close by, fine ones further away, swirling with the wind
  snowNear: (U) => fxShader({
    transparent: true, depthWrite: false,
    uniforms: { uTime: U.uTime, uWind: U.uWind, uDay: U.uDay, uAmt: { value: 0 }, uPx: { value: 1000 }, uBox: { value: 0.3 } },
    vertex: `attribute float aRnd; varying float vA; varying float vSoft;
    void main() {
      vec3 p = position;
      p.y = fract(p.y - uTime * (0.012 + 0.01 * aRnd) / uBox);
      p.x = fract(p.x + uTime * uWind * 0.25 / uBox + 0.05 * sin(uTime * (0.8 + aRnd) + aRnd * 50.0));
      p.z = fract(p.z + 0.04 * cos(uTime * (0.6 + aRnd) + aRnd * 20.0));
      vec3 rel = mod(p * uBox - cameraPosition, vec3(uBox)) - 0.5 * uBox;
      vec4 mv = viewMatrix * vec4(cameraPosition + rel, 1.0);
      gl_Position = projectionMatrix * mv;
      float d = max(-mv.z, 0.0005);
      float sz = 0.00016 * (0.6 + 0.8 * aRnd) * uPx / d;
      gl_PointSize = min(sz, 12.0);
      vSoft = smoothstep(5.0, 12.0, sz); // close flakes are out of focus: softer and fainter
      vA = uAmt * step(aRnd, 0.15 + 0.85 * uAmt) * smoothstep(0.006, 0.02, d) * (1.0 - smoothstep(0.1, 0.15, d));
    }`,
    fragment: `varying float vA; varying float vSoft;
    void main() {
      float r = length(gl_PointCoord - 0.5) * 2.0;
      float a = exp(-r * r * mix(5.0, 2.2, vSoft)) * (1.0 - smoothstep(0.9, 1.0, r));
      gl_FragColor = vec4(vec3(1.0) * mix(0.5, 1.0, uDay), a * vA * mix(0.95, 0.45, vSoft));
      if (gl_FragColor.a < 0.01) discard;
    }`,
  }),

  // snow glints: sparse sunlit cells on gentle snowfields near the camera, twinkling as the camera moves
  snowGlints: (U) => ({ name: 'glints', requires: ['sun'], uniforms: { uSnowY: U.uSnowY },
    hooks: { emissive: `
    {
      float dist = length(fxWorld - cameraPosition), snow = smoothstep(uSnowY, uSnowY + 0.12, fxWorld.y) * smoothstep(0.55, 0.75, fxObjNormal.y);
      if (snow > 0.0 && dist < 6.0) {
        float g = fxHash(floor(fxWorld.xz * 600.0) + floor(cameraPosition.xz * 40.0));
        totalEmissiveRadiance += vec3(1.0, 0.97, 0.9) * step(0.986, g) * snow * bakedSun * (1.0 - smoothstep(2.0, 6.0, dist)) * 2.5;
      }
    }` } }),

  // lake ripples: animated wave normals (stronger in wind), reflecting the sky environment map
  waterRipples: (U) => ({ name: 'ripples', uniforms: { uTime: U.uTime, uWind: U.uWind },
    hooks: { normal: `
    { vec2 p = fxWorld.xz * 260.0; float t = uTime, a = 0.25 + uWind * 6.0;
      vec2 q = p + vec2(sin(p.y * 0.37 + t * 0.4), cos(p.x * 0.41 - t * 0.3)) * 2.2; // domain warp: no regular grid
      vec3 nW = normalize(vec3((sin(q.x + t * 1.3) * 0.5 + sin((q.x * 0.6 + q.y) * 1.3 - t * 1.1) * 0.35) * a, 8.0, (sin(q.y * 0.9 + t * 0.9) * 0.5 + sin((q.x - q.y * 0.7) * 1.1 + t * 1.6) * 0.3) * a));
      normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz); }` } }),

  // cloud shadows: the drifting cloud layer dims the direct sun on the terrain (needs the baked sun term); same cover and
  // drift as the sky layer, cast from a deck ~1.2 km up along the light, so a low sun throws them far
  cloudShadows: (U) => ({ name: 'clouds', requires: ['sun'], uniforms: { uCloud: U.uCloud, uCloudOff: U.uCloudOff, uSunDir: U.uSunDir },
    hooks: { color: `
    {
      vec2 cp = (fxWorld.xz + uSunDir.xz / max(uSunDir.y, 0.2) * 1.2) * 0.32 + uCloudOff * 4.0;
      float n = fxNoise(cp) * 0.62 + fxNoise(cp * 2.3 + 7.1) * 0.38;
      bakedSun *= 1.0 - uCloud * 0.6 * smoothstep(0.5 - uCloud * 0.2, 0.72 - uCloud * 0.15, n);
    }` } }),

  // lakes (Tatra cut): circles on a unit polar grid scaled (r, 1, r), so length(position.xz) is 0 at the centre and 1 at
  // the shore. Three directional waves displace the surface in the vertex shader; the pixel shader takes the normal from
  // the same function (exact at every pixel) plus fine wind ripples, tints deep water dark and the shallow rim
  // turquoise, puts foam on the shore and on crests, and sparkles where the sun reflects.
  lakeWaves: (U) => ({ name: 'waves', uniforms: { uTime: U.uTime, uWind: U.uWind, uSunDir: U.uSunDir, uDay: U.uDay, uWaveK: { value: 1 } },
    glsl: `varying float vRim;\n${WAVE_GLSL}`,
    hooks: {
      vertex: `
    {
      vRim = length(position.xz);
      vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
      float e = 1.0 - smoothstep(0.8, 1.0, vRim); // lifted by the trough depth so the ground under the disc never shows
      transformed.y += (fxWave(wp.xz, uTime, fxWaveAmp()).x + fxWaveAmp() * 2.7) * e;
    }`,
      color: `
    float waveEdge = 1.0 - smoothstep(0.8, 1.0, vRim), waterDeep = 1.0 - smoothstep(0.72, 1.0, vRim), waterShore = smoothstep(0.93, 0.99, vRim);
    vec3 wv = fxWave(fxWorld.xz, uTime, fxWaveAmp()) * waveEdge;
    ${WATER_COLOR}`,
      normal: WATER_NORMAL,
      emissive: WATER_GLITTER,
    } }),

  // sea and lakes outside the Tatras: the terrain mesh itself, lifted a little, with every pixel outside the water mask
  // discarded (mask: 1 = water, blurred so its 0.5..0.9 band is the shore). Longer swell than on the small Tatra lakes,
  // so the terrain mesh (30-60 m between vertices) can carry the waves; calm at the shore. rect = (west x, south z, w, h).
  seaWaves: (U, mask, rect) => ({ name: 'sea', uniforms: { uTime: U.uTime, uWind: U.uWind, uSunDir: U.uSunDir, uDay: U.uDay, uWaveK: { value: 0.27 },
    uWaterMask: { value: mask }, uWaterRect: { value: rect } },
    glsl: `${WAVE_GLSL}
    float fxWaterAt(vec2 xz) { return texture2D(uWaterMask, vec2((xz.x - uWaterRect.x) / uWaterRect.z, (uWaterRect.y - xz.y) / uWaterRect.w)).r; }`,
    hooks: {
      vertex: `
    {
      vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
      float e = smoothstep(0.5, 0.9, fxWaterAt(wp.xz)); // the ground under the sea is flat: lift by the deepest trough so it never shows
      transformed.y += (fxWave(wp.xz, uTime, fxWaveAmp()).x + fxWaveAmp() * 2.7) * e;
    }`,
      color: `
    float waterM = fxWaterAt(fxWorld.xz);
    if (waterM < 0.5) discard;
    float waveEdge = smoothstep(0.5, 0.9, waterM), waterDeep = smoothstep(0.6, 1.0, waterM), waterShore = 1.0 - smoothstep(0.5, 0.68, waterM);
    vec3 wv = fxWave(fxWorld.xz, uTime, fxWaveAmp()) * waveEdge;
    ${WATER_COLOR}`,
      normal: WATER_NORMAL,
      emissive: WATER_GLITTER,
    } }),

  // rain / snow: GPU particles in a box around the orbit target (uCenter, size uBox), falling and drifting with the
  // wind entirely in the vertex shader; rain as slanted streaks, snow as soft flakes
  precip: (U) => fxShader({
    transparent: true, depthWrite: false,
    uniforms: { uTime: U.uTime, uWind: U.uWind, uDay: U.uDay, uCenter: { value: new THREE.Vector3() }, uBox: { value: 3 }, uKind: { value: 0 }, uAmt: { value: 0 }, uPx: { value: 1000 } },
    vertex: `attribute float aRnd; varying float vA;
    void main() {
      vec3 p = position;
      float speed = mix(1.5, 0.22, uKind) * (0.8 + 0.4 * aRnd);
      p.y = fract(p.y - uTime * speed / (uBox * 0.6) * 3.0);
      p.x = fract(p.x + uTime * uWind * mix(1.2, 2.5, uKind) / uBox + uKind * 0.015 * sin(uTime * 1.3 + aRnd * 40.0));
      p.z = fract(p.z + uKind * 0.012 * cos(uTime * 1.1 + aRnd * 31.0));
      vec3 w = uCenter + (p - 0.5) * vec3(uBox, uBox * 0.6, uBox) + vec3(0.0, uBox * 0.22, 0.0);
      vec4 mv = modelViewMatrix * vec4(w, 1.0);
      gl_Position = projectionMatrix * mv;
      // snow: small flakes (about a third of the old size), capped at 4 px on screen so a zoomed-out view never shows blobs
      gl_PointSize = min(uBox * mix(0.011, 0.0018, uKind) * (0.6 + 0.7 * aRnd) * uPx / max(-mv.z, 0.05), mix(64.0, 4.0, uKind));
      vA = uAmt * step(aRnd, uAmt) * smoothstep(0.0, 0.08, p.y) * smoothstep(1.0, 0.9, p.y) * smoothstep(0.0, 0.1, p.x) * smoothstep(1.0, 0.9, p.x);
    }`,
    fragment: `varying float vA;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float a = uKind < 0.5
        ? (1.0 - smoothstep(0.02, 0.07, abs(c.x - c.y * uWind * 5.0))) * (1.0 - smoothstep(0.25, 0.5, abs(c.y)))
        : 1.0 - smoothstep(0.15, 0.5, length(c));
      vec3 col = mix(vec3(0.72, 0.8, 0.9), vec3(1.0), uKind) * mix(0.45, 1.0, uDay);
      gl_FragColor = vec4(col, a * vA * mix(0.5, 0.95, uKind));
      if (gl_FragColor.a < 0.01) discard;
    }`,
  }),

  // wind: the crown sways with the step's reported wind, phase from the instance position
  treeWind: (U) => ({ name: 'wind', uniforms: { uTime: U.uTime, uWind: U.uWind },
    hooks: { vertex: `
    {
    #ifdef USE_INSTANCING
      vec2 ph = instanceMatrix[3].xz * 37.0;
    #else
      vec2 ph = vec2(0.0);
    #endif
      float bend = position.y * position.y * uWind;
      transformed.x += bend * (sin(uTime * 1.7 + ph.x) * 0.6 + sin(uTime * 3.1 + ph.y) * 0.25);
      transformed.z += bend * sin(uTime * 2.3 + ph.y) * 0.4;
    }` } }),
};
