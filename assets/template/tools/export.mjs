// Export out/<name>.glb + out/manifest.json from the creature running in real Chrome.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { outDir } from '../server.mjs';
import { withPage } from './browser.mjs';

const { info, result } = await withPage('?still=1', async (page) => page.evaluate(async () => ({
  info: window.__rig.info(),
  result: await window.__rig.exportGLB(),
})));

const { base64, ...facts } = result;
const glb = Buffer.from(base64, 'base64');
const asset = `${info.name}.glb`;
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, asset), glb);

const missing = [...info.checkBones, ...info.facing].filter((b) => !info.bones.includes(b));
if (missing.length) throw new Error(`checkBones/facing name unknown bones: ${missing.join(', ')}`);

const manifest = {
  asset,
  name: info.name,
  title: info.title,
  sha256: createHash('sha256').update(glb).digest('hex'),
  bytes: glb.length,
  units: 'meter, +Y up, faces +Z (glTF)',
  generator: 'src/creature.js via rig-kit exportGLB (three GLTFExporter)',
  ...facts,
  checkBones: info.checkBones,
  facing: info.facing,
  shots: info.shots,
  meta: info.meta,
  runtimeNotes: [
    'IK 已逐帧烘焙进骨骼旋转，引擎端无需 IK。',
    '行走类循环动画为原地动画；需要位移时由引擎按 meta 中的速度移动根节点。',
    'clips[].events 是动画事件时刻（秒），用于伤害判定、音效或特效。',
    ...info.notes,
  ],
};
await writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({
  out: path.join(outDir, asset), bytes: manifest.bytes, sha256: manifest.sha256, vertices: facts.vertices, triangles: facts.triangles,
  bones: facts.bones.length, materials: facts.materials, clips: facts.clips.map((c) => `${c.name}:${c.frames}f${c.loop ? ' loop' : ''}`),
}, null, 2));
