// @ts-check
// 004-ring-sync — concentric ring machine that settles into sync.
//
// A flat, top-down machine of concentric rings. Every ring starts at REST.
// The centre is a constant-pressure source; pressure pushes liquid outward
// through gates (no centrifugal force). The gates are ANGLED (canted, never
// radial) so liquid crossing any gate always exerts a tangential force —
// spinning the rings. Spin therefore comes only from the moving liquid; it
// emerges from zero, propagates outward, and the whole assembly settles into a
// common rotation (sync). The outermost ring vents to the void so liquid keeps
// flowing. The `spin` control sets that common rate's direction and vigour.
//
// The GPU only draws (see shader.wgsl); this module runs the whole simulation
// on the CPU in fixed substeps and uploads per-ring state each frame. Module
// scope is environment-free (no top-level DOM/navigator) per spec.md §5.
//
// Units: the sim runs in NORMALISED radii (outer radius = 1) so mass, inertia
// and capacity are viewport-independent; only the per-frame uniform upload
// converts radii to device pixels. There are no size-dependent GPU resources,
// so resize() is a no-op (spec.md — this doodle's spec, "Geometry & sizing").

const MAXR = 24;                 // storage buffer is sized for the max ring count
const SUB = 1 / 240;             // fixed simulation substep (s)
const FADE_DUR = 0.6;            // reset dissolve duration (s)
const INJECT = 1.0;             // centre pump injection-rate scale (× flowRate · cap0)
const PSTALL = 24.0;            // pump stall pressure (soft) — injection tapers to 0 near here
const PMAX = 40.0;              // hard pressure safety clamp (prevents numeric overflow)

// --- Simulation constants (tunable; emergent behaviour needs on-hardware tuning) ---
const QMAX = 2.2;                // peak pressure-driven transfer rate at full overlap
const VJET = 1.0;                // drive rate scale: a gate urges its ring toward VJET·spin·cant
const KDRIVE = 30.0;             // how hard a canted gate torques its ring (× flow)
const KVISC = 25.0;              // viscous neighbour lock through the moving liquid (× flow)
const SHELL = 0.07;              // shell mass density (M_i = SHELL * rMid_i)
const CMIN = 0.35;               // min gate cant (never radial → always some tangential force)
const CMAX = 1.70;               // max gate cant (wide range → visibly varied gate angles)
const EPS = 0.03;                // sync: max spread of ω across rings (rad/s)
const SYNC_MIN_RATE = 0.12;      // sync: must actually be rotating (not resting) to count
const SYNC_HOLD = 5.0;           // continuous seconds within spread to count as synced
const BURST_DECAY = 4.0;         // burst-highlight decay (1/s)
const BURST_SCALE = 40.0;        // maps transfer rate q -> flow/highlight intensity

