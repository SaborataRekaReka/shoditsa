/* Read-only browser evaluation used by the manual CUA route sweep. */
() => {
  const parse = value => {
    if (value === 'transparent') return [0, 0, 0, 0];
    if (value.startsWith('color(srgb ')) {
      const parts = value.slice(11, -1).split('/');
      return [...parts[0].trim().split(/\s+/).map(v => +v * 255), parts[1] ? +parts[1] : 1];
    }
    const parts = value.match(/[\d.]+/g);
    return parts && value.startsWith('rgb') ? [+parts[0], +parts[1], +parts[2], parts.length > 3 ? +parts[3] : 1] : null;
  };
  const blend = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
  const lum = c => c.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
  const contrast = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
  const findings = [], gradients = [], unknown = [];
  let checked = 0;
  const inspect = (el, text, placeholder = false) => {
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height || el.closest('svg, [aria-hidden="true"], [inert]')) return;
    const style = getComputedStyle(el, placeholder ? '::placeholder' : undefined);
    const chain = [];
    for (let node = el; node; node = node.parentElement) {
      const s = getComputedStyle(node);
      if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < .99) return;
      chain.unshift(s);
    }
    let bg = [255, 255, 255], gradient = false;
    for (const s of chain) {
      const c = parse(s.backgroundColor);
      if (c) {
        if (c[3] === 1) gradient = false;
        bg = blend(c, bg);
      }
      if (s.backgroundImage !== 'none') gradient = true;
    }
    const fg = parse(style.color);
    if (!fg) { unknown.push(style.color); return; }
    const size = +style.fontSize.replace('px', '');
    const large = size >= 24 || size >= 18.666 && +style.fontWeight >= 700;
    const ratio = contrast(blend(fg, bg), bg);
    checked++;
    const record = { text: text.trim().slice(0, 100), tag: el.tagName, class: typeof el.className === 'string' ? el.className : '', ratio: +ratio.toFixed(2), color: style.color, bg: bg.map(Math.round), size, disabled: !!el.closest(':disabled, [aria-disabled="true"]'), placeholder, x: Math.round(box.x), y: Math.round(box.y) };
    if (gradient) gradients.push(record);
    else if (ratio < (large ? 3 : 4.5)) findings.push(record);
  };
  for (const el of document.querySelectorAll('body *')) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'OPTION'].includes(el.tagName)) continue;
    const direct = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    if (direct) inspect(el, direct);
    if (el.matches('input, textarea') && el.getAttribute('placeholder')) inspect(el, el.getAttribute('placeholder'), true);
  }
  const root = getComputedStyle(document.documentElement);
  return { path: location.pathname + location.search, width: innerWidth, client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, tone: document.documentElement.dataset.questTone, publicTheme: document.documentElement.dataset.publicTheme, bg: root.getPropertyValue('--color-bg').trim(), questBg: root.getPropertyValue('--quest-bg').trim(), checked, findings, gradients, unknown, headings: [...document.querySelectorAll('main h1, .qg-main h1')].map(el => el.textContent.trim()) };
}
