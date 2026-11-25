// The bottom sheet that shows the line being sung, filled in word by word, and the next one.
import { activeIndex, wordAt } from './lyrics.js';

export function createKaraoke(root, { lines }) {
  const current = root.querySelector('.current');
  const next = root.querySelector('.next');
  let shown = -2; // line index on screen; no line is -1, so this forces the first render
  let activeWord = -2;
  let spans = [];

  function render(index) {
    activeWord = -2;
    spans = index === -1 ? [] : lines[index].words.map((word) => {
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = word.text;
      return span;
    });
    if (index === -1) {
      // Instrumental intro: show a note and preview the first line.
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
    next.textContent = lines[index + 1]?.text ?? '';
    next.classList.toggle('hidden', !next.textContent);
  }

  function update(time) {
    const index = activeIndex(lines, time);
    if (index !== shown) {
      shown = index;
      render(index);
    }
    if (index === -1) return;

    const { index: word, fraction } = wordAt(lines[index], time);
    if (word !== activeWord) {
      activeWord = word;
      spans.forEach((span, i) => {
        span.className = i < word ? 'word sung' : i === word ? 'word active' : 'word';
      });
    }
    if (word >= 0) spans[word].style.setProperty('--fill', `${(fraction * 100).toFixed(1)}%`);
  }

  return { update };
}
