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
 * - loads only when the section is within ~2 screens; first frame of every clip first, then the rest in order
 * - eased scrubbing, DPR capped at 2, redraws only when something changed, idles when settled or off-screen
 * - sets --p (raw) and --ps (smoothed) on the section for CSS, toggles .on on [data-at] elements
 * - prefers-reduced-motion: the last frame / final state, all text shown, no scrubbing
 */
(() => {
  const pad = n => String(n).padStart(4, '0');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    return { get cur() { return cur; }, redraw: publish };
  }

  function initSeq(root) {
    const segs = JSON.parse(root.dataset.seq).segments;
    for (const s of segs) { const [hi, ho] = s.hold || [0, 0]; s.fi = s.fadeIn || 0; s.hi = hi; s.ho = ho; s.span = s.fi + hi + s.length + ho; }
    const total = segs.reduce((a, s) => a + s.span, 0);
    let acc = 0; for (const s of segs) { s.a = acc / total; acc += s.span; s.b = acc / total; }
    const canvas = root.querySelector('canvas'), ctx = canvas.getContext('2d', { alpha: false });
    let set = null, armed = false, last = '';
    const pickSet = () => (innerWidth / innerHeight < 1 ? 'mobile' : 'desktop');

    function load() {
      set = pickSet(); last = '';
      for (const s of segs) s.imgs = new Array(s.frames);
      const queue = [];
      segs.forEach((s, k) => queue.push([k, reduce && k === segs.length - 1 ? s.frames : 1]));   // poster frames first
      segs.forEach((s, k) => { queue.push([k, s.frames]); for (let i = 2; i < s.frames; i++) queue.push([k, i]); });
      let inflight = 0; const wanted = set;
      const pump = () => {
        while (inflight < 6 && queue.length) {
          const [k, i] = queue.shift(), s = segs[k];
          if (s.imgs[i - 1]) continue;
          const im = new Image(); im.decoding = 'async'; inflight++;
          im.onload = im.onerror = () => { inflight--; if (wanted === set) { last = ''; draw(); pump(); } };
          im.src = `${s.src}${set}/frame_${pad(i)}.webp`; s.imgs[i - 1] = im;
        }
      };
      pump();
    }
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
      if (!set) return;
      const p = ctl ? ctl.cur : 0; let k = segs.findIndex(s => p <= s.b); if (k < 0) k = segs.length - 1;
      const s = segs[k], u = (p - s.a) / Math.max(1e-6, s.b - s.a) * s.span;          // vh into this segment
      let i, fade = 1;
      if (u < s.fi && k > 0) { i = 0; fade = u / s.fi; }
      else {
        const t = (u - s.fi - s.hi) / Math.max(1e-6, s.length);                        // <0 poster hold, >1 end hold
        i = Math.min(s.frames - 1, Math.max(0, Math.round(t * (s.frames - 1))));
      }
      const key = `${k}:${i}:${fade.toFixed(3)}:${canvas.width}`;
      if (key === last) return;
      const im = nearest(s, i); if (!im) return;
      if (fade < 1) { const prev = nearest(segs[k - 1], segs[k - 1].frames - 1); if (prev) cover(prev, 1); cover(im, fade * fade * (3 - 2 * fade)); }
      else cover(im, 1);
      last = key;
    }
    function size() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr); canvas.height = Math.round(canvas.clientHeight * dpr);
      if (armed && pickSet() !== set) load();
      last = ''; draw();
    }
    let ctl = null;
    ctl = pin(root, total, draw);
    new IntersectionObserver(([e]) => {                    // start downloading ~2 screens before the section arrives
      if (e.isIntersecting && !armed) { armed = true; load(); size(); }
    }, { rootMargin: '200% 0px' }).observe(root);
    addEventListener('resize', size);
    size();
  }

  const start = () => {
    document.querySelectorAll('[data-seq]').forEach(initSeq);
    document.querySelectorAll('[data-pin]').forEach(r => pin(r, parseFloat(r.dataset.pin), () => {}));
  };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
})();
