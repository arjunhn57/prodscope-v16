"use strict";

/**
 * output/annotator/zoom.js — companion zoom crop for an annotation.
 *
 * Given a screenshot + a single annotation, emit a 200% crop centered
 * on the annotation's bounds. Solves the "small-touch-target on a
 * 6.1-inch device" readability problem — the report renders the zoom
 * inline with a "see in context" link to the full screen.
 *
 * Output is a buffer; caller decides where to write it (annotator
 * doesn't know about job dirs).
 */

const { createCanvas, loadImage } = require("@napi-rs/canvas");
const fs = require("fs");
const { CROP, STROKE, BADGE, CAPTION, strokeStyleFor } = require("./style");

/**
 * Produce a zoomed crop centered on a finding's bounds.
 *
 * @param {object} params
 * @param {string|Buffer} params.image            Screenshot path or buffer.
 * @param {object} params.annotations             Validated screen annotations.
 * @param {number} params.findingIndex            Index into annotations.findings[].
 * @param {number} [params.zoomFactor]            Override default 2.0.
 * @param {number} [params.padding]               Px padding around bounds (default 32).
 * @returns {Promise<{ok:true, buffer:Buffer, width:number, height:number} | {ok:false, errors:string[]}>}
 */
async function renderZoom({ image, annotations, findingIndex, zoomFactor, padding }) {
  if (!annotations || !Array.isArray(annotations.findings)) {
    return { ok: false, errors: ["annotations missing findings array"] };
  }
  const finding = annotations.findings[findingIndex];
  if (!finding) {
    return {
      ok: false,
      errors: [`findingIndex ${findingIndex} out of range`],
    };
  }
  if (finding.annotation.mode === "whole_screen") {
    return {
      ok: false,
      errors: ["cannot zoom into whole_screen mode — no bounds to center on"],
    };
  }

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

  const W = img.width;
  const H = img.height;
  const sx = W / annotations.width;
  const sy = H / annotations.height;
  const pad = typeof padding === "number" ? padding : 32;
  const zf = typeof zoomFactor === "number" ? zoomFactor : CROP.zoomFactor;

  // Resolve bounds to canvas pixel space.
  let bx, by, bw, bh;
  if (finding.annotation.mode === "element") {
    const el = annotations.elements[finding.annotation.elementIndex];
    if (!el) {
      return {
        ok: false,
        errors: [`elementIndex ${finding.annotation.elementIndex} out of range`],
      };
    }
    const [x1, y1, x2, y2] = el.bounds;
    bx = x1 * sx;
    by = y1 * sy;
    bw = (x2 - x1) * sx;
    bh = (y2 - y1) * sy;
  } else {
    // mode === "region"
    const b = finding.annotation.bounds;
    bx = b.x1 * W;
    by = b.y1 * H;
    bw = (b.x2 - b.x1) * W;
    bh = (b.y2 - b.y1) * H;
  }

  // Crop region with padding, clamped to image bounds.
  const cx1 = Math.max(0, Math.floor(bx - pad));
  const cy1 = Math.max(0, Math.floor(by - pad));
  const cx2 = Math.min(W, Math.ceil(bx + bw + pad));
  const cy2 = Math.min(H, Math.ceil(by + bh + pad));
  const cropW = cx2 - cx1;
  const cropH = cy2 - cy1;
  if (cropW <= 0 || cropH <= 0) {
    return { ok: false, errors: ["crop region has zero or negative area"] };
  }

  const outW = Math.round(cropW * zf);
  const outH = Math.round(cropH * zf);
  const canvas = createCanvas(outW, outH);
  const ctx = canvas.getContext("2d");

  // Resampling: drawImage with explicit destination size handles upscaling.
  ctx.drawImage(img, cx1, cy1, cropW, cropH, 0, 0, outW, outH);

  // Draw the box on the zoom too — same accent + halo + dash rules,
  // scaled by zoom factor so stroke weight feels consistent across
  // full + zoom views.
  const stroke = strokeStyleFor({
    severity: finding.severity,
    confidence: finding.confidence,
  });
  const dashed = finding.annotation.mode === "region";
  // Box position in zoom coords.
  const zbx = (bx - cx1) * zf;
  const zby = (by - cy1) * zf;
  const zbw = bw * zf;
  const zbh = bh * zf;

  // Halo.
  ctx.save();
  ctx.globalAlpha = stroke.haloAlpha;
  ctx.strokeStyle = stroke.haloColor;
  ctx.lineWidth = stroke.haloPx + (dashed ? STROKE.regionPx : STROKE.elementPx);
  ctx.strokeRect(zbx, zby, zbw, zbh);
  ctx.restore();

  // Main stroke.
  ctx.save();
  ctx.strokeStyle = stroke.strokeColor;
  ctx.lineWidth = (dashed ? STROKE.regionPx : STROKE.elementPx) * (zf > 1 ? Math.min(zf, 2) : 1);
  if (dashed) ctx.setLineDash(STROKE.regionDash);
  ctx.strokeRect(zbx, zby, zbw, zbh);
  ctx.restore();

  // Crop frame around the whole zoom — accent color, thicker stroke.
  ctx.save();
  ctx.strokeStyle = CROP.frameColor;
  ctx.lineWidth = CROP.framePx;
  ctx.strokeRect(0, 0, outW, outH);
  ctx.restore();

  // Numbered badge in the top-left corner (find original index +1).
  const badgeNumber = findingIndex + 1;
  drawBadge(ctx, BADGE.radius + 6, BADGE.radius + 6, badgeNumber);

  const buffer = canvas.toBuffer("image/png");
  return { ok: true, buffer, width: outW, height: outH };
}

function drawBadge(ctx, cx, cy, number) {
  const r = BADGE.radius;
  ctx.save();
  ctx.fillStyle = BADGE.ringColor;
  ctx.beginPath();
  ctx.arc(cx, cy, r + BADGE.ringPx, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = BADGE.fillColor;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = BADGE.textColor;
  ctx.font = `${BADGE.fontWeight} ${BADGE.fontSize}px ${CAPTION.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(number), cx, cy + 1);
  ctx.restore();
}

module.exports = { renderZoom };
