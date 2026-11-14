// Preview stages: lighting, sky, ground and grading around the creature. Preview-only — none of this
// is exported. def.preview.stage picks one ('studio' default, 'volcanic' for fire/lava creatures).
// Everything is scaled by `extent` (the creature's largest bounding size) so any creature size works.
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { fbm, cellular, smooth, clamp01 } from './rig-kit.js';

const VIEWS = {
  studio: { front: [0.6, 0.35, 0.75], side: [1, 0.22, 0.05], back: [-0.6, 0.35, -0.75] },
  // Lower, more heroic angles: the rim light from behind outlines the silhouette.
  volcanic: { front: [0.58, 0.16, 0.8], side: [1, 0.1, 0.12], back: [-0.6, 0.2, -0.78] },
};

function studio({ scene, extent, def }) {
  scene.background = new THREE.Color(def.preview?.background || '#16181d');
  scene.environmentIntensity = 0.5;
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a2c22, 0.7));
  const key = keyLight(0xfff1e0, 3.0, [-1, 1.6, 1.2], extent);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xa8c4ff, 2.2);
  rim.position.set(1, 0.8, -1.4).multiplyScalar(extent * 3);
  scene.add(rim);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(extent * 6, 64), new THREE.MeshStandardMaterial({ color: 0x1d1f24, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(extent * 8, 32, 0x3a3e48, 0x2c2f37);
  grid.position.y = 0.001;
  scene.add(grid);
  return { exposure: 1.0, bloom: [0.45, 0.4, 0.92], fov: 35, distance: 1.75, grade: false };
}

function keyLight(color, intensity, dir, extent) {
  const key = new THREE.DirectionalLight(color, intensity);
  key.position.set(...dir).normalize().multiplyScalar(extent * 4);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.radius = 4;
  Object.assign(key.shadow.camera, { left: -extent * 1.5, right: extent * 1.5, top: extent * 1.5, bottom: -extent * 1.5, near: 0.1, far: extent * 12 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  return key;
}

function dataTexture(data, size, srgb, repeat) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Cracked basalt with lava in the cracks: albedo, normal and emissive maps (tileable). */
function lavaGround(size, repeat) {
  const height = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);
  const glow = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const wu = u + 0.08 * (fbm(u, v, 3, 91, 3) - 0.5);
      const wv = v + 0.08 * (fbm(u, v, 3, 97, 3) - 0.5);
      const ridged = 1 - Math.abs(2 * fbm(wu, wv, 5, 57, 4) - 1);
      const crack = smooth((ridged - 0.975) / 0.02);
      const f1 = cellular(u, v, 12, 12, 61)[0];
      const fine = fbm(u, v, 16, 71, 3);
      const coarse = fbm(u, v, 4, 83, 3);
      height[y * size + x] = fine * 0.7 + coarse * 0.4 - crack * 0.6 + f1 * 0.15;
      const i = (y * size + x) * 4;
      const tone = (0.55 + 0.45 * coarse) * (0.75 + 0.35 * fine) * (1 - crack * 0.55);
      albedo[i] = 52 * tone; albedo[i + 1] = 44 * tone; albedo[i + 2] = 41 * tone; albedo[i + 3] = 255;
      const lava = crack * smooth((coarse - 0.55) / 0.2) * 0.85;
      glow[i] = lava * 255; glow[i + 1] = lava * 120; glow[i + 2] = lava * lava * 30; glow[i + 3] = 255;
    }
  }
  const normal = new Uint8Array(size * size * 4);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 5;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 5;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      normal[i] = (-dx / len * 0.5 + 0.5) * 255; normal[i + 1] = (-dy / len * 0.5 + 0.5) * 255;
      normal[i + 2] = (1 / len * 0.5 + 0.5) * 255; normal[i + 3] = 255;
    }
  }
  return {
    map: dataTexture(albedo, size, true, repeat),
    normalMap: dataTexture(normal, size, false, repeat),
    emissiveMap: dataTexture(glow, size, true, repeat),
  };
}

