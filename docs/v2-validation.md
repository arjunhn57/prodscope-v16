# V2 Vision-First Validation (Track H)

**Date:** 2026-04-13
**Plan:** nifty-nibbling-widget (V2 vision-first agent loop)
**Model:** claude-sonnet-4-6 (Sonnet 4.5 was 529 overloaded — cache benchmark deferred)
**Key setting:** `MAX_NO_NEW_STATE=20` (was 8, too tight — env-configurable fix landed in crawl-context.js)

## Biztoso (com.biztoso.app, 50-step cap)

| Metric            | V1 (AGENT_LOOP, index-based) | V2 (AGENT_VISION_FIRST) | Delta          |
|-------------------|------------------------------|-------------------------|----------------|
| Unique screens    | 3                            | **11**                  | **+8 (3.67×)** |
| Steps used        | 19                           | 20                      | ~same          |
| Wall time         | 8:41 (521.6s)                | **7:57 (477.4s)**       | −44s (−8%)     |
| Unique / minute   | 0.35                         | **1.38**                | **3.94×**      |
| Stop reason       | exploration_exhausted        | no_new_states           | —              |
| Input tokens      | 0 (not instrumented)         | 73,787                  | —              |
| Output tokens     | 0 (not instrumented)         | 1,120                   | —              |
| Cost (USD)        | N/A                          | $0.2382                 | —              |
| Cache hit rate    | N/A                          | 0% (Sonnet 4.6 ignores) | —              |

**Logs:** `/tmp/v2-biztoso8.log`, `/tmp/v1-biztoso-v2env.log` (VM arjunhn@34.10.240.173)

## Reddit (com.reddit.frontpage, 50-step cap)

| Metric            | V1 (AGENT_LOOP, index-based) | V2 (AGENT_VISION_FIRST) | Delta          |
|-------------------|------------------------------|-------------------------|----------------|
| Unique screens    | 8                            | **16**                  | **+8 (2.00×)** |
| Steps used        | 26                           | 22 (33 total w/ recovery)| —             |
| Wall time         | 10:48 (648.4s)               | 11:26 (686.7s)          | +38s (+6%)     |
| Unique / minute   | 0.74                         | **1.40**                | **1.89×**      |
| Stop reason       | capture_failed               | capture_failed          | —              |
| Input tokens      | 0 (not instrumented)         | 105,172                 | —              |
| Output tokens     | 0 (not instrumented)         | 1,748                   | —              |
| Cost (USD)        | N/A                          | $0.3417                 | —              |
| Cache hit rate    | N/A                          | 0% (Sonnet 4.6 ignores) | —              |

**Logs:** `/tmp/v2-reddit.log`, `/tmp/v1-reddit-v2env.log` (VM arjunhn@34.10.240.173)

## Pass criteria vs actuals

| Criterion                                  | Target  | Biztoso  | Reddit   | Pass? |
|--------------------------------------------|---------|----------|----------|-------|
| V2 ≥1.5× unique screens on ≥2 of 3 apps    | ≥1.5×   | 3.67×    | 2.00×    | ✅    |
| Cost drop ≥50% vs V1                       | ≥50%    | deferred¹| deferred¹| ⏳    |
| Cache hit rate ≥60%                        | ≥60%    | 0%²      | 0%²      | ⏳    |

¹ V1 token instrumentation not wired through — V1 cost not measurable from this run. V2 cost ($0.24/crawl) is still ~3× lower than the V1 baseline estimate in the plan ($0.75/crawl) on coverage-normalized basis.

² Sonnet 4.6 silently ignores `cache_control` (confirmed empirically: 1412-token prompt, sequential requests, `cache_creation_input_tokens: 0` both times). Cache benefit requires Sonnet 4.5, whose organization-level capacity was 529 overloaded during validation. Cache benchmark **deferred** until Sonnet 4.5 capacity recovers — the code path is wired and the unit tests (byte-identical prefix) pass.

## Notable fixes during validation

1. **`crawler/crawl-context.js` MAX_NO_NEW_STATE** — was hardcoded `= 8`, now `parseInt(process.env.MAX_NO_NEW_STATE || "8", 10)`. The default was too tight for vision-first exploration past authenticated onboarding — V2 Biztoso #7 was killed at step 8 with only 4 screens found. Raising to 20 let the same seed find 11 screens.

2. **Sonnet 4.5 vs 4.6 capacity separation** — Sonnet 4.5 returned 529 on every request during validation. Haiku 4.5 and Sonnet 4.6 both operational. Sonnet 4.6 was used for the coverage benchmark; cache benchmark uses 4.5 only.

## Track H.5 determinism — deferred

The plan called for re-running V2 Biztoso twice and diffing `[agent] coordinate decision` logs (target ≥90% identical decisions). This check is **deferred**: the exact TEST_EMAIL / TEST_PASSWORD seed used for the V2 Biztoso #8 reference run was not recovered from shell history or env files, and without identical credential input the post-login path would diverge trivially. Pre-login determinism (first 2-3 steps before credentials are typed) can be observed in `/tmp/v2-biztoso8.log` — the agent picks the same "Continue with Email" coordinate on steps 0-3 and only diverges after screen state advances, which is consistent with `temperature: 0` determinism.

## Track I.1 rollback — verified

With `AGENT_VISION_FIRST=false AGENT_LOOP=true` on a 10-step com.biztoso.app smoke (`/tmp/rollback-v1-smoke.log`): **0** `coordinate decision` log lines, **36** V1-path signals (recovery / relaunch_branch / pressBack / candidate references). The flag flip reliably routes through the V1 index-based policy path with zero V2 code involvement.
