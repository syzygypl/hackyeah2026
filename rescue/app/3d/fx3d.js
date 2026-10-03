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
// the same value noise from a 256 x 256 lattice of random values (uFxNoise, repeats every 256 cells): one bilinear fetch
// at the smoothstep-warped coordinate instead of four sin() hashes. For the atmosphere, sky and cloud shadows.
uniform sampler2D uFxNoise;
float fxNoiseT(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return texture2D(uFxNoise, (i + f + 0.5) * (1.0 / 256.0)).r; }
float fxFbmT(vec2 p, float lod) { float a = 0.0, w = 0.5; for (int k = 0; k < 4; k++) { a += w * fxNoiseT(p) * (1.0 - smoothstep(0.6, 1.0, lod * float(k + 1) * 0.35)); p *= 2.03; w *= 0.5; } return a; }
`;
// uFxNoise: random bytes (fixed seed), wrapped, linear, no mipmaps (the warped coordinate's derivatives jump at cell edges)
export const FX_NOISE = (() => {
  const d = new Uint8Array(256 * 256); let x = 0x2545f491;
  for (let i = 0; i < d.length; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; d[i] = (x >>> 0) & 255; }
  const t = new THREE.DataTexture(d, 256, 256, THREE.RedFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return { value: t };
})();

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
  const inject = (src, stage, fogV) => {
    src = src.replace('#include <common>', `#include <common>\n${fogV ? '#define FOG_V 1\n' : ''}${head}`);
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
    Object.assign(sh.uniforms, uniforms, { uFxNoise: FX_NOISE });
    const fogV = !sh.instancing && list.some((e) => e.name === 'atmo'); // per-vertex haze (installHeightFog), not on instanced meshes
    sh.vertexShader = inject(sh.vertexShader, 'v', fogV);
    sh.fragmentShader = inject(sh.fragmentShader, 'f', fogV);
  };
  material.customProgramCacheKey = () => 'fx:' + list.map((e) => e.name).join('+');
  material.userData.fx = list.map((e) => e.name);
  material.needsUpdate = true;
  return material;
}

// a full custom shader (no three.js lighting): uniforms declared automatically, FX_LIB available in both stages
export function fxShader({ uniforms = {}, vertex, fragment, ...opts }) {
  const head = `${declareUniforms(uniforms)}\n${FX_LIB}\n`;
  return new THREE.ShaderMaterial({ uniforms: { ...uniforms, uFxNoise: FX_NOISE }, vertexShader: head + vertex, fragmentShader: head + fragment, ...opts });
}

