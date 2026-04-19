/**
 * forms.js - Generic form detection and credential/data filling
 *
 * Detects forms on any screen using Android inputType attributes, hint text,
 * and structural XML patterns. Supports auth forms, search, address, profile
 * edit, payment, and generic data entry.
 *
 * Classification priority:
 *  1. Android inputType flags (most reliable, set by developer)
 *  2. password="true" attribute
 *  3. Hint text / content-desc / resource-id keywords
 *  4. Screen context inference (fallback for unlabeled fields)
 */

const adb = require('./adb');
const { parseBounds } = require('./actions');
const { logger } = require("../lib/logger");
const log = logger.child({ component: "forms" });

// -------------------------------------------------------------------------
// Android inputType flag → field type mapping
// See: https://developer.android.com/reference/android/text/InputType
// -------------------------------------------------------------------------

const INPUT_TYPE_MAP = {
  // Text variations
  'textEmailAddress':    'email',
  'textEmailSubject':    'email_subject',
  'textPassword':        'password',
  'textVisiblePassword': 'password',
  'textWebPassword':     'password',
  'textPersonName':      'name',
  'textPostalAddress':   'address',
  'textUri':             'url',
  'textWebEditText':     'text',
  'textFilter':          'search',
  'textPhonetic':        'name',
  'textAutoComplete':    'text',
  // Number variations
  'numberPassword':      'password',
  'phone':               'phone',
  'number':              'number',
  'numberDecimal':       'number',
  'numberSigned':        'number',
  // Date/time
  'date':                'date',
  'datetime':            'datetime',
  'time':                'time',
};

// Numeric inputType values (hex) for common types
const INPUT_TYPE_FLAGS = {
  0x00000001: 'text',            // TYPE_CLASS_TEXT
  0x00000021: 'email',           // TYPE_TEXT_VARIATION_EMAIL_ADDRESS
  0x000000e1: 'password',        // TYPE_TEXT_VARIATION_PASSWORD
  0x000000d1: 'password',        // TYPE_TEXT_VARIATION_WEB_PASSWORD
  0x00000081: 'password',        // TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
  0x00000003: 'phone',           // TYPE_CLASS_PHONE
  0x00000002: 'number',          // TYPE_CLASS_NUMBER
  0x00000012: 'password',        // TYPE_NUMBER_VARIATION_PASSWORD
  0x00000060: 'name',            // TYPE_TEXT_VARIATION_PERSON_NAME
  0x00000014: 'date',            // TYPE_CLASS_DATETIME | TYPE_DATETIME_VARIATION_DATE
};

// -------------------------------------------------------------------------
// Keyword-based field classification (fallback when inputType unavailable)
// -------------------------------------------------------------------------

const FIELD_KEYWORDS = {
  email:    ['email', 'e-mail', 'mail', 'email address'],
  phone:    ['phone', 'mobile', 'mobile number', 'phone number', 'tel', 'contact number'],
  username: ['username', 'user name', 'user_name', 'login', 'account', 'userid', 'user id'],
  password: ['password', 'passwd', 'pass_word', 'passcode', 'pin', 'secret'],
  otp:      ['otp', 'verification code', 'code', 'enter code', 'one time password', 'verification', 'verify'],
  name:     ['full name', 'first name', 'last name', 'name', 'display name', 'real name'],
  address:  ['address', 'street', 'city', 'state', 'zip', 'postal', 'zip code', 'country'],
  search:   ['search', 'find', 'look up', 'query'],
  url:      ['url', 'website', 'web address', 'link'],
  card:     ['card number', 'credit card', 'debit card', 'cvv', 'cvc', 'expiry', 'exp date'],
  amount:   ['amount', 'price', 'cost', 'total', 'payment'],
};

// -------------------------------------------------------------------------
// Screen intent detection — what kind of form is this?
// -------------------------------------------------------------------------

const FORM_INTENTS = {
  auth:     /(sign in|login|log in|sign up|register|create account|continue|verify|password|email|phone|otp)/i,
  search:   /(search|find|discover|explore|look up|browse)/i,
  address:  /(address|shipping|billing|delivery|location|city|state|zip)/i,
  payment:  /(payment|checkout|pay|credit card|debit card|card number|cvv)/i,
  profile:  /(profile|edit profile|account|personal info|update|bio|about)/i,
  contact:  /(contact|message|compose|send|write|feedback|support)/i,
};

