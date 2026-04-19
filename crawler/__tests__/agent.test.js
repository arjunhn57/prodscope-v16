"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert");
const { buildPrompt, parseDecision, buildCoordPrompt, buildCoordPromptParts, parseCoordDecision, decideCoordinates } = require("../agent");

const baseInput = {
  goal: "explore",
  credentials: null,
  packageName: "com.test.app",
  stepNumber: 1,
  maxSteps: 50,
  visitedScreensCount: 0,
  currentScreenType: "home",
  screenshotPath: "/dev/null",
  elements: [{ index: 0, type: "tap", label: "Open", priority: 100 }],
  recentHistory: [],
  appMapSummary: { totalScreens: 0, navTabs: [] },
};

describe("buildPrompt", () => {
  it("includes goal, package, elements, and history", () => {
    const prompt = buildPrompt({
      ...baseInput,
      goal: "find the search bar",
      credentials: { email: "x@y.com", password: "secret" },
      stepNumber: 5,
      visitedScreensCount: 3,
      currentScreenType: "feed",
      elements: [
        { index: 0, type: "tap", label: "Home", priority: 90 },
        { index: 1, type: "tap", label: "Search", priority: 80 },
      ],
      recentHistory: [{ step: 4, action: "tap Profile", outcome: "new_screen" }],
    });
    assert.match(prompt, /find the search bar/);
    assert.match(prompt, /x@y\.com/);
    assert.match(prompt, /\[0\] tap: "Home"/);
    assert.match(prompt, /\[1\] tap: "Search"/);
    assert.match(prompt, /step 4: tap Profile/);
  });

  it("handles null credentials gracefully", () => {
    const prompt = buildPrompt(baseInput);
    assert.match(prompt, /no login credentials/);
  });

  it("includes app map summary with nav tabs", () => {
    const prompt = buildPrompt({
      ...baseInput,
      appMapSummary: {
        totalScreens: 5,
        navTabs: [
          { label: "Home", explored: true, exhausted: false },
          { label: "Search", explored: false, exhausted: false },
        ],
      },
    });
    assert.match(prompt, /Total screens visited: 5/);
    assert.match(prompt, /- Home \(explored\)/);
    assert.match(prompt, /- Search$/m);
  });
});

describe("parseDecision", () => {
  it("parses clean JSON", () => {
    const out = parseDecision('{"reasoning":"tap home","actionIndex":2,"expectedOutcome":"see home screen"}');
    assert.deepStrictEqual(out, {
      reasoning: "tap home",
      actionIndex: 2,
      expectedOutcome: "see home screen",
    });
  });

  it("strips markdown fences", () => {
    const out = parseDecision('```json\n{"reasoning":"x","actionIndex":0,"expectedOutcome":"y"}\n```');
    assert.strictEqual(out.actionIndex, 0);
  });

  it("returns null on missing actionIndex", () => {
    assert.strictEqual(parseDecision('{"reasoning":"x"}'), null);
  });

  it("returns null on non-integer actionIndex", () => {
    assert.strictEqual(parseDecision('{"reasoning":"x","actionIndex":"two"}'), null);
  });

  it("returns null on negative actionIndex", () => {
    assert.strictEqual(parseDecision('{"reasoning":"x","actionIndex":-1,"expectedOutcome":"y"}'), null);
  });

  it("returns null on garbage", () => {
    assert.strictEqual(parseDecision("not json at all"), null);
  });

  it("tolerates prose around the JSON object", () => {
    const out = parseDecision('Here is my answer: {"reasoning":"x","actionIndex":3,"expectedOutcome":"y"} — done.');
    assert.strictEqual(out.actionIndex, 3);
  });
});