export default {
  meta: {
    title: "Ring Sync",
    description:
      "Concentric gated rings trade liquid through lined-up gates and slowly settle into sync.",
    tags: ["2d", "sdf", "simulation", "physics", "generative"],
    created: "2026-07-17",
    prefersReducedMotionSafe: false,
  },

  /** @param {any} ctx */
  async init(ctx) {
    const { device, context, format, loadWGSL } = ctx;

    // ---- pipeline ----------------------------------------------------------
    const module = device.createShaderModule({ code: await loadWGSL("./shader.wgsl") });

    const ubuf = device.createBuffer({
      size: 64, // Globals: 16 f32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const sbuf = device.createBuffer({
      size: MAXR * 32, // Ring: 8 f32 each
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

    const uArr = new Float32Array(16);
    const sArr = new Float32Array(MAXR * 8);

    // ---- controls (defaults chosen to look good unattended) ----------------
    let ringCount = 8;
    let spin = 0.6;          // drive: sign = spin direction, |spin| = terminal rate/vigour
    let flowRate = 0.4;      // centre pump throughput (how fast it feeds the system)
    let viscosity = 1.0;     // higher = liquid flows/equalises between rings more slowly
    let borderFrac = 0.3;    // wall thickness as a fraction of pitch
    let gateHalfArc = 0.03;  // gate half arc-length (normalised; outer radius = 1)
    let autoReset = true;
    let colorRGB = [0x00 / 255, 0x58 / 255, 0xab / 255];

    // ---- per-ring state ----------------------------------------------------
    const phi = new Float32Array(MAXR);
    const omega = new Float32Array(MAXR);
    const mass = new Float32Array(MAXR);
    const cap = new Float32Array(MAXR);
    const shell = new Float32Array(MAXR);
    const rMid = new Float32Array(MAXR);
    const alpha = new Float32Array(MAXR);
    const beta = new Float32Array(MAXR);
    const cantIn = new Float32Array(MAXR);   // inner-gate cant magnitude (0=radial forbidden)
    const cantOut = new Float32Array(MAXR);  // outer-gate cant magnitude
    const burst = new Float32Array(MAXR);
    let ventBurst = 0;

    // ---- seeded RNG (so a reset can be replayed via reset(seed)) ------------
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

    const TAU = Math.PI * 2;
    const wrap = (x) => x - TAU * Math.floor(x / TAU);
    const wrapDelta = (a, b) => { let d = a - b; return d - TAU * Math.round(d / TAU); };

    // ---- geometry (normalised radii, outer = 1) ----------------------------
    function deriveGeom() {
      const N = ringCount;
      const pitchN = 1 / N;
      const bwN = borderFrac * pitchN;
      for (let i = 0; i < N; i++) {
        rMid[i] = (i + 0.5) * pitchN;
        shell[i] = SHELL * rMid[i];
        if (i === 0) {
          const rInt = pitchN - bwN * 0.5;
          cap[i] = rInt * rInt;                 // centre disc area (drop the shared π)
        } else {
          const rin = i * pitchN + bwN * 0.5;
          const rout = (i + 1) * pitchN - bwN * 0.5;
          cap[i] = rout * rout - rin * rin;     // annular channel area
        }
      }
    }

    // ---- reset -------------------------------------------------------------
    let syncTimer = 0;
    let held = false;             // reached sync and holding (auto-reset off)
    let acc = 0;                  // substep accumulator
    let fadeTimer = 0;            // > 0 while dissolving before a reset
    let pendingReset = false;
    let pendingSeed;              // seed for the queued reset (undefined => fresh)
    let liquidFade = 1;

    function doReset(newSeed) {
      seed = newSeed !== undefined
        ? newSeed >>> 0
        : (Math.floor(rand() * 0xffffffff) >>> 0);
      rand = mulberry32(seed);
      deriveGeom();
      const N = ringCount;
      for (let i = 0; i < N; i++) {
        phi[i] = rand() * TAU;
        alpha[i] = rand() * TAU;
        beta[i] = rand() * TAU;
        // Every gate is canted (magnitude in [CMIN, CMAX]) — never radial, so a
        // gate always imparts tangential force — and each has its OWN random
        // orientation (independent lean direction), so no two gates are alike.
        cantIn[i] = (CMIN + rand() * (CMAX - CMIN)) * (rand() < 0.5 ? -1 : 1);
        cantOut[i] = (CMIN + rand() * (CMAX - CMIN)) * (rand() < 0.5 ? -1 : 1);
        mass[i] = 0;
        burst[i] = 0;
        omega[i] = 0;             // rings start at rest — spin comes only from liquid
      }
      ventBurst = 0;
      syncTimer = 0;
      held = false;
      acc = 0;
    }

    function requestReset(newSeed) {
      fadeTimer = FADE_DUR;
      pendingReset = true;
      pendingSeed = newSeed;
    }

    doReset(1);

    // A canted gate drives its ring toward `VJET·spin·cant`. The DIRECTION comes
    // from the gate's own signed orientation (cant), so each ring's spin
    // direction depends on its gates; strength scales with flow q and |cant|.
    function driveGate(i, cant, q) {
      const target = VJET * spin * cant;
      omega[i] += (target - omega[i]) * Math.min(0.5, KDRIVE * q * Math.abs(cant) * SUB);
    }

    // ---- one fixed simulation substep --------------------------------------
    function substep(dt) {
      const N = ringCount;

      // Centre: constant-flow pump AND driven rotor. It spins at `spin` so its
      // outlet gate sweeps — a from-rest, fully-gated system can't self-start
      // (no flow → no spin → gates never align), so the centre is the driver;
      // the outer rings' spin still emerges from their own gates. Pressure is
      // uncapped (soft stall) — it builds between alignments and bursts through
      // on one.
      omega[0] = spin;
      const P0now = mass[0] / cap[0];
      mass[0] += flowRate * cap[0] * INJECT * Math.max(0, 1 - P0now / PSTALL) * dt;

      // Centre → ring 1 ONLY while the centre outlet gate aligns with ring 1's
      // inlet gate; the amount scales with the overlap (the size of the opening
      // between the two gates).
      if (N > 1) {
        const rb = 1 / N;                          // centre/ring-1 boundary radius
        const w = gateHalfArc / rb;
        const d = Math.abs(wrapDelta(phi[0] + beta[0], phi[1] + alpha[1]));
        const overlap = Math.max(0, 1 - d / (2 * w));
        const dP = mass[0] / cap[0] - mass[1] / cap[1];
        if (overlap > 0 && dP > 0) {
          let dm = (QMAX / viscosity) * overlap * dP * dt * cap[0];
          dm = Math.min(dm, mass[0], dP * cap[0] * cap[1] / (cap[0] + cap[1]));
          if (dm > 0) {
            mass[0] -= dm;
            mass[1] += dm;
            const q = dm / dt;
            driveGate(1, cantIn[1], q);            // ring 1 spun by its own inlet gate
            const b = Math.min(1, q * BURST_SCALE);
            if (b > burst[0]) burst[0] = b;
          }
        }
      }

      // Inter-ring transfers (gated by gate alignment). Pressure-driven and
      // uncapped (a ring can build pressure above nominal-full). Canted gates
      // drive each ring per its own orientation; the liquid viscously locks
      // neighbours toward a shared rate.
      for (let i = 1; i < N - 1; i++) {
        const j = i + 1;
        const Pi = mass[i] / cap[i];
        const Pj = mass[j] / cap[j];
        const dP = Pi - Pj;
        if (dP <= 1e-5) continue;                  // pressure-driven, outward only
        const rb = (i + 1) / N;
        const w = gateHalfArc / rb;
        const d = Math.abs(wrapDelta(phi[i] + beta[i], phi[j] + alpha[j]));
        const overlap = Math.max(0, 1 - d / (2 * w));
        if (overlap <= 0) continue;

        // Viscosity slows the pressure-equalising flow; overshoot-capped.
        let dm = (QMAX / viscosity) * overlap * dP * dt * cap[i];
        dm = Math.min(dm, mass[i], dP * cap[i] * cap[j] / (cap[i] + cap[j]));
        if (dm <= 0) continue;
        mass[i] -= dm;
        mass[j] += dm;
        const q = dm / dt;

        driveGate(i, cantOut[i], q);   // giver's outer gate
        driveGate(j, cantIn[j], q);    // receiver's inner gate

        const Ii = (shell[i] + mass[i]) * rMid[i] * rMid[i];
        const Ij = (shell[j] + mass[j]) * rMid[j] * rMid[j];
        const visc = Math.min(0.5, KVISC * q * dt);
        const wm = (Ii * omega[i] + Ij * omega[j]) / (Ii + Ij);
        omega[i] += (wm - omega[i]) * visc;
        omega[j] += (wm - omega[j]) * visc;

        const b = Math.min(1, q * BURST_SCALE);
        if (b > burst[i]) burst[i] = b;
      }

      // Outermost ring vents to the void (continuous, pressure-driven).
      {
        const i = N - 1;
        const Pi = mass[i] / cap[i];
        if (Pi > 1e-5) {
          let dm = Math.min((QMAX / viscosity) * Pi * dt * cap[i], mass[i]);
          mass[i] -= dm;
          const q = dm / dt;
          driveGate(i, cantOut[i], q);
          const bv = Math.min(1, q * BURST_SCALE);
          if (bv > ventBurst) ventBurst = bv;
          if (bv > burst[i]) burst[i] = bv;
        }
      }

      // Pressure safety clamp (keeps the sim finite in degenerate configs).
      for (let i = 0; i < N; i++) if (mass[i] > cap[i] * PMAX) mass[i] = cap[i] * PMAX;

      // Advance rotations — every ring spins per its own gates, from rest.
      for (let i = 0; i < N; i++) phi[i] = wrap(phi[i] + omega[i] * dt);

      // Sync: rings share a common rate (small spread) and are actually
      // rotating. With gate-orientation-dependent spin this may not occur —
      // rings can settle to different rates/directions — which is expected.
      let mn = Infinity, mx = -Infinity, sum = 0;
      for (let i = 0; i < N; i++) { const wi = omega[i]; if (wi < mn) mn = wi; if (wi > mx) mx = wi; sum += wi; }
      const settled = mx - mn < EPS && Math.abs(sum / N) > SYNC_MIN_RATE;
      if (settled) syncTimer += dt; else syncTimer = 0;
      if (syncTimer >= SYNC_HOLD && !held) {
        if (autoReset) requestReset();
        else held = true;
      }
    }

    // ---- frame -------------------------------------------------------------
    function frame({ t, dt }) {
      const d = Math.min(dt || 0, 0.05);

      if (fadeTimer > 0) {
        // Dissolve the current liquid, then re-randomise and refill.
        fadeTimer -= d;
        liquidFade = Math.max(0, fadeTimer / FADE_DUR);
        if (fadeTimer <= 0 && pendingReset) {
          pendingReset = false;
          doReset(pendingSeed);
          pendingSeed = undefined;
          liquidFade = 1;
        }
      } else {
        liquidFade = 1;
        acc += d;
        let steps = 0;
        while (acc >= SUB && steps < 8) { substep(SUB); acc -= SUB; steps++; }
        if (acc > SUB) acc = 0; // don't spiral after a long stall
      }

      // Decay transfer highlights.
      const dec = Math.exp(-BURST_DECAY * d);
      for (let i = 0; i < ringCount; i++) burst[i] *= dec;
      ventBurst *= dec;

      // ---- uniforms (radii -> pixels) ----
      const cw = context.canvas.width;
      const ch = context.canvas.height;
      const rOuterPx = 0.475 * Math.min(cw, ch);
      const pitchPx = rOuterPx / ringCount;
      uArr[0] = cw; uArr[1] = ch; uArr[2] = t; uArr[3] = ringCount;
      uArr[4] = rOuterPx; uArr[5] = pitchPx; uArr[6] = borderFrac * pitchPx;
      uArr[7] = gateHalfArc * rOuterPx;
      uArr[8] = colorRGB[0]; uArr[9] = colorRGB[1]; uArr[10] = colorRGB[2];
      // Highest pressure across the (dynamic) outer rings — drives a global
      // liquid-alpha so the whole liquid breathes with the system's load.
      let sysP = 0;
      for (let i = 1; i < ringCount; i++) { const f = mass[i] / cap[i]; if (f > sysP) sysP = f; }
      uArr[11] = sysP;
      uArr[12] = liquidFade; uArr[13] = ventBurst;
      uArr[14] = wrap(phi[ringCount - 1] + beta[ringCount - 1]);
      uArr[15] = 1;   // reserved (per-gate cant now carries its own sign)
      device.queue.writeBuffer(ubuf, 0, uArr);

      // ---- per-ring storage ----
      for (let i = 0; i < ringCount; i++) {
        const o = i * 8;
        sArr[o] = phi[i];
        sArr[o + 1] = omega[i];
        sArr[o + 2] = alpha[i];
        sArr[o + 3] = beta[i];
        sArr[o + 4] = mass[i] / cap[i];
        sArr[o + 5] = burst[i];
        sArr[o + 6] = cantIn[i];
        sArr[o + 7] = cantOut[i];
      }
      device.queue.writeBuffer(sbuf, 0, sArr, 0, ringCount * 8);

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
      if (!isFinite(n)) return colorRGB;
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }
    function rgbToHex(c) {
      const f = (x) => Math.max(0, Math.min(255, Math.round(x * 255))).toString(16).padStart(2, "0");
      return "#" + f(c[0]) + f(c[1]) + f(c[2]);
    }

    // ---- instance ----------------------------------------------------------
    return {
      frame,

      resize() {
        // No size-dependent GPU resources: geometry is computed in-shader from
        // the resolution each frame. Nothing to recreate.
      },

      destroy() {
        ubuf.destroy();
        sbuf.destroy();
      },

      // Control surface (standalone UI only; gallery mode ignores these).
      setRingCount(n) {
        const v = Math.max(3, Math.min(MAXR, Math.round(n)));
        if (v === ringCount) return;
        ringCount = v;
        requestReset();
      },
      getRingCount() { return ringCount; },

      setSpin(w) { spin = w; },   // drive direction + vigour; live, no reset
      getSpin() { return spin; },

      setFlowRate(r) { flowRate = Math.max(0.02, Math.min(1.5, r)); },
      getFlowRate() { return flowRate; },

      setViscosity(v) { viscosity = Math.max(0.3, Math.min(4, v)); },
      getViscosity() { return viscosity; },

      setColor(hex) { colorRGB = hexToRGB(hex); },
      getColor() { return rgbToHex(colorRGB); },

      setBorderWidth(f) {
        const nf = Math.max(0.15, Math.min(0.5, f));
        const oldCap = cap.slice();             // preserve fills proportionally
        borderFrac = nf;
        deriveGeom();
        for (let i = 0; i < ringCount; i++) {
          const fill = oldCap[i] ? mass[i] / oldCap[i] : 0;
          mass[i] = fill * cap[i];
        }
      },
      getBorderWidth() { return borderFrac; },

      setGateWidth(w) { gateHalfArc = Math.max(0.03, Math.min(0.2, w)); },
      getGateWidth() { return gateHalfArc; },

      setAutoReset(b) { autoReset = !!b; if (autoReset) held = false; },
      getAutoReset() { return autoReset; },

      reset(newSeed) { requestReset(newSeed); },
      getSeed() { return seed; },

      // Current per-ring pressure (fill 0..1), index 0 = centre. For the UI.
      getPressures() {
        const out = new Array(ringCount);
        for (let i = 0; i < ringCount; i++) out[i] = mass[i] / cap[i];
        return out;
      },
    };
  },
};
