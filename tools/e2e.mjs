// End-to-end check that needs no phone: a headless browser gets a fake camera that shows
// the printed image on a wall, and the test verifies that the overlay lands exactly on it,
// that the play button starts the song, that the lyrics follow along, and that the page
// behaves when the print leaves the camera and comes back.
//
// It exercises the real MindAR pipeline, but under ideal conditions (flat, sharp, well
// lit). Tracking a real print with a real phone still has to be tried by hand.
//
// Usage: node tools/e2e.mjs [--headed] [--shots <dir>] [--dist | --url <address>]
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser, evaluate, sleep, waitFor, withTimeout } from './cdp.mjs';
import { projectRoot, startServer } from './serve.mjs';
import { stage } from './stage.mjs';

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const shotsIndex = args.indexOf('--shots');
const shotsDir = shotsIndex === -1 ? join(tmpdir(), `quadro-ar-shots-${Date.now()}`) : args[shotsIndex + 1];
mkdirSync(shotsDir, { recursive: true });
// What to test: the project as served locally (default), the built copy in dist/ exactly as
// it will be published and served from its own folder (--dist), or a copy already published
// (--url <address>, such as https://user.github.io/repo/).
const urlIndex = args.indexOf('--url');
const published = urlIndex === -1 ? null : args[urlIndex + 1].replace(/\/?$/, '/');
const page = published ? '' : args.includes('--dist') ? '/dist/' : '/';
if (page === '/dist/') stage();

// The fake camera works at 1280x720. Each scene puts the print in the middle of the frame,
// `height` pixels tall; `viewport` is the size of the phone screen it is shown on.
const SCENES = [
  { name: 'landscape', height: 600, viewport: { width: 1280, height: 720 }, loop: true },
  { name: 'portrait', height: 440, viewport: { width: 540, height: 960 } },
  // The print hangs there for 6 s, is gone for 6 s, and so on.
  { name: 'comes-and-goes', height: 600, viewport: { width: 1280, height: 720 }, blink: true },
  // The same, with a mask so that only part of the picture is covered by the video.
  { name: 'masked', height: 600, viewport: { width: 1280, height: 720 }, mask: true, query: '&mask=assets/animation-mask.sample.png' },
];
const FRAME = { width: 1280, height: 720 };
const IMAGE = { width: 1024, height: 1365 }; // assets/target-source.jpg
const PLAY_BUTTON = { u: 0.79, v: 0.13 }; // must match CONFIG.playButton in src/config.js

const results = [];
function check(label, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `   ${detail}` : ''}`);
}

// Where a pixel of the camera frame ends up on the page. MindAR shows the camera the way
// "object-fit: cover" would, scaled until the whole screen is filled.
function frameToScreen(x, y, viewport) {
  const scale = Math.max(viewport.width / FRAME.width, viewport.height / FRAME.height);
  return [
    (x - FRAME.width / 2) * scale + viewport.width / 2,
    (y - FRAME.height / 2) * scale + viewport.height / 2,
  ];
}

// The print's rectangle on the page, as [top-left, top-right, bottom-right, bottom-left].
function expectedCorners(height, viewport) {
  const width = 2 * Math.round(((IMAGE.width / IMAGE.height) * height) / 2); // what ffmpeg's scale=-2 gives
  const left = (FRAME.width - width) / 2;
  const top = (FRAME.height - height) / 2;
  return [[left, top], [left + width, top], [left + width, top + height], [left, top + height]]
    .map(([x, y]) => frameToScreen(x, y, viewport));
}

// A few frames of the print on a plain wall, or of it appearing and disappearing.
function makeCameraFile(file, height, blink) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-framerate', '5', '-i', join(projectRoot, 'assets', 'target-source.jpg'),
    '-f', 'lavfi', '-i', `color=c=0x8a8378:s=${FRAME.width}x${FRAME.height}:r=5`, '-filter_complex',
    `[0:v]scale=-2:${height}[print];[1:v][print]overlay=(W-w)/2:(H-h)/2${blink ? ":enable='lt(mod(t,12),6)'" : ''},format=yuv420p`,
    '-frames:v', blink ? '60' : '3', file]);
}

async function click(client, selector) {
  const point = await evaluate(client, `(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await client.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 });
  }
}

