// @ts-check
// The render loop: time/dt/frameIndex, resize observation, and pausing when
// the canvas is hidden or offscreen. Doodles never own their own rAF.

import { sizeCanvasToDisplay } from "./gpu.js";

/**
 * @typedef {Object} LoopOpts
 * @property {HTMLCanvasElement} canvas
 * @property {GPUDevice} device
 * @property {number} [maxDPR]        Cap on devicePixelRatio (default 2).
 * @property {boolean} [prefersReducedMotionSafe]  Keep animating under reduced-motion.
 * @property {boolean} [observeIntersection]  Auto-pause offscreen (default true).
 */

/**
 * Drive a doodle instance. Returns a handle with pause/resume/stop.
 * @param {{ frame: Function, resize?: Function, destroy?: Function }} instance
 * @param {LoopOpts} opts
 */
export function runLoop(instance, opts) {
  const { canvas, device } = opts;
  const maxDim = device.limits.maxTextureDimension2D;
  const dpr = Math.min(
    typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
    opts.maxDPR ?? 2
  );

  const prefersReduced =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches &&
    !opts.prefersReducedMotionSafe;

  let raf = 0;
  let running = false;
  let onscreen = true;
  let startT = 0;
  let lastT = 0;
  let frameIndex = 0;
  let pendingResize = true;

  function applyResize() {
    const { width, height } = sizeCanvasToDisplay(canvas, dpr, maxDim);
    instance.resize?.({ width, height, dpr });
  }

  function renderOne(now) {
    const nowS = now / 1000;
    if (!startT) startT = nowS;
    if (!lastT) lastT = nowS;
    if (pendingResize) {
      pendingResize = false;
      applyResize();
    }
    const t = nowS - startT;
    const dt = nowS - lastT;
    lastT = nowS;
    instance.frame({ t, dt, frameIndex });
    frameIndex++;
  }

  function tick(now) {
    renderOne(now);
    if (running) raf = requestAnimationFrame(tick);
  }

  function resume() {
    if (running || prefersReduced) return;
    running = true;
    lastT = 0; // avoid a huge dt after a pause
    raf = requestAnimationFrame(tick);
  }

  function pause() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  // Resize observation.
  const ro = new ResizeObserver(() => {
    pendingResize = true;
  });
  ro.observe(canvas);

  // Auto-pause when scrolled offscreen.
  let io = null;
  if (opts.observeIntersection !== false && typeof IntersectionObserver !== "undefined") {
    io = new IntersectionObserver(
      (entries) => {
        onscreen = entries[0]?.isIntersecting ?? true;
        if (onscreen && !document.hidden) resume();
        else pause();
      },
      { threshold: 0 }
    );
    io.observe(canvas);
  }

  // Auto-pause when the tab is hidden.
  function onVisibility() {
    if (document.hidden) pause();
    else if (onscreen) resume();
  }
  document.addEventListener("visibilitychange", onVisibility);

  function stop() {
    pause();
    ro.disconnect();
    io?.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    instance.destroy?.();
  }

  // Kick off. Under reduced motion, render a single settled frame and hold.
  if (prefersReduced) {
    requestAnimationFrame((now) => renderOne(now));
  } else {
    resume();
  }

  return { pause, resume, stop };
}
