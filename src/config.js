// Everything that is likely to change between tests lives here. Paths are relative to
// index.html.
const CONFIG = {
  target: 'assets/target.mind',

  animation: {
    src: 'assets/animation.mp4',
    // Optional PNG over the video: white shows the video, black leaves the real print
    // visible. Use it when only part of the picture moves.
    mask: null, // e.g. 'assets/animation-mask.sample.png'
    fade: 0.7, // seconds for the video to appear and to give way to the print
    loopPause: 2, // seconds of the still print before the video plays again
    feather: 0, // 0 to 0.1: softens the border of the video, at the cost of some ghosting
  },

  music: {
    src: 'assets/music.mp3',
    lyrics: 'assets/lyrics.lrc',
    title: '', // used when the .lrc has no [ti:] tag
    offsetMs: 0, // positive shows the lyrics later, negative earlier
    originalLabel: 'PT', // what the switch calls the original text
    // Translations, one entry per language. Each file must have one line for each line of
    // the original, in the same order; its timestamps are ignored, because the original is
    // what is sung and sets the timing. A missing or empty line shows the original there.
    translations: {
      en: { file: 'assets/lyrics.en.lrc', label: 'EN', description: 'Letra traduzida em inglês' },
    },
  },

  // Where the play button sits on the print: 0 to 1 from the left and from the top.
  playButton: { u: 0.79, v: 0.13 },

  // MindAR tuning. null keeps its defaults (warmup 5, miss 5, cutoff 0.001, beta 1000).
  // Higher "miss" keeps the overlay through longer dropouts; higher "beta" and lower
  // "filterMinCF" smooth the motion but add lag.
  tracking: {
    warmupTolerance: null,
    missTolerance: null,
    filterMinCF: null,
    filterBeta: null,
  },
};

// With ?debug in the address, any of these settings can be tried from the URL before being
// written into the file above, which spares a redeploy for every attempt on a phone:
//   ?debug&mask=assets/animation-mask.sample.png&miss=12&u=0.5&v=0.2
const URL_NAMES = {
  'animation.src': 'video',
  'animation.mask': 'mask',
  'animation.fade': 'fade',
  'animation.loopPause': 'loop',
  'animation.feather': 'feather',
  'music.src': 'music',
  'music.lyrics': 'lyrics',
  'music.offsetMs': 'offset',
  'playButton.u': 'u',
  'playButton.v': 'v',
  'tracking.warmupTolerance': 'warmup',
  'tracking.missTolerance': 'miss',
  'tracking.filterMinCF': 'cutoff',
  'tracking.filterBeta': 'beta',
};

const params = new URLSearchParams(location.search);
if (params.has('debug')) {
  for (const [path, name] of Object.entries(URL_NAMES)) {
    if (!params.has(name)) continue;
    const value = params.get(name);
    const [group, key] = path.split('.');
    const number = /^\d*\.?\d+$/.test(value) ? Number(value) : value;
    // Tracking only takes numbers; "none" turns a file setting off.
    if (path.startsWith('tracking.')) {
      if (typeof number === 'number') CONFIG[group][key] = number;
    } else {
      CONFIG[group][key] = value === 'none' ? null : number;
    }
  }
}

export default CONFIG;