async function shot(client, name) {
  const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
  const file = join(shotsDir, `${name}.png`);
  writeFileSync(file, Buffer.from(data, 'base64'));
}

// Settles once `condition` holds for the page state, and returns that state.
function when(state, condition, label, timeout = 30000) {
  return waitFor(async () => {
    const s = await state();
    // The page can still track after showing an error screen, so look for that first.
    if (s.phase === 'error') {
      throw new Error(`the page showed: ${s.message}`);
    }
    return condition(s) ? s : undefined;
  }, { timeout, interval: 300, label });
}

async function runScene(scene, origin, workDir) {
  const { name, height, viewport } = scene;
  console.log(`\n== ${name}: print ${height}px tall in the camera frame, screen ${viewport.width}x${viewport.height}`);
  const cameraFile = join(workDir, `${name}.y4m`);
  makeCameraFile(cameraFile, height, scene.blink);

  const { client, messages, close } = await launchBrowser({
    url: `${origin}${page}?debug=1${scene.query || ''}`,
    headless: !headed,
    width: viewport.width,
    height: viewport.height,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-video-capture=${cameraFile}`,
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
    ],
  });
  const state = () => evaluate(client, `Object.assign(window.__ar.state(), {
    message: document.getElementById('error').innerText.replace(/\\s+/g, ' ').trim(),
  })`);

  try {
    const landing = await evaluate(client, "document.getElementById('start') ? '' : (document.title || document.body?.innerText || 'an empty page').slice(0, 160)");
    if (landing.trim()) {
      check(`${name}: the address serves the site`, false, `it served "${landing.trim()}" instead`);
      return;
    }
    await shot(client, `${name}-1-start-screen`);
    await waitFor(() => evaluate(client, "document.getElementById('start').disabled ? undefined : true"),
      { timeout: 60000, label: `${name}: the start button to be ready` });
    await click(client, '#start');

    let found;
    try {
      // Tracking can take a while: everything runs on a software GPU in headless mode.
      found = await when(state, (s) => s.tracking, `${name}: the print to be found`, 180000);
    } catch (error) {
      check(`${name}: print found`, false, error.message);
      console.log('  state at failure:', JSON.stringify(await state()));
      for (const message of messages.filter((m) => m.type === 'error' || m.type === 'exception')) {
        console.log(`  console ${message.type}: ${message.text.slice(0, 400)}`);
      }
      await shot(client, `${name}-FAILED`);
      return;
    }
    check(`${name}: print found`, true);

    const corners = await evaluate(client, 'window.__ar.corners()');
    const expected = expectedCorners(height, viewport);
    const error = Math.max(...corners.map(([x, y], i) => Math.hypot(x - expected[i][0], y - expected[i][1])));
    const tolerance = height * (viewport.height / FRAME.height) * 0.025;
    check(`${name}: overlay sits on the print`, error <= tolerance,
      `largest corner error ${error.toFixed(1)}px of ${tolerance.toFixed(0)}px allowed`);
    console.log(`        measured ${JSON.stringify(corners)}\n        expected ${JSON.stringify(expected.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]))}`);

    const playing = await when(state, (s) => s.video?.paused === false && s.overlay.opacity > 0.9, `${name}: the animation to fade in`);
    check(`${name}: animation plays over the print`, true, `${playing.video.width}x${playing.video.height} video`);
    if (scene.mask) check(`${name}: mask is in use`, playing.overlay.masked === true, `masked=${playing.overlay.masked}`);

    const [[leftX, topY], [rightX], , [, bottomY]] = expected;
    const button = {
      x: leftX + (rightX - leftX) * PLAY_BUTTON.u,
      y: topY + (bottomY - topY) * PLAY_BUTTON.v,
    };
    const buttonError = Math.hypot((playing.playButton?.x ?? NaN) - button.x, (playing.playButton?.y ?? NaN) - button.y);
    check(`${name}: play button is on the print`, playing.playButtonVisible && buttonError < height * 0.04,
      `${buttonError.toFixed(1)}px from the configured spot`);

    // Unlocking the song must not look like the person already pressed something.
    check(`${name}: before the first tap, no song and no hint`, playing.music === 'idle' && !playing.lyricsVisible && !playing.hintVisible,
      `music=${playing.music} lyrics=${playing.lyricsVisible} hint=${playing.hintVisible}`);
    await shot(client, `${name}-2-tracking`);

    await click(client, '#play');
    const singing = await when(state, (s) => !s.audio.paused && s.audio.time > 1.3, `${name}: the song to play`, 20000);
    check(`${name}: play starts the song`, true, `${singing.audio.time}s in`);
    check(`${name}: lyrics are on screen`, singing.lyricsVisible && !!singing.line, JSON.stringify(singing.line));
    check(`${name}: words light up as they are sung`, singing.sungWords >= 2 && !!singing.activeWord,
      `${singing.sungWords} sung, now ${JSON.stringify(singing.activeWord)}`);
    check(`${name}: no hint while the print is in view`, !singing.hintVisible);
    await shot(client, `${name}-3-singing`);

    if (scene.blink) {
      const gone = await when(state, (s) => !s.tracking, `${name}: the print to leave the camera`, 30000);
      check(`${name}: animation stops and gives way to the print`, gone.video.paused && gone.overlay.opacity === 0,
        `video ${gone.video.paused ? 'paused' : 'still playing'}, overlay opacity ${gone.overlay.opacity}`);
      check(`${name}: play button hides, hint returns`, !gone.playButtonVisible && gone.hintVisible);
      const kept = await when(state, (s) => s.audio.time > gone.audio.time + 0.5, `${name}: the song to carry on`, 10000);
      check(`${name}: the song carries on without the print`, !kept.audio.paused && kept.lyricsVisible);
      await shot(client, `${name}-4-print-out-of-view`);

      const back = await when(state, (s) => s.tracking && s.video.time > 0.2 && !s.video.paused, `${name}: the print to come back`, 30000);
      check(`${name}: animation restarts from the first frame`, back.video.time < 3 && back.overlay.opacity > 0 && !back.hintVisible,
        `${back.video.time}s into the video, overlay opacity ${back.overlay.opacity}`);
      await shot(client, `${name}-5-back`);
    }

    await click(client, '#toggle');
    const paused = await when(state, (s) => s.audio.paused, `${name}: pausing`, 5000);
    await sleep(500);
    const later = await state();
    check(`${name}: pause stops the song`, later.audio.paused && Math.abs(later.audio.time - paused.audio.time) < 0.05,
      `stopped at ${paused.audio.time}s, still there ${Math.abs(later.audio.time - paused.audio.time).toFixed(2)}s later`);

    if (scene.loop) {
      // The placeholder video is 8 s long: it must fade out and start over on its own.
      await when(state, (s) => s.overlay.opacity === 0, 'the animation to fade out after ending');
      const restarted = await when(state, (s) => s.overlay.opacity > 0.9 && s.video.time < 2, 'the animation to start over');
      check('landscape: animation loops smoothly', true, `restarted while the song was at ${restarted.audio.time}s`);
    }

    const problems = messages.filter((message) => message.type === 'exception' || message.type === 'error');
    check(`${name}: no browser errors`, problems.length === 0, problems.map((problem) => problem.text).join(' | ').slice(0, 300));
    for (const warning of messages.filter((message) => message.type === 'warning')) {
      console.log(`        console warning: ${warning.text.slice(0, 200)}`);
    }
  } finally {
    await close();
  }
}

const workDir = mkdtempSync(join(tmpdir(), 'quadro-ar-e2e-'));
const server = published ? null : await startServer();
try {
  for (const scene of SCENES) {
    await withTimeout(runScene(scene, published ?? server.origin, workDir), 360000, `${scene.name} scene`);
  }
} finally {
  if (server) await server.close();
  rmSync(workDir, { recursive: true, force: true });
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed} of ${results.length} checks passed. Screenshots in ${shotsDir}`);
process.exit(failed ? 1 : 0);
