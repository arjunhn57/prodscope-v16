"use strict";

/**
 * Auth-loop exit guard (Fix 5).
 *
 * When the Haiku agent orbits the same auth-wall fingerprint instead of
 * emitting done("blocked_by_auth"), the loop MUST force-terminate to avoid
 * burning the full step budget on a login wall (see biztoso 6f926f08).
 *
 * The contract:
 *   - Visiting the same fingerprint >= AUTH_LOOP_FP_THRESHOLD (3) times
 *     forces actionToExecute to {type:"done", reason:"blocked_by_auth:fp_revisit_loop"}.
 *   - The override fires AFTER the agent has decided, so the agent gets fair
 *     attempts on the 1st and 2nd visits — only repeat offenders are overridden.
 *   - The override is suppressed when the agent's chosen action is already
 *     done, type (mid-form-fill), or request_human_input.
 *   - The counter is driven by observation.fingerprint and survives non-no_change
 *     feedback (unlike stagnationStreak).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { runAgentLoop } = require("../agent-loop");

// 1x1 transparent PNG base for screenshot fixtures
const TINY_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63000100000005000100",
  "hex",
);

function makeTmpScreenshotDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "v16-auth-loop-"));
}

/**
 * Mock ADB whose screencap returns bytes keyed by a per-step fingerprint label.
 * Same label → same bytes → same computed fingerprint (captureObservation hashes
 * the PNG bytes). Different labels → different bytes → different fingerprints.
 *
 * @param {string[]} fpSequence - label per step (step 1 uses fpSequence[0], etc.)
 */
function makeFpSequenceAdb(fpSequence) {
  const calls = [];
  let stepIdx = 0;
  return {
    calls,
    launchApp: (p) => calls.push({ m: "launchApp", p }),
    tap: (x, y) => calls.push({ m: "tap", x, y }),
    swipe: (x1, y1, x2, y2, d) => calls.push({ m: "swipe", x1, y1, x2, y2, d }),
    pressBack: () => calls.push({ m: "pressBack" }),
    pressHome: () => calls.push({ m: "pressHome" }),
    inputText: (t) => calls.push({ m: "inputText", t }),
    screencapAsync: async (outPath) => {
      const label = fpSequence[stepIdx] ?? "default";
      stepIdx += 1;
      // Same label → identical bytes → identical hash fingerprint.
      const seed = Buffer.from(`fp:${label}`, "utf8");
      fs.writeFileSync(outPath, Buffer.concat([TINY_PNG, seed]));
      return true;
    },
    dumpXmlAsync: async () => "<hierarchy/>",
    getCurrentActivityAsync: async () => "com.a/.Main",
  };
}

function makeMockReadiness() {
  return {
    waitForScreenReadyScreenshotOnly: async () => ({
      ready: true,
      elapsedMs: 0,
      reason: "mock",
    }),
  };
}

/**
 * Mock Anthropic. `actionOrFactory` is either a static action object or a
 * function `(callIdx) => action` so the caller can vary per-step actions
 * (useful to dodge the consecutive-identical safety net at step 3).
 */
function makeStaticAnthropic(actionOrFactory, opts = {}) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (body) => {
        const idx = calls.length;
        calls.push(body);
        const action =
          typeof actionOrFactory === "function"
            ? actionOrFactory(idx)
            : actionOrFactory;
        const input = {
          reasoning: opts.reasoning || "stub",
          action,
          expected_outcome: opts.expectedOutcome || "",
          escalate: false,
        };
        return {
          content: [
            {
              type: "tool_use",
              name: "emit_action",
              id: "mock-id",
              input,
            },
          ],
          usage: opts.usage || { input_tokens: 100, output_tokens: 20 },
          stop_reason: "tool_use",
        };
      },
    },
  };
}

test("auth-loop: 3 consecutive visits of same fingerprint → forces done(blocked_by_auth:fp_revisit_loop)", async () => {
  const dir = makeTmpScreenshotDir();
  const adb = makeFpSequenceAdb(["login", "login", "login"]);
  const readiness = makeMockReadiness();
  const anthropic = makeStaticAnthropic({ type: "tap", x: 352, y: 1006 });

  const result = await runAgentLoop({
    jobId: "test-auth-loop",
    targetPackage: "com.a",
    screenshotDir: dir,
    budgetConfig: { maxSteps: 20 },
    deps: { adb, readiness, anthropic },
  });

  assert.equal(
    result.stopReason,
    "agent_done:blocked_by_auth:fp_revisit_loop",
    "loop must terminate with the fp-revisit stopReason",
  );
  assert.equal(
    result.stepsUsed,
    3,
    "loop must stop on the 3rd visit, not orbit for 20 steps",
  );
  // Agent was called once per step up to the override step.
  assert.equal(
    anthropic.calls.length,
    3,
    "agent must be called at most 3 times when the override fires on the 3rd visit",
  );
  // The action recorded at step 3 must be the override, not the agent's tap.
  const lastAction = result.actionsTaken[result.actionsTaken.length - 1].action;
  assert.equal(lastAction.type, "done");
  assert.equal(lastAction.reason, "blocked_by_auth:fp_revisit_loop");
  // The first two steps must still show the agent's original tap (not overridden).
  assert.equal(result.actionsTaken[0].action.type, "tap");
  assert.equal(result.actionsTaken[1].action.type, "tap");
});

