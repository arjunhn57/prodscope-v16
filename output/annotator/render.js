"use strict";

/**
 * output/annotator/render.js — annotated screenshot renderer.
 *
 * Given a screenshot image (path or buffer) + validated annotations.json,
 * returns a PNG buffer with the annotation grammar drawn on top:
 *
 *   - mode=element: solid box around classifier-known clickable bounds,
 *                   numbered badge at the top-left of the box
 *   - mode=region:  dashed box around free-form region, badge same way
 *   - mode=whole_screen: caption strip docked at bottom of frame, no box
 *
 * Severity is encoded as halo intensity around the box (concern loudest,
 * strength quietest, with a green halo for strength). Confidence is
 * encoded as halo width (observed thickest, hypothesis thinnest). The
 * stroke color stays brand-accent magenta on every box so the visual
 * read stays consistent.
 *
 * No text wrapping logic for callouts — schema caps callouts at 40
 * chars. If the caller wants long captions, render them in the sidebar
 * panel (separate function).
 */

const { createCanvas, loadImage } = require("@napi-rs/canvas");
const fs = require("fs");
const {
  STROKE,
  BADGE,
  CAPTION,
  strokeStyleFor,
} = require("./style");
const { validateScreenAnnotations } = require("./schema");

/**
 * Render an annotated screenshot.
 *
 * @param {object} params
 * @param {string|Buffer} params.image      Screenshot path or buffer.
 * @param {object} params.annotations       annotations.json (will be re-validated).
 * @returns {Promise<{ok:true, buffer:Buffer, width:number, height:number} | {ok:false, errors:string[]}>}
 */
async function renderAnnotated({ image, annotations }) {
  // Re-validate at the renderer boundary — callers might pass raw
  // model output. Same contract as the model-side validator.
  const v = validateScreenAnnotations(annotations);
  if (!v.ok) return { ok: false, errors: v.errors };
  const a = v.annotations;

  // Load image (path or buffer). loadImage accepts both.
  let imgInput;
  if (typeof image === "string") {
    if (!fs.existsSync(image)) {
      return { ok: false, errors: [`image not found: ${image}`] };
    }
    imgInput = image;
  } else if (Buffer.isBuffer(image)) {
    imgInput = image;
  } else {
    return { ok: false, errors: ["image must be a path or Buffer"] };
  }

  let img;
  try {
    img = await loadImage(imgInput);
  } catch (err) {
    return {
      ok: false,
      errors: [`loadImage failed: ${err && err.message ? err.message : String(err)}`],
    };
  }

  // Use the image's actual dimensions, but scale element bounds against
  // the annotation's declared (capture-time) dimensions. If they match
  // — common case — scale is 1.
  const W = img.width;
  const H = img.height;
  const sx = W / a.width;
  const sy = H / a.height;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, W, H);

  // Draw annotations in order so badges 1..N read top-to-bottom in
  // sidebar order.
  const wholeScreenCaptions = [];
  for (let i = 0; i < a.findings.length; i++) {
    const finding = a.findings[i];
    const badgeNumber = i + 1;
    const stroke = strokeStyleFor({
      severity: finding.severity,
      confidence: finding.confidence,
    });

    if (finding.annotation.mode === "element") {
      const el = a.elements[finding.annotation.elementIndex];
      const [x1, y1, x2, y2] = el.bounds;
      drawBox(ctx, {
        x: x1 * sx,
        y: y1 * sy,
        w: (x2 - x1) * sx,
        h: (y2 - y1) * sy,
        stroke,
        dashed: false,
      });
      drawBadge(ctx, x1 * sx, y1 * sy, badgeNumber);
    } else if (finding.annotation.mode === "region") {
      const b = finding.annotation.bounds;
      const x = b.x1 * W;
      const y = b.y1 * H;
      const w = (b.x2 - b.x1) * W;
      const h = (b.y2 - b.y1) * H;
      drawBox(ctx, { x, y, w, h, stroke, dashed: true });
      drawBadge(ctx, x, y, badgeNumber);
    } else if (finding.annotation.mode === "whole_screen") {
      wholeScreenCaptions.push({
        number: badgeNumber,
        text: finding.annotation.callout,
      });
    }
  }

  // Whole-screen captions render as a strip at the bottom of the frame.
  if (wholeScreenCaptions.length > 0) {
    drawCaptionStrip(ctx, wholeScreenCaptions, W, H);
  }

  const buffer = canvas.toBuffer("image/png");
  return { ok: true, buffer, width: W, height: H };
}

/**
 * Draw a box with halo + main stroke. Box position + size in canvas
 * pixels. Halo is drawn first (under the stroke).
 */
function drawBox(ctx, { x, y, w, h, stroke, dashed }) {
  // Halo — wider stroke, low alpha, drawn first.
  ctx.save();
  ctx.globalAlpha = stroke.haloAlpha;
  ctx.strokeStyle = stroke.haloColor;
  ctx.lineWidth = stroke.haloPx + (dashed ? STROKE.regionPx : STROKE.elementPx);
  ctx.lineJoin = "round";
  ctx.strokeRect(x, y, w, h);
  ctx.restore();

  // Main stroke.
  ctx.save();
  ctx.strokeStyle = stroke.strokeColor;
  ctx.lineWidth = dashed ? STROKE.regionPx : STROKE.elementPx;
  if (dashed) ctx.setLineDash(STROKE.regionDash);
  ctx.lineJoin = "miter";
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

/**
 * Draw a numbered badge at (anchorX, anchorY). Badge is positioned so
 * its center sits at the top-left corner of the box, half outside —
 * keeps the inside of the box clear for the reader.
 */
function drawBadge(ctx, anchorX, anchorY, number) {
  const r = BADGE.radius;
  const cx = anchorX;
  const cy = anchorY;

  ctx.save();
  // Outer white ring — keeps the badge legible on busy backgrounds.
  ctx.fillStyle = BADGE.ringColor;
  ctx.beginPath();
  ctx.arc(cx, cy, r + BADGE.ringPx, 0, Math.PI * 2);
  ctx.fill();

  // Filled circle.
  ctx.fillStyle = BADGE.fillColor;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Number.
  ctx.fillStyle = BADGE.textColor;
  ctx.font = `${BADGE.fontWeight} ${BADGE.fontSize}px ${CAPTION.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(number), cx, cy + 1); // +1 visual nudge for optical centering
  ctx.restore();
}

/**
 * Draw the whole-screen caption strip docked at the bottom of the frame.
 * Captions stack vertically — small N (≤ 8) so no scroll needed.
 */
function drawCaptionStrip(ctx, captions, W, H) {
  const padX = CAPTION.paddingX;
  const padY = CAPTION.paddingY;
  const lineH = CAPTION.fontSize + 6;
  const stripH = padY * 2 + captions.length * lineH;
  const stripY = H - stripH;

  ctx.save();
  ctx.fillStyle = CAPTION.bgColor;
  ctx.fillRect(0, stripY, W, stripH);

  ctx.fillStyle = CAPTION.textColor;
  ctx.font = `500 ${CAPTION.fontSize}px ${CAPTION.fontFamily}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (let i = 0; i < captions.length; i++) {
    const c = captions[i];
    const text = `(${c.number}) ${c.text}`;
    ctx.fillText(text, padX, stripY + padY + i * lineH);
  }
  ctx.restore();
}

module.exports = {
  renderAnnotated,
};
