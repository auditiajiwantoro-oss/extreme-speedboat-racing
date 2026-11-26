'use strict';
/* EXTREME SPEED BOAT RACING — renderer, game loop, race rules, camera, HUD, menus */
(function (G) {
  const U = G.U, S = G.settings, T = G.Track, W = G.World, Fx = G.Fx, A = G.Audio;
  const $ = (id) => document.getElementById(id);
  const game = G.game = { state: 'menu', screen: 'main', boats: [], player: null, time: 0, raceTime: 0, countdown: 0, lastCount: 0, laps: 3, finishDelay: 0, autopilot: false, steer: 0, crashCd: 0, rpm: 900, gear: 1, blur: 0, resT: 0 };
  let renderer, scene, camera, rt, postScene, postCam, postMat;
  const keys = {};
  const cam = { yaw: 0, shake: 0, fov: 55, orbit: 0.6, dist: 12, look: new THREE.Vector3(), tmp: new THREE.Vector3() };
  const SUF = ['ST', 'ND', 'RD', 'TH'];

  window.addEventListener('error', (e) => { $('err').textContent += (e.message || e) + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno + '\n'; });

  /* ---------------- Init ---------------- */
  function init() {
    renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: false, powerPreference: 'high-performance' });
    renderer.toneMapping = THREE.NoToneMapping; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(55, 1, 0.5, 14000);
    T.build(); W.build(scene, renderer); Fx.init(scene);
    postScene = new THREE.Scene(); postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    postMat = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null }, uBlur: { value: 0 }, uExposure: { value: 0.95 }, uBoost: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform float uBlur; uniform float uExposure; uniform float uBoost; varying vec2 vUv;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.,1.); }
