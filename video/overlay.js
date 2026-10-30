// Injected into the recorded Jira tab (javascript_tool). The recording driver dispatches synthetic clicks, which
// do not move the OS cursor, so this draws a visible cursor that glides to each target and ripples on click.
// __cd.move(x, y) glides the cursor; __cd.clickAt(el) glides to an element's centre; __cd.type(text) types into
// the focused Rovo editor at ~28 ms per character.
(() => {
  if (window.__cd) return 'already';
  const css = document.createElement('style');
  css.textContent = `
    #__cd_cursor{position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;
      background:rgba(255,196,0,.45);border:2px solid rgba(255,140,0,.95);z-index:2147483647;pointer-events:none;
      transition:transform .55s cubic-bezier(.3,.7,.2,1);box-shadow:0 0 0 4px rgba(255,196,0,.18)}
    .__cd_ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;
      border:3px solid rgba(255,140,0,.9);z-index:2147483646;pointer-events:none;animation:__cdr .6s ease-out forwards}
    @keyframes __cdr{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}`;
  document.head.appendChild(css);
  const dot = document.createElement('div');
  dot.id = '__cd_cursor';
  document.body.appendChild(dot);
  let pos = { x: innerWidth / 2, y: innerHeight / 2 };
  const place = (x, y) => { pos = { x, y }; dot.style.transform = `translate(${x}px, ${y}px)`; };
  place(pos.x, pos.y);
  addEventListener('pointerdown', (e) => {
    place(e.clientX, e.clientY);
    const r = document.createElement('div');
    r.className = '__cd_ripple';
    r.style.left = `${e.clientX}px`;
    r.style.top = `${e.clientY}px`;
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 700);
  }, true);
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  window.__cd = {
    move: (x, y) => place(x, y),
    centre: (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)]; },
    async type(text, ms = 28) {
      const ed = document.activeElement;
      for (const ch of text) { document.execCommand('insertText', false, ch); await sleep(ms + Math.random() * 20); }
      return ed ? ed.textContent.length : -1;
    },
  };
  return 'installed';
})();
