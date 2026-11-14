// Run a Blender step headless: node tools/blender.mjs convert|bake [textureSize]
// Finds Blender via $BLENDER, then PATH, then /Applications/Blender.app.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { outDir } from '../server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [step, ...rest] = process.argv.slice(2);
if (!['convert', 'bake'].includes(step)) throw new Error('usage: node tools/blender.mjs convert|bake [textureSize]');

function findBlender() {
  if (process.env.BLENDER) return process.env.BLENDER;
  const which = spawnSync('which', ['blender'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  const app = '/Applications/Blender.app/Contents/MacOS/Blender';
  if (existsSync(app)) return app;
  throw new Error('Blender not found; set BLENDER=/path/to/blender (4.2+ required)');
}

const manifest = JSON.parse(readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
const glb = path.join(outDir, manifest.asset);
const script = path.resolve(here, '../blender', `${step}.py`);
const run = spawnSync(findBlender(), ['-b', '--factory-startup', '-P', script, '--', glb, outDir, ...rest], { stdio: 'inherit' });
if (run.status !== 0) process.exit(run.status ?? 1);
