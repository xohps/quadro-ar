// LRC parsing and the timing math behind the karaoke highlight. No DOM here, so this is
// covered by plain Node tests (test/lyrics.test.mjs).
//
// A parsed file looks like:
//   { title, lines: [{ start, end, text, words: [{ text, start }] }] }
// where `end` is when the highlight finishes (the next line or an estimate of the singing
// time) and each word keeps its trailing space.

const TIME = '\\[(\\d{1,3}):(\\d{1,2})(?:[.:](\\d{1,3}))?\\]';
const LEADING_TAG = new RegExp(`^${TIME}`);
const INLINE_TAG = new RegExp(TIME, 'g');
const META = /^\[(ti|ar|al|by|re|ve|offset):(.*)\]$/i;
// Singing speed assumed for a line that carries a single timestamp: about ten
// characters per second, so a long instrumental gap does not stretch the highlight.
const SECONDS_PER_CHAR = 0.1;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const tagSeconds = (match) => {
  const fraction = (match[3] || '0').padEnd(3, '0');
  return 60 * Number(match[1]) + Number(match[2]) + Number(fraction) / 1000;
};

// Splits "word word " into tokens that keep their trailing whitespace.
const tokenize = (text) => text.match(/\S+\s*|\s+/g) || [];

// Splits `text` into words spread evenly from `start` to `end`, each getting a share of
// the time proportional to its length.
export function spreadWords(text, start, end) {
  const words = tokenize(text);
  const total = words.reduce((sum, word) => sum + word.length, 0) || 1;
  let used = 0;
  return words.map((word) => {
    const at = start + ((end - start) * used) / total;
    used += word.length;
    return { text: word, start: at };
  });
}

// `body` is the line without its leading timestamps. In the "enhanced" format it carries
// a timestamp before each word; text ahead of the first one is timed at `wordStart`.
function buildLine(start, wordStart, body, shift) {
  const words = [];
  let cursor = 0;
  let time = wordStart;
  const add = (text) => words.push(...tokenize(text).map((word) => ({ text: word, start: time })));
  for (const match of body.matchAll(INLINE_TAG)) {
    add(body.slice(cursor, match.index));
    time = tagSeconds(match) + shift;
    cursor = match.index + match[0].length;
  }
  add(body.slice(cursor));
  return { start, end: Infinity, text: words.map((word) => word.text).join('').trim(), words };
}

export function parseLrc(source, { offsetMs = 0, keepEmpty = false } = {}) {
  let shift = offsetMs / 1000;
  let title = '';
  const lines = [];

  for (const raw of source.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    const meta = META.exec(line);
    if (meta) {
      const [, key, value] = meta;
      if (key.toLowerCase() === 'ti') title = value.trim();
      // In LRC, a positive offset shows the lyrics earlier.
      if (key.toLowerCase() === 'offset') shift -= Number(value) / 1000 || 0;
      continue;
    }

    // Timestamps in front of the line. Several mean the same words repeat, except that
    // in the enhanced format the last one is the timestamp of the first word.
    const starts = [];
    let body = line;
    for (let match; (match = LEADING_TAG.exec(body));) {
      starts.push(tagSeconds(match) + shift);
      body = body.slice(match[0].length);
    }
    if (!starts.length) continue;
    if (!body.trim()) {
      // A timed line with no words marks a gap. Lyrics skip it; a translation keeps it, so
      // that its lines stay lined up with the original's.
      if (keepEmpty) for (const start of starts) lines.push({ start, end: start, text: '', words: [] });
      continue;
    }
    // `search` ignores the lastIndex that a global regex would carry between lines.
    const wordStart = body.search(INLINE_TAG) !== -1 && starts.length > 1 ? starts.pop() : undefined;
    for (const start of starts) lines.push(buildLine(start, wordStart ?? start, body, shift));
  }

  lines.sort((a, b) => a.start - b.start);
  lines.forEach((line, index) => {
    const next = lines[index + 1]?.start ?? Infinity;
    line.end = Math.min(next, line.start + line.text.length * SECONDS_PER_CHAR);
    if (line.words.length > 1 && line.words.every((word) => word.start === line.start)) {
      // One timestamp for the whole line: spread the words by their length.
      line.words = spreadWords(line.text, line.start, line.end);
    }
  });
  return { title, lines };
}

// Index of the line being sung at `time`, or -1 before the first one.
export function activeIndex(lines, time) {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].start <= time) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

// Which word of `line` is being sung at `time`, and how much of it is done (0 to 1).
export function wordAt(line, time) {
  const { words } = line;
  if (time < words[0].start) return { index: -1, fraction: 0 };
  let index = words.length - 1;
  while (index > 0 && words[index].start > time) index--;
  const until = words[index + 1]?.start ?? Math.min(line.end, words[index].start + 2);
  return { index, fraction: clamp((time - words[index].start) / Math.max(until - words[index].start, 0.001), 0, 1) };
}

// Pairs a translation with the original, line by line and in order. A translated line takes
// the timing of the original, since the original is what is being sung: it appears when
// that line is sung, and its words light up at a reading pace. A line with no translation
// keeps the original words, so nothing goes missing. Tells how many lines those were.
export function alignTranslation(original, translated) {
  const lines = original.map((line, index) => {
    const text = translated[index]?.text;
    return text ? { start: line.start, end: line.end, text, words: spreadWords(text, line.start, line.end) } : line;
  });
  return { lines, untranslated: original.filter((_, index) => !translated[index]?.text).length };
}
