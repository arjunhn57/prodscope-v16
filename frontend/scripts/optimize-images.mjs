#!/usr/bin/env node
// Generate AVIF + WebP siblings for every PNG in public/.
// Pre-build step — run once, commit the output.

import sharp from "sharp";
import { readdir, stat } from "node:fs/promises";
import { join, extname, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..", "public");

const TARGETS = [
  { dir: "app-icons", resize: 128, avifQ: 50, webpQ: 75 },
  { dir: "mockup-screens", resize: null, avifQ: 55, webpQ: 80 },
];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    const info = await stat(full);
    if (info.isFile() && extname(entry).toLowerCase() === ".png") {
      out.push(full);
    }
  }
  return out;
}

async function convert(file, { resize, avifQ, webpQ }) {
  const base = join(dirname(file), basename(file, ".png"));
  const pipeline = sharp(file).rotate();
  const input = resize
    ? pipeline.clone().resize({ width: resize, withoutEnlargement: true })
    : pipeline.clone();

  const [avifInfo, webpInfo, origInfo] = await Promise.all([
    input.clone().avif({ quality: avifQ, effort: 6 }).toFile(`${base}.avif`),
    input.clone().webp({ quality: webpQ, effort: 6 }).toFile(`${base}.webp`),
    stat(file).then((s) => ({ size: s.size })),
  ]);

  return {
    file: file.replace(ROOT + "\\", "").replace(ROOT + "/", ""),
    png: origInfo.size,
    webp: webpInfo.size,
    avif: avifInfo.size,
    saved: origInfo.size - avifInfo.size,
  };
}

async function main() {
  let totalPng = 0;
  let totalAvif = 0;
  let totalWebp = 0;

  for (const { dir, ...opts } of TARGETS) {
    const full = join(ROOT, dir);
    const files = await walk(full);
    console.log(`\n${dir} (${files.length} files):`);
    for (const file of files) {
      const r = await convert(file, opts);
      totalPng += r.png;
      totalAvif += r.avif;
      totalWebp += r.webp;
      const pct = ((1 - r.avif / r.png) * 100).toFixed(0);
      console.log(
        `  ${r.file.padEnd(36)}  png=${String(r.png).padStart(6)}  webp=${String(r.webp).padStart(6)}  avif=${String(r.avif).padStart(6)}  (-${pct}%)`
      );
    }
  }

  const kb = (n) => (n / 1024).toFixed(1) + " KB";
  console.log(
    `\nTotal: PNG=${kb(totalPng)}  WebP=${kb(totalWebp)}  AVIF=${kb(totalAvif)}  — AVIF saves ${kb(totalPng - totalAvif)} (${((1 - totalAvif / totalPng) * 100).toFixed(0)}%)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
