// Entry point: start screen, asset loading, camera problems, the play button and the music.
import CONFIG from './config.js';
import { createKaraoke } from './karaoke.js';
import { createInfoButton } from './info.js';
import { createOverlay } from './overlay.js';
import { alignTranslation, parseLrc } from './lyrics.js';

const DEBUG = new URLSearchParams(location.search).has('debug');
const $ = (id) => document.getElementById(id);
const show = (element) => element.classList.remove('hidden');
const hide = (element) => element.classList.add('hidden');
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const assetUrl = (path) => new URL(path, document.baseURI).href;
const MEDIA_TYPES = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav' };

const ui = {
  camera: $('camera'),
  intro: $('intro'), start: $('start'), progress: $('progress'),
  error: $('error'), errorTitle: $('error-title'), errorText: $('error-text'), errorHint: $('error-hint'), retry: $('retry'),
  hint: $('hint'), hintTitle: $('hint-title'), hintText: $('hint-text'),
  play: $('play'),
  lyrics: $('lyrics'), toggle: $('toggle'),
};

const state = { phase: 'intro', tracking: false, music: 'idle' };
const warnings = []; // things worth knowing but not worth stopping for
let ar;
let stopAR; // halts MindAR at whatever stage it is, once startAR has begun
let overlay;
let video;
let audio;
let karaoke;
let lyricLanguages; // the lyrics in each language the sheet can show
let wantMusic = false; // what the person asked for, so unlocking never pauses a song
let unlocking = false; // the song is playing only to be allowed to play later
let playButtonAt = null;
const audioEvents = []; // what happened to the song, kept for the diagnostics panel
const noteAudio = (type) => {
  if (!DEBUG || !audio) return;
  audioEvents.push(`${type}@${audio.currentTime.toFixed(1)}`);
  if (audioEvents.length > 12) audioEvents.shift();
};

// ---------------------------------------------------------------- where the song is
//
// The browser reports how far the song has got, and that is what the lyrics go by. On
// some phones that reading can stand still while the sound plays, so it is watched: if
// it does not move for a couple of seconds, the time is kept here from that point on.

const now = () => performance.now();
let clockFrom = 0; // song time when the count last stopped (or where the browser says it is)
let clockAt = 0; // when the count (re)started
let counting = false; // the song is playing and the count is running
let ownClock = false; // the browser's reading stood still, so the count is what counts
let reading = 0; // the last reading seen, and when
let readingAt = 0;

function keepTime(event) {
  const at = now();
  if (event === 'playing') {
    if (!ownClock) {
      clockFrom = audio.currentTime || 0;
      reading = clockFrom;
      readingAt = at;
    }
    counting = true;
  } else if (event === 'seeked') {
    ownClock = false; // give the browser's reading a fresh chance from the new position
    clockFrom = audio.currentTime || 0;
    reading = clockFrom;
    readingAt = at;
  } else if (counting) {
    // Paused, waiting or over: stop the count where it is.
    if (ownClock) clockFrom += (at - clockAt) / 1000;
    else clockFrom = audio.currentTime || clockFrom;
    counting = false;
  }
  clockAt = at;
}

function watchClock() {
  if (audio.paused || ownClock) return;
  const at = now();
  if (Math.abs(audio.currentTime - reading) > 0.05) {
    reading = audio.currentTime;
    readingAt = at;
  } else if (at - readingAt > 2000) {
    ownClock = true;
    clockFrom = reading; // where the song was when its reading last moved
    clockAt = readingAt; // and when that was
    noteAudio('reading-still:keeping-time-here');
  }
}

function songTime() {
  if (!ownClock) return audio.paused ? clockFrom : audio.currentTime;
  return counting ? clockFrom + (now() - clockAt) / 1000 : clockFrom;
}

// ---------------------------------------------------------------- loading

// Reads a response piece by piece so the start screen can show how far along it is.
async function readChunks(response, onBytes) {
  if (!response.body?.getReader) return [await response.blob()];
  const chunks = [];
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    chunks.push(value);
    onBytes(value.length);
  }
}

