"use strict";

/**
 * screenshot-fp.js — Perceptual hashing for screenshots.
 *
 * Computes an average-hash (aHash) from a PNG screenshot file.
 * Used when XML fingerprinting is unreliable (Compose/Flutter/RN).
 *
 * Algorithm:
 *   1. Read raw PNG pixel data (RGBA) via zlib decompression
 *   2. Downsample to 8x8 grid by averaging pixel blocks
 *   3. Convert to grayscale
 *   4. Threshold at mean brightness → 64-bit hash
 *
 * No native dependencies — uses only Node built-ins (fs, zlib, crypto).
 */

const fs = require("fs");
const zlib = require("zlib");
const crypto = require("crypto");

/**
 * Parse a PNG file and extract raw RGBA pixel data.
 * Handles standard non-interlaced PNGs (which is what adb screencap produces).
 *
 * @param {string} filePath
 * @returns {{ width: number, height: number, pixels: Buffer }|null}
 */
function readPngPixels(filePath) {
  try {
    const buf = fs.readFileSync(filePath);

    // Validate PNG signature
    if (buf.length < 8 || buf.toString("hex", 0, 8) !== "89504e470d0a1a0a") {
      return null;
    }

    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    const idatChunks = [];

    let offset = 8;
    while (offset < buf.length) {
      const chunkLen = buf.readUInt32BE(offset);
      const chunkType = buf.toString("ascii", offset + 4, offset + 8);

      if (chunkType === "IHDR") {
        width = buf.readUInt32BE(offset + 8);
        height = buf.readUInt32BE(offset + 12);
        bitDepth = buf[offset + 16];
        colorType = buf[offset + 17];
      } else if (chunkType === "IDAT") {
        idatChunks.push(buf.slice(offset + 8, offset + 8 + chunkLen));
      } else if (chunkType === "IEND") {
        break;
      }

      offset += 12 + chunkLen; // 4 len + 4 type + data + 4 crc
    }

    if (width === 0 || height === 0 || idatChunks.length === 0) return null;
    if (bitDepth !== 8) return null; // Only handle 8-bit

    const bytesPerPixel = colorType === 6 ? 4 : colorType === 2 ? 3 : 1; // RGBA=4, RGB=3, Gray=1
    const compressed = Buffer.concat(idatChunks);
    const raw = zlib.inflateSync(compressed);

    // PNG rows have a 1-byte filter prefix per row
    const rowBytes = width * bytesPerPixel + 1;
    const pixels = Buffer.alloc(width * height * bytesPerPixel);

    // Simple de-filter: handle filter type 0 (None) and 1 (Sub) and 2 (Up)
    // For perceptual hashing we don't need perfect reconstruction — approximate is fine
    const prevRow = Buffer.alloc(width * bytesPerPixel);
    for (let y = 0; y < height; y++) {
      const rowStart = y * rowBytes;
      if (rowStart >= raw.length) break;
      const filterType = raw[rowStart];
      const srcOffset = rowStart + 1;

      for (let x = 0; x < width * bytesPerPixel; x++) {
        const srcIdx = srcOffset + x;
        if (srcIdx >= raw.length) break;
        let val = raw[srcIdx];

        if (filterType === 1) {
          // Sub: add left pixel
          const left = x >= bytesPerPixel ? pixels[y * width * bytesPerPixel + x - bytesPerPixel] : 0;
          val = (val + left) & 0xff;
        } else if (filterType === 2) {
          // Up: add pixel above
          val = (val + prevRow[x]) & 0xff;
        } else if (filterType === 3) {
          // Average: floor((left + above) / 2)
          const left = x >= bytesPerPixel ? pixels[y * width * bytesPerPixel + x - bytesPerPixel] : 0;
          val = (val + Math.floor((left + prevRow[x]) / 2)) & 0xff;
        } else if (filterType === 4) {
          // Paeth
          const left = x >= bytesPerPixel ? pixels[y * width * bytesPerPixel + x - bytesPerPixel] : 0;
          const above = prevRow[x];
          const upperLeft = x >= bytesPerPixel ? prevRow[x - bytesPerPixel] : 0;
          val = (val + paethPredictor(left, above, upperLeft)) & 0xff;
        }
        // filterType 0: no change

        pixels[y * width * bytesPerPixel + x] = val;
      }

      // Copy current row to prevRow for next iteration
      pixels.copy(prevRow, 0, y * width * bytesPerPixel, (y + 1) * width * bytesPerPixel);
    }

    return { width, height, bytesPerPixel, pixels };
  } catch (e) {
    return null;
  }
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Compute a perceptual hash (aHash) from a screenshot PNG file.
 *
 * @param {string} screenshotPath - Path to PNG file
 * @returns {string} 16-char hex hash, or 'no_screenshot' on failure
 */
function computeHash(screenshotPath) {
  const img = readPngPixels(screenshotPath);
  if (!img) return "no_screenshot";

  const { width, height, bytesPerPixel, pixels } = img;
  const GRID = 8;
  const blockW = Math.floor(width / GRID);
  const blockH = Math.floor(height / GRID);

  // Downsample to 8x8 grid of average grayscale values
  const grid = new Float64Array(GRID * GRID);

  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      let sum = 0;
      let count = 0;
      const startY = gy * blockH;
      const startX = gx * blockW;

      // Sample every 4th pixel for speed (still accurate enough for 8x8)
      const stepY = Math.max(1, Math.floor(blockH / 8));
      const stepX = Math.max(1, Math.floor(blockW / 8));

      for (let y = startY; y < startY + blockH; y += stepY) {
        for (let x = startX; x < startX + blockW; x += stepX) {
          const idx = (y * width + x) * bytesPerPixel;
          if (idx + 2 < pixels.length) {
            // Luminance: 0.299*R + 0.587*G + 0.114*B
            const gray = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
            sum += gray;
            count++;
          }
        }
      }

      grid[gy * GRID + gx] = count > 0 ? sum / count : 0;
    }
  }

  // Threshold at mean brightness → 64-bit hash
  let mean = 0;
  for (let i = 0; i < 64; i++) mean += grid[i];
  mean /= 64;

  // Build 64-bit hash as 8 bytes
  const hashBytes = Buffer.alloc(8);
  for (let i = 0; i < 64; i++) {
    if (grid[i] >= mean) {
      hashBytes[Math.floor(i / 8)] |= (1 << (7 - (i % 8)));
    }
  }

  return hashBytes.toString("hex"); // 16-char hex string
}

