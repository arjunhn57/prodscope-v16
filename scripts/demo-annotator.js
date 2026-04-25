#!/usr/bin/env node
"use strict";

/**
 * scripts/demo-annotator.js — render a sample annotated screenshot to disk
 * so we can eyeball the visual grammar without booting the full report.
 *
 * Usage:
 *   node scripts/demo-annotator.js                   # writes /tmp/annotator-demo.png + zoom
 *   node scripts/demo-annotator.js --out ./out.png   # custom output
 */

const fs = require("fs");
const path = require("path");
const { renderAnnotated, renderZoom } = require("../output/annotator");
const { buildFixture } = require("../output/annotator/__tests__/fixtures/make-fixture");

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { full: "/tmp/annotator-demo.png", zoom: "/tmp/annotator-demo-zoom.png" };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && args[i + 1]) {
      out.full = args[i + 1];
      out.zoom = args[i + 1].replace(/(\.png)?$/i, "-zoom.png");
      i += 1;
    }
  }
  return out;
}

async function main() {
  const out = parseArgs();
  const fixture = buildFixture();

  const annotations = {
    screenId: "screen_4",
    width: fixture.width,
    height: fixture.height,
    elements: fixture.elements,
    findings: [
      {
        screenId: "screen_4",
        finding: "Sign-in CTA dominates the fold before any value is delivered to first-time users.",
        severity: "concern",
        confidence: "observed",
        annotation: { mode: "element", elementIndex: 0, callout: "Above the fold" },
      },
      {
        screenId: "screen_4",
        finding: "Skip affordance is below platform 44dp tap-target — accessibility risk.",
        severity: "watch_item",
        confidence: "observed",
        annotation: { mode: "element", elementIndex: 2, callout: "Tiny target" },
      },
      {
        screenId: "screen_4",
        finding: "First-screen onboarding fronts 12 lines of legal copy ahead of the first interaction.",
        severity: "watch_item",
        confidence: "inferred",
        annotation: { mode: "whole_screen", callout: "Legal-copy heavy on first screen" },
      },
    ],
  };

  const fullR = await renderAnnotated({ image: fixture.buffer, annotations });
  if (!fullR.ok) {
    console.error("renderAnnotated failed:", fullR.errors);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(out.full), { recursive: true });
  fs.writeFileSync(out.full, fullR.buffer);
  console.log(`Wrote ${out.full} — ${fullR.width}x${fullR.height} — ${fullR.buffer.length} bytes`);

  const zoomR = await renderZoom({ image: fixture.buffer, annotations, findingIndex: 1 });
  if (!zoomR.ok) {
    console.error("renderZoom failed:", zoomR.errors);
    process.exit(1);
  }
  fs.writeFileSync(out.zoom, zoomR.buffer);
  console.log(`Wrote ${out.zoom} — ${zoomR.width}x${zoomR.height} — ${zoomR.buffer.length} bytes`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
