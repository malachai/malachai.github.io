// @ts-check
// 005-cluster-cull — a generative composition machine.
//
// Each cycle throws a scatter of outlined shapes, groups them into clusters by
// filled-area overlap (union-find), culls clusters smaller than `x`, and
// redraws each survivor cluster as the outline of the boolean union of its
// shapes — interior segments dissolve, leaving one clean composite silhouette
// per cluster. Then it holds, then re-throws. See ./spec.md.
//
// The GPU only draws (see shader.wgsl). This module runs the throw, the cull
// and the whole animation clock on the CPU, and uploads a per-shape record
// each frame. Module scope is environment-free (no top-level DOM/navigator)
// per ../../spec.md §5.
//
// COORDINATE SPACE mirrors the shader's: "n-units" are normalised, centred and
// scaled by the viewport min dimension. Sizes are fractions of that min
// dimension; positions are centred n-units; stroke widths are pixels.

const MAXS = 64;                 // storage buffer sized for the max shape count
const STRIDE = 12;               // f32 per shape record (48 B, 16-aligned)

// Cycle durations (seconds).
const THROW_DUR = 1.0;
const BEAT_DUR  = 0.5;
const CULL_DUR  = 0.8;
const FADE_DUR  = 0.6;
const EMPTY_DUR = 1.0;
const POP_DUR   = 0.36;          // per-shape pop-in duration
const POP_STAG  = 0.55;          // pop-in stagger spread (≤ THROW_DUR - POP_DUR)

// Phases.
const THROW = 0, BEAT = 1, CULL = 2, HOLD = 3, FADE = 4, EMPTYHOLD = 5;

