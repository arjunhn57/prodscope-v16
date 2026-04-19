"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");
const { AuthStateMachine, STATE, isAuthIntent, AUTH_ESCAPE_LABELS } = require("../auth-state-machine");

// Suppress console.log from FSM transitions during tests
const origLog = console.log;
beforeEach(() => { console.log = () => {}; });
process.on("exit", () => { console.log = origLog; });

describe("AuthStateMachine — initial state", () => {
  it("starts in IDLE state", () => {
    const m = new AuthStateMachine({});
    assert.strictEqual(m.state, STATE.IDLE);
    assert.strictEqual(m.isTerminal, false);
    assert.strictEqual(m.isActive, false);
  });

  it("detects valid credentials", () => {
    const m = new AuthStateMachine({ email: "a@b.com", password: "p" });
    assert.strictEqual(m.hasCredentials, true);
  });

  it("detects missing credentials", () => {
    const m = new AuthStateMachine({});
    assert.strictEqual(m.hasCredentials, false);
  });

  it("detects username credentials", () => {
    const m = new AuthStateMachine({ username: "user", password: "p" });
    assert.strictEqual(m.hasCredentials, true);
  });

  it("rejects email without password", () => {
    const m = new AuthStateMachine({ email: "a@b.com" });
    assert.strictEqual(m.hasCredentials, false);
  });
});

describe("AuthStateMachine — shouldAttemptAuth", () => {
  it("returns true with credentials and budget", () => {
    const m = new AuthStateMachine({ email: "a@b.com", password: "p" });
    assert.strictEqual(m.shouldAttemptAuth(), true);
  });

  it("returns false without credentials", () => {
    const m = new AuthStateMachine({});
    assert.strictEqual(m.shouldAttemptAuth(), false);
  });

  it("returns false in terminal state", () => {
    const m = new AuthStateMachine({ email: "a@b.com", password: "p" });
    m.onAuthFailed("test");
    assert.strictEqual(m.shouldAttemptAuth(), false);
  });

  it("returns false when budget exhausted", () => {
    const m = new AuthStateMachine({ email: "a@b.com", password: "p" }, { authBudget: 2 });
    m.tick("auth_choice", "fp1");
    m.tick("auth_choice", "fp2");
    m.tick("auth_choice", "fp3"); // triggers abandon
    assert.strictEqual(m.shouldAttemptAuth(), false);
  });
});

describe("AuthStateMachine — tick transitions", () => {
  it("transitions IDLE -> CHOOSING_METHOD on auth screen", () => {
    const m = new AuthStateMachine({ email: "a@b.com", password: "p" });
    m.tick("auth_choice", "fp1");
    assert.strictEqual(m.state, STATE.CHOOSING_METHOD);
    assert.strictEqual(m.isActive, true);
  });

  it("returns back action on auth screen without credentials", () => {
    const m = new AuthStateMachine({});
    const result = m.tick("auth_choice", "fp1");
    assert.strictEqual(result.action, "back");
    assert.strictEqual(m.state, STATE.FAILED_GUEST);
  });

  it("does nothing on non-auth screen when idle", () => {
    const m = new AuthStateMachine({ email: "a@b.com", password: "p" });
    const result = m.tick("feed", "fp1");
    assert.strictEqual(result.action, undefined);
    assert.strictEqual(m.state, STATE.IDLE);
  });

  it("tracks auth screen fingerprints", () => {
    const m = new AuthStateMachine({ email: "a@b.com", password: "p" });
    m.tick("auth_choice", "fp1");
    m.tick("email_login", "fp2");
    assert.strictEqual(m.isKnownAuthScreen("fp1"), true);
    assert.strictEqual(m.isKnownAuthScreen("fp2"), true);
    assert.strictEqual(m.isKnownAuthScreen("fp3"), false);
  });
});

describe("AuthStateMachine — state budget enforcement", () => {
  it("abandons after CHOOSING_METHOD budget exceeded", () => {
    const m = new AuthStateMachine({ email: "a@b.com", password: "p" });
    m.tick("auth_choice", "fp1"); // -> CHOOSING_METHOD, step 1
    m.tick("auth_choice", "fp1"); // step 2
    m.tick("auth_choice", "fp1"); // step 3
    const result = m.tick("auth_choice", "fp1"); // step 4, exceeds budget of 3
    assert.strictEqual(result.action, "back");
    assert.strictEqual(m.state, STATE.FAILED_GUEST);
  });
});

describe("AuthStateMachine — global budget enforcement", () => {
  it("abandons after global budget exhausted", () => {
    const m = new AuthStateMachine({ email: "a@b.com", password: "p" }, { authBudget: 3 });
    m.tick("auth_choice", "fp1");
    m.tick("email_login", "fp2");
    m.onChoiceTapped("fp1", "email"); // -> FILLING_FORM
    m.tick("email_login", "fp3"); // step 3
    const result = m.tick("auth_choice", "fp4"); // step 4 > budget 3
    assert.strictEqual(result.action, "back");
    assert.strictEqual(m.isTerminal, true);
  });
});

