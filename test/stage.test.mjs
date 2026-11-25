import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { checkImports, stage } from '../tools/stage.mjs';

let out;

before(() => {
  out = stage({ out: join(mkdtempSync(join(tmpdir(), 'quadro-ar-stage-')), 'site') });
});

after(() => {
  rmSync(join(out, '..'), { recursive: true, force: true });
});

test('builds the pages, the code, the assets and the libraries', () => {
  for (const path of ['index.html', 'robots.txt', 'src/main.js', 'src/style.css', 'assets/target.mind', 'assets/animation.mp4',
    'assets/music.mp3', 'assets/lyrics.lrc', 'assets/thumb.jpg', 'vendor/three/three.module.js',
    'vendor/three/addons/renderers/CSS3DRenderer.js', 'vendor/mind-ar/mindar-image-three.prod.js']) {
    assert.ok(existsSync(join(out, path)), `${path} is missing from the build`);
  }
});

test('leaves out what the site does not need', () => {
  assert.ok(!existsSync(join(out, 'assets/target-source.jpg')), 'the print master is not published');
  assert.ok(!existsSync(join(out, 'vendor/mind-ar/mindar-image.prod.js')), 'the compile-only build is not published');
  assert.ok(!existsSync(join(out, 'tools')), 'the tools are not published');
  assert.ok(!existsSync(join(out, 'test')), 'the tests are not published');
});

test('every file the page reaches is in the build, following static and dynamic imports', () => {
  const { missing, reached } = checkImports(out);
  assert.deepEqual(missing, []);
  const reachedPaths = [...reached].map((file) => file.slice(out.length).split('\\').join('/'));
  // index.html, its stylesheet, script and thumbnail, the five modules of src/ (ar.js is
  // a dynamic import), the three MindAR files and the two three.js files.
  for (const path of ['index.html', 'src/style.css', 'assets/thumb.jpg', 'src/main.js', 'src/ar.js', 'src/overlay.js',
    'src/config.js', 'src/lyrics.js', 'src/karaoke.js', 'vendor/mind-ar/mindar-image-three.prod.js',
    'vendor/mind-ar/controller-mGt1s8dJ.js', 'vendor/mind-ar/ui-fBadYuor.js',
    'vendor/three/addons/renderers/CSS3DRenderer.js', 'vendor/three/three.module.js']) {
    assert.ok(reachedPaths.some((file) => file.endsWith(path)), `${path} is not reached from index.html`);
  }
});

test('the check fails when a needed library file is missing', () => {
  unlinkSync(join(out, 'vendor', 'mind-ar', 'controller-mGt1s8dJ.js'));
  const { missing } = checkImports(out);
  assert.equal(missing.length, 1);
  assert.match(missing[0], /vendor\/mind-ar\/mindar-image-three\.prod\.js asks for \.\/controller-mGt1s8dJ\.js/);
});

test('the check fails when the dynamically imported module is missing', () => {
  const fresh = stage({ out: join(mkdtempSync(join(tmpdir(), 'quadro-ar-stage-')), 'site') });
  try {
    unlinkSync(join(fresh, 'src', 'ar.js'));
    const { missing } = checkImports(fresh);
    assert.equal(missing.length, 1);
    assert.match(missing[0], /src\/main\.js asks for \.\/ar\.js/);
  } finally {
    rmSync(join(fresh, '..'), { recursive: true, force: true });
  }
});

test('the check fails when a configured asset is missing', () => {
  const fresh = stage({ out: join(mkdtempSync(join(tmpdir(), 'quadro-ar-stage-')), 'site') });
  try {
    unlinkSync(join(fresh, 'assets', 'lyrics.lrc'));
    const { missing } = checkImports(fresh);
    assert.equal(missing.length, 1);
    assert.match(missing[0], /src\/config\.js asks for assets\/lyrics\.lrc/);
  } finally {
    rmSync(join(fresh, '..'), { recursive: true, force: true });
  }
});
