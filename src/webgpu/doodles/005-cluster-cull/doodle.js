// @ts-check
// 005-cluster-cull — a generative overlap-depth machine.
//
// Each cycle throws a scatter of shapes *invisibly*, then draws the OUTLINE of
// the region covered by at least `x` of them — the deep overlaps, not the outer
// union. At x=1 that's the outline of the union; at x=3 it's the little cores
// where three or more shapes pile up. Hold, admire, re-throw. See ./spec.md.
//
// The GPU does the drawing and the per-pixel coverage count (see shader.wgsl);
// this module runs the throw, a coarse coverage sample (for stats + knowing
// when a threshold shows nothing), and the animation clock, and uploads a
// per-shape record when the throw changes. Module scope is environment-free
// (no top-level DOM/navigator) per ../../spec.md §5.
//
// COORDINATE SPACE mirrors the shader's: "n-units" are normalised, centred and
// scaled by the viewport min dimension. Sizes are fractions of that min
// dimension; positions are centred n-units; stroke widths are pixels.

const MAXS = 64;                 // storage buffer sized for the max shape count
const STRIDE = 8;                // f32 per shape record (32 B, 16-aligned)

// Cycle durations (seconds).
const REVEAL_DUR = 0.6;          // outline fades in
const FADE_DUR   = 0.6;          // …and out before the next throw
const EMPTY_DUR  = 1.0;          // threshold shows nothing → hold blank, re-throw

// Phases.
const REVEAL = 0, HOLD = 1, FADE = 2, EMPTYHOLD = 3;

// Coverage-sample grid resolution (per axis) for maxDepth / empty detection.
const DEPTH_GRID = 128;

// ---- canonical shapes -------------------------------------------------------
// kind index → { verts | ellipse }. Bounding radius of every canonical shape
// is 1, so a record's `size` is its bounding radius in n-units. These vertex
// tables are byte-for-byte identical to shapeSDF() in shader.wgsl — the two
// SDF copies must agree or the coverage count will contradict the pixels
// (spec § "Implementation notes"). Any edit here edits there.
const KIND = {
  circle: 0, square: 1, triangle: 2, oval: 3, star: 4, trapezoid: 5, parallelogram: 6,
};
const KIND_COUNT = 7;
const KIND_NAMES = ["circle", "square", "triangle", "oval", "star", "trapezoid", "parallelogram"];
const ALL_KINDS = [0, 1, 2, 3, 4, 5, 6];

const POLY = {
  1: [[ 0.70710678,  0.70710678], [-0.70710678,  0.70710678],
      [-0.70710678, -0.70710678], [ 0.70710678, -0.70710678]],            // square
  2: [[ 0.0, 1.0], [-0.86602540, -0.5], [ 0.86602540, -0.5]],             // triangle
  4: [[ 0.0,         1.0], [-0.24686980,  0.33978710],                     // star
      [-0.95105650,  0.30901700], [-0.39944370, -0.12978710],
      [-0.58778530, -0.80901700], [ 0.0,        -0.42],
      [ 0.58778530, -0.80901700], [ 0.39944370, -0.12978710],
      [ 0.95105650,  0.30901700], [ 0.24686980,  0.33978710]],
  5: [[ 0.86602540, -0.5], [ 0.45, 0.5], [-0.45, 0.5], [-0.86602540, -0.5]], // trapezoid
  6: [[-0.55889100, -0.46574300], [ 0.55889100, -0.46574300],             // parallelogram
      [ 0.88491100,  0.46574300], [-0.23287100,  0.46574300]],
};
const OVAL_AB = [1.0, 0.62];

