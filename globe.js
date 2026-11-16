/* Route scene: a low flight over the planet, London -> Paris -> Tripoli. Canvas 2D, no libraries.
 * A perspective camera flies low enough that the whole globe is never on screen: the horizon curves across the top,
 * the land is a field of gold dots from Natural Earth 1:50m coastlines, and real city light (NASA Black Marble) glows
 * where cities actually are. The camera banks gently, the gold route draws with the scroll, the horizon warms to dawn
 * as the line reaches Tripoli. Dots come from data/globe-dots.bin (pipeline/globe/build-dots.mjs, which also checks
 * known land, sea and city points). Hooks onto <section data-pin data-globe>: scroll-seq.js fires 'progress' 0..1. */
(() => {
  const D = Math.PI / 180;
  // [English, Arabic, lon, lat]: city centres
  const STOPS = [['London', 'لندن', -0.1276, 51.5072], ['Paris', 'باريس', 2.3522, 48.8566], ['Tripoli', 'طرابلس', 13.1913, 32.8872]];
  // camera keys: progress, camera over (lat, lon), altitude in earth radii, looking at (lat, lon), bank in degrees
  // the camera always faces north, so north stays up on screen: London above Paris, Paris above Tripoli, as on a map
  const KEYS = [[0.00, 44.0, -1.5, 0.17, 52.6, 0.5, -3], [0.30, 41.0, 1.5, 0.15, 49.9, 2.6, 2],
                [0.62, 33.5, 7.0, 0.14, 41.0, 8.6, -2], [1.00, 25.0, 12.4, 0.12, 33.6, 13.0, 1]];

  const sm = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const vec = (lo, la) => [Math.cos(la * D) * Math.sin(lo * D), Math.sin(la * D), Math.cos(la * D) * Math.cos(lo * D)];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a) => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));
  const dms = (v, p, n) => { const a = Math.abs(v); let d = Math.floor(a), m = Math.round((a - d) * 60); if (m === 60) { d++; m = 0; } return `${d}°${String(m).padStart(2, '0')}′ ${v >= 0 ? p : n}`; };
  const camAt = (t) => { for (let i = 0; i < KEYS.length - 1; i++) { const a = KEYS[i], b = KEYS[i + 1];
    if (t <= b[0]) { const k = sm((t - a[0]) / (b[0] - a[0])); return a.slice(1).map((v, j) => lerp(v, b[j + 1], k)); } } return KEYS[KEYS.length - 1].slice(1); };

  // the route: great circles London -> Paris -> Tripoli, sampled once
  const slerp = (a, b, t) => { const d = Math.acos(Math.min(1, dot(a, b))), s = Math.sin(d); return add(mul(a, Math.sin((1 - t) * d) / s), mul(b, Math.sin(t * d) / s)); };
  const stopV = STOPS.map(([, , lo, la]) => vec(lo, la)), ROUTE = [], AT = [0];
  for (let k = 0; k < 2; k++) { for (let i = k ? 1 : 0; i <= 80; i++) ROUTE.push(slerp(stopV[k], stopV[k + 1], i / 80)); AT.push(ROUTE.length - 1); }
  const CUM = [0]; for (let i = 1; i < ROUTE.length; i++) CUM.push(CUM[i - 1] + Math.hypot(...sub(ROUTE[i], ROUTE[i - 1])));
  const TOT = CUM[CUM.length - 1];
  const along = (f) => { const u = f * TOT; let i = 1; while (i < CUM.length - 1 && CUM[i] < u) i++;
    const k = (u - CUM[i - 1]) / (CUM[i] - CUM[i - 1] || 1); return unit(add(ROUTE[i - 1], mul(sub(ROUTE[i], ROUTE[i - 1]), k))); };

  // land dots: [unit vector, light 0..1]
  let DOTS = [];
  const ready = fetch('data/globe-dots.bin?v=20261116b').then((r) => r.arrayBuffer()).then((ab) => {
    const v = new DataView(ab), n = ab.byteLength / 5;
    DOTS = new Array(n);
    for (let i = 0; i < n; i++) DOTS[i] = [vec(v.getInt16(i * 5, true) / 100, v.getInt16(i * 5 + 2, true) / 100), v.getUint8(i * 5 + 4) / 255];
  }).catch(() => {});

  function init(root) {
    const cv = root.querySelector('canvas'), g = cv.getContext('2d');
    let p = 0, w = 0, h = 0, dpr = 1, queued = false;
    const css = (n) => getComputedStyle(root).getPropertyValue(n).trim();
    function size() { dpr = Math.min(devicePixelRatio || 1, 2); w = cv.clientWidth; h = cv.clientHeight;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); draw(); }
    function draw() {
      queued = false; if (!w) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const mob = w < h, t = p, ar = document.documentElement.lang === 'ar';
      const gold = css('--gold') || '#d9b26f', serif = css('--serif') || 'serif', sans = css('--sans') || 'serif';

      // camera
      const [cla, clo, alt, tla, tlo, bank] = camAt(t);
      const C = mul(vec(clo, cla), 1 + alt), f = unit(sub(vec(tlo, tla), C));
      let r = unit(cross(f, unit(C))), u = cross(r, f);
      const bk = bank * D, cb = Math.cos(bk), sb = Math.sin(bk);
      [r, u] = [add(mul(r, cb), mul(u, sb)), add(mul(u, cb), mul(r, -sb))];
      const fov = (mob ? 52 : 40) * D, focal = (mob ? h : w * 0.62) * 0.5 / Math.tan(fov / 2), cx = w / 2, cy = h / 2, cc = dot(C, C);
      const proj = (P, onSphere = true) => { if (onSphere && dot(P, C) <= 1) return null; const d = sub(P, C), z = dot(d, f); if (z <= 0.001) return null;
        return [cx + dot(d, r) / z * focal, cy - dot(d, u) / z * focal, z]; };

      // sky
      const sky = g.createRadialGradient(w / 2, h * 0.2, 0, w / 2, h * 0.2, Math.max(w, h) * 0.8);
      sky.addColorStop(0, '#4a060b'); sky.addColorStop(1, '#2a0003'); g.fillStyle = sky; g.fillRect(0, 0, w, h);
      // the horizon: where the line of sight grazes the planet
      const hc = mul(C, 1 / cc), hr = Math.sqrt(1 - 1 / cc), a1 = unit(cross(C, [0, 1, 0])), a2 = unit(cross(C, a1)), hz = [];
      for (let k = 0; k <= 720; k++) { const th = k / 720 * Math.PI * 2, q = proj(add(hc, add(mul(a1, hr * Math.cos(th)), mul(a2, hr * Math.sin(th)))), false);
        if (q && q[0] > -w && q[0] < 2 * w) hz.push(q); }
      hz.sort((a, b) => a[0] - b[0]);
      const body = g.createLinearGradient(0, 0, 0, h); body.addColorStop(0, '#2a0306'); body.addColorStop(1, '#0c0102');
      g.fillStyle = body; g.beginPath(); g.moveTo(-10, h + 10);
      if (hz.length) { g.lineTo(-10, hz[0][1]); hz.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(w + 10, hz[hz.length - 1][1]); } else { g.lineTo(-10, -10); g.lineTo(w + 10, -10); }
      g.lineTo(w + 10, h + 10); g.closePath(); g.fill();
      const dawn = sm((t - 0.55) / 0.45);
      for (const [lw, a] of [[46, 0.05 + 0.08 * dawn], [16, 0.12 + 0.12 * dawn], [3, 0.35 + 0.3 * dawn], [1, 0.9]]) {
        g.strokeStyle = `rgba(${lerp(214, 255, dawn) | 0},${lerp(150, 190, dawn) | 0},${lerp(110, 120, dawn) | 0},${a})`; g.lineWidth = lw;
        g.beginPath(); hz.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); }

      // faint graticule for depth, every 5 degrees
      g.strokeStyle = 'rgba(237,208,166,.07)'; g.lineWidth = 0.7;
      const line = (pts) => { g.beginPath(); let pen = false; for (const [lo, la] of pts) { const q = proj(vec(lo, la)); if (q) { pen ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); pen = true; } else pen = false; } g.stroke(); };
      for (let lo = -30; lo <= 50; lo += 5) line(Array.from({ length: 61 }, (_, i) => [lo, 10 + i]));
      for (let la = 10; la <= 70; la += 5) line(Array.from({ length: 81 }, (_, i) => [-30 + i, la]));

      // land and city light
      for (let i = 0; i < DOTS.length; i++) {
        const [P, L] = DOTS[i]; if (dot(P, C) <= 1) continue;
        const d = sub(P, C), z = dot(d, f); if (z <= 0.001) continue;
        const x = cx + dot(d, r) / z * focal, y = cy - dot(d, u) / z * focal; if (x < -4 || x > w + 4 || y < -4 || y > h + 4) continue;
        const s = Math.min(2.4, 0.00125 * focal / z), fade = Math.max(0.12, Math.min(1, 0.16 / z));
        if (L > 0.16) { const l = Math.min(1, L); g.fillStyle = `rgba(255,${(196 + 40 * l) | 0},${(126 + 60 * l) | 0},${Math.min(1, (0.35 + L * 1.3) * (0.35 + 0.65 * fade))})`;
          g.beginPath(); g.arc(x, y, s * (0.9 + L), 0, 7); g.fill(); }
        else { g.fillStyle = `rgba(226,186,150,${(0.1 + 0.34 * fade).toFixed(3)})`; g.fillRect(x - s / 2, y - s / 2, s, s); }
      }

      // the route, dotted ahead, gold where it has flown, a bright head
      const prog = sm((t - 0.1) / 0.8);
      g.lineCap = 'round'; g.lineJoin = 'round';
      const path = (pts) => { g.beginPath(); let pen = false; for (const v of pts) { const q = dot(v, C) > 1 ? proj(mul(v, 1.0015), false) : null;
        if (q) { pen ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); pen = true; } else pen = false; } };
      g.setLineDash([1, 5]); g.strokeStyle = 'rgba(237,208,166,.35)'; g.lineWidth = 1.1; path(ROUTE); g.stroke(); g.setLineDash([]);
      const flown = ROUTE.slice(0, Math.max(1, Math.round(prog * (ROUTE.length - 1))) + 1).concat([along(prog)]);
      for (const [lw, a] of [[9, 0.1], [3.5, 0.28], [1.6, 1]]) { g.strokeStyle = gold; g.globalAlpha = a; g.lineWidth = lw; path(flown); g.stroke(); }
      g.globalAlpha = 1;
      if (prog > 0 && prog < 1) { const q = proj(along(prog), false);
        if (q) { const hd = g.createRadialGradient(q[0], q[1], 0, q[0], q[1], 16); hd.addColorStop(0, 'rgba(255,236,200,1)'); hd.addColorStop(1, 'rgba(255,236,200,0)');
          g.fillStyle = hd; g.beginPath(); g.arc(q[0], q[1], 16, 0, 7); g.fill(); } }

      // arriving from the hero: the top of the scene starts in the hero's exact burgundy and clears as the flight begins,
      // so the two pages meet with no line between them
      const veil = 1 - sm(t / 0.14);
      if (veil > 0.002) { const vg = g.createLinearGradient(0, 0, 0, h * 0.55);
        vg.addColorStop(0, `rgba(58,0,4,${veil})`); vg.addColorStop(0.55, `rgba(58,0,4,${veil * 0.55})`); vg.addColorStop(1, 'rgba(58,0,4,0)');
        g.fillStyle = vg; g.fillRect(0, 0, w, h * 0.55); }

      // leaving: the bottom of the scene settles into the page burgundy, so the next page continues it
      const veilB = sm((t - 0.78) / 0.22);
      if (veilB > 0.002) { const bg2 = g.createLinearGradient(0, h * 0.5, 0, h);
        bg2.addColorStop(0, 'rgba(58,0,4,0)'); bg2.addColorStop(0.6, `rgba(58,0,4,${veilB * 0.7})`); bg2.addColorStop(1, `rgba(58,0,4,${veilB})`);
        g.fillStyle = bg2; g.fillRect(0, h * 0.5, w, h * 0.5); }

      // cities: a gold pin with a slow ring, the name, and its coordinates
      const sz = mob ? 1 : 1.2;
      STOPS.forEach(([en, arName, lo, la], k) => {
        const reach = CUM[AT[k]] / TOT, a = k === 0 ? sm((t - 0.03) / 0.08) : sm((prog - reach) * 14 + 1);
        const q = proj(stopV[k]); if (!q || a <= 0) return;
        const [x, y] = q, pulse = (t * 3 + k * 0.3) % 1;
        g.globalAlpha = a; g.fillStyle = gold; g.beginPath(); g.arc(x, y, 2.6, 0, 7); g.fill();
        g.strokeStyle = gold; g.lineWidth = 0.8; g.globalAlpha = a * (1 - pulse) * 0.9; g.beginPath(); g.arc(x, y, 5 + pulse * 16, 0, 7); g.stroke();
        g.globalAlpha = a; g.textBaseline = 'alphabetic';
        const ly = y + (k === 1 ? 20 : k === 0 ? -6 : 0) * sz;
        g.textAlign = 'left'; g.fillStyle = '#F4DEC4';
        if (ar) { g.font = `400 ${17 * sz}px ${css('--arabic') || sans}`; g.letterSpacing = '0px'; g.fillText(arName, x + 14, ly - 2); }
        else { g.font = `500 ${15 * sz}px ${serif}`; g.letterSpacing = `${3.4 * sz}px`; g.fillText(en.toUpperCase(), x + 14, ly - 2); }
        g.letterSpacing = '0.4px'; g.font = `italic 400 ${10.5 * sz}px ${sans}`; g.fillStyle = 'rgba(237,208,166,.8)';
        g.fillText(`${dms(la, 'N', 'S')}  ·  ${dms(lo, 'E', 'W')}`, x + 14, ly + 13 * sz);
        g.letterSpacing = '0px'; g.globalAlpha = 1;
      });
    }
    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(draw); } };
    root.addEventListener('progress', (ev) => { p = ev.detail; queue(); });
    addEventListener('resize', size); size();
    ready.then(queue);
    if (document.fonts) document.fonts.ready.then(size);   // redraw the labels once the web fonts have arrived
    document.addEventListener('langchange', () => (document.fonts ? document.fonts.ready.then(size) : size()));
  }
  const start = () => document.querySelectorAll('[data-globe]').forEach(init);
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
})();
