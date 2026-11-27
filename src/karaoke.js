// The bottom sheet that shows the line being sung, filled in word by word, and the next one.
//
// The line is written twice, one copy over the other: a faint one underneath and a bright
// one on top, uncovered from left to right as the song goes. Only that uncovering changes
// from moment to moment; the words themselves do not. Nothing here relies on repainting
// text through a changing background or on animating the element whose content changes,
// as phones' browsers are uneven at both.
//
// When translations are available, a switch on the sheet's top edge swaps the text for one.
import { activeIndex, wordAt } from './lyrics.js';

const REMEMBERED = 'quadro-ar:lyrics-language';

export function createKaraoke(root, { languages }) {
  const current = root.querySelector('.current');
  const next = root.querySelector('.next');
  const title = root.querySelector('.title');
  const switcher = root.querySelector('.language');
  const names = Object.keys(languages);
  let remembered = null;
  try {
    remembered = localStorage.getItem(REMEMBERED);
  } catch {
    // Private browsing or a full storage: the choice simply is not remembered.
  }
  let language = languages[remembered] ? remembered : names[0];

  let shown = -2; // line index on screen; no line is -1, so this forces the first render
  let activeWord = -2;
  let track = null; // what the current line is made of: the words, and the bright copy
  let words = []; // one span per word, the copy that is read
  let bright = []; // the same words, uncovered as they are sung
  let lastTime = 0;

  function render(index) {
    activeWord = -2;
    const lines = languages[language].lines;
    const line = lines[index];
    // No line yet, or a line that is only a timestamp: an instrumental break.
    const instrumental = !line || !line.text;
    track = document.createElement('span');
    track.className = 'track hop';
    if (instrumental) {
      // A note, with the next line that is sung as a preview.
      const note = document.createElement('span');
      note.className = 'note';
      note.textContent = '♪';
      track.replaceChildren(note);
      words = bright = [];
    } else {
      const copy = () => line.words.map((word) => {
        const span = document.createElement('span');
        span.className = 'word';
        span.textContent = word.text;
        return span;
      });
      words = copy();
      bright = copy();
      const base = document.createElement('span');
      base.className = 'base';
      base.replaceChildren(...words);
      const fill = document.createElement('span');
      fill.className = 'fill';
      fill.setAttribute('aria-hidden', 'true'); // the same words once more, for the eyes only
      fill.replaceChildren(...bright);
      track.replaceChildren(base, fill);
    }
    current.replaceChildren(track);

    const upcoming = lines.slice(index + 1).find((entry) => entry.text);
    next.textContent = upcoming?.text ?? '';
    next.classList.toggle('hidden', !next.textContent);
    title.textContent = languages[language].title ?? '';
    title.classList.toggle('hidden', !title.textContent);
  }

  if (names.length > 1) {
    switcher.replaceChildren(...names.map((name) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.lang = name;
      button.textContent = languages[name].label;
      button.setAttribute('aria-label', languages[name].description);
      button.setAttribute('aria-pressed', String(name === language));
      button.addEventListener('click', () => setLanguage(name));
      return button;
    }));
    switcher.classList.remove('hidden');
  }

  function setLanguage(name) {
    if (!languages[name] || name === language) return;
    language = name;
    // The line on screen changes at once, whether or not the song is playing.
    shown = -2;
    update(lastTime);
    for (const button of switcher.children) button.setAttribute('aria-pressed', String(button.dataset.lang === name));
    try {
      localStorage.setItem(REMEMBERED, name);
    } catch {
      // Not remembered this time.
    }
  }

  function update(time) {
    lastTime = time;
    const lines = languages[language].lines;
    const index = activeIndex(lines, time);
    const line = lines[index];
    if (index !== shown) {
      shown = index;
      render(index);
    }
    if (!line || !line.text) return;

    const { index: word, fraction } = wordAt(line, time);
    if (word !== activeWord) {
      activeWord = word;
      words.forEach((span, position) => {
        span.className = position < word ? 'word sung' : position === word ? 'word active' : 'word';
      });
    }
    // Uncover the bright copy up to the point being sung. Everything to the left is
    // uncovered on every row, so the lines already sung come out whole.
    const edge = word >= 0 ? bright[word].offsetLeft + bright[word].offsetWidth * fraction : 0;
    track.lastElementChild.style.clipPath = `inset(0 ${Math.max(track.clientWidth - edge, 0).toFixed(1)}px 0 0)`;
  }

  return { update, setLanguage, get language() { return language; }, get index() { return shown; } };
}
