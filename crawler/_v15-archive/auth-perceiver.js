"use strict";

/**
 * auth-perceiver.js — Unified perception layer for auth screens.
 *
 * Takes a screenshot path + optional XML, returns a ScreenPerception object
 * describing every interactive element. Two paths, one output format:
 *
 *   XML path (native):  forms.detectForm() + extractButtons() → ScreenPerception
 *   Vision path (WebView/Compose): observation-first prompt → ScreenPerception
 *   Hybrid: both available → XML fields override, vision fills gaps
 */

const fs = require("fs");
const adb = require("./adb");
const vision = require("./vision");
const forms = require("./forms");
const { extractButtons } = require("./system-handlers");
const { hasValidationErrorText } = require("./auth-helpers");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "auth-perceiver" });

// ── Button role classification from label text ─────────────────────────
const BUTTON_ROLE_PATTERNS = [
  // Most specific compound patterns FIRST (before generic "login", "continue")
  { role: "use_email_button", pattern: /continue with email|sign.?in with email|log.?in with email|use email|email.*login|login.*email/i },
  { role: "use_phone_button", pattern: /continue with phone|sign.?in with phone|log.?in with phone|use phone/i },
  { role: "google_button",    pattern: /\bgoogle\b/i },
  { role: "facebook_button",  pattern: /\bfacebook\b|\bmeta\b/i },
  { role: "apple_button",     pattern: /\bapple\b/i },
  { role: "forgot_password_link", pattern: /\bforgot\b.*password/i },
  { role: "skip_button",      pattern: /\bskip\b|\bnot now\b|\bmaybe later\b|\blater\b|\bno thanks\b/i },
  { role: "signup_button",    pattern: /\bsign.?up\b|\bregister\b|\bcreate account\b/i },
  // Generic patterns LAST
  { role: "login_button",     pattern: /^(log.?in|sign.?in)$/i },
  { role: "login_button",     pattern: /\blog.?in\b|\bsign.?in\b/i },
  { role: "submit_button",    pattern: /\bsubmit\b/i },
  { role: "continue_button",  pattern: /\bcontinue\b|\bnext\b|\bproceed\b/i },
];

/**
 * Classify a button's semantic role from its label.
 * @param {string} label
 * @returns {string}
 */
function classifyButtonRole(label) {
  if (!label) return "unknown_button";
  for (const { role, pattern } of BUTTON_ROLE_PATTERNS) {
    if (pattern.test(label)) return role;
  }
  return "unknown_button";
}

/**
 * Map forms.js field type names to auth-action-selector field roles.
 * @param {string} formType - from forms.classifyField (e.g. "email", "password")
 * @returns {string}
 */
function fieldTypeToRole(formType) {
  const map = {
    email: "email_field",
    password: "password_field",
    phone: "phone_field",
    username: "username_field",
    otp: "otp_field",
    name: "name_field",
  };
  return map[formType] || "unknown_field";
}

/**
 * Detect screen type from XML text signals.
 * @param {string} xml
 * @returns {string}
 */
function detectScreenTypeFromXml(xml) {
  if (!xml) return "unknown";
  const lower = xml.toLowerCase();
  if (/otp|verification code|enter code/i.test(lower)) return "otp";
  // Method choice: compound "X with Y" patterns checked BEFORE generic login/signup
  if (/continue with (email|phone|google|apple|facebook)|sign.?in with (google|apple|facebook|phone)/i.test(lower)) return "method_choice";
  if (/sign.?up|register|create account/i.test(lower)) return "signup";
  if (/log.?in|sign.?in/i.test(lower)) return "login";
  return "unknown";
}

// ── XML-based perception ───────────────────────────────────────────────

/**
 * Build ScreenPerception from UIAutomator XML.
 * Reuses forms.detectForm() for fields, extractButtons() for buttons.
 *
 * @param {string} xml
 * @returns {object} ScreenPerception
 */