function detectFormIntent(xml) {
  if (!xml) return { type: 'unknown', intents: {} };
  const lower = xml.toLowerCase();
  const intents = {};
  let primary = 'unknown';
  let maxScore = 0;

  for (const [intent, pattern] of Object.entries(FORM_INTENTS)) {
    const matches = lower.match(pattern);
    intents[intent] = !!matches;
    if (matches && intent !== primary) {
      // Simple priority: auth > payment > address > profile > search > contact
      const priority = { auth: 6, payment: 5, address: 4, profile: 3, search: 2, contact: 1 };
      if ((priority[intent] || 0) > maxScore) {
        primary = intent;
        maxScore = priority[intent] || 0;
      }
    }
  }

  return { type: primary, intents };
}

// -------------------------------------------------------------------------
// Field classification
// -------------------------------------------------------------------------

/**
 * Classify a field using inputType attribute (primary signal).
 * @param {string} inputTypeStr - Raw inputType attribute value
 * @returns {string|null} Field type or null if unrecognized
 */
function classifyByInputType(inputTypeStr) {
  if (!inputTypeStr) return null;

  // Try named inputType (e.g., "textEmailAddress")
  for (const [key, type] of Object.entries(INPUT_TYPE_MAP)) {
    if (inputTypeStr.toLowerCase().includes(key.toLowerCase())) {
      return type;
    }
  }

  // Try numeric inputType (hex or decimal)
  const numVal = parseInt(inputTypeStr, inputTypeStr.startsWith('0x') ? 16 : 10);
  if (!isNaN(numVal) && INPUT_TYPE_FLAGS[numVal]) {
    return INPUT_TYPE_FLAGS[numVal];
  }

  return null;
}

/**
 * Classify a field using keyword matching on combined text signals.
 * @param {string} combined - Concatenated resourceId + text + hint + contentDesc
 * @param {boolean} isPasswordAttr - Whether password="true" is set
 * @returns {string} Field type
 */
function classifyByKeywords(combined, isPasswordAttr) {
  if (isPasswordAttr) return 'password';
  if (!combined) return 'unknown';

  const lower = combined.toLowerCase();

  // Check in priority order
  if (FIELD_KEYWORDS.password.some((k) => lower.includes(k))) return 'password';
  if (FIELD_KEYWORDS.otp.some((k) => lower.includes(k))) return 'otp';
  if (FIELD_KEYWORDS.email.some((k) => lower.includes(k))) return 'email';
  if (FIELD_KEYWORDS.phone.some((k) => lower.includes(k))) return 'phone';
  if (FIELD_KEYWORDS.card.some((k) => lower.includes(k))) return 'card';
  if (FIELD_KEYWORDS.username.some((k) => lower.includes(k))) return 'username';
  if (FIELD_KEYWORDS.search.some((k) => lower.includes(k))) return 'search';
  if (FIELD_KEYWORDS.name.some((k) => lower.includes(k))) return 'name';
  if (FIELD_KEYWORDS.address.some((k) => lower.includes(k))) return 'address';
  if (FIELD_KEYWORDS.url.some((k) => lower.includes(k))) return 'url';
  if (FIELD_KEYWORDS.amount.some((k) => lower.includes(k))) return 'amount';

  return 'unknown';
}

/**
 * Classify a single field using all available signals.
 */
function classifyField(attrs) {
  // Priority 1: Android inputType attribute
  const inputTypeResult = classifyByInputType(attrs.inputType);
  if (inputTypeResult) return inputTypeResult;

  // Priority 2: password="true" attribute
  if (attrs.isPasswordAttr) return 'password';

  // Priority 3: Keyword matching on text signals
  const combined = `${attrs.resourceId} ${attrs.text} ${attrs.hint} ${attrs.contentDesc}`.toLowerCase();
  return classifyByKeywords(combined, false);
}

// -------------------------------------------------------------------------
// Form detection
// -------------------------------------------------------------------------

