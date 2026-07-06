// Build step for missingwires.com.
//
// Runs in GitHub Actions (never on your local machine): copies src/ -> dist/,
// minifies every .js in place with terser, then generates the landing page from
// src/projects.json. The published site is dist/.
//
//   node build/build.mjs
//
// Add a project: create src/<slug>/index.html (+ its assets) and add an entry to
// src/projects.json. That's it — the folder becomes missingwires.com/<slug>/ and
// a card shows up on the landing page.

import { readFile, writeFile, rm, cp, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { minify } from "terser";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");

const kb = (n) => (n / 1024).toFixed(1) + " KB";
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

// Terser options. mangle:true renames local variables only (never object
// properties), so string capabilities like kernel.use("grid-surface") and
// property access like NS.register are untouched. compress passes:2 for size.
// Deliberately NOT enabling toplevel/property mangling — safe, still a big win.
const TERSER = {
  compress: { passes: 2, drop_debugger: true },
  mangle: true,
  format: { comments: false },
};

async function run() {
  console.log("• clean dist/");
  await rm(DIST, { recursive: true, force: true });

  console.log("• copy src/ -> dist/");
  await cp(SRC, DIST, { recursive: true });

  // projects.json drives the landing page; it isn't served itself.
  const manifestPath = path.join(DIST, "projects.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await rm(manifestPath, { force: true });

  console.log("• minify JavaScript");
  let totalIn = 0,
    totalOut = 0;
  for (const file of await walk(DIST)) {
    if (!file.endsWith(".js")) continue;
    const code = await readFile(file, "utf8");
    const res = await minify(code, TERSER);
    if (res.error) throw res.error;
    const inB = Buffer.byteLength(code);
    const outB = Buffer.byteLength(res.code);
    totalIn += inB;
    totalOut += outB;
    await writeFile(file, res.code);
    console.log(`    ${path.relative(DIST, file)}  ${kb(inB)} -> ${kb(outB)}  (${Math.round((1 - outB / inB) * 100)}% smaller)`);
  }
  if (totalIn) console.log(`  total JS: ${kb(totalIn)} -> ${kb(totalOut)}`);

  console.log("• generate landing page");
  await writeFile(path.join(DIST, "index.html"), renderLanding(manifest));

  // Belt-and-suspenders: served as static files, no Jekyll.
  await writeFile(path.join(DIST, ".nojekyll"), "");

  console.log("✓ build complete -> dist/");
}

function renderLanding({ site = {}, projects = [] }) {
  const cards = projects
    .map((p) => {
      const live = p.status !== "wip";
      const badge = live ? "" : `<span class="badge">soon</span>`;
      const inner = `
        <div class="card-head"><h2>${esc(p.name)}</h2>${badge}</div>
        <p>${esc(p.description || "")}</p>
        <span class="path">/${esc(p.slug)}</span>`;
      return live
        ? `<a class="card" href="/${esc(p.slug)}/">${inner}</a>`
        : `<div class="card card--wip">${inner}</div>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(site.title || "missingwires")}</title>
<meta name="description" content="${esc(site.tagline || "")}">
<link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%3E%3Crect%20width='32'%20height='32'%20rx='6'%20fill='%23282c34'/%3E%3Ctext%20x='16'%20y='23'%20font-family='monospace'%20font-size='18'%20font-weight='bold'%20text-anchor='middle'%20fill='%2356b6c2'%3Emw%3C/text%3E%3C/svg%3E">
<style>
  :root{
    --bg:#21252b; --panel:#282c34; --line:#3a404b;
    --fg:#abb2bf; --fg-strong:#e6e6e6; --muted:#7f8896; --accent:#56b6c2;
  }
  *{box-sizing:border-box}
  html,body{margin:0}
  body{
    background:var(--bg); color:var(--fg);
    font:16px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    -webkit-font-smoothing:antialiased;
    min-height:100vh; display:flex; flex-direction:column; align-items:center;
    padding:9vh 24px 6vh;
  }
  header{max-width:760px; width:100%; margin-bottom:2.5rem}
  h1{margin:0; font-size:1.9rem; color:var(--fg-strong); letter-spacing:-.01em}
  h1 .dot{color:var(--accent)}
  .tagline{margin:.5rem 0 0; color:var(--muted)}
  main{max-width:760px; width:100%; display:grid; gap:16px}
  .card{
    display:block; text-decoration:none; color:inherit;
    background:var(--panel); border:1px solid var(--line); border-radius:12px;
    padding:20px 22px; transition:border-color .15s ease, transform .15s ease;
  }
  a.card:hover{border-color:var(--accent); transform:translateY(-2px)}
  .card--wip{opacity:.62}
  .card-head{display:flex; align-items:center; gap:10px}
  .card h2{margin:0; font-size:1.15rem; color:var(--fg-strong)}
  .card p{margin:.5rem 0 .75rem; color:var(--fg)}
  .path{font-size:.85rem; color:var(--accent)}
  .card--wip .path{color:var(--muted)}
  .badge{
    font-size:.68rem; text-transform:uppercase; letter-spacing:.06em;
    color:var(--bg); background:var(--muted); border-radius:999px; padding:2px 8px;
  }
  footer{max-width:760px; width:100%; margin-top:auto; padding-top:3rem; color:var(--muted); font-size:.82rem}
  footer a{color:var(--muted)}
</style>
</head>
<body>
  <header>
    <h1>${esc(site.title || "missingwires")}<span class="dot">.</span></h1>
    <p class="tagline">${esc(site.tagline || "")}</p>
  </header>
  <main>
${cards}
  </main>
  <footer>.</footer>
</body>
</html>
`;
}

run().catch((e) => {
  console.error("build failed:", e);
  process.exit(1);
});
