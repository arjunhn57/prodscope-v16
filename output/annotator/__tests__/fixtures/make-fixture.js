"use strict";

/**
 * Generate a tiny synthetic screenshot fixture for renderer tests.
 * Avoids checking a binary PNG into the repo. Tests call this on
 * demand — fixture is deterministic so test outputs stay stable.
 */

const { createCanvas } = require("@napi-rs/canvas");

/**
 * Build a 400x800 fake screenshot with three labeled "buttons" so the
 * element-mode renderer has known bounds to box. Buttons are filled
 * gray rects with text labels — visually distinct so a human can see
 * the annotation overlay correctly.
 *
 * @returns {{ buffer: Buffer, width: number, height: number, elements: Array<{bounds:[number,number,number,number], label:string}> }}
 */
function buildFixture() {
  const W = 400;
  const H = 800;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Background — pale slate.
  ctx.fillStyle = "#F1F5F9";
  ctx.fillRect(0, 0, W, H);

  // Title bar.
  ctx.fillStyle = "#0F172A";
  ctx.fillRect(0, 0, W, 60);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "600 18px Helvetica";
  ctx.textBaseline = "middle";
  ctx.fillText("ProdScope Demo", 16, 30);

  // Three buttons with known bounds.
  const elements = [
    { bounds: /** @type {[number,number,number,number]} */ ([40, 120, 360, 184]), label: "Sign in" },
    { bounds: /** @type {[number,number,number,number]} */ ([40, 220, 360, 284]), label: "Continue with Google" },
    { bounds: /** @type {[number,number,number,number]} */ ([130, 700, 270, 740]), label: "Skip" }, // small target
  ];

  for (const el of elements) {
    const [x1, y1, x2, y2] = el.bounds;
    ctx.fillStyle = "#CBD5E1";
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.fillStyle = "#0F172A";
    ctx.font = "500 14px Helvetica";
    ctx.textBaseline = "middle";
    ctx.fillText(el.label, x1 + 12, (y1 + y2) / 2);
  }

  return {
    buffer: canvas.toBuffer("image/png"),
    width: W,
    height: H,
    elements,
  };
}

module.exports = { buildFixture };
