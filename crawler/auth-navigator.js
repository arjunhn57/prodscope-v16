"use strict";

/**
 * auth-navigator.js — Perception-driven auth execution loop.
 *
 * Replaces navigateWebViewAuth(). Each iteration independently observes
 * the screen, classifies every element, and deterministically selects
 * the right action. No step-order assumptions.
 *
 * Loop: screenshot → perceive → selectAction → execute → verify
 */

const fs = require("fs");
const path = require("path");
const adb = require("./adb");
const vision = require("./vision");
const screenshotFp = require("./screenshot-fp");
const { perceive, perceiveFromXml } = require("./auth-perceiver");
const {
  selectAuthAction,
  markCredentialEntered,
  createCredentialState,
} = require("./auth-action-selector");
const { parseBounds } = require("./actions");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "auth-nav" });

const MAX_AUTH_STEPS = 16;
const STUCK_THRESHOLD = 5; // same screen hash N times → stuck (higher for coord inaccuracy retries)
const POST_ACTION_WAIT = 1500;
const POST_SUBMIT_WAIT = 4000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Find the nearest clickable XML element to a target point.
 * Vision tells us WHAT to tap; XML tells us exactly WHERE.
 *
 * @param {string} xml - UIAutomator XML dump
 * @param {number} targetX - Vision-estimated X pixel
 * @param {number} targetY - Vision-estimated Y pixel
 * @param {number} [maxDist=400] - Maximum snap distance in pixels
 * @returns {{ bounds: { cx, cy, x1, y1, x2, y2 }, dist: number, label: string }|null}
 */
function findNearestClickable(xml, targetX, targetY, maxDist = 150) {
  if (!xml) return null;
  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  let m;
  let nearest = null;
  let minDist = Infinity;

  while ((m = nodeRegex.exec(xml)) !== null) {
    const attrs = m[1];
    const get = (name) => {
      const match = attrs.match(new RegExp(`${name}="([^"]*)"`));
      return match ? match[1] : "";
    };

    if (get("clickable") !== "true") continue;
    if (get("enabled") === "false") continue;

    const bounds = parseBounds(get("bounds"));
    if (!bounds) continue;

    const w = bounds.x2 - bounds.x1;
    const h = bounds.y2 - bounds.y1;
    if (w < 40 || h < 30) continue;
    if (w > 900 && h > 500) continue;

    const dist = Math.sqrt((bounds.cx - targetX) ** 2 + (bounds.cy - targetY) ** 2);
    if (dist < minDist && dist <= maxDist) {
      minDist = dist;
      const label = get("text") || get("content-desc") || "";
      nearest = { bounds, dist: Math.round(dist), label };
    }
  }

  return nearest;
}

/**
 * Find an XML node whose text matches a button label.
 * Compose buttons are often NOT marked clickable, but tapping the text
 * coordinates still triggers the parent's onClick handler.
 *
 * @param {string} xml - UIAutomator XML dump
 * @param {string} label - Button label to search for (e.g. "Continue with Email")
 * @returns {{ bounds: { cx, cy }, label: string }|null}
 */
