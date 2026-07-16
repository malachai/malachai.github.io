// @ts-check
// Regenerate src/webgpu/manifest.json from the doodles' own metadata.
//
//   node src/webgpu/tools/build-manifest.mjs        (from anywhere — paths are
//                                                    resolved relative to this file)
//
// For each doodles/NNN-slug/ folder (skipping _template and anything not
// matching NNN-slug), this dynamically imports doodle.js and reads its
// `meta` — which is why the doodle contract requires module scope to be
// environment-free (spec.md §5). thumbnail is set to "thumb.png" if the file
// exists in the folder, else null. Output shape matches what the gallery
// index.html consumes.
//
// This is a static tool: it renders nothing and never touches a GPU.

import { readdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const WEBGPU_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOODLES_DIR = path.join(WEBGPU_ROOT, "doodles");
const OUT = path.join(WEBGPU_ROOT, "manifest.json");

const FOLDER_RE = /^\d{3}-[a-z0-9]+(-[a-z0-9]+)*$/;

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function run() {
  const entries = await readdir(DOODLES_DIR, { withFileTypes: true });
  const folders = entries
    .filter((e) => e.isDirectory() && FOLDER_RE.test(e.name))
    .map((e) => e.name)
    .sort();

  const doodles = [];
  for (const slug of folders) {
    const dir = path.join(DOODLES_DIR, slug);
    const modPath = path.join(dir, "doodle.js");
    if (!(await exists(modPath))) {
      console.warn(`! ${slug}: no doodle.js — skipped`);
      continue;
    }

    let meta;
    try {
      const mod = await import(pathToFileURL(modPath).href);
      meta = mod?.default?.meta;
    } catch (err) {
      console.warn(`! ${slug}: couldn't import doodle.js (${err.message}) — skipped.`);
      console.warn(`  Module scope must be environment-free (spec.md §5).`);
      continue;
    }
    if (!meta || !meta.title) {
      console.warn(`! ${slug}: default export has no meta.title — skipped`);
      continue;
    }

    const hasThumb = await exists(path.join(dir, "thumb.png"));
    doodles.push({
      slug,
      path: `doodles/${slug}/`,
      title: meta.title,
      description: meta.description || "",
      tags: meta.tags || [],
      created: meta.created || null,
      thumbnail: hasThumb ? "thumb.png" : null,
    });
    console.log(`✓ ${slug} — ${meta.title}${hasThumb ? "" : "  (no thumb.png)"}`);
  }

  const manifest = {
    generated: new Date().toISOString().slice(0, 10),
    doodles,
  };
  await writeFile(OUT, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`→ wrote ${path.relative(process.cwd(), OUT)} (${doodles.length} doodles)`);
}

run().catch((e) => {
  console.error("build-manifest failed:", e);
  process.exit(1);
});
