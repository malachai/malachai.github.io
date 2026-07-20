// @ts-check
// 003-rolling-decay — regular & semiregular solids roll edge over edge across
// an arena, stamping each contacting face onto the plane. Solids whose faces
// tile the plane (tetra/octa/icosa on a triangular lattice, cube on a square
// one) lay down a seamless mosaic; the rest (dodecahedron, Archimedean) roll
// freely and, the instant a new face would OVERLAP the existing mosaic (or run
// off the arena), the solid EXPLODES — its faces burst apart and fade. When a
// generation is gone a fresh one drops onto the free space; once there's no free
// space the grid clears and it resets.
//
// Movement is genuine planar rolling (pivot over a contact-face edge by the
// exterior dihedral angle); collision is convex-polygon overlap via a spatial
// hash. Tiling solids spawn on a shared lattice so their mosaics line up. All
// the geometry is unit-tested (roll_proto.mjs, cont_proto.mjs) and the loop in
// sim3.mjs. Module scope is environment-free (§5).
//
// FIRST STAB (still): reflections are the analytic environment only.

const PHI = (1 + Math.sqrt(5)) / 2, IPHI = 1 / PHI, SQRT3 = Math.sqrt(3), XI = Math.SQRT2 - 1;
const SOLID_INRADIUS = 0.5;
const ROLL_FRAC = 0.72;
const CLEAR_DUR = 1.4;
const CLEAR_DROP = 5.0;
const EXPLODE_DUR = 0.55;
const EXPLODE_PUSH = 0.75;
const ORBIT_RATE = 0.05;
const MAX_GRID = 1000;
const MAX_SOLIDS = 64;
const MAX_TILE_FLOATS = 6_000_000;

function cubeCorners() { const v = []; for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) v.push([a, b, c]); return v; }
function genPerms(vals) {
  const P = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]], res = new Set();
  for (const p of P) { const base = [vals[p[0]], vals[p[1]], vals[p[2]]]; for (let s = 0; s < 8; s++) { const v = [base[0] * ((s & 1) ? -1 : 1), base[1] * ((s & 2) ? -1 : 1), base[2] * ((s & 4) ? -1 : 1)]; res.add(v.map((x) => (Math.abs(x) < 1e-9 ? 0 : +x.toFixed(6))).join(",")); } }
  return [...res].map((s) => s.split(",").map(Number));
}
const SOLID_NAMES = ["Tetrahedron", "Cube", "Octahedron", "Icosahedron", "Dodecahedron", "Cuboctahedron", "TruncOctahedron", "TruncCube"];
const SOLID_LATTICE = { Tetrahedron: "tri", Cube: "square", Octahedron: "tri", Icosahedron: "tri" }; // others: continuous
const SOLID_VERTS = {
  Tetrahedron: [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]],
  Cube: cubeCorners(),
  Octahedron: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
  Icosahedron: [[0, 1, PHI], [0, 1, -PHI], [0, -1, PHI], [0, -1, -PHI], [1, PHI, 0], [1, -PHI, 0], [-1, PHI, 0], [-1, -PHI, 0], [PHI, 0, 1], [PHI, 0, -1], [-PHI, 0, 1], [-PHI, 0, -1]],
  Dodecahedron: [...cubeCorners(), [0, IPHI, PHI], [0, IPHI, -PHI], [0, -IPHI, PHI], [0, -IPHI, -PHI], [IPHI, PHI, 0], [IPHI, -PHI, 0], [-IPHI, PHI, 0], [-IPHI, -PHI, 0], [PHI, 0, IPHI], [PHI, 0, -IPHI], [-PHI, 0, IPHI], [-PHI, 0, -IPHI]],
  Cuboctahedron: genPerms([1, 1, 0]),
  TruncOctahedron: genPerms([0, 1, 2]),
  TruncCube: genPerms([XI, 1, 1]),
};

