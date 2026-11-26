'use strict';
/* Effects: water spray particles, foam wake trails, procedural audio */
(function (G) {
  const U = G.U, Fx = G.Fx = {};

  /* ---------------- Spray particles ---------------- */
  const MAXP = 3600;
  const S = Fx.spray = { n: MAXP, cur: 0, pos: new Float32Array(MAXP * 3), vel: new Float32Array(MAXP * 3), life: new Float32Array(MAXP), max: new Float32Array(MAXP), size0: new Float32Array(MAXP), size: new Float32Array(MAXP), alpha: new Float32Array(MAXP) };
  S.emit = function (x, y, z, vx, vy, vz, life, size) {
    const i = S.cur; S.cur = (S.cur + 1) % MAXP;
    S.pos[i * 3] = x; S.pos[i * 3 + 1] = y; S.pos[i * 3 + 2] = z; S.vel[i * 3] = vx; S.vel[i * 3 + 1] = vy; S.vel[i * 3 + 2] = vz;
    S.life[i] = S.max[i] = life; S.size0[i] = size;
  };
  S.burst = function (x, y, z, n, power) {
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, r = Math.random() * power; S.emit(x, y + 0.2, z, Math.cos(a) * r, (0.5 + Math.random()) * power * 0.9, Math.sin(a) * r, 0.6 + Math.random() * 0.7, 0.7 + Math.random() * 1.3); }
  };
  S.update = function (dt, time) {
    const drag = Math.exp(-1.3 * dt);
    for (let i = 0; i < MAXP; i++) {
      if (S.life[i] <= 0) { S.alpha[i] = 0; continue; }
      S.life[i] -= dt; const o = i * 3;
      S.vel[o + 1] -= 13 * dt; S.vel[o] *= drag; S.vel[o + 2] *= drag;
      S.pos[o] += S.vel[o] * dt; S.pos[o + 1] += S.vel[o + 1] * dt; S.pos[o + 2] += S.vel[o + 2] * dt;
      const k = Math.max(0, S.life[i] / S.max[i]);
      if (S.pos[o + 1] < -1.2) S.life[i] = 0;
      S.alpha[i] = Math.min(1, k * 1.6) * 0.42; S.size[i] = S.size0[i] * (1 + (1 - k) * 1.9);
    }
    const g = S.geo; g.attributes.position.needsUpdate = true; g.attributes.aSize.needsUpdate = true; g.attributes.aAlpha.needsUpdate = true;
  };
  /* emit bow spray + rooster tail for one boat */
  Fx.boatSpray = function (b, dt, detail) {
    if (b.airborne) return;
    const sr = Math.min(b.sr || 0, 1.3), sp = b.spec; if (sr < 0.08) return;
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw), rx = -fz, rz = fx, v = b.speed;
    const rate = sr * sr * (b.boosting ? 380 : 240) * detail; let n = rate * dt; n = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      if (Math.random() < 0.65) { // bow sheets
        const s = Math.random() < 0.5 ? -1 : 1, f = sp.L * (0.05 + Math.random() * 0.3), out = (3 + Math.random() * 7) * sr + Math.abs(b.vL || 0) * 0.3;
        S.emit(b.x + fx * f + rx * s * sp.W * 0.45, b.y + 0.1, b.z + fz * f + rz * s * sp.W * 0.45,
          b.vx * 0.55 + rx * s * out, (2 + Math.random() * 4.5) * sr, b.vz * 0.55 + rz * s * out, 0.45 + Math.random() * 0.45, 0.28 + Math.random() * 0.5);
      } else { // rooster tail
        const back = sp.L * 0.52, side = (Math.random() - 0.5) * sp.W * 0.5;
        S.emit(b.x - fx * back + rx * side, b.y + 0.05, b.z - fz * back + rz * side,
          b.vx * 0.25 + rx * (Math.random() - 0.5) * 3, (1.5 + Math.random() * 3.6) * sr * (b.boosting ? 1.5 : 1), b.vz * 0.25 + rz * (Math.random() - 0.5) * 3, 0.5 + Math.random() * 0.5, 0.3 + Math.random() * 0.6);
      }
    }
    if (b.impact > 0) S.burst(b.x + fx * sp.L * 0.2, b.y, b.z + fz * sp.L * 0.2, Math.min(60, 12 + b.impact * 7) * detail, 4 + b.impact);
    void v;
  };

  /* ---------------- Foam wake ribbon ---------------- */
  const WN = 72, WLIFE = 4.2;
  let foamTex = null;
  function foamTexture() {
    if (foamTex) return foamTex;
    const c = document.createElement('canvas'); c.width = 64; c.height = 256; const x = c.getContext('2d'), img = x.createImageData(64, 256);
    for (let j = 0; j < 256; j++) for (let i = 0; i < 64; i++) {
      const u = i / 63, edge = Math.sin(Math.PI * u), n = U.fbm(i * 0.22, j * 0.07, 4), core = Math.pow(edge, 0.7);
      const a = U.clamp((n * 1.7 - 0.45) * core + Math.pow(Math.abs(u - 0.5) * 2, 3) * 0.5 * edge, 0, 1), o = (j * 64 + i) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255; img.data[o + 3] = a * 255;
    }
    x.putImageData(img, 0, 0); foamTex = new THREE.CanvasTexture(c); foamTex.wrapT = THREE.RepeatWrapping; return foamTex;
  }
  class Wake {
    constructor(scene) {
      this.pts = []; this.dist = 0;
      const g = this.geo = new THREE.BufferGeometry();
      this.pos = new Float32Array(WN * 2 * 3); this.col = new Float32Array(WN * 2 * 4); this.uv = new Float32Array(WN * 2 * 2);
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 4)); g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
      const idx = []; for (let i = 0; i < WN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      g.setIndex(idx);
      this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: foamTexture(), vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: false }));
      this.mesh.frustumCulled = false; this.mesh.renderOrder = 2; scene.add(this.mesh);
    }
    clear() { this.pts.length = 0; this.geo.setDrawRange(0, 0); }
    update(dt, b, time) {
      const pts = this.pts, fx = Math.sin(b.yaw), fz = Math.cos(b.yaw), back = b.spec.L * 0.45;
      const sx = b.x - fx * back, sz = b.z - fz * back;
      for (const p of pts) p.age += dt;
      while (pts.length && pts[pts.length - 1].age > WLIFE) pts.pop();
      const head = pts[0];
      if (!b.airborne && b.speed > 2.5 && (!head || Math.hypot(head.x - sx, head.z - sz) > 1.6)) {
        this.dist += head ? Math.hypot(head.x - sx, head.z - sz) : 0;
        pts.unshift({ x: sx, z: sz, rx: -fz, rz: fx, age: 0, str: U.clamp(b.speed / 30, 0.15, 1), d: this.dist, w: b.spec.W * 0.42 });
        if (pts.length > WN - 1) pts.pop();
      }
      let n = 0;
      const put = (x, z, rx, rz, hw, a, d) => {
        const y = G.waveHeight(x, z, time) + 0.1, o = n * 6, c = n * 8, u = n * 4;
        this.pos[o] = x - rx * hw; this.pos[o + 1] = G.waveHeight(x - rx * hw, z - rz * hw, time) + 0.1; this.pos[o + 2] = z - rz * hw;
        this.pos[o + 3] = x + rx * hw; this.pos[o + 4] = G.waveHeight(x + rx * hw, z + rz * hw, time) + 0.1; this.pos[o + 5] = z + rz * hw;
        for (let k = 0; k < 2; k++) { this.col[c + k * 4] = this.col[c + k * 4 + 1] = this.col[c + k * 4 + 2] = 1.15; this.col[c + k * 4 + 3] = a; }
        this.uv[u] = 0; this.uv[u + 1] = d / 9; this.uv[u + 2] = 1; this.uv[u + 3] = d / 9; n++; void y;
      };
      if (pts.length && !b.airborne) put(sx, sz, -fz, fx, b.spec.W * 0.4, U.clamp(b.speed / 25, 0, 1) * 0.7, this.dist + Math.hypot(pts[0].x - sx, pts[0].z - sz));
      for (let i = 0; i < pts.length && n < WN; i++) {
        const p = pts[i], k = 1 - p.age / WLIFE;
        put(p.x, p.z, p.rx, p.rz, p.w + p.age * 1.7, p.str * Math.pow(k, 1.6) * 0.75, p.d);
      }
      this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true; this.geo.attributes.uv.needsUpdate = true;
      this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
    }
  }
  Fx.Wake = Wake;

  Fx.init = function (scene) {
    const g = S.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(S.pos, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(S.size, 1)); g.setAttribute('aAlpha', new THREE.BufferAttribute(S.alpha, 1));
    S.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, uniforms: { uScale: { value: 600 } },
      vertexShader: 'attribute float aSize; attribute float aAlpha; uniform float uScale; varying float vA; void main(){ vA=aAlpha; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=min(aSize*uScale/max(-mv.z,0.5),220.); gl_Position=projectionMatrix*mv; }',
      fragmentShader: 'varying float vA; void main(){ if(vA<0.004) discard; float d=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.12,d)*vA; gl_FragColor=vec4(vec3(1.25,1.3,1.35),a); }',
    });
    const pts = new THREE.Points(g, S.mat); pts.frustumCulled = false; pts.renderOrder = 5; scene.add(pts);
  };

  /* ---------------- Audio (fully procedural, Web Audio API) ---------------- */
  const A = G.Audio = { ctx: null, ready: false, vol: G.settings.volume };
  A.init = function () {
    if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = A.ctx = new AC();
    A.master = ctx.createGain(); A.master.gain.value = A.vol;
    const comp = ctx.createDynamicsCompressor(); A.master.connect(comp); comp.connect(ctx.destination);
    const len = ctx.sampleRate * 2, white = ctx.createBuffer(1, len, ctx.sampleRate), brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const dw = white.getChannelData(0), db = brown.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; dw[i] = w; last = (last + 0.02 * w) / 1.02; db[i] = last * 3.5; }
    A.white = white;
    const loop = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
    const node = (type, f, q) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q) n.Q.value = q; return n; };
    const gain = (v, dest) => { const n = ctx.createGain(); n.gain.value = v; n.connect(dest || A.master); return n; };
    // ocean ambience
    const og = gain(0.42), of = node('lowpass', 520); loop(brown).connect(of); of.connect(og);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11; const lg = ctx.createGain(); lg.gain.value = 0.2; lfo.connect(lg); lg.connect(og.gain); lfo.start();
    const hiss = gain(0.035), hf = node('bandpass', 2600, 0.6); loop(white).connect(hf); hf.connect(hiss);
    // engine
    A.eg = gain(0); A.ef = node('lowpass', 500, 1.2); A.ef.connect(A.eg);
    A.oscs = [['sawtooth', 1, 0.42], ['sawtooth', 2.01, 0.2], ['square', 0.5, 0.36], ['sawtooth', 1.5, 0.12]].map(([type, mul, g]) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = 60 * mul; o.connect(gain(g, A.ef)); o.start(); return { o, mul };
    });
    const am = ctx.createOscillator(); am.type = 'sine'; am.frequency.value = 17; const amg = ctx.createGain(); amg.gain.value = 0.05; am.connect(amg); amg.connect(A.eg.gain); am.start(); A.am = am;
    // hull water rush
    A.wg = gain(0); const wf = A.wf = node('bandpass', 900, 0.5); loop(white).connect(wf); wf.connect(A.wg);
    // nitro
    A.ng = gain(0); const nf = node('bandpass', 2200, 1.4); loop(white).connect(nf); nf.connect(A.ng);
    A.no = ctx.createOscillator(); A.no.type = 'sawtooth'; A.no.frequency.value = 320; A.nog = gain(0, nf); A.no.connect(A.nog); A.no.start();
    A.ready = true;
  };
  A.setVolume = function (v) { A.vol = v; if (A.master) A.master.gain.setTargetAtTime(v, A.ctx.currentTime, 0.05); };
  A.update = function (s) {
    if (!A.ready) return; const t = A.ctx.currentTime, f = 48 + (s.rpm / 8000) * 150;
    for (const o of A.oscs) o.o.frequency.setTargetAtTime(f * o.mul, t, 0.05);
    A.am.frequency.setTargetAtTime(f / 4, t, 0.1);
    A.eg.gain.setTargetAtTime(s.active ? 0.09 + 0.15 * s.throttle : 0, t, 0.08);
    A.ef.frequency.setTargetAtTime(350 + (s.rpm / 8000) * 2800 * (0.45 + 0.55 * s.throttle), t, 0.08);
    A.wg.gain.setTargetAtTime(s.active ? Math.min(1, s.sr * s.sr) * 0.32 : 0, t, 0.1);
    A.wf.frequency.setTargetAtTime(700 + s.sr * 900, t, 0.1);
    A.ng.gain.setTargetAtTime(s.active && s.boost ? 0.42 : 0, t, 0.06);
    A.nog.gain.setTargetAtTime(s.active && s.boost ? 0.5 : 0, t, 0.06);
    A.no.frequency.setTargetAtTime(s.boost ? 520 : 300, t, 0.3);
  };
  function burst(type, freq, q, vol, dur, sweep) {
    const ctx = A.ctx, t = ctx.currentTime, s = ctx.createBufferSource(); s.buffer = A.white;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur); f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(A.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  function tone(freq, dur, vol, type, to, delay) {
    const ctx = A.ctx, t = ctx.currentTime + (delay || 0), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(A.master); o.start(t); o.stop(t + dur + 0.05);
  }
  A.play = function (name, v) {
    if (!A.ready) return; v = v === undefined ? 1 : v;
    if (name === 'splash') burst('bandpass', 1900, 0.7, 0.5 * v, 0.55, 600);
    else if (name === 'crash') { burst('lowpass', 900, 0.8, 0.9 * v, 0.4, 150); tone(95, 0.35, 0.6 * v, 'sine', 40); tone(310, 0.12, 0.2 * v, 'square', 120); }
    else if (name === 'beep') tone(440, 0.22, 0.35, 'square');
    else if (name === 'go') tone(880, 0.6, 0.4, 'square');
    else if (name === 'checkpoint') { tone(880, 0.14, 0.3, 'sine'); tone(1320, 0.3, 0.3, 'sine', 0, 0.1); }
    else if (name === 'lap') { tone(660, 0.14, 0.3, 'triangle'); tone(880, 0.14, 0.3, 'triangle', 0, 0.12); tone(1320, 0.4, 0.3, 'triangle', 0, 0.24); }
    else if (name === 'finish') { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.5, 0.3, 'triangle', 0, i * 0.14)); }
    else if (name === 'nitro') { burst('bandpass', 500, 1.2, 0.6, 0.7, 4000); tone(160, 0.5, 0.3, 'sawtooth', 640); }
    else if (name === 'click') tone(700, 0.06, 0.15, 'square');
  };
})(window.G);
