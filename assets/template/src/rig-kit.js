// Engine-neutral procedural rig toolkit: bones, rigid parts, soft skins, pose functions,
// two-bone IK, frame-exact clip baking and GLB export. creature.js builds on this file.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export { THREE };
export const TAU = Math.PI * 2;
export const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const smooth = (v) => { const t = clamp01(v); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeIn = (t) => Math.pow(clamp01(t), 2.2);
export const easeOut = (t) => 1 - Math.pow(1 - clamp01(t), 3);
/** Periodic wave for looping clips: integer `cycles` keeps frame 0 and the last frame identical. */
export const wave = (u, cycles = 1, phase = 0) => Math.sin(TAU * cycles * u + phase);

const ATTRS = ['position', 'normal', 'uv', 'color'];

// ---------------------------------------------------------------- colour + geometry

const _c = new THREE.Color();
export const mix = (a, b, t) => _c.copy(new THREE.Color(a)).lerp(new THREE.Color(b), clamp01(t));

/** fn(x, y, z) returns a THREE.Color (a shared temp is fine); a plain colour paints uniformly. */
export function colorize(geo, fn) {
  const paint = typeof fn === 'function' ? fn : (() => new THREE.Color(fn));
  const p = geo.attributes.position;
  const arr = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i += 1) {
    const c = paint(p.getX(i), p.getY(i), p.getZ(i));
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
/** Transform geometry in place. Rotations are Euler YXZ radians, same as poses. */
export function place(geo, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  _e.set(r[0], r[1], r[2], 'YXZ');
  _q.setFromEuler(_e);
  _m.compose(new THREE.Vector3(...p), _q, new THREE.Vector3(...(Array.isArray(s) ? s : [s, s, s])));
  geo.applyMatrix4(_m);
  return geo;
}

/** Tapered limb hanging down -Y from the origin (attach to a bone whose child sits at [0, -len, 0]). */
export function limb(len, r0, r1, { bulge = 0.18, flat = 0.85, curve = 0, radial = 10, rings = 10, color } = {}) {
  const geo = new THREE.CylinderGeometry(r0, r1, len, radial, rings);
  geo.translate(0, -len / 2, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i += 1) {
    const t = -p.getY(i) / len;
    const w = 1 + bulge * Math.sin(Math.PI * t);
    p.setX(i, p.getX(i) * w + curve * Math.sin(Math.PI * t) * len);
    p.setZ(i, p.getZ(i) * w * flat);
  }
  geo.computeVertexNormals();
  return color === undefined ? geo : colorize(geo, typeof color === 'function' ? (x, y, z) => color(-y / len, x, z) : color);
}

/** Cone/horn pointing +Y, tip bent along `axis`. color(t) receives 0 at the base, 1 at the tip. */
export function spike(len, rad, { bend = 0.3, axis = 'x', radial = 6, rings = 6, color } = {}) {
  const geo = new THREE.ConeGeometry(rad, len, radial, rings);
  geo.translate(0, len / 2, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i += 1) {
    const t = p.getY(i) / len;
    if (axis === 'x') p.setX(i, p.getX(i) + bend * t * t * len);
    else p.setZ(i, p.getZ(i) + bend * t * t * len);
  }
  geo.computeVertexNormals();
  return color === undefined ? geo : colorize(geo, typeof color === 'function' ? (x, y) => color(y / len) : color);
}

/** Ellipsoid. color(x, y, z) in unit-sphere space before scaling. */
export function blob(radius, { scale = [1, 1, 1], width = 20, height = 14, color } = {}) {
  const geo = new THREE.SphereGeometry(1, width, height);
  if (color !== undefined) colorize(geo, color);
  return place(geo, [0, 0, 0], [0, 0, 0], scale.map((v) => v * radius));
}

/**
 * Curved plate / tube along +Z (dir = -1 for -Z). radius(t) gives the profile over t in [0, 1];
 * cover < TAU makes an open dorsal plate. color(t, e) gets e in [-1, 1] across the plate.
 */
export function shell({
  length, radius, cover = TAU, seg = 30, rings = 20, flatten = 0.7,
  keel = 0, grooves = 0, groove = 0.03, dir = 1, color,
}) {
  const pos = [];
  const uv = [];
  const col = [];
  const idx = [];
  for (let j = 0; j <= rings; j += 1) {
    const t = j / rings;
    const r = radius(t);
    for (let i = 0; i <= seg; i += 1) {
      const phi = -cover / 2 + cover * i / seg;
      let s = 1 + keel * Math.pow(Math.max(0, Math.cos(phi)), 8);
      if (grooves) s += groove * Math.cos(phi * grooves) * Math.max(0, Math.cos(phi * 0.5));
      const x = r * s * Math.sin(phi);
      let y = r * s * Math.cos(phi);
      if (y < 0) y *= flatten;
      pos.push(x, y, dir * t * length);
      uv.push(i / seg, t);
      const c = color ? (typeof color === 'function' ? color(t, phi / (cover / 2)) : new THREE.Color(color)) : _c.setRGB(1, 1, 1);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < rings; j += 1) {
    for (let i = 0; i < seg; i += 1) {
      const a = j * (seg + 1) + i;
      const c = a + seg + 1;
      if (dir > 0) idx.push(a, c, a + 1, a + 1, c, c + 1);
      else idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Hard armour plate / osteoderm along +Z (centred on the origin, base at y = 0, top at +Y).
 * The cross-section is a chamfered profile with an optional raised keel; facets are flat-shaded so
 * the chamfers catch highlights like a bevelled hard-surface part. Closed (bottom + end caps).
 * `taper` narrows the front (+Z) end, `lift` raises the front so overlapping rows read as shingles.
 * color(t, e) gets t along the plate (0 back, 1 front) and e from 0 (base edge) to 1 (keel ridge).
 */
export function scute(len, width, height, { keel = 0.4, taper = 0.55, lift = 0.15, rings = 3, color } = {}) {
  const prof = [[-0.5, 0, 0], [-0.5, 0.32, 0.25], [-0.3, 0.78, 0.6], [0, 1 + keel, 1], [0.3, 0.78, 0.6], [0.5, 0.32, 0.25], [0.5, 0, 0]];
  const rows = [];
  for (let j = 0; j <= rings; j += 1) {
    const t = j / rings;
    const w = width * lerp(1, taper, t) * (0.72 + 0.28 * Math.sin(Math.PI * (0.15 + 0.85 * t)));
    const h = height * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, 0.2 + t)));
    const z = (t - 0.5) * len;
    rows.push(prof.map(([px, py, e]) => ({ p: [px * w, py * h + lift * height * t, z], t, e })));
  }
  const pos = [];
  const col = [];
  const paint = (v) => {
    const c = color ? (typeof color === 'function' ? color(v.t, v.e) : new THREE.Color(color)) : _c.setRGB(1, 1, 1);
    col.push(c.r, c.g, c.b);
  };
  const tri = (a, b, c) => { for (const v of [a, b, c]) { pos.push(...v.p); paint(v); } };
  const n = prof.length;
  for (let j = 0; j < rings; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const a = rows[j][i]; const b = rows[j][(i + 1) % n]; const c = rows[j + 1][i]; const d = rows[j + 1][(i + 1) % n];
      tri(a, c, b); tri(b, c, d);
    }
  }
  const cap = (row, flip) => {
    const cx = { p: [0, row[3].p[1] * 0.45, row[0].p[2]], t: row[0].t, e: 0.3 };
    for (let i = 0; i < n; i += 1) {
      const a = row[i]; const b = row[(i + 1) % n];
      if (flip) tri(cx, a, b); else tri(cx, b, a);
    }
  };
  cap(rows[0], true);
  cap(rows[rings], false);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Soft tube skinned along a bone chain, for tails, abdomens, tentacles and necks.
 * Call inside rig.skin(): `joints` are rig-space bind positions, one more than the segments.
 */
export function skinnedTube(joints, radii, { perSeg = 10, radial = 20, flatten = 0.86, color } = {}) {
  const positions = [];
  const uvs = [];
  const colors = [];
  const skinIndex = [];
  const skinWeight = [];
  const indices = [];
  const segCount = joints.length - 1;
  const up0 = new THREE.Vector3(0, 1, 0);
  const tangentAt = (s, t) => {
    const cur = new THREE.Vector3().subVectors(joints[s + 1], joints[s]).normalize();
    if (t < 0.5 && s > 0) return new THREE.Vector3().subVectors(joints[s], joints[s - 1]).normalize().lerp(cur, 0.5 + t).normalize();
    if (t > 0.5 && s < segCount - 1) return cur.clone().lerp(new THREE.Vector3().subVectors(joints[s + 2], joints[s + 1]).normalize(), t - 0.5).normalize();
    return cur;
  };
  let ring = 0;
  for (let s = 0; s < segCount; s += 1) {
    for (let k = 0; k <= perSeg; k += 1) {
      if (s > 0 && k === 0) continue;
      const t = k / perSeg;
      const center = new THREE.Vector3().lerpVectors(joints[s], joints[s + 1], t);
      const T = tangentAt(s, t);
      const side = new THREE.Vector3().crossVectors(T, Math.abs(T.y) > 0.95 ? new THREE.Vector3(0, 0, 1) : up0).normalize();
      const up = new THREE.Vector3().crossVectors(side, T).normalize();
      const r = lerp(radii[s], radii[s + 1], t);
      const w = [[s, 1]];
      if (t < 0.5 && s > 0) { w[0][1] = 0.5 + t; w.push([s - 1, 0.5 - t]); }
      if (t > 0.5 && s < segCount - 1) { w[0][1] = 1.5 - t; w.push([s + 1, t - 0.5]); }
      const v = (s + t) / segCount;
      for (let i = 0; i <= radial; i += 1) {
        const a = (i / radial) * TAU;
        const p = center.clone().addScaledVector(side, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r * flatten);
        positions.push(p.x, p.y, p.z);
        uvs.push(i / radial, v);
        const c = color ? (typeof color === 'function' ? color(v, Math.sin(a)) : new THREE.Color(color)) : _c.setRGB(1, 1, 1);
        colors.push(c.r, c.g, c.b);
        skinIndex.push(w[0][0], w[1] ? w[1][0] : 0, 0, 0);
        skinWeight.push(w[0][1], w[1] ? w[1][1] : 0, 0, 0);
      }
      if (ring > 0) {
        const a0 = (ring - 1) * (radial + 1);
        const a1 = ring * (radial + 1);
        for (let i = 0; i < radial; i += 1) indices.push(a0 + i, a1 + i, a0 + i + 1, a0 + i + 1, a1 + i, a1 + i + 1);
      }
      ring += 1;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------- procedural textures

function hash2(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x, y, period, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = (n) => ((n % period) + period) % period;
  return lerp(lerp(hash2(w(xi), w(yi), seed), hash2(w(xi + 1), w(yi), seed), u),
    lerp(hash2(w(xi), w(yi + 1), seed), hash2(w(xi + 1), w(yi + 1), seed), u), v);
}

/** Tileable fBm in [0, 1]; u, v in [0, 1). */
export function fbm(u, v, period, seed, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freq = 1;
  for (let o = 0; o < octaves; o += 1) {
    sum += amp * valueNoise(u * period * freq, v * period * freq, period * freq, seed + o * 31);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** Tileable cellular noise: [f1, f2] distances to the nearest feature points. */
export function cellular(u, v, cx, cy, seed) {
  const gx = u * cx;
  const gy = v * cy;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  let f1 = 9;
  let f2 = 9;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const x = ix + dx;
      const y = iy + dy;
      const wx = ((x % cx) + cx) % cx;
      const wy = ((y % cy) + cy) % cy;
      const d = Math.hypot(x + hash2(wx, wy, seed) - gx, y + hash2(wx, wy, seed + 7) - gy);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return [f1, f2];
}

function dataTexture(data, size, srgb, repeat) {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Bake a tileable texture pair from a height/colour function.
 * fn(u, v) returns { h, color? } with h roughly in [0, 1] and color a THREE.Color.
 * Use material.map = albedo (if colours were returned) and material.normalMap = normal.
 * `repeat` tiles both maps; export bakes it into the UVs.
 */
export function proceduralTexture(fn, { size = 256, normalStrength = 3, repeat = [1, 1] } = {}) {
  const heights = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);
  let hasColor = false;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const { h, color } = fn(x / size, y / size);
      heights[y * size + x] = h;
      const i = (y * size + x) * 4;
      if (color) {
        hasColor = true;
        albedo[i] = clamp01(color.r) * 255;
        albedo[i + 1] = clamp01(color.g) * 255;
        albedo[i + 2] = clamp01(color.b) * 255;
      }
      albedo[i + 3] = 255;
    }
  }
  const normal = new Uint8Array(size * size * 4);
  const at = (x, y) => heights[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * normalStrength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * normalStrength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      normal[i] = (-dx / len * 0.5 + 0.5) * 255;
      normal[i + 1] = (-dy / len * 0.5 + 0.5) * 255;
      normal[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      normal[i + 3] = 255;
    }
  }
  return {
    normal: dataTexture(normal, size, false, repeat),
    albedo: hasColor ? dataTexture(albedo, size, true, repeat) : null,
  };
}

// ---------------------------------------------------------------- poses

/**
 * A pose maps bone name -> { r: [x, y, z] Euler YXZ radians, p?: [x, y, z] local position,
 * s?: [x, y, z] local scale }. Scale is optional; a scale track is exported only for bones whose
 * scale leaves the bind value in some frame.
 */
export function clonePose(pose) { return JSON.parse(JSON.stringify(pose)); }

/** Blend two poses; bones missing from either side are taken from the side that has them. */
export function lerpPose(a, b, t) {
  const out = clonePose(a);
  for (const [name, spec] of Object.entries(b)) {
    if (!out[name]) { out[name] = clonePose(spec); continue; }
    for (const k of ['p', 'r', 's']) {
      if (spec[k] && out[name][k]) out[name][k] = out[name][k].map((v, i) => lerp(v, spec[k][i], t));
      else if (spec[k]) out[name][k] = [...spec[k]];
    }
  }
  return out;
}

/** Deep-merge `overlay` onto a copy of `base` (overlay wins per channel). */
export function withPose(base, overlay) {
  const out = clonePose(base);
  for (const [name, spec] of Object.entries(overlay)) out[name] = { ...(out[name] || {}), ...clonePose(spec) };
  return out;
}

/**
 * Piecewise keyframe timeline over u in [0, 1]: keys = [[u0, pose0, ease?], [u1, pose1, ease?], ...].
 * The ease on a key shapes the segment that ends at that key (default smooth).
 */
export function timeline(keys) {
  return (u) => {
    if (u <= keys[0][0]) return clonePose(keys[0][1]);
    for (let i = 1; i < keys.length; i += 1) {
      const [u1, p1, ease = smooth] = keys[i];
      if (u <= u1) {
        const [u0, p0] = keys[i - 1];
        return lerpPose(p0, p1, ease((u - u0) / Math.max(1e-6, u1 - u0)));
      }
    }
    return clonePose(keys[keys.length - 1][1]);
  };
}

// ---------------------------------------------------------------- IK

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _basis = new THREE.Matrix4();

/**
 * Two-bone IK. chain = { root, upper, lower, upperLen, lowerLen, pole }:
 * `upper` is a child of `root`, `lower` a child of `upper` at [0, -upperLen, 0], and the
 * end effector sits at [0, -lowerLen, 0] under `lower` (limbs hang along local -Y).
 * `pole` is a world-space direction the knee bends towards. `target` is a world position.
 * Call after the rig's world matrices are current (Rig.applyPose does that).
 */
export function solveTwoBone(chain, target) {
  const { root, upper, lower, upperLen: A, lowerLen: B } = chain;
  root.updateWorldMatrix(true, false);
  const H = upper.getWorldPosition(new THREE.Vector3());
  const d = _v.subVectors(target, H);
  const L = THREE.MathUtils.clamp(d.length(), Math.abs(A - B) + 1e-3, A + B - 1e-3);
  const dn = d.normalize().clone();
  const pole = chain.pole.clone().normalize();
  pole.addScaledVector(dn, -pole.dot(dn));
  if (pole.lengthSq() < 1e-8) pole.set(0, 0, 1).addScaledVector(dn, -dn.z);
  pole.normalize();
  const x = (A * A - B * B + L * L) / (2 * L);
  const h = Math.sqrt(Math.max(0, A * A - x * x));
  const K = H.clone().addScaledVector(dn, x).addScaledVector(pole, h);
  const T = H.clone().addScaledVector(dn, L);
  const n = new THREE.Vector3().crossVectors(dn, pole).normalize();
  const orient = (from, to) => {
    const y = _w.subVectors(from, to).normalize();
    const z = n.clone().addScaledVector(y, -n.dot(y)).normalize();
    _basis.makeBasis(new THREE.Vector3().crossVectors(y, z), y, z);
    return new THREE.Quaternion().setFromRotationMatrix(_basis);
  };
  const qUpper = orient(H, K);
  const qLower = orient(K, T);
  root.getWorldQuaternion(_qa);
  upper.quaternion.copy(_qa.invert().multiply(qUpper));
  lower.quaternion.copy(_qb.copy(qUpper).invert().multiply(qLower));
  upper.updateMatrixWorld(true);
}

/**
 * Foot offset for a walk cycle at phase in [0, 1): stance slides the foot back along -Z,
 * swing lifts it forward. Returns { dz, lift } to add to the rest foot position.
 */
export function gaitStep(phase, { stride = 0.6, stance = 0.6, lift = 0.25 } = {}) {
  const c = ((phase % 1) + 1) % 1;
  if (c < stance) return { dz: stride * (0.5 - c / stance), lift: 0 };
  const s = (c - stance) / (1 - stance);
  return { dz: stride * (-0.5 + smooth(s)), lift: lift * Math.sin(Math.PI * s) };
}

// ---------------------------------------------------------------- rig

export class Rig {
  constructor() {
    this.group = new THREE.Group();
    this.bones = [];
    this.rest = new Map();
    this.parts = [];
    this.skins = [];
    this.meshes = [];
  }

  /** Create a bone. parent null attaches to the rig root; p is the local offset in meters. */
  bone(name, parent = null, p = [0, 0, 0]) {
    if (this.bones.some((b) => b.name === name)) throw new Error(`duplicate bone ${name}`);
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(...p);
    (parent || this.group).add(b);
    this.bones.push(b);
    this.rest.set(b, { p: b.position.clone(), s: b.scale.clone() });
    return b;
  }

  get(name) {
    const b = this.bones.find((x) => x.name === name);
    if (!b) throw new Error(`unknown bone ${name}`);
    return b;
  }

  /** Rigid geometry that follows one bone, in that bone's local space. */
  part(bone, matKey, geo) {
    this.parts.push({ bone: typeof bone === 'string' ? this.get(bone) : bone, matKey, geo });
    return this;
  }

  /**
   * Deforming geometry. build() runs in the bind pose and returns rig-space geometry whose
   * skinIndex values index into `bones` (see skinnedTube).
   */
  skin(matKey, bones, build) {
    this.skins.push({ matKey, bones: bones.map((b) => (typeof b === 'string' ? this.get(b) : b)), build });
    return this;
  }

  resetTransforms() {
    for (const b of this.bones) {
      const r = this.rest.get(b);
      b.position.copy(r.p);
      b.quaternion.identity();
      b.scale.copy(r.s);
    }
  }

  applyPose(pose) {
    for (const [name, spec] of Object.entries(pose)) {
      const b = this.get(name);
      if (spec.r) b.rotation.set(spec.r[0], spec.r[1], spec.r[2], 'YXZ');
      if (spec.p) b.position.set(...spec.p);
      if (spec.s) b.scale.set(...(Array.isArray(spec.s) ? spec.s : [spec.s, spec.s, spec.s]));
    }
    this.group.updateMatrixWorld(true);
  }

  /** Put the rig into clip `name` at progress u (null = bind pose) using the creature definition. */
  pose(def, name, u) {
    this.resetTransforms();
    const clip = name ? def.clips[name] : null;
    this.applyPose(clip ? clip.pose(u) : def.rest);
    if (def.afterPose) def.afterPose(this, name, u);
    this.group.updateMatrixWorld(true);
  }

  /** Build preview meshes. Call once, after the creature definition is complete. */
  finalize(def) {
    this.pose(def, null, 0);
    const skinGeos = this.skins.map(({ bones, build }) => build(bones.map((b) => b.getWorldPosition(new THREE.Vector3()))));
    if (def.shading) bakeShading(this, def, skinGeos);
    const byBoneKey = new Map();
    for (const { bone, matKey, geo } of this.parts) {
      const id = `${bone.name}\u0000${matKey}`;
      if (!byBoneKey.has(id)) byBoneKey.set(id, { bone, matKey, geos: [] });
      byBoneKey.get(id).geos.push(geo);
    }
    for (const { bone, matKey, geos } of byBoneKey.values()) {
      const mesh = new THREE.Mesh(mergeGeometries(geos.map(normalizeGeometry), false), material(def, matKey));
      mesh.userData.matKey = matKey;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      bone.add(mesh);
      this.meshes.push(mesh);
    }
    for (const [si, { matKey, bones }] of this.skins.entries()) {
      const geo = normalizeGeometry(skinGeos[si], true);
      const mesh = new THREE.SkinnedMesh(geo, material(def, matKey));
      mesh.userData.matKey = matKey;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.group.updateMatrixWorld(true);
      mesh.bind(new THREE.Skeleton(bones));
      this.meshes.push(mesh);
    }
  }

  /** Sample every bone at `fps` with frame 0 and the last frame on exact clip boundaries. */
  bakeClip(def, name, fps) {
    const clip = def.clips[name];
    const frames = Math.max(2, Math.round(clip.duration * fps) + 1);
    const times = [];
    const quats = this.bones.map(() => []);
    const positions = this.bones.map(() => []);
    const scales = this.bones.map(() => []);
    const moved = this.bones.map(() => false);
    const scaled = this.bones.map(() => false);
    const prev = this.bones.map(() => null);
    for (let f = 0; f < frames; f += 1) {
      const u = f / (frames - 1);
      times.push(u * clip.duration);
      this.pose(def, name, u);
      this.bones.forEach((bone, i) => {
        const q = bone.quaternion.clone();
        if (prev[i] && prev[i].dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        prev[i] = q;
        quats[i].push(q.x, q.y, q.z, q.w);
        positions[i].push(...bone.position.toArray());
        scales[i].push(...bone.scale.toArray());
        if (bone.position.distanceToSquared(this.rest.get(bone).p) > 1e-12) moved[i] = true;
        if (bone.scale.distanceToSquared(this.rest.get(bone).s) > 1e-12) scaled[i] = true;
      });
    }
    const tracks = this.bones.map((bone, i) => new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, quats[i]));
    this.bones.forEach((bone, i) => {
      if (moved[i]) tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.position`, times, positions[i]));
      if (scaled[i]) tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.scale`, times, scales[i]));
    });
    return { clip: new THREE.AnimationClip(name, clip.duration, tracks), frames };
  }
}

/**
 * Bake ambient shading into vertex colours in the bind pose (exports with the mesh, Blender bakes it
 * into basecolor). def.shading = { ao, radius, sky, tint, exclude: [matKeys] }:
 * - ao: strength of point-based ambient occlusion between separate parts (crevices, where plates
 *   meet the body, under the jaw). radius: occlusion reach in meters.
 * - sky: darken down-facing surfaces (0 = off, 0.25 = underside at 75 %).
 * - tint: per-part brightness jitter so repeated plates do not look cloned.
 * Excluded material keys (emissive parts) neither receive nor cast.
 */
function bakeShading(rig, def, skinGeos) {
  const { ao = 0.6, radius = 0.08, sky = 0.22, tint = 0.08, exclude = [] } = def.shading;
  const items = [];
  rig.parts.forEach(({ bone, matKey, geo }, i) => items.push({ geo, matKey, matrix: bone.matrixWorld, id: i, jitter: true }));
  skinGeos.forEach((geo, i) => items.push({ geo, matKey: rig.skins[i].matKey, matrix: rig.group.matrixWorld, id: `s${i}`, jitter: false }));
  const toRig = new THREE.Matrix4().copy(rig.group.matrixWorld).invert();
  const P = []; const N = []; const A = []; const ID = []; const owner = [];
  const m = new THREE.Matrix4(); const nm = new THREE.Matrix3();
  const v = new THREE.Vector3(); const w = new THREE.Vector3();
  for (const it of items) {
    const { geo } = it;
    if (!geo.attributes.color) colorize(geo, 0xffffff);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    m.multiplyMatrices(toRig, it.matrix);
    nm.getNormalMatrix(m);
    const pos = geo.attributes.position; const nor = geo.attributes.normal;
    const area = new Float32Array(pos.count);
    const idx = geo.index ? geo.index.array : null;
    const triCount = idx ? idx.length / 3 : pos.count / 3;
    const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
    for (let t = 0; t < triCount; t += 1) {
      const i0 = idx ? idx[t * 3] : t * 3; const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1; const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(m); b.fromBufferAttribute(pos, i1).applyMatrix4(m); c.fromBufferAttribute(pos, i2).applyMatrix4(m);
      const ar = b.sub(a).cross(c.sub(a)).length() / 6;
      area[i0] += ar; area[i1] += ar; area[i2] += ar;
    }
    it.start = P.length / 3;
    for (let k = 0; k < pos.count; k += 1) {
      v.fromBufferAttribute(pos, k).applyMatrix4(m);
      w.fromBufferAttribute(nor, k).applyMatrix3(nm).normalize();
      P.push(v.x, v.y, v.z); N.push(w.x, w.y, w.z); A.push(area[k]); ID.push(it.id); owner.push(it);
    }
  }
  const count = A.length;
  const cell = radius;
  const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const grid = new Map();
  for (let i = 0; i < count; i += 1) {
    if (exclude.includes(owner[i].matKey)) continue;
    const k = key(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  const shade = new Float32Array(count).fill(1);
  for (let i = 0; i < count; i += 1) {
    if (exclude.includes(owner[i].matKey)) continue;
    const px = P[i * 3]; const py = P[i * 3 + 1]; const pz = P[i * 3 + 2];
    const nx = N[i * 3]; const ny = N[i * 3 + 1]; const nz = N[i * 3 + 2];
    let occ = 0;
    const cx = Math.floor(px / cell); const cy = Math.floor(py / cell); const cz = Math.floor(pz / cell);
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dz = -1; dz <= 1; dz += 1) {
      const list = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
      if (!list) continue;
      for (const j of list) {
        if (ID[j] === ID[i]) continue;
        const qx = P[j * 3] - px; const qy = P[j * 3 + 1] - py; const qz = P[j * 3 + 2] - pz;
        const d2 = qx * qx + qy * qy + qz * qz;
        if (d2 > radius * radius || d2 < 1e-10) continue;
        const d = Math.sqrt(d2);
        const cosR = (qx * nx + qy * ny + qz * nz) / d;
        if (cosR <= 0) continue;
        const fall = 1 - d / radius;
        occ += (1 - 1 / Math.sqrt(1 + A[j] / (Math.PI * d2))) * Math.min(1, cosR * 2) * fall;
      }
    }
    const hemi = 1 - sky * (0.5 - 0.5 * ny);
    shade[i] = hemi * (1 - ao * Math.min(1, occ * 1.6));
  }
  for (const it of items) {
    const col = it.geo.attributes.color;
    const j = it.jitter ? 1 + tint * (hash2(typeof it.id === 'number' ? it.id : 0, 3, 29) * 2 - 1) : 1;
    for (let k = 0; k < col.count; k += 1) {
      const s = shade[it.start + k] * j;
      col.setXYZ(k, Math.min(1, col.getX(k) * s), Math.min(1, col.getY(k) * s), Math.min(1, col.getZ(k) * s));
    }
    col.needsUpdate = true;
  }
}

function normalizeGeometry(g, keepSkin = false) {
  let geo = g.index ? g.toNonIndexed() : g;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const n = geo.attributes.position.count;
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!geo.attributes.color) colorize(geo, 0xffffff);
  const keep = keepSkin ? [...ATTRS, 'skinIndex', 'skinWeight'] : ATTRS;
  for (const name of Object.keys(geo.attributes)) if (!keep.includes(name)) geo.deleteAttribute(name);
  return geo;
}

function material(def, key) {
  const m = def.materials[key];
  if (!m) throw new Error(`material "${key}" is not defined in creature.materials`);
  m.vertexColors = true;
  return m;
}

// ---------------------------------------------------------------- export

function cloneSkeleton(rig) {
  const byName = new Map();
  const copy = (src) => {
    const bone = new THREE.Bone();
    bone.name = src.name;
    bone.position.copy(src.position);
    bone.quaternion.copy(src.quaternion);
    bone.scale.copy(src.scale);
    byName.set(src.name, bone);
    for (const child of src.children) if (child.isBone) bone.add(copy(child));
    return bone;
  };
  const roots = rig.group.children.filter((c) => c.isBone).map(copy);
  return { roots, list: rig.bones.map((b) => byName.get(b.name)) };
}

/** Duplicate every triangle with reversed winding and flipped normals (FBX has no double-sided flag). */
export function withBackFaces(geo) {
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const { array, itemSize, count } = attr;
    const doubled = new array.constructor(array.length * 2);
    doubled.set(array);
    for (let v = 0; v < count; v += 1) {
      const corner = v % 3;
      const src = v - corner + (corner === 0 ? 0 : 3 - corner);
      for (let c = 0; c < itemSize; c += 1) {
        const value = array[src * itemSize + c];
        doubled[(count + v) * itemSize + c] = name === 'normal' ? -value : value;
      }
    }
    out.setAttribute(name, new THREE.BufferAttribute(doubled, itemSize, attr.normalized));
  }
  return out;
}

function textureRepeat(m) {
  const t = m.map || m.normalMap || m.emissiveMap || m.roughnessMap;
  return t ? [t.repeat.x, t.repeat.y] : [1, 1];
}

function exportTexture(source) {
  if (!source) return null;
  const t = source.clone();
  t.repeat.set(1, 1);
  t.offset.set(0, 0);
  t.needsUpdate = true;
  return t;
}

/**
 * glTF-safe copy of a preview material: single-sided, texture tiling moved into UVs, colours > 1
 * moved into emissive strength, MeshBasicMaterial turned into an emissive standard material.
 */
function exportMaterial(src, key) {
  let m;
  if (src.isMeshBasicMaterial) {
    m = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1, metalness: 0, emissive: src.color.clone(), emissiveIntensity: 1 });
  } else {
    m = src.clone();
    for (const k of ['map', 'normalMap', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
      if (m[k]) m[k] = exportTexture(src[k]);
    }
  }
  m.name = key;
  m.side = THREE.FrontSide;
  m.vertexColors = true;
  if (m.emissive) {
    const peak = Math.max(m.emissive.r, m.emissive.g, m.emissive.b);
    if (peak > 1) {
      m.emissive.multiplyScalar(1 / peak);
      m.emissiveIntensity *= peak;
    }
  }
  return m;
}

function buildExportGeometry(rig, def, boneIndex) {
  const byKey = new Map();
  const toRig = new THREE.Matrix4().copy(rig.group.matrixWorld).invert();
  const local = new THREE.Matrix4();
  for (const object of rig.meshes) {
    const key = object.userData.matKey;
    const src = def.materials[key];
    let geo = object.geometry.clone();
    if (geo.index) geo = geo.toNonIndexed();
    const n = geo.attributes.position.count;
    const skinIndex = new Uint16Array(n * 4);
    const skinWeight = new Float32Array(n * 4);
    if (object.isSkinnedMesh) {
      const map = object.skeleton.bones.map((b) => boneIndex.get(b.name));
      for (let i = 0; i < n * 4; i += 1) {
        skinWeight[i] = geo.attributes.skinWeight.array[i];
        skinIndex[i] = skinWeight[i] > 0 ? map[geo.attributes.skinIndex.array[i]] : 0;
      }
    } else {
      const index = boneIndex.get(object.parent.name);
      for (let i = 0; i < n; i += 1) {
        skinIndex[i * 4] = index;
        skinWeight[i * 4] = 1;
      }
      local.multiplyMatrices(toRig, object.matrixWorld);
      geo.applyMatrix4(local);
    }
    for (const name of Object.keys(geo.attributes)) if (!ATTRS.includes(name)) geo.deleteAttribute(name);
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
    const [ru, rv] = textureRepeat(src);
    if (ru !== 1 || rv !== 1) {
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * ru, uv.getY(i) * rv);
    }
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(src.side === THREE.DoubleSide ? withBackFaces(geo) : geo);
  }
  const keys = Object.keys(def.materials).filter((k) => byKey.has(k));
  const parts = keys.map((k) => mergeVertices(mergeGeometries(byKey.get(k), false), 1e-5));
  const geometry = mergeGeometries(parts, true);
  geometry.computeTangents();
  const tangent = geometry.attributes.tangent;
  const normal = geometry.attributes.normal;
  const t = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  for (let i = 0; i < tangent.count; i += 1) {
    t.fromBufferAttribute(tangent, i);
    nrm.fromBufferAttribute(normal, i).normalize();
    normal.setXYZ(i, nrm.x, nrm.y, nrm.z);
    t.addScaledVector(nrm, -nrm.dot(t));
    if (t.lengthSq() < 1e-10) t.set(nrm.z, 0, -nrm.x);
    if (t.lengthSq() < 1e-10) t.set(1, 0, 0);
    t.normalize();
    tangent.setXYZW(i, t.x, t.y, t.z, tangent.getW(i) < 0 ? -1 : 1);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, keys };
}

/** Export the creature as a binary GLB (base64) plus the facts the manifest needs. */
export async function exportGLB(rig, def, fps = 30) {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  rig.pose(def, null, 0);
  const { roots, list } = cloneSkeleton(rig);
  const boneIndex = new Map(list.map((b, i) => [b.name, i]));
  const { geometry, keys } = buildExportGeometry(rig, def, boneIndex);
  const mats = keys.map((k) => exportMaterial(def.materials[k], k));
  const mesh = new THREE.SkinnedMesh(geometry, mats);
  mesh.name = `${def.name}_Body`;
  const group = new THREE.Group();
  group.name = def.name;
  group.add(...roots, mesh);
  group.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(list));
  const names = Object.keys(def.clips);
  const baked = names.map((n) => rig.bakeClip(def, n, fps));
  rig.pose(def, null, 0);
  const glb = await new GLTFExporter().parseAsync(group, { binary: true, animations: baked.map((b) => b.clip) });
  const bytes = new Uint8Array(glb);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  // Framing bounds: the posed mesh at frame 0 of the first looping clip (camera framing in Blender/Unity).
  // The bind pose can contain parts that animations hide (e.g. a retracted flame), so it frames badly.
  const frameClip = names.find((n) => def.clips[n].loop) || names[0];
  rig.pose(def, frameClip, 0);
  const frame = new THREE.Box3();
  for (const object of rig.meshes) {
    if (def.shading?.exclude?.includes(object.userData.matKey)) continue;
    frame.expandByObject(object, true);
  }
  rig.pose(def, null, 0);
  const bb = geometry.boundingBox;
  return {
    base64: btoa(binary),
    bones: list.map((b) => ({ name: b.name, parent: b.parent?.isBone ? b.parent.name : null })),
    materials: keys,
    vertices: geometry.attributes.position.count,
    triangles: geometry.index.count / 3,
    bounds: frame.isEmpty() ? { min: bb.min.toArray(), max: bb.max.toArray() } : { min: frame.min.toArray(), max: frame.max.toArray() },
    bindBounds: { min: bb.min.toArray(), max: bb.max.toArray() },
    clips: baked.map((b, i) => {
      const spec = def.clips[names[i]];
      return {
        name: names[i],
        duration: spec.duration,
        frames: b.frames,
        fps,
        loop: Boolean(spec.loop),
        events: Object.fromEntries(Object.entries(spec.events || {}).map(([k, u]) => [k, +(u * spec.duration).toFixed(4)])),
      };
    }),
  };
}
