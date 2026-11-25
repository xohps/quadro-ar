import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeIndex, parseLrc, wordAt } from '../src/lyrics.js';

const sample = parseLrc(`
[ti:Song title]
[ar:Someone]
[00:01.50]First line here
[00:04][00:20.250]Repeated line

[00:07.00][00:07.00]Two [00:07.50]words [00:08.25]timed
`);
// Lines come out sorted by time: First (1.5), Repeated (4), Two words timed (7), Repeated (20.25).
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not about ${expected}`);

test('reads the title and skips metadata and blank lines', () => {
  assert.equal(sample.title, 'Song title');
  assert.deepEqual(sample.lines.map((line) => line.text), [
    'First line here', 'Repeated line', 'Two words timed', 'Repeated line',
  ]);
});

test('accepts centiseconds, milliseconds and a missing fraction', () => {
  const starts = sample.lines.map((line) => line.start);
  assert.deepEqual(starts.slice(0, 3), [1.5, 4, 7]);
  near(starts[3], 20.25);
});

test('a line ends at the next one, or after an estimated singing time', () => {
  const [first, , timed, last] = sample.lines;
  // "First line here" is 15 characters: 1.5 s of singing ends well before the line at 4 s.
  assert.equal(first.end, 3);
  // "Two words timed" is timed by word, so its last word ends when the estimate says so.
  assert.equal(timed.end, 8.5);
  near(last.end, 20.25 + 13 * 0.1);
});

test('a line never outlives the next one', () => {
  const { lines } = parseLrc('[00:01.00]A very long line that would take ages to sing\n[00:02.00]Next');
  assert.equal(lines[0].end, 2);
  assert.ok(lines[0].words.at(-1).start < 2);
});

test('words of a single-timestamp line are spread by length', () => {
  const { words } = sample.lines[0];
  assert.deepEqual(words.map((word) => word.text), ['First ', 'line ', 'here']);
  assert.ok(words[0].start < words[1].start && words[1].start < words[2].start);
  assert.ok(words[2].start < sample.lines[0].end);
});

test('enhanced LRC: the second leading tag times the first word', () => {
  const line = sample.lines[2];
  assert.equal(line.start, 7);
  assert.deepEqual(line.words.map(({ text, start }) => [text, start]), [
    ['Two ', 7], ['words ', 7.5], ['timed', 8.25],
  ]);
});

test('a word timestamp before the second word is honoured without a leading pair', () => {
  const { lines } = parseLrc('[00:10.00]Hello [00:10.50]world');
  assert.deepEqual(lines[0].words.map(({ text, start }) => [text, start]), [['Hello ', 10], ['world', 10.5]]);
});

test('applies the LRC offset and the user offset in opposite directions', () => {
  const lrc = '[offset:500]\n[00:10.00]line';
  assert.equal(parseLrc(lrc).lines[0].start, 9.5);
  assert.equal(parseLrc(lrc, { offsetMs: 250 }).lines[0].start, 9.75);
});

test('finds the active line', () => {
  const { lines } = sample;
  assert.equal(activeIndex(lines, 0), -1);
  assert.equal(activeIndex(lines, 1.5), 0);
  assert.equal(activeIndex(lines, 6.99), 1);
  assert.equal(activeIndex(lines, 7), 2);
  assert.equal(activeIndex(lines, 20.5), 3);
});

test('reports the word being sung and how far it is', () => {
  const line = sample.lines[2];
  assert.deepEqual(wordAt(line, 6.9), { index: -1, fraction: 0 });
  assert.deepEqual(wordAt(line, 7), { index: 0, fraction: 0 });
  assert.equal(wordAt(line, 7.25).fraction, 0.5);
  assert.equal(wordAt(line, 7.5).index, 1);
  assert.deepEqual(wordAt(line, 99), { index: 2, fraction: 1 });
});

test('survives timestamps written with a colon in the fraction and a BOM', () => {
  const starts = parseLrc('\uFEFF[00:01:50]one\r\n[01:02:345]two').lines.map((line) => line.start);
  assert.deepEqual(starts.slice(0, 1), [1.5]);
  near(starts[1], 62.345);
});

test('reads the real placeholder file shipped with the site', async () => {
  const { readFile } = await import('node:fs/promises');
  const { lines } = parseLrc(await readFile(new URL('../assets/lyrics.lrc', import.meta.url), 'utf8'));
  assert.equal(lines.length, 8);
  assert.deepEqual(lines[0].words.map(({ text, start }) => [text, start]).slice(0, 3), [
    ['Esta ', 0], ['linha ', 0.28], ['é ', 0.56],
  ]);
});

test('returns no lines for a file without timestamps', () => {
  assert.deepEqual(parseLrc('just words\n[not:a:time]').lines, []);
});
