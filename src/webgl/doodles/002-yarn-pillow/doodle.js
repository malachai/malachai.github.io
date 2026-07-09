// @ts-check
// 002-yarn-pillow — a single continuous woolen yarn wound around an invisible
// "pillow" (a rounded matchbook: a squircle footprint that bulges in the middle
// and pinches to a seam at its rim). The strand follows a Hilbert curve across
// the top face, wraps the rim, and runs the same curve in reverse across the
// underside, so one closed loop covers the whole outside. The surface pattern
// (2-ply twist + fibre fuzz + rainbow) scrolls forward, so the yarn reads as
// physically moving, endlessly.
//
// Nothing here relies on identifier names surviving minification (spec §15).

// --- small vec3 helpers (plain [x,y,z] arrays) ---
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
function normalize(a) {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
// Rotate vector v around unit axis k by angle a (Rodrigues).
function rotateAround(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a);
  const kv = cross(k, v);
  const kk = dot(k, v) * (1 - c);
  return [
    v[0] * c + kv[0] * s + k[0] * kk,
    v[1] * c + kv[1] * s + k[1] * kk,
    v[2] * c + kv[2] * s + k[2] * kk,
  ];
}

// --- Hilbert curve: distance d (0..n*n-1) → grid cell [x,y] on an n×n grid. ---
function hilbertD2XY(n, d) {
  let x = 0, y = 0, t = d;
  for (let s = 1; s < n; s *= 2) {
    const rx = 1 & (t >> 1);
    const ry = 1 & (t ^ rx);
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      const tmp = x; x = y; y = tmp;
    }
    x += s * rx;
    y += s * ry;
    t = Math.floor(t / 4);
  }
  return [x, y];
}

// --- Pillow surface: (u,v) in (0,1)² → 3D point. ---
// Footprint is a rounded square (squircle) so the corners are soft, like a
// matchbook. The face bulges to a max in the middle and pinches to z≈0 at the
// rim, where it meets the other face.
const ROUND = 0.5; // 0 = hard square, 1 = full circle
function pillowPoint(u, v, side, W, H, T) {
  const a = 2 * u - 1, b = 2 * v - 1; // [-1,1]
  const rx = a * Math.sqrt(1 - 0.5 * b * b);
  const ry = b * Math.sqrt(1 - 0.5 * a * a);
  const x = ((1 - ROUND) * a + ROUND * rx) * 0.5 * W;
  const y = ((1 - ROUND) * b + ROUND * ry) * 0.5 * H;
  const bulge = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
  return [x, y, side * T * bulge];
}

// --- Chaikin corner-cutting on a CLOSED polyline → smoother, wooly path. ---
function chaikinClosed(P, iters) {
  let pts = P;
  for (let it = 0; it < iters; it++) {
    const out = [];
    const m = pts.length;
    for (let i = 0; i < m; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % m];
      out.push([
        0.75 * a[0] + 0.25 * b[0],
        0.75 * a[1] + 0.25 * b[1],
        0.75 * a[2] + 0.25 * b[2],
      ]);
      out.push([
        0.25 * a[0] + 0.75 * b[0],
        0.25 * a[1] + 0.75 * b[1],
        0.25 * a[2] + 0.75 * b[2],
      ]);
    }
    pts = out;
  }
  return pts;
}

// --- Build the closed strand centreline over both pillow faces. ---
function buildCenterline(order, W, H, T) {
  const n = 1 << order;
  const M = n * n;
  const raw = [];
  for (let d = 0; d < M; d++) {
    const [gx, gy] = hilbertD2XY(n, d);
    raw.push(pillowPoint((gx + 0.5) / n, (gy + 0.5) / n, 1, W, H, T));
  }
  for (let d = M - 1; d >= 0; d--) {
    const [gx, gy] = hilbertD2XY(n, d);
    raw.push(pillowPoint((gx + 0.5) / n, (gy + 0.5) / n, -1, W, H, T));
  }
  return raw; // closed loop
}