// Downloads everything while the start screen is up. Media is fetched as blobs so phones
// play it whatever their preload rules, and without needing byte-range support from the host.
async function loadAssets() {
  const plan = [
    { key: 'target', url: CONFIG.target, required: true },
    { key: 'video', url: CONFIG.animation.src },
    { key: 'mask', url: CONFIG.animation.mask },
    { key: 'music', url: CONFIG.music.src },
    { key: 'lyrics', url: CONFIG.music.lyrics, text: true },
    ...Object.entries(CONFIG.music.translations).map(([name, { file }]) => ({ key: `lyrics:${name}`, url: file, text: true })),
  ].filter((item) => item.url);
  const loaded = {};
  let received = 0;
  let total = 0;

  await Promise.all(plan.map(async (item) => {
    try {
      const response = await fetch(assetUrl(item.url));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      total += Number(response.headers.get('content-length')) || 0;
      const chunks = await readChunks(response, (bytes) => {
        received += bytes;
        ui.progress.style.transform = `scaleX(${total ? received / total : 0.5})`;
      });
      if (item.text) {
        loaded[item.key] = await new Blob(chunks).text();
      } else {
        const type = item.url.split('.').pop().toLowerCase();
        loaded[item.key] = URL.createObjectURL(new Blob(chunks, { type: MEDIA_TYPES[type] }));
      }
    } catch (error) {
      if (item.required) throw error;
      console.warn(`Skipping ${item.url}: ${error.message}`);
    }
  }));
  return loaded;
}

function createMedia(loaded) {
  if (loaded.video) {
    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.loop = false;
    video.preload = 'auto';
    video.src = loaded.video;
  }
  if (loaded.music) {
    audio = new Audio(loaded.music);
    audio.preload = 'auto';
    // While `unlocking`, the song only plays to be allowed to play later; the play and
    // pause it raises are not the person's choice. The flag drops on that pause event,
    // which the browser delivers only after the unlocking code has finished.
    audio.addEventListener('play', () => {
      noteAudio('play');
      if (!unlocking) setMusic('playing');
    });
    audio.addEventListener('pause', () => {
      noteAudio('pause');
      if (unlocking) {
        unlocking = false;
        return;
      }
      if (!audio.ended) setMusic('paused');
    });
    audio.addEventListener('ended', () => {
      noteAudio('ended');
      setMusic('idle');
    });
    // A second driver for the lyrics, in case the drawing loop ever stops or stalls.
    audio.addEventListener('timeupdate', () => {
      watchClock();
      if (karaoke && !audio.paused) karaoke.update(songTime());
    });
    for (const type of ['playing', 'error', 'stalled', 'waiting', 'suspend', 'abort', 'canplay', 'seeking']) {
      audio.addEventListener(type, () => noteAudio(type));
    }
    // Keep track of where the song is, so that the lyrics can go by this count if the
    // browser's own reading of it stands still.
    for (const type of ['playing', 'pause', 'waiting', 'ended']) audio.addEventListener(type, () => keepTime(type));
    audio.addEventListener('seeked', () => keepTime('seeked'));
  }
  // The sheet doubles as the pause control, so it exists even without lyrics.
  if (loaded.music || loaded.lyrics) {
    const original = parseLrc(loaded.lyrics || '', { offsetMs: CONFIG.music.offsetMs });
    const languages = {
      original: {
        label: CONFIG.music.originalLabel,
        description: 'Letra original',
        title: original.title || CONFIG.music.title,
        lines: original.lines,
      },
    };
    for (const [name, { file, label, description }] of Object.entries(CONFIG.music.translations)) {
      const source = loaded[`lyrics:${name}`];
      if (!source) continue; // missing or failed to load: its switch simply does not appear
      const translation = parseLrc(source);
      const { lines, untranslated } = alignTranslation(original.lines, translation.lines);
      if (untranslated) warnings.push(`A tradução em ${name} (${file}) não cobre ${untranslated} linha(s); nessas aparece a original.`);
      languages[name] = { label, description, title: translation.title || languages.original.title, lines };
    }
    karaoke = createKaraoke(ui.lyrics, { languages });
    lyricLanguages = languages;
  }
}

// ---------------------------------------------------------------- screen states

function setHint(title, text, { busy = false, compact = false } = {}) {
  if (!title) return hide(ui.hint);
  ui.hintTitle.textContent = title;
  ui.hintText.textContent = text;
  ui.hint.classList.toggle('busy', busy);
  ui.hint.classList.toggle('compact', compact);
  show(ui.hint);
}