function perceiveFromXml(xml) {
  const perception = {
    screenType: "unknown",
    fields: [],
    buttons: [],
    hasError: false,
    errorText: null,
    isLoading: false,
    source: "xml",
  };

  if (!xml) return perception;

  // Fields via forms.js
  const formResult = forms.detectForm(xml);
  if (formResult.isForm) {
    perception.fields = formResult.fields.map((f) => ({
      role: fieldTypeToRole(f.type),
      x: f.bounds.cx,
      y: f.bounds.cy,
      bounds: f.bounds,
      filled: !!(f.text && f.text.length > 0),
      focused: false, // XML doesn't reliably indicate focus
      source: "xml",
    }));
  }

  // Buttons via system-handlers.js
  const xmlButtons = extractButtons(xml);
  perception.buttons = xmlButtons.map((b) => ({
    role: classifyButtonRole(b.label),
    label: b.label,
    x: b.bounds.cx,
    y: b.bounds.cy,
    bounds: b.bounds,
    source: "xml",
  }));

  // Screen type
  perception.screenType = detectScreenTypeFromXml(xml);

  // Error detection
  perception.hasError = hasValidationErrorText(xml);
  if (perception.hasError) {
    // Try to extract the actual error text
    const errorMatch = xml.match(/text="([^"]*(?:invalid|incorrect|error|failed|wrong|required|try again|not found|already)[^"]*)"/i);
    perception.errorText = errorMatch ? errorMatch[1] : null;
  }

  log.info({
    fields: perception.fields.length,
    buttons: perception.buttons.length,
    screenType: perception.screenType,
    hasError: perception.hasError,
  }, "XML perception");

  return perception;
}

// ── Vision-based perception ────────────────────────────────────────────

/**
 * Build the observation-first vision prompt.
 * Asks "what elements are on screen?" — not "what should I tap?"
 *
 * @param {number} screenW
 * @param {number} screenH
 * @returns {string}
 */
function buildAuthPerceptionPrompt(screenW, screenH) {
  return `Analyze this Android login/signup screen (${screenW}x${screenH} px). List all input fields and buttons. Coordinates are PIXELS (x=0 left, x=${screenW} right, y=0 top, y=${screenH} bottom).

Field roles: email_field, password_field, phone_field, otp_field, name_field, username_field, unknown_field
Button roles: login_button, signup_button, submit_button, continue_button, use_email_button, use_phone_button, google_button, facebook_button, apple_button, skip_button, forgot_password_link

Return ONLY compact JSON (no comments, no extra keys):
{"screenType":"login","fields":[{"role":"email_field","x":540,"y":800,"filled":false}],"buttons":[{"role":"login_button","label":"Sign In","x":540,"y":1200}],"hasError":false,"errorText":null,"isLoading":false}`;
}

// Valid screen types from vision responses
const VALID_SCREEN_TYPES = new Set([
  "login", "signup", "otp", "method_choice", "post_auth", "unknown",
]);

/**
 * Parse and validate a vision perception response.
 *
 * @param {string} text - Raw vision response
 * @returns {object|null} Validated ScreenPerception or null
 */
