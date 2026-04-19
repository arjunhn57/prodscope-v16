"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  isPermissionDialog,
  isCrashOrAnrDialog,
  isGenericDialog,
  isOnboardingOverlay,
  isThirdPartyAuthPrompt,
  isSystemDialogByStructure,
  extractButtons,
  HANDLERS,
} = require("../system-handlers");

// ── ANR handler (E7) ────────────────────────────────────────────────────────

describe("ANR dialog handler (E7)", () => {
  const anrHandler = HANDLERS.find((h) => h.name === "anr_dialog");

  it("exists in HANDLERS before crash_anr_dialog", () => {
    assert.ok(anrHandler, "anr_dialog handler should exist");
    const anrIdx = HANDLERS.findIndex((h) => h.name === "anr_dialog");
    const crashIdx = HANDLERS.findIndex((h) => h.name === "crash_anr_dialog");
    assert.ok(anrIdx < crashIdx, "anr_dialog should come before crash_anr_dialog");
  });

  it("detects ANR with 'isn\\'t responding' and Wait button", () => {
    const xml = `<node text="App isn't responding" />
      <node text="Wait" clickable="true" bounds="[200,1000][400,1100]" class="android.widget.Button" />
      <node text="Close app" clickable="true" bounds="[500,1000][700,1100]" class="android.widget.Button" />`;
    assert.strictEqual(anrHandler.detect(xml), true);
  });

  it("detects ANR with HTML entity apostrophe", () => {
    const xml = `<node text="App isn&apos;t responding" />
      <node text="Wait" clickable="true" bounds="[200,1000][400,1100]" class="android.widget.Button" />`;
    assert.strictEqual(anrHandler.detect(xml), true);
  });

  it("does not detect regular crash dialog (no Wait button)", () => {
    const xml = `<node text="App has stopped" />
      <node text="Close app" clickable="true" bounds="[200,1000][400,1100]" class="android.widget.Button" />`;
    assert.strictEqual(anrHandler.detect(xml), false);
  });

  it("does not detect normal screen", () => {
    const xml = `<node text="Hello World" clickable="true" bounds="[0,0][100,100]" class="android.widget.Button" />`;
    assert.strictEqual(anrHandler.detect(xml), false);
  });
});

// ── Battery optimization handler (E7) ───────────────────────────────────────

describe("Battery optimization handler (E7)", () => {
  const batteryHandler = HANDLERS.find((h) => h.name === "battery_optimization_dialog");

  it("exists in HANDLERS", () => {
    assert.ok(batteryHandler, "battery_optimization_dialog handler should exist");
  });

  it("detects battery optimization dialog", () => {
    const xml = `<node package="com.android.settings" />
      <node text="Battery optimization" />
      <node text="Not now" clickable="true" bounds="[200,1000][400,1100]" class="android.widget.Button" />`;
    assert.strictEqual(batteryHandler.detect(xml), true);
  });

  it("detects unrestricted battery setting", () => {
    const xml = `<node package="com.android.settings" />
      <node text="Unrestricted" />
      <node text="Allow" clickable="true" bounds="[200,1000][400,1100]" class="android.widget.Button" />`;
    assert.strictEqual(batteryHandler.detect(xml), true);
  });

  it("does not detect non-settings screen with battery text", () => {
    const xml = `<node package="com.test.app" />
      <node text="Battery: 80%" />`;
    assert.strictEqual(batteryHandler.detect(xml), false);
  });
});

// ── Existing handler tests ──────────────────────────────────────────────────

describe("isPermissionDialog", () => {
  it("detects permission controller dialog", () => {
    const xml = '<node resource-id="com.android.permissioncontroller:id/grant_dialog" />';
    assert.strictEqual(isPermissionDialog(xml), true);
  });

  it("detects allow/deny text in android package", () => {
    const xml = '<node resource-id="com.android.packageinstaller:id/perm" text="Allow" />';
    assert.strictEqual(isPermissionDialog(xml), true);
  });

  it("returns false for normal screen", () => {
    const xml = '<node text="Hello" package="com.test.app" />';
    assert.strictEqual(isPermissionDialog(xml), false);
  });
});

describe("isCrashOrAnrDialog", () => {
  it("detects aerr_ resource id", () => {
    const xml = '<node resource-id="android:id/aerr_close" />';
    assert.strictEqual(isCrashOrAnrDialog(xml), true);
  });

  it("detects keeps stopping with alert title", () => {
    const xml = '<node resource-id="android:id/alertTitle" text="App keeps stopping" />';
    assert.strictEqual(isCrashOrAnrDialog(xml), true);
  });

  it("returns false for normal screen", () => {
    assert.strictEqual(isCrashOrAnrDialog('<node text="Hello" />'), false);
  });
});

describe("isGenericDialog", () => {
  it("detects alert title", () => {
    assert.strictEqual(isGenericDialog('<node resource-id="android:id/alertTitle" />'), true);
  });

  it("detects popup window", () => {
    assert.strictEqual(isGenericDialog('<node class="android.widget.PopupWindow" />'), true);
  });

  it("returns false for normal screen", () => {
    assert.strictEqual(isGenericDialog('<node text="Hello" class="android.widget.TextView" />'), false);
  });

  it("returns false for null", () => {
    assert.strictEqual(isGenericDialog(null), false);
  });
});

describe("isOnboardingOverlay", () => {
  it("detects Skip button", () => {
    assert.strictEqual(isOnboardingOverlay('<node text="Skip" />'), true);
  });

  it("detects ViewPager", () => {
    assert.strictEqual(isOnboardingOverlay('<node class="androidx.viewpager.widget.ViewPager" />'), true);
  });

  it("returns false for normal screen", () => {
    assert.strictEqual(isOnboardingOverlay('<node text="Hello" />'), false);
  });
});

describe("extractButtons", () => {
  it("extracts clickable buttons with text", () => {
    const xml = `
      <node text="Login" clickable="true" class="android.widget.Button" bounds="[100,200][300,400]" />
      <node text="" clickable="true" class="android.widget.Button" bounds="[100,500][300,600]" />
      <node text="Sign Up" clickable="false" class="android.widget.Button" bounds="[100,700][300,800]" />
    `;
    const buttons = extractButtons(xml);
    assert.strictEqual(buttons.length, 1); // only Login has text + clickable
    assert.strictEqual(buttons[0].label, "Login");
  });

  it("returns empty array for no clickable buttons", () => {
    const xml = '<node text="Hello" clickable="false" />';
    assert.strictEqual(extractButtons(xml).length, 0);
  });
});
