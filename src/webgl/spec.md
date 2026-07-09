\# WebGPU Doodles — Project Spec



A living spec for a repository of small, self-contained WebGPU experiments ("doodles"), served as a static site on GitHub Pages, presented through a gallery with live thumbnails.



This document defines \*how the repo is structured and how a doodle must behave\* so that every experiment is drop-in, portable, and shows up in the gallery automatically. It is the source of truth the companion system prompt refers to.



\---



\## 0. Working boundary — read this first



The doodles live \*\*inside a larger existing site\*\*, the `malachai.github.io` repository. This spec, and any agent driven by the companion system prompt, operate under a hard boundary:



\- \*\*Read access is repo-wide.\*\* You may read any file in `malachai.github.io/` to understand context — the site's existing structure, styles, navigation, how Pages is configured, how other pages are wired up.

\- \*\*Write access is limited to `src/webgl/`.\*\* Only files inside `malachai.github.io/src/webgl/` may be created, edited, or deleted directly. Everything doodle-related — the gallery, `lib/`, `doodles/`, `tools/`, manifest, styles for this section — lives under `src/webgl/`.

\- \*\*Everything outside `src/webgl/` is suggest-only.\*\* If a change is needed elsewhere — a link in the site's top-level nav, an entry in a sitemap, a tweak to a shared header, a Pages config change, a root `index.html` redirect — \*\*do not edit it\*\*. Instead, describe the exact change (file path, what to add/modify, and a ready-to-paste snippet) and hand it to the repo owner to apply. The owner performs all such edits and all git actions.



This keeps the doodles fully self-contained within their own subtree and guarantees the agent never disturbs the rest of the site. Wherever the sections below say "the repo root," read it as \*\*`src/webgl/` (the doodles root)\*\*, not the actual repository root.



\---



\## 1. Goals \& philosophy



\- \*\*Low friction to start a new doodle.\*\* Making a new experiment should be "copy the template folder, edit the shader, refresh." No build step standing between an idea and pixels on screen.

\- \*\*Each doodle is self-contained and portable.\*\* A doodle is a folder that runs on its own by opening its `index.html`. It should not secretly depend on the gallery to work.

\- \*\*Shared plumbing, not shared style.\*\* Boring, error-prone WebGPU boilerplate (device init, canvas config, the render loop, resize, teardown) lives in one small shared library. The \*creative\* code — shaders, compute, geometry — stays in the doodle.

\- \*\*The gallery is generated from the doodles, never the reverse.\*\* Adding a doodle to a manifest is the only registration step; the index page renders itself from that.

\- \*\*Graceful when WebGPU is absent.\*\* As of 2026 WebGPU ships in all major browsers, but older versions, some Linux/Firefox configs, locked-down devices, and reduced-power modes still lack it. Every doodle and the gallery must detect support and degrade to a readable message or a static image rather than a blank canvas or a thrown error.



Scope is deliberately \*\*open\*\*: fragment-shader visuals, compute particle systems, cellular automata, raymarching, mesh rendering, audio-reactive pieces — anything WebGPU can do is fair game. The contract below is medium-agnostic.



\---



\## 2. Tooling decision (and why)



You asked for the trade-offs rather than a pick, so here they are, then the recommendation.



\### Option A — Zero-build vanilla (plain HTML/JS/WGSL, no bundler)



\*\*Pros\*\*

\- Push and it works on Pages; there is no CI build to configure or break.

\- Every doodle is trivially portable — a folder you can email to someone.

\- Nothing to learn, nothing to update, no `node\_modules`.

\- Easiest possible mental model for "open the file, see the change."



\*\*Cons\*\*

\- WebGPU boilerplate gets copy-pasted into every doodle unless you add module loading (which pushes you toward Option C anyway).

\- No TypeScript, and the WebGPU API is verbose and easy to mistype (bind group layouts, vertex buffer strides, texture formats). You find the errors at runtime.

\- The live-thumbnail gallery needs a hand-maintained manifest.



\### Option B — Vite + TypeScript (dev server, build, deploy Action)



\*\*Pros\*\*

\- TypeScript + `@webgpu/types` catches a whole class of WebGPU API misuse before it runs — genuinely valuable given how fiddly the API is.

