/* Scroll-scrubbed image sequences, several clips on one sticky canvas, plus plain pinned scroll scenes. No dependencies.
 *
 * <section data-seq='{"segments":[{"src":"media/watch/","frames":120,"length":320,"hold":[40,120]}, ...]}'>
 *   <canvas></canvas>  ...text with data-at="0.3" (and optional data-out="0.5"), progress 0..1 of the whole section
 * </section>
 * <section data-pin="240"> ...anything driven by CSS var(--p)/var(--ps), or listen for its 'progress' event </section>
 *
 * segment options: src (folder holding desktop/ and mobile/), frames, length (vh of scrolling while it plays),
 *                  hold [in, out] (vh: first frame held as a still poster before it plays, last frame held after),
 *                  fadeIn (vh: cross-fade from the previous segment's last frame into this one's first frame)
 * A segment's scroll is: fadeIn -> hold in (poster) -> play -> hold out (last frame). Nothing plays before its turn.
 * - landscape screens load desktop/ (16:9), portrait screens load mobile/ (9:16); switches on rotate
 * - eased scrubbing, DPR capped at 2, redraws only when something changed, idles when settled or off-screen
 * - sets --p (raw) and --ps (smoothed) on the section for CSS, toggles .on on [data-at] elements
 * - prefers-reduced-motion: the last frame / final state, all text shown, no scrubbing
 *
 * Loading (one shared queue for the whole page):
 * - at most CAP frames in flight across ALL sections (3 while the page is settling, then 6), so preloading never
 *   starves what is on screen
 * - every free slot goes to the section nearest the viewport; inside the section on screen, the frames nearest the
 *   current playhead (looking ahead) go first, so a fast scroll catches up where the visitor actually is
 * - a section is armed when it comes within ~2 screens; the FIRST film (the watch) is armed early, once the page has
 *   loaded, the fonts are in and the hero has been on screen for a moment (nothing heavy loads if the visitor bounces)
 * - the hero loader ([data-loader]) shows the watch film's real progress and holds the scroll until the watch poster
 *   and two thirds of its frames are in, or 4 s pass, or a frame fails; never under reduced motion
 */