// ---- vec / mat4 (Float64) --------------------------------------------------
function ident() { const o = new Float64Array(16); o[0] = o[5] = o[10] = o[15] = 1; return o; }
function mul(a, b) { const o = new Float64Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
function T(x, y, z) { const o = ident(); o[12] = x; o[13] = y; o[14] = z; return o; }
function rotY(t) { const c = Math.cos(t), s = Math.sin(t); const o = ident(); o[0] = c; o[2] = -s; o[8] = s; o[10] = c; return o; }
function rotAxis(x, y, z, t) { const c = Math.cos(t), s = Math.sin(t), k = 1 - c; const o = ident(); o[0] = k * x * x + c; o[1] = k * x * y + s * z; o[2] = k * x * z - s * y; o[4] = k * x * y - s * z; o[5] = k * y * y + c; o[6] = k * y * z + s * x; o[8] = k * x * z + s * y; o[9] = k * y * z - s * x; o[10] = k * z * z + c; return o; }
const tp = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
const td = (m, d) => [m[0] * d[0] + m[4] * d[1] + m[8] * d[2], m[1] * d[0] + m[5] * d[1] + m[9] * d[2], m[2] * d[0] + m[6] * d[1] + m[10] * d[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = vlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const angle2 = (v) => Math.atan2(v[1], v[0]);
const down = [0, -1, 0];
function rotFromTo(a, b) { const d = dot(a, b); if (d > 0.99999) return ident(); if (d < -0.99999) { let ax = Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]); ax = norm(ax); return rotAxis(ax[0], ax[1], ax[2], Math.PI); } const ax = norm(cross(a, b)); return rotAxis(ax[0], ax[1], ax[2], Math.acos(d)); }
function perspective(fovy, aspect, near, far) { const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far); const o = new Float64Array(16); o[0] = f / aspect; o[5] = f; o[10] = far * nf; o[11] = -1; o[14] = far * near * nf; return o; }
function lookAt(eye, ctr, up) { const F = norm(sub(ctr, eye)); const s = norm(cross(F, up)); const u = cross(s, F); const o = new Float64Array(16); o[0] = s[0]; o[4] = s[1]; o[8] = s[2]; o[12] = -dot(s, eye); o[1] = u[0]; o[5] = u[1]; o[9] = u[2]; o[13] = -dot(u, eye); o[2] = -F[0]; o[6] = -F[1]; o[10] = -F[2]; o[14] = dot(F, eye); o[15] = 1; return o; }

// ---- build solid: render mesh + faces (ring/normal/centroid/adj) + canon ---
function buildSolid(vertsIn) {
  const V = vertsIn.map((v) => v.slice()), N = V.length, eps = 1e-4, raw = [], seen = new Set();
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) for (let k = j + 1; k < N; k++) {
    const a = V[i], b = V[j], c = V[k];
    let n = norm(cross(sub(b, a), sub(c, a))); if (!isFinite(n[0])) continue;
    let d = dot(n, a); if (d < 0) { n = [-n[0], -n[1], -n[2]]; d = -d; }
    let ok = true; for (let m = 0; m < N; m++) if (dot(n, V[m]) > d + eps) { ok = false; break; } if (!ok) continue;
    const key = [Math.round(n[0] * 1e3), Math.round(n[1] * 1e3), Math.round(n[2] * 1e3), Math.round(d * 1e3)].join(","); if (seen.has(key)) continue; seen.add(key);
    const ids = []; for (let m = 0; m < N; m++) if (Math.abs(dot(n, V[m]) - d) < eps * 20) ids.push(m); raw.push({ n, d, ids });
  }
  let inradius = Infinity; for (const f of raw) inradius = Math.min(inradius, f.d); const scale = SOLID_INRADIUS / inradius;
  const faces = [], outV = [], outI = []; let base = 0;
  for (const f of raw) {
    const cen = [0, 0, 0]; for (const id of f.ids) { cen[0] += V[id][0]; cen[1] += V[id][1]; cen[2] += V[id][2]; } cen[0] /= f.ids.length; cen[1] /= f.ids.length; cen[2] /= f.ids.length;
    let t = Math.abs(f.n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0]; const dn = dot(t, f.n); const u = norm([t[0] - dn * f.n[0], t[1] - dn * f.n[1], t[2] - dn * f.n[2]]); const w = cross(f.n, u);
    const ord = f.ids.map((id) => { const dv = sub(V[id], cen); return { id, a: Math.atan2(dot(dv, w), dot(dv, u)) }; }).sort((p, q) => p.a - q.a).map((o) => o.id);
    const ring = ord.map((id) => [V[id][0] * scale, V[id][1] * scale, V[id][2] * scale]);
    faces.push({ normal: f.n.slice(), ring, centroid: [cen[0] * scale, cen[1] * scale, cen[2] * scale], adj: [] });
    for (const v of ring) outV.push(v[0], v[1], v[2], f.n[0], f.n[1], f.n[2]);
    for (let m = 1; m < ring.length - 1; m++) outI.push(base, base + m, base + m + 1); base += ring.length;
  }
  const R = (p) => p.map((x) => Math.round(x * 1e4)).join(",");
  const em = new Map();
  faces.forEach((f, fi) => { const n = f.ring.length; for (let e = 0; e < n; e++) { const key = [R(f.ring[e]), R(f.ring[(e + 1) % n])].sort().join("|"); if (!em.has(key)) em.set(key, []); em.get(key).push([fi, e]); } });
  faces.forEach((f, fi) => { const n = f.ring.length; for (let e = 0; e < n; e++) { const key = [R(f.ring[e]), R(f.ring[(e + 1) % n])].sort().join("|"); const pr = em.get(key).find(([g]) => g !== fi); f.adj[e] = { f: pr[0], e: pr[1] }; } });
  const edgeLen = vlen(sub(faces[0].ring[1], faces[0].ring[0]));
  // canonical 2D footprint of face 0 (down-projected, centred) — for continuous spawn slots
  const Rd = rotFromTo(faces[0].normal, down);
  const cr = faces[0].ring.map((v) => tp(Rd, v)); const cc = tp(Rd, faces[0].centroid);
  const canon = cr.map((p) => [p[0] - cc[0], p[2] - cc[2]]);
  const circum = Math.max(...canon.map((p) => Math.hypot(p[0], p[1])));
  return { mesh: { verts: new Float32Array(outV), indices: new Uint16Array(outI) }, faces, edgeLen, canon, circum };
}

