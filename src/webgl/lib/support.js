// @ts-check
// Feature detection + friendly fallback messaging for WebGPU doodles.

/** Thrown when WebGPU is unavailable; carries a human-readable message. */
export class WebGPUUnsupportedError extends Error {
  constructor(message) {
    super(message);
    this.name = "WebGPUUnsupportedError";
  }
}

const UNSUPPORTED_MSG =
  "WebGPU isn't available in this browser. Try the latest Chrome, Edge, or " +
  "Safari (or a Chromium-based browser) with hardware acceleration enabled.";

/**
 * Is the WebGPU API present at all? (Cheap synchronous check.)
 * @returns {boolean}
 */
export function isWebGPUAvailable() {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/**
 * Request an adapter, or throw a typed error explaining why it failed.
 * @param {GPURequestAdapterOptions} [options]
 * @returns {Promise<{ adapter: GPUAdapter }>}
 */
export async function requestAdapterOrExplain(options = {}) {
  if (!isWebGPUAvailable()) throw new WebGPUUnsupportedError(UNSUPPORTED_MSG);
  const adapter = await navigator.gpu.requestAdapter(options);
  if (!adapter) throw new WebGPUUnsupportedError(UNSUPPORTED_MSG);
  return { adapter };
}

/**
 * Replace a container's contents with a readable, screen-reader-friendly
 * fallback: an optional static thumbnail plus a short explanation.
 * @param {HTMLElement} container
 * @param {{ reason?: string, thumbnail?: string }} [opts]
 */
export function renderFallback(container, { reason, thumbnail } = {}) {
  container.innerHTML = "";
  const box = document.createElement("div");
  box.className = "doodle-fallback";
  box.setAttribute("role", "note");

  if (thumbnail) {
    const img = document.createElement("img");
    img.src = thumbnail;
    img.alt = "Static preview of this doodle.";
    box.appendChild(img);
  }

  const p = document.createElement("p");
  p.textContent =
    reason && reason !== "no-webgpu"
      ? `This doodle couldn't start: ${reason}`
      : UNSUPPORTED_MSG;
  box.appendChild(p);

  container.appendChild(box);
  return box;
}
