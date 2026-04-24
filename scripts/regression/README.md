# Regression harnesses

Dev-only scripts. Not run in CI. Not run from production. Use these
locally or on the VM when you want to directly compare v16 vs v17
crawl output on a single real APK.

Contents:

- **`v16-vs-v17-biztoso.js`** — runs biztoso under both engines back-to-back
  on the same emulator, dumps a side-by-side summary. Requires creds in
  `GOLDEN_TEST_EMAIL` / `GOLDEN_TEST_PASSWORD`.
- **`v16-vs-v17-wikipedia.js`** — same for Wikipedia (no auth needed).

Each script does its own emulator reset between runs via `pm clear +
am force-stop`.

Don't add new scripts here without a clear "dev harness" purpose —
CI-facing tooling lives in `scripts/` root. Nightly golden-suite runs
belong in `scripts/golden-suite-run.js`.