describe("AuthStateMachine — form fill + submit", () => {
  it("tracks fill count", () => {
    const m = new AuthStateMachine({ email: "a@b.com", password: "p" });
    m.tick("auth_choice", "fp1");
    m.onChoiceTapped("fp1", "email");
    m.onFormFilled("submit_btn");
    assert.strictEqual(m.fillCount, 1);
    assert.strictEqual(m.state, STATE.SUBMITTING);
  });

  it("detects submit loop", () => {
    const m = new AuthStateMachine({ email: "a@b.com", password: "p" });
    m.tick("auth_choice", "fp1");
    m.onChoiceTapped("fp1", "email");
    m.onFormFilled("submit_btn");
    m.onFormFilled("submit_btn");
    m.onFormFilled("submit_btn");
    assert.strictEqual(m.isSubmitLooping(), true);
  });

  it("resets submit counter on different button", () => {
    const m = new AuthStateMachine({ email: "a@b.com", password: "p" });
    m.tick("auth_choice", "fp1");
    m.onChoiceTapped("fp1", "email");
    m.onFormFilled("submit_btn");
    m.onFormFilled("submit_btn");
    m.onFormFilled("other_btn");
    assert.strictEqual(m.isSubmitLooping(), false);
    assert.strictEqual(m.consecutiveSameSubmit, 1);
  });
});

describe("AuthStateMachine — terminal states", () => {
  it("SUCCEEDED is terminal", () => {
    const m = new AuthStateMachine({ email: "a@b.com", password: "p" });
    m.onAuthSucceeded();
    assert.strictEqual(m.isTerminal, true);
    assert.strictEqual(m.isActive, false);
  });

  it("FAILED_GUEST is terminal", () => {
    const m = new AuthStateMachine({});
    m.tick("auth_choice", "fp1");
    assert.strictEqual(m.state, STATE.FAILED_GUEST);
    assert.strictEqual(m.isTerminal, true);
  });

  it("ABANDONED is terminal", () => {
    const m = new AuthStateMachine({ email: "a@b.com", password: "p" });
    m.onAuthFailed("test");
    assert.strictEqual(m.isTerminal, true);
    assert.strictEqual(m.state, STATE.FAILED_GUEST);
  });

  it("suppresses auth screens in terminal state", () => {
    const m = new AuthStateMachine({ email: "a@b.com", password: "p" });
    m.onAuthSucceeded();
    const result = m.tick("auth_choice", "fp1");
    assert.strictEqual(result.action, "back");
  });
});

describe("AuthStateMachine — auth escape tracking", () => {
  it("tracks skip backs", () => {
    const m = new AuthStateMachine({});
    assert.strictEqual(m.recordAuthSkipBack(), false);
    assert.strictEqual(m.recordAuthSkipBack(), false);
    assert.strictEqual(m.recordAuthSkipBack(), true); // 3rd = exit loop
  });

  it("escape taps reset back counter", () => {
    const m = new AuthStateMachine({});
    m.recordAuthSkipBack();
    m.recordAuthSkipBack();
    m.recordAuthEscapeTapped();
    assert.strictEqual(m.authSkipBackCount, 0);
  });

  it("onAuthEscaped transitions to FAILED_GUEST", () => {
    const m = new AuthStateMachine({ email: "a@b.com", password: "p" });
    m.tick("auth_choice", "fp1");
    m.onAuthEscaped("skipped");
    assert.strictEqual(m.state, STATE.FAILED_GUEST);
    assert.strictEqual(m.isTerminal, true);
  });
});

describe("AuthStateMachine — guest detection", () => {
  it("detects guest transition from SUBMITTING to non-auth without fills", () => {
    const m = new AuthStateMachine({ email: "a@b.com", password: "p" });
    m.tick("auth_choice", "fp1");
    m.onChoiceTapped("fp1", "email");
    // Manually set to SUBMITTING without filling
    m._transition(STATE.SUBMITTING, "test");
    m.tick("feed", "fp2"); // non-auth screen
    assert.strictEqual(m.state, STATE.FAILED_GUEST);
    assert.strictEqual(m.guestHomeFp, "fp2");
  });

  it("detects auth success after fill + non-auth screen", () => {
    const m = new AuthStateMachine({ email: "a@b.com", password: "p" });
    m.tick("auth_choice", "fp1");
    m.onChoiceTapped("fp1", "email");
    m.onFormFilled("submit_btn");
    m.tick("feed", "fp2"); // non-auth screen after submit
    assert.strictEqual(m.state, STATE.SUCCEEDED);
  });
});

describe("AuthStateMachine — shouldSuppressAuth", () => {
  it("suppresses auth screens in FAILED_GUEST", () => {
    const m = new AuthStateMachine({});
    m.tick("auth_choice", "fp1"); // -> FAILED_GUEST
    assert.strictEqual(m.shouldSuppressAuth("auth_choice"), true);
  });

  it("does not suppress non-auth screens", () => {
    const m = new AuthStateMachine({});
    assert.strictEqual(m.shouldSuppressAuth("feed"), false);
  });

  it("suppresses auth when idle without credentials", () => {
    const m = new AuthStateMachine({});
    assert.strictEqual(m.shouldSuppressAuth("email_login"), true);
  });
});

describe("isAuthIntent", () => {
  it("recognizes standard auth intents", () => {
    assert.strictEqual(isAuthIntent("auth_choice"), true);
    assert.strictEqual(isAuthIntent("email_login"), true);
    assert.strictEqual(isAuthIntent("otp_verification"), true);
  });

  it("recognizes auth-prefixed intents", () => {
    assert.strictEqual(isAuthIntent("auth_something"), true);
  });

  it("rejects non-auth intents", () => {
    assert.strictEqual(isAuthIntent("feed"), false);
    assert.strictEqual(isAuthIntent("settings"), false);
    assert.strictEqual(isAuthIntent("unknown"), false);
  });
});

describe("AUTH_ESCAPE_LABELS", () => {
  it("contains expected labels", () => {
    assert.ok(AUTH_ESCAPE_LABELS.includes("skip"));
    assert.ok(AUTH_ESCAPE_LABELS.includes("not now"));
    assert.ok(AUTH_ESCAPE_LABELS.includes("continue as guest"));
    assert.ok(AUTH_ESCAPE_LABELS.includes("guest mode"));
  });
});
