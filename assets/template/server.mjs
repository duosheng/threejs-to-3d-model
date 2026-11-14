import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
export const outDir = path.resolve(process.env.RIG_OUT || path.join(root, 'out'));
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
};

function contained(base, relative) {
  const file = path.resolve(base, relative);
  return file.startsWith(`${base}${path.sep}`) ? file : null;
}

function resolveFile(urlPath) {
  if (urlPath === '/' || urlPath === '/index.html') return path.join(root, 'index.html');
  if (urlPath.startsWith('/src/')) return contained(path.join(root, 'src'), urlPath.slice('/src/'.length));
  if (urlPath === '/vendor/three.module.js') return path.join(root, 'node_modules/three/build/three.module.js');
  if (urlPath.startsWith('/vendor/addons/')) {
    return contained(path.join(root, 'node_modules/three/examples/jsm'), urlPath.slice('/vendor/addons/'.length));
  }
  if (urlPath.startsWith('/export/')) return contained(outDir, urlPath.slice('/export/'.length));
  return null;
}

/** Start the preview server; port 0 picks a free port. Resolves to { server, url }. */
export function startServer(port = Number(process.env.PORT || 18780)) {
  const server = http.createServer((request, response) => {
    const urlPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const file = resolveFile(urlPath);
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { url } = await startServer();
  console.log(`preview: ${url}`);
}
