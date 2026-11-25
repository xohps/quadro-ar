// Zero-dependency static server for local testing. http://localhost is a secure context,
// so the camera works on this machine without HTTPS; phones still need an HTTPS URL.
//
// Usage: node tools/serve.mjs [port] [--lan]
//   --lan  also answer other devices on the network (see the README before using a phone)
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.lrc': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
};

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function sendFile(req, res, file) {
  const { size } = statSync(file);
  const headers = {
    'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (!range) {
    res.writeHead(200, { ...headers, 'Content-Length': size });
    return req.method === 'HEAD' ? res.end() : createReadStream(file).pipe(res);
  }
  // Browsers ask for pieces of audio and video; Safari refuses to play at all without this.
  const start = range[1] === '' ? Math.max(size - Number(range[2]), 0) : Number(range[1]);
  const end = range[1] === '' || range[2] === '' ? size - 1 : Math.min(Number(range[2]), size - 1);
  if (start > end || start >= size) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` });
    return res.end();
  }
  res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file, { start, end }).pipe(res);
}

function createHandler(base) {
  return (req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400);
      return res.end('Bad request');
    }
    let file = resolve(base, '.' + pathname);
    if (file !== base && !file.startsWith(base + sep)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      return sendFile(req, res, file);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
  };
}

export function startServer({ root = projectRoot, port = 0, host = '127.0.0.1' } = {}) {
  const server = createServer(createHandler(resolve(root)));
  return new Promise((resolvePromise, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      const actualPort = server.address().port;
      resolvePromise({
        server,
        port: actualPort,
        origin: `http://${host}:${actualPort}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lan = process.argv.includes('--lan');
  const port = Number(process.argv.slice(2).find((arg) => /^\d+$/.test(arg)) || 8080);
  // "localhost" alone is not enough: Node binds it to one address family only (IPv6 on
  // this machine), and http://127.0.0.1 would then be refused. Listen on both loopbacks.
  const started = [];
  let failure;
  for (const host of lan ? ['0.0.0.0'] : ['127.0.0.1', '::1']) {
    try {
      started.push(await startServer({ port, host }));
    } catch (error) {
      failure = error;
      // A port already taken means another copy is serving; leave it alone and say so.
      if (error.code === 'EADDRINUSE') break;
    }
  }
  const inUse = failure?.code === 'EADDRINUSE';
  if (!started.length || inUse) {
    await Promise.all(started.map((running) => running.close()));
    console.error(inUse
      ? `Port ${port} is already in use, probably by another copy of this server. Try another: node tools/serve.mjs ${port + 1}`
      : failure.message);
    process.exit(1);
  }

  const actualPort = started[0].port;
  console.log(`Serving ${projectRoot}\n  keep this window open; Ctrl+C stops the server\n  http://localhost:${actualPort}`);
  if (lan) {
    const others = Object.values(networkInterfaces()).flat().filter((address) => address?.family === 'IPv4' && !address.internal);
    for (const { address } of others) console.log(`  http://${address}:${actualPort}  (other devices on this network)`);
  }
}
