import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { projectRoot, startServer } from '../tools/serve.mjs';

let server;
let origin;
let scratch;

// Sends the path exactly as given, so "../" is not normalised away before it reaches the server.
const rawStatus = (url) => new Promise((done, fail) => {
  const req = request(url, (response) => {
    response.resume();
    response.on('end', () => done(response.statusCode));
  });
  req.on('error', fail);
  req.end();
});

before(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'quadro-ar-serve-'));
  writeFileSync(join(scratch, 'index.html'), '<h1>hi</h1>');
  writeFileSync(join(scratch, 'clip.mp4'), Buffer.alloc(1000, 7));
  writeFileSync(join(scratch, 'notafolder'), '');
  server = await startServer({ root: scratch });
  origin = server.origin;
});

after(async () => {
  await server.close();
  rmSync(scratch, { recursive: true, force: true });
});

test('the root serves index.html', async () => {
  const response = await fetch(`${origin}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.equal(await response.text(), '<h1>hi</h1>');
});

test('gives media the type browsers need', async () => {
  const response = await fetch(`${origin}/clip.mp4`);
  assert.equal(response.headers.get('content-type'), 'video/mp4');
});

test('serves byte ranges, which Safari requires from audio and video', async () => {
  const part = await fetch(`${origin}/clip.mp4`, { headers: { Range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 100-199/1000');
  assert.equal((await part.arrayBuffer()).byteLength, 100);

  const rest = await fetch(`${origin}/clip.mp4`, { headers: { Range: 'bytes=900-' } });
  assert.equal(rest.status, 206);
  assert.equal((await rest.arrayBuffer()).byteLength, 100);

  assert.equal((await fetch(`${origin}/clip.mp4`, { headers: { Range: 'bytes=5000-' } })).status, 416);
});

test('answers 404 for what is missing', async () => {
  assert.equal((await fetch(`${origin}/nope.js`)).status, 404);
  assert.equal((await fetch(`${origin}/notafolder/x.js`)).status, 404);
});

test('refuses to serve files outside its root', async () => {
  assert.equal(await rawStatus(`${origin}/..%2F..%2Fsecret.txt`), 403);
  assert.equal(await rawStatus(`${origin}/..%5C..%5Csecret.txt`), 403);
});

test('serves the real project: the page, its script, the target, the media and the libraries', async () => {
  const real = await startServer();
  try {
    const paths = ['/', '/src/main.js', '/src/style.css', '/assets/target.mind', '/assets/animation.mp4',
      '/assets/music.mp3', '/assets/lyrics.lrc', '/assets/thumb.jpg',
      '/vendor/three/three.module.js', '/vendor/three/addons/renderers/CSS3DRenderer.js',
      '/vendor/mind-ar/mindar-image-three.prod.js'];
    const missing = [];
    for (const path of paths) {
      const response = await fetch(`${real.origin}${path}`);
      if (response.status !== 200) missing.push(`${path} (${response.status})`);
      await response.arrayBuffer();
    }
    assert.deepEqual(missing, []);
  } finally {
    await real.close();
  }
  assert.ok(projectRoot.endsWith('AR'));
});