function findNodeByText(xml, label) {
  if (!xml || !label || label.length < 3) return null;
  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  const needle = label.toLowerCase().replace(/\s+/g, " ");
  let m;

  while ((m = nodeRegex.exec(xml)) !== null) {
    const attrs = m[1];
    const get = (name) => {
      const match = attrs.match(new RegExp(`${name}="([^"]*)"`));
      return match ? match[1] : "";
    };
    const text = (get("text") || get("content-desc") || "").replace(/&#10;/g, " ");
    if (!text) continue;
    if (!text.toLowerCase().includes(needle)) continue;

    const bounds = parseBounds(get("bounds"));
    if (!bounds) continue;

    return { bounds, label: text };
  }
  return null;
}

/**
 * Find the submit/login button in XML by position heuristic.
 * Compose buttons are clickable Views without text labels.
 * The submit button is the first wide clickable View below all EditText fields.
 *
 * @param {string} xml - UIAutomator XML dump
 * @returns {{ bounds: { cx, cy, x1, y1, x2, y2 }, label: string }|null}
 */
function findSubmitClickableFromXml(xml) {
  if (!xml) return null;
  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  let maxEditTextY2 = 0;
  const candidates = [];
  const allTextNodes = []; // All text nodes for child-text inspection
  let m;

  // Single pass: collect EditText bottoms, clickable candidates, and text nodes
  while ((m = nodeRegex.exec(xml)) !== null) {
    const attrs = m[1];
    const get = (name) => {
      const match = attrs.match(new RegExp(`${name}="([^"]*)"`));
      return match ? match[1] : "";
    };
    const cls = get("class");
    const clickable = get("clickable");
    const bounds = parseBounds(get("bounds"));
    if (!bounds) continue;

    const text = (get("text") || get("content-desc") || "").trim();

    if (cls.includes("EditText")) {
      maxEditTextY2 = Math.max(maxEditTextY2, bounds.y2);
    }

    // Collect text nodes for child-text matching
    if (text) {
      allTextNodes.push({ bounds, text });
    }

    if (clickable !== "true") continue;
    if (cls.includes("EditText")) continue;

    const w = bounds.x2 - bounds.x1;
    const h = bounds.y2 - bounds.y1;
    // Submit buttons are wide (>200px) and medium height (40-300px)
    if (w < 200 || h < 40 || h > 300) continue;
    if (w > 1050) continue; // full-screen container

    candidates.push({ bounds, label: text });
  }

  if (maxEditTextY2 === 0 || candidates.length === 0) return null;

  const below = candidates
    .filter((c) => c.bounds.y1 >= maxEditTextY2)
    .sort((a, b) => a.bounds.cy - b.bounds.cy);

  if (below.length === 0) return null;
  if (below.length === 1) return below[0];

  // Multiple candidates — use child text to disambiguate.
  // "Forgot Password?" links are clickable Views that appear between fields and submit.
  const SKIP_RE = /forgot|reset\s*password|trouble|need\s*help|privacy|terms|already\s*have/i;
  const SUBMIT_RE = /log\s*in|sign\s*in|submit|continue|next|register|create|enter|\bgo\b/i;

  // Enrich each candidate with text from child nodes within its bounds
  const enriched = below.map((cand) => {
    const childTexts = allTextNodes
      .filter((t) =>
        t.bounds.x1 >= cand.bounds.x1 && t.bounds.y1 >= cand.bounds.y1 &&
        t.bounds.x2 <= cand.bounds.x2 && t.bounds.y2 <= cand.bounds.y2)
      .map((t) => t.text);
    const allText = (cand.label + " " + childTexts.join(" ")).trim();
    return { ...cand, childText: allText };
  });

  // Prefer candidates with submit-like text
  const withSubmitText = enriched.filter((c) => SUBMIT_RE.test(c.childText));
  if (withSubmitText.length > 0) return withSubmitText[0];

  // Filter out candidates with "forgot password" / helper link text
  const filtered = enriched.filter((c) => !c.childText || !SKIP_RE.test(c.childText));
  if (filtered.length > 0) return filtered[0];

  // Last resort: return the LAST candidate (submit is usually below helper links)
  return below[below.length - 1];
}

/**
 * Find the bottom Y of the lowest EditText in the XML.
 * Used to validate text matches are below form fields (not headers).
 *
 * @param {string} xml - UIAutomator XML dump
 * @returns {number} Bottom Y of lowest EditText, or 0 if none found
 */
function findMaxEditTextY(xml) {
  if (!xml) return 0;
  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  let maxY = 0;
  let m;
  while ((m = nodeRegex.exec(xml)) !== null) {
    const attrs = m[1];
    if (!attrs.includes("EditText")) continue;
    const boundsMatch = attrs.match(/bounds="([^"]*)"/);
    if (!boundsMatch) continue;
    const bounds = parseBounds(boundsMatch[1]);
    if (bounds) maxY = Math.max(maxY, bounds.y2);
  }
  return maxY;
}

/**
 * Find the correct EditText for a field role using XML attributes.
 * Uses password attribute and position order for accurate matching.
 *
 * @param {string} xml - UIAutomator XML dump
 * @param {string} fieldRole - "email_field", "password_field", etc.
 * @returns {{ bounds: { cx, cy }, label: string }|null}
 */