\- Hot module reload makes shader iteration fast.

\- Shared modules, WGSL-as-import plugins, and an auto-generated gallery manifest all come for free at build time.

\- Minified, cache-busted output.



\*\*Cons\*\*

\- Adds a build pipeline and a GitHub Action to deploy to Pages; more moving parts and a `base` path to configure for project pages (`/<repo>/`).

\- Slower "just push" loop; dependency maintenance over time.

\- A doodle is no longer a portable folder — it needs the build to run.



\### Option C — Vanilla + ES modules + import maps (recommended default)



\*\*Pros\*\*

\- \*\*No build step\*\* — deploys to Pages by pushing, like Option A.

\- \*\*Shared code without duplication\*\* — a small `lib/` of ES modules is imported by every doodle via a bare specifier (`import { initGPU } from "doodle-lib/gpu.js"`), pinned by an import map.

\- Doodles stay portable: each folder's `index.html` carries its own import map, so it runs standalone.

\- Plays perfectly with a live-thumbnail gallery that shares one runtime module.

\- Clean upgrade path: if type safety starts hurting, you can layer Vite/TS on top later without rewriting the doodle contract.



\*\*Cons\*\*

\- No TypeScript types out of the box. Mitigation: use JSDoc `@type` annotations on the shared lib plus the `@webgpu/types` file referenced via `// @ts-check` in editors — you get most of the safety in-editor without a build.

\- The gallery manifest is maintained by a tiny local Node script (run by hand, committed output), not a build.

\- Import maps must use paths that resolve correctly under the project-pages base path.



\### Recommendation



\*\*Go with Option C (vanilla + import maps).\*\* It keeps the push-to-deploy simplicity you want for rapid experimentation, eliminates boilerplate duplication, and is the natural fit for a shared-runtime live-thumbnail gallery — while leaving Vite/TS as a clean later upgrade if the lack of a type-checked build ever becomes the bottleneck. The rest of this spec assumes Option C.



\---



\## 3. Repository layout



Everything doodle-related lives under `src/webgl/` — the \*\*writable working area\*\* (§0). The surrounding site is read-only context.



```

malachai.github.io/              # Full site repo — READ-only context; suggest changes, don't edit

├── index.html                   # Site root — DO NOT edit; suggest a link/redirect instead

├── … other site files …         # DO NOT edit; suggest changes for the owner to apply

└── src/

&#x20;   └── webgl/                    # ← WRITABLE. The doodles root. All work happens here.

&#x20;       ├── index.html            # Gallery landing page

&#x20;       ├── manifest.json         # Generated list of doodles (source for the gallery)

&#x20;       ├── lib/                  # Shared runtime — imported by every doodle

&#x20;       │   ├── gpu.js           # Device/adapter request, canvas configuration, format

&#x20;       │   ├── loop.js          # rAF loop: time, dt, resize, visibility pause

&#x20;       │   ├── support.js       # Feature detection + fallback messaging

&#x20;       │   └── gallery.js       # Card rendering, IntersectionObserver, thumbnail policy

&#x20;       ├── doodles/

&#x20;       │   ├── \_template/        # Copy this to start a new doodle

&#x20;       │   │   ├── index.html

&#x20;       │   │   ├── doodle.js

&#x20;       │   │   └── shader.wgsl

&#x20;       │   ├── 001-color-field/

&#x20;       │   │   ├── index.html

&#x20;       │   │   ├── doodle.js

&#x20;       │   │   ├── shader.wgsl

&#x20;       │   │   └── thumb.png     # Optional static fallback thumbnail

&#x20;       │   └── 002-particle-flow/

&#x20;       │       └── ...

&#x20;       ├── tools/

&#x20;       │   └── build-manifest.mjs # Scans doodles/, regenerates manifest.json

&#x20;       ├── styles.css

&#x20;       └── SPEC.md

```



