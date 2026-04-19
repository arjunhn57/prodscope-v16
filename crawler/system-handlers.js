/**
 * system-handlers.js - Generic system dialog and overlay handler
 *
 * Detects and auto-dismisses Android system dialogs, permission prompts,
 * onboarding overlays, and other interrupts using XML pattern matching.
 *
 * Strategy:
 *  1. Specific handlers match known dialog types (highest priority).
 *  2. Generic structural detection catches ANY dialog/overlay by XML patterns.
 *  3. Resolution: find dismiss/accept buttons by label patterns, fall back to BACK.
 */

const adb = require('./adb');
const { parseBounds } = require('./actions');
const { logger } = require("../lib/logger");
const log = logger.child({ component: "system-handlers" });

// -------------------------------------------------------------------------
// Button label patterns for dialog resolution (case-insensitive)
// -------------------------------------------------------------------------

/** Labels that dismiss/decline a dialog */
const DISMISS_LABELS = [
  'skip', 'later', 'not now', 'maybe later', 'remind me later',
  'no thanks', 'no, thanks', 'dismiss', 'cancel', 'close',
  'deny', 'don\'t allow', 'reject', 'never', 'not interested',
  'got it', 'ok', 'okay',
];

/** Labels that accept/allow a dialog (used when we want to proceed) */
const ACCEPT_LABELS = [
  'allow', 'while using the app', 'only this time',
  'accept', 'agree', 'continue', 'yes', 'confirm',
  'enable', 'turn on', 'ok', 'okay', 'got it',
  'open', 'proceed',
];

/** Labels that indicate crash/ANR dialogs */
const CRASH_LABELS = [
  'close app', 'close', 'wait', 'open app again',
  'send feedback', 'app info',
];

// -------------------------------------------------------------------------
// Structural dialog detectors
// -------------------------------------------------------------------------

/**
 * Detect if the current XML contains a system permission dialog.
 */
function isPermissionDialog(xml) {
  return /resource-id="com\.android\.permissioncontroller/i.test(xml) ||
    (/text="(Allow|While using the app|Only this time|Don't allow|Deny)"/i.test(xml) &&
     /resource-id="com\.android\./i.test(xml));
}

/**
 * Detect if the current XML contains a crash/ANR/not-responding dialog.
 */
function isCrashOrAnrDialog(xml) {
  return (
    /android:id\/aerr_/.test(xml) ||
    (/(isn&apos;t responding|isn't responding|keeps stopping|has stopped|unfortunately.*stopped)/i.test(xml) &&
     /alertTitle|android:id\/message/i.test(xml))
  );
}

/**
 * Detect ANY overlay dialog by structural XML patterns.
 * Matches alert dialogs, bottom sheets, popups, and modal overlays.
 */
function isGenericDialog(xml) {
  if (!xml) return false;

  // Known Android dialog structural markers
  const dialogMarkers = [
    /android:id\/alertTitle/i,
    /android:id\/parentPanel/i,
    /android:id\/contentPanel/i,
    /android:id\/buttonPanel/i,
    /class="android\.app\.Dialog/i,
    /class="androidx\.appcompat\.app\.AlertDialog/i,
    /class="android\.widget\.PopupWindow/i,
    /class="com\.google\.android\.material\.bottomsheet/i,
    /resource-id="[^"]*(?:dialog|popup|overlay|modal|banner|snackbar|toast|bottomsheet)/i,
  ];

  return dialogMarkers.some((pattern) => pattern.test(xml));
}

/**
 * Detect onboarding/interstitial/promo overlays.
 * These are full-screen or near-full-screen overlays with dismiss actions.
 *
 * Must avoid false positives: a home feed with a "Later" button on a
 * profile-completion banner is NOT an overlay. Real overlays have very few
 * interactive elements (they block the screen with 1-3 buttons).
 */
function isOnboardingOverlay(xml) {
  const hasPageIndicator = /class="[^"]*PageIndicator|ViewPager/i.test(xml);
  if (hasPageIndicator) return true;

  const hasSkipAction = /text="(Skip|SKIP|Later|LATER|Not now|NOT NOW|Maybe later|Remind me later|Got it|GOT IT|No thanks)"/i.test(xml);
  if (!hasSkipAction) return false;

  // Count interactive elements — real overlays have very few (1-5 buttons).
  // A full app screen (feed, settings, etc.) has many more.
  const clickableCount = (xml.match(/clickable="true"/g) || []).length;
  return clickableCount <= 6;
}

/**
 * Detect third-party auth/sign-in prompts (Google, Facebook, etc.).
 */
