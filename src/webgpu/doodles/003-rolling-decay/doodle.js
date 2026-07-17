// @ts-check
// 003-rolling-decay — shiny cubes tip square-by-square across a chessboard,
// consuming the floor behind them until every cube is stranded, then the board
// rises and it begins again.
//
// The CPU owns the whole simulation (grid state, cube orientations, the
// iteration clock); the GPU only draws. Two instanced pipelines share one
// depth buffer and one bind group: thin-box floor squares, and unit metal
// cubes whose per-instance model matrices are computed here each frame (the
// rolling pivots are awkward to express in-shader). Module scope is
// environment-free (no top-level DOM/navigator) so build-manifest can import
// it in Node — see spec.md §5.
//
// FIRST STAB: reflections are the analytic environment only (sky + palette-
// tinted ground + fake strip lights + fresnel/specular). The dynamic
// environment-cubemap probe described in the doodle spec is a deliberate
// follow-up; the choreography lives here first.

// ---------------------------------------------------------------------------
// Tunables (world units; PITCH == cube edge == 1)
// ---------------------------------------------------------------------------
const PITCH = 1.0;          // cell-to-cell spacing / cube edge
const CUBE_H = 0.5;         // cube half-extent (rests with centre at y = CUBE_H)
const SQ_HALF = 0.46;       // square footprint half-width (gap between squares)
const SQ_TOP = 0.0;         // square top face sits at y = 0
const SQ_BOT = -0.14;       // square underside (sides read while sinking)

const ROLL_FRAC = 0.7;      // fraction of an iteration spent moving; rest dwells
const SINK_ITERS = 4.0;     // iterations a vacated square takes to fully sink
const SINK_DIST = 5.0;      // world depth a fully-sunk square has descended
const HOLD_ITERS = 2;       // iterations everyone spins before the board resets
const RISE_DUR = 1.5;       // seconds the board takes to rise back up
const ORBIT_RATE = 0.05;    // camera yaw (rad/s)

const MAX_GRID = 32;        // storage buffers allocated for the maximum board…
const MAX_CUBES = 64;       // …and the maximum cube count; draws use sub-ranges

// ---------------------------------------------------------------------------
// Cosine-gradient palette presets (IQ):  color(t) = a + b·cos(2π(c·t + d))
// Checker mapping samples light squares at t=0.25, dark at t=0.75, so c≈0.5
// lands the two parities on contrasting phases. These are starting points —
// they want on-hardware tuning (spec.md §1).
// ---------------------------------------------------------------------------
const PALETTES = [
  { name: "Classic",   a: [0.50, 0.50, 0.50], b: [0.50, 0.50, 0.50], c: [0.50, 0.50, 0.50], d: [0.00, 0.00, 0.00] },
  { name: "Ember",     a: [0.52, 0.34, 0.24], b: [0.45, 0.30, 0.20], c: [0.50, 0.50, 0.50], d: [0.00, 0.12, 0.20] },
  { name: "Glacier",   a: [0.40, 0.50, 0.56], b: [0.34, 0.42, 0.48], c: [0.50, 0.50, 0.50], d: [0.55, 0.48, 0.40] },
  { name: "Synthwave", a: [0.52, 0.26, 0.50], b: [0.45, 0.30, 0.48], c: [0.50, 0.50, 0.50], d: [0.20, 0.85, 0.55] },
  { name: "Moss",      a: [0.36, 0.44, 0.30], b: [0.30, 0.38, 0.26], c: [0.50, 0.50, 0.50], d: [0.10, 0.20, 0.12] },
];