// --- Extrude a round tube along a closed centreline (parallel-transport
//     frame with closure correction). Vertex = [pos(3) nrm(3) arclen(1) coord(1)]. ---
function buildTube(P, radius, ring) {
  const K = P.length;

  const T = new Array(K);
  for (let i = 0; i < K; i++) {
    T[i] = normalize(sub(P[(i + 1) % K], P[(i - 1 + K) % K]));
  }

  const s = new Array(K);
  let acc = 0;
  s[0] = 0;
  for (let i = 1; i < K; i++) {
    acc += len(sub(P[i], P[i - 1]));
    s[i] = acc;
  }
  const totalLen = acc + len(sub(P[0], P[K - 1]));

  const Nf = new Array(K);
  const up = Math.abs(T[0][1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  Nf[0] = normalize(cross(up, T[0]));
  const transport = (nPrev, t0, t1) => {
    const axis = cross(t0, t1);
    const al = len(axis);
    let nn = nPrev;
    if (al > 1e-8) {
      const ang = Math.atan2(al, dot(t0, t1));
      nn = rotateAround(nn, scale(axis, 1 / al), ang);
    }
    return normalize(sub(nn, scale(t1, dot(nn, t1))));
  };
  for (let i = 1; i < K; i++) {
    Nf[i] = transport(Nf[i - 1], T[i - 1], T[i]);
  }
  {
    const nClose = transport(Nf[K - 1], T[K - 1], T[0]);
    const b0 = cross(T[0], Nf[0]);
    const phi = Math.atan2(dot(nClose, b0), dot(nClose, Nf[0]));
    for (let i = 0; i < K; i++) {
      Nf[i] = rotateAround(Nf[i], T[i], -phi * (i / K));
    }
  }

  const verts = new Float32Array(K * ring * 8);
  let o = 0;
  for (let i = 0; i < K; i++) {
    const t = T[i];
    const nrm = Nf[i];
    const bin = cross(t, nrm);
    const arclen = s[i];
    for (let j = 0; j < ring; j++) {
      const coord = j / ring;
      const th = 2 * Math.PI * coord;
      const ct = Math.cos(th), st = Math.sin(th);
      const dir = [
        ct * nrm[0] + st * bin[0],
        ct * nrm[1] + st * bin[1],
        ct * nrm[2] + st * bin[2],
      ];
      verts[o++] = P[i][0] + radius * dir[0];
      verts[o++] = P[i][1] + radius * dir[1];
      verts[o++] = P[i][2] + radius * dir[2];
      verts[o++] = dir[0];
      verts[o++] = dir[1];
      verts[o++] = dir[2];
      verts[o++] = arclen;
      verts[o++] = coord;
    }
  }

  const idx = new Uint32Array(K * ring * 6);
  let p = 0;
  for (let i = 0; i < K; i++) {
    const i0 = i * ring;
    const i1 = ((i + 1) % K) * ring;
    for (let j = 0; j < ring; j++) {
      const j1 = (j + 1) % ring;
      const a = i0 + j, b = i0 + j1, c = i1 + j, dd = i1 + j1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b;
      idx[p++] = b; idx[p++] = c; idx[p++] = dd;
    }
  }

  return { verts, idx, totalLen };
}

// --- tiny column-major mat4 helpers ---
function identity() {
  const o = new Float32Array(16);
  o[0] = o[5] = o[10] = o[15] = 1;
  return o;
}
function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let sMul = 0;
      for (let k = 0; k < 4; k++) sMul += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = sMul;
    }
  return o;
}
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

// --- parameters ---
const ORDER = 5;              // Hilbert order → 32×32 cells per face
const W = 2.2, H = 2.2;       // pillow footprint
const T = 0.30;               // half-thickness (matchbook is fairly flat)
const CHAIKIN = 2;            // smoothing passes
const RING = 10;              // tube cross-section segments
const RADIUS_FACTOR = 0.30;   // thin yarn (fraction of row spacing)
const COLOR_CYCLES = 6;       // whole rainbow bands around the loop (seamless)
const FLOW_SPEED = 0.18;      // world units/second the pattern scrolls forward
const PLY = 2;                // 2-ply yarn
const PLY_PITCH = 0.09;       // world-space distance between twists
const FRESNEL = 0.5;          // strength of the fuzzy fresnel halo

const DEPTH_FORMAT = "depth24plus";

