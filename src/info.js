// An "i" button that reveals a note drawn under its step, over whatever follows it. With a
// mouse, the note shows while the pointer is over the button or over the note itself.
// Phones have no hover, so there a tap opens it and a second tap, a press anywhere else or
// Escape closes it.
export function createInfoButton(button) {
  const note = document.getElementById(button.getAttribute('aria-controls'));
  let pinned = false;
  let hovered = false;

  const render = () => {
    note.hidden = !(pinned || hovered);
    button.setAttribute('aria-expanded', String(!note.hidden));
  };

  button.addEventListener('click', () => {
    pinned = !pinned;
    render();
  });

  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    // Either one keeps the note up, so the pointer can travel from the button onto the text.
    for (const element of [button, note]) {
      element.addEventListener('mouseenter', () => {
        hovered = true;
        render();
      });
      element.addEventListener('mouseleave', () => {
        hovered = false;
        render();
      });
    }
  }

  document.addEventListener('pointerdown', (event) => {
    if (pinned && !button.contains(event.target) && !note.contains(event.target)) {
      pinned = false;
      render();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && pinned) {
      pinned = false;
      render();
      button.focus();
    }
  });
}
