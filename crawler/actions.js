/**
 * actions.js - Action extraction and ranking from UI XML
 * Parses uiautomator XML to find candidate user actions and ranks them
 * deterministically so the crawler never picks randomly.
 */

/**
 * Action types the crawler understands.
 */
const ACTION_TYPES = {
  TAP: 'tap',
  TYPE: 'type',
  SCROLL_DOWN: 'scroll_down',
  SCROLL_UP: 'scroll_up',
  BACK: 'back',
  LONG_PRESS: 'long_press',
  SWIPE_LEFT: 'swipe_left',
  SWIPE_RIGHT: 'swipe_right',
  AGENT_TAP: 'agent_tap',
  AGENT_TYPE: 'agent_type',
  AGENT_SWIPE: 'agent_swipe',
  AGENT_LONG_PRESS: 'agent_long_press',
  AGENT_BACK: 'agent_back',
  AGENT_WAIT: 'agent_wait',
};

/**
 * Parse bounds string "[x1,y1][x2,y2]" into {x1, y1, x2, y2, cx, cy}.
 */
function parseBounds(boundsStr) {
  const m = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  const x1 = parseInt(m[1]), y1 = parseInt(m[2]);
  const x2 = parseInt(m[3]), y2 = parseInt(m[4]);
  return { x1, y1, x2, y2, cx: Math.floor((x1 + x2) / 2), cy: Math.floor((y1 + y2) / 2) };
}

/**
 * Build a unique key for an action (used for deduplication and tracking).
 */
function actionKey(action) {
  if (action.type === ACTION_TYPES.BACK) return 'back';
  if (action.type === ACTION_TYPES.SCROLL_DOWN) return action.key || 'scroll_down';
  if (action.type === ACTION_TYPES.SCROLL_UP) return action.key || 'scroll_up';
  const loc = action.bounds ? `${action.bounds.cx},${action.bounds.cy}` : 'unknown';
  return `${action.type}:${action.resourceId || ''}:${loc}`;
}

// Detects calendar-picker cells: "Monday, March 1, 2010" style labels.
// These are generated dynamically and produce new fingerprints per-month,
// causing the crawler to sink all its steps into a date picker.
const CALENDAR_DATE_REGEX = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday),\s+\w+\s+\d{1,2},\s+\d{4}$/i;
const MONTH_ONLY_REGEX = /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}$/i;
// Year picker navigation: "Navigate to year 1990", "2005", year-only labels
const YEAR_NAV_REGEX = /^navigate to year\s+\d{4}$/i;
const BARE_YEAR_REGEX = /^\d{4}$/;
// Generic date-picker arrows / month navigation
const DATE_NAV_REGEX = /^(previous month|next month|previous year|next year|switch to (day|year|month) (input|selection))$/i;

/**
 * Compute priority score for an action. Higher = should be tried first.
 */
function scorePriority(action) {
  if (action.type === ACTION_TYPES.TYPE) return 100;

  if (action.type === ACTION_TYPES.TAP) {
    const cls = (action.className || '').toLowerCase();
    const text = (action.text || '').toLowerCase();
    const desc = (action.contentDesc || '').toLowerCase();
    const rid = (action.resourceId || '').toLowerCase();
    const combined = `${text} ${desc} ${rid}`;

    // Deprioritize calendar date cells — they look "new" each month but are
    // functionally a date-picker loop. Score below BACK (10) so crawler exits.
    const rawText = action.text || action.contentDesc || '';
    if (CALENDAR_DATE_REGEX.test(rawText) || MONTH_ONLY_REGEX.test(rawText) ||
        YEAR_NAV_REGEX.test(rawText) || DATE_NAV_REGEX.test(rawText) ||
        (BARE_YEAR_REGEX.test(rawText) && parseInt(rawText) >= 1900 && parseInt(rawText) <= 2100)) {
      return -5;
    }

    const primaryKeywords = [
      'login',
      'sign in',
      'sign up',
      'register',
      'submit',
      'continue',
      'next',
      'log in',
      'get started',
      'allow',
      'done',
      'finish',
    ];
    if (primaryKeywords.some(k => text.includes(k) || desc.includes(k) || rid.includes(k))) return 90;

    if ((cls.includes('button') || cls.includes('textview')) && (text || desc)) return 80;

    if (cls.includes('tab') || cls.includes('bottomnavigation') || rid.includes('nav') || rid.includes('tab')) return 60;

    if (cls.includes('imagebutton') || cls.includes('imageview')) {
      return desc ? 55 : 30;
    }

    // Flag destructive actions (policy uses this to defer to VERIFY mode)
    const destructiveKeywords = ['delete', 'remove', 'logout', 'log out', 'sign out', 'deactivate', 'close account', 'reset', 'clear data', 'block'];
    if (destructiveKeywords.some(kw => combined.includes(kw))) {
      action.isDestructive = true;
    }

    if (text || desc || rid.length > 3) return 50;

    if (action.bounds) {
      const height = action.bounds.y2 - action.bounds.y1;
      const width = action.bounds.x2 - action.bounds.x1;
      if (height < 20 && width < 20) return -10;
      // Large unlabeled element — likely a container, score below BACK (10)
      if (width * height > 200000) return 5;
    }

    return 20;
  }

  if (action.type === ACTION_TYPES.SCROLL_DOWN || action.type === ACTION_TYPES.SCROLL_UP) return 20;
  if (action.type === ACTION_TYPES.BACK) return 10;

  return 0;
}

/**
 * Parse screen dimensions from XML hierarchy root bounds.
 * Falls back to ADB-detected size if not found in XML.
 */
