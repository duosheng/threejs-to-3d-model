// Screenshots from real Chrome -> out/screens/.
// SHOTS="idle:0.1:front,attack:0.5:side" overrides the creature's shots; EXTRA="model=glb&glb=x.glb" adds query
// parameters (compare the exported file against the code version); SUFFIX tags file names.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { outDir } from '../server.mjs';
import { withPage } from './browser.mjs';

const dir = path.join(outDir, 'screens');
await mkdir(dir, { recursive: true });
const extra = process.env.EXTRA ? `&${process.env.EXTRA}` : '';
const suffix = process.env.SUFFIX || '';

const files = await withPage(`?still=1${extra}`, async (page) => {
  const info = await page.evaluate(() => window.__rig.info());
  const shots = process.env.SHOTS
    ? process.env.SHOTS.split(',').map((s) => { const [clip, t, view = 'front', zoom] = s.split(':'); return { clip, t: Number(t), view, zoom: zoom && Number(zoom) }; })
    : info.shots;
  const written = [];
  for (const { clip, t, view = 'front', zoom } of shots) {
    await page.goto_(`?still=1&clip=${clip}&t=${t}&view=${view}${zoom ? `&zoom=${zoom}` : ''}${extra}`);
    await page.waitForTimeout(600);
    const file = path.join(dir, `${info.name}-${clip}-${t}-${view}${suffix}.png`);
    await page.screenshot({ path: file });
    written.push(file);
  }
  return written;
});
console.log(files.join('\n'));
console.log('no page errors');
