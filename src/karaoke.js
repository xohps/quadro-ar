// The bottom sheet that shows the line being sung, filled in word by word, and the next one.
// When translations are available, a switch on its top edge swaps the text for one of them.
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
  let spans = [];
  let lastTime = 0;

  function render(index) {
    activeWord = -2;
    const lines = languages[language].lines;
    const line = lines[index];
    // No line yet, or a line that is only a timestamp: an instrumental break.
    const instrumental = !line || !line.text;
    spans = instrumental ? [] : line.words.map((word) => {
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = word.text;
      return span;
    });
    if (instrumental) {
      // Show a note and preview the next line that is sung.
      current.classList.add('waiting');
      current.replaceChildren('♪');
    } else {
      current.classList.remove('waiting');
      current.replaceChildren(...spans);
      // A small hop as each line arrives.
      current.animate(
        [{ opacity: 0.2, transform: 'translateY(7px)' }, { opacity: 1, transform: 'none' }],
        { duration: 300, easing: 'ease-out' },
      );
    }
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

    const { index: word, fraction } = wordAt(lines[index], time);
    if (word !== activeWord) {
      activeWord = word;
      spans.forEach((span, i) => {
        span.className = i < word ? 'word sung' : i === word ? 'word active' : 'word';
      });
    }
    if (word >= 0) spans[word].style.setProperty('--fill', `${(fraction * 100).toFixed(1)}%`);
  }

  return { update, setLanguage, get language() { return language; }, get index() { return shown; } };
}
