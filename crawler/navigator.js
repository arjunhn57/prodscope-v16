"use strict";

/**
 * navigator.js — App navigation structure detection and systematic visiting.
 *
 * Detects bottom nav, tab bar, and drawer menus from XML.
 * Provides section-by-section visiting for SURVEY mode.
 */

const { parseBounds } = require("./actions");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "navigator" });

/**
 * @typedef {Object} NavSection
 * @property {string} label - Visible text or content description
 * @property {string} actionKey - Action key (tap:resourceId:cx,cy)
 * @property {{ x1: number, y1: number, x2: number, y2: number, cx: number, cy: number }} bounds
 * @property {boolean} visited
 * @property {string|null} fingerprint - Screen fingerprint after visiting
 */

/**
 * @typedef {Object} NavigationStructure
 * @property {'bottom_nav'|'tab_bar'|'drawer'|'none'} type
 * @property {NavSection[]} sections
 * @property {boolean} hasDrawer
 * @property {{ actionKey: string, bounds: object }|null} drawerToggle
 */

/**
 * Detect the navigation structure of the app from the current screen XML.
 * Call once on the first meaningful screen after boot/auth.
 *
 * @param {string} xml - Current screen XML
 * @returns {NavigationStructure}
 */
function detectNavigationStructure(xml) {
  if (!xml) return _noNav();

  const bottomNav = _detectBottomNav(xml);
  if (bottomNav) return bottomNav;

  const tabBar = _detectTabBar(xml);
  if (tabBar) return tabBar;

  const drawer = _detectDrawer(xml);

  return {
    type: "none",
    sections: [],
    hasDrawer: !!drawer,
    drawerToggle: drawer,
  };
}

/**
 * Get the next unvisited section.
 * @param {NavigationStructure} nav
 * @returns {NavSection|null}
 */
function nextUnvisitedSection(nav) {
  if (!nav || !nav.sections) return null;
  return nav.sections.find((s) => !s.visited) || null;
}

/**
 * Mark a section as visited.
 * @param {NavigationStructure} nav
 * @param {number} index
 * @param {string} fp
 */
function markSectionVisited(nav, index, fp) {
  if (nav && nav.sections[index]) {
    nav.sections[index].visited = true;
    nav.sections[index].fingerprint = fp;
  }
}

/**
 * Count of visited / total sections.
 * @param {NavigationStructure} nav
 * @returns {{ visited: number, total: number }}
 */