describe("decide", () => {
  const baseDecideInput = {
    goal: "test",
    credentials: null,
    packageName: "com.test",
    stepNumber: 1,
    maxSteps: 10,
    visitedScreensCount: 0,
    currentScreenType: "home",
    screenshotPath: "/tmp/fake.png",
    elements: [{ index: 0, type: "tap", label: "Open", priority: 100 }],
    recentHistory: [],
    appMapSummary: { totalScreens: 0, navTabs: [] },
  };

  it("returns -1 without calling API when elements is empty", async () => {
    const { decide } = require("../agent");
    let apiCalled = false;
    const result = await decide({ ...baseDecideInput, elements: [] }, {
      apiClient: { messages: { create: async () => { apiCalled = true; return {}; } } },
      readFile: () => Buffer.from(""),
    });
    assert.strictEqual(result.actionIndex, -1);
    assert.strictEqual(apiCalled, false);
  });

  it("falls back to actionIndex 0 when API returns unparseable text", async () => {
    const { decide } = require("../agent");
    const result = await decide(baseDecideInput, {
      apiClient: {
        messages: {
          create: async () => ({
            content: [{ type: "text", text: "totally not json" }],
            usage: { input_tokens: 100, output_tokens: 50 },
          }),
        },
      },
      readFile: () => Buffer.from("fake-png-bytes"),
    });
    assert.strictEqual(result.actionIndex, 0);
    assert.match(result.reasoning, /fallback/);
  });

  it("returns the agent's chosen index when API returns valid JSON", async () => {
    const { decide } = require("../agent");
    const elements = [
      { index: 0, type: "tap", label: "Home", priority: 100 },
      { index: 1, type: "tap", label: "Settings", priority: 90 },
    ];
    const result = await decide({ ...baseDecideInput, elements }, {
      apiClient: {
        messages: {
          create: async () => ({
            content: [{ type: "text", text: '{"reasoning":"tap settings","actionIndex":1,"expectedOutcome":"see settings"}' }],
            usage: { input_tokens: 100, output_tokens: 50 },
          }),
        },
      },
      readFile: () => Buffer.from("fake-png-bytes"),
    });
    assert.strictEqual(result.actionIndex, 1);
    assert.strictEqual(result.reasoning, "tap settings");
  });

  it("falls back to 0 with prefixed reasoning when LLM picks out-of-range index", async () => {
    const { decide } = require("../agent");
    const elements = [
      { index: 0, type: "tap", label: "Home", priority: 100 },
      { index: 1, type: "tap", label: "Settings", priority: 90 },
    ];
    const result = await decide({ ...baseDecideInput, elements }, {
      apiClient: {
        messages: {
          create: async () => ({
            content: [{ type: "text", text: '{"reasoning":"pick five","actionIndex":5,"expectedOutcome":"y"}' }],
            usage: { input_tokens: 100, output_tokens: 50 },
          }),
        },
      },
      readFile: () => Buffer.from("fake-png-bytes"),
    });
    assert.strictEqual(result.actionIndex, 0);
    assert.match(result.reasoning, /out-of-range fallback/);
  });
});

const baseCoordInput = {
  goal: "explore",
  credentials: null,
  packageName: "com.test.app",
  stepNumber: 1,
  maxSteps: 50,
  visitedScreensCount: 0,
  currentScreenType: "unknown",
  screenshotPath: "/tmp/fake.png",
  recentHistory: [],
  appMapSummary: { totalScreens: 0, navTabs: [] },
};