// ---- canonical shapes -------------------------------------------------------
// kind index → { verts | ellipse }. Bounding radius of every canonical shape
// is 1, so a record's `size` is its bounding radius in n-units. These vertex
// tables are byte-for-byte identical to shapeSDF() in shader.wgsl — the two
// SDF copies must agree or the cull will contradict the pixels (spec §
// "Implementation notes"). Any edit here edits there.
const KIND = {
  circle: 0, square: 1, triangle: 2, oval: 3, star: 4, trapezoid: 5, parallelogram: 6,
};
const KIND_COUNT = 7;

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
      "A scatter of outlined shapes clusters by overlap; small clusters are culled and survivors fuse into one composite silhouette.",
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
      size: MAXS * STRIDE * 4, // Shape: 12 f32 each
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

    // ---- controls (defaults chosen to look good unattended) ----------------
    let shapeCount = 24;
    let minCluster = 3;          // `x` — clusters with ≥ x members survive
    let sizeMin = 0.06, sizeMax = 0.16;   // bounding radius (fraction of min-dim)
    let rotMin = 0, rotMax = 360;         // degrees
    let strokeMin = 2, strokeMax = 5;     // px
    let holdTime = 5.0;                   // seconds
    let inkRGB = [0xe9 / 255, 0xe9 / 255, 0xee / 255];

    // ---- per-shape data (indexed 0..shapeCount-1) --------------------------
    const kind = new Int32Array(MAXS);
    const cx = new Float32Array(MAXS);
    const cy = new Float32Array(MAXS);
    const size = new Float32Array(MAXS);
    const rot = new Float32Array(MAXS);        // radians
    const cosR = new Float32Array(MAXS);
    const sinR = new Float32Array(MAXS);
    const strokeHalf = new Float32Array(MAXS); // px
    const popDelay = new Float32Array(MAXS);   // pop-in stagger (s)
    const surv = new Uint8Array(MAXS);         // 1 = survivor

    // Union-find state for the current throw (recomputed on re-throw; `x`
    // changes only re-filter `compSize`/`surv`).
    const parent = new Int32Array(MAXS);
    const compSize = new Int32Array(MAXS);     // size of the component a shape roots into (per-root)
    let survivorCount = 0;
    let clusterCount = 0;                       // surviving clusters

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

    // ---- SDF eval on a live shape (n-units), mirrors shader.shapeDist ------
    function shapeDistAt(i, px, py) {
      const sz = size[i]; // full size for connectivity (no animation scale)
      const rx = px - cx[i], ry = py - cy[i];
      const lx =  cosR[i] * rx + sinR[i] * ry;
      const ly = -sinR[i] * rx + cosR[i] * ry;
      return sz * shapeSDF(kind[i], lx / Math.max(sz, 1e-5), ly / Math.max(sz, 1e-5));
    }

    // ---- union-find --------------------------------------------------------
    function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
    function unite(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }

    // Do shapes i and j have overlapping filled areas? Bounding-circle reject,
    // centre-inside quick-accept, else grid-sample the AABB overlap box for a
    // jointly-inside point (spacing ∝ the smaller shape, floored). All n-units.
    const INSIDE_TOL = 0.004;     // ~0.5px slack keeps visually-touching pairs joined
    function overlaps(i, j) {
      const dx = cx[i] - cx[j], dy = cy[i] - cy[j];
      const rsum = size[i] + size[j] + INSIDE_TOL;
      if (dx * dx + dy * dy > rsum * rsum) return false;       // bounding-circle reject

      // quick-accept: either centre inside the other shape
      if (shapeDistAt(i, cx[j], cy[j]) <= INSIDE_TOL) return true;
      if (shapeDistAt(j, cx[i], cy[i]) <= INSIDE_TOL) return true;

      // AABB overlap box (bounding-circle boxes)
      const x0 = Math.max(cx[i] - size[i], cx[j] - size[j]);
      const x1 = Math.min(cx[i] + size[i], cx[j] + size[j]);
      const y0 = Math.max(cy[i] - size[i], cy[j] - size[j]);
      const y1 = Math.min(cy[i] + size[i], cy[j] + size[j]);
      if (x1 <= x0 || y1 <= y0) return false;

      const smaller = Math.min(size[i], size[j]);
      const h = Math.max(0.006, smaller * 0.25);               // grid spacing, floored
      for (let y = y0; y <= y1 + 1e-9; y += h) {
        for (let x = x0; x <= x1 + 1e-9; x += h) {
          if (shapeDistAt(i, x, y) <= INSIDE_TOL && shapeDistAt(j, x, y) <= INSIDE_TOL) return true;
        }
      }
      return false;
    }

    // Recompute components for the current shapes (once per throw).
    function cluster() {
      const N = shapeCount;
      for (let i = 0; i < N; i++) parent[i] = i;
      for (let i = 0; i < N; i++)
        for (let j = i + 1; j < N; j++)
          if (overlaps(i, j)) unite(i, j);

      // component sizes (per root), then broadcast to every member
      const rootSize = new Int32Array(N);
      for (let i = 0; i < N; i++) rootSize[find(i)]++;
      for (let i = 0; i < N; i++) compSize[i] = rootSize[find(i)];
      applyCull();
    }

    // Re-filter survivors from already-computed components (live `x` change).
    function applyCull() {
      const N = shapeCount;
      const x = Math.max(1, Math.min(minCluster, N));
      survivorCount = 0;
      const seenRoot = new Set();
      clusterCount = 0;
      for (let i = 0; i < N; i++) {
        const s = compSize[i] >= x ? 1 : 0;
        surv[i] = s;
        if (s) {
          survivorCount++;
          const r = find(i);
          if (!seenRoot.has(r)) { seenRoot.add(r); clusterCount++; }
        }
      }
    }

    // ---- the throw ---------------------------------------------------------
    // Viewport half-extents in n-units, from the canvas aspect at throw time.
    function halfExtents() {
      const w = context.canvas.width || 1, h = context.canvas.height || 1;
      const m = Math.min(w, h);
      return { hw: w / (2 * m), hh: h / (2 * m), minDim: m };
    }

    function doThrow(newSeed) {
      seed = newSeed !== undefined ? (newSeed >>> 0) : (Math.floor(rand() * 0xffffffff) >>> 0);
      rand = mulberry32(seed);

      const { hw, hh, minDim } = halfExtents();
      const kinds = KIND_COUNT;
      for (let i = 0; i < shapeCount; i++) {
        kind[i] = Math.min(kinds - 1, (rand() * kinds) | 0);
        size[i] = uniform(sizeMin, sizeMax);
        const deg = uniform(rotMin, rotMax);
        rot[i] = (deg * Math.PI) / 180;
        cosR[i] = Math.cos(rot[i]);
        sinR[i] = Math.sin(rot[i]);
        strokeHalf[i] = uniform(strokeMin, strokeMax) * 0.5;
        popDelay[i] = rand() * POP_STAG;

        // position: uniform inside the viewport, inset so the shape (fill +
        // half stroke) lands fully on-canvas.
        const inset = size[i] + (strokeHalf[i] / minDim);
        const rx = Math.max(0, hw - inset), ry = Math.max(0, hh - inset);
        cx[i] = uniform(-rx, rx);
        cy[i] = uniform(-ry, ry);
      }
      cluster();
    }

    // ---- animation cycle ---------------------------------------------------
    let phase = THROW;
    let phaseT = 0;
    let fuse = 0;         // 0 scatter → 1 fused survivors
    let globalFade = 1;   // whole-composition opacity (throw uses per-shape pop)

    const easeIn = (x) => x * x;
    const easeOut = (x) => 1 - (1 - x) * (1 - x);
    const smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

    function toPhase(p) { phase = p; phaseT = 0; }

    // Reduced motion: skip straight to a completed, fused composition and hold.
    const reducedStatic =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    function seedFirstThrow() {
      if (reducedStatic) {
        // Prefer a throw that actually leaves something standing.
        for (let tries = 0; tries < 24; tries++) {
          doThrow(tries === 0 ? 1 : undefined);
          if (survivorCount > 0) break;
        }
        phase = HOLD; phaseT = 0; fuse = 1; globalFade = 1;
      } else {
        doThrow(1);
        toPhase(THROW);
      }
    }
    seedFirstThrow();

    let pendingThrowSeed;          // set when a control queues a fresh throw
    let pendingRethrow = false;

    function advance(dt) {
      if (reducedStatic) return;   // held on the settled frame
      phaseT += dt;
      switch (phase) {
        case THROW:
          fuse = 0; globalFade = 1;
          if (phaseT >= THROW_DUR) toPhase(BEAT);
          break;
        case BEAT:
          fuse = 0; globalFade = 1;
          if (phaseT >= BEAT_DUR) toPhase(CULL);
          break;
        case CULL:
          fuse = smooth(phaseT / CULL_DUR);
          globalFade = 1;
          if (phaseT >= CULL_DUR) toPhase(survivorCount > 0 ? HOLD : EMPTYHOLD);
          break;
        case HOLD:
          fuse = 1; globalFade = 1;
          if (phaseT >= holdTime) toPhase(FADE);
          break;
        case FADE:
          fuse = 1;
          globalFade = 1 - Math.min(1, phaseT / FADE_DUR);
          if (phaseT >= FADE_DUR) { startNextThrow(); }
          break;
        case EMPTYHOLD:
          fuse = 1; globalFade = 1;   // nothing survives; everything already grey/gone
          if (phaseT >= EMPTY_DUR) { startNextThrow(); }
          break;
      }
    }

    function startNextThrow() {
      doThrow(pendingThrowSeed);
      pendingThrowSeed = undefined;
      pendingRethrow = false;
      toPhase(THROW);
      globalFade = 1;
    }

    // Compute per-shape animation state (scale/alpha/tint) for the current phase.
    function animateShapes() {
      const N = shapeCount;
      for (let i = 0; i < N; i++) {
        let scale = 1, alpha = 1, tint = 0;
        if (phase === THROW) {
          const p = Math.max(0, Math.min(1, (phaseT - popDelay[i]) / POP_DUR));
          scale = easeOut(p);
          alpha = p;
        } else if (phase === CULL) {
          if (!surv[i]) {
            const cp = Math.min(1, phaseT / CULL_DUR);
            scale = 1 - easeIn(cp);   // shrink out
            alpha = 1 - cp;           // fade out
            tint = cp;                // ink → grey
          }
        } else if (phase === HOLD || phase === FADE) {
          if (!surv[i]) { scale = 0; alpha = 0; tint = 1; }
        } else if (phase === EMPTYHOLD) {
          scale = 0; alpha = 0; tint = 1;
        }
        // BEAT and survivors default to scale=1, alpha=1, tint=0.
        const o = i * STRIDE;
        sArr[o + 0] = kind[i];
        sArr[o + 1] = cx[i];
        sArr[o + 2] = cy[i];
        sArr[o + 3] = size[i];
        sArr[o + 4] = cosR[i];
        sArr[o + 5] = sinR[i];
        sArr[o + 6] = strokeHalf[i];
        sArr[o + 7] = scale;
        sArr[o + 8] = alpha;
        sArr[o + 9] = tint;
        sArr[o + 10] = surv[i] ? 1 : 0;
        sArr[o + 11] = 0;
      }
    }

    // ---- frame -------------------------------------------------------------
    function frame({ t, dt }) {
      advance(Math.min(dt || 0, 0.05));
      animateShapes();

      device.queue.writeBuffer(sbuf, 0, sArr, 0, shapeCount * STRIDE);

      const cw = context.canvas.width, ch = context.canvas.height;
      uArr[0] = cw; uArr[1] = ch; uArr[2] = t; uArr[3] = shapeCount;
      uArr[4] = fuse; uArr[5] = globalFade; uArr[6] = 0.5; uArr[7] = 0;
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

    // A live `x` change re-filters the current throw and replays the fuse so
    // promoted/demoted shapes animate rather than pop.
    function liveRecull() {
      if (reducedStatic) { applyCull(); return; }
      applyCull();
      // Re-run the crossfade from a scatter state so changes are visible.
      if (phase === HOLD || phase === FADE || phase === EMPTYHOLD || phase === CULL) {
        toPhase(CULL);
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
        pendingThrowSeed = undefined;
        // Bake in at the next throw; if we're idling, throw now.
        if (phase === HOLD || phase === EMPTYHOLD) startNextThrow();
      },
      getShapeCount() { return shapeCount; },

      setMinCluster(x) {
        const v = Math.max(1, Math.min(10, Math.round(x)));
        if (v === minCluster) return;
        minCluster = v;
        liveRecull();
      },
      getMinCluster() { return minCluster; },

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

      setColor(hex) { inkRGB = hexToRGB(hex); },
      getColor() { return rgbToHex(inkRGB); },

      setHoldTime(s) { holdTime = Math.max(2, Math.min(15, s)); },
      getHoldTime() { return holdTime; },

      rethrow(newSeed) {
        pendingThrowSeed = newSeed;
        pendingRethrow = true;
        startNextThrow();
      },
      getSeed() { return seed; },

      // Stats for an optional standalone read-out.
      getStats() {
        return { thrown: shapeCount, survivors: survivorCount, clusters: clusterCount };
      },
    };
  },
};
