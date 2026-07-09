// @ts-check
// Device/adapter request, canvas configuration, and size helpers.

import { requestAdapterOrExplain } from "./support.js";

/**
 * Request adapter + device and configure the canvas context.
 * @param {HTMLCanvasElement} canvas
 * @param {{ requiredFeatures?: GPUFeatureName[], requiredLimits?: Record<string, number> }} [opts]
 * @returns {Promise<{ adapter: GPUAdapter, device: GPUDevice, context: GPUCanvasContext, format: GPUTextureFormat }>}
 */
export async function initGPU(canvas, { requiredFeatures = [], requiredLimits = {} } = {}) {
  const { adapter } = await requestAdapterOrExplain();
  const device = await adapter.requestDevice({ requiredFeatures, requiredLimits });

  const context = /** @type {GPUCanvasContext} */ (canvas.getContext("webgpu"));
  if (!context) throw new Error("Couldn't get a WebGPU canvas context.");

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "premultiplied" });

  // Surface device loss rather than dying silently.
  device.lost.then((info) => {
    if (info.reason !== "destroyed") {
      console.error(`[doodle] WebGPU device lost: ${info.reason} — ${info.message}`);
    }
  });

  // Surface validation/out-of-memory errors instead of letting frames no-op silently.
  device.addEventListener?.("uncapturederror", (e) => {
    console.error(`[doodle] WebGPU ${e.error?.constructor?.name || "error"}: ${e.error?.message || e}`);
  });

  return { adapter, device, context, format };
}

/**
 * Size a canvas's backing store to its displayed size × dpr, clamped to the
 * device's max 2D texture dimension. Returns the pixel dimensions.
 * @param {HTMLCanvasElement} canvas
 * @param {number} dpr
 * @param {number} maxDim
 * @returns {{ width: number, height: number }}
 */
export function sizeCanvasToDisplay(canvas, dpr, maxDim) {
  const rect = canvas.getBoundingClientRect();
  const cssW = rect.width || canvas.clientWidth || 300;
  const cssH = rect.height || canvas.clientHeight || 150;
  const width = Math.max(1, Math.min(Math.round(cssW * dpr), maxDim));
  const height = Math.max(1, Math.min(Math.round(cssH * dpr), maxDim));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width: canvas.width, height: canvas.height };
}