/**
 * Compute a byte-exact MD5 hash of a PNG file. Used for state-graph
 * fingerprinting in vision-first mode, where the coarse 64-bit aHash
 * collapses too many visually distinct Compose/RN screens into a single
 * bucket (seen in practice: 7 distinct Biztoso screens all mapping to the
 * same aHash during a login-flow crawl).
 *
 * Soft-revisit detection still uses the perceptual aHash above, so minor
 * animation frames that do leak into different exact hashes get absorbed
 * there instead of polluting the state graph.
 *
 * @param {string} screenshotPath
 * @returns {string} 12-char prefix of the MD5 hex, or 'no_screenshot' on failure
 */
function computeExactHash(screenshotPath) {
  try {
    const buf = fs.readFileSync(screenshotPath);
    return crypto.createHash("md5").update(buf).digest("hex").slice(0, 12);
  } catch (e) {
    return "no_screenshot";
  }
}

/**
 * Compute hamming distance between two screenshot hashes.
 * @param {string} hash1 - 16-char hex string
 * @param {string} hash2 - 16-char hex string
 * @returns {number} 0 (identical) to 64 (completely different)
 */
function hammingDistance(hash1, hash2) {
  if (!hash1 || !hash2 || hash1.length !== 16 || hash2.length !== 16) return 64;
  const buf1 = Buffer.from(hash1, "hex");
  const buf2 = Buffer.from(hash2, "hex");
  let dist = 0;
  for (let i = 0; i < 8; i++) {
    let xor = buf1[i] ^ buf2[i];
    while (xor) {
      dist += xor & 1;
      xor >>= 1;
    }
  }
  return dist;
}

/**
 * Are two screenshots "same screen" based on perceptual hash?
 * @param {string} hash1
 * @param {string} hash2
 * @param {number} [threshold=10] - Max hamming distance for "same screen"
 * @returns {boolean}
 */
function isSameScreen(hash1, hash2, threshold = 10) {
  return hammingDistance(hash1, hash2) <= threshold;
}

module.exports = { computeHash, computeExactHash, hammingDistance, isSameScreen };
