// Example creature: a four-legged beetle with a glowing soft tail.
// Replace this file for each new asset; keep the returned definition shape (see the skill's authoring.md).
import {
  THREE, Rig, TAU, smooth, easeIn, wave, mix, place, limb, spike, blob, shell, skinnedTube,
  proceduralTexture, cellular, fbm, clonePose, withPose, timeline, solveTwoBone, gaitStep,
} from './rig-kit.js';

const PAL = { deep: '#14201a', base: '#2c5236', edge: '#9cc46a', tip: '#e6f0b4' };
const BODY_Y = 0.55;
const UPPER = 0.42;
const LOWER = 0.5;
const GAIT = { stride: 0.34, stance: 0.62, lift: 0.14 };
const DURATION = { idle: 2.4, walk: 1.0, attack: 1.2 };

export default function createCreature() {
  const rig = new Rig();

  // ---------------------------------------------------------------- skeleton (meters, +Y up, faces +Z)
  const root = rig.bone('root');
  const body = rig.bone('body', root, [0, BODY_Y, 0]);
  const head = rig.bone('head', body, [0, 0.05, 0.4]);
  const mandL = rig.bone('mandL', head, [0.07, -0.06, 0.14]);
  const mandR = rig.bone('mandR', head, [-0.07, -0.06, 0.14]);
  const abd0 = rig.bone('abd0', body, [0, 0.02, -0.3]);
  const abd1 = rig.bone('abd1', abd0, [0, 0, -0.22]);
  const abd2 = rig.bone('abd2', abd1, [0, 0, -0.2]);

  const legs = [];
  for (const [tag, side, front, hip, foot, phase] of [
    ['L0', 1, true, [0.2, -0.02, 0.18], [0.55, 0, 0.42], 0],
    ['R0', -1, true, [-0.2, -0.02, 0.18], [-0.55, 0, 0.42], 0.5],
    ['L1', 1, false, [0.2, -0.02, -0.14], [0.55, 0, -0.34], 0.5],
    ['R1', -1, false, [-0.2, -0.02, -0.14], [-0.55, 0, -0.34], 0],
  ]) {
    const socket = rig.bone(`socket${tag}`, body, hip);
    const upper = rig.bone(`upper${tag}`, socket);
    const lower = rig.bone(`lower${tag}`, upper, [0, -UPPER, 0]);
    legs.push({
      tag, side, phase,
      foot: new THREE.Vector3(...foot),
      chain: { root: socket, upper, lower, upperLen: UPPER, lowerLen: LOWER, pole: new THREE.Vector3(side * 0.6, 1, front ? 0.25 : -0.25) },
    });
  }

  // ---------------------------------------------------------------- materials
  const chitin = proceduralTexture((u, v) => {
    const [f1, f2] = cellular(u, v, 8, 8, 11);
    const border = smooth((f2 - f1) / 0.15);
    const n = fbm(u, v, 8, 3);
    const shade = 0.62 + 0.3 * n + 0.1 * border;
    return { h: 0.5 * border + 0.3 * n, color: new THREE.Color(shade, shade, shade) };
  }, { repeat: [3, 2], normalStrength: 3 });

  const materials = {
    shell: new THREE.MeshPhysicalMaterial({
      map: chitin.albedo, normalMap: chitin.normal, roughness: 0.5, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.3,
    }),
    horn: new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.05, side: THREE.DoubleSide }),
    sac: new THREE.MeshStandardMaterial({ color: 0x0c2a22, emissive: 0x1fa77a, emissiveIntensity: 0.9, roughness: 0.35 }),
    eye: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.5, 0.15) }),
  };

  // ---------------------------------------------------------------- parts (each in its bone's local space)
  const plate = (t, e) => mix(PAL.deep, PAL.base, 0.4 + 0.6 * Math.cos(e * Math.PI / 2)).lerp(new THREE.Color(PAL.edge), smooth((t - 0.8) / 0.2) * 0.8);
  const hornColor = (t) => mix(PAL.base, PAL.edge, smooth(t * 1.4)).lerp(new THREE.Color(PAL.tip), smooth((t - 0.6) / 0.4));
  const limbColor = (t) => mix(PAL.deep, PAL.base, 0.7).lerp(new THREE.Color(PAL.edge), Math.pow(1 - Math.sin(Math.PI * t), 4) * 0.6);

  rig.part(body, 'shell', place(shell({
    length: 0.72, radius: (t) => 0.3 * Math.pow(Math.sin(Math.PI * t), 0.55), cover: 3.6, keel: 0.12, grooves: 7, dir: -1, color: plate,
  }), [0, 0.03, 0.36]));
  rig.part(body, 'shell', blob(0.26, { scale: [1, 0.55, 1.45], color: (x, y) => mix(PAL.deep, PAL.base, 0.3 + 0.5 * y) }));
  for (const z of [0.16, -0.06, -0.26]) {
    rig.part(body, 'horn', place(spike(0.16, 0.035, { bend: -0.4, axis: 'z', color: hornColor }), [0, 0.3, z], [-0.35, 0, 0]));
  }
  for (const leg of legs) {
    rig.part(leg.chain.root, 'shell', blob(0.06, { color: PAL.base }));
    rig.part(leg.chain.upper, 'shell', limb(UPPER, 0.06, 0.042, { bulge: 0.25, color: limbColor }));
    rig.part(leg.chain.lower, 'horn', limb(LOWER, 0.042, 0.012, { bulge: 0.12, curve: 0.03, color: (t) => hornColor(t * 0.8) }));
  }

  rig.part(head, 'shell', blob(0.16, { scale: [1, 0.82, 1.15], color: (x, y, z) => mix(PAL.deep, PAL.base, 0.45 + 0.4 * y + 0.2 * z) }));
  rig.part(head, 'horn', place(spike(0.3, 0.05, { bend: -0.45, axis: 'z', color: hornColor }), [0, 0.1, 0.06], [-0.9, 0, 0]));
  for (const side of [1, -1]) {
    rig.part(head, 'eye', blob(0.035, { scale: [1, 0.8, 1] }).translate(side * 0.1, 0.05, 0.12));
  }
  for (const [b, side] of [[mandL, 1], [mandR, -1]]) {
    rig.part(b, 'horn', place(spike(0.17, 0.03, { bend: -0.45 * side, color: hornColor }), [0, 0, 0], [Math.PI / 2, 0, 0]));
  }

  rig.skin('sac', [abd0, abd1, abd2], (joints) => {
    const tip = joints[2].clone().add(joints[2].clone().sub(joints[1]).setLength(0.18));
    return skinnedTube([...joints, tip], [0.19, 0.24, 0.17, 0.04], { color: (v) => mix('#ffffff', '#9fd8c0', v) });
  });
  for (const [b, size] of [[abd0, 1], [abd1, 0.85], [abd2, 0.7]]) {
    rig.part(b, 'horn', place(spike(0.13 * size, 0.03, { bend: -0.5, axis: 'z', color: hornColor }), [0, 0.2 * size, -0.1], [-0.6, 0, 0]));
  }

  // ---------------------------------------------------------------- poses
  const rest = {
    body: { p: [0, BODY_Y, 0], r: [-0.03, 0, 0] },
    head: { r: [0.08, 0, 0] },
    mandL: { r: [0, 0.25, 0] },
    mandR: { r: [0, -0.25, 0] },
    abd0: { r: [0.18, 0, 0] },
    abd1: { r: [0.08, 0, 0] },
    abd2: { r: [-0.06, 0, 0] },
  };
  const key = ({ body: [y, z, pitch], head: h, mand, tail }) => withPose(rest, {
    body: { p: [0, BODY_Y + y, z], r: [pitch, 0, 0] },
    head: { r: [h, 0, 0] },
    mandL: { r: [0, mand, 0] },
    mandR: { r: [0, -mand, 0] },
    abd0: { r: [tail[0], 0, 0] },
    abd1: { r: [tail[1], 0, 0] },
    abd2: { r: [tail[2], 0, 0] },
  });
  const WIND = key({ body: [0.08, -0.12, -0.25], head: -0.35, mand: 0.7, tail: [0.45, 0.3, 0.1] });
  const STRIKE = key({ body: [-0.1, 0.18, 0.22], head: 0.35, mand: 0.05, tail: [0.1, 0, -0.15] });
  const HIT = 0.45;

  const clips = {
    idle: {
      label: '待机', duration: DURATION.idle, loop: true,
      pose: (u) => {
        const p = clonePose(rest);
        p.body.p[1] += 0.015 * wave(u);
        p.head.r[1] = 0.12 * wave(u, 1, 1);
        const m = 0.25 + 0.15 * Math.pow(Math.max(0, wave(u, 3)), 4);
        p.mandL.r[1] = m;
        p.mandR.r[1] = -m;
        ['abd0', 'abd1', 'abd2'].forEach((b, i) => { p[b].r[1] = 0.08 * wave(u, 1, -0.7 * i); });
        return p;
      },
    },
    walk: {
      label: '行走', duration: DURATION.walk, loop: true,
      pose: (u) => {
        const p = clonePose(rest);
        p.body.p[1] += 0.02 * Math.cos(2 * TAU * u);
        p.body.r[2] = 0.04 * wave(u);
        p.head.r[1] = -0.06 * wave(u);
        ['abd0', 'abd1', 'abd2'].forEach((b, i) => { p[b].r[1] = 0.12 * wave(u, 1, -0.8 * i); });
        return p;
      },
    },
    attack: {
      label: '扑咬', duration: DURATION.attack, loop: false, events: { hit: HIT },
      pose: timeline([[0, rest], [0.35, WIND], [HIT, STRIKE, easeIn], [0.6, STRIKE], [1, rest]]),
    },
  };

  // Legs are IK: planted on their rest footholds, or stepping through the gait while walking.
  const target = new THREE.Vector3();

  return {
    name: 'demo-beetle',
    title: '示例甲虫',
    rig,
    materials,
    rest,
    clips,
    afterPose(_rig, clip, u) {
      for (const leg of legs) {
        target.copy(leg.foot);
        if (clip === 'walk') {
          const { dz, lift } = gaitStep(u + leg.phase, GAIT);
          target.z += dz;
          target.y += lift;
        }
        solveTwoBone(leg.chain, target);
      }
    },
    checkBones: ['head', 'mandL', 'lowerL0', 'lowerR1', 'abd2'],
    facing: ['head', 'abd2'],
    shots: [
      { clip: 'idle', t: 0.1, view: 'front' },
      { clip: 'attack', t: HIT, view: 'front' },
      { clip: 'walk', t: 0.3, view: 'side' },
    ],
    meta: { walkSpeed: +(GAIT.stride / (GAIT.stance * DURATION.walk)).toFixed(4) },
    notes: ['sac（尾部）与 eye 的自发光强度写在材质里；呼吸灯等动态亮度需引擎端脚本驱动。'],
  };
}