function volcanic({ scene, extent }) {
  const fogColor = new THREE.Color('#1d100d');
  scene.fog = new THREE.FogExp2(fogColor, 0.075 / extent);
  scene.background = fogColor;
  scene.environmentIntensity = 0.16;

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(extent * 40, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color('#06030a') }, uHorizon: { value: new THREE.Color('#5a2616') },
        uGround: { value: new THREE.Color('#1a0907') }, uFog: { value: fogColor }, uSunCol: { value: new THREE.Color('#e8622c') },
        uSun: { value: new THREE.Vector3(0.3, 0.16, -1).normalize() }, uPlanet: { value: new THREE.Vector3(-0.62, 0.38, -0.68).normalize() },
        uPlanetCol: { value: new THREE.Color('#d6ab8b') },
      },
      vertexShader: /* glsl */`
        varying vec3 vWorld;
        void main() { vWorld = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform vec3 uZenith, uHorizon, uGround, uFog, uSunCol, uSun, uPlanet, uPlanetCol;
        varying vec3 vWorld;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        void main() {
          vec3 dir = normalize(vWorld - cameraPosition);
          float h = dir.y;
          vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.6, h));
          col = mix(col, uGround, smoothstep(0.0, -0.25, h));
          float s = max(dot(dir, uSun), 0.0);
          col += uSunCol * (pow(s, 6.0) * 0.55 + pow(s, 90.0) * 2.5);
          col += vec3(1.0, 0.85, 0.7) * step(0.9975, hash(floor(dir * 420.0))) * smoothstep(0.15, 0.6, h) * 0.6;
          vec3 px = normalize(cross(vec3(0.0, 1.0, 0.0), uPlanet));
          vec3 py = cross(uPlanet, px);
          vec2 q = vec2(dot(dir, px), dot(dir, py)) / 0.2;
          float r2 = dot(q, q);
          float facing = step(0.0, dot(dir, uPlanet));
          col += uSunCol * exp(-max(r2 - 1.0, 0.0) * 6.0) * facing * 0.2;
          if (r2 < 1.0 && facing > 0.5) {
            vec3 n = normalize(px * q.x + py * q.y - uPlanet * sqrt(1.0 - r2));
            float lit = smoothstep(-0.15, 0.6, dot(n, uSun));
            float bands = sin(q.y * 16.0 + sin(q.x * 3.0) * 1.4) * 0.08 + sin(q.y * 41.0) * 0.03;
            vec3 planet = uPlanetCol * (0.06 + 0.9 * lit) * (1.0 + bands);
            col = mix(col, planet + uSunCol * pow(1.0 - sqrt(1.0 - r2), 3.0) * lit * 0.8, smoothstep(1.0, 0.94, r2));
          }
          col = mix(uFog, col, smoothstep(-0.03, 0.16, h));
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  sky.frustumCulled = false;
  scene.add(sky);

  scene.add(new THREE.HemisphereLight(0xffd6b8, 0x1a0b08, 0.4));
  scene.add(keyLight(0xffe8d2, 3.2, [-6, 9.5, 6.5], extent));
  const rim = new THREE.DirectionalLight(0xff6a2a, 6);
  rim.position.set(2, 4.5, -8).normalize().multiplyScalar(extent * 4);
  scene.add(rim);
  const cool = new THREE.DirectionalLight(0x9db2e8, 1.5);
  cool.position.set(8, 2.5, 3.5).normalize().multiplyScalar(extent * 4);
  scene.add(cool);

  const plane = extent * 50;
  const tex = lavaGround(512, Math.round(plane / (extent * 2.2)));
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(plane, plane),
    new THREE.MeshStandardMaterial({ ...tex, normalScale: new THREE.Vector2(1.4, 1.4), emissive: 0xff7a2a, emissiveIntensity: 0.9, roughness: 0.92, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  return { exposure: 0.95, bloom: [0.65, 0.5, 0.9], fov: 32, distance: 1.9, grade: true };
}

/** Vignette + animated film grain, applied after tone mapping. */
export function gradePass() {
  return new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
    vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse; uniform float uTime; varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        float v = smoothstep(0.82, 0.22, length((vUv - 0.5) * vec2(1.15, 1.0)));
        c.rgb *= mix(0.42, 1.0, v);
        c.rgb += (hash(vUv * 1024.0 + fract(uTime) * 61.0) - 0.5) * 0.03;
        gl_FragColor = c;
      }`,
  });
}

/** Build the stage; returns camera/post settings and the view directions for 'front'/'side'/'back'. */
export function buildStage(kind, ctx) {
  const name = kind === 'volcanic' ? 'volcanic' : 'studio';
  const settings = name === 'volcanic' ? volcanic(ctx) : studio(ctx);
  return { ...settings, name, views: VIEWS[name] };
}

export { clamp01 };
