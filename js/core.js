'use strict';
/* EXTREME SPEED BOAT RACING — core utilities, noise, ocean wave model */
window.G = window.G || {};
(function (G) {
  const U = G.U = {};
  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
  U.wrapAngle = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
  U.smooth = (a, b, x) => { x = U.clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
  U.rng = (seed) => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  U.noise = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  U.fbm = (x, y, oct) => {
    let a = 0.5, s = 0, n = 0;
    for (let i = 0; i < (oct || 4); i++) { s += a * U.noise(x, y); n += a; x = x * 2.03 + 17.1; y = y * 2.03 + 3.7; a *= 0.5; }
    return s / n;
  };
  U.fmtTime = (t) => {
    if (!isFinite(t) || t < 0) return '--:--.---';
    const m = Math.floor(t / 60), s = Math.floor(t % 60), ms = Math.floor((t * 1000) % 1000);
    return m + ':' + String(s).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
  };

  /* ---------- Ocean wave model (shared by CPU physics and GPU shader) ---------- */
  const W = G.WAVES = [
    { dx: 0.8, dz: 0.6, L: 85, A: 0.55, sp: 1.0 },
    { dx: -0.3, dz: 0.954, L: 52, A: 0.34, sp: 1.05 },
    { dx: 0.954, dz: -0.3, L: 31, A: 0.2, sp: 1.1 },
    { dx: 0.2, dz: -0.98, L: 19, A: 0.11, sp: 1.2 },
  ];
  for (const w of W) { w.k = (2 * Math.PI) / w.L; w.w = Math.sqrt(9.81 * w.k) * w.sp; }
  G.WAVE_MAX = W.reduce((s, w) => s + w.A, 0);
  G.waveHeight = (x, z, t) => {
    let h = 0;
    for (let i = 0; i < W.length; i++) { const w = W[i]; h += w.A * Math.sin(w.k * (w.dx * x + w.dz * z) - w.w * t); }
    return h;
  };
  G.waveGLSL = (function () {
    const f = (n) => n.toFixed(5);
    let h = 'float waveH(vec2 p,float t){float h=0.;';
    let d = 'vec2 waveD(vec2 p,float t){vec2 g=vec2(0.);';
    for (const w of W) {
      const a = `${f(w.k)}*((${f(w.dx)})*p.x+(${f(w.dz)})*p.y)-${f(w.w)}*t`;
      h += `h+=${f(w.A)}*sin(${a});`;
      d += `g+=vec2(${f(w.dx)},${f(w.dz)})*${f(w.A * w.k)}*cos(${a});`;
    }
    return h + 'return h;}\n' + d + 'return g;}\n';
  })();

  /* ---------- Settings (persisted) ---------- */
  const DEF = { boat: 'sport', quality: 'high', blur: true, shake: true, volume: 0.8, laps: 3, difficulty: 'normal' };
  G.settings = Object.assign({}, DEF);
  try { Object.assign(G.settings, JSON.parse(localStorage.getItem('esbr_settings') || '{}')); } catch (e) { /* ignore */ }
  G.saveSettings = () => { try { localStorage.setItem('esbr_settings', JSON.stringify(G.settings)); } catch (e) { /* ignore */ } };
})(window.G);