function isThirdPartyAuthPrompt(xml) {
  return (
    /resource-id="com\.google\.android\.gms/i.test(xml) ||
    /resource-id="com\.facebook\.katana/i.test(xml) ||
    /text="(Choose an account|Sign in with Google|Google Sign-in|Sign in to continue|Continue with Google|Continue with Facebook)"/i.test(xml)
  );
}

// -------------------------------------------------------------------------
// Button finder — generic XML button extraction
// -------------------------------------------------------------------------

/**
 * Find all tappable buttons in the XML and return their labels + bounds.
 */
function extractButtons(xml) {
  const buttons = [];
  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  let m;

  while ((m = nodeRegex.exec(xml)) !== null) {
    const attrs = m[1];
    const get = (name) => {
      const match = attrs.match(new RegExp(`${name}="([^"]*)"`));
      return match ? match[1] : '';
    };

    const clickable = get('clickable') === 'true';
    if (!clickable) continue;

    const text = get('text').trim();
    const contentDesc = get('content-desc').trim();
    const label = text || contentDesc;
    if (!label) continue;

    const boundsStr = get('bounds');
    const bounds = parseBounds(boundsStr);
    if (!bounds) continue;

    const cls = get('class').toLowerCase();
    const isButton = cls.includes('button') || cls.includes('textview') || cls.includes('imageview');

    buttons.push({ label, labelLower: label.toLowerCase(), bounds, isButton, cls });
  }

  return buttons;
}

/**
 * Find and tap a button matching one of the given label patterns.
 * Returns the action description or null if no match found.
 */
function tapButtonByLabels(xml, labelPatterns, fallbackAction) {
  const buttons = extractButtons(xml);

  for (const pattern of labelPatterns) {
    const match = buttons.find((b) => b.labelLower === pattern || b.labelLower.includes(pattern));
    if (match) {
      adb.tap(match.bounds.cx, match.bounds.cy);
      return `Tapped "${match.label}"`;
    }
  }

  // Fallback
  if (fallbackAction === 'back') {
    adb.pressBack();
    return 'Dismissed with BACK (no matching button)';
  }

  return null;
}

/**
 * Find an auth escape button (Skip, Not now, Continue as guest, etc.) in XML.
 * Returns the best match (most specific first) or null.
 *
 * @param {string} xml - Current UI XML dump
 * @param {string[]} escapeLabels - Ordered list of escape label patterns (most specific first)
 * @returns {{ label: string, labelLower: string, bounds: { cx: number, cy: number } } | null}
 */
function findAuthEscapeButton(xml, escapeLabels) {
  if (!xml) return null;
  const buttons = extractButtons(xml);
  if (buttons.length === 0) return null;

  for (const pattern of escapeLabels) {
    const match = buttons.find((b) => b.labelLower === pattern || b.labelLower.includes(pattern));
    if (match) return match;
  }

  return null;
}

// -------------------------------------------------------------------------
// Handler registry — ordered by specificity (most specific first)
// -------------------------------------------------------------------------

const HANDLERS = [
  {
    name: 'permission_dialog',
    detect: isPermissionDialog,
    resolve: (xml) => {
      return tapButtonByLabels(xml, ACCEPT_LABELS, 'back') || 'Handled permission dialog';
    },
  },
  {
    // E7: ANR-specific handler — tap "Wait" to keep app alive (before crash handler)
    name: 'anr_dialog',
    detect: (xml) => {
      return /(isn&apos;t responding|isn't responding)/i.test(xml) &&
        /text="Wait"/i.test(xml);
    },
    resolve: (xml) => {
      return tapButtonByLabels(xml, ['wait'], 'back') || 'Tapped Wait on ANR dialog';
    },
  },
  {
    // E7: Battery optimization dialog
    name: 'battery_optimization_dialog',
    detect: (xml) => {
      return /battery.*optimi|Unrestricted|battery saver/i.test(xml) &&
        /com\.android\.settings/i.test(xml);
    },
    resolve: (xml) => {
      const result = tapButtonByLabels(xml, ['allow', 'not now', 'cancel', 'done'], 'back');
      return result || 'Dismissed battery optimization dialog';
    },
  },
  {
    name: 'crash_anr_dialog',
    detect: isCrashOrAnrDialog,
    resolve: (xml) => {
      return tapButtonByLabels(xml, CRASH_LABELS, 'back') || 'Dismissed crash/ANR dialog';
    },
  },
  {
    name: 'third_party_auth',
    detect: isThirdPartyAuthPrompt,
    resolve: (xml) => {
      adb.pressBack();
      return 'Dismissed third-party auth prompt with BACK';
    },
  },
  {
    name: 'onboarding_overlay',
    detect: isOnboardingOverlay,
    resolve: (xml) => {
      return tapButtonByLabels(xml, DISMISS_LABELS, 'back') || 'Dismissed onboarding overlay';
    },
  },
  {
    // Generic catch-all: any dialog/popup/overlay not matched above
    name: 'generic_dialog',
    detect: isGenericDialog,
    resolve: (xml) => {
      // Try dismiss first, then accept, then BACK
      const dismissed = tapButtonByLabels(xml, DISMISS_LABELS);
      if (dismissed) return dismissed;

      const accepted = tapButtonByLabels(xml, ACCEPT_LABELS);
      if (accepted) return accepted;

      adb.pressBack();
      return 'Dismissed generic dialog with BACK';
    },
  },
];

// -------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------

/**
 * Detect system dialog by STRUCTURE (works for non-English apps).
 * @param {string} xml
 * @returns {boolean}
 */
function isSystemDialogByStructure(xml) {
  if (!xml) return false;

  // System packages
  const pkgMatch = xml.match(/package="([^"]+)"/);
  const pkg = pkgMatch ? pkgMatch[1] : '';
  const systemPkgs = [
    'com.android.permissioncontroller',
    'com.google.android.gms',
    'com.android.packageinstaller',
    'com.android.vending',
  ];
  if (systemPkgs.includes(pkg)) return true;

  // AlertDialog structure
  if (/android:id\/alertTitle|android:id\/parentPanel|android:id\/button1/i.test(xml)) return true;

  return false;
}