function getScreenDimensions(xml) {
  const hierMatch = xml.match(/<hierarchy[^>]*bounds="\[0,0\]\[(\d+),(\d+)\]"/);
  if (hierMatch) return { w: parseInt(hierMatch[1]), h: parseInt(hierMatch[2]) };
  try {
    const adb = require("./adb");
    return adb.getScreenSize();
  } catch (_) {
    return { w: 1080, h: 2400 };
  }
}

/**
 * Extract candidate actions from uiautomator XML.
 * @param {string} xml - Raw XML dump
 * @param {Set<string>} [triedActions] - Keys of actions already tried from this state
 * @returns {Array<object>} Sorted by priority (descending)
 */
function extract(xml, triedActions = new Set()) {
  if (!xml) return [];

  const actions = [];
  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  let m;
  const screenDim = getScreenDimensions(xml);

  // Block actions from system/framework packages generically by prefix.
  // This avoids hardcoding specific Google/OEM app package names.
  const BLOCKED_PACKAGE_PREFIXES = [
    'com.android.',        // System UI, settings, launcher, etc.
    'com.google.android.', // Google apps (launcher, calendar, photos, etc.)
  ];
  const isBlockedPackage = (pkg) => {
    if (!pkg) return false;
    return BLOCKED_PACKAGE_PREFIXES.some((prefix) => pkg.startsWith(prefix));
  };

  while ((m = nodeRegex.exec(xml)) !== null) {
    const attrs = m[1];
    const get = (name) => {
      const match = attrs.match(new RegExp(`${name}="([^"]*)"`));
      return match ? match[1] : '';
    };

    const clickable = get('clickable') === 'true';
    const scrollable = get('scrollable') === 'true';
    const editable = get('class').toLowerCase().includes('edittext') || get('editable') === 'true';
    const enabled = get('enabled') !== 'false';
    const boundsStr = get('bounds');
    const bounds = parseBounds(boundsStr);
    const pkg = get('package').toLowerCase();
    const text = get('text');
    const contentDesc = get('content-desc');
    const resourceId = get('resource-id');

    if (!bounds) continue;
    if (!enabled) continue;

    if (isBlockedPackage(pkg)) continue;

    if (bounds.cx < 0 || bounds.cy < 0 || bounds.cx > screenDim.w * 1.1 || bounds.cy > screenDim.h * 1.1) continue;
    const elWidth = bounds.x2 - bounds.x1;
    const elHeight = bounds.y2 - bounds.y1;
    if (elWidth < 10 || elHeight < 10) continue;

    // --- Phantom container filter (resolution-independent) ---
    const hasLabel = text || contentDesc || (resourceId && resourceId.length > 3);
    const className = get('class');

    // Full-screen containers spanning >75% width and >25% height are layout wrappers
    if (elWidth > screenDim.w * 0.75 && elHeight > screenDim.h * 0.25) continue;

    // Large unlabeled wrappers: no text/desc/rid, >50% width and >15% height
    if (!hasLabel && elWidth > screenDim.w * 0.5 && elHeight > screenDim.h * 0.15) continue;

    // Compose/RN phantom nodes: short class name, no label, area > 5% of screen
    const isShortClassName = className.length <= 3 && !className.includes('.');
    if (isShortClassName && !hasLabel && (elWidth * elHeight) > (screenDim.w * screenDim.h * 0.05)) continue;

    const base = {
      className: get('class'),
      text,
      contentDesc,
      resourceId,
      bounds,
      boundsStr,
      packageName: pkg,
    };

    if (editable) {
      const action = { ...base, type: ACTION_TYPES.TYPE, priority: 0 };
      action.priority = scorePriority(action);
      action.key = actionKey(action);
      if (!triedActions.has(action.key)) actions.push(action);
    }

    if (clickable && !editable) {
      const action = { ...base, type: ACTION_TYPES.TAP, priority: 0 };
      action.priority = scorePriority(action);
      action.key = actionKey(action);
      if (!triedActions.has(action.key)) actions.push(action);

      // Long-press variant — tried after taps are exhausted
      const loc = `${base.bounds.cx},${base.bounds.cy}`;
      const lpAction = { ...base, type: ACTION_TYPES.LONG_PRESS, priority: 8 };
      lpAction.key = `long_press:${base.resourceId || ''}:${loc}`;
      if (!triedActions.has(lpAction.key)) actions.push(lpAction);
    }

    if (scrollable) {
      for (let scrollIdx = 1; scrollIdx <= 3; scrollIdx++) {
        const downKey = `scroll_down_${scrollIdx}`;
        if (!triedActions.has(downKey)) {
          actions.push({ ...base, type: ACTION_TYPES.SCROLL_DOWN, priority: 13 - scrollIdx, key: downKey });
          break;
        }
      }
      for (let scrollIdx = 1; scrollIdx <= 2; scrollIdx++) {
        const upKey = `scroll_up_${scrollIdx}`;
        if (!triedActions.has(upKey)) {
          actions.push({ ...base, type: ACTION_TYPES.SCROLL_UP, priority: 7 - scrollIdx, key: upKey });
          break;
        }
      }
    }
  }

  const backAction = { type: ACTION_TYPES.BACK, priority: 10, key: 'back', bounds: null };
  if (!triedActions.has(backAction.key)) actions.push(backAction);

  actions.sort((a, b) => b.priority - a.priority);
  return actions;
}

module.exports = { extract, scorePriority, actionKey, parseBounds, ACTION_TYPES };