function sectionCoverage(nav) {
  if (!nav || !nav.sections) return { visited: 0, total: 0 };
  return {
    visited: nav.sections.filter((s) => s.visited).length,
    total: nav.sections.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Detection helpers
// ─────────────────────────────────────────────────────────────────────────

function _noNav() {
  return { type: "none", sections: [], hasDrawer: false, drawerToggle: null };
}

function _detectBottomNav(xml) {
  // Strategy 1: Look for BottomNavigationView or similar container
  const hasBottomNavClass =
    /BottomNavigationView|BottomNavigation|BottomBar|bottom_navigation|bottomnavigation/i.test(xml);

  // Strategy 2: Look for a row of 3-5 clickable elements at the bottom of the screen
  const bottomElements = _findBottomRow(xml);

  if (!hasBottomNavClass && bottomElements.length < 3) return null;

  const sections = (hasBottomNavClass ? _extractNavChildren(xml, "bottom") : bottomElements).map(
    (el) => ({
      label: el.text || el.contentDesc || el.resourceId || "unknown",
      actionKey: `tap:${el.resourceId || ""}:${el.bounds.cx},${el.bounds.cy}`,
      bounds: el.bounds,
      visited: false,
      fingerprint: null,
    })
  );

  if (sections.length < 2 || sections.length > 7) return null;

  log.info({ sectionCount: sections.length, labels: sections.map((s) => s.label) }, "Bottom nav detected");

  return {
    type: "bottom_nav",
    sections,
    hasDrawer: false,
    drawerToggle: null,
  };
}

function _detectTabBar(xml) {
  const hasTabClass = /TabLayout|TabWidget|tab_layout/i.test(xml);
  if (!hasTabClass) return null;

  const topElements = _findTopRow(xml);
  if (topElements.length < 2) return null;

  const sections = topElements.map((el) => ({
    label: el.text || el.contentDesc || el.resourceId || "unknown",
    actionKey: `tap:${el.resourceId || ""}:${el.bounds.cx},${el.bounds.cy}`,
    bounds: el.bounds,
    visited: false,
    fingerprint: null,
  }));

  log.info({ tabCount: sections.length, labels: sections.map((s) => s.label) }, "Tab bar detected");

  return {
    type: "tab_bar",
    sections,
    hasDrawer: false,
    drawerToggle: null,
  };
}

function _detectDrawer(xml) {
  // Look for hamburger/menu icon in the top-left area
  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  let m;

  while ((m = nodeRegex.exec(xml)) !== null) {
    const attrs = m[1];
    if (!/clickable="true"/i.test(attrs)) continue;

    const desc = ((attrs.match(/content-desc="([^"]*)"/i) || [])[1] || "").toLowerCase();
    const rid = ((attrs.match(/resource-id="([^"]*)"/i) || [])[1] || "").toLowerCase();

    if (
      desc.includes("menu") ||
      desc.includes("navigation") ||
      desc.includes("drawer") ||
      desc.includes("hamburger") ||
      desc.includes("open drawer") ||
      rid.includes("drawer") ||
      rid.includes("hamburger") ||
      rid.includes("nav_toggle")
    ) {
      const boundsStr = (attrs.match(/bounds="([^"]*)"/i) || [])[1] || "";
      const bounds = parseBounds(boundsStr);
      if (bounds && bounds.cx < 200 && bounds.cy < 200) {
        log.info({ cx: bounds.cx, cy: bounds.cy }, "Drawer toggle detected");
        return {
          actionKey: `tap:${rid}:${bounds.cx},${bounds.cy}`,
          bounds,
        };
      }
    }
  }

  return null;
}

/**
 * Infer screen height from the maximum y2 bound in the XML.
 * Falls back to 2400 (modern default) if no bounds found.
 */
function _inferScreenHeight(xml) {
  let maxY = 0;
  const boundsRegex = /bounds="\[\d+,\d+\]\[\d+,(\d+)\]"/g;
  let m;
  while ((m = boundsRegex.exec(xml)) !== null) {
    const y2 = parseInt(m[1], 10);
    if (y2 > maxY) maxY = y2;
  }
  return maxY > 0 ? maxY : 2400;
}

/**
 * Find a row of clickable elements at the bottom of the screen (y > 80%).
 * These are likely bottom navigation items.
 */
function _findBottomRow(xml) {
  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  let m;
  const candidates = [];

  // Detect actual screen height from XML bounds to avoid hardcoded threshold
  const screenHeight = _inferScreenHeight(xml);
  const bottomThreshold = Math.floor(screenHeight * 0.80);

  while ((m = nodeRegex.exec(xml)) !== null) {
    const attrs = m[1];
    if (!/clickable="true"/i.test(attrs)) continue;

    const boundsStr = (attrs.match(/bounds="([^"]*)"/i) || [])[1] || "";
    const bounds = parseBounds(boundsStr);
    if (!bounds) continue;

    // Bottom 20% of screen
    if (bounds.cy < bottomThreshold) continue;

    // Reasonable size (not tiny decorative elements)
    const width = bounds.x2 - bounds.x1;
    const height = bounds.y2 - bounds.y1;
    if (width < 40 || height < 40) continue;
    if (width > 600) continue; // too wide = probably a banner, not a nav item

    const text = (attrs.match(/text="([^"]*)"/i) || [])[1] || "";
    const desc = (attrs.match(/content-desc="([^"]*)"/i) || [])[1] || "";
    const rid = (attrs.match(/resource-id="([^"]*)"/i) || [])[1] || "";
    const pkg = (attrs.match(/package="([^"]*)"/i) || [])[1] || "";

    if (pkg === "com.android.systemui") continue;

    candidates.push({ text, contentDesc: desc, resourceId: rid, bounds });
  }

  // Check if candidates form a row (similar Y positions, spaced across X)
  if (candidates.length < 3) return candidates;

  const avgY = candidates.reduce((sum, c) => sum + c.bounds.cy, 0) / candidates.length;
  const inRow = candidates.filter((c) => Math.abs(c.bounds.cy - avgY) < 80);

  return inRow.length >= 3 ? inRow : candidates;
}

/**
 * Find a row of clickable elements at the top of the screen (y < 20%).
 */
function _findTopRow(xml) {
  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  let m;
  const candidates = [];

  while ((m = nodeRegex.exec(xml)) !== null) {
    const attrs = m[1];
    if (!/clickable="true"/i.test(attrs)) continue;

    const boundsStr = (attrs.match(/bounds="([^"]*)"/i) || [])[1] || "";
    const bounds = parseBounds(boundsStr);
    if (!bounds) continue;

    if (bounds.cy > 400) continue; // top 20%

    const width = bounds.x2 - bounds.x1;
    const height = bounds.y2 - bounds.y1;
    if (width < 40 || height < 30) continue;

    const text = (attrs.match(/text="([^"]*)"/i) || [])[1] || "";
    const desc = (attrs.match(/content-desc="([^"]*)"/i) || [])[1] || "";
    const rid = (attrs.match(/resource-id="([^"]*)"/i) || [])[1] || "";

    candidates.push({ text, contentDesc: desc, resourceId: rid, bounds });
  }

  return candidates;
}

/**
 * Extract child clickable elements from a bottom/top navigation container.
 * Falls back to positional detection if container children aren't individually tagged.
 */
function _extractNavChildren(xml, position) {
  // Use the positional approach — it works for both native and Compose
  return position === "bottom" ? _findBottomRow(xml) : _findTopRow(xml);
}

/**
 * Build a NavigationStructure from vision-detected nav tabs.
 * Called when XML detection returns 'none' on a Compose/Flutter screen.
 *
 * @param {Array<{ label: string, x: number, y: number }>} tabs - Vision-detected tabs
 * @returns {NavigationStructure}
 */
function buildNavFromVision(tabs) {
  if (!tabs || tabs.length < 2) return _noNav();

  const sections = tabs.map((tab) => ({
    label: tab.label,
    actionKey: `tap:vision_nav:${tab.x},${tab.y}`,
    bounds: {
      x1: tab.x - 50, y1: tab.y - 40,
      x2: tab.x + 50, y2: tab.y + 40,
      cx: tab.x, cy: tab.y,
    },
    visited: false,
    fingerprint: null,
  }));

  log.info({ sectionCount: sections.length, labels: sections.map((s) => s.label) }, "Vision nav detected");

  return {
    type: "bottom_nav",
    sections,
    hasDrawer: false,
    drawerToggle: null,
  };
}

module.exports = {
  detectNavigationStructure,
  nextUnvisitedSection,
  markSectionVisited,
  sectionCoverage,
  buildNavFromVision,
};
