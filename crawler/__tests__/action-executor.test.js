"use strict";

const { describe, it, beforeEach, mock } = require("node:test");
const assert = require("node:assert");
const path = require("path");

// ---------------------------------------------------------------------------
// Mock dependencies via require.cache before requiring action-executor
// ---------------------------------------------------------------------------

const mockAdb = {
  tap: mock.fn(() => {}),
  pressBack: mock.fn(() => {}),
  swipe: mock.fn(() => {}),
  inputText: mock.fn(() => {}),
};

const mockGestures = {
  scrollInBounds: mock.fn(() => {}),
  longPress: mock.fn(() => {}),
  swipeLeft: mock.fn(() => {}),
  swipeRight: mock.fn(() => {}),
};

const mockFindScrollable = mock.fn(() => ({
  bounds: { x1: 0, y1: 200, x2: 1080, y2: 1800 },
  isDefault: true,
}));

// Pre-populate require.cache with mock modules
const crawlerDir = path.join(__dirname, "..");

function cacheMock(modPath, exports) {
  const resolved = require.resolve(modPath);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exports,
  };
}

cacheMock(path.join(crawlerDir, "adb"), mockAdb);
cacheMock(path.join(crawlerDir, "gestures"), mockGestures);
cacheMock(path.join(crawlerDir, "scroll-explorer"), {
  findScrollableElement: mockFindScrollable,
});