// ---------- global: aerial perspective, valley fog, alpenglow ----------
// three's fog chunks, replaced once before any material compiles. Every fogged material gets aerial perspective: clear-air
// haze with an exponential height profile integrated along the view ray (thin up high, thick in the valleys), blue
// scattered out first, denser in bad weather (read from fogNear: 9 clear, 6 fog, 5 thick); then the weather fog
// (near / far). applyFx materials (terrain, trees, buildings, water) also get the atmosphere effect returned here: a warm
// Mie lobe in the haze towards the sun, alpenglow on the high peaks and valley fog banks (fog fills everything below
// local valley floor + thickness, uValley = floor height field, patchy and drifting). World position comes from the
// view matrix's rotation rows (the camera is rigid), not a per-vertex inverse(viewMatrix).
export function installHeightFog() {
  const U = { uAtmoSun: { value: new THREE.Vector3(0, 1, 0) }, uAtmoSunCol: { value: new THREE.Color(0, 0, 0) },
    uValley: { value: new THREE.DataTexture(new Uint8Array(4), 1, 1) }, uValleyRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uValleyP: { value: new THREE.Vector4() }, uValleyCol: { value: new THREE.Color(1, 1, 1) }, // P: amount, thickness, time, floor scale
    uAlpen: { value: new THREE.Color(0, 0, 0) }, uAlpenY: { value: new THREE.Vector2(1, 2) } };
  U.uValley.value.needsUpdate = true;
  FX_GLOBAL.push({ name: 'atmo', uniforms: U, glsl: '#define FX_ATMO 1' });
  // aerial perspective + weather fog as c * fogMul + fogAdd (both independent of the surface colour). Needs fogDist, fogCamY,
  // fogV, fogY, fogWy (world offset y), fogDepth, fogSunD / fogSunC. Haze: density a * exp(-b y), integrated from the camera
  // to the point; Henyey-Greenstein g = 0.7 towards the sun (x^1.5 as x * sqrt(x)).
  const HAZE = `
  #ifdef FOG_EXP2
    float hzK = 1.0, fogFactor = 1.0 - exp( - fogDensity * fogDensity * fogDepth * fogDepth );
  #else
    float hzK = clamp( ( 14.0 - fogNear ) / 5.0, 1.0, 1.9 ), fogFactor = smoothstep( fogNear, fogFar, fogDepth );
  #endif
    float hzB = 0.45, hzF = abs( fogWy ) > 1e-3 ? ( exp( - hzB * fogCamY ) - exp( - hzB * fogY ) ) / ( hzB * fogWy ) : exp( - hzB * fogY );
    vec3 hzT = exp( - 0.065 * hzK * fogDist * hzF * vec3( 0.45, 0.68, 1.0 ) );
    float hzG = 1.49 - 1.4 * dot( fogV, fogSunD );
    vec3 hzSun = fogSunC * ( 0.009 / ( hzG * sqrt( hzG ) ) );
    vec3 fogMul = hzT * ( 1.0 - fogFactor ), fogAdd = ( fogColor * vec3( 0.86, 0.94, 1.06 ) + hzSun ) * ( 1.0 - hzT ) * ( 1.0 - fogFactor ) + ( fogColor + hzSun * 0.6 ) * fogFactor;`;
  // per vertex (FOG_V) on applyFx meshes that are not instanced (terrain, sea, lakes, buildings): the haze varies over
  // kilometres, their triangles span tens of metres, so the pixel shader only applies the two interpolated terms. Instanced
  // trees and grass keep it per pixel: millions of vertices but few pixels each, and no extra varyings to store per vertex.
  const FOG_PARS = `#ifdef USE_FOG
 varying float vFogDepth; varying float vFogY; varying vec3 vFogW;
 #ifdef FOG_V
  varying vec3 vFogMul; varying vec3 vFogAdd;
 #endif
#endif`;
  const FOG_UNI = `#ifdef USE_FOG
 uniform vec3 fogColor;
 #ifdef FOG_EXP2
  uniform float fogDensity;
 #else
  uniform float fogNear; uniform float fogFar;
 #endif
#endif`;
  THREE.ShaderChunk.fog_pars_vertex = `${FOG_PARS}\n#ifdef FOG_V\n${FOG_UNI}\n#endif`;
  THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
 {
 vec3 fogW = vec3( dot( viewMatrix[0].xyz, mvPosition.xyz ), dot( viewMatrix[1].xyz, mvPosition.xyz ), dot( viewMatrix[2].xyz, mvPosition.xyz ) ); // R^T . view = world offset from the camera
 float fogY = dot( viewMatrix[1].xyz, mvPosition.xyz - viewMatrix[3].xyz ), fogDepth = - mvPosition.z; // world y = column 1 of R . (view - t)
 vFogDepth = fogDepth; vFogW = fogW; vFogY = fogY;
 #ifdef FOG_V
  float fogDist = length( fogW ), fogCamY = fogY - fogW.y, fogWy = fogW.y;
  vec3 fogV = fogW / max( fogDist, 1e-5 ), fogSunD = uAtmoSun, fogSunC = uAtmoSunCol;
  ${HAZE}
  vFogMul = fogMul; vFogAdd = fogAdd;
 #endif
 }
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `${FOG_PARS}\n${FOG_UNI}`;
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  {
  float fogDist = length( vFogW ), fogY = vFogY, fogWy = vFogW.y, fogCamY = fogY - fogWy, fogDepth = vFogDepth;
  vec3 fogV = vFogW / max( fogDist, 1e-5 );
  #ifdef FX_ATMO
    vec2 fogXZ = cameraPosition.xz + vFogW.xz;
    // alpenglow: the last light of the day on the high peaks (pink, more on bright rock and snow)
    gl_FragColor.rgb += uAlpen * smoothstep( uAlpenY.x, uAlpenY.y, fogY ) * ( 0.3 + dot( gl_FragColor.rgb, vec3( 0.3, 0.5, 0.2 ) ) );
    // valley fog: the fog top is the local floor plus a patchy, slowly drifting thickness; a pixel under it is seen
    // through the fog between it and the point where the view ray leaves the layer (noise from the uFxNoise texture)
    if ( uValleyP.x > 0.001 ) {
      float vfFloor = texture2D( uValley, ( fogXZ - uValleyRect.xy ) / uValleyRect.zw ).r * uValleyP.w;
      if ( fogY < vfFloor + uValleyP.y * 1.7 ) {
        vec2 vfq = fogXZ * 1.7 + vec2( uValleyP.z * 0.012, - uValleyP.z * 0.008 );
        vfq.x += 0.6 * fxNoiseT( vfq * 0.45 - uValleyP.z * 0.02 );
        float vfN = 0.5 * fxNoiseT( vfq ) + 0.25 * fxNoiseT( vfq * 2.03 ) + 0.125 * fxNoiseT( vfq * 4.1209 ) + 0.0625 * fxNoiseT( vfq * 8.3654 ); // fbm, 4 octaves
        float vfIn = vfFloor + uValleyP.y * ( 0.3 + 1.4 * vfN ) - fogY;
        if ( vfIn > 0.0 ) {
          float vfLen = min( fogDist, vfIn / max( - fogV.y, 0.025 ) );
          gl_FragColor.rgb = mix( gl_FragColor.rgb, uValleyCol, ( 1.0 - exp( - uValleyP.x * 10.0 * vfLen ) ) * smoothstep( 0.0, uValleyP.y * 0.6, vfIn ) );
        }
      }
    }
    vec3 fogSunD = uAtmoSun, fogSunC = uAtmoSunCol;
  #else
    vec3 fogSunD = vec3( 0.0, 1.0, 0.0 ), fogSunC = vec3( 0.0 );
  #endif
  #ifdef FOG_V
    gl_FragColor.rgb = gl_FragColor.rgb * vFogMul + vFogAdd;
  #else
    ${HAZE}
    gl_FragColor.rgb = gl_FragColor.rgb * fogMul + fogAdd;
  #endif
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
const WATER_COLOR = `float waterFoam; {
      vec3 deep = vec3(0.01, 0.07, 0.12), shallow = vec3(0.06, 0.32, 0.34);
      diffuseColor.rgb = mix(shallow, deep, waterDeep);
      float near = 1.0 - smoothstep(1.5, 6.0, length(fxWorld - cameraPosition)); // crest foam only where it reads as foam
      float streak = smoothstep(0.62, 0.9, fxNoise(fxWorld.xz * vec2(900.0, 300.0) + uTime * 1.5) * fxNoise(fxWorld.xz * 140.0 - uTime * 0.4) * 1.6);
      float crest = smoothstep(0.7, 1.0, wv.x / fxWaveAmp()) * streak * smoothstep(0.03, 0.09, uWind) * near;
      float shore = waterShore * (0.35 + 0.65 * fxNoise(fxWorld.xz * 380.0 - uTime * 0.8));
      waterFoam = clamp(shore * 0.8 + crest * 0.55, 0.0, 1.0);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.94, 0.95), waterFoam);
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
    float cloudN(vec2 uv, float lod) { return fxFbmT(uv * 1.4, lod) + 0.22 * fxNoiseT(uv * 7.0); }
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
      float hg = 1.5776 - 1.52 * mu, halo = (0.4224 / (hg * sqrt(hg)) * 0.016 + pow(max(mu, 0.0), 6.0) * 0.12) * sunAmt * up;
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
        float ci = fxNoiseT(vec2(cu.x * 0.7 + cu.y * 0.5, (cu.y - cu.x * 0.3) * 4.0)) * fxNoiseT(cu * 1.7 + 3.1);
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

  // close-up ground materials, fading in near the camera so distant terrain keeps the topo / photo texture: granite on
  // steep ground (triplanar in world space, so cliffs never stretch: layered fbm blocks, ridged crags, polygonal joints,
  // strata ledges, lichen and wet streaks), scree / gravel on the band below, dry October meadow grass on gentle slopes. Steepness from
  // the full-resolution normal map, nudged by the texture's saturation (grey topo rock / green meadow, or the photo).
  // The material is a luminance-preserving tint of the texture (hillshade, contours, roads, the searched wash survive),
  // muted on bright paint (roads, buildings, snow). Every noise is filtered by the pixel footprint (tdPx, km per pixel):
  // a pattern fades to its mean before its period drops under ~3 px, so nothing shimmers. The relief is bump mapping
  // from analytic noise gradients (value noise with its derivative, chain rule through the octaves), mapped back to world
  // space per triplanar plane: smooth per pixel, no screen-space derivative blocks, no seams between materials. tdB (world
  // normal offset) feeds the normal hook, so the low sun shows the relief. Runs before poaHeat: the heat layer is on top.
  terrainDetail: () => ({ name: 'detail',
    glsl: `
    // hash without sin(): stable for the large lattice coordinates of metre-scale noise over a 20 km cut
    float tdHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float tdNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(tdHash(i), tdHash(i + vec2(1, 0)), f.x), mix(tdHash(i + vec2(0, 1)), tdHash(i + vec2(1, 1)), f.x), f.y); }
    // value noise with its gradient: x = value, yz = d/dp
    vec3 tdNoiseD(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
      float a = tdHash(i), b = tdHash(i + vec2(1, 0)), c = tdHash(i + vec2(0, 1)), d = tdHash(i + vec2(1, 1)), k = a - b - c + d;
      return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y, du * (vec2(b - a, c - a) + k * u.yx)); }
    // low-pass by footprint: q = cycles per pixel (pixel size x frequency); 1 at a 10 px period, 0 under 3 px
    float tdLp(float q) { return 1.0 - smoothstep(0.1, 0.3, q); }
    float tdNoiseF(vec2 p, float q) { return q < 0.3 ? mix(0.5, tdNoise(p), tdLp(q)) : 0.5; }
    const mat2 TD_M = mat2(1.6, 1.2, -1.2, 1.6); // octave step: rotate and double
    // 4 filtered octaves at frequency F (per km) with the gradient: x = value 0..1, yz = d/dp (per km)
    vec3 tdFbmD(vec2 p, float F, float px) { vec3 a = vec3(0.0); float w = 0.5, q = px * F; vec2 s = p * F; mat2 J = mat2(F);
      for (int k = 0; k < 4; k++) { float lp = tdLp(q); a.x += w * 0.5;
        if (lp > 0.0) { vec3 n = tdNoiseD(s); a.x += w * lp * (n.x - 0.5); a.yz += w * lp * (n.yz * J); }
        s = TD_M * s + 7.3; J = TD_M * J; q *= 2.0; w *= 0.5; }
      return a / 0.9375; }
    float tdFbm(vec2 p, float q) { float a = 0.0, w = 0.5;
      for (int k = 0; k < 4; k++) { a += w * tdNoiseF(p, q); p = TD_M * p + 7.3; q *= 2.0; w *= 0.5; }
      return a / 0.9375; }
    // two rotated octaves: patches without the value-noise grid showing
    float tdN2(vec2 p, float q) { return 0.65 * tdNoiseF(p, q) + 0.35 * tdNoiseF(TD_M * p + 3.1, q * 2.0); }
    // cellular noise: x = F2 - F1 of jittered cell points (0 on the borders: granite joints, polygonal blocks), y = cell id
    vec2 tdCell(vec2 p) {
      vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0, id = 0.0;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y)); float hx = tdHash(i + g); vec2 o = g + vec2(hx, tdHash(i + g + 19.7)) * 0.8 + 0.1 - f;
        float d = dot(o, o); if (d < d1) { d2 = d1; d1 = d; id = hx; } else if (d < d2) d2 = d;
      }
      return vec2(sqrt(d2) - sqrt(d1), id);
    }
    // granite on one projection plane (p in km, px = km per pixel): x = albedo 0..1, yz = height gradient (m per km).
    // full = false: the gradient only (scree takes the rock's relief, not its colour). cf (0..1, from the distance fade)
    // scales the joints and cracks; at 0 the 9-tap cellular noise, the costliest part, is skipped. Footprint gates first:
    // nothing that tdLp has already faded to its mean is evaluated.
    vec3 tdRock(vec2 p, float px, bool full, float cf) {
      vec3 fd = tdFbmD(p, 42.0, px); float f = fd.x; // 24 m blocks down to 3 m
      // ridged octaves: sharp crests and gullies, the craggy relief the bump shows
      float rg = 0.0, w = 0.5, qq = px * 90.0; vec2 rgD = vec2(0.0), s = p * 90.0 + 4.1; mat2 J = mat2(90.0);
      for (int k = 0; k < 3; k++) { float lp = tdLp(qq); rg += w * 0.36;
        if (lp > 0.0) { vec3 n = tdNoiseD(s); float sg = n.x * 2.0 - 1.0, r = 1.0 - abs(sg); rg += w * lp * (r * r - 0.36); rgD += w * lp * (-4.0 * r * sign(sg)) * (n.yz * J); }
        s = TD_M * s + 2.7; J = TD_M * J; qq *= 2.0; w *= 0.5; }
      rg /= 0.875; rgD /= 0.875;
      vec2 grad = fd.yz * 2.5 + rgD * 2.0;
      if (!full) return vec3(0.5, grad);
      float q = px * 64.0, crack = 0.0, blk = 0.5, lb = tdLp(q * 0.5) * cf;
      if (lb > 0.0) {
        vec2 wq = p * vec2(48.0, 64.0) + (vec2(tdNoise(p * 20.0), tdNoise(p * 20.0 + 5.2)) - 0.5) * 0.9; // joints ~15-20 m apart, wavy
        vec2 cc = tdCell(wq); float lc = tdLp(q * 0.8);
        // crack lines at least ~1.5 px wide, broken and only in patches (no cobblestone), gone once the blocks shrink under a few px
        if (lc > 0.0) crack = (1.0 - smoothstep(0.0, max(0.04, q * 1.5), cc.x)) * smoothstep(0.45, 0.7, tdNoise(p * 7.0 + 3.0))
          * smoothstep(0.35, 0.75, tdNoise(wq * 0.8 + 11.0)) * lc * cf;
        blk = mix(0.5, cc.y, lb * smoothstep(0.3, 0.6, tdNoise(p * 5.0 + 8.0))); // block-to-block tone (weathering)
      }
      float g = tdNoiseF(p * 600.0, px * 600.0), zone = tdNoise(p * 12.0); // mineral grain; light / dark zones of ~80 m
      return vec3(0.5 + (f - 0.5) * 1.6 + (rg - 0.36) * 0.6 + (zone - 0.5) * 0.35 + (g - 0.5) * 0.3 + (blk - 0.5) * 0.12 - crack * 0.32, grad);
    }`,
    hooks: {
      color: `
    vec3 tdB = vec3(0.0); float tdPx = max(length(fwidth(fxWorld)), 1e-6); // derivatives outside the branch
    {
      float dist = length(fxWorld - cameraPosition), near = 1.0 - smoothstep(1.6, 6.5, dist);
      if (near > 0.0) {
        vec3 base = diffuseColor.rgb, P = fxWorld; float px = tdPx;
      #ifdef USE_NORMALMAP
        vec3 N = normalize(texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0); // object space = world space (terrain)
      #else
        vec3 N = normalize(fxObjNormal);
      #endif
        float lb = dot(base, vec3(0.299, 0.587, 0.114)), mx = max(max(base.r, base.g), base.b);
        float sat = (mx - min(min(base.r, base.g), base.b)) / max(mx, 1e-3);
        float paint = 1.0 - smoothstep(0.58, 0.78, lb); // bright paint (roads, buildings, snow) keeps the texture
        // steepness (exaggerated relief: ny 0.74 is about 30 deg real) with a ragged edge and the texture's hint
        float st = N.y + (tdNoiseF(P.xz * 55.0, px * 55.0) - 0.5) * 0.1 + (tdNoiseF(P.xz * 260.0, px * 260.0) - 0.5) * 0.05 + (sat - 0.25) * 0.55;
        float rockW = 1.0 - smoothstep(0.62, 0.72, st), grassW = smoothstep(0.76, 0.86, st), screeW = max(1.0 - rockW - grassW, 0.0);
        vec3 col = vec3(0.0), gW = vec3(0.0); // gW: height gradient in world space (m per km)
        bool doRock = rockW > 0.01, doScree = screeW > 0.01;
        if (doRock || doScree) {
          // triplanar: three planar projections blended by the normal, sharp so each face takes one projection; each
          // plane's gradient goes back onto its two world axes. A plane under 10% of the blend is dropped (faded out
          // from 20%, renormalised, so no seam): most faces take one or two projections, never three noise stacks.
          // Scree only needs the rock's relief (full = false), not its colour.
          vec3 tw = pow(abs(N), vec3(4.0)); tw /= tw.x + tw.y + tw.z; tw *= smoothstep(0.1, 0.2, tw); tw /= tw.x + tw.y + tw.z;
          float ra = 0.0, cf = smoothstep(0.1, 0.3, near); vec3 rg = vec3(0.0), r;
          if (tw.x > 0.0) { r = tdRock(P.zy, px, doRock, cf); ra += tw.x * r.x; rg += tw.x * vec3(0.0, r.z, r.y); }
          if (tw.y > 0.0) { r = tdRock(P.xz + 17.0, px, doRock, cf); ra += tw.y * r.x; rg += tw.y * vec3(r.y, 0.0, r.z); }
          if (tw.z > 0.0) { r = tdRock(P.xy + 31.0, px, doRock, cf); ra += tw.z * r.x; rg += tw.z * vec3(r.y, r.z, 0.0); }
          // strata: ledges about 7 m apart along the contour, wavy, in patches, on the steep faces only
          float led = 0.5, sAmt = 0.0, sL = tdLp(px * 130.0) * (1.0 - tw.y);
          if (sL > 0.0) {
            sAmt = sL * smoothstep(0.4, 0.65, tdNoise(vec2(P.x + P.z, P.y * 3.0) * 14.0)) * 0.6;
            if (sAmt > 0.0) { float sw = tdFbm(vec2(P.x + P.z, P.y) * 22.0, px * 22.0), sph = (P.y * 85.0 + sw * 2.2) * 6.2832;
              led = 0.5 + 0.5 * sin(sph); rg.y += sAmt * 1.6 * 0.5 * cos(sph) * 6.2832 * 85.0; }
          }
          if (doRock) {
            float streak = tdNoiseF(vec2((P.x + P.z) * 240.0, P.y * 18.0), px * 240.0) * (1.0 - tw.y); // wet / dark streaks down the faces
            float lichen = smoothstep(0.62, 0.8, tdNoiseF(P.xz * 380.0 + P.y * 90.0, px * 380.0));
            vec3 granite = mix(vec3(0.33, 0.31, 0.29), vec3(0.7, 0.67, 0.61), clamp(ra + (led - 0.5) * sAmt * 0.3, 0.0, 1.0));
            granite = mix(granite, granite * vec3(1.07, 0.98, 0.9), smoothstep(0.4, 0.7, tdNoise(P.xz * 30.0 + 2.0))); // warm feldspar patches
            granite *= 1.0 - smoothstep(0.55, 0.85, streak) * 0.3;
            granite = mix(granite, vec3(0.6, 0.6, 0.34), lichen * 0.45);
            col += granite * rockW; gW += rg * rockW;
          }
          if (doScree) {
            // scree: stones of 0.5 - 2 m in grey and rusty brown, dark gaps
            vec2 sp = P.xz * 650.0, sg = vec2(0.0);
            float sn = 0.5, slp = tdLp(px * 650.0), sv2 = 0.5;
            if (slp > 0.0) { sp += tdNoise(P.xz * 90.0) * 1.5; vec3 n = tdNoiseD(sp); float t = clamp((n.x - 0.25) * 2.0, 0.0, 1.0);
              sn = mix(0.5, t * t * (3.0 - 2.0 * t), slp); sg = slp * 6.0 * t * (1.0 - t) * 2.0 * n.yz * 650.0; sv2 = tdNoiseF(sp * 2.7 + 9.0, px * 1755.0); }
            float sv = 0.5 + (sn - 0.5) * 0.75 + (sv2 - 0.5) * 0.35;
            vec3 scree = mix(vec3(0.3, 0.29, 0.27), mix(vec3(0.62, 0.6, 0.56), vec3(0.56, 0.47, 0.38), tdN2(P.xz * 140.0, px * 140.0)), sv);
            col += scree * screeW;
            gW += (vec3(sg.x, 0.0, sg.y) * 0.5 + rg * 0.3) * screeW; // stones about 0.5 m proud
          }
        }
        if (grassW > 0.01) {
          // October meadow: dry yellow-green with green hollows, brown dead patches, rusty bilberry / heather spots, and
          // crisp tussocks (light tips, dark gaps) when close
          vec3 pa = tdFbmD(P.xz + 3.0, 70.0, px);
          float cl = 0.5, clp = tdLp(px * 520.0); vec2 cg = vec2(0.0);
          if (clp > 0.0) { vec3 n = tdNoiseD(mat2(0.8, -0.6, 0.6, 0.8) * P.xz * 520.0); float t = clamp((n.x - 0.3) * 2.5, 0.0, 1.0);
            cl = mix(0.5, t * t * (3.0 - 2.0 * t), clp); cg = clp * 6.0 * t * (1.0 - t) * 2.5 * (n.yz * mat2(0.8, -0.6, 0.6, 0.8)) * 520.0; }
          float bl = tdNoiseF(P.xz * 1900.0 + 5.0, px * 1900.0);
          vec3 g = mix(vec3(0.34, 0.42, 0.19), vec3(0.62, 0.58, 0.3), smoothstep(0.35, 0.68, pa.x));
          g = mix(g, vec3(0.52, 0.41, 0.25), smoothstep(0.58, 0.72, tdN2(P.xz * 120.0 + 11.0, px * 120.0)) * 0.6);
          g = mix(g, vec3(0.45, 0.25, 0.19), smoothstep(0.62, 0.74, tdN2(P.xz * 260.0 + 4.0, px * 260.0)) * 0.55);
          float tuft = cl * 0.65 + bl * 0.35;
          g *= 0.7 + 0.6 * tuft; g = mix(g, g * vec3(1.08, 1.04, 0.8), smoothstep(0.6, 0.9, tuft)); // sun-bleached tips
          col += g * grassW;
          vec2 gg = cg * 0.4 + pa.yz * 0.8; gW += vec3(gg.x, 0.0, gg.y) * grassW; // tussocks 0.4 m, swells 0.8 m
        }
        // luminance-preserving tint: the material's colour and pattern on the texture's brightness (avg albedo ~0.45)
        float tint = near * paint * 0.8;
        diffuseColor.rgb = mix(base, col * (lb / 0.45), tint);
        // m per km to scene units (x EX, a little stronger than life so the relief reads), tangential part only
        gW *= 0.0024 * near; tdB = -(gW - N * dot(gW, N));
      }
    }`,
      normal: `
    normal = normalize(normal + (viewMatrix * vec4(tdB, 0.0)).xyz); // world-space bump offset from the color hook`,
    } }),

  // POA heat: two canvas textures (previous / current step) crossfaded by uHeatT, contour edges at the 2x / 5x / 10x
  // stops of the shared scale, a slow pulse on the hotspot, and a glow at night (uEmis)
  poaHeat: (U) => ({ name: 'heat',
    uniforms: { uHeatFrom: U.uHeatFrom, uHeatTo: U.uHeatTo, uHeatT: U.uHeatT, uHeatOn: U.uHeatOn, uHeatRect: U.uHeatRect, uHeatEdges: U.uHeatEdges, uTime: U.uTime, uEmis: U.uEmis },
    hooks: {
      color: `
    vec3 heatEmit = vec3(0.0);
    {
      // uniform gates first: no heat layer (difficulty view) costs nothing, and a settled step (uHeatT 0 or 1, no
      // crossfade) samples one texture, not two
      float ka = uHeatOn.x * (1.0 - uHeatT), kb = uHeatOn.y * uHeatT;
      vec2 hu = (vec2(vMapUv.x, 1.0 - vMapUv.y) - uHeatRect.xy) / uHeatRect.zw;
      if (ka + kb > 0.0 && hu.x > 0.0 && hu.x < 1.0 && hu.y > 0.0 && hu.y < 1.0) {
        vec2 st = vec2(hu.x, 1.0 - hu.y);
        vec4 ha = vec4(0.0), hb = vec4(0.0);
        if (ka > 0.0) ha = texture2D(uHeatFrom, st);
        if (kb > 0.0) hb = texture2D(uHeatTo, st);
        float wa = ha.a * ka, wb = hb.a * kb, al = wa + wb;
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
    // one tap unless a re-bake is crossfading (uSunMaskT sits at 0 or 1 otherwise); in the baked shadow the near shadow
    // map's PCF taps are skipped (min(0, x) = 0). Only shadowed directional lights get the term, each sampled once.
    hooks: { color: `float bakedSun = uSunMaskT <= 0.0 ? texture2D(uSunMask, vMapUv).r : uSunMaskT >= 1.0 ? texture2D(uSunMask2, vMapUv).r
      : mix(texture2D(uSunMask, vMapUv).r, texture2D(uSunMask2, vMapUv).r, uSunMaskT);` },
    chunks: { lights_fragment_begin: (src) => src
      .replace('? getShadow( directionalShadowMap[ i ],', '&& bakedSun > 0.0 ? min( bakedSun, getShadow( directionalShadowMap[ i ],')
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
      float n = fxNoiseT(cp) * 0.62 + fxNoiseT(cp * 2.3 + 7.1) * 0.38;
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

  // planar reflection: app3d renders the terrain mirrored about the water plane y = uReflY into uReflTex (reduced
  // resolution, uReflMat = its texture projection). Blended over the lit water by a Fresnel term (stronger at grazing
  // angles and on calm water), distorted by the wave normal, only on water lying in that plane (other lakes keep the sky
  // reflection of the environment map), never on foam; the sky itself is not in the target (alpha 0), so it stays the
  // environment map's. base: the water effect it rides on ('waves' or 'sea'), which declares waterN and waterFoam.
  waterReflect: (U, base) => ({ name: 'refl', requires: [base],
    uniforms: { uReflTex: U.uReflTex, uReflMat: U.uReflMat, uReflY: U.uReflY, uReflOn: U.uReflOn, uWind: U.uWind },
    hooks: { output: `
    if (uReflOn > 0.5) {
      float plane = 1.0 - smoothstep(0.006, 0.016, abs(fxWorld.y - uReflY));
      if (plane > 0.0) {
        vec3 V = cameraPosition - fxWorld; float dist = length(V), nv = clamp(dot(waterN, V / dist), 0.0, 1.0);
        vec4 rp = uReflMat * vec4(fxWorld.x, uReflY, fxWorld.z, 1.0);
        vec2 ruv = rp.xy / rp.w + waterN.xz * (0.18 / (1.0 + dist * 0.5));
        vec4 rc = texture2D(uReflTex, clamp(ruv, 0.001, 0.999));
        // where the mirrored terrain hides the sky, its light replaces the sky's environment reflection
        float F = (0.45 + 0.55 * pow(1.0 - nv, 3.0)) * mix(1.0, 0.65, smoothstep(0.02, 0.1, uWind)), k = rc.a * plane * (1.0 - waterFoam);
        gl_FragColor.rgb = mix(max(gl_FragColor.rgb - reflectedLight.indirectSpecular * k, 0.0), rc.rgb / max(rc.a, 0.02), F * k);
      }
    }` } }),

  // lit windows at night (uNight 0..1): a window grid on the walls (floor km = one 3 m storey as drawn, bays 4 m wide), a
  // random 42% of the windows warm-lit, fading to their average glow where a bay gets smaller than a pixel (no shimmer)
  windows: (U, floorKm) => ({ name: 'windows', uniforms: { uNight: U.uNight },
    hooks: { albedo: 'if (abs(fxObjNormal.y) < 0.3) diffuseColor.rgb *= 1.0 - 0.4 * uNight; // walls darker at night, so the windows read',
      emissive: `
    if (uNight > 0.01 && abs(fxObjNormal.y) < 0.3) {
      vec2 wn = normalize(fxObjNormal.xz + 1e-5);
      vec2 g = vec2(dot(fxWorld.xz, vec2(-wn.y, wn.x)) / 0.004, fxWorld.y / ${floorKm.toFixed(5)});
      vec2 c = floor(g), f = fract(g), fw = fwidth(g) + 1e-4;
      float win = smoothstep(0.2, 0.2 + fw.x, f.x) * (1.0 - smoothstep(0.8 - fw.x, 0.8, f.x)) * smoothstep(0.3, 0.3 + fw.y, f.y) * (1.0 - smoothstep(0.78 - fw.y, 0.78, f.y));
      float w = mix(win * step(0.58, fxHash(c * vec2(1.0, 7.31) + wn * 13.7)), 0.12, smoothstep(0.35, 0.9, max(fw.x, fw.y)));
      totalEmissiveRadiance += mix(vec3(1.0, 0.5, 0.16), vec3(1.0, 0.74, 0.42), fxHash(c + 3.1)) * w * uNight * 2.0;
    }` } }),

  // night glow: soft additive halos (screen-space size in px, slightly larger up close) around markers; per point colour
  // aCol and size aSize, uAmt = night / fog amount. Depth-tested, so ridges in front still hide them; no fog on purpose.
  halo: () => fxShader({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uAmt: { value: 0 }, uPx: { value: 1 }, uTime: { value: 0 } },
    vertex: `attribute vec3 aCol; attribute float aSize; varying vec3 vCol;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float d = length(mv.xyz);
      mv.xyz *= 1.0 - min(0.03, d * 0.5) / d; // 30 m towards the camera: the halo lies over its own marker, not behind it
      gl_Position = projectionMatrix * mv;
      gl_PointSize = aSize * uPx * clamp(2.5 / max(-mv.z, 0.01), 0.55, 1.35) * (1.0 + 0.04 * sin(uTime * 1.6 + position.x * 40.0));
      vCol = aCol;
    }`,
    fragment: `varying vec3 vCol;
    void main() {
      float r = length(gl_PointCoord - 0.5) * 2.0;
      float a = (exp(-r * r * 2.6) * 0.42 + exp(-r * r * 14.0) * 0.5) * (1.0 - smoothstep(0.75, 1.0, r));
      gl_FragColor = vec4(vCol * a * uAmt, 1.0);
    }`,
  }),

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

  // near grass tufts and dwarf pine (app3d near-grass block, unit-height instances): each instance grows out of the
  // ground with the zoom fade (uGrassFade) and shrinks towards the rim of the placed disc (centre uGrassC, radius
  // uGrassR), so the set never ends in a hard ring; it bends downwind in one world direction (the clouds' drift), gusts
  // running across the meadow as waves, plus a little per-tuft flutter. uSway: 1 grass, less for the stiff dwarf pine.
  // Snow cover (uSnowCover) buries the grass and the lower part of the dwarf pine.
  grassField: (U, sway = 1) => ({ name: 'grass', uniforms: { uTime: U.uTime, uWind: U.uWind, uGrassC: U.uGrassC, uGrassR: U.uGrassR, uGrassFade: U.uGrassFade,
    uSnowCover: U.uSnowCover, uSway: { value: sway } },
    hooks: { vertex: `
    {
    #ifdef USE_INSTANCING
      vec3 ip = instanceMatrix[3].xyz; mat3 im = mat3(instanceMatrix);
    #else
      vec3 ip = vec3(0.0); mat3 im = mat3(1.0);
    #endif
      float gs = uGrassFade * (1.0 - smoothstep(0.72, 1.0, length(ip.xz - uGrassC.xz) / uGrassR));
      gs *= smoothstep(0.004, 0.012, length((modelMatrix * vec4(ip, 1.0)).xyz - cameraPosition)); // first-person / ground-level camera: no blades in the lens (gone within ~4 m, full from ~12 m)
      vec2 wd = vec2(0.8, 0.6);
      float gust = 0.6 + 0.4 * sin(dot(ip.xz, wd) * 160.0 - uTime * 2.4) * (0.6 + 0.4 * sin(dot(ip.xz, vec2(-0.6, 0.8)) * 40.0 + uTime * 0.5));
      float bend = position.y * position.y * (0.1 + uWind * 6.0) * gust * uSway;
      vec3 od = transpose(im) * vec3(wd.x, 0.0, wd.y); od.y = 0.0; od /= max(length(od), 1e-6); // downwind in object space
      float fl = sin(uTime * 3.7 + ip.x * 2300.0 + position.x * 9.0) * 0.12 * uSway * position.y;
      transformed.xz += od.xz * (bend + fl * 0.5) + vec2(-od.z, od.x) * fl;
      transformed.y -= bend * bend * 0.35; // a bent blade is shorter
      transformed.y *= 1.0 - uSnowCover * 0.8 * min(uSway, 1.0);
      transformed *= gs;
    }` } }),
};