// iq polygon SDF — exact signed distance to a simple polygon (matches sdPoly in
// the shader). `v` is an array of [x,y].
function sdPoly(px, py, v) {
  const n = v.length;
  let d = (px - v[0][0]) * (px - v[0][0]) + (py - v[0][1]) * (py - v[0][1]);
  let s = 1.0;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const vix = v[i][0], viy = v[i][1];
    const ex = v[j][0] - vix, ey = v[j][1] - viy;
    const wx = px - vix, wy = py - viy;
    const t = Math.min(1, Math.max(0, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    const bx = wx - ex * t, by = wy - ey * t;
    d = Math.min(d, bx * bx + by * by);
    const c0 = py >= viy, c1 = py < v[j][1], c2 = ex * wy > ey * wx;
    if ((c0 && c1 && c2) || (!c0 && !c1 && !c2)) s = -s;
  }
  return s * Math.sqrt(d);
}

function sdEllipse(px, py, ax, ay) {
  const k1 = Math.hypot(px / ax, py / ay);
  const k2 = Math.hypot(px / (ax * ax), py / (ay * ay));
  return (k1 * (k1 - 1.0)) / Math.max(k2, 1e-6);
}

// Canonical unit SDF (bounding radius 1) in the shape's local frame.
function shapeSDF(kind, qx, qy) {
  if (kind === KIND.circle) return Math.hypot(qx, qy) - 1.0;
  if (kind === KIND.oval) return sdEllipse(qx, qy, OVAL_AB[0], OVAL_AB[1]);
  return sdPoly(qx, qy, POLY[kind]);
}

export default {
  meta: {
    title: "Cluster Cull",
    description:
      "Shapes are thrown unseen; the outline of every region covered by at least x of them is drawn — the deep overlaps, not the outer union.",
    tags: ["2d", "sdf", "generative", "composition", "boolean"],
    created: "2026-07-20",
    prefersReducedMotionSafe: false,
  },

  /** @param {any} ctx */
  async init(ctx) {
    const { device, context, format, loadWGSL } = ctx;

    // ---- pipeline ----------------------------------------------------------
    const module = device.createShaderModule({ code: await loadWGSL("./shader.wgsl") });

    const ubuf = device.createBuffer({
      size: 48, // Globals: 3 vec4
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const sbuf = device.createBuffer({
      size: MAXS * STRIDE * 4, // Shape: 8 f32 each
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const bgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
      ],
    });
    const bindGroup = device.createBindGroup({
      layout: bgl,
      entries: [
        { binding: 0, resource: { buffer: ubuf } },
        { binding: 1, resource: { buffer: sbuf } },
      ],
    });
    const pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
      vertex: { module, entryPoint: "vs_main" },
      fragment: { module, entryPoint: "fs_main", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });

    const uArr = new Float32Array(12);
    const sArr = new Float32Array(MAXS * STRIDE);
    let shapesDirty = true;

    // ---- controls (defaults chosen to look good unattended) ----------------
    let shapeCount = 24;         // desired count for the *next* throw
    let overlap = 3;             // `x` — draw the boundary of the ≥ x coverage region
    let sizeMin = 0.06, sizeMax = 0.16;   // bounding radius (fraction of min-dim)
    let rotMin = 0, rotMax = 360;         // degrees
    let strokeMin = 2, strokeMax = 5;     // px
    let holdTime = 5.0;                   // seconds
    let inkRGB = [0xe9 / 255, 0xe9 / 255, 0xee / 255];
    const enabled = new Uint8Array(KIND_COUNT).fill(1);   // shape-type pool

    // ---- per-shape data (indexed 0..thrownCount-1) -------------------------
    const kind = new Int32Array(MAXS);
    const cx = new Float32Array(MAXS);
    const cy = new Float32Array(MAXS);
    const size = new Float32Array(MAXS);
    const rot = new Float32Array(MAXS);        // radians
    const cosR = new Float32Array(MAXS);
    const sinR = new Float32Array(MAXS);
    const strokeHalf = new Float32Array(MAXS); // px

    let thrownCount = shapeCount;   // record count of the *current* throw
    let maxDepth = 0;               // deepest coverage in the current throw (grid estimate)

    // ---- seeded RNG (mulberry32; a throw is reproducible via rethrow(seed)) -
    let seed = 1;
    let rand = mulberry32(seed);
    function mulberry32(a) {
      return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    const uniform = (lo, hi) => lo + (hi - lo) * rand();

    // ---- SDF eval on a live shape (n-units), mirrors shader.distOf ---------
    function shapeDistAt(i, px, py) {
      const sz = size[i];
      const rx = px - cx[i], ry = py - cy[i];
      const lx =  cosR[i] * rx + sinR[i] * ry;
      const ly = -sinR[i] * rx + cosR[i] * ry;
      return sz * shapeSDF(kind[i], lx / Math.max(sz, 1e-5), ly / Math.max(sz, 1e-5));
    }

    // Coverage depth at a point = number of shapes whose filled area contains it.
    function depthAt(px, py) {
      let c = 0;
      for (let i = 0; i < thrownCount; i++) if (shapeDistAt(i, px, py) <= 0) c++;
      return c;
    }

    // ---- the throw ---------------------------------------------------------
    // Viewport half-extents in n-units, from the canvas aspect at throw time.
    function halfExtents() {
      const w = context.canvas.width || 1, h = context.canvas.height || 1;
      const m = Math.min(w, h);
      return { hw: w / (2 * m), hh: h / (2 * m), minDim: m };
    }

    // Estimate the deepest overlap by sampling a grid over the viewport — for
    // stats and for knowing whether the current threshold shows anything.
    function sampleMaxDepth(hw, hh) {
      let best = 0;
      const nx = DEPTH_GRID, ny = DEPTH_GRID;
      for (let iy = 0; iy < ny; iy++) {
        const py = -hh + (2 * hh) * (iy + 0.5) / ny;
        for (let ix = 0; ix < nx; ix++) {
          const px = -hw + (2 * hw) * (ix + 0.5) / nx;
          const d = depthAt(px, py);
          if (d > best) best = d;
        }
      }
      return best;
    }

    function writeRecords() {
      for (let i = 0; i < thrownCount; i++) {
        const o = i * STRIDE;
        sArr[o + 0] = kind[i];
        sArr[o + 1] = cx[i];
        sArr[o + 2] = cy[i];
        sArr[o + 3] = size[i];
        sArr[o + 4] = cosR[i];
        sArr[o + 5] = sinR[i];
        sArr[o + 6] = strokeHalf[i];
        sArr[o + 7] = 0;
      }
      shapesDirty = true;
    }

    function doThrow(newSeed) {
      seed = newSeed !== undefined ? (newSeed >>> 0) : (Math.floor(rand() * 0xffffffff) >>> 0);
      rand = mulberry32(seed);
      thrownCount = shapeCount;

      // shape-type pool: pick only from enabled types (all seven if none set)
      const poolArr = [];
      for (let k = 0; k < KIND_COUNT; k++) if (enabled[k]) poolArr.push(k);
      const pool = poolArr.length ? poolArr : ALL_KINDS;

      const { hw, hh, minDim } = halfExtents();
      for (let i = 0; i < thrownCount; i++) {
        kind[i] = pool[Math.min(pool.length - 1, (rand() * pool.length) | 0)];
        size[i] = uniform(sizeMin, sizeMax);
        const deg = uniform(rotMin, rotMax);
        rot[i] = (deg * Math.PI) / 180;
        cosR[i] = Math.cos(rot[i]);
        sinR[i] = Math.sin(rot[i]);
        strokeHalf[i] = uniform(strokeMin, strokeMax) * 0.5;

        // position: uniform inside the viewport, inset so the shape (fill +
        // half stroke) lands fully on-canvas.
        const inset = size[i] + (strokeHalf[i] / minDim);
        const rx = Math.max(0, hw - inset), ry = Math.max(0, hh - inset);
        cx[i] = uniform(-rx, rx);
        cy[i] = uniform(-ry, ry);
      }
      maxDepth = sampleMaxDepth(hw, hh);
      writeRecords();
    }

    const isShowing = () => overlap <= maxDepth;

    // ---- animation cycle ---------------------------------------------------
    let phase = REVEAL;
    let phaseT = 0;
    let globalFade = 0;   // whole-composition opacity (reveal / hold / fade)
    let pendingSeed;      // seed queued for the next throw

    const smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

    // Reduced motion: skip straight to a completed, held composition.
    const reducedStatic =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    function startNextThrow() {
      doThrow(pendingSeed);
      pendingSeed = undefined;
      phaseT = 0;
      if (isShowing()) { phase = REVEAL; globalFade = 0; }
      else { phase = EMPTYHOLD; globalFade = 0; }
    }

    if (reducedStatic) {
      for (let tries = 0; tries < 24; tries++) {
        doThrow(tries === 0 ? 1 : undefined);
        if (isShowing()) break;
      }
      phase = HOLD; phaseT = 0; globalFade = 1;
    } else {
      doThrow(1);
      phase = isShowing() ? REVEAL : EMPTYHOLD;
      phaseT = 0; globalFade = 0;
    }

    function advance(dt) {
      if (reducedStatic) return;   // held on the settled frame
      phaseT += dt;
      switch (phase) {
        case REVEAL:
          globalFade = smooth(phaseT / REVEAL_DUR);
          if (phaseT >= REVEAL_DUR) { phase = HOLD; phaseT = 0; globalFade = 1; }
          break;
        case HOLD:
          globalFade = 1;
          if (phaseT >= holdTime) { phase = FADE; phaseT = 0; }
          break;
        case FADE:
          globalFade = 1 - smooth(phaseT / FADE_DUR);
          if (phaseT >= FADE_DUR) startNextThrow();
          break;
        case EMPTYHOLD:
          globalFade = 0;
          if (phaseT >= EMPTY_DUR) startNextThrow();
          break;
      }
    }

    // ---- frame -------------------------------------------------------------
    function frame({ t, dt }) {
      advance(Math.min(dt || 0, 0.05));

      if (shapesDirty) {
        device.queue.writeBuffer(sbuf, 0, sArr, 0, thrownCount * STRIDE);
        shapesDirty = false;
      }

      const cw = context.canvas.width, ch = context.canvas.height;
      uArr[0] = cw; uArr[1] = ch; uArr[2] = t; uArr[3] = thrownCount;
      uArr[4] = overlap; uArr[5] = globalFade; uArr[6] = 0; uArr[7] = 0;
      uArr[8] = inkRGB[0]; uArr[9] = inkRGB[1]; uArr[10] = inkRGB[2]; uArr[11] = 0;
      device.queue.writeBuffer(ubuf, 0, uArr);

      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      device.queue.submit([enc.finish()]);
    }

    // ---- colour helpers ----------------------------------------------------
    function hexToRGB(hex) {
      let h = String(hex).replace("#", "").trim();
      if (h.length === 3) h = h.split("").map((c) => c + c).join("");
      const n = parseInt(h, 16);
      if (!isFinite(n)) return inkRGB;
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }
    function rgbToHex(c) {
      const f = (x) => Math.max(0, Math.min(255, Math.round(x * 255))).toString(16).padStart(2, "0");
      return "#" + f(c[0]) + f(c[1]) + f(c[2]);
    }

    // A live `x` change re-draws instantly (the shader reads x from the uniform
    // each frame); we only nudge the phase so blank↔shown transitions animate.
    function applyOverlapChange() {
      if (reducedStatic) return;
      if (isShowing() && phase === EMPTYHOLD) { phase = REVEAL; phaseT = 0; globalFade = 0; }
      else if (!isShowing() && (phase === HOLD || phase === REVEAL || phase === FADE)) {
        phase = EMPTYHOLD; phaseT = 0; globalFade = 0;
      }
    }

    // ---- instance ----------------------------------------------------------
    return {
      frame,

      resize() {
        // No size-dependent GPU resources: all geometry is resolution-relative
        // and computed in-shader from the framebuffer size each frame.
      },

      destroy() {
        ubuf.destroy();
        sbuf.destroy();
      },

      // Control surface (standalone UI only; gallery mode ignores these and the
      // defaults above must look good unattended).
      setShapeCount(n) {
        const v = Math.max(5, Math.min(MAXS, Math.round(n)));
        if (v === shapeCount) return;
        shapeCount = v;
        // Bake in at the next throw; if we're idling, throw now.
        if (phase === HOLD || phase === EMPTYHOLD) startNextThrow();
      },
      getShapeCount() { return shapeCount; },

      // `x` — the overlap depth whose region boundary is drawn (1 = outer
      // union, 2 = pairwise+ overlaps, 3 = triple+ cores, …). Live.
      setMinOverlap(x) {
        const v = Math.max(1, Math.min(10, Math.round(x)));
        if (v === overlap) return;
        overlap = v;
        applyOverlapChange();
      },
      getMinOverlap() { return overlap; },

      setSizeRange({ min, max }) {
        if (min != null) sizeMin = Math.max(0.02, Math.min(max ?? sizeMax, min));
        if (max != null) sizeMax = Math.min(0.4, Math.max(min ?? sizeMin, max));
      },
      getSizeRange() { return { min: sizeMin, max: sizeMax }; },

      setRotationRange({ min, max }) {
        if (min != null) rotMin = Math.max(0, Math.min(max ?? rotMax, min));
        if (max != null) rotMax = Math.min(360, Math.max(min ?? rotMin, max));
      },
      getRotationRange() { return { min: rotMin, max: rotMax }; },

      setStrokeRange({ min, max }) {
        if (min != null) strokeMin = Math.max(1, Math.min(max ?? strokeMax, min));
        if (max != null) strokeMax = Math.min(12, Math.max(min ?? strokeMin, max));
      },
      getStrokeRange() { return { min: strokeMin, max: strokeMax }; },

      // Shape-type pool. Toggling bakes in at the next throw (like the ranges);
      // the last enabled type can't be turned off. Index → KIND / KIND_NAMES.
      setTypeEnabled(index, on) {
        const i = index | 0;
        if (i < 0 || i >= KIND_COUNT) return;
        if (!on) {
          let live = 0;
          for (let k = 0; k < KIND_COUNT; k++) live += enabled[k];
          if (live <= 1 && enabled[i]) return;   // keep at least one type
        }
        enabled[i] = on ? 1 : 0;
      },
      getEnabledTypes() { return Array.from(enabled, (v) => !!v); },
      getTypeNames() { return KIND_NAMES.slice(); },

      setColor(hex) { inkRGB = hexToRGB(hex); },
      getColor() { return rgbToHex(inkRGB); },

      setHoldTime(s) { holdTime = Math.max(2, Math.min(15, s)); },
      getHoldTime() { return holdTime; },

      rethrow(newSeed) {
        pendingSeed = newSeed;
        startNextThrow();
      },
      getSeed() { return seed; },

      // Stats for an optional standalone read-out. maxDepth is the deepest
      // overlap the grid sample found in the current throw (so x above it shows
      // nothing).
      getStats() {
        return { thrown: thrownCount, maxDepth, x: overlap };
      },
    };
  },
};