function parseVisionPerception(text) {
  const { w: SW, h: SH } = adb.getScreenSize();
  const MARGIN = 10;
  let obj;
  try {
    // Strip markdown fences
    let cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    // Extract JSON object if surrounded by non-JSON text
    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
    }
    obj = JSON.parse(cleaned);
  } catch (e) {
    log.warn({ err: e.message, rawLen: text.length, rawPreview: text.slice(0, 200) },
      "Failed to parse vision perception response");
    return null;
  }

  // Validate screenType
  if (!obj.screenType || !VALID_SCREEN_TYPES.has(obj.screenType)) {
    obj.screenType = "unknown";
  }

  // Validate fields
  const VALID_FIELD_ROLES = new Set([
    "email_field", "password_field", "phone_field", "otp_field",
    "name_field", "username_field", "unknown_field",
  ]);
  if (!Array.isArray(obj.fields)) obj.fields = [];
  obj.fields = obj.fields.filter((f) => {
    if (typeof f.x !== "number" || typeof f.y !== "number") return false;
    // Convert percentages to pixels
    if (f.x <= 100 && f.y <= 100) {
      f.x = Math.round((f.x / 100) * SW);
      f.y = Math.round((f.y / 100) * SH);
    }
    f.x = Math.max(MARGIN, Math.min(SW - MARGIN, Math.round(f.x)));
    f.y = Math.max(MARGIN, Math.min(SH - MARGIN, Math.round(f.y)));
    if (!f.role || !VALID_FIELD_ROLES.has(f.role)) f.role = "unknown_field";
    f.filled = !!f.filled;
    f.focused = !!f.focused;
    f.source = "vision";
    return true;
  });

  // Validate buttons
  const VALID_BUTTON_ROLES = new Set([
    "submit_button", "continue_button", "login_button", "signup_button",
    "next_button", "google_button", "facebook_button", "apple_button",
    "use_email_button", "use_phone_button", "skip_button",
    "forgot_password_link", "unknown_button",
  ]);
  if (!Array.isArray(obj.buttons)) obj.buttons = [];
  obj.buttons = obj.buttons.filter((b) => {
    if (typeof b.x !== "number" || typeof b.y !== "number") return false;
    if (b.x <= 100 && b.y <= 100) {
      b.x = Math.round((b.x / 100) * SW);
      b.y = Math.round((b.y / 100) * SH);
    }
    b.x = Math.max(MARGIN, Math.min(SW - MARGIN, Math.round(b.x)));
    b.y = Math.max(MARGIN, Math.min(SH - MARGIN, Math.round(b.y)));
    if (!b.role || !VALID_BUTTON_ROLES.has(b.role)) b.role = "unknown_button";
    if (!b.label) b.label = "";
    b.source = "vision";
    return true;
  });

  // Validate error fields
  obj.hasError = !!obj.hasError;
  if (typeof obj.errorText !== "string") obj.errorText = null;
  obj.isLoading = !!obj.isLoading;
  obj.source = "vision";

  return obj;
}

/**
 * Build ScreenPerception from a screenshot using vision AI.
 * Uses callVisionRaw() for a direct API call with the perception-specific
 * prompt and 800 token limit (bypasses getVisionGuidance wrapper).
 *
 * @param {string} screenshotPath
 * @returns {Promise<object|null>} ScreenPerception or null if vision fails/exhausted
 */
async function perceiveFromVision(screenshotPath) {
  if (!screenshotPath || !fs.existsSync(screenshotPath)) return null;
  if (vision.budgetRemaining() <= 0) {
    log.info("Vision budget exhausted — skipping vision perception");
    return null;
  }

  const { w: SW, h: SH } = adb.getScreenSize();
  const prompt = buildAuthPerceptionPrompt(SW, SH);

  // Direct API call — bypasses getVisionGuidance's wrapper prompt and 400-token limit
  const raw = await vision.callVisionRaw(screenshotPath, prompt, { maxTokens: 800 });
  if (!raw) return null;

  // Parse the perception JSON directly
  const parsed = parseVisionPerception(raw);
  if (parsed) {
    log.info({
      screenType: parsed.screenType,
      fields: parsed.fields.length,
      buttons: parsed.buttons.length,
    }, "Vision perception parsed");
    return parsed;
  }

  // Direct parse failed — return null (navigator will retry)
  log.warn("Direct perception parse failed — will retry on next iteration");
  return null;
}

/**
 * Convert vision.getVisionGuidance() output into ScreenPerception format.
 * Bridge function until we add a direct API call with the perception prompt.
 *
 * @param {object} guidance - { screenType, mainActions[], isLoading, observation }
 * @returns {object} ScreenPerception
 */
