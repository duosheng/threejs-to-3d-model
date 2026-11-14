// Khronos glTF Validator. Usage: node tools/validate.mjs [file.glb | --baked]  (default: out/<manifest.asset>)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import validator from 'gltf-validator';
import { outDir } from '../server.mjs';

const arg = process.argv[2];
const manifest = () => JSON.parse(readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
const file = arg === '--baked' ? path.join(outDir, manifest().baked.glb.asset) : arg || path.join(outDir, manifest().asset);
const report = await validator.validateBytes(new Uint8Array(readFileSync(file)), { maxIssues: 200 });
const { numErrors, numWarnings, numInfos, numHints, messages } = report.issues;
const { extensionsUsed, animationCount, materialCount, totalTriangleCount, maxInfluences } = report.info;
console.log(path.basename(file), { numErrors, numWarnings, numInfos, numHints, extensionsUsed, animationCount, materialCount, totalTriangleCount, maxInfluences });
for (const m of messages) console.log(['error', 'warning', 'info', 'hint'][m.severity], m.code, m.pointer, m.message);
process.exitCode = numErrors ? 1 : 0;