// ---------------------------------------------------------------------------
// Tiny column-major mat4 helpers (WebGPU clip depth 0..1)
// ---------------------------------------------------------------------------
function identity() {
  const o = new Float32Array(16);
  o[0] = o[5] = o[10] = o[15] = 1;
  return o;
}
/** result = a · b (both column-major). */
function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}
function translate(x, y, z) {
  const o = identity();
  o[12] = x; o[13] = y; o[14] = z;
  return o;
}
function rotX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  const o = identity();
  o[5] = c; o[6] = s; o[9] = -s; o[10] = c;
  return o;
}
function rotY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  const o = identity();
  o[0] = c; o[2] = -s; o[8] = s; o[10] = c;
  return o;
}
function rotZ(a) {
  const c = Math.cos(a), s = Math.sin(a);
  const o = identity();
  o[0] = c; o[1] = s; o[4] = -s; o[5] = c;
  return o;
}
/** Right-handed perspective, clip-space depth 0..1. */
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  const o = new Float32Array(16);
  o[0] = f / aspect;
  o[5] = f;
  o[10] = far * nf;
  o[11] = -1;
  o[14] = far * near * nf;
  return o;
}
/** Right-handed look-at (camera gazes down -z in view space). */
function lookAt(eye, center, up) {
  const fx = center[0] - eye[0], fy = center[1] - eye[1], fz = center[2] - eye[2];
  let rl = 1 / Math.hypot(fx, fy, fz);
  const Fx = fx * rl, Fy = fy * rl, Fz = fz * rl;
  let sx = Fy * up[2] - Fz * up[1];
  let sy = Fz * up[0] - Fx * up[2];
  let sz = Fx * up[1] - Fy * up[0];
  rl = 1 / Math.hypot(sx, sy, sz);
  sx *= rl; sy *= rl; sz *= rl;
  const ux = sy * Fz - sz * Fy;
  const uy = sz * Fx - sx * Fz;
  const uz = sx * Fy - sy * Fx;
  const o = new Float32Array(16);
  o[0] = sx; o[4] = sy; o[8] = sz; o[12] = -(sx * eye[0] + sy * eye[1] + sz * eye[2]);
  o[1] = ux; o[5] = uy; o[9] = uz; o[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
  o[2] = -Fx; o[6] = -Fy; o[10] = -Fz; o[14] = (Fx * eye[0] + Fy * eye[1] + Fz * eye[2]);
  o[15] = 1;
  return o;
}

// The 24 axis-aligned proper rotations (signed permutation matrices, det +1).
// A finished roll/yaw folds its 90° turn into the cube's orientation and snaps
// to the nearest of these so floating-point error can never accumulate.
function buildRot24() {
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const out = [];
  for (const p of perms) {
    for (let bits = 0; bits < 8; bits++) {
      const sgn = [bits & 1 ? -1 : 1, bits & 2 ? -1 : 1, bits & 4 ? -1 : 1];
      // Column c of the 3×3 is basis vector e_{p[c]} scaled by sgn[c].
      const m = new Float32Array(16);
      m[15] = 1;
      for (let col = 0; col < 3; col++) m[col * 4 + p[col]] = sgn[col];
      // Determinant of the 3×3 (must be +1 for a proper rotation).
      const det =
        m[0] * (m[5] * m[10] - m[6] * m[9]) -
        m[4] * (m[1] * m[10] - m[2] * m[9]) +
        m[8] * (m[1] * m[6] - m[2] * m[5]);
      if (det > 0.5) out.push(m);
    }
  }
  return out; // 24 of them
}
const ROT24 = buildRot24();

/** Snap an (approximately axis-aligned) rotation matrix to the nearest of the 24. */
function snap24(m) {
  let best = ROT24[0], bestScore = -Infinity;
  for (const cand of ROT24) {
    // Frobenius inner product of the 3×3 blocks; maximised by the closest.
    let s = 0;
    for (let col = 0; col < 3; col++)
      for (let row = 0; row < 3; row++)
        s += m[col * 4 + row] * cand[col * 4 + row];
    if (s > bestScore) { bestScore = s; best = cand; }
  }
  return best;
}

// Deterministic per-cell hash in [0,1) for mosaic jitter (no RNG state).
function cellHash(cx, cz) {
  const s = Math.sin(cx * 12.9898 + cz * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

const smoothstep = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

export default {
  meta: {
    title: "Rolling Decay",
    description:
      "Shiny cubes tip square-by-square across a chessboard, sinking the floor behind them until every cube is stranded.",
    tags: ["mesh", "3d", "simulation", "instanced", "generative"],
    created: "2026-07-17",
    prefersReducedMotionSafe: false,
  },

  /** @param {any} ctx */
  async init(ctx) {
    const { device, context, format, loadWGSL } = ctx;

    // ---- pipelines -------------------------------------------------------
    const module = device.createShaderModule({ code: await loadWGSL("./shader.wgsl") });

    // Globals: viewProj(64) + camPos(16) + palA/B/C/D(64) + params(16) + light(16) = 176.
    const ubuf = device.createBuffer({
      size: 176,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Square instances: one vec4 each (centreX, centreZ, sinkY, t).
    const sqBuf = device.createBuffer({
      size: MAX_GRID * MAX_GRID * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    // Cube instances: one mat4 each (model).
    const cubeBuf = device.createBuffer({
      size: MAX_CUBES * 64,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const bgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      ],
    });
    const bindGroup = device.createBindGroup({
      layout: bgl,
      entries: [
        { binding: 0, resource: { buffer: ubuf } },
        { binding: 1, resource: { buffer: sqBuf } },
        { binding: 2, resource: { buffer: cubeBuf } },
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });

    const DEPTH_FORMAT = "depth24plus";
    const vertexBuffers = [{
      arrayStride: 24,
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x3" },   // position
        { shaderLocation: 1, offset: 12, format: "float32x3" },  // normal
      ],
    }];
    const makePipe = (vs, fs) => device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module, entryPoint: vs, buffers: vertexBuffers },
      fragment: { module, entryPoint: fs, targets: [{ format }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: "less" },
    });
    const sqPipe = makePipe("vs_sq", "fs_sq");
    const cubePipe = makePipe("vs_cube", "fs_cube");

    // ---- static geometry -------------------------------------------------
    function makeBox(x0, x1, y0, y1, z0, z1) {
      const f = [], idx = [];
      let base = 0;
      const quad = (a, b, c, d, n) => {
        for (const p of [a, b, c, d]) f.push(p[0], p[1], p[2], n[0], n[1], n[2]);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        base += 4;
      };
      quad([x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [1, 0, 0]);   // +X
      quad([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [-1, 0, 0]);  // -X
      quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]);   // +Y
      quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);  // -Y
      quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);   // +Z
      quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);  // -Z
      return { verts: new Float32Array(f), indices: new Uint16Array(idx) };
    }
    const sqGeo = makeBox(-SQ_HALF, SQ_HALF, SQ_BOT, SQ_TOP, -SQ_HALF, SQ_HALF);
    const cubeGeo = makeBox(-CUBE_H, CUBE_H, -CUBE_H, CUBE_H, -CUBE_H, CUBE_H);

    const uploadGeo = (geo) => {
      const vb = device.createBuffer({ size: geo.verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(vb, 0, geo.verts);
      const ib = device.createBuffer({ size: geo.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(ib, 0, geo.indices);
      return { vb, ib, count: geo.indices.length };
    };
    const sqMesh = uploadGeo(sqGeo);
    const cubeMesh = uploadGeo(cubeGeo);

    // Depth texture is size-dependent: created lazily, recreated on resize.
    let depthTex = null;
    let depthW = 0, depthH = 0;
    function ensureDepth(w, h) {
      if (depthTex && depthW === w && depthH === h) return;
      depthTex?.destroy();
      depthTex = device.createTexture({
        size: { width: Math.max(1, w), height: Math.max(1, h) },
        format: DEPTH_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      depthW = w; depthH = h;
    }

    // ---- controls (defaults look good unattended) ------------------------
    let gridX = 12, gridY = 12;
    let cubeCount = 6;
    let speed = 1.5;              // iterations / second
    let paletteIdx = 0;
    let mosaic = 0.0;
    let palOverride = null;       // set by randomPalette(); overrides paletteIdx

    // Queued reconfig (grid / cube-count changes apply at the next boundary).
    let dirtyReconfig = false;
    let pendingGridX = gridX, pendingGridY = gridY, pendingCount = cubeCount;

    // ---- simulation state ------------------------------------------------
    // Cells: state 0=alive, 1=sinking, 2=gone. sinkAt = continuous-tick at which
    // it began sinking. Flat arrays indexed idx = cz*gridX + cx.
    let cellState = new Uint8Array(MAX_GRID * MAX_GRID);
    let sinkAt = new Float32Array(MAX_GRID * MAX_GRID);
    let riseFrom = new Float32Array(MAX_GRID * MAX_GRID); // captured depth at rise start

    // Cubes: current resting cell (cx,cz), orientation O (mat4, one of ROT24),
    // and the action animating through the current iteration.
    const cubes = [];
    for (let i = 0; i < MAX_CUBES; i++) {
      cubes.push({ cx: 0, cz: 0, O: identity(), action: null });
    }

    let tick = 0;                 // completed iterations
    let acc = 0;                  // seconds into the current iteration
    let mode = "run";             // "run" | "rise"
    let riseTimer = 0;
    let resetHold = 0;            // iterations of spinning left before a rise

    const cellIdx = (cx, cz) => cz * gridX + cx;
    const cellWorld = (cx, cz) => [
      (cx - (gridX - 1) / 2) * PITCH,
      (cz - (gridY - 1) / 2) * PITCH,
    ];

    // Continuous depth a cell has sunk (world units); 0 for alive.
    function cellDepth(cx, cz) {
      const idx = cellIdx(cx, cz);
      const st = cellState[idx];
      if (st === 0) return 0;
      if (st === 2) return SINK_DIST;
      const elapsed = (tick + acc / interval()) - sinkAt[idx];
      return Math.min(1, elapsed / SINK_ITERS) * SINK_DIST;
    }
    const interval = () => 1 / speed;

    // Simple RNG (Math.random is allowed at runtime; determinism isn't required
    // here — resets re-scatter freshly by design).
    const shuffled = (n) => {
      const a = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    };

    // ---- placing / resetting the board ----------------------------------
    function clearBoard() {
      for (let i = 0; i < gridX * gridY; i++) { cellState[i] = 0; sinkAt[i] = 0; }
    }
    function scatterCubes() {
      const cells = shuffled(gridX * gridY).slice(0, cubeCount);
      for (let i = 0; i < cubeCount; i++) {
        const cx = cells[i] % gridX, cz = (cells[i] / gridX) | 0;
        cubes[i].cx = cx; cubes[i].cz = cz;
        cubes[i].O = identity();
        cubes[i].action = null;
      }
    }
    function applyReconfig() {
      gridX = pendingGridX; gridY = pendingGridY;
      cubeCount = Math.max(1, Math.min(pendingCount, gridX * gridY));
      clearBoard();
      scatterCubes();
      tick = 0; acc = 0; resetHold = 0; mode = "run";
    }

    // Roll geometry per direction: [dCx, dCz, axis, dir, pivotDx, pivotDz].
    // axis 'z' θ:0→-90 rolls +X; 'z' +90 → -X; 'x' +90 → +Z; 'x' -90 → -Z.
    const DIRS = [
      { dcx: 1, dcz: 0, axis: "z", dir: -1, pdx: 0.5, pdz: 0 },
      { dcx: -1, dcz: 0, axis: "z", dir: 1, pdx: -0.5, pdz: 0 },
      { dcx: 0, dcz: 1, axis: "x", dir: 1, pdx: 0, pdz: 0.5 },
      { dcx: 0, dcz: -1, axis: "x", dir: -1, pdx: 0, pdz: -0.5 },
    ];

    function planIteration() {
      // Grid / cube-count changes take effect on an iteration boundary.
      if (dirtyReconfig) { dirtyReconfig = false; applyReconfig(); }

      // During the post-collapse hold everyone just spins.
      if (resetHold > 0) {
        resetHold--;
        for (let i = 0; i < cubeCount; i++) planYaw(i);
        if (resetHold === 0) startRise();
        return;
      }

      const occupied = new Set();
      for (let i = 0; i < cubeCount; i++) occupied.add(cellIdx(cubes[i].cx, cubes[i].cz));
      const claimed = new Set();

      let allStranded = true;
      for (const i of shuffled(cubeCount)) {
        const c = cubes[i];
        const targets = [];
        for (const D of DIRS) {
          const nx = c.cx + D.dcx, nz = c.cz + D.dcz;
          if (nx < 0 || nx >= gridX || nz < 0 || nz >= gridY) continue;
          const ni = cellIdx(nx, nz);
          if (cellState[ni] !== 0) continue;      // must be alive
          if (occupied.has(ni)) continue;         // no cube resting there now
          if (claimed.has(ni)) continue;          // not taken this iteration
          targets.push(D);
        }
        if (targets.length > 0) {
          const D = targets[(Math.random() * targets.length) | 0];
          const nx = c.cx + D.dcx, nz = c.cz + D.dcz;
          claimed.add(cellIdx(nx, nz));
          // Vacated cell begins sinking now.
          const vi = cellIdx(c.cx, c.cz);
          cellState[vi] = 1; sinkAt[vi] = tick;
          planRoll(i, D);
          allStranded = false;
        } else {
          planYaw(i);
        }
      }

      // Reset only when EVERY cube is stranded in the same iteration.
      if (allStranded && cubeCount > 0) resetHold = HOLD_ITERS;
    }

    function planRoll(i, D) {
      const c = cubes[i];
      const [xA, zA] = cellWorld(c.cx, c.cz);
      c.action = {
        type: "roll",
        axis: D.axis, dir: D.dir,
        toCx: c.cx + D.dcx, toCz: c.cz + D.dcz,
        A: [xA, CUBE_H, zA],
        pivot: [xA + D.pdx * PITCH, 0, zA + D.pdz * PITCH],
        O0: c.O,
      };
    }
    function planYaw(i) {
      const c = cubes[i];
      const [xA, zA] = cellWorld(c.cx, c.cz);
      c.action = { type: "yaw", dir: Math.random() < 0.5 ? 1 : -1, A: [xA, CUBE_H, zA], O0: c.O };
    }

    // Fold a completed iteration's actions into the cubes' resting state.
    function commitActions() {
      for (let i = 0; i < cubeCount; i++) {
        const c = cubes[i], act = c.action;
        if (!act) continue;
        if (act.type === "roll") {
          const R = act.axis === "x" ? rotX(act.dir * Math.PI / 2) : rotZ(act.dir * Math.PI / 2);
          c.O = snap24(mul(R, act.O0));
          c.cx = act.toCx; c.cz = act.toCz;
        } else if (act.type === "yaw") {
          c.O = snap24(mul(rotY(act.dir * Math.PI / 2), act.O0));
        }
        c.action = null;
      }
    }

    // ---- reset choreography ---------------------------------------------
    function startRise() {
      for (let i = 0; i < gridX * gridY; i++) {
        const cx = i % gridX, cz = (i / gridX) | 0;
        riseFrom[i] = cellDepth(cx, cz);
      }
      mode = "rise";
      riseTimer = RISE_DUR;
    }
    function finishRise() {
      clearBoard();
      scatterCubes();
      mode = "run";
      tick = 0; acc = 0; resetHold = 0;
      planIteration();
    }

    // The instant re-scatter used by grid/cube edits and the reset() button —
    // skips straight to the rise animation from the current (partial) board.
    function requestRise() { if (mode === "run") startRise(); }

    // Kick things off.
    applyReconfig();
    planIteration();

    // ---- per-frame CPU→GPU packing --------------------------------------
    const uArr = new Float32Array(44);          // 176 bytes
    const sqArr = new Float32Array(MAX_GRID * MAX_GRID * 4);
    const cubeArr = new Float32Array(MAX_CUBES * 16);

    function activePalette() {
      return palOverride || PALETTES[paletteIdx];
    }

    // Compute one cube's model matrix for phase p ∈ [0,1) of the iteration.
    function cubeModel(c, p) {
      const act = c.action;
      if (!act || mode === "rise") {
        const [xA, zA] = cellWorld(c.cx, c.cz);
        return mul(translate(xA, CUBE_H, zA), c.O);
      }
      const ease = smoothstep(p / ROLL_FRAC);
      if (act.type === "roll") {
        const ang = act.dir * (Math.PI / 2) * ease;
        const R = act.axis === "x" ? rotX(ang) : rotZ(ang);
        const px = act.pivot, A = act.A;
        // T(p)·R·T(-p)·T(A)·O0
        return mul(translate(px[0], px[1], px[2]),
          mul(R, mul(translate(-px[0], -px[1], -px[2]),
            mul(translate(A[0], A[1], A[2]), act.O0))));
      }
      // yaw: spin about the cube's own vertical through its centre.
      const A = act.A;
      return mul(translate(A[0], A[1], A[2]), mul(rotY(act.dir * (Math.PI / 2) * ease), act.O0));
    }

    function frame({ t, dt }) {
      const d = Math.min(dt || 0, 0.05);

      // Advance the iteration clock (decoupled from frame rate).
      if (mode === "run") {
        const iv = interval();
        acc += d;
        let guard = 0;
        while (acc >= iv && mode === "run" && guard < 8) {
          acc -= iv;
          commitActions();
          tick++;
          planIteration();
          guard++;
        }
        if (acc > iv) acc = 0; // don't spiral after a long stall
      } else {
        riseTimer -= d;
        if (riseTimer <= 0) finishRise();
      }
      const phase = mode === "run" ? acc / interval() : 0;
      const riseP = mode === "rise" ? 1 - riseTimer / RISE_DUR : 1;

      // ---- camera (frames any grid size from its extents) ----
      const cw = context.canvas.width, ch = context.canvas.height;
      const aspect = cw / Math.max(1, ch);
      const span = Math.max(gridX, gridY) * PITCH;
      const radius = span * 1.45 + 4;
      const height = span * 0.9 + 3;
      const orbit = t * ORBIT_RATE;
      const eye = [Math.cos(orbit) * radius, height, Math.sin(orbit) * radius];
      const center = [0, -0.3, 0];
      const proj = perspective(Math.PI / 4, aspect, 0.1, radius * 4 + span * 2);
      const viewProj = mul(proj, lookAt(eye, center, [0, 1, 0]));

      const pal = activePalette();
      uArr.set(viewProj, 0);
      uArr[16] = eye[0]; uArr[17] = eye[1]; uArr[18] = eye[2]; uArr[19] = 0;
      uArr[20] = pal.a[0]; uArr[21] = pal.a[1]; uArr[22] = pal.a[2]; uArr[23] = 0;
      uArr[24] = pal.b[0]; uArr[25] = pal.b[1]; uArr[26] = pal.b[2]; uArr[27] = 0;
      uArr[28] = pal.c[0]; uArr[29] = pal.c[1]; uArr[30] = pal.c[2]; uArr[31] = 0;
      uArr[32] = pal.d[0]; uArr[33] = pal.d[1]; uArr[34] = pal.d[2]; uArr[35] = 0;
      uArr[36] = SINK_DIST; uArr[37] = mosaic; uArr[38] = t; uArr[39] = 0;
      // sun direction (normalised) + intensity in .w
      const L = [0.4, 0.85, 0.3];
      const ln = 1 / Math.hypot(L[0], L[1], L[2]);
      uArr[40] = L[0] * ln; uArr[41] = L[1] * ln; uArr[42] = L[2] * ln; uArr[43] = 1;
      device.queue.writeBuffer(ubuf, 0, uArr);

      // ---- square instances (skip gone cells in run mode) ----
      let sqN = 0;
      for (let cz = 0; cz < gridY; cz++) {
        for (let cx = 0; cx < gridX; cx++) {
          const idx = cellIdx(cx, cz);
          let depth;
          if (mode === "rise") {
            depth = riseFrom[idx] * (1 - smoothstep(staggerT(cx, cz, riseP)));
          } else {
            if (cellState[idx] === 2) continue; // gone: not drawn
            depth = cellDepth(cx, cz);
          }
          const [wx, wz] = cellWorld(cx, cz);
          const parity = (cx + cz) & 1;
          let tt = parity ? 0.75 : 0.25;
          tt += mosaic * (cellHash(cx, cz) - 0.5) * 0.28;
          const o = sqN * 4;
          sqArr[o] = wx; sqArr[o + 1] = wz; sqArr[o + 2] = -depth; sqArr[o + 3] = tt;
          sqN++;
        }
      }
      device.queue.writeBuffer(sqBuf, 0, sqArr, 0, sqN * 4);

      // ---- cube instances ----
      for (let i = 0; i < cubeCount; i++) {
        cubeArr.set(cubeModel(cubes[i], phase), i * 16);
      }
      device.queue.writeBuffer(cubeBuf, 0, cubeArr, 0, cubeCount * 16);

      // ---- draw ----
      ensureDepth(cw, ch);
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.02, g: 0.02, b: 0.024, a: 1 },
          loadOp: "clear", storeOp: "store",
        }],
        depthStencilAttachment: {
          view: depthTex.createView(),
          depthClearValue: 1.0, depthLoadOp: "clear", depthStoreOp: "store",
        },
      });
      pass.setBindGroup(0, bindGroup);
      pass.setPipeline(sqPipe);
      pass.setVertexBuffer(0, sqMesh.vb);
      pass.setIndexBuffer(sqMesh.ib, "uint16");
      pass.drawIndexed(sqMesh.count, sqN);
      pass.setPipeline(cubePipe);
      pass.setVertexBuffer(0, cubeMesh.vb);
      pass.setIndexBuffer(cubeMesh.ib, "uint16");
      pass.drawIndexed(cubeMesh.count, cubeCount);
      pass.end();
      device.queue.submit([enc.finish()]);
    }

    // Rise wave: centre cells rise first. Returns a 0..1 progress for this cell.
    function staggerT(cx, cz, riseP) {
      const mx = (gridX - 1) / 2, mz = (gridY - 1) / 2;
      const dist = Math.hypot(cx - mx, cz - mz);
      const maxDist = Math.hypot(mx, mz) || 1;
      const delay = (dist / maxDist) * 0.45;
      return (riseP - delay) / (1 - 0.45);
    }

    // ---- instance --------------------------------------------------------
    return {
      frame,

      resize({ width, height }) { ensureDepth(width, height); },

      destroy() {
        ubuf.destroy(); sqBuf.destroy(); cubeBuf.destroy();
        sqMesh.vb.destroy(); sqMesh.ib.destroy();
        cubeMesh.vb.destroy(); cubeMesh.ib.destroy();
        depthTex?.destroy(); depthTex = null;
      },

      // ---- control surface (standalone UI only; gallery ignores these) ----
      setGrid({ x, y }) {
        pendingGridX = Math.max(2, Math.min(MAX_GRID, Math.round(x ?? pendingGridX)));
        pendingGridY = Math.max(2, Math.min(MAX_GRID, Math.round(y ?? pendingGridY)));
        pendingCount = Math.min(cubeCount, pendingGridX * pendingGridY);
        dirtyReconfig = true;
      },
      getGrid() { return { x: pendingGridX, y: pendingGridY }; },

      setCubeCount(n) {
        pendingCount = Math.max(1, Math.min(MAX_CUBES, Math.round(n)));
        dirtyReconfig = true;
      },
      getCubeCount() { return dirtyReconfig ? pendingCount : cubeCount; },

      setSpeed(s) { speed = Math.max(0.25, Math.min(8, s)); },
      getSpeed() { return speed; },

      setPalette(name) {
        const i = PALETTES.findIndex((p) => p.name === name);
        if (i >= 0) { paletteIdx = i; palOverride = null; }
      },
      getPalette() { return palOverride ? palOverride.name : PALETTES[paletteIdx].name; },
      get paletteNames() { return PALETTES.map((p) => p.name); },

      setMosaic(v) { mosaic = Math.max(0, Math.min(1, v)); },
      getMosaic() { return mosaic; },

      // Generate tasteful cosine coefficients and make them the active palette.
      randomPalette() {
        const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
        const vec = (lo, hi) => [rnd(lo, hi), rnd(lo, hi), rnd(lo, hi)];
        palOverride = {
          name: "Random",
          a: vec(0.35, 0.6), b: vec(0.25, 0.5),
          c: [rnd(0.4, 0.6), rnd(0.4, 0.6), rnd(0.4, 0.6)],
          d: vec(0.0, 1.0),
        };
        return palOverride;
      },

      reset() { requestRise(); },
    };
  },
};
