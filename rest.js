/* Everything after the bag: Worlds (pinned horizontal journey), the Vitrine (every photographed piece of a World),
 * the Harrods Edit rail, the manifesto fill, the atelier ribbon, reveals. No libraries.
 * Scroll-driven parts read --p / --ps from scroll-seq.js (data-pin sections); this file only builds markup and
 * handles the few things CSS cannot: the catalog, the overlay, rail speed, reveals. */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const IG = 'https://ig.me/m/orangeandco.it';
  const eur = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
      else if (k === 'style') n.style.cssText = v; else if (v !== false && v != null) n.setAttribute(k, v);
    }
    n.append(...kids.filter(Boolean));
    return n;
  };
  // one line in both languages: lang.js swaps data-en / data-ar; text starts in the current language
  const ar = () => window.OC && OC.lang === 'ar';
  const tx = (en, arT) => ({ 'data-en': en, 'data-ar': arT, text: ar() ? arT : en });
  const price = (v) => el('bdi', { class: 'price', dir: 'ltr', text: `€${eur.format(v)}` });

  /* ---------- reveals: [data-reveal] rises in once, [data-lines] titles unmask line by line ---------- */
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -2% 0px', threshold: 0.12 });
  const watch = (root = document) => root.querySelectorAll('[data-reveal],[data-lines]').forEach((n) => io.observe(n));

  /* ---------- manifesto: split into words for the fill ---------- */
  const splitWords = () => document.querySelectorAll('[data-words]').forEach((p) => {
    const words = (ar() ? p.dataset.ar : p.dataset.en || p.textContent).trim().split(/\s+/);
    p.textContent = '';
    p.style.setProperty('--n', words.length);
    words.forEach((w, i) => { p.append(el('span', { style: `--i:${i}`, text: w }), ' '); });
  });
  splitWords();
  // language switch: lang.js has put the whole paragraph back as plain text; split it again
  document.addEventListener('langchange', () => {
    splitWords();
    if (openWorld) fillVitrineHead(openWorld);
  });

  /* ---------- catalog ---------- */
  fetch('data/catalog.json?v=20261116c').then((r) => r.json()).then(build).catch(() => {
    document.querySelectorAll('[data-needs-catalog]').forEach((n) => n.classList.add('offline'));
  });

  function build(cat) {
    buildWorlds(cat.worlds);
    buildHarrods(cat.harrods, cat);
    watch();
  }

  function buildWorlds(worlds) {
    const root = document.querySelector('.worlds');
    const track = root && root.querySelector('.w-track');
    if (!track) return;
    const n = worlds.length;
    root.style.setProperty('--n', n);
    // a slower journey on phones; the section's pinned length follows the number of Worlds
    root.style.height = reduce ? 'auto' : `calc(${(n - 1) * 85 + 60}vh + 100vh)`;
    worlds.forEach((w, i) => {
      const panel = el('article', { class: 'w-panel', style: `--i:${i}`, 'aria-label': ar() ? w.ar : w.en, 'data-aria-en': w.en, 'data-aria-ar': w.ar },
        el('p', { class: 'w-giant', 'aria-hidden': 'true', ...tx(w.en, w.ar) }),
        el('figure', { class: `w-hero k-${w.hero.k}` },
          el('img', { src: w.hero.img, alt: `${w.hero.b} ${w.hero.n}`, loading: i < 2 ? 'eager' : 'lazy', decoding: 'async' })),
        el('div', { class: 'w-meta' },
          el('p', { class: 'w-idx' }, el('span', { text: String(i + 1).padStart(2, '0') }), el('span', { text: ` / ${String(n).padStart(2, '0')}` })),
          el('h3', { class: 'w-name', ...tx(w.en, w.ar) }),
          el('p', { class: 'w-piece' }, el('span', { class: 'b', text: w.hero.b }), el('span', { class: 'nm', text: w.hero.n }), price(w.hero.p)),
          el('button', { class: 'btn btn-line', type: 'button', 'data-world': w.id },
            el('span', tx('See the collection', 'عرض المجموعة')), el('span', { class: 'count', text: String(w.items.length) }))));
      track.append(panel);
    });
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-world]');
      if (b) openVitrine(worlds.find((w) => w.id === b.dataset.world), b);
    });
    // the scroll position changed the section height: let the sticky plumbing re-measure
    dispatchEvent(new Event('scroll'));
  }

  function buildHarrods(items, cat) {
    const rail = document.querySelector('.h-rail');
    if (!rail || !items.length) return;
    const cut = items.filter((x) => x.k === 'cut');
    const rows = [cut.filter((_, i) => i % 2 === 0), cut.filter((_, i) => i % 2 === 1)];
    rows.forEach((row, r) => {
      const lane = el('div', { class: `h-lane ${r ? 'rev' : ''}` });
      const strip = el('div', { class: 'h-strip' });
      const card = (x, clone) => el('a', { class: 'h-item', href: IG, target: '_blank', rel: 'noopener', 'aria-hidden': clone ? 'true' : false, tabindex: clone ? '-1' : false },
        el('img', { src: x.sm, alt: clone ? '' : `${x.b} ${x.n}`, loading: 'lazy', decoding: 'async' }),
        el('span', { class: 'h-cap' }, el('span', { class: 'nm', text: x.n }), price(x.p)));
      row.forEach((x) => strip.append(card(x, false)));
      row.forEach((x) => strip.append(card(x, true)));     // seamless loop
      lane.append(strip); rail.append(lane);
    });
    const btn = document.querySelector('[data-harrods]');
    if (btn) {
      btn.querySelector('.count').textContent = String(items.length);
      btn.addEventListener('click', () => openVitrine({ id: 'harrods', en: 'The Harrods Edit', ar: 'مختارات هارودز', items }, btn));
    }
    // rail speed follows scroll velocity, then settles back: the shelf seems to move with you
    if (!reduce) {
      let lastY = scrollY, lastT = performance.now(), boost = 0, raf = 0;
      const lanes = [...rail.querySelectorAll('.h-strip')];
      const tick = () => {
        boost *= 0.92;
        lanes.forEach((s) => s.getAnimations().forEach((a) => { a.playbackRate = 1 + boost; }));
        raf = Math.abs(boost) > 0.02 ? requestAnimationFrame(tick) : 0;
      };
      addEventListener('scroll', () => {
        const t = performance.now(), v = (scrollY - lastY) / Math.max(1, t - lastT);
        lastY = scrollY; lastT = t;
        boost = Math.max(-6, Math.min(6, boost + v * 2.2));
        if (!raf) raf = requestAnimationFrame(tick);
      }, { passive: true });
    }
  }

  /* ---------- the Gifting Atelier: four gifts take turns under the ribbon, only while the section is on screen ---------- */
  (() => {
    const imgs = [...document.querySelectorAll('.a-img')]; if (imgs.length < 2 || reduce) return;
    let i = 0, timer = 0;
    const next = () => { imgs[i].classList.remove('on'); i = (i + 1) % imgs.length; imgs[i].classList.add('on'); };
    new IntersectionObserver(([e]) => { clearInterval(timer); timer = e.isIntersecting ? setInterval(next, 4200) : 0; })
      .observe(document.querySelector('.a-gift'));
  })();

  /* ---------- the Vitrine: every photographed piece of one World ---------- */
  const v = document.querySelector('.vitrine');
  let opener = null, openWorld = null;
  function fillVitrineHead(w) {
    const n = w.items.length;
    Object.assign(v.querySelector('.v-title'), { textContent: ar() ? w.ar : w.en });
    v.querySelector('.v-count').textContent = ar() ? `${n} قطعة` : `${n} pieces`;
  }
  function openVitrine(w, from) {
    if (!w || !v) return;
    opener = from; openWorld = w;
    fillVitrineHead(w);
    const grid = v.querySelector('.v-grid');
    grid.replaceChildren(...w.items.map((x, i) => el('li', { 'data-reveal': '', style: `--d:${(i % 4) * 70}ms` },
      el('a', { class: `tile k-${x.k}`, href: IG, target: '_blank', rel: 'noopener' },
        el('span', { class: 'ph' }, el('img', { src: x.sm, srcset: `${x.sm} 400w, ${x.img} 800w`, sizes: '(min-width: 1100px) 22vw, (min-width: 700px) 30vw, 46vw', alt: `${x.b} ${x.n}`, loading: 'lazy', decoding: 'async' })),
        el('span', { class: 'b', text: x.b || ' ' }),
        el('span', { class: 'n', text: x.n }),
        price(x.p)))));
    v.hidden = false;
    v.scrollTop = 0;
    document.documentElement.classList.add('locked');
    requestAnimationFrame(() => requestAnimationFrame(() => v.classList.add('open')));
    const vio = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); vio.unobserve(e.target); }
    }), { root: v, rootMargin: '0px 0px -6% 0px' });
    grid.querySelectorAll('[data-reveal]').forEach((n) => vio.observe(n));
    history.pushState({ vitrine: w.id }, '');
    v.querySelector('.v-close').focus({ preventScroll: true });
  }
  function closeVitrine(fromHistory) {
    if (!v || v.hidden) return;
    openWorld = null;
    v.classList.remove('open');
    document.documentElement.classList.remove('locked');
    setTimeout(() => { v.hidden = true; }, reduce ? 0 : 700);
    if (!fromHistory && history.state && history.state.vitrine) history.back();
    if (opener) opener.focus({ preventScroll: true });
  }
  if (v) {
    v.querySelector('.v-close').addEventListener('click', () => closeVitrine(false));
    addEventListener('keydown', (e) => { if (e.key === 'Escape') closeVitrine(false); });
    addEventListener('popstate', () => closeVitrine(true));
  }

  watch();
})();