describe("buildCoordPrompt", () => {
  it("warns that XML extraction failed and there is no element list", () => {
    const prompt = buildCoordPrompt(baseCoordInput);
    assert.match(prompt, /XML EXTRACTION FAILED/);
    assert.doesNotMatch(prompt, /\[0\]/);
    assert.doesNotMatch(prompt, /AVAILABLE ACTIONS/);
  });

  it("includes goal, package name, step counter, and screen size hint", () => {
    const prompt = buildCoordPrompt({
      ...baseCoordInput,
      goal: "find the search bar",
      packageName: "com.example.app",
      stepNumber: 7,
      maxSteps: 25,
    });
    assert.match(prompt, /find the search bar/);
    assert.match(prompt, /com\.example\.app/);
    assert.match(prompt, /Step: 7 of 25/);
    assert.match(prompt, /1080.*2400/);
  });

  it("explains the per-step typing limitation when credentials are present", () => {
    const prompt = buildCoordPrompt({
      ...baseCoordInput,
      credentials: { email: "x@y.com", password: "secret" },
    });
    assert.match(prompt, /x@y\.com/);
    assert.match(prompt, /next step you'll be able to type/);
  });

  it("specifies the JSON shapes for tap and back", () => {
    const prompt = buildCoordPrompt(baseCoordInput);
    assert.match(prompt, /"action": "tap"/);
    assert.match(prompt, /"action": "back"/);
    assert.match(prompt, /"x":/);
    assert.match(prompt, /"y":/);
  });

  it("renders recent history entries", () => {
    const prompt = buildCoordPrompt({
      ...baseCoordInput,
      recentHistory: [
        { step: 3, action: "tap Home", outcome: "new_screen" },
        { step: 4, action: "tap Profile", outcome: "loop_detected" },
      ],
    });
    assert.match(prompt, /step 3: tap Home → new_screen/);
    assert.match(prompt, /step 4: tap Profile → loop_detected/);
  });
});

describe("parseCoordDecision", () => {
  it("parses a tap response", () => {
    const out = parseCoordDecision('{"reasoning":"hit settings","action":"tap","x":540,"y":920,"expectedOutcome":"settings opens"}');
    assert.deepStrictEqual(out, {
      reasoning: "hit settings",
      action: "tap",
      x: 540,
      y: 920,
      expectedOutcome: "settings opens",
    });
  });

  it("parses a back response without coordinates", () => {
    const out = parseCoordDecision('{"reasoning":"nothing new here","action":"back","expectedOutcome":"prev screen"}');
    assert.deepStrictEqual(out, {
      reasoning: "nothing new here",
      action: "back",
      expectedOutcome: "prev screen",
    });
  });

  it("rounds float coordinates to integers", () => {
    const out = parseCoordDecision('{"reasoning":"x","action":"tap","x":540.7,"y":920.4,"expectedOutcome":"y"}');
    assert.strictEqual(out.x, 541);
    assert.strictEqual(out.y, 920);
  });

  it("strips markdown fences", () => {
    const out = parseCoordDecision('```json\n{"reasoning":"x","action":"tap","x":100,"y":200,"expectedOutcome":"y"}\n```');
    assert.strictEqual(out.action, "tap");
  });

  it("returns null on missing action", () => {
    assert.strictEqual(parseCoordDecision('{"reasoning":"x","x":100,"y":200}'), null);
  });

  it("returns null on unknown action verb", () => {
    assert.strictEqual(parseCoordDecision('{"reasoning":"x","action":"fly","x":100,"y":200,"expectedOutcome":"y"}'), null);
  });

  it("returns null when tap is missing x or y", () => {
    assert.strictEqual(parseCoordDecision('{"reasoning":"x","action":"tap","x":100,"expectedOutcome":"y"}'), null);
    assert.strictEqual(parseCoordDecision('{"reasoning":"x","action":"tap","y":100,"expectedOutcome":"y"}'), null);
  });

  it("returns null on negative coordinates", () => {
    assert.strictEqual(parseCoordDecision('{"reasoning":"x","action":"tap","x":-5,"y":100,"expectedOutcome":"y"}'), null);
  });

  it("returns null on non-numeric coordinates", () => {
    assert.strictEqual(parseCoordDecision('{"reasoning":"x","action":"tap","x":"left","y":100,"expectedOutcome":"y"}'), null);
  });

  it("returns null on garbage", () => {
    assert.strictEqual(parseCoordDecision("not json"), null);
  });
});

describe("parseCoordDecision expanded vocabulary", () => {
  it("parses tap with coords", () => {
    const out = parseCoordDecision('{"reasoning":"hit btn","action":"tap","x":540,"y":920,"expectedOutcome":"opens"}');
    assert.deepStrictEqual(out, {
      action: "tap",
      reasoning: "hit btn",
      x: 540,
      y: 920,
      expectedOutcome: "opens",
    });
  });

  it("rejects tap with negative coord", () => {
    assert.strictEqual(
      parseCoordDecision('{"reasoning":"x","action":"tap","x":-10,"y":100,"expectedOutcome":"y"}'),
      null,
    );
    assert.strictEqual(
      parseCoordDecision('{"reasoning":"x","action":"tap","x":100,"y":-5,"expectedOutcome":"y"}'),
      null,
    );
  });

  it("rejects tap with out-of-range coord", () => {
    assert.strictEqual(
      parseCoordDecision('{"reasoning":"x","action":"tap","x":9999,"y":100,"expectedOutcome":"y"}'),
      null,
    );
  });

  it("parses type with text", () => {
    const out = parseCoordDecision('{"reasoning":"fill email","action":"type","text":"user@example.com","expectedOutcome":"field populated"}');
    assert.deepStrictEqual(out, {
      action: "type",
      reasoning: "fill email",
      text: "user@example.com",
      expectedOutcome: "field populated",
    });
  });

  it("rejects type with empty text", () => {
    assert.strictEqual(
      parseCoordDecision('{"reasoning":"x","action":"type","text":"","expectedOutcome":"y"}'),
      null,
    );
  });

  it("rejects type with text >500 chars", () => {
    const longText = "a".repeat(501);
    assert.strictEqual(
      parseCoordDecision(`{"reasoning":"x","action":"type","text":"${longText}","expectedOutcome":"y"}`),
      null,
    );
  });

  it("rejects type with non-string text", () => {
    assert.strictEqual(
      parseCoordDecision('{"reasoning":"x","action":"type","text":123,"expectedOutcome":"y"}'),
      null,
    );
  });

  it("parses swipe with default durationMs when durationMs is absent", () => {
    const out = parseCoordDecision('{"reasoning":"scroll down","action":"swipe","x1":540,"y1":1500,"x2":540,"y2":500,"expectedOutcome":"list moves up"}');
    assert.deepStrictEqual(out, {
      action: "swipe",
      reasoning: "scroll down",
      x1: 540,
      y1: 1500,
      x2: 540,
      y2: 500,
      durationMs: 300,
      expectedOutcome: "list moves up",
    });
  });

  it("parses swipe with explicit durationMs", () => {
    const out = parseCoordDecision('{"reasoning":"slow swipe","action":"swipe","x1":100,"y1":200,"x2":800,"y2":200,"durationMs":750,"expectedOutcome":"page changes"}');
    assert.strictEqual(out.action, "swipe");
    assert.strictEqual(out.durationMs, 750);
  });

  it("uses default durationMs when swipe durationMs is out of valid window", () => {
    const tooShort = parseCoordDecision('{"reasoning":"x","action":"swipe","x1":100,"y1":200,"x2":800,"y2":200,"durationMs":10,"expectedOutcome":"y"}');
    assert.strictEqual(tooShort.durationMs, 300);
    const tooLong = parseCoordDecision('{"reasoning":"x","action":"swipe","x1":100,"y1":200,"x2":800,"y2":200,"durationMs":9000,"expectedOutcome":"y"}');
    assert.strictEqual(tooLong.durationMs, 300);
  });

  it("rejects swipe with missing or bad coordinate", () => {
    assert.strictEqual(
      parseCoordDecision('{"reasoning":"x","action":"swipe","x1":100,"y1":200,"x2":800,"expectedOutcome":"y"}'),
      null,
    );
    assert.strictEqual(
      parseCoordDecision('{"reasoning":"x","action":"swipe","x1":-50,"y1":200,"x2":800,"y2":200,"expectedOutcome":"y"}'),
      null,
    );
    assert.strictEqual(
      parseCoordDecision('{"reasoning":"x","action":"swipe","x1":100,"y1":200,"x2":9999,"y2":200,"expectedOutcome":"y"}'),
      null,
    );
  });

  it("parses long_press", () => {
    const out = parseCoordDecision('{"reasoning":"open context menu","action":"long_press","x":300,"y":600,"expectedOutcome":"menu appears"}');
    assert.deepStrictEqual(out, {
      action: "long_press",
      reasoning: "open context menu",
      x: 300,
      y: 600,
      expectedOutcome: "menu appears",
    });
  });

  it("rejects long_press with negative coord", () => {
    assert.strictEqual(
      parseCoordDecision('{"reasoning":"x","action":"long_press","x":-1,"y":100,"expectedOutcome":"y"}'),
      null,
    );
  });

  it("parses back", () => {
    const out = parseCoordDecision('{"reasoning":"nothing left","action":"back","expectedOutcome":"prev screen"}');
    assert.deepStrictEqual(out, {
      action: "back",
      reasoning: "nothing left",
      expectedOutcome: "prev screen",
    });
  });

  it("parses wait with clamped durationMs (5000 → 3000)", () => {
    const out = parseCoordDecision('{"reasoning":"let animation finish","action":"wait","durationMs":5000,"expectedOutcome":"content loads"}');
    assert.deepStrictEqual(out, {
      action: "wait",
      reasoning: "let animation finish",
      durationMs: 3000,
      expectedOutcome: "content loads",
    });
  });

  it("parses wait with sub-range durationMs unchanged", () => {
    const out = parseCoordDecision('{"reasoning":"brief pause","action":"wait","durationMs":500,"expectedOutcome":"settle"}');
    assert.strictEqual(out.durationMs, 500);
  });

  it("clamps negative wait durationMs to 0", () => {
    const out = parseCoordDecision('{"reasoning":"x","action":"wait","durationMs":-200,"expectedOutcome":"y"}');
    assert.strictEqual(out.durationMs, 0);
  });

  it("rejects wait with non-numeric durationMs", () => {
    assert.strictEqual(
      parseCoordDecision('{"reasoning":"x","action":"wait","durationMs":"long","expectedOutcome":"y"}'),
      null,
    );
  });

  it("rejects unknown action like 'fly'", () => {
    assert.strictEqual(
      parseCoordDecision('{"reasoning":"x","action":"fly","expectedOutcome":"y"}'),
      null,
    );
  });

  it("rejects action when reasoning is missing", () => {
    assert.strictEqual(
      parseCoordDecision('{"action":"tap","x":100,"y":100,"expectedOutcome":"y"}'),
      null,
    );
  });
});

describe("buildCoordPrompt vision-first additions", () => {
  it("uses vision-first note when visionFirstMode=true", () => {
    const prompt = buildCoordPrompt({ ...baseCoordInput, visionFirstMode: true });
    assert.match(prompt, /full gesture control/);
    assert.doesNotMatch(prompt, /XML EXTRACTION FAILED/);
  });

  it("falls back to XML-failed note when visionFirstMode is not set", () => {
    const prompt = buildCoordPrompt(baseCoordInput);
    assert.match(prompt, /XML EXTRACTION FAILED/);
  });

  it("renders xml hints when provided", () => {
    const prompt = buildCoordPrompt({
      ...baseCoordInput,
      xmlHints: ["Log in", "Sign up"],
    });
    assert.match(prompt, /ADVISORY TEXT HINTS/);
    assert.match(prompt, /\[0\] "Log in"/);
    assert.match(prompt, /\[1\] "Sign up"/);
  });

  it("shows 'no XML text hints' when hints missing or empty", () => {
    const promptMissing = buildCoordPrompt(baseCoordInput);
    assert.match(promptMissing, /no XML text hints available/);
    const promptEmpty = buildCoordPrompt({ ...baseCoordInput, xmlHints: [] });
    assert.match(promptEmpty, /no XML text hints available/);
  });

  it("documents the full 6-primitive action vocabulary", () => {
    const prompt = buildCoordPrompt(baseCoordInput);
    assert.match(prompt, /"action": "tap"/);
    assert.match(prompt, /"action": "type"/);
    assert.match(prompt, /"action": "swipe"/);
    assert.match(prompt, /"action": "long_press"/);
    assert.match(prompt, /"action": "back"/);
    assert.match(prompt, /"action": "wait"/);
  });
});

describe("decideCoordinates", () => {
  it("returns the agent's tap coordinates when API returns valid JSON", async () => {
    const result = await decideCoordinates(baseCoordInput, {
      apiClient: {
        messages: {
          create: async () => ({
            content: [{ type: "text", text: '{"reasoning":"tap login","action":"tap","x":540,"y":1200,"expectedOutcome":"login screen"}' }],
            usage: { input_tokens: 100, output_tokens: 50 },
          }),
        },
      },
      readFile: () => Buffer.from("fake-png-bytes"),
    });
    assert.strictEqual(result.action, "tap");
    assert.strictEqual(result.x, 540);
    assert.strictEqual(result.y, 1200);
    assert.strictEqual(result.reasoning, "tap login");
  });

  it("returns a back decision when the agent wants to go back", async () => {
    const result = await decideCoordinates(baseCoordInput, {
      apiClient: {
        messages: {
          create: async () => ({
            content: [{ type: "text", text: '{"reasoning":"nothing here","action":"back","expectedOutcome":"prev"}' }],
            usage: { input_tokens: 100, output_tokens: 50 },
          }),
        },
      },
      readFile: () => Buffer.from("fake-png-bytes"),
    });
    assert.strictEqual(result.action, "back");
    assert.strictEqual(result.reasoning, "nothing here");
  });

  it("falls back to back action on unparseable response", async () => {
    const result = await decideCoordinates(baseCoordInput, {
      apiClient: {
        messages: {
          create: async () => ({
            content: [{ type: "text", text: "totally not json" }],
            usage: { input_tokens: 100, output_tokens: 50 },
          }),
        },
      },
      readFile: () => Buffer.from("fake-png-bytes"),
    });
    assert.strictEqual(result.action, "back");
    assert.match(result.reasoning, /fallback/);
  });
});

describe("buildCoordPromptParts caching", () => {
  const baseCachingInput = {
    goal: "explore the app thoroughly",
    credentials: { email: "test@example.com", password: "secret123" },
    packageName: "com.test.app",
    maxSteps: 50,
    recentHistory: [],
    appMapSummary: { totalScreens: 0, navTabs: [] },
    xmlHints: [],
    visionFirstMode: true,
    screenshotPath: "/tmp/dummy.png",
    elements: [],
  };

  it("prefix is byte-identical across different step numbers", () => {
    const p1 = buildCoordPromptParts({ ...baseCachingInput, stepNumber: 1, visitedScreensCount: 0, currentScreenType: "home" });
    const p2 = buildCoordPromptParts({ ...baseCachingInput, stepNumber: 42, visitedScreensCount: 15, currentScreenType: "feed" });
    assert.strictEqual(p1.prefix, p2.prefix);
  });

  it("prefix is byte-identical across different history/appMap/hints", () => {
    const p1 = buildCoordPromptParts({
      ...baseCachingInput,
      stepNumber: 5, visitedScreensCount: 3, currentScreenType: "feed",
      recentHistory: [{ step: 4, action: "agent_tap", outcome: "new_screen" }],
      appMapSummary: { totalScreens: 3, navTabs: [{ label: "Home", explored: true, exhausted: false }] },
      xmlHints: ["Login", "Settings"],
    });
    const p2 = buildCoordPromptParts({
      ...baseCachingInput,
      stepNumber: 5, visitedScreensCount: 3, currentScreenType: "feed",
      recentHistory: [{ step: 4, action: "agent_back", outcome: "went_back" }],
      appMapSummary: { totalScreens: 7, navTabs: [{ label: "Profile", explored: false, exhausted: false }] },
      xmlHints: ["Profile", "Logout"],
    });
    assert.strictEqual(p1.prefix, p2.prefix);
  });

  it("suffix differs across different step numbers", () => {
    const p1 = buildCoordPromptParts({ ...baseCachingInput, stepNumber: 1, visitedScreensCount: 0, currentScreenType: "home" });
    const p2 = buildCoordPromptParts({ ...baseCachingInput, stepNumber: 42, visitedScreensCount: 15, currentScreenType: "feed" });
    assert.notStrictEqual(p1.suffix, p2.suffix);
  });

  it("prefix includes goal, credential strategy, action schema, package", () => {
    const p = buildCoordPromptParts({ ...baseCachingInput, stepNumber: 1, visitedScreensCount: 0, currentScreenType: "home" });
    assert.match(p.prefix, /explore the app thoroughly/);
    assert.match(p.prefix, /TOP PRIORITY UNTIL LOGGED IN/);
    assert.match(p.prefix, /ACTION VOCABULARY/);
    assert.match(p.prefix, /"action": "tap"/);
    assert.match(p.prefix, /com\.test\.app/);
  });

  it("prefix does NOT contain plaintext credential values (never stored in cache)", () => {
    const p = buildCoordPromptParts({ ...baseCachingInput, stepNumber: 1, visitedScreensCount: 0, currentScreenType: "home" });
    assert.doesNotMatch(p.prefix, /test@example\.com/);
    assert.doesNotMatch(p.prefix, /secret123/);
  });

  it("suffix carries plaintext credential values (never cached)", () => {
    const p = buildCoordPromptParts({ ...baseCachingInput, stepNumber: 1, visitedScreensCount: 0, currentScreenType: "home" });
    assert.match(p.suffix, /test@example\.com/);
    assert.match(p.suffix, /secret123/);
    assert.match(p.suffix, /LOGIN CREDENTIALS/);
  });

  it("prefix excludes per-step variable state", () => {
    const p = buildCoordPromptParts({
      ...baseCachingInput,
      stepNumber: 42,
      visitedScreensCount: 15,
      currentScreenType: "feed",
      recentHistory: [{ step: 41, action: "agent_tap(540,1200)", outcome: "new_screen" }],
      appMapSummary: { totalScreens: 7, navTabs: [{ label: "UniqueTabLabel", explored: true, exhausted: false }] },
      xmlHints: ["UniqueHintXYZ"],
    });
    assert.doesNotMatch(p.prefix, /Step: 42/);
    assert.doesNotMatch(p.prefix, /Unique screens visited so far: 15/);
    assert.doesNotMatch(p.prefix, /agent_tap\(540,1200\)/);
    assert.doesNotMatch(p.prefix, /UniqueTabLabel/);
    assert.doesNotMatch(p.prefix, /UniqueHintXYZ/);
  });

  it("suffix includes step state and history", () => {
    const p = buildCoordPromptParts({
      ...baseCachingInput,
      stepNumber: 5,
      visitedScreensCount: 3,
      currentScreenType: "feed",
      recentHistory: [{ step: 4, action: "agent_tap(540,1200)", outcome: "new_screen" }],
    });
    assert.match(p.suffix, /Step: 5/);
    assert.match(p.suffix, /Unique screens visited so far: 3/);
    assert.match(p.suffix, /agent_tap/);
  });

  it("buildCoordPrompt wrapper returns prefix + suffix concatenation", () => {
    const input = { ...baseCachingInput, stepNumber: 5, visitedScreensCount: 3, currentScreenType: "feed" };
    const parts = buildCoordPromptParts(input);
    assert.strictEqual(buildCoordPrompt(input), parts.prefix + parts.suffix);
  });
});

describe("decideCoordinates prompt caching", () => {
  const cacheInput = {
    goal: "explore",
    credentials: null,
    packageName: "com.test.app",
    stepNumber: 1,
    maxSteps: 50,
    visitedScreensCount: 0,
    currentScreenType: "home",
    screenshotPath: "/tmp/fake.png",
    recentHistory: [],
    appMapSummary: { totalScreens: 0, navTabs: [] },
  };

  it("passes cache_control: ephemeral on the prefix block as the first content item", async () => {
    let captured = null;
    const fakeClient = {
      messages: {
        create: async (/** @type {any} */ req) => {
          captured = req;
          return {
            content: [{ type: "text", text: '{"reasoning":"r","action":"back","expectedOutcome":"e"}' }],
            usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          };
        },
      },
    };
    await decideCoordinates(cacheInput, {
      apiClient: fakeClient,
      readFile: () => Buffer.from("fake-image-bytes"),
    });

    assert.ok(captured, "apiClient.messages.create should have been called");
    const content = captured.messages[0].content;
    assert.strictEqual(content.length, 3, "content should have prefix, image, suffix blocks");

    // Prefix block: first, type=text, with ephemeral cache_control.
    assert.strictEqual(content[0].type, "text");
    assert.ok(content[0].cache_control, "prefix block must have cache_control");
    assert.deepStrictEqual(content[0].cache_control, { type: "ephemeral" });
    assert.match(content[0].text, /ACTION VOCABULARY/);

    // Image block: second. MUST come after the cached prefix.
    assert.strictEqual(content[1].type, "image");
    assert.strictEqual(content[1].source.type, "base64");
    assert.strictEqual(content[1].source.media_type, "image/png");

    // Suffix block: third, type=text, no cache_control (per-step).
    assert.strictEqual(content[2].type, "text");
    assert.strictEqual(content[2].cache_control, undefined);
    assert.match(content[2].text, /Step: 1 of 50/);
  });

  it("accumulates token usage into ctx.v2TokenUsage when provided", async () => {
    const fakeClient = {
      messages: {
        create: async () => ({
          content: [{ type: "text", text: '{"reasoning":"r","action":"back","expectedOutcome":"e"}' }],
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cache_creation_input_tokens: 300,
            cache_read_input_tokens: 0,
          },
        }),
      },
    };
    const ctx = {
      v2TokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    };
    await decideCoordinates(cacheInput, {
      apiClient: fakeClient,
      readFile: () => Buffer.from("fake-image-bytes"),
      ctx,
    });
    assert.strictEqual(ctx.v2TokenUsage.inputTokens, 100);
    assert.strictEqual(ctx.v2TokenUsage.outputTokens, 20);
    assert.strictEqual(ctx.v2TokenUsage.cacheCreationInputTokens, 300);
    assert.strictEqual(ctx.v2TokenUsage.cacheReadInputTokens, 0);
  });

  it("accumulates across multiple calls (subsequent call hits cache)", async () => {
    let callCount = 0;
    const fakeClient = {
      messages: {
        create: async () => {
          callCount++;
          if (callCount === 1) {
            return {
              content: [{ type: "text", text: '{"reasoning":"r","action":"back","expectedOutcome":"e"}' }],
              usage: {
                input_tokens: 50,
                output_tokens: 20,
                cache_creation_input_tokens: 300,
                cache_read_input_tokens: 0,
              },
            };
          }
          return {
            content: [{ type: "text", text: '{"reasoning":"r","action":"back","expectedOutcome":"e"}' }],
            usage: {
              input_tokens: 50,
              output_tokens: 20,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 300,
            },
          };
        },
      },
    };
    const ctx = {
      v2TokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    };
    const deps = {
      apiClient: fakeClient,
      readFile: () => Buffer.from("fake-image-bytes"),
      ctx,
    };
    await decideCoordinates(cacheInput, deps);
    await decideCoordinates({ ...cacheInput, stepNumber: 2 }, deps);
    assert.strictEqual(ctx.v2TokenUsage.inputTokens, 100);
    assert.strictEqual(ctx.v2TokenUsage.outputTokens, 40);
    assert.strictEqual(ctx.v2TokenUsage.cacheCreationInputTokens, 300);
    assert.strictEqual(ctx.v2TokenUsage.cacheReadInputTokens, 300);
  });

  it("does not crash when ctx is not provided", async () => {
    const fakeClient = {
      messages: {
        create: async () => ({
          content: [{ type: "text", text: '{"reasoning":"r","action":"back","expectedOutcome":"e"}' }],
          usage: { input_tokens: 50, output_tokens: 20 },
        }),
      },
    };
    const result = await decideCoordinates(cacheInput, {
      apiClient: fakeClient,
      readFile: () => Buffer.from("fake-image-bytes"),
    });
    assert.strictEqual(result.action, "back");
  });

  it("does not crash when ctx lacks v2TokenUsage field", async () => {
    const fakeClient = {
      messages: {
        create: async () => ({
          content: [{ type: "text", text: '{"reasoning":"r","action":"back","expectedOutcome":"e"}' }],
          usage: { input_tokens: 50, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }),
      },
    };
    const result = await decideCoordinates(cacheInput, {
      apiClient: fakeClient,
      readFile: () => Buffer.from("fake-image-bytes"),
      ctx: {},
    });
    assert.strictEqual(result.action, "back");
  });
});