function findFieldByRole(xml, fieldRole) {
  if (!xml) return null;
  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  const editTexts = [];
  let m;

  while ((m = nodeRegex.exec(xml)) !== null) {
    const attrs = m[1];
    const get = (name) => {
      const match = attrs.match(new RegExp(`${name}="([^"]*)"`));
      return match ? match[1] : "";
    };
    if (!get("class").includes("EditText")) continue;
    if (get("enabled") === "false") continue;

    const bounds = parseBounds(get("bounds"));
    if (!bounds) continue;

    editTexts.push({
      bounds,
      isPassword: get("password") === "true",
      text: get("text") || "",
    });
  }

  if (editTexts.length === 0) return null;
  editTexts.sort((a, b) => a.bounds.cy - b.bounds.cy);

  switch (fieldRole) {
    case "password_field": {
      // Prefer EditText with password=true, else second field
      const pw = editTexts.find((e) => e.isPassword);
      return pw || editTexts[1] || null;
    }
    case "email_field":
    case "username_field":
    case "phone_field": {
      // First non-password EditText
      const np = editTexts.find((e) => !e.isPassword);
      return np || editTexts[0] || null;
    }
    default:
      return editTexts[0] || null;
  }
}

/**
 * Execute a single auth action on the device.
 *
 * @param {object} action - AuthAction from selectAuthAction()
 * @param {string|null} xml - Current XML (for snap-to-clickable)
 * @returns {boolean} Whether the action was executed
 */
function executeAction(action, xml) {
  switch (action.type) {
    case "fill_field": {
      const target = action.target;
      let tapX = target.x;
      let tapY = target.y;

      // Role-based XML field matching: password_field → password EditText, etc.
      // More reliable than distance-based snap (vision coords can be 300px off)
      if (xml && target.source === "vision") {
        const fieldMatch = findFieldByRole(xml, action.fieldRole);
        if (fieldMatch) {
          log.info({
            visionX: target.x, visionY: target.y,
            xmlX: fieldMatch.bounds.cx, xmlY: fieldMatch.bounds.cy,
            fieldRole: action.fieldRole,
          }, "Matched field by XML role");
          tapX = fieldMatch.bounds.cx;
          tapY = fieldMatch.bounds.cy;
        }
      }

      adb.tap(tapX, tapY);
      adb.inputText(action.value);
      log.info({ role: action.fieldRole, valuePrefix: action.value.slice(0, 3) },
        "Filled field");

      // Dismiss keyboard after typing
      adb.dismissKeyboard();
      return true;
    }

    case "tap_button": {
      const target = action.target;
      let tapX = target.x;
      let tapY = target.y;

      // Three strategies by button type:
      // (A) Method buttons (use_email, google) → XML text match (accurate for Compose)
      // (B) Submit/login buttons → XML position heuristic (first clickable below fields)
      // (C) Fallback → distance snap within 150px, then raw vision coords
      const SUBMIT_BUTTON_ROLES = new Set([
        "submit_button", "login_button", "signup_button",
        "continue_button", "next_button",
      ]);
      const METHOD_BUTTON_ROLES = new Set([
        "use_email_button", "use_phone_button", "google_button",
        "facebook_button", "apple_button",
      ]);
      if (xml && target.source === "vision") {
        let resolved = false;

        // (A) Text match for any button with a label
        if (target.label && target.label.length >= 2) {
          const textMatch = findNodeByText(xml, target.label);
          if (textMatch) {
            // For submit buttons, verify the match is below form fields
            // (headers like "Log In" appear above fields and must be skipped)
            let valid = true;
            if (SUBMIT_BUTTON_ROLES.has(action.buttonRole)) {
              const editTextBottom = findMaxEditTextY(xml);
              if (editTextBottom > 0 && textMatch.bounds.cy < editTextBottom) {
                valid = false; // text is above fields — likely a header
                log.info({ textY: textMatch.bounds.cy, editBottom: editTextBottom },
                  "Skipped text match above fields (likely header)");
              }
            }
            if (valid) {
              log.info({
                visionX: target.x, visionY: target.y,
                textX: textMatch.bounds.cx, textY: textMatch.bounds.cy,
                textLabel: textMatch.label,
              }, "Matched button by XML text");
              tapX = textMatch.bounds.cx;
              tapY = textMatch.bounds.cy;
              resolved = true;
            }
          }
        }

        // (B) Submit buttons: find clickable View below form fields (with text filtering)
        if (!resolved && SUBMIT_BUTTON_ROLES.has(action.buttonRole)) {
          const submitBtn = findSubmitClickableFromXml(xml);
          if (submitBtn) {
            log.info({
              visionX: target.x, visionY: target.y,
              xmlX: submitBtn.bounds.cx, xmlY: submitBtn.bounds.cy,
              xmlBounds: `[${submitBtn.bounds.x1},${submitBtn.bounds.y1}][${submitBtn.bounds.x2},${submitBtn.bounds.y2}]`,
            }, "Found submit button by XML position");
            tapX = submitBtn.bounds.cx;
            tapY = submitBtn.bounds.cy;
            resolved = true;
          }
        }

        // (C) Fallback: nearest clickable within 150px
        if (!resolved) {
          const snapped = findNearestClickable(xml, target.x, target.y);
          if (snapped) {
            log.info({
              visionX: target.x, visionY: target.y,
              snapX: snapped.bounds.cx, snapY: snapped.bounds.cy,
              snapDist: snapped.dist, snapLabel: snapped.label,
            }, "Snapped button to XML element");
            tapX = snapped.bounds.cx;
            tapY = snapped.bounds.cy;
          }
        }
      }

      // Dismiss keyboard before tapping buttons (keyboard may cover target)
      adb.dismissKeyboard();
      adb.tap(tapX, tapY);
      log.info({ role: action.buttonRole, reason: action.reason },
        "Tapped button");
      return true;
    }

    case "press_enter":
      adb.run("adb shell input keyevent KEYCODE_ENTER", { ignoreError: true });
      log.info("Pressed enter (IME submit)");
      return true;

    case "press_back":
      adb.pressBack();
      log.info("Pressed back (nothing actionable)");
      return true;

    case "wait":
      log.info({ reason: action.reason }, "Waiting (loading)");
      return true;

    case "abort":
      log.info({ reason: action.reason, errorText: action.errorText },
        "Auth aborted");
      return false;

    default:
      log.warn({ type: action.type }, "Unknown action type");
      return false;
  }
}

