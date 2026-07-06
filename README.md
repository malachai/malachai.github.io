# missingwires.com

Static, multi-project site for **missingwires.com**, deployed to GitHub Pages.
All optimization (JS minification) happens in **GitHub Actions** — nothing is
built on your machine. You commit readable source; CI publishes the minified
site.

```
missingwires.com/         →  src/index.html        (generated landing page)
missingwires.com/gt/      →  src/gt/                (GridText)
missingwires.com/tuner/   →  src/tuner/             (placeholder — your next project)
```

The folder layout under `src/` mirrors the URL structure: a folder named
`src/<slug>/` is served at `missingwires.com/<slug>/`.

## How it works

1. You push to `main`.
2. The workflow in `.github/workflows/deploy.yml` runs `npm run build`, which:
   - copies `src/` → `dist/`,
   - minifies **every `.js` file** in place with [terser](https://terser.org)
     (typically ~60% smaller; GitHub Pages then serves it gzip/brotli-compressed
     on top, so GridText goes out at ~145 KB / ~110 KB on the wire vs 1.16 MB raw),
   - generates the landing page (`dist/index.html`) from `src/projects.json`.
3. The workflow uploads `dist/` and deploys it to GitHub Pages.

You never run the build locally. If you want to preview it anyway, `npm run
build` then open `dist/`, or `npm run preview` for a local server.

## One-time setup (do this once)

1. Copy the contents of this folder into your website repo (the one whose Pages
   serves missingwires.com). Merge, don't clobber, if you already have files
   there — see notes below.
2. In the repo on GitHub: **Settings → Pages → Build and deployment → Source**,
   choose **GitHub Actions** (not "Deploy from a branch"). This is the only
   manual switch.
3. Confirm your custom domain (missingwires.com) is still set under
   Settings → Pages. A `CNAME` file (`src/CNAME`) is included and published so
   the domain sticks.
4. If your default branch isn't `main`, edit the `branches:` line in
   `.github/workflows/deploy.yml`.
5. Push. Watch the **Actions** tab; the deploy takes ~1 minute.

### Notes on merging with your existing site

- The landing page at `missingwires.com/` is now **generated** from
  `src/projects.json`. If you have an existing homepage you want to keep,
  either fold its content into the generator in `build/build.mjs`
  (`renderLanding`), or delete the landing generation and drop your own
  `src/index.html` (the build leaves any `src/index.html` you provide alone only
  if you also remove the generation step — otherwise it overwrites it).
- Any existing top-level pages/assets can live alongside these folders under
  `src/`; they'll be copied through untouched (and any `.js` among them minified).

## Adding a new project (e.g. `/tuner`)

1. Create `src/<slug>/index.html` plus whatever assets/JS the project needs.
   Any `.js` in that folder is minified automatically — write it readable.
2. Add an entry to `src/projects.json`:
   ```json
   { "slug": "tuner", "name": "Tuner", "description": "…", "status": "live" }
   ```
   Use `"status": "wip"` to show a greyed-out "soon" card that doesn't link yet.
3. Push. It appears at `missingwires.com/<slug>/` and on the landing page.

## About GridText specifically

`src/gt/gridtext.js` is the console-pasteable GridText source. On load it tears
down its host page and boots itself onto its own canvas, so `src/gt/index.html`
is just a stub that loads the script. **Keep the filename `gridtext.js`** — the
HTML references it, and CI minifies it in place under the same name. To ship a
new GridText build, replace `src/gt/gridtext.js` with the latest source and push.

## Minification safety

Terser is configured (`build/build.mjs`, `TERSER`) to mangle **local variables
only** — never object properties or strings — so GridText's capability lookups
(`kernel.use("…")`) and property access survive untouched. This build was
verified by booting the minified output in headless Chromium with zero console
errors. If you ever want to trade a little size for easier debugging, set
`mangle: false` in `build/build.mjs`.