/**
 * Detect if the current screen contains a form and extract its fields.
 * Works for any form type: auth, search, address, payment, profile, etc.
 *
 * @param {string} xml - UI XML dump
 * @returns {{ isForm: boolean, formType: string, fields: Array<object> }}
 */
function detectForm(xml) {
  if (!xml) return { isForm: false, formType: 'unknown', fields: [] };

  const formIntent = detectFormIntent(xml);
  const rawFields = [];
  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  let m;

  while ((m = nodeRegex.exec(xml)) !== null) {
    const attrs = m[1];
    const get = (name) => {
      const match = attrs.match(new RegExp(`${name}="([^"]*)"`));
      return match ? match[1] : '';
    };

    const cls = get('class').toLowerCase();
    const isEdit = cls.includes('edittext') || cls.includes('autocompleteedittext') ||
                   get('editable') === 'true';
    if (!isEdit) continue;

    const resourceId = get('resource-id');
    const text = get('text');
    const hint = get('content-desc');
    const inputType = get('inputType');
    const isPasswordAttr = get('password') === 'true';
    const boundsStr = get('bounds');
    const bounds = parseBounds(boundsStr);
    if (!bounds) continue;

    const fieldType = classifyField({
      resourceId, text, hint, contentDesc: hint, inputType, isPasswordAttr,
    });

    rawFields.push({
      type: fieldType,
      bounds,
      resourceId,
      hint: `${resourceId} ${text} ${hint}`.trim(),
      inputType,
      isPasswordAttr,
      text,
    });
  }

  if (!rawFields.length) return { isForm: false, formType: formIntent.type, fields: [] };

  // Sort by Y position (top to bottom), then X
  const sorted = [...rawFields].sort((a, b) => {
    if (a.bounds.cy !== b.bounds.cy) return a.bounds.cy - b.bounds.cy;
    return a.bounds.cx - b.bounds.cx;
  });

  // Context-based inference for remaining 'unknown' fields
  inferUnknownFields(sorted, formIntent);

  const fields = sorted.map((f) => ({
    type: f.type,
    bounds: f.bounds,
    resourceId: f.resourceId,
    hint: f.hint,
    inputType: f.inputType,
  }));

  // A form needs at least one classified field, OR 2+ edit fields in a form-like context
  const knownCount = fields.filter((f) => f.type !== 'unknown').length;
  const isForm = knownCount > 0 || (fields.length >= 2 && formIntent.type !== 'unknown');

  return { isForm, formType: formIntent.type, fields };
}

/**
 * Infer types for 'unknown' fields using form intent and positional context.
 */
function inferUnknownFields(sortedFields, formIntent) {
  const unknowns = sortedFields.filter((f) => f.type === 'unknown');
  if (unknowns.length === 0) return;

  const knowns = new Set(sortedFields.filter((f) => f.type !== 'unknown').map((f) => f.type));

  if (formIntent.type === 'auth') {
    // Auth form inference
    for (const field of unknowns) {
      if (!knowns.has('email') && !knowns.has('phone') && !knowns.has('username')) {
        if (formIntent.intents.phone && !formIntent.intents.email) {
          field.type = 'phone';
        } else {
          field.type = 'email';
        }
        knowns.add(field.type);
      } else if (!knowns.has('password') && formIntent.intents.auth) {
        field.type = 'password';
        knowns.add('password');
      } else if (!knowns.has('otp') && formIntent.intents.auth) {
        field.type = 'otp';
        knowns.add('otp');
      }
    }
  } else if (formIntent.type === 'search') {
    for (const field of unknowns) {
      field.type = 'search';
    }
  } else if (formIntent.type === 'address') {
    for (const field of unknowns) {
      field.type = 'address';
    }
  } else if (formIntent.type === 'profile') {
    for (const field of unknowns) {
      if (!knowns.has('name')) {
        field.type = 'name';
        knowns.add('name');
      } else {
        field.type = 'text';
      }
    }
  }
}

// -------------------------------------------------------------------------
// Form filling
// -------------------------------------------------------------------------

