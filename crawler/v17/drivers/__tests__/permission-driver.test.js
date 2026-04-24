"use strict";

/**
 * Tests for v17/drivers/permission-driver.js.
 *
 * 6 cases per Phase B.3 plan:
 *   1. claim() → true when packageName is com.android.permissioncontroller.
 *   2. claim() → true when packageName is com.android.packageinstaller.
 *   3. claim() → true when packageName is arbitrary but XML carries allow-button resource-id.
 *   4. claim() → false on a non-permission screen.
 *   5. decide() prefers permission_allow_foreground_only_button over permission_allow_button.
 *   6. decide() never returns a tap on deny buttons (returns null if only deny buttons exist).
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const permissionDriver = require("../permission-driver");

// ── XML fixture helpers ─────────────────────────────────────────────────

function wrap(...nodes) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<hierarchy rotation="0">\n${nodes.join("\n")}\n</hierarchy>`;
}

function node({
  resourceId = "",
  cls = "android.widget.Button",
  pkg = "com.android.permissioncontroller",
  text = "",
  bounds = "[100,1600][600,1700]",
  clickable = true,
}) {
  return (
    `<node resource-id="${resourceId}" class="${cls}" package="${pkg}" ` +
    `text="${text}" clickable="${clickable}" bounds="${bounds}" />`
  );
}

// Typical Android 11+ dialog: foreground-only + allow + deny-and-dont-ask.
const locationDialogXml = wrap(
  node({
    resourceId: "com.android.permissioncontroller:id/permission_allow_foreground_only_button",
    text: "While using the app",
    bounds: "[40,1500][1040,1620]",
  }),
  node({
    resourceId: "com.android.permissioncontroller:id/permission_allow_one_time_button",
    text: "Only this time",
    bounds: "[40,1640][1040,1760]",
  }),
  node({
    resourceId: "com.android.permissioncontroller:id/permission_deny_button",
    text: "Don't allow",
    bounds: "[40,1780][1040,1900]",
  }),
);

// Notification-style dialog: allow (no foreground-only variant) + deny.
const notificationDialogXml = wrap(
  node({
    resourceId: "com.android.permissioncontroller:id/permission_allow_button",
    text: "Allow",
    bounds: "[40,1500][1040,1620]",
  }),
  node({
    resourceId: "com.android.permissioncontroller:id/permission_deny_button",
    text: "Don't allow",
    bounds: "[40,1640][1040,1760]",
  }),
);

// Deny-only dialog (pathological; driver must NOT pick deny).
const denyOnlyDialogXml = wrap(
  node({
    resourceId: "com.android.permissioncontroller:id/permission_deny_button",
    text: "Don't allow",
    bounds: "[40,1780][1040,1900]",
  }),
  node({
    resourceId: "com.android.permissioncontroller:id/permission_deny_and_dont_ask_again_button",
    text: "Don't ask again",
    bounds: "[40,1920][1040,2040]",
  }),
);

// OEM dialog where packageName is the underlying app, but the allow button
// still carries the AOSP resource-id (common on some Samsung ROMs).
const oemHostedDialogXml = wrap(
  node({
    resourceId: "com.android.permissioncontroller:id/permission_allow_foreground_only_button",
    text: "While using the app",
    pkg: "com.samsung.custompermissions",
    bounds: "[40,1500][1040,1620]",
  }),
);

// Regular app home screen (should NOT be claimed).
const appHomeXml = wrap(
  node({
    resourceId: "com.biztoso.app:id/home_button",
    cls: "android.widget.Button",
    pkg: "com.biztoso.app",
    text: "Home",
    bounds: "[40,100][300,200]",
  }),
);

// ── Tests ──────────────────────────────────────────────────────────────

test("PermissionDriver.claim: true for com.android.permissioncontroller packageName", () => {
  const ok = permissionDriver.claim({
    packageName: "com.android.permissioncontroller",
    xml: locationDialogXml,
  });
  assert.equal(ok, true);
});

test("PermissionDriver.claim: true for com.android.packageinstaller packageName", () => {
  const ok = permissionDriver.claim({
    packageName: "com.android.packageinstaller",
    xml: locationDialogXml,
  });
  assert.equal(ok, true);
});

test("PermissionDriver.claim: true when packageName is OEM but allow resource-id is present", () => {
  const ok = permissionDriver.claim({
    packageName: "com.samsung.custompermissions",
    xml: oemHostedDialogXml,
  });
  assert.equal(ok, true);
});

test("PermissionDriver.claim: false on regular app home screen", () => {
  const ok = permissionDriver.claim({
    packageName: "com.biztoso.app",
    xml: appHomeXml,
  });
  assert.equal(ok, false);
});

test("PermissionDriver.decide: prefers foreground-only over allow-once", () => {
  const action = permissionDriver.decide({
    packageName: "com.android.permissioncontroller",
    xml: locationDialogXml,
  });
  assert.ok(action, "should produce an action");
  assert.equal(action.type, "tap");
  // Foreground-only button is at cy = (1500+1620)/2 = 1560
  assert.equal(action.y, 1560);
});

test("PermissionDriver.decide: taps allow-button on notification dialog (no foreground-only variant)", () => {
  const action = permissionDriver.decide({
    packageName: "com.android.permissioncontroller",
    xml: notificationDialogXml,
  });
  assert.ok(action, "should produce an action");
  assert.equal(action.type, "tap");
  // Allow button cy = (1500+1620)/2 = 1560
  assert.equal(action.y, 1560);
});

test("PermissionDriver.decide: returns null on deny-only dialog (never taps deny)", () => {
  const action = permissionDriver.decide({
    packageName: "com.android.permissioncontroller",
    xml: denyOnlyDialogXml,
  });
  assert.equal(action, null);
});
