// Local dev server for tweaking the card with DialKit.
//
// Serves the repo root as-is, so every relative asset path in the card
// resolves exactly as it does in production, and injects the DialKit panel
// into index.html on the way out. Nothing is written to the production files.
//
//   node dev/server.js [port]

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2]) || 4321;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.vcf': 'text/vcard',
};

const INJECT = `
<link rel="stylesheet" href="/dev/node_modules/dialkit/dist/styles.css">
<script type="module" src="/dev/panel.js"></script>
`;

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';

    // Contain traversal: resolve, then require the result to stay under ROOT.
    const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(file);
    if (info.isDirectory()) {
      res.writeHead(404).end('Not found');
      return;
    }

    const ext = extname(file);
    let body = await readFile(file);

    if (ext === '.html') {
      body = Buffer.from(body.toString('utf8').replace('</head>', `${INJECT}</head>`));
    }

    res.writeHead(200, {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      // Always fresh: the whole point is seeing edits immediately.
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, '0.0.0.0', () => {
  const nets = Object.values(networkInterfaces()).flat();
  const lan = nets.find((n) => n && n.family === 'IPv4' && !n.internal);
  console.log(`\n  Card dev server\n`);
  console.log(`  local   http://localhost:${PORT}`);
  if (lan) console.log(`  network http://${lan.address}:${PORT}`);
  console.log(`
  Note: the gyroscope needs a secure context. localhost counts, a LAN IP
  does not — on a phone over the network you get the drag fallback only.
  For real tilt testing, use the Vercel preview.
`);
});
