"use strict";

/**
 * Tests for v17/drivers/clickable-graph.js.
 *
 * Rule (from plan nifty-nibbling-widget.md): every test pulls XML fixtures from
 * ≥3 different apps to prevent biztoso-overfitting. Synthetic fixtures are
 * constructed to mirror real framework idioms (Jetpack Compose BasicTextField,
 * Android Views EditText, Material TextInputEditText, React Native
 * ReactEditText) rather than dumped verbatim.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseClickableGraph,
  PASSWORD_ID_REGEX,
  EMAIL_ID_REGEX,
} = require("../clickable-graph");

// ── XML construction helpers ───────────────────────────────────────────

function wrap(...nodes) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<hierarchy rotation="0">\n${nodes.join("\n")}\n</hierarchy>`;
}

function node({
  text = "",
  desc = "",
  resourceId = "",
  cls = "android.widget.Button",
  pkg = "com.example",
  clickable = true,
  password = false,
  hint = "",
  bounds = "[0,0][0,0]",
}) {
  return (
    `<node text="${text}" resource-id="${resourceId}" class="${cls}" ` +
    `package="${pkg}" content-desc="${desc}" clickable="${clickable}" ` +
    `password="${password}" hint="${hint}" bounds="${bounds}" />`
  );
}

// ── Email-form fixtures (3 apps × 3 frameworks) ────────────────────────
//
// Each fixture represents a realistic login screen layout. Resource-ids are
// the developer-set English identifiers that real apps expose. UIAutomator
// does NOT expose input-type, so password detection relies on the
// `password="true"` attribute; email detection relies on EditText + resource-id
// regex (covered by EMAIL_ID_REGEX). Apps whose email field doesn't match
// (e.g. LinkedIn's "session_key") fall through to the A.1.5 classifier.

const biztosoEmailFormXml = wrap(
  node({ text: "Welcome back", clickable: false, bounds: "[100,200][980,260]", cls: "android.widget.TextView", pkg: "com.biztoso.app" }),
  node({ resourceId: "com.biztoso.app:id/email_input", cls: "androidx.compose.foundation.text.BasicTextField", pkg: "com.biztoso.app", bounds: "[80,500][1000,620]", hint: "Email" }),
  node({ resourceId: "com.biztoso.app:id/password_input", cls: "androidx.compose.foundation.text.BasicTextField", pkg: "com.biztoso.app", password: true, bounds: "[80,680][1000,800]", hint: "Password" }),
  node({ text: "Sign in", clickable: true, bounds: "[80,900][1000,1020]", pkg: "com.biztoso.app" }),
);

const gmailEmailFormXml = wrap(
  node({ text: "Sign in", clickable: false, bounds: "[400,120][680,200]", cls: "android.widget.TextView", pkg: "com.google.android.gm" }),
  node({ resourceId: "com.google.android.gm:id/email_address_view", cls: "com.google.android.material.textfield.TextInputEditText", pkg: "com.google.android.gm", bounds: "[80,400][1000,520]", hint: "Email or phone" }),
  node({ resourceId: "com.google.android.gm:id/password", cls: "com.google.android.material.textfield.TextInputEditText", pkg: "com.google.android.gm", password: true, bounds: "[80,600][1000,720]" }),
  node({ text: "Next", clickable: true, bounds: "[820,800][1000,920]", pkg: "com.google.android.gm" }),
);

const discordEmailFormXml = wrap(
  node({ text: "Log in", clickable: false, bounds: "[400,100][680,180]", cls: "android.widget.TextView", pkg: "com.discord" }),
  node({ resourceId: "com.discord:id/login_email", cls: "com.facebook.react.views.textinput.ReactEditText", pkg: "com.discord", bounds: "[80,300][1000,420]", hint: "Email or Phone" }),
  node({ resourceId: "com.discord:id/login_password", cls: "com.facebook.react.views.textinput.ReactEditText", pkg: "com.discord", password: true, bounds: "[80,480][1000,600]", hint: "Password" }),
  node({ text: "Log In", clickable: true, bounds: "[80,700][1000,820]", pkg: "com.discord" }),
);

// ── Auth-choice fixtures (3 apps) ──────────────────────────────────────

const biztosoAuthChoiceXml = wrap(
  node({ text: "Biztoso", clickable: false, bounds: "[200,400][880,560]", cls: "android.widget.TextView", pkg: "com.biztoso.app" }),
  node({ text: "Continue with Email", clickable: true, bounds: "[40,900][1040,1050]", pkg: "com.biztoso.app" }),
  node({ text: "Continue with Google", clickable: true, bounds: "[40,1100][1040,1250]", pkg: "com.biztoso.app" }),
  node({ text: "Continue with Apple", clickable: true, bounds: "[40,1300][1040,1450]", pkg: "com.biztoso.app" }),
);

const linkedinAuthChoiceXml = wrap(
  node({ text: "LinkedIn", clickable: false, bounds: "[300,200][780,360]", cls: "android.widget.TextView", pkg: "com.linkedin.android" }),
  node({ text: "Sign in", clickable: true, bounds: "[80,1200][1000,1350]", pkg: "com.linkedin.android" }),
  node({ text: "Join now", clickable: true, bounds: "[80,1400][1000,1550]", pkg: "com.linkedin.android" }),
);

const duckduckgoAuthChoiceXml = wrap(
  node({ text: "DuckDuckGo", clickable: false, bounds: "[300,200][780,360]", cls: "android.widget.TextView", pkg: "com.duckduckgo.mobile.android" }),
  node({ text: "Log in", clickable: true, bounds: "[80,1200][1000,1350]", pkg: "com.duckduckgo.mobile.android" }),
  node({ text: "Sign up", clickable: true, bounds: "[80,1400][1000,1550]", pkg: "com.duckduckgo.mobile.android" }),
);

// ── Compose parent-clickable + child-TextView fixtures (3 apps) ────────
//
// In Jetpack Compose, a Button renders as a clickable parent with empty text
// plus a non-clickable TextView child that carries the label. The parser must
// inherit the label from the descendant but return the parent bounds.

const biztosoComposeButtonXml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
<node clickable="false" text="" package="com.biztoso.app" bounds="[42,1475][1038,1606]">
  <node clickable="true" text="" package="com.biztoso.app" bounds="[42,1475][1038,1606]">
    <node clickable="false" text="Continue with Email" package="com.biztoso.app" bounds="[384,1516][765,1565]" />
  </node>
</node>
</hierarchy>`;

const spotifyComposeButtonXml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
<node clickable="false" text="" package="com.spotify.music" bounds="[48,1800][1032,1950]">
  <node clickable="true" text="" package="com.spotify.music" bounds="[48,1800][1032,1950]">
    <node clickable="false" text="Sign up free" package="com.spotify.music" bounds="[420,1840][660,1910]" />
  </node>
</node>
</hierarchy>`;

const headspaceComposeButtonXml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
<node clickable="false" text="" package="com.getsomeheadspace.android" bounds="[60,1600][1020,1740]">
  <node clickable="true" text="" package="com.getsomeheadspace.android" bounds="[60,1600][1020,1740]">
    <node clickable="false" text="Get started" package="com.getsomeheadspace.android" bounds="[440,1640][640,1700]" />
  </node>
</node>
</hierarchy>`;

// ── 1. Email form detection across 3 frameworks/apps ───────────────────

test("parseClickableGraph: email form detection across biztoso (Compose), gmail (Material), discord (RN)", () => {
  const cases = [
    ["biztoso", biztosoEmailFormXml],
    ["gmail", gmailEmailFormXml],
    ["discord", discordEmailFormXml],
  ];
  for (const [name, xml] of cases) {
    const g = parseClickableGraph(xml);
    assert.equal(g.groups.emailInputs.length, 1, `${name}: should detect 1 email input`);
    assert.equal(g.groups.passwordInputs.length, 1, `${name}: should detect 1 password input`);
    assert.equal(g.groups.inputs.length, 2, `${name}: should count 2 total inputs`);
    // Password field is not flagged as email.
    assert.equal(g.groups.emailInputs[0].isPassword, false, `${name}: email input must not be flagged password`);
    assert.equal(g.groups.passwordInputs[0].isEmail, false, `${name}: password input must not be flagged email`);
  }
});

// ── 2. Auth-choice screens across 3 apps ───────────────────────────────

test("parseClickableGraph: auth-choice screens (≥2 clickables, no password) — biztoso, linkedin, duckduckgo", () => {
  const cases = [
    ["biztoso", biztosoAuthChoiceXml, 3],
    ["linkedin", linkedinAuthChoiceXml, 2],
    ["duckduckgo", duckduckgoAuthChoiceXml, 2],
  ];
  for (const [name, xml, minCount] of cases) {
    const g = parseClickableGraph(xml);
    assert.ok(
      g.clickables.length >= minCount,
      `${name}: expected ≥${minCount} clickables, got ${g.clickables.length}`,
    );
    assert.equal(g.groups.passwordInputs.length, 0, `${name}: auth-choice should have no password inputs`);
    assert.equal(g.groups.emailInputs.length, 0, `${name}: auth-choice should have no email inputs`);
    // Every clickable has isButton flagged (clickable AND not input/checkbox).
    for (const c of g.clickables) {
      assert.equal(c.isButton, true, `${name}: '${c.label}' should be classified as button`);
    }
  }
});

// ── 3. Compose parent-clickable inherits label from TextView child ─────

test("parseClickableGraph: Compose parent-clickable inherits child label (biztoso, spotify, headspace)", () => {
  const cases = [
    { name: "biztoso", xml: biztosoComposeButtonXml, label: "Continue with Email", parentBounds: { cx: 540, cy: 1540 } },
    { name: "spotify", xml: spotifyComposeButtonXml, label: "Sign up free", parentBounds: { cx: 540, cy: 1875 } },
    { name: "headspace", xml: headspaceComposeButtonXml, label: "Get started", parentBounds: { cx: 540, cy: 1670 } },
  ];
  for (const { name, xml, label, parentBounds } of cases) {
    const g = parseClickableGraph(xml);
    const parent = g.clickables.find((c) => c.label === label);
    assert.ok(parent, `${name}: parent clickable should carry label '${label}' (found: ${g.clickables.map((c) => c.label).join(", ")})`);
    assert.equal(parent.labelSource, "child", `${name}: labelSource should be 'child'`);
    assert.equal(parent.cx, parentBounds.cx, `${name}: parent cx should match parent bounds, not child bounds`);
    assert.equal(parent.cy, parentBounds.cy, `${name}: parent cy should match parent bounds, not child bounds`);
    assert.equal(parent.clickable, true, `${name}: inherited parent must be clickable`);
  }
});

// ── 4. Password attr detection across framework class types ────────────

test("parseClickableGraph: password='true' flags password across EditText / Material / Compose", () => {
  const cases = [
    { name: "linkedin EditText", cls: "android.widget.EditText", resourceId: "com.linkedin.android:id/session_password" },
    { name: "gmail Material", cls: "com.google.android.material.textfield.TextInputEditText", resourceId: "com.google.android.gm:id/password" },
    { name: "biztoso Compose", cls: "androidx.compose.foundation.text.BasicTextField", resourceId: "com.biztoso.app:id/input_pwd" },
  ];
  for (const { name, cls, resourceId } of cases) {
    const xml = wrap(node({ cls, resourceId, clickable: true, password: true, bounds: "[80,500][1000,620]" }));
    const g = parseClickableGraph(xml);
    assert.equal(g.groups.passwordInputs.length, 1, `${name}: should flag 1 password input`);
    assert.equal(g.groups.passwordInputs[0].isPassword, true);
    assert.equal(g.groups.passwordInputs[0].isInput, true);
    assert.equal(g.groups.passwordInputs[0].isEmail, false);
  }
});

// ── 5. Password resource-id fallback when password attr is absent ──────

test("parseClickableGraph: password resource-id fallback (password='false', 3 apps)", () => {
  const cases = [
    { name: "appA password_field", resourceId: "com.appa:id/password_field", cls: "android.widget.EditText" },
    { name: "appB user_password", resourceId: "com.appb:id/user_password", cls: "com.google.android.material.textfield.TextInputEditText" },
    { name: "appC passwd_input", resourceId: "com.appc:id/passwd_input", cls: "androidx.compose.foundation.text.BasicTextField" },
  ];
  for (const { name, resourceId, cls } of cases) {
    const xml = wrap(node({ cls, resourceId, clickable: true, password: false, bounds: "[80,500][1000,620]" }));
    const g = parseClickableGraph(xml);
    assert.equal(
      g.groups.passwordInputs.length,
      1,
      `${name}: resource-id '${resourceId}' should match PASSWORD_ID_REGEX`,
    );
    assert.ok(PASSWORD_ID_REGEX.test(resourceId), `${name}: regex sanity check`);
  }
  // Negative control: an email resource-id must NOT be flagged as password.
  const emailXml = wrap(node({ cls: "android.widget.EditText", resourceId: "com.appa:id/email_input", clickable: true, bounds: "[80,500][1000,620]" }));
  const emailGraph = parseClickableGraph(emailXml);
  assert.equal(emailGraph.groups.passwordInputs.length, 0, "email resource-id must not match password regex");
  assert.equal(emailGraph.groups.emailInputs.length, 1, "email resource-id should match EMAIL_ID_REGEX");
  assert.ok(EMAIL_ID_REGEX.test("com.appa:id/email_input"));
});

// ── 6. Empty / null / non-string input safety ─────────────────────────

test("parseClickableGraph: empty / null / invalid input returns empty graph without throwing", () => {
  const invalidInputs = ["", null, undefined, 42, {}, [], true];
  for (const input of invalidInputs) {
    let g;
    assert.doesNotThrow(() => {
      g = parseClickableGraph(input);
    }, `input ${String(input)} should not throw`);
    assert.deepEqual(g, {
      clickables: [],
      groups: { inputs: [], emailInputs: [], passwordInputs: [] },
    });
  }
});

// ── 7. Malformed XML safety ────────────────────────────────────────────

test("parseClickableGraph: malformed XML does not throw and returns safe structure", () => {
  const malformedCases = [
    "<xml>unclosed tag",
    "<<<garbage>>>",
    "<node text='broken",
    `<node bounds="[not,a,number]" clickable="true" />`,
    "random text no xml at all",
    // Partially valid — one good node mixed with garbage.
    `<garbage><node text="Hello" clickable="true" bounds="[0,0][100,100]" />broken<< more`,
  ];
  for (const xml of malformedCases) {
    let g;
    assert.doesNotThrow(() => {
      g = parseClickableGraph(xml);
    }, `malformed xml '${xml.slice(0, 30)}' should not throw`);
    assert.ok(Array.isArray(g.clickables));
    assert.ok(Array.isArray(g.groups.inputs));
    assert.ok(Array.isArray(g.groups.emailInputs));
    assert.ok(Array.isArray(g.groups.passwordInputs));
  }
});

// ── 8. Modal overlay: both layers' clickables accessible ──────────────

test("parseClickableGraph: modal over content — background and modal clickables both emitted", () => {
  const xml = wrap(
    // Background app chrome.
    node({ text: "Home", clickable: true, bounds: "[0,100][200,200]", pkg: "com.app" }),
    node({ text: "Settings", clickable: true, bounds: "[880,100][1080,200]", pkg: "com.app" }),
    // Modal dim layer (non-clickable).
    node({ text: "", clickable: false, bounds: "[0,400][1080,1300]", cls: "android.view.View", pkg: "com.app" }),
    // Modal content.
    node({ text: "Rate our app", clickable: false, bounds: "[200,500][880,580]", cls: "android.widget.TextView", pkg: "com.app" }),
    node({ text: "Rate us", clickable: true, bounds: "[200,700][880,850]", pkg: "com.app" }),
    node({ text: "Later", clickable: true, bounds: "[200,950][880,1100]", pkg: "com.app" }),
  );
  const g = parseClickableGraph(xml);
  const labels = g.clickables.map((c) => c.label);
  for (const expected of ["Home", "Settings", "Rate us", "Later"]) {
    assert.ok(labels.includes(expected), `modal test should expose '${expected}' (got: ${labels.join(", ")})`);
  }
  // Modal dim layer is not clickable → not in output.
  assert.equal(g.clickables.filter((c) => c.label === "").length, 0, "non-clickable dim layer must not emit");
});

// ── 9. Duplicate resource-id across two inputs ────────────────────────

test("parseClickableGraph: two inputs sharing a resource-id are both emitted, distinct bounds", () => {
  // This happens when the same screen has repeated input fields, or when the
  // parser sees a view-pager with multiple EditTexts reusing layout ids.
  const xml = wrap(
    node({ resourceId: "com.example:id/email_input", cls: "android.widget.EditText", pkg: "com.example", bounds: "[0,100][1000,200]" }),
    node({ resourceId: "com.example:id/email_input", cls: "android.widget.EditText", pkg: "com.example", bounds: "[0,500][1000,600]" }),
  );
  const g = parseClickableGraph(xml);
  assert.equal(g.groups.emailInputs.length, 2, "both emailInputs should be emitted");
  assert.equal(g.groups.inputs.length, 2, "both inputs should appear in the inputs group");
  const ys = g.groups.emailInputs.map((c) => c.bounds.y1).sort((a, b) => a - b);
  assert.deepEqual(ys, [100, 500], "bounds differ — caller can tiebreak by position");
  // resource-id equality preserved — caller can group.
  const ids = new Set(g.groups.emailInputs.map((c) => c.resourceId));
  assert.equal(ids.size, 1);
});

// ── 10. Clickable with no label resolves to empty label gracefully ────

test("parseClickableGraph: clickable with no text/desc/child returns empty label and labelSource='none'", () => {
  const xml = wrap(
    node({ text: "", desc: "", resourceId: "", clickable: true, bounds: "[0,100][200,200]", cls: "android.widget.ImageView" }),
  );
  const g = parseClickableGraph(xml);
  assert.equal(g.clickables.length, 1);
  assert.equal(g.clickables[0].label, "");
  assert.equal(g.clickables[0].labelSource, "none");
  assert.equal(g.clickables[0].isButton, true, "clickable ImageView is still a button");
  assert.equal(g.clickables[0].isInput, false);
});