function convertVisionGuidanceToPerception(guidance) {
  const perception = {
    screenType: "unknown",
    fields: [],
    buttons: [],
    hasError: false,
    errorText: null,
    isLoading: !!guidance.isLoading,
    source: "vision_bridge",
  };

  // Map screenType
  const st = (guidance.screenType || "").toLowerCase();
  if (st === "login" || st === "form") perception.screenType = "login";
  else if (st.includes("signup") || st.includes("register")) perception.screenType = "signup";
  else perception.screenType = st || "unknown";

  // Classify each mainAction as either a field or a button based on description
  for (const action of (guidance.mainActions || [])) {
    const desc = (action.description || "").toLowerCase();
    const coords = { x: action.x, y: action.y };

    const isFieldDesc = /input|field|text.?box|type|enter\s|focus|cursor|fill|placeholder/i.test(desc) &&
      !/\bbutton\b|submit|continue|next|proceed/i.test(desc);

    if (isFieldDesc) {
      // Determine field role from description
      let role = "unknown_field";
      if (/password/i.test(desc)) role = "password_field";
      else if (/email/i.test(desc)) role = "email_field";
      else if (/phone/i.test(desc)) role = "phone_field";
      else if (/otp|code|verification/i.test(desc)) role = "otp_field";
      else if (/user.?name|login.*name/i.test(desc)) role = "username_field";
      else if (/name/i.test(desc)) role = "name_field";

      perception.fields.push({
        role,
        ...coords,
        filled: /filled|has text|already.*typed|content/i.test(desc),
        focused: /focus|cursor|active|selected/i.test(desc),
        source: "vision",
      });
    } else {
      // It's a button
      const role = classifyButtonRole(action.description || "");
      perception.buttons.push({
        role,
        label: action.description || "",
        ...coords,
        source: "vision",
      });
    }
  }

  // Check observation text for error indicators
  const obs = guidance.observation || "";
  if (/error|invalid|incorrect|failed|wrong/i.test(obs)) {
    perception.hasError = true;
    perception.errorText = obs;
  }

  return perception;
}

// ── Hybrid perception (merge XML + vision) ─────────────────────────────

/**
 * Merge XML and vision perceptions. XML fields take priority (exact bounds),
 * vision fills gaps (WebView elements not in XML).
 *
 * @param {object} xmlPerception
 * @param {object} visionPerception
 * @returns {object} Merged ScreenPerception
 */
function mergePerceptions(xmlPerception, visionPerception) {
  // If XML has fields, prefer them (pixel-perfect bounds)
  const fields = xmlPerception.fields.length > 0
    ? xmlPerception.fields
    : visionPerception.fields;

  // Merge buttons: XML buttons + vision-only buttons (not near any XML button)
  const xmlButtons = xmlPerception.buttons;
  const visionOnlyButtons = (visionPerception.buttons || []).filter((vb) => {
    // Keep vision button if no XML button is within 100px
    return !xmlButtons.some((xb) =>
      Math.abs(xb.x - vb.x) < 100 && Math.abs(xb.y - vb.y) < 100
    );
  });

  return {
    screenType: xmlPerception.screenType !== "unknown"
      ? xmlPerception.screenType
      : visionPerception.screenType,
    fields,
    buttons: [...xmlButtons, ...visionOnlyButtons],
    hasError: xmlPerception.hasError || visionPerception.hasError,
    errorText: xmlPerception.errorText || visionPerception.errorText,
    isLoading: xmlPerception.isLoading || visionPerception.isLoading,
    source: "hybrid",
  };
}

// ── Main entry point ───────────────────────────────────────────────────

/**
 * Perceive an auth screen from all available signals.
 *
 * @param {string|null} screenshotPath - Path to screenshot PNG
 * @param {string|null} xml - UIAutomator XML dump (null for WebView)
 * @param {{ forceVision?: boolean }} [opts]
 * @returns {Promise<object>} ScreenPerception
 */
async function perceive(screenshotPath, xml, opts = {}) {
  const xmlPerception = perceiveFromXml(xml);
  const hasXmlFields = xmlPerception.fields.length > 0;

  // If XML has fields and we're not forced to use vision, XML is sufficient
  if (hasXmlFields && !opts.forceVision) {
    return xmlPerception;
  }

  // Vision path: WebView, Compose, or poor XML
  const visionPerception = await perceiveFromVision(screenshotPath);
  if (!visionPerception) {
    // Vision failed/exhausted — return what XML has (may be empty)
    return xmlPerception;
  }

  // Hybrid: merge if XML has partial info
  if (hasXmlFields) {
    return mergePerceptions(xmlPerception, visionPerception);
  }

  return visionPerception;
}

module.exports = {
  perceive,
  perceiveFromXml,
  perceiveFromVision,
  mergePerceptions,
  // Exported for testing
  classifyButtonRole,
  fieldTypeToRole,
  detectScreenTypeFromXml,
  buildAuthPerceptionPrompt,
  parseVisionPerception,
  convertVisionGuidanceToPerception,
};