/**
 * Find the most likely positive/dismiss button in a dialog by position and structure.
 * In Android dialogs, the rightmost button is typically the positive action.
 */
function _findPositiveButton(xml) {
  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  let m;
  const buttons = [];

  while ((m = nodeRegex.exec(xml)) !== null) {
    const attrs = m[1];
    if (!/clickable="true"/i.test(attrs)) continue;

    const cls = ((attrs.match(/class="([^"]*)"/i) || [])[1] || '').toLowerCase();
    if (!cls.includes('button') && !cls.includes('textview')) continue;

    const boundsStr = (attrs.match(/bounds="([^"]*)"/i) || [])[1] || '';
    const bounds = parseBounds(boundsStr);
    if (!bounds) continue;

    // Buttons in the bottom half of the screen
    if (bounds.cy < 800) continue;

    buttons.push(bounds);
  }

  if (buttons.length === 0) return null;

  // Prefer the rightmost button (usually "Allow", "OK", "Accept")
  buttons.sort((a, b) => b.cx - a.cx);
  return buttons[0];
}

/**
 * Check the current screen XML for system dialogs/overlays and handle them.
 * @param {string} xml - Current UI XML dump
 * @returns {{ handled: boolean, action: string | null, handler: string | null }}
 */
function check(xml) {
  if (!xml) return { handled: false, action: null, handler: null };

  // Structural detection (works for any language)
  if (isSystemDialogByStructure(xml)) {
    const positiveBtn = _findPositiveButton(xml);
    if (positiveBtn) {
      adb.tap(positiveBtn.cx, positiveBtn.cy);
      log.info({ x: positiveBtn.cx, y: positiveBtn.cy }, "Dismissed system dialog (structural)");
      return { handled: true, action: 'structural_dismiss', handler: 'structural' };
    }
    adb.pressBack();
    log.info("Dismissed system dialog (structural) with BACK");
    return { handled: true, action: 'structural_back', handler: 'structural' };
  }

  // Existing text-based handlers (fallback for non-structural dialogs)
  for (const handler of HANDLERS) {
    if (handler.detect(xml)) {
      log.info({ handler: handler.name }, "Detected dialog");
      const action = handler.resolve(xml);
      log.info({ handler: handler.name, action }, "Resolved dialog");
      return { handled: true, action, handler: handler.name };
    }
  }

  return { handled: false, action: null, handler: null };
}

// ─── C10: Fast-path permission burst handler ──────────────────────────────

/**
 * Handle a burst of permission dialogs without consuming crawl steps.
 * Loops until no more permission dialogs are detected.
 *
 * @param {number} [maxPermissions=8] - Safety limit
 * @returns {Promise<{ handled: number }>} Number of permissions granted
 */
async function handlePermissionBurst(maxPermissions = 8) {
  let handled = 0;

  for (let i = 0; i < maxPermissions; i++) {
    let xml;
    try { xml = adb.dumpXml(); } catch (_) { break; }
    if (!xml) break;

    if (!isPermissionDialog(xml)) break;

    // Grant: tap "Allow", "While using the app", "Only this time"
    const granted = tapButtonByLabels(xml, [
      'while using the app', 'only this time', 'allow',
    ]);
    if (granted) {
      handled++;
      log.info({ granted, handled, maxPermissions }, "Permission granted");
      await new Promise((r) => setTimeout(r, 600));
    } else {
      // Can't find allow button — try structural positive button
      const positiveBtn = _findPositiveButton(xml);
      if (positiveBtn) {
        adb.tap(positiveBtn.cx, positiveBtn.cy);
        handled++;
        log.info({ x: positiveBtn.cx, y: positiveBtn.cy, handled, maxPermissions }, "Permission granted (structural)");
        await new Promise((r) => setTimeout(r, 600));
      } else {
        break;
      }
    }
  }

  if (handled > 0) {
    log.info({ handled }, "Permission burst complete");
  }
  return { handled };
}

// ─── C11: Onboarding swipe-through ────────────────────────────────────────

/**
 * Detect and swipe through onboarding/tutorial screens.
 * Looks for ViewPager/PageIndicator patterns, swipes until a "Get Started"
 * or "Done" button appears (or max swipes reached).
 *
 * @param {string} xml - Current screen XML
 * @returns {Promise<{ handled: boolean, swipes: number }>}
 */
async function handleOnboardingFlow(xml) {
  if (!xml) return { handled: false, swipes: 0 };

  // Check for onboarding markers
  const hasPageIndicator = /class="[^"]*PageIndicator|ViewPager|TabLayout/i.test(xml);
  const hasSwipeHint = /text="(swipe|next|continue|get started|done|let's go|start|begin)/i.test(xml);
  if (!hasPageIndicator && !hasSwipeHint) return { handled: false, swipes: 0 };

  const MAX_SWIPES = 10;
  let swipes = 0;
  let currentXml = xml;

  for (let i = 0; i < MAX_SWIPES; i++) {
    // Check for completion button before swiping
    const buttons = extractButtons(currentXml);
    const doneBtn = buttons.find((b) =>
      /^(get started|done|let's go|start|begin|explore|finish|continue)$/i.test(b.labelLower)
    );
    if (doneBtn) {
      adb.tap(doneBtn.bounds.cx, doneBtn.bounds.cy);
      log.info({ label: doneBtn.label, swipes }, "Onboarding done button tapped");
      return { handled: true, swipes };
    }

    // Swipe left
    adb.swipe(800, 960, 200, 960, 300);
    swipes++;
    await new Promise((r) => setTimeout(r, 800));

    // Re-read XML
    try { currentXml = adb.dumpXml(); } catch (_) { break; }
    if (!currentXml) break;
  }

  // Final attempt: look for skip/done after all swipes
  const finalButtons = extractButtons(currentXml || "");
  const finalDone = finalButtons.find((b) =>
    /get started|done|let's go|start|skip|begin|explore|finish|continue/i.test(b.labelLower)
  );
  if (finalDone) {
    adb.tap(finalDone.bounds.cx, finalDone.bounds.cy);
    log.info({ label: finalDone.label, swipes }, "Onboarding done button tapped (final)");
    return { handled: true, swipes };
  }

  if (swipes > 0) {
    log.info({ swipes }, "Onboarding swiped but no done button found");
  }
  return { handled: swipes > 0, swipes };
}

// ─── C2/H6: Structural button detection for non-English apps ──────────────

/**
 * Find dismiss/skip button by position heuristics (no text matching).
 * Works for non-English apps where text-based escape fails.
 *
 * @param {string} xml
 * @returns {{ cx: number, cy: number, type: string }|null}
 */
function findDismissButtonByPosition(xml) {
  if (!xml) return null;

  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  let m;
  const candidates = [];

  while ((m = nodeRegex.exec(xml)) !== null) {
    const attrs = m[1];
    if (!/clickable="true"/i.test(attrs)) continue;

    const boundsStr = (attrs.match(/bounds="([^"]*)"/i) || [])[1] || '';
    const bounds = parseBounds(boundsStr);
    if (!bounds) continue;

    const cls = ((attrs.match(/class="([^"]*)"/i) || [])[1] || '').toLowerCase();

    // Top-right small button = likely close/skip (X button)
    if (bounds.cx > 900 && bounds.cy < 200 && (bounds.w < 120 && bounds.h < 120)) {
      candidates.push({ ...bounds, type: 'top_right_close', priority: 1 });
    }

    // Small ImageButton/ImageView in top-right = close icon
    if (bounds.cx > 800 && bounds.cy < 250 && cls.includes('image') && bounds.w < 150 && bounds.h < 150) {
      candidates.push({ ...bounds, type: 'close_icon', priority: 2 });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.priority - b.priority);
  return candidates[0];
}

module.exports = {
  check,
  HANDLERS,
  handlePermissionBurst,
  handleOnboardingFlow,
  findDismissButtonByPosition,
  // Exported for testing
  isPermissionDialog,
  isCrashOrAnrDialog,
  isGenericDialog,
  isOnboardingOverlay,
  isThirdPartyAuthPrompt,
  isSystemDialogByStructure,
  extractButtons,
  findAuthEscapeButton,
};