export default {
  meta: {
    title: "Yarn Pillow",
    description:
      "A single fluffy woolen yarn winds along a Hilbert curve around an " +
      "invisible rounded pillow, its twist and rainbow flowing forward forever.",
    tags: ["mesh", "3d", "curve", "generative", "color"],
    created: "2026-07-09",
    prefersReducedMotionSafe: false,
  },

  /** @param {any} ctx */
  async init(ctx) {
    const { device, context, format, loadWGSL } = ctx;

    // --- geometry (built once) ---
    const spacing = W / (1 << ORDER);
    const radius = RADIUS_FACTOR * spacing;
    const centre = buildCenterline(ORDER, W, H, T);
    const smooth = chaikinClosed(centre, CHAIKIN);
    const { verts, idx, totalLen } = buildTube(smooth, radius, RING);
    const indexCount = idx.length;
    // Whole number of twists over the loop → the ply pattern is seamless too.
    const twistCount = Math.max(1, Math.round(totalLen / PLY_PITCH));

    const vbuf = device.createBuffer({
      size: verts.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vbuf, 0, verts);

    const ibuf = device.createBuffer({
      size: idx.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(ibuf, 0, idx);

    // Uniform: mvp(64) + model(64) + p0(16) + p1(16) = 160 bytes.
    const ubuf = device.createBuffer({
      size: 160,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // --- pipeline ---
    const module = device.createShaderModule({ code: await loadWGSL("./shader.wgsl") });

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });
    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: ubuf } }],
    });
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    const pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module,
        entryPoint: "vs_main",
        buffers: [
          {
            arrayStride: 32, // 8 floats
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },  // position
              { shaderLocation: 1, offset: 12, format: "float32x3" }, // normal
              { shaderLocation: 2, offset: 24, format: "float32" },   // arclen
              { shaderLocation: 3, offset: 28, format: "float32" },   // coord (around tube)
            ],
          },
        ],
      },
      fragment: { module, entryPoint: "fs_main", targets: [{ format }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: {
        format: DEPTH_FORMAT,
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });

    // --- size-dependent depth texture ---
    let depthTex = null;
    let depthView = null;
    function ensureDepth(width, height) {
      if (depthTex) depthTex.destroy();
      depthTex = device.createTexture({
        size: { width, height },
        format: DEPTH_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      depthView = depthTex.createView();
    }

    const mvp = new Float32Array(16);
    const p0 = new Float32Array(4);
    const p1 = new Float32Array(4);

    return {
      frame({ t }) {
        const canvas = context.canvas;
        const w = canvas.width || 1, h = canvas.height || 1;
        if (!depthView) ensureDepth(w, h);

        const aspect = w / Math.max(1, h);
        const proj = perspective(Math.PI / 4, aspect, 0.1, 100);
        const view = translate(0, 0, -3.6);
        // Gentle tilt + slow spin so both faces of the pillow come into view.
        const model = mul(rotY(t * 0.22), rotX(-0.6));

        mvp.set(mul(proj, mul(view, model)));
        device.queue.writeBuffer(ubuf, 0, mvp);
        device.queue.writeBuffer(ubuf, 64, model);
        p0[0] = t;
        p0[1] = totalLen;
        p0[2] = COLOR_CYCLES;
        p0[3] = FLOW_SPEED;
        device.queue.writeBuffer(ubuf, 128, p0);
        p1[0] = twistCount;
        p1[1] = PLY;
        p1[2] = FRESNEL;
        p1[3] = 0;
        device.queue.writeBuffer(ubuf, 144, p1);

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: context.getCurrentTexture().createView(),
              clearValue: { r: 0.043, g: 0.043, b: 0.055, a: 1 },
              loadOp: "clear",
              storeOp: "store",
            },
          ],
          depthStencilAttachment: {
            view: depthView,
            depthClearValue: 1.0,
            depthLoadOp: "clear",
            depthStoreOp: "store",
          },
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, vbuf);
        pass.setIndexBuffer(ibuf, "uint32");
        pass.drawIndexed(indexCount);
        pass.end();
        device.queue.submit([encoder.finish()]);
      },

      resize({ width, height }) {
        ensureDepth(width, height);
      },

      destroy() {
        vbuf.destroy();
        ibuf.destroy();
        ubuf.destroy();
        if (depthTex) depthTex.destroy();
      },
    };
  },
};