/**
 * Take a screenshot and compute its perceptual hash.
 *
 * @param {string} dir - Screenshot directory
 * @param {string} prefix - Filename prefix
 * @param {number} idx - Step index
 * @returns {{ path: string, hash: string }|null}
 */
function takeScreenshot(dir, prefix, idx) {
  const ssPath = path.join(dir, `${prefix}_${idx}.png`);
  let ok = false;
  try { ok = adb.screencap(ssPath); } catch (_) { /* ignore */ }

  if (!ok || !fs.existsSync(ssPath) || fs.statSync(ssPath).size === 0) {
    return null;
  }

  const hash = screenshotFp.computeHash(ssPath);
  return { path: ssPath, hash };
}

/**
 * Main perception-driven auth navigation loop.
 *
 * @param {object} opts
 * @param {string} opts.screenshotDir - Directory for screenshots
 * @param {number} opts.stepBase - Base step number for filenames
 * @param {object} opts.credentials - { email, username, password, phone, otp }
 * @param {string} opts.preferredMethod - "email" or "phone"
 * @param {string} opts.packageName - App package for native-return detection
 * @param {object} [opts.credentialState] - Existing CredentialState (or creates fresh)
 * @returns {Promise<{ navigated: boolean, stepsUsed: number, reason?: string, credentialState: object }>}
 */