test("auth-loop: counter survives intervening non-login fingerprints (stagnation-reset insulation)", async () => {
  // Simulates the biztoso flow: login → press_home → launcher → launch_app
  // back to login → etc. Between login visits, fingerprint changes (launcher),
  // which would reset stagnationStreak. The visit counter is FP-keyed so it
  // keeps counting login visits regardless.
  const dir = makeTmpScreenshotDir();
  const adb = makeFpSequenceAdb([
    "login",
    "launcher",
    "login",
    "launcher",
    "login",
  ]);
  const readiness = makeMockReadiness();
  const anthropic = makeStaticAnthropic({ type: "tap", x: 352, y: 1006 });

  const result = await runAgentLoop({
    jobId: "test-auth-loop-interleaved",
    targetPackage: "com.a",
    screenshotDir: dir,
    budgetConfig: { maxSteps: 20 },
    deps: { adb, readiness, anthropic },
  });

  assert.equal(
    result.stopReason,
    "agent_done:blocked_by_auth:fp_revisit_loop",
    "override must still fire when launcher FPs interleave with login FPs",
  );
  assert.equal(
    result.stepsUsed,
    5,
    "override fires on the 5th step (3rd login visit), not before or after",
  );
});

test("auth-loop: does NOT override when action is 'type' (mid-form-fill)", async () => {
  // Legitimate flow: same auth-screen FP visited 3 times while agent fills
  // email → password → submit. Must NOT force-exit. Vary text per step so
  // the consecutive-identical safety net doesn't interfere with the check.
  const dir = makeTmpScreenshotDir();
  const adb = makeFpSequenceAdb(["login", "login", "login"]);
  const readiness = makeMockReadiness();
  const texts = ["user@example.com", "secret-pw", "something-else"];
  const anthropic = makeStaticAnthropic((idx) => ({
    type: "type",
    text: texts[idx] || `text-${idx}`,
  }));

  const result = await runAgentLoop({
    jobId: "test-auth-loop-type-exception",
    targetPackage: "com.a",
    screenshotDir: dir,
    credentials: { email: "user@example.com", password: "pw" },
    budgetConfig: { maxSteps: 3 },
    deps: { adb, readiness, anthropic },
  });

  // Auth-loop override must NOT have fired on the 3rd type action.
  assert.notEqual(
    result.stopReason,
    "agent_done:blocked_by_auth:fp_revisit_loop",
    "override must not steal a legitimate form-fill action",
  );
  // Every step recorded must remain a type action (not an override).
  for (const entry of result.actionsTaken) {
    assert.equal(
      entry.action.type,
      "type",
      "auth-loop override must not replace legitimate type actions",
    );
  }
});

test("auth-loop: does NOT override when action is already 'done'", async () => {
  // Agent owns the exit. No override needed.
  const dir = makeTmpScreenshotDir();
  const adb = makeFpSequenceAdb(["login", "login", "login"]);
  const readiness = makeMockReadiness();
  const anthropic = makeStaticAnthropic({
    type: "done",
    reason: "blocked_by_auth",
  });

  const result = await runAgentLoop({
    jobId: "test-auth-loop-done-passthrough",
    targetPackage: "com.a",
    screenshotDir: dir,
    budgetConfig: { maxSteps: 20 },
    deps: { adb, readiness, anthropic },
  });

  // The agent's own reason survives — not replaced by fp_revisit_loop.
  assert.equal(result.stopReason, "agent_done:blocked_by_auth");
  assert.equal(result.stepsUsed, 1);
});

test("auth-loop: 2 visits alone do NOT trigger override (threshold is 3)", async () => {
  // Vary tap coordinates so consecutive-identical doesn't fire — we want to
  // isolate the auth-loop override contract here.
  const dir = makeTmpScreenshotDir();
  const adb = makeFpSequenceAdb(["login", "login", "other", "other"]);
  const readiness = makeMockReadiness();
  const anthropic = makeStaticAnthropic((idx) => ({
    type: "tap",
    x: 50 + idx,
    y: 50 + idx,
  }));

  const result = await runAgentLoop({
    jobId: "test-auth-loop-below-threshold",
    targetPackage: "com.a",
    screenshotDir: dir,
    budgetConfig: { maxSteps: 4 },
    deps: { adb, readiness, anthropic },
  });

  // Ran to max_steps because no FP hit 3 visits.
  assert.equal(result.stopReason, "max_steps_reached");
  assert.equal(result.stepsUsed, 4);
  // Auth-loop override never fired (every recorded action is still a tap).
  for (const entry of result.actionsTaken) {
    assert.equal(entry.action.type, "tap");
  }
});
