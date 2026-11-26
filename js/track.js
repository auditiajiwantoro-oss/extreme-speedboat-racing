'use strict';
/* Race track: closed spline over the ocean, sampled for physics / AI / minimap */
(function (G) {
  const T = G.Track = { N: 800, halfWidth: 32, K: 8 };

  T.build = function () {
    const S = 0.8;
    const raw = [[0, -100], [0, 250], [0, 560], [110, 820], [400, 930], [640, 790], [610, 500], [790, 290],
      [1000, 60], [960, -260], [700, -380], [480, -190], [270, -330], [90, -440], [0, -290]];
    const curve = new THREE.CatmullRomCurve3(raw.map((p) => new THREE.Vector3(p[0] * S, 0, p[1] * S)), true, 'centripetal');
    const N = T.N, pts = curve.getSpacedPoints(N);
    T.P = new Float32Array(N * 2); T.T = new Float32Array(N * 2); T.R = new Float32Array(N * 2); T.curv = new Float32Array(N);
    for (let i = 0; i < N; i++) { T.P[i * 2] = pts[i].x; T.P[i * 2 + 1] = pts[i].z; }
    let len = 0;
    for (let i = 0; i < N; i++) {
      const a = (i + N - 1) % N, b = (i + 1) % N;
      let tx = T.P[b * 2] - T.P[a * 2], tz = T.P[b * 2 + 1] - T.P[a * 2 + 1];
      const l = Math.hypot(tx, tz); tx /= l; tz /= l;
      T.T[i * 2] = tx; T.T[i * 2 + 1] = tz;
      T.R[i * 2] = -tz; T.R[i * 2 + 1] = tx; // right-hand side when travelling along the tangent
      len += Math.hypot(T.P[b * 2] - T.P[i * 2], T.P[b * 2 + 1] - T.P[i * 2 + 1]);
    }
    T.len = len; T.seg = len / N;
    const rawC = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const b = (i + 1) % N;
      rawC[i] = (T.T[i * 2] * T.T[b * 2 + 1] - T.T[i * 2 + 1] * T.T[b * 2]) / T.seg;
    }
    for (let i = 0; i < N; i++) { let s = 0; for (let j = -4; j <= 4; j++) s += rawC[(i + j + N) % N]; T.curv[i] = s / 9; }
    T.gates = [];
    for (let g = 0; g < T.K; g++) {
      const idx = Math.round((g * N) / T.K) % N;
      T.gates.push({ idx, x: T.P[idx * 2], z: T.P[idx * 2 + 1], tx: T.T[idx * 2], tz: T.T[idx * 2 + 1], rx: T.R[idx * 2], rz: T.R[idx * 2 + 1] });
    }
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < N; i++) {
      minX = Math.min(minX, T.P[i * 2]); maxX = Math.max(maxX, T.P[i * 2]);
      minZ = Math.min(minZ, T.P[i * 2 + 1]); maxZ = Math.max(maxZ, T.P[i * 2 + 1]);
    }
    T.bounds = { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
  };

  T.nearest = function (x, z, hint) {
    const N = T.N; let best = hint, bd = 1e18;
    for (let j = -6; j <= 22; j++) {
      const i = (hint + j + N) % N, dx = x - T.P[i * 2], dz = z - T.P[i * 2 + 1], d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };
  T.nearestFull = function (x, z) {
    let best = 0, bd = 1e18;
    for (let i = 0; i < T.N; i++) { const dx = x - T.P[i * 2], dz = z - T.P[i * 2 + 1], d = dx * dx + dz * dz; if (d < bd) { bd = d; best = i; } }
    return best;
  };
  T.dist = function (x, z) { const i = T.nearestFull(x, z); return Math.hypot(x - T.P[i * 2], z - T.P[i * 2 + 1]); };
  T.lat = function (x, z, i) { return (x - T.P[i * 2]) * T.R[i * 2] + (z - T.P[i * 2 + 1]) * T.R[i * 2 + 1]; };
  T.point = function (i, lat) { i = ((i % T.N) + T.N) % T.N; return { x: T.P[i * 2] + T.R[i * 2] * lat, z: T.P[i * 2 + 1] + T.R[i * 2 + 1] * lat, tx: T.T[i * 2], tz: T.T[i * 2 + 1] }; };
  T.fracIdx = function (f) { return Math.round((((f % 1) + 1) % 1) * T.N) % T.N; };
})(window.G);
