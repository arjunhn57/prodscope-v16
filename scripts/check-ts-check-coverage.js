// @ts-check
"use strict";

/**
 * check-ts-check-coverage.js — Fail if any JS file under watched dirs imports
 * ./crawl-context without the `// @ts-check` pragma. Keeps the typed surface
 * from regressing when new files are added.
 */

const fs = require("fs");
const path = require("path");

const WATCHED_DIRS = ["crawler", "jobs"];
const REQUIRE_TAG = "// @ts-check";
const IMPORTS_CONTEXT = /require\(['"][^'"]*crawl-context['"]\)/;

/**
 * @param {string} dir
 * @param {string[]} out
 */
function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (/** @type {any} */ e) {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      walk(full, out);
    } else if (entry.name.endsWith(".js") && !entry.name.endsWith(".test.js")) {
      out.push(full);
    }
  }
}

/** @type {string[]} */
const files = [];
for (const dir of WATCHED_DIRS) walk(dir, files);

/** @type {string[]} */
const missing = [];
for (const file of files) {
  const contents = fs.readFileSync(file, "utf8");
  if (IMPORTS_CONTEXT.test(contents) && !contents.includes(REQUIRE_TAG)) {
    missing.push(file);
  }
}

if (missing.length > 0) {
  process.stderr.write("Files importing CrawlContext but missing // @ts-check:\n");
  for (const f of missing) process.stderr.write("  - " + f + "\n");
  process.exit(1);
}

process.stdout.write("ts-check coverage OK: " + files.length + " files scanned\n");