(() => {
  const pad = n => String(n).padStart(4, '0');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const T0 = performance.now();
  const DBG = /[?&]debug\b/.test(location.search) ? (window.__seq = { draws: 0, misses: 0, maxGap: 0, release: null }) : null;

  /* ---------- the shared download queue ---------- */
  const Q = { cap: 3, inflight: 0, sections: [] };
  function pump() {
    while (Q.inflight < Q.cap) {
      let best = null, bestD = Infinity;
      for (const sec of Q.sections) { if (!sec.armed || !sec.pending()) continue; const d = sec.distance(); if (d < bestD) { bestD = d; best = sec; } }
      if (!best) return;
      const job = best.next(); if (!job) continue;
      const [s, i, set, done] = job, im = new Image(); im.decoding = 'async'; Q.inflight++;
      im.onload = () => { Q.inflight--; done(true); pump(); };
      im.onerror = () => { Q.inflight--; done(false); pump(); };
      im.src = `${s.src}${set}/frame_${pad(i)}.webp`; s.imgs[i - 1] = im;
    }
  }
  const raiseCap = () => { if (Q.cap < 6) { Q.cap = 6; pump(); } };
  addEventListener('scroll', () => { if (Q.inflight < Q.cap) pump(); }, { passive: true });

  // shared scroll plumbing for both kinds of section: sticky stage, --p/--ps, cues, eased smoothing, off-screen pause
  function pin(root, totalVh, onFrame) {
    const cues = [...root.querySelectorAll('[data-at]')];
    root.style.position = 'relative';
    root.style.height = reduce ? '100vh' : `calc(${totalVh}vh + 100vh)`;
    const stage = document.createElement('div'); stage.className = 'seq-stage';
    Object.assign(stage.style, { position: 'sticky', top: '0', height: '100vh', overflow: 'hidden' });
    while (root.firstChild) stage.appendChild(root.firstChild);
    root.appendChild(stage);
    let visible = false, raf = 0, target = reduce ? 1 : 0, cur = target;
    const progress = () => {
      if (reduce) return 1;
      const r = root.getBoundingClientRect(), span = root.offsetHeight - innerHeight;
      return Math.min(1, Math.max(0, -r.top / Math.max(1, span)));
    };
    const publish = () => { root.style.setProperty('--ps', cur.toFixed(4)); onFrame(cur);
                            root.dispatchEvent(new CustomEvent('progress', { detail: cur })); };
    function onScroll() {
      target = progress();
      root.style.setProperty('--p', target.toFixed(4));
      for (const el of cues) {
        const on = target >= parseFloat(el.dataset.at) && (!el.dataset.out || target < parseFloat(el.dataset.out));
        el.classList.toggle('on', on);
      }
      if (visible && !raf) raf = requestAnimationFrame(tick);
    }
    function tick() {
      raf = 0;
      cur += (target - cur) * 0.12; if (Math.abs(target - cur) < 0.0002) cur = target;
      publish();
      if (cur !== target) raf = requestAnimationFrame(tick);
    }
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) onScroll(); }).observe(root);
    addEventListener('scroll', onScroll, { passive: true });
    onScroll(); publish();
    return { get cur() { return cur; }, get target() { return target; }, redraw: publish };
  }

  function initSeq(root, index) {
    const segs = JSON.parse(root.dataset.seq).segments;
    for (const s of segs) { const [hi, ho] = s.hold || [0, 0]; s.fi = s.fadeIn || 0; s.hi = hi; s.ho = ho; s.span = s.fi + hi + s.length + ho; }
    const total = segs.reduce((a, s) => a + s.span, 0);
    let acc = 0; for (const s of segs) { s.a = acc / total; acc += s.span; s.b = acc / total; }
    const canvas = root.querySelector('canvas'), ctx = canvas.getContext('2d', { alpha: false });
    let set = null, last = '', queue = [];
    const pickSet = () => (innerWidth / innerHeight < 1 ? 'mobile' : 'desktop');
    const stats = segs.map(s => ({ total: s.frames, loaded: 0, failed: 0, poster: false }));

    // where the playhead is: segment k, frame i (also used to load what the visitor is looking at first)
    function playhead(p) {
      let k = segs.findIndex(s => p <= s.b); if (k < 0) k = segs.length - 1;
      const s = segs[k], u = (p - s.a) / Math.max(1e-6, s.b - s.a) * s.span;
      let i = 0, fade = 1;
      if (u < s.fi && k > 0) { i = 0; fade = u / s.fi; }
      else { const t = (u - s.fi - s.hi) / Math.max(1e-6, s.length); i = Math.min(s.frames - 1, Math.max(0, Math.round(t * (s.frames - 1)))); }
      return { k, i, fade };
    }

    const sec = {
      armed: false,
      arm() { if (this.armed) return; this.armed = true; load(); size(); },
      pending() { return queue.length > 0; },
      distance() {                                      // 0 on screen, else screens away
        const r = root.getBoundingClientRect();
        if (r.top < innerHeight && r.bottom > 0) return 0;
        return (r.top >= innerHeight ? r.top - innerHeight : -r.bottom) / innerHeight + 0.001;
      },
      next() {
        const wanted = set;
        const done = (k, i) => (ok) => {
          if (wanted !== set) return;
          if (ok) { stats[k].loaded++; if (i === 1) stats[k].poster = true; } else stats[k].failed++;
          last = ''; draw(); report();
        };
        // on screen: the unloaded frame nearest the playhead, looking ahead more than behind
        if (this.distance() === 0 && ctl) {
          const { k, i } = playhead(ctl.target), s = segs[k];
          for (let d = 0; d < 24; d++) for (const j of [i + d, i - (d >> 1)]) {
            if (j < 0 || j >= s.frames || s.imgs[j]) continue;
            queue = queue.filter(([qk, qi]) => !(qk === k && qi === j + 1));
            return [s, j + 1, set, done(k, j + 1)];
          }
        }
        while (queue.length) {
          const [k, i] = queue.shift(), s = segs[k];
          if (!s.imgs[i - 1]) return [s, i, set, done(k, i)];
        }
        return null;
      },
      stats,
    };
    Q.sections.push(sec);

    function load() {
      set = pickSet(); last = '';
      for (const s of segs) s.imgs = new Array(s.frames);
      stats.forEach(st => { st.loaded = 0; st.failed = 0; st.poster = false; });
      queue = [];
      segs.forEach((s, k) => queue.push([k, reduce && k === segs.length - 1 ? s.frames : 1]));   // poster frames first
      segs.forEach((s, k) => { queue.push([k, s.frames]); for (let i = 2; i < s.frames; i++) queue.push([k, i]); });
      pump();
    }
    function report() { root.dispatchEvent(new CustomEvent('seqload', { detail: stats })); }
    const ready = im => im && im.complete && im.naturalWidth;
    function nearest(s, i) {                               // never blank: closest frame already loaded
      for (let d = 0; d < s.frames; d++) for (const j of [i - d, i + d]) if (ready(s.imgs[j])) return s.imgs[j];
      return null;
    }
    function cover(im, alpha) {
      const sc = Math.max(canvas.width / im.naturalWidth, canvas.height / im.naturalHeight);
      const w = im.naturalWidth * sc, h = im.naturalHeight * sc;
      ctx.globalAlpha = alpha; ctx.drawImage(im, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h); ctx.globalAlpha = 1;
    }
    function draw() {
      if (!set || !segs[0].imgs) return;
      const { k, i, fade } = playhead(ctl ? ctl.cur : 0), s = segs[k];
      const key = `${k}:${i}:${fade.toFixed(3)}:${canvas.width}`;
      if (key === last) return;
      const im = nearest(s, i); if (!im) return;
      if (DBG && ctl && ctl.cur > 0 && ctl.cur < 1 && fade === 1) { DBG.draws++; const g = Math.abs(s.imgs.indexOf(im) - i); if (g > 0) DBG.misses++; DBG.maxGap = Math.max(DBG.maxGap, g); }
      if (fade < 1) { const prev = nearest(segs[k - 1], segs[k - 1].frames - 1); if (prev) cover(prev, 1); cover(im, fade * fade * (3 - 2 * fade)); }
      else cover(im, 1);
      last = key;
    }
    function size() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr); canvas.height = Math.round(canvas.clientHeight * dpr);
      if (sec.armed && pickSet() !== set) load();
      last = ''; draw();
    }
    let ctl = null;
    ctl = pin(root, total, draw);
    new IntersectionObserver(([e]) => { if (e.isIntersecting) sec.arm(); }, { rootMargin: '200% 0px' }).observe(root);
    addEventListener('resize', size);
    size();
    return { root, sec };
  }

  /* ---------- the hero loader: real progress of the watch film, a short hold, a hard cap ---------- */
  function heroLoader(first) {
    const box = document.querySelector('[data-loader]'), html = document.documentElement;
    const release = () => { if (!html.classList.contains('holding')) return; html.classList.remove('holding'); html.classList.add('released'); raiseCap(); if (DBG) DBG.release = Math.round(performance.now() - T0); };
    // no hold: reduced motion, no film, or the page reopened part-way down
    if (!box || !first || reduce || scrollY > 10) { if (box) box.hidden = true; raiseCap(); return; }
    html.classList.add('holding');
    const fill = box.querySelector('i');
    setTimeout(release, Math.max(0, 4000 - (performance.now() - T0)));          // never more than ~4 s from first paint
    first.root.addEventListener('seqload', ({ detail }) => {
      const w = detail[0], frac = w.loaded / w.total;
      fill.style.transform = `scaleX(${frac.toFixed(3)})`;
      if (w.failed > 0 || (w.poster && frac >= 0.66)) release();
    });
  }

  const start = () => {
    const films = [...document.querySelectorAll('[data-seq]')].map(initSeq);
    document.querySelectorAll('[data-pin]').forEach(r => pin(r, parseFloat(r.dataset.pin), () => {}));
    const first = films[0];
    heroLoader(first);
    // the watch film starts early, but only once the hero has painted with its own assets and stayed for a moment
    const fonts = document.fonts ? document.fonts.ready : Promise.resolve();
    const loaded = document.readyState === 'complete' ? Promise.resolve() : new Promise(r => addEventListener('load', r, { once: true }));
    Promise.all([fonts, loaded]).then(() => setTimeout(() => {
      if (first && document.visibilityState === 'visible') first.sec.arm();
      else if (first) document.addEventListener('visibilitychange', () => first.sec.arm(), { once: true });
    }, 500));
    setTimeout(raiseCap, 6000);                                                 // full speed once the page has settled
  };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
})();