// The hint depends on two things only: whether the camera is up, and whether the print is
// in view. Everything that changes either one calls this.
function updateHint() {
  if (state.phase === 'starting') {
    return setHint('Abrindo a câmera', 'Se o navegador perguntar, permita o uso da câmera.', { busy: true });
  }
  if (state.phase !== 'running' || state.tracking) return setHint(null);
  if (state.music === 'idle') {
    return setHint('Aponte a câmera para o quadro', 'Centre a imagem inteira na tela, de frente e com boa luz.');
  }
  setHint('Aponte para o quadro para ver a animação', '', { compact: true });
}

function setMusic(music) {
  state.music = music;
  document.body.dataset.music = music;
  ui.lyrics.classList.toggle('hidden', !karaoke || music === 'idle');
  updateHint();
}

function fail({ title, text, hint = '', detail = '' }) {
  state.phase = 'error';
  // Stop tracking too, or the camera keeps running behind the error screen.
  stopAR?.();
  stopAR = null;
  ar = null;
  ui.errorTitle.textContent = title;
  ui.errorText.textContent = text;
  ui.errorHint.textContent = hint;
  ui.errorHint.classList.toggle('hidden', !hint);
  if (detail) console.error(detail);
  hide(ui.intro);
  hide(ui.hint);
  show(ui.error);
}

// ---------------------------------------------------------------- camera problems

const IN_APP = /FBAN|FBOC|Instagram|WhatsApp|Line\/|MicroMessenger|Twitter|; wv[;,)]/i.test(navigator.userAgent);
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const OPEN_IN_BROWSER = IOS
  ? 'Se você abriu o link dentro do Instagram, WhatsApp ou Facebook, toque em ⋯ ou em Compartilhar e escolha “Abrir no Safari”.'
  : 'Se você abriu o link dentro de outro aplicativo, toque no menu ⋮ e escolha “Abrir no navegador”.';

// MindAR gives up without saying why, so ask for the camera once more just to read the error.
async function cameraProblem(cause) {
  if (!window.isSecureContext) {
    return { title: 'A câmera precisa de uma conexão segura', text: 'Esta página só abre a câmera quando o endereço começa com https://.', detail: String(cause) };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { title: 'Este navegador não dá acesso à câmera', text: 'Abra este link no navegador do celular.', hint: IN_APP ? OPEN_IN_BROWSER : '' };
  }
  const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
  if (!gl) {
    return { title: 'Este aparelho não suporta a experiência', text: 'Ele não tem os recursos gráficos de que a câmera precisa.', detail: String(cause) };
  }
  const name = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then((stream) => {
      stream.getTracks().forEach((track) => track.stop());
      return '';
    }, (error) => error.name);
  switch (name) {
    case 'NotAllowedError': case 'PermissionDeniedError': case 'SecurityError':
      return { title: 'O acesso à câmera foi bloqueado', text: 'Permita a câmera para este site nas configurações do navegador e recarregue a página.', hint: IN_APP ? OPEN_IN_BROWSER : '' };
    case 'NotFoundError': case 'DevicesNotFoundError':
      return { title: 'Nenhuma câmera foi encontrada', text: 'Não encontrei uma câmera neste aparelho.' };
    case 'NotReadableError': case 'TrackStartError': case 'AbortError':
      return { title: 'A câmera está ocupada', text: 'Outro aplicativo está usando a câmera. Feche-o e tente de novo.' };
    default:
      return {
        title: 'Não consegui abrir a câmera',
        text: 'Tente de novo. Se persistir, feche os outros aplicativos e reabra o link.',
        detail: `${name || cause}`,
      };
  }
}

// ---------------------------------------------------------------- experience

