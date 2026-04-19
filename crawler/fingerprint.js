/**
 * fingerprint.js — Deterministic screen fingerprinting
 * Computes a stable hash from UI XML structure so that the same logical
 * screen always produces the same fingerprint, regardless of volatile
 * attributes like scroll position or focus state.
 */

const crypto = require('crypto');

/**
 * Attributes to KEEP for fingerprinting (structural identity).
 * Everything else (bounds, focused, selected, checked, scrollX/Y, etc.) is stripped.
 */
const STRUCTURAL_ATTRS = [
  'class',
  'package',
  'resource-id',
  'text',
  'content-desc',
  'checkable',
  'clickable',
  'enabled',
  'focusable',
  'scrollable',
  'long-clickable',
  'password'
];

/**
 * Extract structural signature lines from raw XML.
 * Each UI node becomes a single canonical line:
 *   <class resource-id="..." text="..." clickable="...">
 * Volatile attributes are stripped so the same screen always fingerprints identically.
 */
function normalize(xml) {
  if (!xml) return '';

  const lines = [];
  // Match individual XML node tags (self-closing or opening)
  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  let m;
  while ((m = nodeRegex.exec(xml)) !== null) {
    const attrString = m[1];
    const parts = [];

    for (const attr of STRUCTURAL_ATTRS) {
      const attrMatch = attrString.match(new RegExp(`${attr}="([^"]*)"`));
      if (attrMatch) {
        let val = attrMatch[1];
        
        // Normalize text/desc/id to lower case and mask any numbers
        // This prevents things like "10:45 AM" or "32 unread messages" from breaking the screen identity
        if (['text', 'content-desc', 'resource-id'].includes(attr)) {
          val = val.toLowerCase()
                   .replace(/\d/g, '#')
                   .replace(/\s*[ap]m\b/g, '') // strip am/pm suffixes
                   .trim();
        }
        
        parts.push(`${attr}="${val}"`);
      }
    }
    if (parts.length > 0) {
      parts.sort(); // Sort attributes alphabetically to ensure deterministic order regardless of original XML order
      lines.push(parts.join(' '));
    }
  }
  return lines.join('\n');
}

/**
 * Compute a deterministic fingerprint hash for a UI XML dump.
 * @param {string} xml - Raw uiautomator XML
 * @returns {string} Hex SHA-256 hash (first 16 chars for brevity)
 */
function compute(xml) {
  const normalized = normalize(xml);
  if (!normalized) return 'empty_screen';
  return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 16);
}

/**
 * Compute a FUZZY fingerprint — same structure, ignoring text content.
 * Two product pages with different products → same fuzzy FP.
 * A feed with different posts → same fuzzy FP.
 *
 * @param {string} xml - Raw uiautomator XML
 * @param {string} activity - Current activity name
 * @returns {string} Hex SHA-256 hash (first 16 chars)
 */
function computeFuzzy(xml, activity) {
  if (!xml) return 'empty_screen';

  const classNames = [];
  const resourceIds = [];
  let clickableCount = 0;
  let scrollableCount = 0;
  let editTextCount = 0;

  const nodeRegex = /<node\s+([^>]+)\/?\>/g;
  let m;
  while ((m = nodeRegex.exec(xml)) !== null) {
    const attrs = m[1];
    const clsMatch = attrs.match(/class="([^"]*)"/i);
    const cls = clsMatch ? clsMatch[1] : '';
    if (cls) classNames.push(cls);
    const ridMatch = attrs.match(/resource-id="([^"]*)"/i);
    const rid = ridMatch ? ridMatch[1] : '';
    if (rid) resourceIds.push(rid);
    if (/clickable="true"/i.test(attrs)) clickableCount++;
    if (/scrollable="true"/i.test(attrs)) scrollableCount++;
    if (/edittext/i.test(cls)) editTextCount++;
  }

  classNames.sort();
  resourceIds.sort();

  const signature = [
    classNames.join(','),
    resourceIds.join(','),
    'c:' + clickableCount,
    's:' + scrollableCount,
    'e:' + editTextCount,
    'a:' + (activity || '').toLowerCase(),
  ].join('|');

  return crypto.createHash('sha256').update(signature).digest('hex').substring(0, 16);
}

module.exports = { compute, computeFuzzy, normalize };
