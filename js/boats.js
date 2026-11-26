'use strict';
/* Speed boats: procedural models, liveries, physics and AI drivers */
(function (G) {
  const U = G.U;

  G.BOATS = {
    sport: {
      key: 'sport', name: 'SPORT RACING', desc: 'Kapal ringan dengan akselerasi tinggi. Lincah dan mudah dikendalikan.',
      vmax: 46.5, accel: 17, brake: 22, turn: 1.3, response: 6, grip: 3.8, slipLimit: 0.46, lean: 0.32, L: 8.2, W: 2.5,
      stats: { speed: 72, accel: 95, handling: 90, stability: 88 }, pal: { base: '#f4f7fa', accent: '#00b7ff', accent2: '#ff6a00', dark: '#0d1b2a' },
    },
    power: {
      key: 'power', name: 'POWER RACING', desc: 'Mesin ganda bertenaga besar. Kecepatan maksimum tinggi di jalur lurus.',
      vmax: 56, accel: 11.5, brake: 20, turn: 1.0, response: 4.2, grip: 3.1, slipLimit: 0.38, lean: 0.26, L: 11, W: 2.7,
      stats: { speed: 92, accel: 66, handling: 64, stability: 74 }, pal: { base: '#d3121f', accent: '#f5f5f5', accent2: '#ffc400', dark: '#111316' },
    },
    extreme: {
      key: 'extreme', name: 'EXTREME RACING', desc: 'Katamaran balap F1. Performa superior, tetapi liar dan sulit dijinakkan.',
      vmax: 60.5, accel: 15.5, brake: 24, turn: 1.22, response: 7.5, grip: 2.1, slipLimit: 0.3, lean: 0.2, L: 9.6, W: 3.4,
      stats: { speed: 100, accel: 86, handling: 48, stability: 40 }, pal: { base: '#15171c', accent: '#b6ff00', accent2: '#ff2bd6', dark: '#07080a' },
    },
  };
  G.BOAT_KEYS = ['sport', 'power', 'extreme'];
  const AI_PALS = [
    { base: '#ffd21f', accent: '#111418', accent2: '#ff3b1f', dark: '#111418' },
    { base: '#1746ff', accent: '#ffffff', accent2: '#ffcf00', dark: '#0a1030' },
    { base: '#7a22ff', accent: '#ff8a00', accent2: '#ffffff', dark: '#160a2b' },
  ];
  G.AI_NAMES = ['VIPER', 'MARLIN', 'TSUNAMI'];

  /* ---------------- Hull loft ---------------- */
  function loftHull(o) {
    const NS = 30, L = o.L, pos = [], uv = [], idx = [], rings = [];
    for (let s = 0; s <= NS; s++) {
      const t = s / NS;
      const wp = t < o.maxAt ? U.lerp(o.sternW, 1, U.smooth(0, o.maxAt, t)) : 1 - Math.pow((t - o.maxAt) / (1 - o.maxAt), o.bowPow);
      const w = Math.max(0.02, wp) * o.W / 2, rise = Math.pow(t, 3.2);
      const keelY = -o.D * (1 - rise * 0.85), sheerY = o.H * (1 + 0.35 * t * t);
      const h = [[0, keelY], [w * 0.8, keelY * 0.3], [w, sheerY * 0.7], [w * 0.86, sheerY], [0, sheerY + o.crown * (1 - t * 0.6)]];
      rings.push([h[0], h[1], h[2], h[3], h[4], [-h[3][0], h[3][1]], [-h[2][0], h[2][1]], [-h[1][0], h[1][1]], h[0]]);
    }
    for (let p = 0; p < 8; p++) {
      const base = pos.length / 3;
      for (let s = 0; s <= NS; s++) {
        const t = s / NS, z = -L / 2 + L * t, a = rings[s][p], b = rings[s][p + 1];
        pos.push(a[0], a[1], z, b[0], b[1], z); uv.push(t, p / 8, t, (p + 1) / 8);
      }
      for (let s = 0; s < NS; s++) { const i = base + s * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
    }
    const tb = pos.length / 3, r0 = rings[0]; // transom
    pos.push(0, r0[2][1] * 0.3, -L / 2); uv.push(0.004, 1.5 / 8);
    for (let p = 0; p < 9; p++) { pos.push(r0[p][0], r0[p][1], -L / 2); uv.push(0.004, 1.5 / 8); }
    for (let p = 0; p < 8; p++) idx.push(tb, tb + 1 + p, tb + 2 + p);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }

  /* ---------------- Livery textures ---------------- */
  function livery(kind, pal) {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const x = c.getContext('2d'), bh = 64;
    const band = (p, draw) => {
      for (const pp of [p, 7 - p]) {
        x.save();
        if (pp < 4) x.setTransform(1024, 0, 0, bh, 0, pp * bh); else x.setTransform(1024, 0, 0, -bh, 0, (pp + 1) * bh);
        x.beginPath(); x.rect(0, 0, 1, 1); x.clip(); draw(); x.restore();
      }
    };
    const fill = (col) => { x.fillStyle = col; x.fillRect(0, 0, 1, 1); };
    const poly = (col, pts) => { x.fillStyle = col; x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.closePath(); x.fill(); };
    if (kind === 'sport') {
      band(0, () => { fill('#e9edf1'); poly(pal.dark, [[0, 0.55], [1, 0.8], [1, 1], [0, 1]]); });
      band(1, () => { fill(pal.base); poly(pal.accent, [[0.08, 0], [0.5, 0], [0.74, 1], [0.32, 1]]); poly(pal.accent2, [[0.52, 0], [0.57, 0], [0.81, 1], [0.76, 1]]); poly(pal.dark, [[0, 0], [0.06, 0], [0.3, 1], [0, 1]]); });
      band(2, () => fill(pal.dark));
      band(3, () => { fill(pal.base); poly(pal.accent, [[0, 0.62], [1, 0.8], [1, 1], [0, 1]]); poly(pal.dark, [[0.66, 0], [1, 0], [1, 0.8], [0.72, 0.62]]); poly(pal.accent2, [[0, 0.52], [0.7, 0.55], [0.7, 0.62], [0, 0.62]]); });
    } else if (kind === 'power') {
      band(0, () => fill(pal.dark));
      band(1, () => { fill(pal.base); poly(pal.accent, [[0, 0.38], [0.92, 0.5], [0.92, 0.62], [0, 0.62]]); poly(pal.accent2, [[0, 0.68], [0.86, 0.68], [0.86, 0.76], [0, 0.76]]); poly(pal.dark, [[0, 0], [0.22, 0], [0.32, 0.38], [0, 0.38]]); for (let i = 0; i < 4; i++) poly(pal.dark, [[0.36 + i * 0.05, 0.05], [0.385 + i * 0.05, 0.05], [0.405 + i * 0.05, 0.33], [0.38 + i * 0.05, 0.33]]); });
      band(2, () => fill(pal.accent2));
      band(3, () => { fill(pal.base); poly(pal.accent, [[0, 0.5], [1, 0.66], [1, 0.74], [0, 0.62]]); poly(pal.dark, [[0, 0.8], [1, 0.9], [1, 1], [0, 1]]); });
    } else {
      band(0, () => fill(pal.dark));
      band(1, () => { fill(pal.base); for (let i = 0; i < 5; i++) poly(i % 2 ? pal.accent2 : pal.accent, [[0.1 + i * 0.15, 0], [0.17 + i * 0.15, 0], [0.29 + i * 0.15, 1], [0.22 + i * 0.15, 1]]); });
      band(2, () => fill(pal.accent));
      band(3, () => { fill(pal.base); poly(pal.accent, [[0.2, 0], [0.55, 0], [0.7, 1], [0.35, 1]]); poly(pal.accent2, [[0.57, 0], [0.61, 0], [0.76, 1], [0.72, 1]]); });
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  }

  /* ---------------- Boat models ---------------- */
  function buildModel(spec, pal) {
    const grp = new THREE.Group(), flames = [], exhausts = [];
    const paint = new THREE.MeshPhysicalMaterial({ map: livery(spec.key, pal), roughness: 0.32, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.06, side: THREE.DoubleSide, envMapIntensity: 1.15 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.45, metalness: 0.6 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xdfe5ec, roughness: 0.15, metalness: 1 });
    const accent = new THREE.MeshPhysicalMaterial({ color: pal.accent, roughness: 0.3, metalness: 0.3, clearcoat: 1 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a1626, roughness: 0.04, metalness: 0.9, transparent: true, opacity: 0.72, envMapIntensity: 1.6 });
    const helmet = new THREE.MeshPhysicalMaterial({ color: pal.accent2, roughness: 0.2, clearcoat: 1 });
    const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.6, 6), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const add = (geo, mat, x, y, z, rx, ry, rz, parent) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0); m.castShadow = true; m.receiveShadow = true; (parent || grp).add(m); return m; };
    const engine = (x, y, z, s) => {
      add(new THREE.CapsuleGeometry(0.3 * s, 0.55 * s, 6, 12), dark, x, y + 0.42 * s, z, 0.25, 0, 0);
      add(new THREE.BoxGeometry(0.5 * s, 0.1, 0.9 * s), accent, x, y + 0.75 * s, z + 0.03, 0.25, 0, 0);
      add(new THREE.BoxGeometry(0.2 * s, 1.25, 0.34), dark, x, y - 0.35, z - 0.12);
      add(new THREE.CylinderGeometry(0.11, 0.16, 0.3, 10), chrome, x, y + 0.1, z - 0.42 * s, Math.PI / 2, 0, 0);
      const fg = new THREE.ConeGeometry(0.26, 2.6, 10, 1, true); fg.rotateX(-Math.PI / 2); fg.translate(0, 0, -1.3);
      const f = new THREE.Mesh(fg, flameMat); f.position.set(x, y + 0.1, z - 0.5 * s); f.visible = false; grp.add(f); flames.push(f);
      exhausts.push([x, y, z - 0.6]);
    };
    const wing = (y, z, w, chord, strutX) => {
      add(new THREE.BoxGeometry(w, 0.07, chord), accent, 0, y, z, -0.12, 0, 0);
      for (const s of [-1, 1]) { add(new THREE.BoxGeometry(0.06, 0.5, chord * 1.15), dark, s * w / 2, y + 0.08, z); add(new THREE.BoxGeometry(0.07, y - H + 0.1, 0.26), dark, s * strutX, (y + H) / 2, z + 0.05, 0.15, 0, 0); }
    };
    let H = spec.key === 'sport' ? 0.55 : spec.key === 'power' ? 0.6 : 0.5;
    if (spec.key === 'sport') {
      const hull = add(loftHull({ L: 8.2, W: 2.5, D: 0.55, H, crown: 0.14, maxAt: 0.42, bowPow: 2.0, sternW: 0.88 }), paint, 0, 0, 0);
      hull.castShadow = true;
      add(new THREE.BoxGeometry(1.5, 0.22, 2.4), dark, 0, H + 0.1, -0.9);
      add(new THREE.SphereGeometry(1, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, H + 0.12, 0.25, 0, 0, 0).scale.set(0.82, 0.62, 1.45);
      for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.5, 0.5, 0.55), dark, s * 0.38, H + 0.38, -1.25, -0.2, 0, 0);
      add(new THREE.SphereGeometry(0.2, 12, 10), helmet, -0.38, H + 0.78, -1.15);
      engine(0, H - 0.05, -4.0, 1.15);
      wing(H + 0.8, -3.0, 2.0, 0.5, 0.75);
      for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.08, 0.1, 3.2), chrome, s * 1.02, H * 0.72 + 0.1, 0.2);
    } else if (spec.key === 'power') {
      H = 0.6; add(loftHull({ L: 11, W: 2.7, D: 0.62, H, crown: 0.12, maxAt: 0.34, bowPow: 1.6, sternW: 0.92 }), paint, 0, 0, 0);
      add(new THREE.BoxGeometry(1.7, 0.2, 2.8), dark, 0, H + 0.1, -1.9);
      add(new THREE.SphereGeometry(1, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, H + 0.1, -0.5, 0, 0, 0).scale.set(0.95, 0.55, 1.5);
      for (const s of [-1, 1]) { add(new THREE.BoxGeometry(0.5, 0.55, 0.55), dark, s * 0.42, H + 0.4, -2.2, -0.2, 0, 0); add(new THREE.BoxGeometry(0.42, 0.16, 1.5), dark, s * 0.85, H + 0.2, -3.9, 0.08, 0, 0); }
      add(new THREE.SphereGeometry(0.2, 12, 10), helmet, -0.42, H + 0.82, -2.1);
      add(new THREE.BoxGeometry(1.25, 0.3, 2.2), accent, 0, H + 0.2, -4.2, 0.05, 0, 0);
      engine(-0.62, H - 0.05, -5.4, 1.05); engine(0.62, H - 0.05, -5.4, 1.05);
      wing(H + 1.15, -3.3, 2.5, 0.6, 0.95);
      add(new THREE.BoxGeometry(0.1, 0.06, 4.5), chrome, 0, H + 0.26, 2.4);
    } else {
      H = 0.5;
      for (const s of [-1, 1]) add(loftHull({ L: 9.6, W: 1.0, D: 0.5, H, crown: 0.08, maxAt: 0.3, bowPow: 1.5, sternW: 0.85 }), paint, s * 1.2, 0, 0);
      add(new THREE.BoxGeometry(2.3, 0.16, 5.2), dark, 0, H + 0.02, -1.6);
      add(loftHull({ L: 6.8, W: 1.5, D: 0.12, H: 0.42, crown: 0.2, maxAt: 0.4, bowPow: 1.9, sternW: 0.8 }), paint, 0, H, -0.9);
      add(new THREE.SphereGeometry(1, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, H + 0.42, -0.9, 0, 0, 0).scale.set(0.5, 0.5, 1.35);
      add(new THREE.SphereGeometry(0.19, 12, 10), helmet, 0, H + 0.62, -1.1);
      for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.5, 0.3, 1.3), accent, s * 0.62, H + 0.25, -3.3, 0.1, 0, 0);
      engine(-0.4, H + 0.05, -4.6, 1.0); engine(0.4, H + 0.05, -4.6, 1.0);
      wing(H + 1.5, -3.9, 3.3, 0.75, 1.2);
      for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.05, 0.55, 1.4), accent, s * 1.2, H + 0.45, -3.9);
    }
    return { grp, flames, exhausts, flameMat };
  }

  let blobTex = null;
  function blobTexture() {
    if (blobTex) return blobTex;
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,10,25,0.55)'); g.addColorStop(0.6, 'rgba(0,10,25,0.3)'); g.addColorStop(1, 'rgba(0,10,25,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); blobTex = new THREE.CanvasTexture(c); return blobTex;
  }

  /* ---------------- Boat ---------------- */
  class Boat {
    constructor(key, opts) {
      opts = opts || {};
      this.spec = G.BOATS[key]; this.isPlayer = !!opts.player; this.name = opts.name || 'YOU';
      this.pal = opts.pal || this.spec.pal; this.perf = opts.perf || 1; this.aLat = opts.aLat || 20; this.seed = Math.random() * 100;
      const m = buildModel(this.spec, this.pal);
      this.model = m.grp; this.flames = m.flames; this.exhausts = m.exhausts;
      this.mesh = new THREE.Group(); this.mesh.add(this.model); this.mesh.rotation.order = 'YXZ';
      const sg = new THREE.PlaneGeometry(this.spec.W * 2.3, this.spec.L * 1.35); sg.rotateX(-Math.PI / 2);
      this.shadow = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false }));
      this.shadow.renderOrder = 1;
      this.radius = this.spec.W * 0.5 + 0.35;
      this.color = this.pal.base === '#f4f7fa' || this.pal.base === '#15171c' ? this.pal.accent : this.pal.base;
      this.place(0, 0, 0);
    }
    addTo(scene) { scene.add(this.mesh); scene.add(this.shadow); }
    removeFrom(scene) { scene.remove(this.mesh); scene.remove(this.shadow); }
    place(x, z, yaw) {
      this.x = x; this.z = z; this.yaw = yaw; this.vx = this.vz = 0; this.yawRate = 0; this.y = 0; this.vy = 0; this.pitch = 0; this.roll = 0;
      this.steerVis = 0; this.unstable = 0; this.boosting = false; this.airborne = false; this.impact = 0; this.speed = 0; this.vF = 0; this.throttle = 0;
      this.idx = G.Track.P ? G.Track.nearestFull(x, z) : 0; this.lane = 0; this.laneTarget = 0; this.laneT = 0; this.stuck = 0; this.aiBoost = false;
    }
    resetRace() {
      this.nitro = 1; this.lap = 0; this.nextCp = 0; this.cpCount = 0; this.lastCp = -1; this.lapStart = 0; this.bestLap = Infinity; this.finished = false; this.finishTime = 0;
      this.maxSpeed = 0; this.progress = 0; this.gateD = -1; this.rank = 1; this.missed = false; this.wrongWay = 0;
    }
    update(dt, inp, time) {
      const sp = this.spec; let yaw = this.yaw;
      let fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -fz, rz = fx;
      let vF = this.vx * fx + this.vz * fz, vL = this.vx * rx + this.vz * rz;
      const air = this.airborne, ctl = air ? 0.2 : 1;
      const boosting = this.boosting = !!(inp.nitro && this.nitro > 0.02 && inp.throttle > 0.1);
      if (boosting) this.nitro = Math.max(0, this.nitro - dt / 4.2); else this.nitro = Math.min(1, this.nitro + dt / 24);
      const vmax = sp.vmax * this.perf * (boosting ? 1.28 : 1), acc = sp.accel * this.perf * (boosting ? 1.9 : 1);
      const r = vF / vmax;
      if (inp.throttle > 0) vF += acc * inp.throttle * Math.max(0, 1 - r * r) * ctl * dt;
      if (vF > vmax) vF -= (vF - vmax) * 1.1 * dt;
      if (inp.brake > 0 && !air) { if (vF > 0.5) vF -= sp.brake * inp.brake * dt; else if (vF > -9) vF -= 7 * inp.brake * dt; }
      vF -= vF * (inp.throttle > 0 ? 0.02 : 0.3) * dt * (air ? 0.2 : 1);
      const sr = U.clamp(Math.abs(vF) / sp.vmax, 0, 1.3), sr1 = Math.min(sr, 1);
      const auth = U.clamp(Math.abs(vF) / 8, 0, 1) * (1 - 0.45 * sr1) * (1 - 0.4 * this.unstable) * ctl;
      this.yawRate = U.damp(this.yawRate, inp.steer * sp.turn * auth * (vF < -0.5 ? -1 : 1), sp.response, dt);
      if (this.unstable > 0.05) this.yawRate += Math.sin(time * 13 + this.seed) * this.unstable * 1.5 * dt;
      // rotate hull, keep world momentum, then bleed lateral slip (drift)
      this.vx = fx * vF + rx * vL; this.vz = fz * vF + rz * vL;
      yaw += this.yawRate * dt; this.yaw = yaw;
      fx = Math.sin(yaw); fz = Math.cos(yaw); rx = -fz; rz = fx;
      vF = this.vx * fx + this.vz * fz; vL = this.vx * rx + this.vz * rz;
      const slip = Math.atan2(Math.abs(vL), Math.abs(vF) + 3);
      const grip = sp.grip * (1 - 0.55 * Math.abs(inp.steer) * sr1) * (1 - 0.5 * this.unstable) * (air ? 0.03 : 1);
      vL *= Math.exp(-grip * dt);
      if (!air) vF -= Math.sign(vF) * Math.abs(vL) * 0.22 * dt;
      if (slip > sp.slipLimit && sr > 0.45 && !air) this.unstable = Math.min(1, this.unstable + dt * (slip - sp.slipLimit) * 7 + dt * 0.4);
      else this.unstable = Math.max(0, this.unstable - dt * 0.9);
      this.vx = fx * vF + rx * vL; this.vz = fz * vF + rz * vL;
      this.x += this.vx * dt; this.z += this.vz * dt;
      this.vF = vF; this.vL = vL; this.speed = Math.hypot(this.vx, this.vz); this.sr = sr; this.slip = slip; this.throttle = inp.throttle;
      if (this.speed * 3.6 > this.maxSpeed) this.maxSpeed = this.speed * 3.6;
      // --- vertical motion over the waves
      const hl = sp.L * 0.4, hw = sp.W * 0.5;
      const hB = G.waveHeight(this.x + fx * hl, this.z + fz * hl, time), hS = G.waveHeight(this.x - fx * hl, this.z - fz * hl, time);
      const hR = G.waveHeight(this.x + rx * hw, this.z + rz * hw, time), hLf = G.waveHeight(this.x - rx * hw, this.z - rz * hw, time);
      const waterY = this.waterY = (hB + hS + hR + hLf) * 0.25, target = waterY + 0.12 * sr1;
      this.impact = 0;
      if (this.y <= target + 0.02) {
        if (air && this.vy < -2.5) this.impact = -this.vy;
        this.vy += ((target - this.y) * 70 - this.vy * 10) * dt;
      } else this.vy -= 17 * dt;
      this.y += this.vy * dt;
      this.airborne = this.y > target + 0.4;
      this.steerVis = U.damp(this.steerVis, inp.steer, 6, dt);
      let pT = -Math.atan2(hB - hS, hl * 2) - (0.03 + 0.07 * inp.throttle * (1 - sr1 * 0.6)) - (boosting ? 0.03 : 0);
      if (this.airborne) pT = this.pitch + 0.25 * dt;
      let rT = -Math.atan2(hR - hLf, hw * 2) - this.steerVis * sp.lean * sr1 * 1.1 + Math.sin(time * 9 + this.seed) * this.unstable * 0.22;
      this.pitch = U.damp(this.pitch, pT, 7, dt); this.roll = U.damp(this.roll, rT, 6, dt);
      this.sync(time);
    }
    sync(time) {
      this.mesh.position.set(this.x, this.y, this.z);
      this.mesh.rotation.set(this.pitch, this.yaw, this.roll);
      const sd = G.World.sunDir;
      this.shadow.position.set(this.x - sd.x * 1.2, G.waveHeight(this.x, this.z, time) + 0.12, this.z - sd.z * 1.2);
      this.shadow.rotation.y = this.yaw;
      this.shadow.material.opacity = U.clamp(1 - (this.y - (this.waterY || 0)) * 0.5, 0.2, 1);
      for (const f of this.flames) {
        f.visible = this.boosting;
        if (this.boosting) { const s = 0.8 + Math.random() * 0.5; f.scale.set(s, s, 0.8 + Math.random() * 0.7); }
      }
    }
  }
  G.Boat = Boat;
  G.aiPalette = (i) => AI_PALS[i % AI_PALS.length];

  /* ---------------- AI driver ---------------- */
  const NO_INPUT = { throttle: 0, brake: 0, steer: 0, nitro: false };
  G.noInput = NO_INPUT;
  G.aiControl = function (b, dt, boats) {
    const T = G.Track, N = T.N, sp = b.spec, v = b.speed;
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw), rx = -fz, rz = fx;
    b.laneT -= dt;
    if (b.laneT <= 0) { b.laneTarget = (Math.random() * 2 - 1) * T.halfWidth * 0.5; b.laneT = 3 + Math.random() * 5; }
    // hazard avoidance in the boat's own frame
    let avoid = 0; const range = 22 + v * 1.5;
    const consider = (ox, oz, or) => {
      const dx = ox - b.x, dz = oz - b.z, ahead = dx * fx + dz * fz;
      if (ahead < 1 || ahead > range) return;
      const side = dx * rx + dz * rz, clear = or + b.radius + 3.5;
      if (Math.abs(side) > clear) return;
      avoid += (side >= 0 ? -1 : 1) * (clear - Math.abs(side) + 2) * (1.2 - ahead / range);
    };
    for (const o of G.World.obstacles) consider(o.x, o.z, o.r);
    for (const c of G.World.colliders) consider(c.x, c.z, c.r);
    for (const o of boats) if (o !== b) consider(o.x, o.z, o.radius + 0.5);
    const curLat = T.lat(b.x, b.z, b.idx);
    const want = U.clamp((avoid !== 0 ? curLat + avoid * 1.6 : b.laneTarget), -T.halfWidth + 7, T.halfWidth - 7);
    b.lane = U.damp(b.lane, want, avoid !== 0 ? 5 : 1.5, dt);
    const look = 16 + v * 0.7, li = (b.idx + Math.round(look / T.seg)) % N;
    const tx = T.P[li * 2] + T.R[li * 2] * b.lane, tz = T.P[li * 2 + 1] + T.R[li * 2 + 1] * b.lane;
    const err = U.wrapAngle(Math.atan2(tx - b.x, tz - b.z) - b.yaw);
    const steer = U.clamp(err * 2.4 - b.yawRate * 0.22, -1, 1);
    // corner speed planning
    let vt = 999; const br = sp.brake * 0.65;
    for (let j = 0; j < 46; j += 2) {
      const i = (b.idx + j) % N, k = Math.abs(T.curv[i]), vc = Math.sqrt(b.aLat / Math.max(k, 1e-4));
      const allowed = Math.sqrt(vc * vc + 2 * br * j * T.seg); if (allowed < vt) vt = allowed;
    }
    if (Math.abs(err) > 0.5) vt = Math.min(vt, 18);
    const straight = vt > sp.vmax * 1.2 && Math.abs(err) < 0.12 && avoid === 0;
    if (!b.aiBoost && straight && b.nitro > 0.75 && Math.random() < dt * 0.6) b.aiBoost = true;
    if (b.aiBoost && (b.nitro < 0.08 || !straight)) b.aiBoost = false;
    return { throttle: v < vt ? 1 : 0, brake: v > vt + 4 ? 1 : 0, steer, nitro: b.aiBoost };
  };
})(window.G);
