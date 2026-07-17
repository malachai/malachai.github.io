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
// flowing. Each ring's spin direction and rate come entirely from its gate
// orientation and the driving pressure — there is no separate drive control.
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
const GATE_REF = 0.03;          // reference gate width — the drive scales with gw/GATE_REF

// --- Simulation constants (tunable; emergent behaviour needs on-hardware tuning) ---
const QMAX = 2.2;                // peak pressure-driven transfer rate at full overlap
const VJET = 1.0;                // drive gain: gate targets VJET·cant·jetP·(gw/GATE_REF)
const KDRIVE = 30.0;             // how hard a canted gate torques its ring (× flow)
const KVISC = 25.0;              // viscous neighbour lock through the moving liquid (× flow)
const SHELL = 0.07;              // shell mass density (M_i = SHELL * rMid_i)
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
    let flowRate = 0.4;      // centre pump throughput (how fast it feeds the system)
    let viscosity = 1.0;     // higher = liquid flows/equalises between rings more slowly
    let borderFrac = 0.3;    // wall thickness as a fraction of pitch
    let numShearLines = 3;   // number of spiral shear lines = gates per ring
    let gateMinFrac = 0.02;  // gate width range (fraction of circumference); each ring random in [min,max]
    let gateMaxFrac = 0.05;
    let orientMin = 100;     // gate orientation range (degrees, 1..179; 90 = radial → no shear)
    let orientMax = 150;
    let autoReset = true;
    let colorRGB = [0x00 / 255, 0x58 / 255, 0xab / 255];

    // ---- per-ring state ----------------------------------------------------
    const phi = new Float32Array(MAXR);
    const omega = new Float32Array(MAXR);
    const mass = new Float32Array(MAXR);
    const cap = new Float32Array(MAXR);
    const shell = new Float32Array(MAXR);
    const rMid = new Float32Array(MAXR);
    const g0 = new Float32Array(MAXR);       // ring's gate base angle (spiral offset, at ring mid)
    const shear = new Float32Array(MAXR);    // within-ring shear (angle across the ring) = the cant
    const gw = new Float32Array(MAXR);       // per-ring gate half-width fraction (of circumference)
    const rw = new Float32Array(MAXR);       // stored 0..1 random for gate width (stable across live edits)
    const ro = new Float32Array(MAXR);       // stored 0..1 random for gate orientation
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

    // Each ring has `numShearLines` evenly-spaced gates. A ring's gate is a
    // sheared slot: its centre shears with radius about the ring mid, so the
    // outlet (outer border) and inlet (inner border) sit at these sheared angles
    // (the M gates are these ± k·2π/M). The spiral base `g0` accumulates the
    // shear outward so the lines connect ring-to-ring into continuous spirals.
    const outAng = (i) => phi[i] + g0[i] + 0.5 * shear[i];   // outer border (outlet)
    const inAng = (i) => phi[i] + g0[i] - 0.5 * shear[i];    // inner border (inlet)

    // Build the gates: each ring gets a gate WIDTH (random in [gateMinFrac,
    // gateMaxFrac]) and an ORIENTATION in degrees (random in [orientMin,
    // orientMax]; 90° = radial → zero shear, away from 90° cants the slot). The
    // orientation becomes the ring's shear (cant); the accumulated base offset g0
    // connects each ring's outlet to the next ring's inlet into continuous
    // spirals. Uses stored rw/ro so live edits don't consume the RNG.
    function deriveGates() {
      const N = ringCount;
      const wSpan = gateMaxFrac - gateMinFrac;
      const oSpan = orientMax - orientMin;
      for (let i = 0; i < N; i++) {
        gw[i] = gateMinFrac + rw[i] * wSpan;
        const orient = orientMin + ro[i] * oSpan;      // degrees, 1..179
        shear[i] = (orient - 90) * Math.PI / 180;      // 90° = radial (no shear)
      }
      g0[0] = 0;
      for (let i = 1; i < N; i++) g0[i] = g0[i - 1] + 0.5 * shear[i - 1] + 0.5 * shear[i];
    }

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
        phi[i] = 0;               // start aligned so the spiral is clean at reset
        rw[i] = rand();           // per-ring gate width sample (in [min,max])
        ro[i] = rand();           // per-ring gate orientation sample (in [min,max])
        mass[i] = 0;
        burst[i] = 0;
        omega[i] = 0;             // outer rings start at rest — spin from liquid
      }
      deriveGates();
      // omega[0] stays 0 — the centre spins up purely from the flow through its gates.
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

    // A canted gate drives its ring in the direction it visibly leans (sign
    // negated so the induced spin matches the gate's on-screen orientation, so
    // the gate ORIENTATION alone sets each ring's spin direction). The TERMINAL
    // rate is an honest function of the driving (jet) PRESSURE and the GATE
    // WIDTH — `target = VJET·cant·jetP·(gw/GATE_REF)` — with NO cap, so a ring
    // that keeps gaining pressure (or a wider gate) keeps speeding up. The
    // approach rate scales with the actual mass flow q and |cant|, so a wider,
    // higher-pressure gate also spins its ring up faster.
    function driveGate(i, cant, q, jetP, width) {
      const target = -VJET * cant * jetP * (width / GATE_REF);
      omega[i] += (target - omega[i]) * Math.min(0.5, KDRIVE * q * Math.abs(cant) * SUB);
    }

    // ---- one fixed simulation substep --------------------------------------
    function substep(dt) {
      const N = ringCount;

      // Centre (inner ring): the constant-flow pump. It is NOT driven at a fixed
      // speed — its rotation emerges purely from the liquid flowing out through
      // its own gate (driven below, exactly like every other ring). The pump
      // injects a fixed volume per second regardless of back-pressure (no
      // stall); pressure finds its own equilibrium through the gated outflow and
      // the outer vent, with no artificial ceiling.
      mass[0] += flowRate * cap[0] * INJECT * dt;

      // Centre → ring 1 ONLY while the centre outlet gate aligns with ring 1's
      // inlet gate; the amount scales with the overlap (the size of the opening
      // between the two gates).
      const spacing = TAU / numShearLines;         // angular spacing of the M gates
      if (N > 1) {
        // With M evenly-spaced gates, alignment repeats every `spacing`; fold the
        // phase gap into the nearest gate.
        let d = wrapDelta(outAng(0), inAng(1));
        d = Math.abs(d - spacing * Math.round(d / spacing));
        const wsum = (gw[0] + gw[1]) * Math.PI;     // sum of the two gate half-widths
        const overlap = Math.max(0, 1 - d / wsum);
        const P0 = mass[0] / cap[0];
        const dP = P0 - mass[1] / cap[1];
        if (overlap > 0 && dP > 0) {
          let dm = (QMAX / viscosity) * overlap * dP * dt * cap[0];
          dm = Math.min(dm, mass[0], dP * cap[0] * cap[1] / (cap[0] + cap[1]));
          if (dm > 0) {
            mass[0] -= dm;
            mass[1] += dm;
            const q = dm / dt;
            driveGate(0, shear[0], q, P0, gw[0]);  // centre spun by its own outflow gate
            driveGate(1, shear[1], q, P0, gw[1]);  // ring 1 spun by its inlet gate
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
        let d = wrapDelta(outAng(i), inAng(j));
        d = Math.abs(d - spacing * Math.round(d / spacing));
        const wsum = (gw[i] + gw[j]) * Math.PI;     // sum of the two gate half-widths
        const overlap = Math.max(0, 1 - d / wsum);
        if (overlap <= 0) continue;

        // Viscosity slows the pressure-equalising flow; overshoot-capped.
        let dm = (QMAX / viscosity) * overlap * dP * dt * cap[i];
        dm = Math.min(dm, mass[i], dP * cap[i] * cap[j] / (cap[i] + cap[j]));
        if (dm <= 0) continue;
        mass[i] -= dm;
        mass[j] += dm;
        const q = dm / dt;

        driveGate(i, shear[i], q, Pi, gw[i]);   // giver spun by its gate's shear
        driveGate(j, shear[j], q, Pi, gw[j]);   // receiver spun by its gate's shear

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
          driveGate(i, shear[i], q, Pi, gw[i]);
          const bv = Math.min(1, q * BURST_SCALE);
          if (bv > ventBurst) ventBurst = bv;
          if (bv > burst[i]) burst[i] = bv;
        }
      }

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
      uArr[7] = 0;   // (unused — gate width is now per-ring in storage.gw)
      uArr[8] = colorRGB[0]; uArr[9] = colorRGB[1]; uArr[10] = colorRGB[2];
      // Centre-ring pressure — the shader normalises every ring's liquid alpha to
      // this, so the centre reads fully opaque and each outer ring's transparency
      // is proportional to its pressure relative to the centre.
      uArr[11] = mass[0] / cap[0];
      uArr[12] = liquidFade; uArr[13] = ventBurst;
      uArr[14] = wrap(outAng(ringCount - 1));   // vent = outermost ring's outlet base
      uArr[15] = numShearLines;                 // gates per ring (M)
      device.queue.writeBuffer(ubuf, 0, uArr);

      // ---- per-ring storage ----
      for (let i = 0; i < ringCount; i++) {
        const o = i * 8;
        sArr[o] = phi[i];
        sArr[o + 1] = omega[i];
        sArr[o + 2] = g0[i];
        sArr[o + 3] = shear[i];
        sArr[o + 4] = mass[i] / cap[i];
        sArr[o + 5] = burst[i];
        sArr[o + 6] = gw[i];
        sArr[o + 7] = 0;
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

      setFlowRate(r) { flowRate = Math.max(0.01, Math.min(1000000, r)); },
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

      setShearLines(n) { numShearLines = Math.max(1, Math.min(8, Math.round(n))); },
      getShearLines() { return numShearLines; },

      // Width/orientation are min/max pairs; the min can't exceed the current
      // max and the max can't drop below the current min (clamped here too, in
      // case a caller bypasses the paired-slider UI).
      setGateMin(f) { gateMinFrac = Math.max(0.005, Math.min(gateMaxFrac, f)); deriveGates(); },
      getGateMin() { return gateMinFrac; },

      setGateMax(f) { gateMaxFrac = Math.min(0.3, Math.max(gateMinFrac, f)); deriveGates(); },
      getGateMax() { return gateMaxFrac; },

      setOrientMin(d) { orientMin = Math.max(1, Math.min(orientMax, d)); deriveGates(); },
      getOrientMin() { return orientMin; },

      setOrientMax(d) { orientMax = Math.min(179, Math.max(orientMin, d)); deriveGates(); },
      getOrientMax() { return orientMax; },

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

      // Current per-ring angular speed (rad/s, signed). For the UI.
      getSpeeds() {
        const out = new Array(ringCount);
        for (let i = 0; i < ringCount; i++) out[i] = omega[i];
        return out;
      },
    };
  },
};