async function navigateAuth(opts) {
  const {
    screenshotDir, stepBase, credentials, preferredMethod,
    packageName,
  } = opts;
  let credState = opts.credentialState || createCredentialState();

  const budget = MAX_AUTH_STEPS;
  let lastHash = null;
  let sameHashCount = 0;
  let emptyPerceptionCount = 0;
  let lastActionType = null; // Track last action to distinguish fill vs tap for stuck detection

  await sleep(3000); // Initial wait for screen to settle

  for (let i = 0; i < budget; i++) {
    // ── Dismiss keyboard before perception — keyboard covers buttons ──
    // 800ms wait lets Compose reflow layout after keyboard dismiss
    adb.dismissKeyboard();
    await sleep(800);

    // ── XML dump (works on native/Compose; null for WebView) ──
    let xml = null;
    try { xml = adb.dumpXml(); } catch (_) { /* ignore */ }

    // ── Screenshot ──
    const ss = takeScreenshot(screenshotDir, `auth_nav_${stepBase}`, i);
    const flagSecure = !ss && !!xml;

    if (!ss && !xml) {
      log.info({ step: i + 1 }, "No screenshot and no XML — waiting");
      await sleep(2000);
      continue;
    }

    if (flagSecure) {
      log.info({ step: i + 1 }, "Screenshot blocked (FLAG_SECURE?) — XML-only mode");
    }

    // ── Stuck detection: same screen hash ──
    // Only count stuck for tap_button actions. fill_field doesn't visually
    // change the screen hash (typing into a field looks the same perceptually).
    // Skip hash-based stuck detection in FLAG_SECURE mode (no screenshot).
    if (!flagSecure && lastHash) {
      const dist = screenshotFp.hammingDistance(lastHash, ss.hash);
      if (dist < 5) {
        // Only increment stuck counter if last action was a button tap (not fill)
        if (lastActionType === "tap_button" || lastActionType === "press_enter") {
          sameHashCount++;
        }
        log.info({ step: i + 1, sameCount: sameHashCount, hamming: dist, lastAction: lastActionType },
          "Screen unchanged");
        if (sameHashCount >= STUCK_THRESHOLD) {
          log.warn("Stuck — same screen after repeated button taps");
          adb.pressBack();
          await sleep(1000);
          return {
            navigated: false, stepsUsed: i + 1,
            reason: "stuck_same_screen", credentialState: credState,
          };
        }
      } else {
        sameHashCount = 0;
      }
    }
    if (!flagSecure) lastHash = ss.hash;

    // ── Native app return check ──
    try {
      const currentPkg = adb.getCurrentPackage();
      if (currentPkg && currentPkg === packageName) {
        log.info({ step: i + 1 }, "Back in native app — auth may have completed");
        return {
          navigated: true, stepsUsed: i + 1,
          backInNative: true, credentialState: credState,
        };
      }
    } catch (_) { /* ignore */ }

    // ── Perceive ──
    let perception;
    if (flagSecure) {
      // FLAG_SECURE: XML-only perception — no vision budget consumed.
      // UIAutomator XML is not blocked by FLAG_SECURE, so fields and
      // buttons are still discoverable via forms.detectForm() + extractButtons().
      perception = perceiveFromXml(xml);
    } else {
      // ── Vision budget check ──
      if (vision.budgetRemaining() <= 0) {
        log.info("Vision budget exhausted");
        adb.pressBack();
        return {
          navigated: false, stepsUsed: i + 1,
          reason: "vision_budget", credentialState: credState,
        };
      }
      // Vision handles classification (Compose XML misclassifies fields).
      // XML is used only in executeAction for coordinate snap-to-clickable.
      perception = await perceive(ss.path, null, { forceVision: true });
    }
    const hasElements = perception.fields.length > 0 || perception.buttons.length > 0;
    log.info({
      step: i + 1,
      source: perception.source || "unknown",
      xmlAvailable: !!xml,
      screenType: perception.screenType,
      fields: perception.fields.map((f) => f.role),
      buttons: perception.buttons.map((b) => b.role),
      hasError: perception.hasError,
      flagSecure,
    }, "Perception result");

    // ── Post-submit success detection ──────────────────────────────────
    // After submitting credentials, if the screen is no longer an auth screen
    // (login/signup/otp), auth has completed — we're on an onboarding or main screen.
    const AUTH_SCREEN_TYPES = new Set(["login", "signup", "otp", "method_choice"]);
    if (credState.submittedCount > 0 && !AUTH_SCREEN_TYPES.has(perception.screenType)) {
      // Verify screen actually changed from pre-submit state (not just a perception error)
      if (sameHashCount === 0 || hasElements) {
        log.info({
          step: i + 1, screenType: perception.screenType,
          submitCount: credState.submittedCount,
        }, "Post-submit screen is not auth — auth likely completed");
        return {
          navigated: true, stepsUsed: i + 1,
          reason: "post_submit_non_auth_screen", credentialState: credState,
        };
      }
    }

    // ── Empty perception (vision parse failure) — retry, don't bail ──
    if (!hasElements && perception.screenType === "unknown") {
      emptyPerceptionCount++;
      log.warn({ step: i + 1, emptyCount: emptyPerceptionCount },
        "Empty perception — vision may have failed, retrying");
      if (emptyPerceptionCount >= 3) {
        log.warn("Too many empty perceptions — pressing back");
        adb.pressBack();
        await sleep(1000);
        return {
          navigated: false, stepsUsed: i + 1,
          reason: "perception_failed", credentialState: credState,
        };
      }
      await sleep(2000);
      continue;
    }
    emptyPerceptionCount = 0; // Reset on successful perception

    // ── Select action ──
    const action = selectAuthAction(perception, credState, credentials);
    log.info({
      step: i + 1, type: action.type, reason: action.reason,
      targetX: action.target ? action.target.x : undefined,
      targetY: action.target ? action.target.y : undefined,
    }, "Action selected");

    // ── Handle terminal actions ──
    if (action.type === "abort") {
      return {
        navigated: false, stepsUsed: i + 1,
        reason: action.reason, credentialState: credState,
      };
    }

    if (action.type === "press_back") {
      executeAction(action, null);
      await sleep(1000);
      return {
        navigated: false, stepsUsed: i + 1,
        reason: action.reason, credentialState: credState,
      };
    }

    if (action.type === "wait") {
      await sleep(2000);
      continue;
    }

    // ── Execute ──
    lastActionType = action.type;
    const executed = executeAction(action, xml);
    if (!executed) {
      return {
        navigated: false, stepsUsed: i + 1,
        reason: "action_failed", credentialState: credState,
      };
    }

    // ── Update credential state ──
    if (action.type === "fill_field" && action.fieldRole) {
      credState = markCredentialEntered(credState, action.fieldRole);
    }
    if (action.type === "tap_button" && action.reason === "submit_form") {
      credState = { ...credState, submittedCount: credState.submittedCount + 1 };
    }

    // ── Post-action wait ──
    const waitTime = action.reason === "submit_form" ? POST_SUBMIT_WAIT : POST_ACTION_WAIT;
    await sleep(waitTime);

    // ── Post-action verification: did the screen change? ──
    // Skip in FLAG_SECURE mode — screenshots are blocked
    if (!flagSecure) {
      const postSs = takeScreenshot(screenshotDir, `auth_nav_${stepBase}_post`, i);
      if (postSs) {
        const changeDist = screenshotFp.hammingDistance(ss.hash, postSs.hash);
        if (changeDist < 5 && action.type === "tap_button") {
          log.warn({ hamming: changeDist }, "Screen unchanged after button tap");
        } else if (changeDist >= 5) {
          log.info({ hamming: changeDist }, "Screen changed after action");
          sameHashCount = 0;
          lastHash = postSs.hash;
        }
      }
    }

    // ── Check if submit led back to native app ──
    if (action.reason === "submit_form") {
      await sleep(2000); // Extra wait for redirects
      try {
        const currentPkg = adb.getCurrentPackage();
        if (currentPkg && currentPkg === packageName) {
          log.info("Back in native app after submit");
          return {
            navigated: true, stepsUsed: i + 1,
            backInNative: true, credentialState: credState,
          };
        }
      } catch (_) { /* ignore */ }
    }
  }

  log.info({ maxSteps: budget }, "Auth budget exhausted");
  adb.pressBack();
  await sleep(1000);
  return {
    navigated: false, stepsUsed: budget,
    reason: "max_steps", credentialState: credState,
  };
}

module.exports = {
  navigateAuth,
  findNearestClickable,
  executeAction,
};
