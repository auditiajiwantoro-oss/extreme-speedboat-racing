'use strict';
/* World: sky, ocean, tropical islands, karst cliffs, buoys, checkpoint gates, floating obstacles */
(function (G) {
  const U = G.U;
  const W = G.World = { colliders: [], islands: [], obstacles: [], gateObjs: [], buoys: [] };
  const SUN = W.sunDir = new THREE.Vector3(-0.35, 0.45, 0.82).normalize();
  const FOG = [0.66, 0.82, 0.95], FOG_D = 0.0004;

  const NOISE_GLSL = `
float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x), mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x), f.y); }
float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec2(17.1,3.7); a*=.5; } return s; }
`;
  const SKY_GLSL = `
uniform vec3 uSunDir;
vec3 skyGradient(vec3 d){
  float y=clamp(d.y,0.,1.);
  vec3 zen=vec3(0.06,0.22,0.60), mid=vec3(0.20,0.47,0.86), hor=vec3(${FOG.join(',')});
  vec3 c=mix(hor,mid,smoothstep(0.,0.30,y));
  c=mix(c,zen,smoothstep(0.2,1.,y));
  float s=max(dot(d,uSunDir),0.);
  c+=vec3(1.,0.86,0.62)*(pow(s,6.)*0.16+pow(s,64.)*0.45);
  return c;
}
`;

  function merge(geos) {
    const pos = [], idx = []; let off = 0;
    for (const g of geos) {
      const p = g.attributes.position, gi = g.index;
      for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
      if (gi) for (let i = 0; i < gi.count; i++) idx.push(gi.getX(i) + off);
      else for (let i = 0; i < p.count; i++) idx.push(i + off);
      off += p.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setIndex(idx); out.computeVertexNormals();
    return out;
  }
  U.merge = merge;

  /* ---------------- Sky ---------------- */
  function skyMaterial(env) {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      uniforms: { uSunDir: { value: SUN }, uTime: { value: 0 }, uEnv: { value: env ? 1 : 0 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `uniform float uTime; uniform float uEnv; varying vec3 vDir;
${NOISE_GLSL}${SKY_GLSL}
void main(){
  vec3 d=normalize(vDir);
  vec3 col=skyGradient(d);
  float s=max(dot(d,uSunDir),0.);
  col+=vec3(1.,0.93,0.8)*smoothstep(0.9993,0.9997,s)*mix(40.,3.,uEnv);
  if(d.y>0.){
    vec2 cp=d.xz/(d.y+0.09)*0.85+uTime*vec2(0.006,0.003);
    float n=fbm(cp*1.25);
    float cov=smoothstep(0.47,0.76,n)*smoothstep(0.015,0.2,d.y);
    float n2=fbm(cp*1.25+uSunDir.xz*0.22);
    float shade=clamp((n-n2)*3.2+0.62,0.,1.);
    vec3 cc=mix(vec3(0.50,0.58,0.70),vec3(1.28,1.22,1.14),shade);
    col=mix(col,cc,cov*0.94);
  } else {
    vec3 lower=mix(vec3(${FOG.join(',')}),vec3(0.01,0.06,0.14),uEnv);
    col=mix(col,lower,smoothstep(0.,-0.06,d.y));
  }
  gl_FragColor=vec4(col,1.);
}`,
    });
  }

  /* ---------------- Ocean ---------------- */
  function buildWater(scene) {
    const half = 150, inner = 70, step = 3, ax = [];
    for (let i = -half; i <= half; i++) {
      const n = Math.abs(i); let x;
      if (n <= inner) x = n * step; else { x = inner * step; let st = step; for (let k = inner; k < n; k++) { st *= 1.07; x += st; } }
      ax.push(Math.sign(i) * x);
    }
    const n = ax.length, pos = new Float32Array(n * n * 3), idx = new Uint32Array((n - 1) * (n - 1) * 6);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const o = (j * n + i) * 3; pos[o] = ax[i]; pos[o + 1] = 0; pos[o + 2] = ax[j]; }
    let q = 0;
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const NI = 16, isl = [];
    for (let i = 0; i < NI; i++) isl.push(new THREE.Vector3(0, 0, 0));
    W.islands.slice(0, NI).forEach((s, i) => isl[i].set(s.x, s.z, s.R));
    const mat = W.waterMat = new THREE.ShaderMaterial({
      fog: false,
      uniforms: {
        uTime: { value: 0 }, uSunDir: { value: SUN }, uSunColor: { value: new THREE.Vector3(1.0, 0.9, 0.72) },
        uFogColor: { value: new THREE.Vector3(FOG[0], FOG[1], FOG[2]) }, uFogDensity: { value: FOG_D }, uIsl: { value: isl },
      },
      vertexShader: `uniform float uTime; varying vec3 vWorld; varying float vFade; varying float vH;
${G.waveGLSL}
void main(){
  vec4 wp=modelMatrix*vec4(position,1.);
  float fade=1.-smoothstep(450.,1600.,distance(wp.xz,cameraPosition.xz));
  float h=waveH(wp.xz,uTime);
  wp.y=h*fade; vH=h; vFade=fade; vWorld=wp.xyz;
  gl_Position=projectionMatrix*viewMatrix*wp;
}`,
      fragmentShader: `uniform float uTime; uniform vec3 uSunColor; uniform vec3 uFogColor; uniform float uFogDensity; uniform vec3 uIsl[${NI}];
varying vec3 vWorld; varying float vFade; varying float vH;
${NOISE_GLSL}${SKY_GLSL}${G.waveGLSL}
vec2 detailD(vec2 p,float t){ vec2 g=vec2(0.);
  g+=vec2(0.6,0.8)*0.10*cos(0.9*dot(vec2(0.6,0.8),p)-2.9*t);
  g+=vec2(-0.8,0.6)*0.09*cos(1.4*dot(vec2(-0.8,0.6),p)-3.7*t);
  g+=vec2(0.95,-0.31)*0.08*cos(2.1*dot(vec2(0.95,-0.31),p)-4.5*t);
  g+=vec2(-0.2,-0.98)*0.07*cos(3.3*dot(vec2(-0.2,-0.98),p)-5.7*t);
  g+=vec2(0.7,0.71)*0.06*cos(5.1*dot(vec2(0.7,0.71),p)-7.0*t);
  g+=vec2(-0.71,-0.2)*0.05*cos(7.3*dot(vec2(-0.71,-0.2),p)-8.4*t);
  return g; }
void main(){
  vec3 toCam=cameraPosition-vWorld; float dist=length(toCam); vec3 V=toCam/dist;
  vec2 p=vWorld.xz;
  float df=0.22+0.78*exp(-dist*0.0045);
  vec2 g=waveD(p,uTime)*vFade;
  vec2 q=p*0.33+uTime*vec2(0.21,0.13);
  float n0=vnoise(q), e=0.25;
  vec2 ng=vec2(vnoise(q+vec2(e,0.))-n0, vnoise(q+vec2(0.,e))-n0)/e*0.16;
  g+=(detailD(p,uTime)+ng)*df;
  vec3 N=normalize(vec3(-g.x,1.,-g.y));
  float ndv=max(dot(N,V),0.);
  float fres=0.02+0.98*pow(1.-ndv,5.);
  vec3 R=reflect(-V,N); R.y=abs(R.y)+0.03; R=normalize(R);
  vec3 refl=skyGradient(R);
  float shore=0.;
  for(int i=0;i<${NI};i++){ vec3 s=uIsl[i]; if(s.z>1.){ float d=length(p-s.xy)-s.z*0.9; shore=max(shore,1.-smoothstep(-5.,60.,d)); } }
  vec3 deep=vec3(0.003,0.03,0.10), scat=vec3(0.0,0.15,0.23);
  float sc=clamp(vH*0.45+0.5,0.,1.)*(0.4+0.6*max(dot(N,uSunDir),0.));
  vec3 body=deep+scat*sc*0.5;
  body=mix(body,vec3(0.03,0.42,0.44)*(0.7+0.5*sc),shore*shore*0.85);
  vec3 col=mix(body,refl,fres*(1.-shore*0.35));
  vec3 Hh=normalize(V+uSunDir);
  float ndh=max(dot(N,Hh),0.);
  col+=uSunColor*(pow(ndh,1400.)*45.+pow(ndh,160.)*0.5);
  float crest=smoothstep(0.55,1.05,vH/${G.WAVE_MAX.toFixed(3)}+(vnoise(p*0.5)-0.5)*0.6);
  float foam=crest*smoothstep(0.35,0.75,vnoise(p*2.6+uTime*0.4))*vFade;
  float surf=smoothstep(0.86,1.,shore)*(0.5+0.5*sin(shore*60.-uTime*1.6))*smoothstep(0.3,0.7,vnoise(p*1.7+uTime*0.3));
  col=mix(col,vec3(0.92,0.96,1.),clamp(foam*0.55+surf*0.7,0.,1.));
  float f=1.-exp(-pow(dist*uFogDensity,2.));
  col=mix(col,uFogColor,f);
  gl_FragColor=vec4(col,1.);
}`,
    });
    const mesh = W.water = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.renderOrder = -1;
    scene.add(mesh);
  }

  /* ---------------- Islands ---------------- */
  function islandH(isl, x, z) {
    const dx = x - isl.x, dz = z - isl.z, d = Math.hypot(dx, dz) / isl.R;
    if (d > 1.6) return -8;
    const f = 1.2 / isl.R;
    const n1 = U.fbm(dx * f + isl.seed, dz * f + isl.seed * 1.7, 3);
    const n2 = U.fbm(dx * f * 4 + isl.seed * 3.1, dz * f * 4, 4);
    const t = 1 - d * d * (0.85 + 0.4 * n1);
    if (t <= 0) return Math.max(-8, t * 7);
    return 0.9 * U.smooth(0, 0.14, t) + isl.H * Math.pow(Math.max(t - 0.1, 0) / 0.9, 1.5) * (0.5 + 1.0 * n2);
  }
  W.islandHeight = islandH;

  function buildIslandMesh(isl, seg) {
    const size = isl.R * 2.7, g = new THREE.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, islandH(isl, p.getX(i) + isl.x, p.getZ(i) + isl.z));
    g.computeVertexNormals();
    const nr = g.attributes.normal, col = new Float32Array(p.count * 3);
    const sand = new THREE.Color(0xf0dcae), grass = new THREE.Color(0x2f6b22), grass2 = new THREE.Color(0x4f8a2a), rock = new THREE.Color(0x6e665c), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), ny = nr.getY(i), n = U.noise(p.getX(i) * 0.08 + isl.seed, p.getZ(i) * 0.08);
      if (y < 1.4 + n * 0.8) c.copy(sand).multiplyScalar(0.85 + 0.2 * n);
      else if (ny < 0.74) c.copy(rock).multiplyScalar(0.75 + 0.5 * n);
      else c.copy(grass).lerp(grass2, n);
      if (y < 0.2) c.multiplyScalar(0.8);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, W.landMat);
    m.position.set(isl.x, 0, isl.z); m.receiveShadow = true;
    return m;
  }

  function rockGeo(r, hScale, seed, detail, mossy) {
    const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position, col = new Float32Array(p.count * 3);
    const c = new THREE.Color(), base = new THREE.Color(0x7d766c), dark = new THREE.Color(0x4a4640), moss = new THREE.Color(0x3d7426);
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = U.fbm(x * 1.5 + seed + y * 0.9, z * 1.5 + y * 1.3 + seed * 2, 3), n2 = U.noise(x * 4 + seed + y * 2, z * 4 - y * 3);
      const s = 0.72 + 0.5 * n + 0.14 * n2, yy = Math.sign(y) * Math.pow(Math.abs(y), 0.55);
      p.setXYZ(i, x * s * r, yy * s * r * hScale, z * s * r);
      c.copy(dark).lerp(base, U.clamp(n * 1.4 + (yy + 1) * 0.2, 0, 1));
      if (mossy && yy > 0.72 + n2 * 0.15) c.lerp(moss, 0.85);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }

  function buildLand(scene) {
    const T = G.Track, rnd = U.rng(20261), b = T.bounds;
    W.landMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true });
    // --- islands near the course
    let tries = 0;
    while (W.islands.length < 11 && tries++ < 900) {
      const R = 55 + rnd() * 90, x = U.lerp(b.minX - 380, b.maxX + 380, rnd()), z = U.lerp(b.minZ - 380, b.maxZ + 380, rnd());
      if (T.dist(x, z) < R * 1.2 + T.halfWidth + 30) continue;
      if (W.islands.some((o) => Math.hypot(o.x - x, o.z - z) < o.R + R + 40)) continue;
      W.islands.push({ x, z, R, H: R * (0.22 + rnd() * 0.3), seed: rnd() * 50 });
    }
    const trunks = [], crowns = [], bushes = [];
    const dummyQ = new THREE.Quaternion(), e = new THREE.Euler();
    for (const isl of W.islands) {
      scene.add(buildIslandMesh(isl, 56));
      const nPalm = Math.round(isl.R * 0.55); let placed = 0, t2 = 0;
      while (placed < nPalm && t2++ < nPalm * 12) {
        const a = rnd() * 6.283, d = Math.sqrt(rnd()) * isl.R * 1.05, x = isl.x + Math.cos(a) * d, z = isl.z + Math.sin(a) * d, h = islandH(isl, x, z);
        if (h < 1.0 || h > isl.H * 0.75) continue;
        const ht = 6 + rnd() * 6;
        e.set((rnd() - 0.5) * 0.4, rnd() * 6.283, (rnd() - 0.5) * 0.4); dummyQ.setFromEuler(e);
        trunks.push({ x, y: h - 0.3, z, q: dummyQ.clone(), ht });
        const up = new THREE.Vector3(0, ht, 0).applyQuaternion(dummyQ);
        crowns.push({ x: x + up.x, y: h - 0.3 + up.y, z: z + up.z, q: dummyQ.clone(), s: 0.8 + rnd() * 0.6 });
        placed++;
      }
      const nBush = Math.round(isl.R * 0.9); placed = 0; t2 = 0;
      while (placed < nBush && t2++ < nBush * 10) {
        const a = rnd() * 6.283, d = Math.sqrt(rnd()) * isl.R, x = isl.x + Math.cos(a) * d, z = isl.z + Math.sin(a) * d, h = islandH(isl, x, z);
        if (h < 2.2) continue;
        const s = 2.5 + rnd() * 4.5;
        bushes.push({ x, y: h + s * 0.25, z, sx: s * (1 + rnd() * 0.5), sy: s * (0.6 + rnd() * 0.4), sz: s * (1 + rnd() * 0.5), ry: rnd() * 6.283, tone: rnd() });
        placed++;
      }
    }
    // --- distant mountains for depth
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * 6.283 + rnd() * 0.5, d = 1900 + rnd() * 900, R = 320 + rnd() * 300;
      const far = { x: b.cx + Math.cos(a) * d, z: b.cz + Math.sin(a) * d, R, H: R * (0.4 + rnd() * 0.25), seed: rnd() * 50 };
      scene.add(buildIslandMesh(far, 40));
    }
    // --- karst towers flanking the course (cliffs)
    tries = 0; let nk = 0;
    while (nk < 16 && tries++ < 2500) {
      const x = U.lerp(b.minX - 120, b.maxX + 120, rnd()), z = U.lerp(b.minZ - 120, b.maxZ + 120, rnd()), r = 8 + rnd() * 10, dT = T.dist(x, z);
      if (dT < T.halfWidth + r + 12 || dT > T.halfWidth + r + 75) continue;
      if (W.colliders.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 25)) continue;
      if (W.islands.some((o) => Math.hypot(o.x - x, o.z - z) < o.R * 1.2 + r)) continue;
      const h = 26 + rnd() * 40, m = new THREE.Mesh(rockGeo(r, h / r, rnd() * 100, 3, true), rockMat);
      m.position.set(x, h * 0.32, z); m.rotation.y = rnd() * 6.283; m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
      W.colliders.push({ x, z, r: r * 0.92, kind: 'rock' });
      for (let k = 0; k < 4; k++) { const s = r * (0.3 + rnd() * 0.3); bushes.push({ x: x + (rnd() - 0.5) * r * 0.9, y: h * 0.32 + h * 0.86 + rnd() * 2, z: z + (rnd() - 0.5) * r * 0.9, sx: s, sy: s * 0.7, sz: s, ry: rnd() * 6, tone: rnd() }); }
      nk++;
    }
    // --- rocks inside the course (challenging sections)
    const rocks = [[0.33, -15], [0.347, 11], [0.364, -3], [0.615, 13], [0.632, -12], [0.80, 2]];
    W.rockFracs = rocks.map((r) => r[0]);
    for (const [f, lat] of rocks) {
      const pt = T.point(T.fracIdx(f), lat), r = 4 + rnd() * 1.5;
      const m = new THREE.Mesh(rockGeo(r, 1.5, rnd() * 100, 2, false), rockMat);
      m.position.set(pt.x, 1.2, pt.z); m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
      W.colliders.push({ x: pt.x, z: pt.z, r: r * 0.9, kind: 'rock' });
    }
    // --- instanced vegetation
    const d = new THREE.Object3D();
    const trunkGeo = new THREE.CylinderGeometry(0.15, 0.3, 1, 6, 1); trunkGeo.translate(0, 0.5, 0);
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 1 }), trunks.length);
    trunks.forEach((t, i) => { d.position.set(t.x, t.y, t.z); d.quaternion.copy(t.q); d.scale.set(1, t.ht, 1); d.updateMatrix(); trunkMesh.setMatrixAt(i, d.matrix); });
    trunkMesh.castShadow = true; scene.add(trunkMesh);
    const leaves = [];
    for (let i = 0; i < 9; i++) {
      const lg = new THREE.PlaneGeometry(1.2, 4.4, 2, 6), p = lg.attributes.position, ang = (i / 9) * 6.283 + (i % 2) * 0.2, droop = 2.2 + (i % 3) * 0.5;
      for (let v = 0; v < p.count; v++) {
        const t = (p.getY(v) + 2.2) / 4.4, x = p.getX(v) * Math.sin(Math.PI * (0.15 + 0.85 * t)), out = t * 4.4, up = 1.4 * t - droop * t * t - Math.abs(x) * 0.35;
        p.setXYZ(v, x * Math.cos(ang) + out * Math.sin(ang), up, -x * Math.sin(ang) + out * Math.cos(ang));
      }
      leaves.push(lg);
    }
    const crownMesh = new THREE.InstancedMesh(merge(leaves), new THREE.MeshStandardMaterial({ color: 0x3f8a2c, roughness: 0.8, side: THREE.DoubleSide }), crowns.length);
    crowns.forEach((c, i) => { d.position.set(c.x, c.y, c.z); d.quaternion.copy(c.q); d.scale.setScalar(c.s); d.updateMatrix(); crownMesh.setMatrixAt(i, d.matrix); });
    crownMesh.castShadow = true; scene.add(crownMesh);
    const bushMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), bushes.length);
    const c1 = new THREE.Color(0x1f5a1c), c2 = new THREE.Color(0x4c8f2e), cc = new THREE.Color();
    bushes.forEach((s, i) => { d.position.set(s.x, s.y, s.z); d.rotation.set(0, s.ry, 0); d.scale.set(s.sx, s.sy, s.sz); d.updateMatrix(); bushMesh.setMatrixAt(i, d.matrix); bushMesh.setColorAt(i, cc.copy(c1).lerp(c2, s.tone)); });
    bushMesh.castShadow = true; bushMesh.receiveShadow = true; scene.add(bushMesh);
  }

  /* ---------------- Buoys ---------------- */
  function buildBuoys(scene) {
    const T = G.Track, list = W.buoys;
    for (let i = 0; i < T.N; i += 10) for (const side of [-1, 1]) {
      const p = T.point(i, side * T.halfWidth);
      list.push({ x: p.x, z: p.z, side, idx: i, ph: Math.random() * 6.28, hit: 0 });
    }
    const prof = [[0, -0.7], [0.8, -0.55], [0.85, 0.1], [0.4, 0.5], [0.22, 1.7], [0.3, 1.85], [0, 2.0]].map((p) => new THREE.Vector2(p[0], p[1]));
    const mesh = W.buoyMesh = new THREE.InstancedMesh(new THREE.LatheGeometry(prof, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.1 }), list.length);
    const red = new THREE.Color(0xff2a1a), green = new THREE.Color(0x12c94a), white = new THREE.Color(0xfff6e0);
    list.forEach((b, i) => mesh.setColorAt(i, (i >> 1) % 4 === 3 ? white : b.side < 0 ? red : green));
    mesh.castShadow = true; mesh.frustumCulled = false; scene.add(mesh);
  }

  /* ---------------- Checkpoint gates ---------------- */
  function bannerTex(text, start) {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 128; const x = c.getContext('2d');
    if (start) { for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#101418' : '#f4f6f8'; x.fillRect(i * 32, j * 32, 32, 32); } x.fillStyle = 'rgba(8,14,24,0.86)'; x.fillRect(232, 14, 560, 100); }
    else { const g = x.createLinearGradient(0, 0, 1024, 0); g.addColorStop(0, '#06263f'); g.addColorStop(0.5, '#0b4f7a'); g.addColorStop(1, '#06263f'); x.fillStyle = g; x.fillRect(0, 0, 1024, 128); x.fillStyle = '#ff7a18'; x.fillRect(0, 0, 1024, 10); x.fillRect(0, 118, 1024, 10); }
    x.fillStyle = '#fff'; x.font = 'italic 900 72px "Segoe UI", Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 512, 68);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  }
  function buildGates(scene) {
    const T = G.Track, hw = T.halfWidth + 3;
    const steel = new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.35, metalness: 0.8 });
    const pontoon = new THREE.MeshStandardMaterial({ color: 0xffb300, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1f26, roughness: 0.6, metalness: 0.4 });
    T.gates.forEach((g, i) => {
      const grp = new THREE.Group(); grp.position.set(g.x, 0, g.z); grp.rotation.y = Math.atan2(g.tx, g.tz);
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 15, 10), steel); post.position.set(s * hw, 7, 0); post.castShadow = true; grp.add(post);
        const pon = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 1.8, 14), pontoon); pon.position.set(s * hw, 0.2, 0); pon.castShadow = true; grp.add(pon);
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.5, 14), dark); ring.position.set(s * hw, 0.5, 0); grp.add(ring);
        const brace = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6.5, 0.3), steel); brace.position.set(s * (hw - 2.2), 12, 0); brace.rotation.z = s * 0.75; grp.add(brace);
        W.colliders.push({ x: g.x - g.rx * s * hw, z: g.z - g.rz * s * hw, r: 2.5, kind: 'gate' });
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 1.5, 2.6, 0.8), dark); beam.position.y = 14.4; beam.castShadow = true; grp.add(beam);
      const tex = bannerTex(i === 0 ? 'START  /  FINISH' : 'CHECKPOINT  ' + i, i === 0);
      const bm = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
      for (const s of [-1, 1]) { const bp = new THREE.Mesh(new THREE.PlaneGeometry(hw * 1.5, 2.3), bm); bp.position.set(0, 14.4, s * 0.42); if (s < 0) bp.rotation.y = Math.PI; grp.add(bp); }
      const lm = new THREE.MeshBasicMaterial({ color: 0x1188ff });
      const strip = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 0.35, 0.9), lm); strip.position.y = 12.9; grp.add(strip);
      for (const s of [-1, 1]) { const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), lm); lamp.position.set(s * hw, 15, 0); grp.add(lamp); }
      scene.add(grp); W.gateObjs.push({ grp, lm });
    });
  }
  W.setNextGate = function (n) {
    W.gateObjs.forEach((g, i) => { if (i === n) g.lm.color.setRGB(0.3, 4.0, 0.9); else g.lm.color.setRGB(0.1, 0.5, 1.4); });
  };

  /* ---------------- Floating obstacles ---------------- */
  function buildObstacles(scene) {
    const T = G.Track, rnd = U.rng(777);
    const cv = document.createElement('canvas'); cv.width = cv.height = 128; const x = cv.getContext('2d');
    x.fillStyle = '#a9773f'; x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 4; i++) { x.fillStyle = i % 2 ? '#9a6a35' : '#b5834a'; x.fillRect(0, i * 32 + 2, 128, 28); }
    x.strokeStyle = '#5b3c1c'; x.lineWidth = 10; x.strokeRect(5, 5, 118, 118); x.beginPath(); x.moveTo(5, 5); x.lineTo(123, 123); x.stroke();
    const wood = new THREE.CanvasTexture(cv); wood.colorSpace = THREE.SRGBColorSpace;
    const mats = {
      crate: new THREE.MeshStandardMaterial({ map: wood, roughness: 0.85 }),
      barrel: new THREE.MeshStandardMaterial({ color: 0xe8431f, roughness: 0.5, metalness: 0.3 }),
      barrelBand: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }),
      log: new THREE.MeshStandardMaterial({ color: 0x5d4226, roughness: 1 }),
    };
    let made = 0, tries = 0;
    while (made < 26 && tries++ < 600) {
      const f = 0.05 + rnd() * 0.93, gk = f * T.K;
      if (Math.abs(gk - Math.round(gk)) < 0.13) continue;
      if (W.rockFracs.some((r) => Math.abs(r - f) < 0.02)) continue;
      const lat = (rnd() * 2 - 1) * (T.halfWidth - 7), p = T.point(T.fracIdx(f), lat);
      if (W.obstacles.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 16)) continue;
      const type = ['crate', 'barrel', 'log'][Math.floor(rnd() * 3)]; let mesh, r;
      if (type === 'crate') { mesh = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.3, 2.3), mats.crate); r = 1.6; }
      else if (type === 'barrel') {
        mesh = new THREE.Group(); const b = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.9, 14), mats.barrel); b.castShadow = true; mesh.add(b);
        for (const y of [-0.5, 0.5]) { const band = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.88, 0.16, 14), mats.barrelBand); band.position.y = y; mesh.add(band); }
        r = 1.1;
      } else { const lg = new THREE.CylinderGeometry(0.5, 0.58, 6, 9); lg.rotateZ(Math.PI / 2); mesh = new THREE.Mesh(lg, mats.log); r = 1.9; }
      mesh.castShadow = true; scene.add(mesh);
      W.obstacles.push({ mesh, type, r, x: p.x, z: p.z, x0: p.x, z0: p.z, vx: 0, vz: 0, rot: rnd() * 6.28, spin: 0, ph: rnd() * 6.28 });
      made++;
    }
  }
  W.resetObstacles = function () { for (const o of W.obstacles) { o.x = o.x0; o.z = o.z0; o.vx = o.vz = 0; o.spin = 0; } };

  /* ---------------- Build / update ---------------- */
  W.build = function (scene, renderer) {
    scene.fog = new THREE.FogExp2(new THREE.Color().setRGB(FOG[0], FOG[1], FOG[2]), FOG_D);
    const skyGeo = new THREE.SphereGeometry(4000, 32, 20);
    W.skyMat = skyMaterial(false);
    W.sky = new THREE.Mesh(skyGeo, W.skyMat); W.sky.frustumCulled = false; W.sky.renderOrder = -10; scene.add(W.sky);
    // environment map from the procedural sky for realistic reflections
    const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(new THREE.SphereGeometry(40, 32, 20), skyMaterial(true)));
    const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(envScene, 0, 0.1, 100).texture; pm.dispose();

    W.sun = new THREE.DirectionalLight(0xfff0d8, 3.3);
    W.sun.castShadow = true; W.sun.shadow.mapSize.set(2048, 2048);
    const sc = W.sun.shadow.camera; sc.left = -95; sc.right = 95; sc.top = 95; sc.bottom = -95; sc.near = 1; sc.far = 600;
    W.sun.shadow.bias = -0.0004; W.sun.shadow.normalBias = 0.35;
    scene.add(W.sun); scene.add(W.sun.target);
    scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x2f5564, 0.9));

    buildLand(scene); buildWater(scene); buildBuoys(scene); buildGates(scene); buildObstacles(scene);
    W.setNextGate(0);
  };

  const dummy = new THREE.Object3D();
  W.update = function (dt, time, cam, focus) {
    W.skyMat.uniforms.uTime.value = time; W.sky.position.copy(cam.position);
    W.waterMat.uniforms.uTime.value = time;
    W.water.position.set(Math.round(cam.position.x / 3) * 3, 0, Math.round(cam.position.z / 3) * 3);
    W.sun.position.set(focus.x + SUN.x * 300, SUN.y * 300, focus.z + SUN.z * 300);
    W.sun.target.position.set(focus.x, 0, focus.z);
    for (let i = 0; i < W.buoys.length; i++) {
      const b = W.buoys[i]; b.hit = Math.max(0, b.hit - dt * 1.5);
      dummy.position.set(b.x, G.waveHeight(b.x, b.z, time) * 0.9 + 0.1, b.z);
      dummy.rotation.set(Math.sin(time * 1.3 + b.ph) * (0.1 + b.hit * 0.6), 0, Math.cos(time * 1.1 + b.ph) * (0.1 + b.hit * 0.6));
      dummy.updateMatrix(); W.buoyMesh.setMatrixAt(i, dummy.matrix);
    }
    W.buoyMesh.instanceMatrix.needsUpdate = true;
    const damp = Math.exp(-1.4 * dt);
    for (const o of W.obstacles) {
      o.x += o.vx * dt; o.z += o.vz * dt; o.vx *= damp; o.vz *= damp; o.rot += o.spin * dt; o.spin *= damp;
      const y = G.waveHeight(o.x, o.z, time);
      o.mesh.position.set(o.x, y + (o.type === 'log' ? 0.05 : o.type === 'crate' ? 0.45 : 0.3), o.z);
      o.mesh.rotation.set(Math.sin(time * 0.9 + o.ph) * 0.14, o.rot, Math.cos(time * 0.8 + o.ph) * 0.14);
    }
  };
})(window.G);
