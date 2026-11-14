// Generic preview page: renders the creature, plays its clips, and exposes window.__rig for the
// export/reference/screenshot tools. Clips are baked from the same pose functions the exporter uses,
// so the preview matches the exported animation frame for frame.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { exportGLB } from './rig-kit.js';
import { buildStage, gradePass } from './stage.js';
import createCreature from './creature.js';

const PREVIEW_FPS = 60;
const EXPORT_FPS = 30;
const params = new URLSearchParams(location.search);

const def = createCreature();
const { rig } = def;
rig.finalize(def);
const clipNames = Object.keys(def.clips);
const loops = clipNames.filter((n) => def.clips[n].loop);
const defaultClip = loops[0] || clipNames[0];

// ---------------------------------------------------------------- scene

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(rig.group);

// Frame the creature as the first looping clip shows it (the bind pose may contain hidden parts).
rig.pose(def, defaultClip, 0);
const bindBox = new THREE.Box3();
for (const m of rig.meshes) if (!def.shading?.exclude?.includes(m.userData.matKey)) bindBox.expandByObject(m, true);
rig.pose(def, null, 0);
const size = bindBox.getSize(new THREE.Vector3());
const center = bindBox.getCenter(new THREE.Vector3());
const extent = Math.max(size.x, size.y, size.z);

const stage = buildStage(params.get('stage') || def.preview?.stage, { scene, renderer, extent, def });
renderer.toneMappingExposure = stage.exposure;

const camera = new THREE.PerspectiveCamera(stage.fov, 1, extent * 0.02, extent * 80);
const controls = new OrbitControls(camera, renderer.domElement);
const view = (name) => {
  const dir = new THREE.Vector3(...(stage.views[name] || stage.views.front));
  // ?zoom=2 moves closer; ?target=x,y,z overrides the look-at point (close-up shots).
  const zoom = Number(params.get('zoom') || 1);
  const focus = params.get('target') ? new THREE.Vector3(...params.get('target').split(',').map(Number)) : center;
  camera.position.copy(focus).addScaledVector(dir.normalize(), (extent * stage.distance) / zoom);
  controls.target.copy(focus);
  controls.update();
};
view(params.get('view') || 'front');
controls.enableDamping = !params.has('still');
controls.enablePan = false;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, 1280, 720);
gtao.updateGtaoMaterial({ radius: extent * 0.06, distanceExponent: 1.6, thickness: extent * 0.04, scale: 1.2 });
gtao.blendIntensity = 0.85;
composer.addPass(gtao);
composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), ...stage.bloom));
composer.addPass(new OutputPass());
const grade = stage.grade ? gradePass() : null;
if (grade) composer.addPass(grade);

// ---------------------------------------------------------------- clips

const mixer = new THREE.AnimationMixer(rig.group);
const actions = {};
for (const name of clipNames) {
  const action = mixer.clipAction(rig.bakeClip(def, name, PREVIEW_FPS).clip);
  if (!def.clips[name].loop) {
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
  }
  actions[name] = action;
}
rig.pose(def, null, 0);
let current = defaultClip;
let baseLoop = defaultClip;
actions[current].play();

const nav = document.getElementById('clips');
for (const [i, name] of clipNames.entries()) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.clip = name;
  button.textContent = `${i + 1} · ${def.clips[name].label || name}`;
  button.addEventListener('click', () => play(name));
  nav.appendChild(button);
}
function setPressed(name) {
  for (const b of nav.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.clip === name));
}
setPressed(current);
addEventListener('keydown', (e) => {
  const i = Number(e.key) - 1;
  if (i >= 0 && i < clipNames.length) play(clipNames[i]);
});

function play(name) {
  if (name === current && def.clips[name].loop) return;
  const next = actions[name];
  const prev = actions[current];
  next.reset();
  next.setEffectiveWeight(1);
  next.play();
  if (prev !== next) prev.crossFadeTo(next, def.clips[name].loop ? 0.25 : 0.12, false);
  current = name;
  if (def.clips[name].loop) baseLoop = name;
  setPressed(name);
}
mixer.addEventListener('finished', (event) => {
  if (!def.clips[current].loop && event.action === actions[current]) play(baseLoop);
});

const freeze = params.get('clip');
if (freeze && actions[freeze]) {
  for (const a of Object.values(actions)) a.stop();
  const action = actions[freeze];
  action.play();
  action.time = Number(params.get('t') || 0) * def.clips[freeze].duration;
  action.paused = true;
  current = freeze;
  setPressed(freeze);
}

document.getElementById('title').textContent = def.title || def.name;
document.getElementById('stats').textContent = `${rig.bones.length} 骨骼 · ${clipNames.length} 动画`;
document.title = `${def.title || def.name} · 骨骼动画预览`;

// ---------------------------------------------------------------- GLB read-back

let glbView = null;
if (params.get('model') === 'glb') {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const file = params.get('glb') || `${def.name}.glb`;
  const gltf = await new GLTFLoader().loadAsync(`/export/${encodeURIComponent(file)}?v=${Date.now()}`);
  for (const m of rig.meshes) m.visible = false;
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false;
  });
  scene.add(gltf.scene);
  const glbMixer = new THREE.AnimationMixer(gltf.scene);
  const glbActions = Object.fromEntries(gltf.animations.map((clip) => [clip.name, glbMixer.clipAction(clip)]));
  for (const action of Object.values(glbActions)) action.play();
  glbView = { mixer: glbMixer, actions: glbActions };
  document.getElementById('stats').textContent += ' · GLB 回读';
}

// ---------------------------------------------------------------- tool API

window.__rig = {
  info: () => ({
    name: def.name,
    title: def.title || def.name,
    bones: rig.bones.map((b) => b.name),
    clips: clipNames,
    checkBones: def.checkBones,
    facing: def.facing,
    shots: def.shots || clipNames.slice(0, 4).map((clip) => ({ clip, t: 0.3, view: 'front' })),
    meta: def.meta || {},
    notes: def.notes || [],
  }),
  exportGLB: () => exportGLB(rig, def, EXPORT_FPS),
};

// ---------------------------------------------------------------- loop

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  mixer.update(dt);
  if (glbView) {
    for (const [name, action] of Object.entries(glbView.actions)) {
      const source = actions[name];
      if (!source) continue;
      action.time = source.time;
      action.setEffectiveWeight(source.isScheduled() ? source.getEffectiveWeight() : 0);
    }
    glbView.mixer.update(0);
  }
  if (def.onFrame) def.onFrame({ time: clock.elapsedTime, clip: current, actions });
  controls.update();
  if (grade) grade.uniforms.uTime.value = params.has('still') ? 0 : clock.elapsedTime;
  composer.render(dt);
  if (!document.body.classList.contains('ready')) document.body.classList.add('ready');
  requestAnimationFrame(frame);
}

function resize() {
  const w = innerWidth;
  const h = Math.max(innerHeight, 1);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
}
addEventListener('resize', resize);
resize();
frame();
