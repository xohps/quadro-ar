// Compiles an image into the .mind file that MindAR tracks, using the browser headlessly.
// Run it again whenever the printed image changes.
//
// Usage: node tools/compile-target.mjs [image] [out]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { launchBrowser, evaluate, withTimeout } from './cdp.mjs';
import { projectRoot, startServer } from './serve.mjs';

const image = resolve(process.argv[2] || 'assets/target-source.jpg');
const out = resolve(process.argv[3] || 'assets/target.mind');
const maxSide = Number(process.env.TARGET_MAX_SIDE || 1024);

const insideRoot = projectRoot + sep;
if (!image.startsWith(insideRoot)) {
  console.error(`The image must be inside ${projectRoot}. Copy it there and try again.`);
  process.exit(1);
}

const server = await startServer();
let browser;
try {
  // Root-relative, because the compile page lives under /tools/.
  const imageUrl = '/' + relative(projectRoot, image).split(sep).join('/');
  const page = `${server.origin}/tools/compile.html?image=${encodeURIComponent(imageUrl)}&max=${maxSide}`;
  browser = await launchBrowser({ url: page, width: 900, height: 1000 });

  const result = await withTimeout(evaluate(browser.client, 'window.__compile'), 600000, 'compiling the image');
  if (!result) throw new Error(`The compile page did not start.\n${browser.messages.map((m) => m.text).join('\n')}`);
  if (!result.ok) throw new Error(result.error);

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(result.base64, 'base64'));
  console.log(`Compiled ${relative(projectRoot, image)} into ${relative(projectRoot, out)}`);
  console.log(`  ${result.width} × ${result.height} px, ${result.points} tracking points, ${(result.bytes / 1024).toFixed(0)} KB`);
} catch (error) {
  console.error(`Compilation failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await server.close();
}
process.exit(process.exitCode || 0);