// Browsers only allow playback after a tap. The start tap unlocks both players, so the
// video can start on its own later, when the print is found.
function unlockMedia() {
  if (video) {
    video.play().then(() => {
      video.pause();
      video.currentTime = 0;
    }).catch(() => {});
  }
  if (audio) {
    // It plays muted for an instant, so the pause that follows must not read as "paused".
    // A camera permission prompt can interrupt that instant on an iPhone, so give up
    // waiting after a few seconds: the song has to end up paused and unmuted either way.
    const unlocked = () => {
      clearTimeout(patience);
      audio.muted = false;
      if (wantMusic) audio.play().catch(() => {});
    };
    unlocking = true;
    audio.muted = true;
    const patience = setTimeout(() => {
      // `unlocking` stays until the pause event clears it, so that this pause is not
      // mistaken for the person pausing a song.
      audio.pause();
      unlocked();
    }, 4000);
    audio.play().then(() => {
      audio.pause();
      audio.currentTime = 0;
      unlocked();
    }, () => {
      unlocking = false;
      unlocked();
    });
  }
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function startExperience(arModule, loaded) {
  state.phase = 'starting';
  hide(ui.intro);
  updateHint();

  try {
    stopAR = arModule.stopAR;
    ar = await withTimeout(arModule.startAR({
      container: ui.camera,
      targetSrc: loaded.target,
      tracking: CONFIG.tracking,
      onFound: () => {
        state.tracking = true;
        updateHint();
        overlay?.start();
      },
      onLost: () => {
        state.tracking = false;
        overlay?.stop();
        hide(ui.play);
        playButtonAt = null;
        updateHint();
      },
    }), 30000, 'opening the camera');
  } catch (error) {
    return fail(await cameraProblem(error));
  }

  // Without the animation the experience is just the play button on the print, so a
  // missing video is not fatal.
  if (video) {
    try {
      overlay = createOverlay({
        video,
        aspect: ar.aspect,
        maskUrl: loaded.mask,
        feather: CONFIG.animation.feather,
        fade: CONFIG.animation.fade,
        loopPause: CONFIG.animation.loopPause,
        onBlocked: () => warnings.push('O navegador recusou tocar o vídeo sem um toque do usuário.'),
      });
    } catch (error) {
      return fail({ title: 'Algo deu errado', text: 'Recarregue a página e tente de novo.', detail: String(error?.stack || error) });
    }
    ar.anchor.group.add(overlay.mesh);

    video.addEventListener('loadedmetadata', () => {
      // The plane is exactly the size of the print, so a video of another shape gets stretched.
      const target = 1 / ar.aspect;
      const ratio = video.videoWidth / video.videoHeight;
      const message = `O vídeo tem proporção ${video.videoWidth}×${video.videoHeight}, diferente da imagem impressa (${(target * 100).toFixed(0)}:100). Ele será esticado sobre o quadro.`;
      if (Math.abs(ratio - target) > target * 0.02) console.warn(message);
    });
  }

  state.phase = 'running';
  updateHint();
  ar.renderer.setAnimationLoop(frame);
}

// ---------------------------------------------------------------- every frame

const faults = {}; // what went wrong in each part of a frame, the first time it did

// Runs one part of a frame so that a failure in it is recorded instead of thrown: the
// drawing loop does not come back from an exception, and that would freeze everything.
function guard(label, action) {
  try {
    action();
  } catch (error) {
    faults[label] ??= String(error?.message || error);
  }
}

let lastFrame = 0;
function frame(now) {
  const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 0;
  lastFrame = now;

  guard('overlay', () => overlay?.update(dt));
  guard('drawing', () => ar.renderer.render(ar.scene, ar.camera));
  guard('button', placePlayButton);
  guard('lyrics', () => {
    if (karaoke && !audio.paused) karaoke.update(songTime());
  });
  debug?.tick(now);
}

function placePlayButton() {
  // Without a song there is nothing for the button to do.
  if (!state.tracking || !audio) return hide(ui.play);
  const point = ar.toScreen(CONFIG.playButton.u, CONFIG.playButton.v);
  if (point.behind) return hide(ui.play);
  // Keep it on screen even when the print is only partly in view.
  const margin = ui.play.offsetWidth / 2 + 10;
  playButtonAt = {
    x: clamp(point.x, margin, ui.camera.clientWidth - margin),
    y: clamp(point.y, margin, ui.camera.clientHeight - margin),
  };
  ui.play.style.transform = `translate(${playButtonAt.x.toFixed(1)}px, ${playButtonAt.y.toFixed(1)}px) translate(-50%, -50%)`;
  show(ui.play);
}

// ---------------------------------------------------------------- music

function toggleMusic() {
  if (!audio) return;
  unlocking = false;
  audio.muted = false; // should already be; never let a half-finished unlock silence the song
  wantMusic = audio.paused;
  if (wantMusic) {
    audio.play().catch((error) => {
      noteAudio(`play-refused:${error?.name || 'error'}`);
    });
  } else {
    audio.pause();
  }
}

// ---------------------------------------------------------------- debug (?debug in the URL)

const debug = DEBUG ? createDebug() : null;
function createDebug() {
  const panel = document.createElement('pre');
  panel.id = 'debug';
  panel.hidden = true; // stays out of the way until it has something to say
  document.body.append(panel);
  let frames = 0;
  let fps = 0;
  let since = 0;

  window.__ar = {
    start: () => ui.start.click(),
    toggleMusic,
    seek: (seconds) => {
      audio.currentTime = Math.max(0, Math.min(seconds, (audio.duration || seconds) - 0.5));
    },
    state: () => ({
      ...state,
      warnings,
      video: video && { time: +video.currentTime.toFixed(2), paused: video.paused, ready: video.readyState, width: video.videoWidth, height: video.videoHeight },
      audio: audio && {
        time: +audio.currentTime.toFixed(2), paused: audio.paused, muted: audio.muted,
        ready: audio.readyState, network: audio.networkState, error: audio.error?.code ?? null,
        duration: +audio.duration?.toFixed?.(2),
        ownClock,
      },
      audioEvents,
      faults,
      overlay: overlay && { opacity: +overlay.opacity.toFixed(2), masked: overlay.masked },
      playButton: playButtonAt && { x: +playButtonAt.x.toFixed(1), y: +playButtonAt.y.toFixed(1) },
      playButtonVisible: !ui.play.classList.contains('hidden'),
      hintVisible: !ui.hint.classList.contains('hidden'),
      lyricsVisible: !ui.lyrics.classList.contains('hidden'),
      line: ui.lyrics.querySelector('.base')?.textContent ?? ui.lyrics.querySelector('.note')?.textContent ?? null,
      activeWord: ui.lyrics.querySelector('.word.active')?.textContent ?? null,
      sungWords: ui.lyrics.querySelectorAll('.word.sung').length,
      lang: karaoke?.language ?? null,
      firstLineAt: lyricLanguages?.original.lines.find((line) => line.text)?.start ?? 0,
      lineIndex: karaoke?.index ?? null,
      lyricsText: lyricLanguages && Object.fromEntries(
        Object.entries(lyricLanguages).map(([name, value]) => [name, value.lines.map((line) => line.text)])),
      languages: [...ui.lyrics.querySelectorAll('.language button')].map((button) => button.dataset.lang),
      fps,
    }),
    // Page pixels of the overlay's corners: top-left, top-right, bottom-right, bottom-left.
    corners: () => {
      if (!ar) return null;
      return [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => {
        const { x, y } = ar.toScreen(u, v);
        return [+x.toFixed(1), +y.toFixed(1)];
      });
    },
  };

  return {
    tick(now) {
      frames++;
      if (!since) {
        since = now; // the first window starts at the first frame, not at page time zero
        return;
      }
      if (now - since < 500) return;
      fps = Math.round((frames * 1000) / (now - since));
      frames = 0;
      since = now;
      const s = window.__ar.state();
      panel.hidden = false;
      panel.textContent = `${s.phase} tracking=${s.tracking} music=${s.music} fps=${fps}\n`
        + `video ${JSON.stringify(s.video)}\noverlay ${JSON.stringify(s.overlay)}\naudio ${JSON.stringify(s.audio)}\n`
        + `button ${JSON.stringify(s.playButton)}\nlyrics #${s.lineIndex} ${JSON.stringify((s.line ?? '').trim())}\n`
        + `events ${s.audioEvents.join(' ')}\n`
        + (Object.keys(s.faults).length ? `faults ${JSON.stringify(s.faults)}\n` : '')
        + warnings.join('\n');
    },
  };
}

// ---------------------------------------------------------------- boot

ui.retry.addEventListener('click', () => location.reload());
createInfoButton(document.querySelector('.info'));
ui.start.addEventListener('click', () => {
  unlockMedia();
  boot.then(({ arModule, loaded }) => startExperience(arModule, loaded)).catch((error) => {
    fail({ title: 'Algo deu errado', text: 'Recarregue a página e tente de novo.', detail: String(error?.stack || error) });
  });
});
ui.play.addEventListener('click', toggleMusic);
ui.toggle.addEventListener('click', toggleMusic);

ui.progress.style.transform = 'scaleX(0)';
const boot = Promise.all([loadAssets(), import('./ar.js')])
  .then(([loaded, arModule]) => ({ loaded, arModule }));
boot.then(({ loaded }) => {
  createMedia(loaded);
  hide(ui.progress);
  ui.start.disabled = false;
  ui.start.textContent = ui.start.dataset.label;
}, (error) => {
  console.error(error);
  fail({
    title: 'Não consegui preparar a experiência',
    text: 'Verifique a conexão com a internet e tente de novo.',
    detail: String(error),
  });
});