const { executeAction } = require("../action-executor");
const { ACTION_TYPES } = require("../actions");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("action-executor", () => {
  beforeEach(() => {
    mockAdb.tap.mock.resetCalls();
    mockAdb.pressBack.mock.resetCalls();
    mockAdb.swipe.mock.resetCalls();
    mockAdb.inputText.mock.resetCalls();
    mockGestures.scrollInBounds.mock.resetCalls();
    mockGestures.longPress.mock.resetCalls();
    mockGestures.swipeLeft.mock.resetCalls();
    mockGestures.swipeRight.mock.resetCalls();
    mockFindScrollable.mock.resetCalls();
  });

  describe("TAP action", () => {
    it("calls adb.tap with correct coordinates", () => {
      const action = {
        type: ACTION_TYPES.TAP,
        bounds: { cx: 540, cy: 960 },
        text: "Submit",
        resourceId: "btn_submit",
      };

      const result = executeAction(action);

      assert.strictEqual(mockAdb.tap.mock.callCount(), 1);
      assert.deepStrictEqual(mockAdb.tap.mock.calls[0].arguments, [540, 960]);
      assert.ok(result.includes("tap(540, 960)"));
      assert.ok(result.includes("Submit"));
    });

    it("uses resourceId when text is empty", () => {
      const action = {
        type: ACTION_TYPES.TAP,
        bounds: { cx: 100, cy: 200 },
        text: "",
        resourceId: "nav_home",
      };

      const result = executeAction(action);
      assert.ok(result.includes("nav_home"));
    });

    it('uses "element" when both text and resourceId are empty', () => {
      const action = {
        type: ACTION_TYPES.TAP,
        bounds: { cx: 100, cy: 200 },
        text: "",
        resourceId: "",
      };

      const result = executeAction(action);
      assert.ok(result.includes("element"));
    });
  });

  describe("TYPE action", () => {
    it("taps the field to focus it", () => {
      const action = {
        type: ACTION_TYPES.TYPE,
        bounds: { cx: 540, cy: 500 },
        resourceId: "email_input",
      };

      const result = executeAction(action);

      assert.strictEqual(mockAdb.tap.mock.callCount(), 1);
      assert.deepStrictEqual(mockAdb.tap.mock.calls[0].arguments, [540, 500]);
      assert.ok(result.includes("focus field"));
      assert.ok(result.includes("email_input"));
    });

    it("uses fallback label when resourceId is empty", () => {
      const action = {
        type: ACTION_TYPES.TYPE,
        bounds: { cx: 540, cy: 500 },
        resourceId: "",
      };

      const result = executeAction(action);
      assert.ok(result.includes("edittext"));
    });
  });

  describe("SCROLL_DOWN action", () => {
    it("finds scrollable element and scrolls down", () => {
      const action = { type: ACTION_TYPES.SCROLL_DOWN };

      const result = executeAction(action);

      assert.strictEqual(mockFindScrollable.mock.callCount(), 1);
      assert.strictEqual(mockGestures.scrollInBounds.mock.callCount(), 1);
      const scrollArgs = mockGestures.scrollInBounds.mock.calls[0].arguments;
      assert.strictEqual(scrollArgs[1], "down");
      assert.strictEqual(result, "scroll_down");
    });
  });

  describe("SCROLL_UP action", () => {
    it("finds scrollable element and scrolls up", () => {
      const action = { type: ACTION_TYPES.SCROLL_UP };

      const result = executeAction(action);

      assert.strictEqual(mockFindScrollable.mock.callCount(), 1);
      assert.strictEqual(mockGestures.scrollInBounds.mock.callCount(), 1);
      const scrollArgs = mockGestures.scrollInBounds.mock.calls[0].arguments;
      assert.strictEqual(scrollArgs[1], "up");
      assert.strictEqual(result, "scroll_up");
    });
  });

  describe("LONG_PRESS action", () => {
    it("calls gestures.longPress with correct coordinates", () => {
      const action = {
        type: ACTION_TYPES.LONG_PRESS,
        bounds: { cx: 300, cy: 700 },
        text: "Photo",
        resourceId: "",
      };

      const result = executeAction(action);

      assert.strictEqual(mockGestures.longPress.mock.callCount(), 1);
      assert.deepStrictEqual(mockGestures.longPress.mock.calls[0].arguments, [300, 700]);
      assert.ok(result.includes("long_press(300, 700)"));
      assert.ok(result.includes("Photo"));
    });
  });

  describe("SWIPE_LEFT action", () => {
    it("calls gestures.swipeLeft with bounds", () => {
      const bounds = { x1: 0, y1: 200, x2: 1080, y2: 800 };
      const action = { type: ACTION_TYPES.SWIPE_LEFT, bounds };

      const result = executeAction(action);

      assert.strictEqual(mockGestures.swipeLeft.mock.callCount(), 1);
      assert.deepStrictEqual(mockGestures.swipeLeft.mock.calls[0].arguments, [bounds]);
      assert.strictEqual(result, "swipe_left");
    });
  });

  describe("SWIPE_RIGHT action", () => {
    it("calls gestures.swipeRight with bounds", () => {
      const bounds = { x1: 0, y1: 200, x2: 1080, y2: 800 };
      const action = { type: ACTION_TYPES.SWIPE_RIGHT, bounds };

      const result = executeAction(action);

      assert.strictEqual(mockGestures.swipeRight.mock.callCount(), 1);
      assert.deepStrictEqual(mockGestures.swipeRight.mock.calls[0].arguments, [bounds]);
      assert.strictEqual(result, "swipe_right");
    });
  });

  describe("BACK action", () => {
    it("calls adb.pressBack", () => {
      const action = { type: ACTION_TYPES.BACK };

      const result = executeAction(action);

      assert.strictEqual(mockAdb.pressBack.mock.callCount(), 1);
      assert.strictEqual(result, "press_back");
    });
  });

  describe("unknown action type", () => {
    it("returns unknown description and does not crash", () => {
      const action = { type: "nonexistent_action" };

      const result = executeAction(action);

      assert.ok(result.includes("unknown"));
      assert.ok(result.includes("nonexistent_action"));
    });
  });

  // ---------------------------------------------------------------------------
  // Track C: vision-first AGENT_* primitives
  // ---------------------------------------------------------------------------
  describe("action-executor agent primitives", () => {
    describe("AGENT_TAP action", () => {
      it("calls adb.tap with raw coordinates", () => {
        const action = { type: ACTION_TYPES.AGENT_TAP, x: 540, y: 1200 };

        const result = executeAction(action);

        assert.strictEqual(mockAdb.tap.mock.callCount(), 1);
        assert.deepStrictEqual(mockAdb.tap.mock.calls[0].arguments, [540, 1200]);
        assert.match(result, /agent_tap\(540, 1200\)/);
      });
    });

    describe("AGENT_TYPE action", () => {
      it("calls adb.inputText with provided text", () => {
        const action = { type: ACTION_TYPES.AGENT_TYPE, text: "hello" };

        const result = executeAction(action);

        assert.strictEqual(mockAdb.inputText.mock.callCount(), 1);
        assert.deepStrictEqual(mockAdb.inputText.mock.calls[0].arguments, ["hello"]);
        assert.match(result, /agent_type\(hello\)/);
      });

      it("handles missing text by passing empty string", () => {
        const action = { type: ACTION_TYPES.AGENT_TYPE };

        const result = executeAction(action);

        assert.strictEqual(mockAdb.inputText.mock.callCount(), 1);
        assert.deepStrictEqual(mockAdb.inputText.mock.calls[0].arguments, [""]);
        assert.match(result, /agent_type\(\)/);
      });

      it("truncates long text in description (but passes full text to adb)", () => {
        const longText = "x".repeat(60);
        const action = { type: ACTION_TYPES.AGENT_TYPE, text: longText };

        const result = executeAction(action);

        assert.deepStrictEqual(mockAdb.inputText.mock.calls[0].arguments, [longText]);
        assert.ok(result.includes("..."));
        assert.ok(result.length < longText.length + 20);
      });
    });

    describe("AGENT_SWIPE action", () => {
      it("calls adb.swipe with default durationMs when omitted", () => {
        const action = {
          type: ACTION_TYPES.AGENT_SWIPE,
          x1: 100,
          y1: 1000,
          x2: 100,
          y2: 200,
        };

        const result = executeAction(action);

        assert.strictEqual(mockAdb.swipe.mock.callCount(), 1);
        assert.deepStrictEqual(
          mockAdb.swipe.mock.calls[0].arguments,
          [100, 1000, 100, 200, 300],
        );
        assert.match(result, /agent_swipe\(100,1000/);
        assert.match(result, /100,200, 300ms\)/);
      });

      it("respects explicit durationMs", () => {
        const action = {
          type: ACTION_TYPES.AGENT_SWIPE,
          x1: 100,
          y1: 1000,
          x2: 100,
          y2: 200,
          durationMs: 500,
        };

        executeAction(action);

        assert.strictEqual(mockAdb.swipe.mock.calls[0].arguments[4], 500);
      });
    });

    describe("AGENT_LONG_PRESS action", () => {
      it("calls gestures.longPress with raw coordinates", () => {
        const action = { type: ACTION_TYPES.AGENT_LONG_PRESS, x: 540, y: 1200 };

        const result = executeAction(action);

        assert.strictEqual(mockGestures.longPress.mock.callCount(), 1);
        assert.deepStrictEqual(
          mockGestures.longPress.mock.calls[0].arguments,
          [540, 1200],
        );
        assert.match(result, /agent_long_press\(540, 1200\)/);
      });
    });

    describe("AGENT_BACK action", () => {
      it("calls adb.pressBack", () => {
        const action = { type: ACTION_TYPES.AGENT_BACK };

        const result = executeAction(action);

        assert.strictEqual(mockAdb.pressBack.mock.callCount(), 1);
        assert.strictEqual(result, "agent_back");
      });
    });

    describe("AGENT_WAIT action", () => {
      it("is a no-op — returns description and calls no ADB/gesture primitives", () => {
        const action = { type: ACTION_TYPES.AGENT_WAIT, durationMs: 1500 };

        const result = executeAction(action);

        assert.strictEqual(mockAdb.tap.mock.callCount(), 0);
        assert.strictEqual(mockAdb.swipe.mock.callCount(), 0);
        assert.strictEqual(mockAdb.pressBack.mock.callCount(), 0);
        assert.strictEqual(mockAdb.inputText.mock.callCount(), 0);
        assert.strictEqual(mockGestures.longPress.mock.callCount(), 0);
        assert.match(result, /agent_wait\(1500ms\)/);
      });

      it("defaults durationMs to 0 when omitted", () => {
        const action = { type: ACTION_TYPES.AGENT_WAIT };

        const result = executeAction(action);

        assert.match(result, /agent_wait\(0ms\)/);
      });
    });
  });
});