/** Default test data for non-auth fields */
const DEFAULT_TEST_DATA = {
  name:    'Test User',
  address: '123 Test Street',
  search:  'test query',
  url:     'https://example.com',
  number:  '42',
  amount:  '9.99',
  date:    '01/01/2025',
  text:    'Test input',
};

/**
 * Fill a detected form with credentials or test data.
 * @param {Array} fields - From detectForm()
 * @param {object} credentials - { username, email, phone, password, otp } from job opts
 * @param {Function} sleepFn - async sleep function
 * @returns {Array<object>} Actions taken
 */
async function fillForm(fields, credentials, sleepFn) {
  const creds = credentials || {};
  const actionsTaken = [];

  const valueMap = {
    password:  creds.password || '',
    email:     creds.email || creds.username || '',
    phone:     creds.phone || '',
    otp:       creds.otp || '',
    username:  creds.username || creds.email || creds.phone || '',
    name:      creds.name || DEFAULT_TEST_DATA.name,
    address:   creds.address || DEFAULT_TEST_DATA.address,
    search:    creds.searchQuery || DEFAULT_TEST_DATA.search,
    url:       DEFAULT_TEST_DATA.url,
    number:    DEFAULT_TEST_DATA.number,
    amount:    DEFAULT_TEST_DATA.amount,
    date:      DEFAULT_TEST_DATA.date,
    text:      DEFAULT_TEST_DATA.text,
    card:      '', // Never auto-fill payment card data
  };

  const sorted = [...fields].sort((a, b) => a.bounds.cy - b.bounds.cy);

  for (const field of sorted) {
    const value = valueMap[field.type] || '';
    if (!value) continue;

    // Skip already-filled fields
    if (field.text && field.text.length > 0 && field.type !== 'password') continue;

    adb.tap(field.bounds.cx, field.bounds.cy);
    await sleepFn(500);

    // Clear existing content
    adb.run('adb shell input keyevent KEYCODE_MOVE_END', { ignoreError: true });
    adb.run('adb shell input keyevent --longpress $(printf "KEYCODE_DEL %.0s" {1..50})', { ignoreError: true });
    adb.inputText(value);
    await sleepFn(300);

    actionsTaken.push({ type: 'fill', field: field.type, resourceId: field.resourceId });
    log.info({ fieldType: field.type, resourceId: field.resourceId || "no_resource_id" }, "Filled form field");
  }

  return actionsTaken;
}

/**
 * Fill a search field with a test query.
 * @param {string} xml - Current screen XML
 * @param {Function} sleepFn - async sleep
 * @returns {Promise<{ filled: boolean, query: string }>}
 */
async function fillSearchField(xml, sleepFn) {
  if (!xml) return { filled: false, query: '' };

  const { parseBounds } = require('./actions');
  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  let m;

  while ((m = nodeRegex.exec(xml)) !== null) {
    const attrs = m[1];
    const cls = ((attrs.match(/class="([^"]*)"/i) || [])[1] || '').toLowerCase();
    const rid = ((attrs.match(/resource-id="([^"]*)"/i) || [])[1] || '').toLowerCase();
    const desc = ((attrs.match(/content-desc="([^"]*)"/i) || [])[1] || '').toLowerCase();

    const isSearch = cls.includes('edittext') && (
      rid.includes('search') || desc.includes('search') || /search/i.test(attrs)
    );

    if (isSearch) {
      const boundsStr = (attrs.match(/bounds="([^"]*)"/i) || [])[1] || '';
      const bounds = parseBounds(boundsStr);
      if (!bounds) continue;

      const query = 'test';
      adb.tap(bounds.cx, bounds.cy);
      await sleepFn(500);
      adb.inputText(query);
      await sleepFn(300);
      adb.pressEnter();
      await sleepFn(1000);
      log.info({ query }, "Filled search field");
      return { filled: true, query };
    }
  }

  return { filled: false, query: '' };
}

module.exports = {
  detectForm,
  fillForm,
  fillSearchField,
  // Exported for testing
  classifyField,
  classifyByInputType,
  classifyByKeywords,
  detectFormIntent,
  FIELD_KEYWORDS,
  INPUT_TYPE_MAP,
};
