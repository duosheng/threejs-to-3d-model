// Sample checkBones world positions from the exported GLB at whole frames -> out/reference-samples.json.
// Blender and engine checks compare against this file; whole frames keep interpolation differences out.
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { outDir } from '../server.mjs';
import { withPage } from './browser.mjs';

const SAMPLES = 8;
const manifest = JSON.parse(readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
const fps = manifest.clips[0].fps;

const reference = await withPage('?still=1', (page) => page.evaluate(async ({ asset, bones, samples, fps }) => {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(`/export/${asset}?v=${Date.now()}`);
  const clips = [];
  for (const clip of gltf.animations) {
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    const times = [];
    const positions = [];
    for (let k = 0; k < samples; k += 1) {
      const t = Math.round((clip.duration * fps * k) / (samples - 1)) / fps;
      mixer.setTime(t);
      gltf.scene.updateMatrixWorld(true);
      times.push(t);
      for (const name of bones) positions.push(...gltf.scene.getObjectByName(name).getWorldPosition(new THREE.Vector3()).toArray());
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(gltf.scene);
    clips.push({ name: clip.name, duration: clip.duration, times, positions });
  }
  return { space: 'glTF: +Y up, right-handed, model faces +Z, meters', fps, bones, clips };
}, { asset: manifest.asset, bones: manifest.checkBones, samples: SAMPLES, fps }));

const out = path.join(outDir, 'reference-samples.json');
await writeFile(out, `${JSON.stringify(reference, null, 2)}\n`);
console.log(`reference: ${out} (${reference.clips.map((c) => c.name).join(', ')}; bones ${reference.bones.join(', ')})`);