> \*\*Discoverability from the rest of the site\*\* (linking the gallery into the site's nav, adding it to a root index or sitemap) lives \*outside\* `src/webgl/` and is therefore \*\*suggest-only\*\* — propose the edit with a paste-ready snippet and let the owner apply it (§0).



\### Naming



\- Doodle folders are `NNN-kebab-slug` where `NNN` is a zero-padded sequence number (`001`, `002`, …). Numbers give a stable chronological ordering and readable URLs.

\- The slug is short, lowercase, hyphenated, and stable — it becomes the permalink, so avoid renaming after publishing.



\### URLs (GitHub Pages, user site)



`malachai.github.io` is a \*\*user site\*\*, so Pages serves from the repo root at `https://malachai.github.io/`. The doodles therefore live under `https://malachai.github.io/src/webgl/`, and a doodle is `…/src/webgl/doodles/001-color-field/`. All references must be \*\*relative\*\* (`../../lib/gpu.js`, not `/src/webgl/lib/gpu.js` and never a bare `/lib/gpu.js`) so a doodle resolves correctly whether opened standalone, served from `/src/webgl/…`, or later moved. See §7 on the import-map base-path detail.



\---



\## 4. The doodle contract



A doodle is an ES module (`doodle.js`) with a \*\*default export\*\* implementing the interface below. The shared runtime constructs the device and canvas, then hands them to the doodle; the doodle returns per-frame and lifecycle callbacks. This is the single most important part of the spec — conform to it and everything else (standalone run, gallery embedding, live thumbnails, teardown) works for free.



```js

// doodles/001-color-field/doodle.js

export default {

&#x20; meta: {

&#x20;   title: "Color Field",

&#x20;   description: "A drifting gradient driven by simplex noise in a fragment shader.",

&#x20;   tags: \["fragment", "noise", "generative"],

&#x20;   created: "2026-07-09",

&#x20;   // Optional hints the runtime respects:

&#x20;   prefersReducedMotionSafe: false, // if true, keeps animating under reduced-motion

&#x20;   thumbnail: "thumb.png"           // static fallback for the gallery (optional)

&#x20; },



&#x20; /\*\*

&#x20;  \* Called once after the device + canvas are ready.

&#x20;  \* @param {DoodleContext} ctx

&#x20;  \* @returns {DoodleInstance}

&#x20;  \*/

&#x20; async init(ctx) {

&#x20;   const { device, context, canvas, format, loadWGSL } = ctx;



&#x20;   const module = device.createShaderModule({ code: await loadWGSL("./shader.wgsl") });

&#x20;   // ... create pipeline, buffers, bind groups ...



&#x20;   return {

&#x20;     // Called every animation frame. `t` seconds since start, `dt` seconds since last frame.

&#x20;     frame({ t, dt, frameIndex }) {

&#x20;       // encode + submit a command buffer for this frame

&#x20;     },

&#x20;     // Called on canvas resize (after the runtime reconfigures the context).

&#x20;     resize({ width, height, dpr }) {

&#x20;       // recreate size-dependent resources (depth textures, etc.)

&#x20;     },

&#x20;     // Called when the doodle is torn down (navigating away, or gallery card scrolled off).

&#x20;     // MUST release GPU resources it created: buffers, textures, pipelines it owns.

&#x20;     destroy() {}

&#x20;   };

&#x20; }

};

```



\### `DoodleContext` (passed to `init`)



| Field | Type | Notes |

|---|---|---|

| `device` | `GPUDevice` | Already requested by the runtime, with sensible limits. |

| `adapter` | `GPUAdapter` | For querying features/limits. |

| `context` | `GPUCanvasContext` | Already `configure()`d with `format` and `alphaMode: "premultiplied"`. |

| `canvas` | `HTMLCanvasElement` | The target canvas. |

| `format` | `GPUTextureFormat` | From `navigator.gpu.getPreferredCanvasFormat()`. |

| `loadWGSL` | `(url) => Promise<string>` | Fetches WGSL relative to the doodle module. |

| `mode` | `"standalone" \\| "gallery"` | Lets a doodle scale down work for thumbnail embedding. |

| `quality` | `number` | 0–1 hint; the gallery passes a low value for live thumbnails. |



\### `DoodleInstance` (returned by `init`)



\- `frame({ t, dt, frameIndex })` — \*\*required.\*\* Encode and submit one frame. Do not call `requestAnimationFrame` yourself; the runtime owns the loop.

\- `resize({ width, height, dpr })` — optional. Recreate size-dependent resources. The runtime handles canvas sizing and context reconfiguration before calling this.

\- `destroy()` — \*\*required if the doodle allocates GPU resources.\*\* Must free everything it created so gallery cards can mount/unmount repeatedly without leaking.



\### Rules



1\. \*\*The doodle never owns the animation loop, device request, or canvas sizing.\*\* Those belong to the runtime so that the gallery can pause, throttle, and tear down uniformly.

2\. \*\*The doodle never assumes it is fullscreen or the only thing on the page.\*\* In `gallery` mode it may be a 240×160 card among dozens.

3\. \*\*All resources created in `init` are released in `destroy`.\*\* No orphaned textures.

4\. \*\*No global state that survives teardown.\*\* Two instances of the same doodle (standalone tab + gallery card) must not collide.



\---



\## 5. Shared runtime (`lib/`)



Small, dependency-free ES modules. JSDoc-typed, `// @ts-check`-friendly.



\### `lib/support.js`

\- `isWebGPUAvailable()` → boolean (`"gpu" in navigator` and an adapter is obtainable).

\- `requestAdapterOrExplain()` → `{ adapter }` or throws a typed `WebGPUUnsupportedError` carrying a human message ("WebGPU isn't available in this browser…").

\- `renderFallback(container, { reason, thumbnail })` — replaces the canvas with a static thumbnail (if provided) plus a short, friendly explanation and a link to enable/upgrade.



\### `lib/gpu.js`

\- `initGPU(canvas, { requiredFeatures, requiredLimits })` → `{ adapter, device, context, format }`. Requests the adapter/device, configures the context with the preferred format and `alphaMode: "premultiplied"`, and wires `device.lost` handling (surfaces a fallback rather than dying silently).

\- `sizeCanvasToDisplay(canvas, dpr)` → `{ width, height }`, clamped to `device.limits.maxTextureDimension2D`.



\### `lib/loop.js`

\- `runLoop(instance, { canvas, context, device, targetFPS })` — owns `requestAnimationFrame`, computes `t`/`dt`/`frameIndex`, observes resize (`ResizeObserver`) and reconfigures the context + calls `instance.resize`, and \*\*pauses when the page/canvas is not visible\*\* (`document.hidden` and `IntersectionObserver`) to save the GPU. Returns a handle with `pause()`, `resume()`, and `stop()` (which calls `instance.destroy`).

\- Respects `prefers-reduced-motion`: if set and the doodle is not `prefersReducedMotionSafe`, renders a single frame and holds, rather than animating.



\### `lib/gallery.js`

\- Reads `manifest.json`, builds a card grid, and manages the \*\*live-thumbnail policy\*\* (see §6).



Everything in `lib/` is imported by doodles and the gallery via the import map (§7).



\---



\## 6. Gallery \& live thumbnails



The landing `index.html` renders a responsive card grid from `manifest.json`. Each card links to the standalone doodle and shows a \*\*live\*\* preview — a real WebGPU canvas running the doodle at reduced quality — but only when it makes sense to do so. Running dozens of WebGPU contexts at once will melt a laptop, so the policy is strict:



\### Live-thumbnail policy



1\. \*\*Lazy mount via `IntersectionObserver`.\*\* A card's canvas is only initialized when it scrolls into view, and torn down (`instance.destroy()` + context unconfigure) when it scrolls well out of view.

2\. \*\*Concurrency cap.\*\* At most `N` live canvases run simultaneously (default `N = 6`, tuned down on low-end devices via `navigator.hardwareConcurrency` / `deviceMemory` heuristics). Beyond the cap, cards show their static `thumb.png` until a slot frees.

3\. \*\*Reduced quality.\*\* The gallery passes `mode: "gallery"` and a low `quality` value; the runtime caps DPR at 1 and the canvas at thumbnail resolution.

4\. \*\*Static fallback first.\*\* Each card renders its `thumb.png` immediately (fast paint), then upgrades to live if a slot is available. If WebGPU is unavailable, the static thumbnail simply stays.

5\. \*\*Respect `prefers-reduced-motion`.\*\* Under reduced motion, the gallery shows static thumbnails only — no live canvases — unless the user opts in with a toggle.

6\. \*\*Pause when the tab is hidden.\*\* All live cards pause on `document.hidden`.



\### Static thumbnails



`thumb.png` is optional but recommended (fast first paint, and the only preview on unsupported clients). Capture it from the standalone doodle with a "📸 Save thumbnail" affordance the runtime injects in `standalone` mode (calls `canvas.toBlob`), or via the `tools/` script. Commit it into the doodle folder. Target \~480×320, < 60 KB.



\---



\## 7. Import maps \& the base-path detail



Each `index.html` (gallery and every doodle) declares an import map so bare specifiers resolve to the shared lib:



```html

<script type="importmap">

{

&#x20; "imports": {

&#x20;   "doodle-lib/": "../../lib/"

&#x20; }

}

</script>

<script type="module" src="./doodle.js"></script>

```



\- Use \*\*relative\*\* map targets (`../../lib/` from a doodle, `./lib/` from the gallery). Relative targets resolve correctly whether a doodle folder is opened on its own or served under `/src/webgl/…` on the live site — no hardcoded absolute `/lib/` or `/src/webgl/lib/` that would break if opened standalone or if the subtree ever moves.

\- Pin any third-party ESM (e.g. a math or noise helper) in the same map by full URL so there is still no build and versions are explicit.

\- Doodles import shared code as `import { initGPU } from "doodle-lib/gpu.js"`.



\---



\## 8. WGSL conventions



\- Shaders live beside the doodle as `.wgsl` and are fetched via `ctx.loadWGSL`, or inlined as template strings for tiny shaders. Prefer separate files once a shader is more than a few lines — editors syntax-highlight `.wgsl` and diffs stay clean.

\- A shared uniform block convention keeps the plumbing uniform. Reserve `group(0) binding(0)` for a standard `Globals` uniform the runtime can fill:



&#x20; ```wgsl

&#x20; struct Globals {

&#x20;   resolution : vec2f,

&#x20;   time       : f32,

&#x20;   dt         : f32,

&#x20;   frame      : u32,

&#x20; };

&#x20; @group(0) @binding(0) var<uniform> globals : Globals;

&#x20; ```



&#x20; Doodles may add their own bind groups at `group(1)+`.

\- Keep entry points named `vs\_main` / `fs\_main` / `cs\_main` for readability.

\- Guard optional features (e.g. `timestamp-query`, `f16`) behind `requiredFeatures` and check `adapter.features` — never assume.



\---



\## 9. Performance \& resource discipline



\- \*\*One device per page context;\*\* don't request a new adapter per frame.

\- \*\*Free what you allocate.\*\* `destroy()` must release buffers/textures/pipelines the doodle created. The runtime destroys the device on full teardown.

\- \*\*Pause offscreen and hidden.\*\* Handled by the runtime, but don't defeat it by spawning your own `rAF`.

\- \*\*Clamp sizes\*\* to `device.limits.maxTextureDimension2D` and cap DPR (2 is plenty; the gallery uses 1).

\- \*\*Budget the gallery\*\*: static-first paint, capped concurrency, reduced quality. A cold gallery load should not spike the GPU.



\---



\## 10. Accessibility \& UX baseline



\- Honor `prefers-reduced-motion` (§5, §6).

\- Every doodle page has a visible title, a one-line description, and a "back to gallery" link.

\- Provide a pause/play control in standalone mode (the runtime can inject a minimal one).

\- Ensure the fallback message is real text (screen-reader accessible), not baked into an image.

\- Canvas has an `aria-label` describing the piece.



\---



\## 11. Adding a new doodle — checklist



0\. All paths below are relative to `src/webgl/` — the writable root. Do not touch anything outside it (§0).

1\. `cp -r doodles/\_template doodles/00N-my-slug`.

2\. Edit `doodle.js`: fill in `meta`, write `init` returning `frame`/`resize`/`destroy`.

3\. Write `shader.wgsl` (or inline).

4\. Open `doodles/00N-my-slug/index.html` with any static server (`python3 -m http.server`, `npx serve`) — \*\*not\*\* `file://`, because ES module fetch and WebGPU need `http(s)`.

5\. Iterate until it looks right. Capture `thumb.png`.

6\. Run `node tools/build-manifest.mjs` to regenerate `manifest.json`.

7\. Commit the folder + updated manifest. (You handle git/deploy.)

8\. Confirm it appears in the local gallery and that the standalone page still runs in isolation.



\---



\## 12. Definition of done (quality bar per doodle)



\- Runs standalone from its own folder over `http(s)`.

\- Appears in the gallery with a working live thumbnail (or static fallback).

\- Cleanly mounts/unmounts in the gallery with no console errors and no leaked GPU resources across repeated scroll in/out.

\- Shows the friendly fallback (not a blank canvas or thrown error) when WebGPU is unavailable.

\- Respects reduced-motion and pauses when hidden.

\- No hardcoded absolute paths; runs correctly when served from `/src/webgl/…` on the live site and when opened standalone.

\- No files were modified outside `src/webgl/`; any needed changes elsewhere were written up as suggestions for the owner (§0).



\---



\## 13. Open questions / future upgrades



\- \*\*Type safety:\*\* if runtime WebGPU typos become annoying, adopt Option B (Vite + TS) — the doodle contract is designed to survive that migration unchanged.

\- \*\*Auto thumbnails:\*\* a headless capture (Playwright + the pre-installed Chromium) could regenerate every `thumb.png` on demand instead of manual capture.

\- \*\*Tags \& filtering:\*\* the manifest already carries `tags`; a filter UI in the gallery is a natural next step.

\- \*\*Shared shader includes:\*\* a tiny WGSL `#include`-style preprocessor in `loadWGSL` for reusing noise/hash functions across doodles.



\---



\## 14. Running \& testing — owner-only



Running a doodle is the \*\*owner's job, not the agent's\*\*. The collaborator writes the code; the human runs it, looks at it, and reports back. This is a hard rule, on par with the write boundary in §0.



\- \*\*The agent must not run doodles itself.\*\* No headless browser, no Playwright/Puppeteer, no spinning up a local server to screenshot the canvas, no automated WebGPU capture. Even though a headless Chromium may be available in the environment, it is \*\*off-limits\*\* for verifying doodles — headless GPU backends (SwiftShader/ANGLE) don't match real hardware and produce misleading results (a blank or "device lost" canvas that says nothing about how the doodle behaves for the owner).

\- \*\*Static checks only.\*\* The verification the agent may do is limited to things that don't render pixels: syntax-checking JS/JSON, confirming files conform to the doodle contract (§4), checking that relative paths and import maps resolve, and reasoning through the shader and matrix math by hand.

\- \*\*Hand off clearly.\*\* When a doodle is ready, tell the owner exactly what to run (which `index.html`, served over `http(s)` per §11.4) and what to look for, so they can confirm or report back. Iterate from their feedback — never from self-run screenshots.

\- \*\*Thumbnails are owner-captured.\*\* `thumb.png` (§6) is captured by the owner from the running doodle. The agent does not attempt to auto-generate it by rendering. \*This supersedes the "auto thumbnails via headless capture" idea floated in §13.\*



This keeps the loop honest: visual judgement, "does it look right," and real-hardware GPU behaviour all live with the human.



\### 14.1 Serving locally



\- Doodles need `http(s)`, not `file://` (ES-module fetch and WebGPU both require it). From the \*\*repository root\*\* (not `src/webgl/`): `python -m http.server`, then open `http://localhost:8000/src/webgl/doodles/NNN-slug/`. Serving from the repo root keeps the relative import-map target (`../../lib/`) resolving the same way it will on the live site.

\- Harmless `404`s you can ignore: `GET /favicon.ico` and `GET /.well-known/appspecific/com.chrome.devtools.json`. The browser and its devtools request these on their own; they are unrelated to the doodle.



\### 14.2 "No available adapters" / the WebGPU fallback fires



If a doodle shows the friendly fallback message and the console logs `No available adapters` — meaning the WebGPU API exists (`"gpu" in navigator` is true) but `navigator.gpu.requestAdapter()` returned `null` — the browser can't reach a GPU. The doodle is behaving correctly (§5: a readable fallback, not a blank canvas); the fix is environmental. Check, in order:



1\. Open `chrome://gpu`. The \*\*WebGPU\*\* line should read "Hardware accelerated." If it says disabled or software-only, that's the cause.

2\. Turn on hardware acceleration: Chrome/Edge → Settings → System → \*\*"Use graphics acceleration when available"\*\* → then fully quit and restart the browser (not just the tab).

3\. Still failing? Enable `chrome://flags/#enable-unsafe-webgpu` (set to Enabled), and on Linux also `chrome://flags/#enable-vulkan`; restart.

4\. Confirm the browser is recent enough — WebGPU shipped in Chrome/Edge 113+. Safari and Firefox have since shipped it too, but coverage varies by version and platform.

5\. Remote/VM/RDP or otherwise headless sessions frequently expose no GPU adapter at all. Test on a machine with a real display and GPU.



A quick way to confirm the browser itself is capable, independent of any doodle: run `await navigator.gpu?.requestAdapter()` in the devtools console — `null` reproduces the problem outside the doodle code.



\---



\## 15. Deploy reality (corrects §2, §3, §7)



The surrounding `missingwires.com` site does \*\*not\*\* serve the repo root as-is, and there \*\*is\*\* a build step. This section documents what actually happens and supersedes the "no build step / served from repo root at `/src/webgl/…`" assumptions in §2–§3 and §7.



\### How the site builds \& deploys

\- \*\*Web root is `src/`\*\*, not the repository root. The `CNAME` (`missingwires.com`) lives at `src/CNAME`.

\- On push to `master`, GitHub Actions (`.github/workflows/deploy.yml`) runs `node build/build.mjs`, which: cleans `dist/`, copies `src/ → dist/`, \*\*minifies every `.js` in place with terser\*\*, generates `dist/index.html` (the landing page) from `src/projects.json`, writes `.nojekyll`, and publishes `dist/` to Pages. `dist/` is git-ignored and CI-only — never committed.

\- There is no local build to run and no manual deploy: the owner commits `src/…` and pushes; CI does the rest.



\### What this means for doodles

\- \*\*Real URLs drop the `src/` prefix.\*\* A doodle is served at `https://missingwires.com/webgl/doodles/NNN-slug/`, and the doodles section landing is `https://missingwires.com/webgl/`. There is no `/src/` in any production URL. (Locally, served from the repo root, the same files are under `/src/webgl/…` — so keep testing at that local path per §14.1, but link production-facing copy to `/webgl/…`.)

\- \*\*Relative paths still resolve correctly\*\* either way: the import-map target `../../lib/` from a doodle resolves to `/webgl/lib/` in production and `/src/webgl/lib/` locally. Never hardcode an absolute `/src/webgl/…` or `/webgl/…` path — relative keeps both working (this half of §7 stands).

\- \*\*Doodle JS must be minification-safe.\*\* Terser runs with `mangle: true` (local variables only — object properties and top-level/exported names are preserved by the current config) and `compress`. Don't write code whose behaviour depends on `Function.name`, on a specific local variable name, or on top-level identifiers surviving verbatim. Standard doodle code is fine; just don't rely on identifier names as data. (Note: only files ending `.js` are minified — a `.mjs` tool under `tools/` is copied but not minified.)



\### Discoverability is suggest-only (per §0)

\- The homepage card grid is generated from `src/projects.json`. Making the doodles section appear on `missingwires.com` means adding one project entry (`"slug": "webgl"`) to that file. `src/projects.json` is \*\*outside `src/webgl/`\*\*, so the agent \*\*proposes\*\* the entry (paste-ready) and the owner applies it — the agent never edits it. Once present, the card links to `/webgl/`, which is served by `src/webgl/index.html` (inside the boundary).

\- The section landing (`src/webgl/index.html`) is the doodles gallery; individual doodles link back to it via `../../index.html` (→ `/webgl/`), and it links back to the site root via `/`.



\---



\## 16. Corrections \& clarifications from doodle 001

\*Building the first doodle shook these out. They amend the sections named; a later consolidation pass can fold them back inline.\*



\### 16.1 The standalone bootstrap (amends §7)



A doodle is an \*\*inert default-export object\*\* — loading `doodle.js` does not run anything. Each doodle's `index.html` therefore carries a small inline bootstrap that drives support-check → device → `doodle.init` → `runLoop`. §7's `<script type="module" src="./doodle.js">` line was misleading; the real shape `_template/index.html` should carry is:



```html
<script type="importmap">
{ "imports": { "doodle-lib/": "../../lib/" } }
</script>

<script type="module">
  import doodle from "./doodle.js";
  import { isWebGPUAvailable, renderFallback } from "doodle-lib/support.js";
  import { initGPU } from "doodle-lib/gpu.js";
  import { runLoop } from "doodle-lib/loop.js";

  const canvas = document.getElementById("c");
  const stage  = document.getElementById("stage");

  // Fetch WGSL relative to this page (the doodle folder).
  const loadWGSL = (url) =>
    fetch(new URL(url, import.meta.url)).then((r) => {
      if (!r.ok) throw new Error(`Failed to load ${url}: HTTP ${r.status}`);
      return r.text();
    });

  (async () => {
    if (!isWebGPUAvailable()) {
      renderFallback(stage, { reason: "no-webgpu", thumbnail: doodle.meta.thumbnail });
      return;
    }
    try {
      const { adapter, device, context, format } = await initGPU(canvas);
      const instance = await doodle.init({
        device, adapter, context, canvas, format, loadWGSL,
        mode: "standalone", quality: 1,
      });
      runLoop(instance, { canvas, context, device });   // handle exposes pause()/resume()/stop()
    } catch (err) {
      console.error(err);
      renderFallback(stage, { reason: String(err?.message || err), thumbnail: doodle.meta.thumbnail });
    }
  })();
</script>
```



The bootstrap stays \*\*inline per doodle\*\* (not a shared `lib/standalone.js`) so a doodle folder runs with zero shared assumptions beyond `lib/`. `loadWGSL` is defined here and passed into `ctx`; `import.meta.url` resolves WGSL against the doodle folder. A pause/play button (§10) is optional and wires to the `runLoop` handle.



\### 16.2 `group(0) binding(0)` belongs to the doodle (amends §8)



\*\*Decision: doodles own `group(0) binding(0)`; the runtime does not fill a `Globals` uniform.\*\* Filling a shared `Globals` would force a runtime-owned buffer into every pipeline's bind group, which collides with doodles building their own bind groups. So:



\- The runtime passes per-frame values to `frame({ t, dt, frameIndex })`. If a doodle wants them on the GPU, it declares \*\*its own\*\* uniform at `group(0) binding(0)` and writes them itself each frame.

\- The `Globals` struct in §8 is a \*\*recommended layout to copy\*\*, not something the runtime provides. A doodle that needs no globals (like 001, which uploads only an MVP matrix) just puts whatever it wants at that binding.

\- Doodles remain free to add more bind groups at `group(1)+`.



\### 16.3 Cold start / bootstrapping



The very first doodle in a fresh tree also brings up the minimum shared runtime it needs (`lib/support.js`, `lib/gpu.js`, `lib/loop.js`). Don't assume `lib/`, `_template/`, `gallery.js`, `manifest.json`, or `tools/` already exist — build the smallest slice the current doodle requires and leave the rest for later increments.



\### 16.4 Current state vs. target



\- \*\*Live-thumbnail gallery (§6) is the target, not the current build.\*\* The section landing (`src/webgl/index.html`) currently renders \*\*static\*\* cards (a gradient thumb + link) from `manifest.json`. The `IntersectionObserver` / concurrency-cap / reduced-quality live-canvas policy and `lib/gallery.js` are not built yet.

\- \*\*`tools/build-manifest.mjs` (§11 step 6) does not exist yet.\*\* `manifest.json` is hand-maintained until it does — add a `{ slug, path, title, description, tags, created, thumbnail }` entry per doodle.



\### 16.5 Filename



This file is \*\*`spec.md`\*\* (lowercase). References to `SPEC.md` in §3's tree and in the companion system prompt mean this same file; on case-sensitive hosts (Linux/CI) the casing matters, so prefer `spec.md`.