function poseForCell(faces, cellPoly, faceIdx) {
  const f = faces[faceIdx]; const Rd = rotFromTo(f.normal, down); const ring1 = f.ring.map((v) => tp(Rd, v)); const c1 = tp(Rd, f.centroid);
  const n = cellPoly.length; const cc = [cellPoly.reduce((s, p) => s + p[0], 0) / n, cellPoly.reduce((s, p) => s + p[1], 0) / n];
  let bp = null, be = Infinity;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const psi = angle2([ring1[i][0] - c1[0], ring1[i][2] - c1[2]]) - angle2([cellPoly[j][0] - cc[0], cellPoly[j][1] - cc[1]]);
    const pose = mul(T(cc[0], 0, cc[1]), mul(rotY(psi), mul(T(-c1[0], -c1[1], -c1[2]), Rd)));
    const foot = f.ring.map((v) => tp(pose, v)); let err = 0;
    for (let a = 0; a < n; a++) { let bb = Infinity; for (let b = 0; b < n; b++) bb = Math.min(bb, Math.hypot(foot[a][0] - cellPoly[b][0], foot[a][2] - cellPoly[b][1])); err += bb + Math.abs(foot[a][1]); }
    if (err < be) { be = err; bp = pose; }
  }
  return bp;
}
function rollOver(pose, faces, cf, e) {
  const f = faces[cf], n = f.ring.length; const P = tp(pose, f.ring[e]), Q = tp(pose, f.ring[(e + 1) % n]); const axis = norm(sub(Q, P));
  const tf = f.adj[e].f; const nn = norm(td(pose, faces[tf].normal));
  const proj = (v) => { const d = dot(v, axis); return [v[0] - d * axis[0], v[1] - d * axis[1], v[2] - d * axis[2]]; };
  const u = norm(proj(nn)), v = norm(proj(down)); const ang = Math.atan2(dot(cross(u, v), axis), dot(u, v));
  const R = mul(T(P[0], P[1], P[2]), mul(rotAxis(axis[0], axis[1], axis[2], ang), T(-P[0], -P[1], -P[2])));
  return { pose0: pose, axis, P, ang, finalPose: mul(R, pose), face: tf };
}
const foot2d = (pose, face) => face.ring.map((v) => { const w = tp(pose, v); return [w[0], w[2]]; });
const cen2d = (poly) => { let x = 0, z = 0; for (const p of poly) { x += p[0]; z += p[1]; } return [x / poly.length, z / poly.length]; };
function overlap(A, B, eps) {
  for (const poly of [A, B]) { const m = poly.length; for (let i = 0; i < m; i++) { const a = poly[i], b = poly[(i + 1) % m]; const nx = -(b[1] - a[1]), nz = (b[0] - a[0]); let mnA = Infinity, mxA = -Infinity, mnB = Infinity, mxB = -Infinity; for (const p of A) { const d = p[0] * nx + p[1] * nz; if (d < mnA) mnA = d; if (d > mxA) mxA = d; } for (const p of B) { const d = p[0] * nx + p[1] * nz; if (d < mnB) mnB = d; if (d > mxB) mxB = d; } if (mxA < mnB + eps || mxB < mnA + eps) return false; } }
  return true;
}
function bbox(poly) { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const p of poly) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; } return [x0, x1, z0, z1]; }