void main(){
  vec2 dir=vUv-vec2(0.5,0.46); float dl=length(dir); vec3 col;
  if(uBlur>0.0005){ col=vec3(0.); float tot=0.; float m=smoothstep(0.08,0.62,dl)*uBlur;
    for(int i=0;i<12;i++){ float f=float(i)/11.; float w=1.-f*0.6; col+=texture2D(tDiffuse,vUv-dir*f*m).rgb*w; tot+=w; } col/=tot; }
  else col=texture2D(tDiffuse,vUv).rgb;
  col*=uExposure; col+=vec3(0.02,0.07,0.16)*uBoost*dl*dl*2.;
  col=aces(col); col=pow(col,vec3(1./2.2));
  col*=1.-0.38*dl*dl;
  gl_FragColor=vec4(col,1.);
}`,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat); quad.frustumCulled = false; postScene.add(quad);
    applyQuality(); buildBoats(); placeGrid(); bindUI(); refreshBoatCard(); refreshSettingsUI(); buildMinimapBase();
    window.addEventListener('resize', applyQuality);
    let last = performance.now();
    const loop = (now) => { requestAnimationFrame(loop); const dt = Math.min(0.05, (now - last) / 1000); last = now; frame(dt); };
    requestAnimationFrame(loop);
  }

  function applyQuality() {
    const q = S.quality, dpr = window.devicePixelRatio || 1;
    const pr = q === 'high' ? Math.min(dpr, 1.5) : q === 'medium' ? Math.min(dpr, 1.15) : Math.min(dpr, 1) * 0.8;
    const w = Math.max(2, window.innerWidth), h = Math.max(2, window.innerHeight);
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
    if (rt) rt.dispose();
    rt = new THREE.WebGLRenderTarget(Math.floor(w * pr), Math.floor(h * pr), { type: THREE.HalfFloatType, samples: q === 'high' ? 4 : q === 'medium' ? 2 : 0, depthBuffer: true });
    postMat.uniforms.tDiffuse.value = rt.texture;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const sh = q !== 'low';
    if (renderer.shadowMap.enabled !== sh) { renderer.shadowMap.enabled = sh; W.sun.castShadow = sh; scene.traverse((o) => { if (o.material && !Array.isArray(o.material)) o.material.needsUpdate = true; }); }
  }

  /* ---------------- Boats / grid ---------------- */
  function buildBoats() {
    for (const b of game.boats) { b.removeFrom(scene); scene.remove(b.wake.mesh); }
    game.boats = [];
    const diff = { easy: [0.88, 0.92, 0.95], normal: [0.94, 0.975, 1.0], hard: [0.99, 1.02, 1.05] }[S.difficulty] || [0.94, 0.975, 1.0];
    const aLat = { easy: [14, 16, 18], normal: [18, 21, 24], hard: [22, 25, 28] }[S.difficulty] || [18, 21, 24];
    const ps = G.BOATS[S.boat], others = G.BOAT_KEYS.filter((k) => k !== S.boat), types = [others[0], others[1], S.boat];
    for (let i = 0; i < 3; i++) game.boats.push(new G.Boat(types[i], { name: G.AI_NAMES[i], pal: G.aiPalette(i), perf: (ps.vmax * diff[i]) / G.BOATS[types[i]].vmax, aLat: aLat[i] }));
    game.player = new G.Boat(S.boat, { player: true, name: 'YOU' });
    game.boats.push(game.player);
    for (const b of game.boats) { b.addTo(scene); b.wake = new Fx.Wake(scene); b.resetRace(); }
  }
  function gateDist(b) { const g = T.gates[b.nextCp]; return (b.x - g.x) * g.tx + (b.z - g.z) * g.tz; }
  function placeGrid() {
    const slots = [[14, -9], [14, 9], [30, -9], [30, 9]];
    game.boats.forEach((b, i) => {
      const idx = (T.N - Math.round(slots[i][0] / T.seg)) % T.N, p = T.point(idx, slots[i][1]);
      b.place(p.x, p.z, Math.atan2(p.tx, p.tz)); b.resetRace(); b.gateD = gateDist(b); b.wake.clear(); b.sync(game.time);
    });
  }
  function resetBoat(b) {
    let idx, lat = 0;
    if (b.lastCp >= 0) idx = (T.gates[b.lastCp].idx + 3) % T.N; else { idx = T.N - 8; lat = 9; }
    for (let k = 0; k < 6; k++) { const p = T.point(idx, lat); if (!game.boats.some((o) => o !== b && Math.hypot(o.x - p.x, o.z - p.z) < 8)) break; lat += 9 * (k % 2 ? -1 : 1) * (k + 1); lat = U.clamp(lat, -24, 24); }
    const p = T.point(idx, lat);
    b.place(p.x, p.z, Math.atan2(p.tx, p.tz)); b.gateD = gateDist(b); b.missed = false; b.wake.clear();
    if (b.isPlayer) { cam.yaw = b.yaw; Fx.spray.burst(b.x, 0, b.z, 30, 5); A.play('splash', 0.6); }
  }

  /* ---------------- Race flow ---------------- */
  function fadeThen(fn) { const f = $('fade'); f.classList.add('on'); setTimeout(() => { fn(); f.classList.remove('on'); }, 460); }
  function startRace() {
    A.init();
    fadeThen(() => {
      buildBoats(); placeGrid(); W.resetObstacles(); W.setNextGate(0);
      game.laps = S.laps; game.raceTime = 0; game.countdown = 3.999; game.lastCount = 4; game.finishDelay = 0; game.autopilot = false; game.steer = 0;
      game.state = 'countdown'; cam.yaw = game.player.yaw; cam.shake = 0;
      $('menu').classList.add('off'); $('hud').classList.remove('hidden'); $('pause').classList.add('hidden'); $('results').classList.add('hidden');
      $('lapTot').textContent = game.laps; $('posTot').textContent = game.boats.length; $('countdown').innerHTML = ''; $('warn').textContent = '';
      $('cpPips').innerHTML = '<i></i>'.repeat(T.K);
      snapCamera();
    });
  }
  function toMenu() {
    fadeThen(() => {
      game.state = 'menu'; placeGrid(); W.resetObstacles(); W.setNextGate(0);
      $('menu').classList.remove('off'); $('hud').classList.add('hidden'); $('pause').classList.add('hidden'); $('results').classList.add('hidden'); $('countdown').innerHTML = '';
      showScreen('main');
    });
  }
  function togglePause() {
    if (game.state === 'racing' || game.state === 'countdown') { game.prevState = game.state; game.state = 'paused'; $('pause').classList.remove('hidden'); }
    else if (game.state === 'paused') { game.state = game.prevState; $('pause').classList.add('hidden'); }
  }
  let msgTimer = 0;
  function msg(text, sub) { const m = $('msg'); m.innerHTML = text + (sub ? '<small>' + sub + '</small>' : ''); m.classList.add('show'); msgTimer = 1.8; }
  function showCount(v) { $('countdown').innerHTML = '<span class="' + (v === 'GO!' ? 'go' : '') + '">' + v + '</span>'; }

  function passGate(b) {
    const K = T.K; b.cpCount++; b.lastCp = b.nextCp;
    if (b.nextCp === 0) {
      if (b.lap >= 1) { const lt = game.raceTime - b.lapStart; if (lt < b.bestLap) b.bestLap = lt; b.lastLap = lt; }
      if (b.lap >= game.laps) {
        b.finished = true; b.finishTime = game.raceTime; b.finalRank = game.boats.filter((o) => o.finished).length;
        if (b.isPlayer) { msg('FINISH!', U.fmtTime(b.finishTime)); A.play('finish'); game.finishDelay = 3.2; }
      } else {
        b.lap++; b.lapStart = game.raceTime;
        if (b.isPlayer && b.lap > 1) { msg(b.lap === game.laps ? 'FINAL LAP' : 'LAP ' + b.lap, 'LAST LAP ' + U.fmtTime(b.lastLap)); A.play('lap'); }
      }
    } else if (b.isPlayer) { msg('CHECKPOINT', b.nextCp + 1 + ' / ' + K); A.play('checkpoint'); }
    b.nextCp = (b.nextCp + 1) % K; b.gateD = gateDist(b);
    if (b.isPlayer) W.setNextGate(b.finished ? -1 : b.nextCp);
  }
  function progress(b, dt) {
    const N = T.N, K = T.K;
    b.idx = T.nearest(b.x, b.z, b.idx);
    let g = T.gates[b.nextCp];
    const d = (b.x - g.x) * g.tx + (b.z - g.z) * g.tz, lat = (b.x - g.x) * g.rx + (b.z - g.z) * g.rz;
    if (!b.finished && b.gateD < 0 && d >= 0 && d < 25 && Math.abs(lat) < T.halfWidth + 3) passGate(b); else b.gateD = d;
    g = T.gates[b.nextCp];
    const toGate = (g.idx - b.idx + N) % N, ahead = (b.idx - g.idx + N) % N;
    b.progress = b.cpCount + (toGate > N / 2 ? 0 : 1 - Math.min(1, toGate / (N / K)));
    b.missed = !b.finished && ahead > 10 && ahead < N / 2;
    const dot = Math.sin(b.yaw) * T.T[b.idx * 2] + Math.cos(b.yaw) * T.T[b.idx * 2 + 1];
    b.wrongWay = dot < -0.25 && b.vF > 4 ? b.wrongWay + dt : 0;
    b.offTrack = Math.hypot(b.x - T.P[b.idx * 2], b.z - T.P[b.idx * 2 + 1]);
  }
  function rank() {
    const list = game.boats.slice().sort((a, b) => (a.finished && b.finished ? a.finishTime - b.finishTime : a.finished ? -1 : b.finished ? 1 : b.progress - a.progress));
    list.forEach((b, i) => { b.rank = i + 1; });
    game.order = list;
  }

  /* ---------------- Collisions ---------------- */
  function resolve(b, off, cx, cz, cr, e) {
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw), px = b.x + fx * off, pz = b.z + fz * off;
    const dx = px - cx, dz = pz - cz, min = cr + b.radius, d2 = dx * dx + dz * dz;
    if (d2 >= min * min || d2 < 1e-6) return 0;
    const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
    b.x += nx * (min - d); b.z += nz * (min - d);
    const vn = b.vx * nx + b.vz * nz;
    if (vn >= 0) return 0;
    b.vx -= (1 + e) * vn * nx; b.vz -= (1 + e) * vn * nz; b.vx *= 0.93; b.vz *= 0.93;
    b.yawRate += Math.sign(off) * (fz * nx - fx * nz) * Math.min(-vn, 25) * 0.05;
    return -vn;
  }
  function collide(b) {
    let hit = 0; const offs = [b.spec.L * 0.28, -b.spec.L * 0.28];
    for (const off of offs) {
      for (const c of W.colliders) { if (Math.abs(c.x - b.x) > 30 || Math.abs(c.z - b.z) > 30) continue; hit = Math.max(hit, resolve(b, off, c.x, c.z, c.r, 0.3)); }
      for (const isl of W.islands) {
        const ddx = b.x - isl.x, ddz = b.z - isl.z; if (ddx * ddx + ddz * ddz > isl.R * isl.R * 1.7) continue;
        const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw), px = b.x + fx * off, pz = b.z + fz * off;
        if (W.islandHeight(isl, px, pz) > -0.6) {
          let nx = px - isl.x, nz = pz - isl.z; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
          b.x += nx * 0.7; b.z += nz * 0.7; const vn = b.vx * nx + b.vz * nz;
          if (vn < 0) { b.vx -= 1.25 * vn * nx; b.vz -= 1.25 * vn * nz; b.vx *= 0.9; b.vz *= 0.9; hit = Math.max(hit, -vn); }
        }
      }
      for (const o of W.obstacles) {
        const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw), px = b.x + fx * off, pz = b.z + fz * off;
        const dx = o.x - px, dz = o.z - pz, min = o.r + b.radius, d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, vn = (b.vx - o.vx) * nx + (b.vz - o.vz) * nz;
        o.x = px + nx * min; o.z = pz + nz * min;
        if (vn > 0) {
          o.vx += nx * vn * 1.15; o.vz += nz * vn * 1.15; o.spin += (Math.random() - 0.5) * vn * 0.35;
          const loss = Math.min(0.3, vn * 0.011); b.vx *= 1 - loss; b.vz *= 1 - loss; b.yawRate += (Math.random() - 0.5) * vn * 0.025;
          hit = Math.max(hit, vn * 0.6);
          Fx.spray.burst(o.x, 0, o.z, 14, 3 + vn * 0.25);
        }
      }
    }
    // buoys: glancing bump + splash
    const k = Math.round(b.idx / 10) % (T.N / 10);
    for (let s = 0; s < 2; s++) {
      const bu = W.buoys[k * 2 + s]; if (!bu || bu.hit > 0.3) continue;
      if (Math.hypot(bu.x - b.x, bu.z - b.z) < b.radius + 1.6) { bu.hit = 1; b.vx *= 0.96; b.vz *= 0.96; Fx.spray.burst(bu.x, 0, bu.z, 22, 4 + b.speed * 0.12); if (b.isPlayer) { A.play('splash', 0.8); cam.shake += 0.12; } }
    }
    return hit;
  }
  function collideBoats() {
    const bs = game.boats;
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], b = bs[j], dx = b.x - a.x, dz = b.z - a.z, min = a.radius + b.radius + 1.4, d2 = dx * dx + dz * dz;
      if (d2 >= min * min || d2 < 1e-6) continue;
      const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, pen = (min - d) / 2;
      a.x -= nx * pen; a.z -= nz * pen; b.x += nx * pen; b.z += nz * pen;
      const vn = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
      if (vn > 0) {
        const imp = vn * 0.65; a.vx -= nx * imp; a.vz -= nz * imp; b.vx += nx * imp; b.vz += nz * imp;
        if (vn > 2.5 && (a.isPlayer || b.isPlayer)) crash(vn * 0.7, (a.x + b.x) / 2, (a.z + b.z) / 2);
      }
    }
  }
  function crash(imp, x, z) {
    Fx.spray.burst(x, 0, z, Math.min(50, 10 + imp * 3), 3 + imp * 0.3);
    if (game.crashCd <= 0) { A.play('crash', U.clamp(imp / 18, 0.25, 1)); game.crashCd = 0.25; }
    cam.shake += Math.min(0.9, imp * 0.045);
  }

  /* ---------------- Simulation ---------------- */
  function playerInput(dt) {
    const target = ((keys.KeyA || keys.ArrowLeft) ? 1 : 0) - ((keys.KeyD || keys.ArrowRight) ? 1 : 0);
    const rate = (target === 0 || Math.sign(target) !== Math.sign(game.steer) ? 7 : 3.6) * dt;
    game.steer += U.clamp(target - game.steer, -rate, rate);
    return { throttle: (keys.KeyW || keys.ArrowUp) ? 1 : 0, brake: (keys.KeyS || keys.ArrowDown) ? 1 : 0, steer: game.steer, nitro: !!keys.Space };
  }
  function simulate(dt) {
    game.time += dt; const t = game.time, p = game.player;
    const running = game.state === 'racing' || game.state === 'finished';
    game.crashCd -= dt;
    if (game.state === 'countdown') {
      game.countdown -= dt; const n = Math.ceil(game.countdown);
      if (n !== game.lastCount) { game.lastCount = n; if (n > 0) { showCount(n); A.play('beep'); } else { showCount('GO!'); A.play('go'); game.state = 'racing'; } }
    }
    if (running) game.raceTime += dt;
    const wasBoost = p.boosting;
    for (const b of game.boats) {
      let inp = G.noInput;
      if (running) {
        if (b.isPlayer && !b.finished && !game.autopilot) inp = playerInput(dt);
        else { inp = G.aiControl(b, dt, game.boats); if (b.finished) inp.throttle *= b.speed < 26 ? 1 : 0; }
      }
      b.update(dt, inp, t);
    }
    if (p.boosting && !wasBoost) A.play('nitro');
    for (const b of game.boats) {
      const hit = collide(b);
      if (hit > 3 && b.isPlayer) crash(hit, b.x + Math.sin(b.yaw) * 3, b.z + Math.cos(b.yaw) * 3);
      else if (hit > 3) Fx.spray.burst(b.x, 0, b.z, 12, 4);
    }
    collideBoats();
    if (running) {
      for (const b of game.boats) {
        progress(b, dt);
        if (!b.isPlayer || game.autopilot || b.finished) {
          b.stuck = b.speed < 2.5 ? b.stuck + dt : 0;
          if (b.stuck > 2.5 || b.missed || b.offTrack > 90) { resetBoat(b); b.stuck = 0; }
        }
      }
      rank();
      if (p.finished && game.state === 'racing') { game.finishDelay -= dt; if (game.finishDelay <= 0) showResults(); }
    }
    const detail = S.quality === 'low' ? 0.5 : 1;
    for (const b of game.boats) {
      Fx.boatSpray(b, dt, b.isPlayer ? detail : detail * 0.45);
      b.wake.update(dt, b, t);
      b.sync(t);
    }
    if (p.impact > 0) { cam.shake += Math.min(0.5, p.impact * 0.05); if (p.impact > 4) A.play('splash', U.clamp(p.impact / 10, 0.3, 1)); }
    Fx.spray.update(dt, t);
  }

  /* ---------------- Camera ---------------- */
  function snapCamera() { const p = game.player; cam.yaw = p.yaw; camera.position.set(p.x - Math.sin(p.yaw) * 12, 4.5, p.z - Math.cos(p.yaw) * 12); cam.look.set(p.x, 1.5, p.z); }
  function updateCamera(dt) {
    const p = game.player, t = game.time; let fovT = 55;
    if (game.state === 'menu') {
      const boats = game.screen === 'boats';
      cam.orbit += dt * (boats ? 0.4 : 0.12);
      const r = boats ? 16 : 17, h = boats ? 4.6 : 5.2, o = cam.orbit;
      cam.tmp.set(p.x + Math.sin(o) * r, p.y + h, p.z + Math.cos(o) * r);
      camera.position.lerp(cam.tmp, 1 - Math.exp(-2.5 * dt));
      const shift = boats ? 0 : -4.2;
      cam.tmp.set(p.x + Math.cos(o) * shift, p.y + (boats ? -1.6 : 1.2), p.z - Math.sin(o) * shift);
      cam.look.lerp(cam.tmp, 1 - Math.exp(-4 * dt)); fovT = boats ? 42 : 48;
    } else {
      const sr = Math.min(p.speed / p.spec.vmax, 1.3), boost = p.boosting ? 1 : 0;
      const vdir = p.speed > 6 && p.vF > 0 ? Math.atan2(p.vx, p.vz) : p.yaw;
      const ty = p.yaw + U.wrapAngle(vdir - p.yaw) * 0.45;
      cam.yaw += U.wrapAngle(ty - cam.yaw) * (1 - Math.exp(-5.5 * dt));
      cam.dist = U.damp(cam.dist, 11 + sr * 2.6 + boost * 1.6, 3, dt);
      const cx = p.x - Math.sin(cam.yaw) * cam.dist, cz = p.z - Math.cos(cam.yaw) * cam.dist;
      const cy = Math.max(Math.max(p.y, 0) + 3.9 + sr * 0.5, G.waveHeight(cx, cz, t) + 1.4);
      camera.position.set(cx, U.damp(camera.position.y, cy, 5, dt), cz);
      cam.look.set(p.x + Math.sin(p.yaw) * 5, U.damp(cam.look.y, Math.max(p.y, -0.5) + 1.7, 6, dt), p.z + Math.cos(p.yaw) * 5);
      fovT = 60 + Math.min(sr, 1) * 13 + boost * 9;
      cam.shake = Math.max(0, cam.shake - dt * 1.8);
      if (S.shake && game.state !== 'paused') {
        const a = Math.min(1.2, cam.shake) + sr * sr * sr * 0.035 + boost * 0.05;
        camera.position.x += (Math.sin(t * 47) + Math.sin(t * 31.3)) * a * 0.22;
        camera.position.y += (Math.sin(t * 53.1) + Math.cos(t * 29.7)) * a * 0.22;
        cam.look.y += Math.sin(t * 41.3) * a * 0.3;
      }
    }
    cam.fov = U.damp(cam.fov, fovT, 4, dt);
    if (Math.abs(camera.fov - cam.fov) > 0.01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
    camera.lookAt(cam.look);
  }

  /* ---------------- Frame ---------------- */
  function frame(dt) {
    if (game.state !== 'paused') { const n = Math.min(4, Math.max(1, Math.ceil(dt / (1 / 90)))); for (let i = 0; i < n; i++) simulate(dt / n); }
    if (game.noRender) return; // test hook: simulate without drawing
    updateCamera(dt);
    const p = game.player, racing = game.state === 'racing' || game.state === 'finished';
    W.update(game.state === 'paused' ? 0 : dt, game.time, camera, p);
    const sr = Math.min(p.speed / p.spec.vmax, 1.3);
    const blurT = S.blur && racing ? U.clamp((sr - 0.5) * 0.1, 0, 0.075) + (p.boosting ? 0.05 : 0) : 0;
    game.blur = U.damp(game.blur, blurT, 5, dt);
    postMat.uniforms.uBlur.value = game.blur;
    postMat.uniforms.uBoost.value = U.damp(postMat.uniforms.uBoost.value, p.boosting ? 1 : 0, 6, dt);
    Fx.spray.mat.uniforms.uScale.value = (rt.height * 0.5) / Math.tan((camera.fov * Math.PI) / 360);
    renderer.setRenderTarget(rt); renderer.render(scene, camera);
    renderer.setRenderTarget(null); renderer.render(postScene, postCam);
    updateEngine(dt); if (game.state !== 'menu') updateHUD(dt);
  }
  game.tick = frame;

  function updateEngine(dt) {
    const p = game.player, active = game.state === 'racing' || game.state === 'countdown' || game.state === 'finished';
    const top = p.spec.vmax * 1.28, r = U.clamp(p.speed / top, 0, 0.999) * 6, g = Math.floor(r), f = r - g;
    let rpm = g === 0 ? 900 + f * 6300 : 3000 + f * 4600, thr = p.throttle || 0;
    if (game.state === 'countdown') { thr = (keys.KeyW || keys.ArrowUp) ? 1 : 0; rpm = 950 + thr * (4800 + Math.sin(game.time * 22) * 500); }
    if (p.airborne) rpm = Math.min(8000, rpm + 1200);
    game.rpm = U.damp(game.rpm, rpm, 9, dt); game.gear = g + 1;
    A.update({ rpm: game.rpm, throttle: thr, sr: Math.min(p.speed / p.spec.vmax, 1.3), boost: p.boosting, active: active && game.state !== 'paused' });
  }

  /* ---------------- HUD ---------------- */
  let mmBase = null, mm = null;
  function buildMinimapBase() {
    const size = 200, pad = 16, b = T.bounds, s = Math.min((size - pad * 2) / (b.maxX - b.minX), (size - pad * 2) / (b.maxZ - b.minZ));
    const ox = (size - (b.maxX - b.minX) * s) / 2, oz = (size - (b.maxZ - b.minZ) * s) / 2;
    mm = { fx: (x) => ox + (b.maxX - x) * s, fy: (z) => size - (oz + (z - b.minZ) * s) };
    mmBase = document.createElement('canvas'); mmBase.width = mmBase.height = size; const c = mmBase.getContext('2d');
    const path = () => { c.beginPath(); for (let i = 0; i <= T.N; i++) { const k = i % T.N, x = mm.fx(T.P[k * 2]), y = mm.fy(T.P[k * 2 + 1]); i ? c.lineTo(x, y) : c.moveTo(x, y); } };
    c.lineJoin = 'round'; path(); c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 10; c.stroke();
    path(); c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 6; c.stroke();
    path(); c.strokeStyle = '#0d3a5c'; c.lineWidth = 3; c.stroke();
    T.gates.forEach((g, i) => { c.strokeStyle = i === 0 ? '#ff7a18' : '#19c8ff'; c.lineWidth = i === 0 ? 3 : 2; c.beginPath(); c.moveTo(mm.fx(g.x - g.rx * 40), mm.fy(g.z - g.rz * 40)); c.lineTo(mm.fx(g.x + g.rx * 40), mm.fy(g.z + g.rz * 40)); c.stroke(); });
  }
  function drawMinimap() {
    const c = $('minimap').getContext('2d'), p = game.player; c.clearRect(0, 0, 200, 200); c.drawImage(mmBase, 0, 0);
    if (!p.finished) { const g = T.gates[p.nextCp]; c.fillStyle = '#3dff8a'; c.beginPath(); c.arc(mm.fx(g.x), mm.fy(g.z), 4 + Math.sin(game.time * 6) * 1.5, 0, 6.283); c.fill(); }
    for (const b of game.boats) {
      if (b.isPlayer) continue; c.fillStyle = b.color; c.strokeStyle = '#000'; c.lineWidth = 1.5; c.beginPath(); c.arc(mm.fx(b.x), mm.fy(b.z), 4.5, 0, 6.283); c.fill(); c.stroke();
    }
    c.save(); c.translate(mm.fx(p.x), mm.fy(p.z)); c.rotate(Math.atan2(-Math.sin(p.yaw), -Math.cos(p.yaw)) + Math.PI);
    c.fillStyle = '#fff'; c.strokeStyle = '#ff7a18'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, -8); c.lineTo(5.5, 6); c.lineTo(0, 3); c.lineTo(-5.5, 6); c.closePath(); c.fill(); c.stroke(); c.restore();
  }
  function drawGauge(kmh, rpm, gear, boost) {
    const c = $('gauge').getContext('2d'), cx = 140, cy = 140, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, MAXS = 300;
    c.clearRect(0, 0, 280, 280);
    c.beginPath(); c.arc(cx, cy, 132, 0, 6.283); c.fillStyle = 'rgba(6,14,26,0.6)'; c.fill(); c.lineWidth = 2; c.strokeStyle = 'rgba(255,255,255,0.16)'; c.stroke();
    const arc = (r, w, s, e, col) => { c.beginPath(); c.arc(cx, cy, r, s, e); c.lineWidth = w; c.strokeStyle = col; c.stroke(); };
    arc(114, 12, a0, a1, 'rgba(255,255,255,0.1)');
    const sp = U.clamp(kmh / MAXS, 0, 1), gr = c.createLinearGradient(20, 260, 260, 20);
    if (boost) { gr.addColorStop(0, '#ff5a00'); gr.addColorStop(1, '#ffe14d'); } else { gr.addColorStop(0, '#1a6bff'); gr.addColorStop(0.6, '#19c8ff'); gr.addColorStop(1, '#ff7a18'); }
    if (sp > 0.002) arc(114, 12, a0, a0 + (a1 - a0) * sp, gr);
    c.font = '600 11px Bahnschrift, "Segoe UI", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let v = 0; v <= MAXS; v += 20) {
      const a = a0 + (a1 - a0) * (v / MAXS), major = v % 60 === 0, r1 = major ? 96 : 101, co = Math.cos(a), si = Math.sin(a);
      c.beginPath(); c.moveTo(cx + co * r1, cy + si * r1); c.lineTo(cx + co * 106, cy + si * 106); c.lineWidth = major ? 2.5 : 1.2; c.strokeStyle = 'rgba(255,255,255,' + (major ? 0.9 : 0.45) + ')'; c.stroke();
      if (major) { c.fillStyle = 'rgba(255,255,255,0.8)'; c.fillText(v, cx + co * 84, cy + si * 84); }
    }
    // RPM arc (inner)
    arc(66, 6, a0, a1, 'rgba(255,255,255,0.1)'); arc(66, 6, a0 + (a1 - a0) * 0.85, a1, 'rgba(255,40,40,0.55)');
    const rp = U.clamp(rpm / 8000, 0, 1); arc(66, 6, a0, a0 + (a1 - a0) * rp, rp > 0.85 ? '#ff3b30' : '#f4f7fa');
    // needle
    const na = a0 + (a1 - a0) * sp; c.beginPath(); c.moveTo(cx + Math.cos(na) * 74, cy + Math.sin(na) * 74); c.lineTo(cx + Math.cos(na) * 122, cy + Math.sin(na) * 122); c.lineWidth = 3; c.strokeStyle = boost ? '#ffe14d' : '#ff7a18'; c.stroke();
    c.fillStyle = '#fff'; c.font = 'italic 800 54px Bahnschrift, "Segoe UI", sans-serif'; c.fillText(Math.round(kmh), cx, cy - 4);
    c.font = '600 12px Bahnschrift, "Segoe UI", sans-serif'; c.fillStyle = 'rgba(255,255,255,0.7)'; c.fillText('KM/H', cx, cy + 28);
    c.fillStyle = '#19c8ff'; c.font = 'italic 800 20px Bahnschrift, "Segoe UI", sans-serif'; c.fillText('G' + gear, cx, cy + 50);
    c.fillStyle = rp > 0.85 ? '#ff3b30' : 'rgba(255,255,255,0.85)'; c.font = '700 11px Bahnschrift, "Segoe UI", sans-serif'; c.fillText((rpm / 1000).toFixed(1) + ' x1000 RPM', cx, cy + 86);
  }
  let hudAcc = 0;
  function updateHUD(dt) {
    const p = game.player, K = T.K;
    drawGauge(p.speed * 3.6, game.rpm, game.gear, p.boosting); drawMinimap();
    $('nitroFill').style.width = (p.nitro * 100).toFixed(1) + '%'; $('nitroFill').parentNode.parentNode.classList.toggle('boost', p.boosting);
    $('timer').textContent = U.fmtTime(p.finished ? p.finishTime : game.raceTime);
    $('lapTime').textContent = U.fmtTime(p.finished ? p.lastLap : game.raceTime - p.lapStart);
    if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) $('msg').classList.remove('show'); }
    hudAcc += dt; if (hudAcc < 0.1) return; hudAcc = 0;
    $('pos').textContent = p.rank; $('posSuf').textContent = SUF[Math.min(p.rank - 1, 3)];
    $('lapCur').textContent = Math.max(1, Math.min(p.lap, game.laps));
    $('bestLap').textContent = U.fmtTime(p.bestLap);
    const cps = p.cpCount === 0 ? 0 : ((p.cpCount - 1) % K) + 1; $('cpText').textContent = cps + '/' + K;
    const pips = $('cpPips').children; for (let i = 0; i < pips.length; i++) pips[i].className = i < cps ? 'on' : '';
    if (game.order) $('standings').innerHTML = game.order.map((b) => '<div class="' + (b.isPlayer ? 'me' : '') + '" style="border-left-color:' + b.color + '">' + b.rank + '&nbsp; ' + b.name + (b.finished ? ' &#10003;' : '') + '</div>').join('');
    let w = '';
    if (game.state === 'racing' && !p.finished) {
      if (p.missed) w = 'MISSED CHECKPOINT — TEKAN R';
      else if (p.wrongWay > 1) w = 'WRONG WAY';
      else if (p.offTrack > 75) w = 'KEMBALI KE LINTASAN — TEKAN R';
      else if (p.unstable > 0.35) w = 'UNSTABLE!';
    }
    if ($('warn').textContent !== w) $('warn').textContent = w;
    if (game.state === 'finished') { game.resT += 0.1; if (game.resT > 0.5) { game.resT = 0; fillResultsTable(); } }
  }
  function fillResultsTable() {
    $('resTable').innerHTML = game.order.map((b) => '<div class="' + (b.isPlayer ? 'me' : '') + '"><span>' + b.rank + '</span><span>' + b.name + '</span><span>' + b.spec.name + '</span><span>' + (b.finished ? U.fmtTime(b.finishTime) : 'RACING…') + '</span></div>').join('');
  }
  function showResults() {
    const p = game.player; game.state = 'finished'; rank();
    const r = p.finalRank || p.rank;
    $('resPos').textContent = r; $('resSuf').textContent = SUF[Math.min(r - 1, 3)];
    $('resMsg').textContent = r === 1 ? 'VICTORY! KAMU JUARA' : r === 2 ? 'PODIUM — HAMPIR MENANG' : r === 3 ? 'PODIUM KETIGA' : 'COBA LAGI!';
    $('resTime').textContent = U.fmtTime(p.finishTime); $('resBest').textContent = U.fmtTime(p.bestLap); $('resMax').textContent = Math.round(p.maxSpeed) + ' KM/H';
    fillResultsTable(); $('results').classList.remove('hidden'); $('warn').textContent = '';
  }

  /* ---------------- Menus / input ---------------- */
  function showScreen(name) {
    game.screen = name;
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'scr-' + name));
  }
  function refreshBoatCard() {
    const sp = G.BOATS[S.boat];
    $('boatName').textContent = sp.name; $('boatDesc').textContent = sp.desc; $('menuBoat').textContent = sp.name;
    $('stSpeed').style.width = sp.stats.speed + '%'; $('stAccel').style.width = sp.stats.accel + '%'; $('stHandling').style.width = sp.stats.handling + '%'; $('stStability').style.width = sp.stats.stability + '%';
    $('stSpeedV').textContent = Math.round(sp.vmax * 3.6) + ' KM/H';
  }
  function changeBoat(dir) {
    const i = G.BOAT_KEYS.indexOf(S.boat); S.boat = G.BOAT_KEYS[(i + dir + 3) % 3]; G.saveSettings();
    buildBoats(); placeGrid(); refreshBoatCard(); A.play('click');
  }
  function refreshSettingsUI() {
    document.querySelectorAll('.seg').forEach((seg) => { const k = seg.dataset.set; seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(S[k]) === b.dataset.val)); });
    $('volume').value = S.volume;
  }
  function bindUI() {
    document.addEventListener('click', (e) => {
      const t = e.target.closest('button'); if (!t) return;
      A.init();
      if (t.dataset.go) { showScreen(t.dataset.go); A.play('click'); }
      const act = t.dataset.act;
      if (act === 'start' || act === 'restart') startRace();
      else if (act === 'resume') togglePause();
      else if (act === 'menu') toMenu();
      else if (act === 'prevBoat') changeBoat(-1);
      else if (act === 'nextBoat') changeBoat(1);
      const seg = t.parentNode && t.parentNode.dataset && t.parentNode.dataset.set;
      if (seg) {
        const v = t.dataset.val; S[seg] = v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v;
        G.saveSettings(); refreshSettingsUI(); A.play('click');
        if (seg === 'quality') applyQuality();
      }
      t.blur();
    });
    $('volume').addEventListener('input', (e) => { S.volume = +e.target.value; A.setVolume(S.volume); G.saveSettings(); });
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      keys[e.code] = true;
      if (e.code === 'Escape') { if (game.state === 'menu') { if (game.screen !== 'main') showScreen('main'); } else togglePause(); }
      else if (e.code === 'KeyR' && game.state === 'racing' && !game.player.finished) resetBoat(game.player);
      else if (game.state === 'menu' && game.screen === 'boats') { if (e.code === 'ArrowLeft' || e.code === 'KeyA') changeBoat(-1); else if (e.code === 'ArrowRight' || e.code === 'KeyD') changeBoat(1); else if (e.code === 'Enter') startRace(); }
      else if (game.state === 'menu' && game.screen === 'main' && e.code === 'Enter') startRace();
    });
    window.addEventListener('keyup', (e) => { keys[e.code] = false; });
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
    document.addEventListener('visibilitychange', () => { if (document.hidden && game.state === 'racing') togglePause(); });
  }

  init();
})(window.G);