// triangular / square lattice cells (shared spawn slots for tiling solids)
function latticeCells(kind, L, hw, hd) {
  const inB = (c) => Math.abs(c[0]) <= hw + 1e-6 && Math.abs(c[1]) <= hd + 1e-6;
  const out = [];
  if (kind === "square") {
    const poly = (i, j) => { const cx = i * L, cz = j * L, h = L / 2; return [[cx - h, cz - h], [cx + h, cz - h], [cx + h, cz + h], [cx - h, cz + h]]; };
    const R = Math.ceil(hw / L) + 1, S = Math.ceil(hd / L) + 1;
    for (let i = -R; i <= R; i++) for (let j = -S; j <= S; j++) { const c = [i * L, j * L]; if (inB(c)) out.push({ poly: poly(i, j), c }); }
    return out;
  }
  const e1 = [L, 0], e2 = [L / 2, L * SQRT3 / 2], O = (i, j) => [i * e1[0] + j * e2[0], i * e1[1] + j * e2[1]];
  const poly = (i, j, u) => { const o = O(i, j); return u === 0 ? [o, [o[0] + e1[0], o[1] + e1[1]], [o[0] + e2[0], o[1] + e2[1]]] : [[o[0] + e1[0], o[1] + e1[1]], [o[0] + e1[0] + e2[0], o[1] + e1[1] + e2[1]], [o[0] + e2[0], o[1] + e2[1]]]; };
  const rj = Math.ceil(hd / (L * SQRT3 / 2)) + 2;
  for (let j = -rj; j <= rj; j++) { const ri = Math.ceil(hw / L) + 2; for (let i = -ri - Math.abs(j); i <= ri; i++) for (let u = 0; u < 2; u++) { const pp = poly(i, j, u); const c = cen2d(pp); if (inB(c)) out.push({ poly: pp, c }); } }
  return out;
}

function hsv2rgb(h, s, v) { const i = Math.floor(h * 6), f = h * 6 - i; const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s); const m = ((i % 6) + 6) % 6; return [[v, q, p, p, t, v][m], [t, v, v, q, p, p][m], [p, p, t, v, v, q][m]]; }
// A palette of RELATED colours (analogous): a random base hue, six variations
// within a tight ±~0.06 hue band with varied sat/val — distinguishable but
// clearly of one family, never wildly different.
function makePalette() {
  const h0 = Math.random(), SPREAD = 0.12, N = 6, out = [];
  for (let i = 0; i < N; i++) {
    const h = (h0 + (i / (N - 1) - 0.5) * SPREAD + 1) % 1;
    out.push(hsv2rgb(h, 0.5 + Math.random() * 0.25, 0.62 + Math.random() * 0.32));
  }
  return out;
}
const smoothstep = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function hash2(x, z) { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); }
const norm2 = (x, z) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };

export default {
  meta: {
    title: "Rolling Decay",
    description:
      "Coloured solids roll across an arena stamping their faces in their own hue; the tiling ones lay a seamless mosaic, the rest explode the moment a face would overlap.",
    tags: ["mesh", "3d", "simulation", "instanced", "generative"],
    created: "2026-07-17",
    prefersReducedMotionSafe: false,
  },

  /** @param {any} ctx */
  async init(ctx) {
    const { device, context, format, loadWGSL, canvas } = ctx;
    const interactive = ctx.mode === "standalone";
    const module = device.createShaderModule({ code: await loadWGSL("./shader.wgsl") });

    const ubuf = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const solidBuf = device.createBuffer({ size: MAX_SOLIDS * 96, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }, { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } }] });
    const bindGroup = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: solidBuf } }] });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
    const DEPTH_FORMAT = "depth24plus";
    const solidVL = [{ arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }, { shaderLocation: 1, offset: 12, format: "float32x3" }] }];
    const tileVL = [{ arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }, { shaderLocation: 1, offset: 12, format: "float32x3" }] }];
    const makePipe = (vs, fs, vbl, blend) => device.createRenderPipeline({ layout: pipelineLayout, vertex: { module, entryPoint: vs, buffers: vbl }, fragment: { module, entryPoint: fs, targets: [{ format, blend }] }, primitive: { topology: "triangle-list", cullMode: "none" }, depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: "less" } });
    const tilePipe = makePipe("vs_tile", "fs_tile", tileVL, undefined);
    const solidPipe = makePipe("vs_solid", "fs_solid", solidVL, { color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" } });

    const uploadMesh = (m) => { const vb = device.createBuffer({ size: m.verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(vb, 0, m.verts); const ib = device.createBuffer({ size: m.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(ib, 0, m.indices); return { vb, ib, count: m.indices.length }; };
    const solidData = {};
    for (const name of SOLID_NAMES) { const b = buildSolid(SOLID_VERTS[name]); solidData[name] = { gpu: uploadMesh(b.mesh), faces: b.faces, edgeLen: b.edgeLen, canon: b.canon, circum: b.circum, lattice: SOLID_LATTICE[name] || null }; }

    let depthTex = null, depthW = 0, depthH = 0;
    function ensureDepth(w, h) { if (depthTex && depthW === w && depthH === h) return; depthTex?.destroy(); depthTex = device.createTexture({ size: { width: Math.max(1, w), height: Math.max(1, h) }, format: DEPTH_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT }); depthW = w; depthH = h; }
    let tileArr = new Float32Array(0), tileBuf = null, tileCap = 0;
    function ensureTiles(f) { if (tileBuf && f <= tileCap) return; tileCap = Math.max(f, (tileCap * 2) | 0, 4096); tileBuf?.destroy(); tileBuf = device.createBuffer({ size: tileCap * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }); tileArr = new Float32Array(tileCap); }

    // ---- controls / colour ----------------------------------------------
    let gridX = 12, gridY = 12, solidCount = 6, speed = 1.5;
    let palette = makePalette();
    let currentSolid = "Octahedron";
    let dirtyReconfig = false;
    let pendingGridX = gridX, pendingGridY = gridY, pendingCount = solidCount, pendingSolid = currentSolid;

    // ---- camera ----------------------------------------------------------
    let camYaw = 0, camPitch = 0.56, camZoom = 1.0, panX = 0, panZ = 0;
    let autoOrbit = true, orbitPhase = 0, lastTheta = 0, lastR = 20;

    // ---- simulation ------------------------------------------------------
    let SD = solidData[currentSolid];
    let hw = 0, hd = 0, EPS = 1e-3, BS = 1, slots = [];
    /** @type {Array<any>} */ let live = [];
    /** @type {Array<{pose:Float64Array,timer:number}>} */ let dying = [];
    /** @type {Array<{poly:number[][],cx:number,cz:number,seed:number}>} */ let stamps = [];
    let hash = new Map();
    let tick = 0, acc = 0, mode = "run", clearTimer = 0, warnedCap = false;
    const interval = () => 1 / speed;
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };

    function buildArena() {
      SD = solidData[currentSolid];
      const L = SD.edgeLen; hw = gridX * L * 0.5; hd = gridY * L * 0.5; EPS = 1e-3 * L; BS = Math.max(L, SD.circum);
      if (SD.lattice) slots = latticeCells(SD.lattice, L, hw, hd);
      else { slots = []; const sp = SD.circum * 2.2; const R = Math.ceil(hw / sp), S = Math.ceil(hd / sp); for (let i = -R; i <= R; i++) for (let j = -S; j <= S; j++) { const cx = i * sp, cz = j * sp; if (Math.abs(cx) <= hw && Math.abs(cz) <= hd) slots.push({ poly: SD.canon.map((o) => [o[0] + cx, o[1] + cz]), c: [cx, cz] }); } }
    }
    const hkey = (gx, gy) => gx + "," + gy;
    function addStampPoly(poly, color) {
      const c = cen2d(poly); const idx = stamps.length;
      const j = 0.82 + 0.18 * hash2(Math.round(c[0] * 7), Math.round(c[1] * 7));  // faint per-tile value jitter
      stamps.push({ poly, cx: c[0], cz: c[1], col: [color[0] * j, color[1] * j, color[2] * j] });
      const [x0, x1, z0, z1] = bbox(poly);
      for (let gx = Math.floor(x0 / BS); gx <= Math.floor(x1 / BS); gx++) for (let gy = Math.floor(z0 / BS); gy <= Math.floor(z1 / BS); gy++) { const k = hkey(gx, gy); let a = hash.get(k); if (!a) { a = []; hash.set(k, a); } a.push(idx); }
    }
    function overlapsStamps(poly) {
      const [x0, x1, z0, z1] = bbox(poly); const seen = new Set();
      for (let gx = Math.floor(x0 / BS); gx <= Math.floor(x1 / BS); gx++) for (let gy = Math.floor(z0 / BS); gy <= Math.floor(z1 / BS); gy++) { const a = hash.get(hkey(gx, gy)); if (!a) continue; for (const idx of a) { if (seen.has(idx)) continue; seen.add(idx); if (overlap(poly, stamps[idx].poly, EPS)) return true; } }
      return false;
    }
    const inBounds = (c) => Math.abs(c[0]) <= hw + 1e-6 && Math.abs(c[1]) <= hd + 1e-6;

    // Add solids on free slots until `target` are alive (or no clean slot is
    // left) — used both to fill a fresh generation and to top up after deaths.
    function spawnUpTo(target) {
      const order = shuffle(slots.slice());
      for (const sl of order) {
        if (live.length >= target) break;
        if (overlapsStamps(sl.poly)) continue;
        if (live.some((x) => overlap(sl.poly, foot2d(x.pose, SD.faces[x.face]), EPS))) continue;
        const pose = poseForCell(SD.faces, sl.poly, 0); const a = Math.random() * Math.PI * 2;
        live.push({ pose, face: 0, heading: [Math.cos(a), Math.sin(a)], prevSeg: null, dead: false, pending: null, color: palette[(Math.random() * palette.length) | 0] });
      }
    }
    function spawnGeneration() { live = []; spawnUpTo(solidCount); }
    function applyReconfig() {
      gridX = pendingGridX; gridY = pendingGridY; solidCount = Math.max(1, pendingCount); currentSolid = pendingSolid;
      buildArena(); stamps = []; hash = new Map(); dying = []; spawnGeneration(); tick = 0; acc = 0; mode = "run";
    }

    function planIteration() {
      if (dirtyReconfig) { dirtyReconfig = false; applyReconfig(); }
      const claimed = []; const livingFoot = live.map((x) => foot2d(x.pose, SD.faces[x.face]));
      for (const idx of shuffle(live.map((_, i) => i))) {
        const x = live[idx]; const f = SD.faces[x.face], n = f.ring.length; const foot = livingFoot[idx];
        const cands = [];
        for (let e = 0; e < n; e++) {
          const A = foot[e], B = foot[(e + 1) % n], mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
          if (x.prevSeg && Math.hypot(mid[0] - x.prevSeg[0], mid[1] - x.prevSeg[1]) < 1e-3) continue;
          const rr = rollOver(x.pose, SD.faces, x.face, e); const nfoot = foot2d(rr.finalPose, SD.faces[rr.face]); const nc = cen2d(nfoot);
          const cc = cen2d(foot); cands.push({ rr, nfoot, nc, mid, dir: norm2(nc[0] - cc[0], nc[1] - cc[1]) });
        }
        cands.sort((a, b) => (b.dir[0] * x.heading[0] + b.dir[1] * x.heading[1]) - (a.dir[0] * x.heading[0] + a.dir[1] * x.heading[1]));
        addStampPoly(foot, x.color);                          // stamp the face it's on, in its colour
        let pick = null;
        for (const c of cands) {
          if (!inBounds(c.nc)) continue;
          if (overlapsStamps(c.nfoot)) continue;
          if (claimed.some((cf) => overlap(c.nfoot, cf, EPS))) continue;
          if (livingFoot.some((lf, li) => li !== idx && overlap(c.nfoot, lf, EPS))) continue;
          pick = c; break;
        }
        if (pick) { claimed.push(pick.nfoot); x.pending = { pose: pick.rr.finalPose, face: pick.rr.face, seg: pick.mid, dir: pick.dir }; }
        else x.dead = true;                                   // will explode
      }
    }
    function commitActions() {
      const survivors = [];
      for (const x of live) { if (!x.dead && x.pending) { x.pose = x.pending.pose; x.face = x.pending.face; x.prevSeg = x.pending.seg; x.heading = x.pending.dir; x.pending = null; survivors.push(x); } else if (x.dead) { if (dying.length < MAX_SOLIDS) dying.push({ pose: x.pose, timer: EXPLODE_DUR, color: x.color }); } }
      live = survivors;
    }
    function startClear() { mode = "clear"; clearTimer = CLEAR_DUR; live = []; }
    function finishClear() { stamps = []; hash = new Map(); spawnGeneration(); mode = "run"; tick = 0; acc = 0; planIteration(); }

    buildArena(); applyReconfig(); planIteration();

    // ---- per-frame packing ----------------------------------------------
    const uArr = new Float32Array(32);
    const solidArr = new Float32Array(MAX_SOLIDS * 24);
    const staggerT = (cx, cz, prog) => { const dist = Math.hypot(cx, cz); const maxD = Math.hypot(hw, hd) || 1; return (prog - (dist / maxD) * 0.45) / (1 - 0.45); };

    function frame({ t, dt }) {
      const d = Math.min(dt || 0, 0.05);
      if (mode === "run") {
        const iv = interval(); acc += d; let guard = 0;
        while (acc >= iv && mode === "run" && guard < 8) {
          acc -= iv; commitActions(); tick++;
          if (live.length < solidCount) spawnUpTo(solidCount);   // replace exploded solids immediately
          if (live.length === 0) startClear();                    // board full — nothing could spawn
          if (mode === "run") planIteration();
          guard++;
        }
        if (acc > iv) acc = 0;
      } else { clearTimer -= d; if (clearTimer <= 0) finishClear(); }
      const phase = mode === "run" ? acc / interval() : 0;
      const ease = smoothstep(phase / ROLL_FRAC);
      const clearP = mode === "clear" ? 1 - clearTimer / CLEAR_DUR : 0;

      // advance explosions
      for (const e of dying) e.timer -= d;
      dying = dying.filter((e) => e.timer > 0);

      // camera
      const cw = context.canvas.width, ch = context.canvas.height, aspect = cw / Math.max(1, ch);
      const span = 2 * Math.max(hw, hd); const R = (span * 0.9 + 5) * camZoom; lastR = R;
      if (autoOrbit) orbitPhase += d * ORBIT_RATE;
      const theta = orbitPhase + camYaw; lastTheta = theta;
      const cphi = Math.cos(camPitch); const target = [panX, -0.3, panZ];
      const eye = [target[0] + R * cphi * Math.cos(theta), target[1] + R * Math.sin(camPitch), target[2] + R * cphi * Math.sin(theta)];
      const viewProj = mul(perspective(Math.PI / 4, aspect, 0.1, R * 4 + span * 2), lookAt(eye, target, [0, 1, 0]));

      uArr.set(viewProj, 0);
      uArr[16] = eye[0]; uArr[17] = eye[1]; uArr[18] = eye[2]; uArr[19] = 0;
      let er = 0, eg = 0, eb = 0; for (const c of palette) { er += c[0]; eg += c[1]; eb += c[2]; } const pn = palette.length || 1;
      uArr[20] = er / pn; uArr[21] = eg / pn; uArr[22] = eb / pn; uArr[23] = 0;   // env ground tint = palette average
      uArr[24] = CLEAR_DROP; uArr[25] = 0; uArr[26] = t; uArr[27] = 0;
      const Ld = norm([0.4, 0.85, 0.3]); uArr[28] = Ld[0]; uArr[29] = Ld[1]; uArr[30] = Ld[2]; uArr[31] = 1;
      device.queue.writeBuffer(ubuf, 0, uArr);

      // tiles
      let need = 0; for (const st of stamps) need += (st.poly.length - 2) * 3 * 6; need = Math.min(need, MAX_TILE_FLOATS); ensureTiles(need);
      if (need >= MAX_TILE_FLOATS && !warnedCap) { console.warn("[003] tile mesh hit the vertex cap at this grid size"); warnedCap = true; }
      let tv = 0;
      for (const st of stamps) { const drop = mode === "clear" ? smoothstep(staggerT(st.cx, st.cz, clearP)) * CLEAR_DROP : 0; const y = -drop, r = st.poly, n = r.length, c = st.col; for (let m = 1; m < n - 1; m++) for (const vi of [0, m, m + 1]) { if (tv + 6 > tileArr.length) break; tileArr[tv++] = r[vi][0]; tileArr[tv++] = y; tileArr[tv++] = r[vi][1]; tileArr[tv++] = c[0]; tileArr[tv++] = c[1]; tileArr[tv++] = c[2]; } }
      if (tv > 0) device.queue.writeBuffer(tileBuf, 0, tileArr, 0, tv);

      // solids: live (rolling) + dying (exploding), capped at MAX_SOLIDS
      let k = 0;
      for (const x of live) {
        if (k >= MAX_SOLIDS) break;
        const pose = (mode === "run" && x.pending) ? animRoll(x, ease) : x.pose; const c = x.color;
        solidArr.set(pose, k * 24); solidArr[k * 24 + 16] = 1; solidArr[k * 24 + 17] = 0; solidArr[k * 24 + 18] = 0; solidArr[k * 24 + 19] = 0;
        solidArr[k * 24 + 20] = c[0]; solidArr[k * 24 + 21] = c[1]; solidArr[k * 24 + 22] = c[2]; solidArr[k * 24 + 23] = 0; k++;
      }
      for (const e of dying) {
        if (k >= MAX_SOLIDS) break; const tt = 1 - e.timer / EXPLODE_DUR; const c = e.color;
        solidArr.set(e.pose, k * 24); solidArr[k * 24 + 16] = clamp(1 - tt, 0, 1); solidArr[k * 24 + 17] = tt * EXPLODE_PUSH; solidArr[k * 24 + 18] = 0; solidArr[k * 24 + 19] = 0;
        solidArr[k * 24 + 20] = c[0]; solidArr[k * 24 + 21] = c[1]; solidArr[k * 24 + 22] = c[2]; solidArr[k * 24 + 23] = 0; k++;
      }
      device.queue.writeBuffer(solidBuf, 0, solidArr, 0, k * 24);

      ensureDepth(cw, ch);
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: { r: 0.02, g: 0.02, b: 0.024, a: 1 }, loadOp: "clear", storeOp: "store" }], depthStencilAttachment: { view: depthTex.createView(), depthClearValue: 1.0, depthLoadOp: "clear", depthStoreOp: "store" } });
      pass.setBindGroup(0, bindGroup);
      if (tv > 0) { pass.setPipeline(tilePipe); pass.setVertexBuffer(0, tileBuf); pass.draw(tv / 6); }
      if (k > 0) { const g = SD.gpu; pass.setPipeline(solidPipe); pass.setVertexBuffer(0, g.vb); pass.setIndexBuffer(g.ib, "uint16"); pass.drawIndexed(g.count, k); }
      pass.end();
      device.queue.submit([enc.finish()]);
    }
    // animate a solid's roll from its resting pose toward its pending target
    function animRoll(x, ease) {
      const rr = rollOver(x.pose, SD.faces, x.face, edgeToPending(x));
      const Rm = mul(T(rr.P[0], rr.P[1], rr.P[2]), mul(rotAxis(rr.axis[0], rr.axis[1], rr.axis[2], rr.ang * ease), T(-rr.P[0], -rr.P[1], -rr.P[2])));
      return mul(Rm, x.pose);
    }
    // recover which edge leads to the pending move (matches the stored seg midpoint)
    function edgeToPending(x) {
      const f = SD.faces[x.face], n = f.ring.length, foot = foot2d(x.pose, f);
      for (let e = 0; e < n; e++) { const A = foot[e], B = foot[(e + 1) % n]; const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]; if (Math.hypot(mid[0] - x.pending.seg[0], mid[1] - x.pending.seg[1]) < 1e-3) return e; }
      return 0;
    }

    // ---- orbit-camera pointer/wheel controls (standalone only) ----------
    let cleanupInput = () => {};
    if (interactive && canvas && typeof canvas.addEventListener === "function") {
      let drag = null, lastX = 0, lastY = 0;
      const onDown = (e) => { lastX = e.clientX; lastY = e.clientY; drag = (e.button === 1 || e.button === 2 || e.shiftKey) ? "pan" : "orbit"; canvas.setPointerCapture?.(e.pointerId); };
      const onMove = (e) => { if (!drag) return; const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; if (drag === "orbit") { camYaw -= dx * 0.006; camPitch = clamp(camPitch - dy * 0.006, 0.12, 1.45); } else { const kr = 0.0016 * lastR, th = lastTheta; const rx = -Math.sin(th), rz = Math.cos(th), fx = -Math.cos(th), fz = -Math.sin(th); panX += (dx * rx + dy * fx) * kr; panZ += (dx * rz + dy * fz) * kr; } };
      const onUp = (e) => { drag = null; canvas.releasePointerCapture?.(e.pointerId); };
      const onWheel = (e) => { e.preventDefault(); camZoom = clamp(camZoom * Math.exp(e.deltaY * 0.0012), 0.2, 5); };
      const onCtx = (e) => e.preventDefault();
      canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointermove", onMove); canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointercancel", onUp); canvas.addEventListener("wheel", onWheel, { passive: false }); canvas.addEventListener("contextmenu", onCtx);
      cleanupInput = () => { canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", onUp); canvas.removeEventListener("wheel", onWheel); canvas.removeEventListener("contextmenu", onCtx); };
    }

    return {
      frame,
      resize({ width, height }) { ensureDepth(width, height); },
      destroy() { cleanupInput(); ubuf.destroy(); solidBuf.destroy(); tileBuf?.destroy(); for (const name of SOLID_NAMES) { solidData[name].gpu.vb.destroy(); solidData[name].gpu.ib.destroy(); } depthTex?.destroy(); depthTex = null; },
      setGrid({ x, y }) { pendingGridX = Math.max(2, Math.min(MAX_GRID, Math.round(x ?? pendingGridX))); pendingGridY = Math.max(2, Math.min(MAX_GRID, Math.round(y ?? pendingGridY))); dirtyReconfig = true; },
      getGrid() { return { x: pendingGridX, y: pendingGridY }; },
      setSolidCount(n) { pendingCount = Math.max(1, Math.min(MAX_SOLIDS, Math.round(n))); dirtyReconfig = true; },
      getSolidCount() { return dirtyReconfig ? pendingCount : solidCount; },
      setSpeed(s) { speed = Math.max(0.25, Math.min(8, s)); },
      getSpeed() { return speed; },
      setSolid(name) { if (solidData[name]) { pendingSolid = name; dirtyReconfig = true; } },
      getSolid() { return dirtyReconfig ? pendingSolid : currentSolid; },
      get solidNames() { return SOLID_NAMES.slice(); },
      newColors() { palette = makePalette(); return palette.map((c) => c.slice()); },
      getColors() { return palette.map((c) => c.slice()); },
      setAutoOrbit(b) { autoOrbit = !!b; },
      getAutoOrbit() { return autoOrbit; },
      resetView() { camYaw = 0; camPitch = 0.56; camZoom = 1; panX = 0; panZ = 0; },
      reset() { if (mode === "run") startClear(); },
    };
  },
};
