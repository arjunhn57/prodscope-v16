"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");
const { AppMap, EXHAUSTION_THRESHOLD, MAX_DEPTH } = require("../app-map");

describe("AppMap", () => {
  let map;

  beforeEach(() => {
    map = new AppMap();
  });

  // ─────────────────────────────────────────────────────────────────────
  // Screen registration + depth tracking
  // ─────────────────────────────────────────────────────────────────────

  describe("registerScreen", () => {
    it("registers a root screen at depth 0", () => {
      map.registerScreen("fp_A", 5, null, null);
      const node = map.screenNodes.get("fp_A");
      assert.ok(node);
      assert.strictEqual(node.depth, 0);
      assert.strictEqual(node.actionsTotal, 5);
      assert.strictEqual(node.visits, 1);
      assert.strictEqual(node.parentFp, null);
    });

    it("registers a chain A→B→C with correct depths", () => {
      map.registerScreen("fp_A", 5, null, null);
      map.registerScreen("fp_B", 3, "fp_A", "tap:btn1:100,200");
      map.registerScreen("fp_C", 2, "fp_B", "tap:btn2:300,400");

      assert.strictEqual(map.screenNodes.get("fp_A").depth, 0);
      assert.strictEqual(map.screenNodes.get("fp_B").depth, 1);
      assert.strictEqual(map.screenNodes.get("fp_C").depth, 2);
    });

    it("tracks parent-child relationships", () => {
      map.registerScreen("fp_A", 5, null, null);
      map.registerScreen("fp_B", 3, "fp_A", "tap:1");
      map.registerScreen("fp_C", 2, "fp_A", "tap:2");

      const parentNode = map.screenNodes.get("fp_A");
      assert.strictEqual(parentNode.children.has("fp_B"), true);
      assert.strictEqual(parentNode.children.has("fp_C"), true);

      assert.strictEqual(map.screenNodes.get("fp_B").parentFp, "fp_A");
      assert.strictEqual(map.screenNodes.get("fp_C").parentFp, "fp_A");
    });

    it("increments visit count on re-registration", () => {
      map.registerScreen("fp_A", 5, null, null);
      map.registerScreen("fp_A", 5, null, null);
      map.registerScreen("fp_A", 5, null, null);

      assert.strictEqual(map.screenNodes.get("fp_A").visits, 3);
    });

    it("updates actionsTotal upward on re-registration", () => {
      map.registerScreen("fp_A", 3, null, null);
      map.registerScreen("fp_A", 8, null, null); // more actions found
      map.registerScreen("fp_A", 5, null, null); // fewer — stays at 8

      assert.strictEqual(map.screenNodes.get("fp_A").actionsTotal, 8);
    });

    it("marks screen with 0 actions as immediately exhausted", () => {
      map.registerScreen("fp_A", 0, null, null);
      assert.strictEqual(map.screenNodes.get("fp_A").exhausted, true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Navigation path
  // ─────────────────────────────────────────────────────────────────────

  describe("navigation path", () => {
    it("pushScreen builds a path", () => {
      map.pushScreen("fp_A");
      map.pushScreen("fp_B");
      map.pushScreen("fp_C");
      assert.deepStrictEqual(map.currentPath, ["fp_A", "fp_B", "fp_C"]);
    });

    it("pushScreen ignores duplicate consecutive pushes", () => {
      map.pushScreen("fp_A");
      map.pushScreen("fp_A");
      assert.deepStrictEqual(map.currentPath, ["fp_A"]);
    });

    it("popScreen removes top of path", () => {
      map.pushScreen("fp_A");
      map.pushScreen("fp_B");
      const popped = map.popScreen();
      assert.strictEqual(popped, "fp_B");
      assert.deepStrictEqual(map.currentPath, ["fp_A"]);
    });

    it("popScreen returns null on empty path", () => {
      assert.strictEqual(map.popScreen(), null);
    });

    it("popToScreen truncates path correctly", () => {
      map.pushScreen("fp_A");
      map.pushScreen("fp_B");
      map.pushScreen("fp_C");
      map.pushScreen("fp_D");

      map.popToScreen("fp_B");
      assert.deepStrictEqual(map.currentPath, ["fp_A", "fp_B"]);
    });

    it("popToScreen does nothing if fp not in path", () => {
      map.pushScreen("fp_A");
      map.pushScreen("fp_B");
      map.popToScreen("fp_Z");
      assert.deepStrictEqual(map.currentPath, ["fp_A", "fp_B"]);
    });

    it("isInCurrentPath returns correct results", () => {
      map.pushScreen("fp_A");
      map.pushScreen("fp_B");
      assert.strictEqual(map.isInCurrentPath("fp_A"), true);
      assert.strictEqual(map.isInCurrentPath("fp_B"), true);
      assert.strictEqual(map.isInCurrentPath("fp_C"), false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Nav tabs
  // ─────────────────────────────────────────────────────────────────────

  describe("nav tabs", () => {
    it("setNavTabs initializes tabs", () => {
      map.setNavTabs([
        { label: "Home", cx: 108, cy: 2300 },
        { label: "Search", cx: 324, cy: 2300 },
        { label: "Profile", cx: 540, cy: 2300 },
      ]);
      assert.strictEqual(map.navTabs.length, 3);
      assert.strictEqual(map.navTabs[0].label, "Home");
      assert.strictEqual(map.navTabs[0].explored, false);
      assert.strictEqual(map.navTabs[0].exhausted, false);
    });

    it("setNavTabs only sets once (first detection wins)", () => {
      map.setNavTabs([
        { label: "Home", cx: 108, cy: 2300 },
        { label: "Search", cx: 324, cy: 2300 },
      ]);
      map.setNavTabs([
        { label: "Feed", cx: 108, cy: 2300 },
        { label: "Explore", cx: 324, cy: 2300 },
      ]);
      assert.strictEqual(map.navTabs[0].label, "Home"); // first set wins
    });

    it("setNavTabs ignores single-tab nav bars", () => {
      map.setNavTabs([{ label: "Home", cx: 108, cy: 2300 }]);
      assert.strictEqual(map.navTabs.length, 0);
    });

    it("registerTabRoot assigns tab to screen", () => {
      map.setNavTabs([
        { label: "Home", cx: 108, cy: 2300 },
        { label: "Search", cx: 324, cy: 2300 },
      ]);
      map.registerScreen("fp_home", 5, null, null);
      map.registerTabRoot(0, "fp_home");

      assert.strictEqual(map.navTabs[0].rootFp, "fp_home");
      assert.strictEqual(map.navTabs[0].explored, true);
      assert.strictEqual(map.screenNodes.get("fp_home").navTabIndex, 0);
      assert.strictEqual(map.screenNodes.get("fp_home").depth, 0);
      assert.strictEqual(map.currentNavTabIndex, 0);
    });

    it("child screens inherit tab index from parent", () => {
      map.setNavTabs([
        { label: "Home", cx: 108, cy: 2300 },
        { label: "Search", cx: 324, cy: 2300 },
      ]);
      map.registerScreen("fp_home", 5, null, null);
      map.registerTabRoot(0, "fp_home");
      map.registerScreen("fp_detail", 3, "fp_home", "tap:item1");

      assert.strictEqual(map.screenNodes.get("fp_detail").navTabIndex, 0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // getNextTab
  // ─────────────────────────────────────────────────────────────────────

  describe("getNextTab", () => {
    beforeEach(() => {
      map.setNavTabs([
        { label: "Home", cx: 108, cy: 2300 },
        { label: "Search", cx: 324, cy: 2300 },
        { label: "Profile", cx: 540, cy: 2300 },
      ]);
    });

    it("returns first unvisited tab", () => {
      const next = map.getNextTab();
      assert.strictEqual(next.label, "Home");
      assert.strictEqual(next.index, 0);
    });

    it("skips explored tabs and returns first unexplored", () => {
      map.registerScreen("fp_home", 5, null, null);
      map.registerTabRoot(0, "fp_home");
      map.currentNavTabIndex = 0;

      const next = map.getNextTab();
      assert.strictEqual(next.label, "Search");
      assert.strictEqual(next.index, 1);
    });

    it("returns non-exhausted tab when all explored", () => {
      // Explore all tabs
      map.registerScreen("fp_home", 5, null, null);
      map.registerTabRoot(0, "fp_home");
      map.registerScreen("fp_search", 3, null, null);
      map.registerTabRoot(1, "fp_search");
      map.registerScreen("fp_profile", 4, null, null);
      map.registerTabRoot(2, "fp_profile");

      // Exhaust tab 0 (Home)
      map.navTabs[0].exhausted = true;
      map.currentNavTabIndex = 0;

      const next = map.getNextTab();
      assert.strictEqual(next.label, "Search");
      assert.strictEqual(next.index, 1);
    });

    it("returns least-explored tab when all exhausted", () => {
      map.registerScreen("fp_home", 5, null, null);
      map.registerTabRoot(0, "fp_home");
      map.registerScreen("fp_search", 3, null, null);
      map.registerTabRoot(1, "fp_search");
      map.registerScreen("fp_profile", 4, null, null);
      map.registerTabRoot(2, "fp_profile");

      // Exhaust all
      map.navTabs[0].exhausted = true;
      map.navTabs[1].exhausted = true;
      map.navTabs[2].exhausted = true;

      // Search has fewest children (1 = root only via registerTabRoot)
      map.navTabs[0].childScreenCount = 5;
      map.navTabs[1].childScreenCount = 1;
      map.navTabs[2].childScreenCount = 3;

      const next = map.getNextTab();
      assert.strictEqual(next.label, "Search");
    });

    it("returns null when no tabs registered", () => {
      const emptyMap = new AppMap();
      assert.strictEqual(emptyMap.getNextTab(), null);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Exhaustion detection
  // ─────────────────────────────────────────────────────────────────────

  describe("exhaustion", () => {
    it("marks screen exhausted at 80% threshold", () => {
      map.registerScreen("fp_A", 10, null, null);

      // Try 7 of 10 — not exhausted (70%)
      for (let i = 0; i < 7; i++) {
        map.markActionTried("fp_A", `action_${i}`);
      }
      assert.strictEqual(map.isScreenExhausted("fp_A"), false);

      // Try 8 of 10 — exhausted (80%)
      map.markActionTried("fp_A", "action_7");
      assert.strictEqual(map.isScreenExhausted("fp_A"), true);
    });

    it("screen with 5 actions exhausts at 4 tried", () => {
      map.registerScreen("fp_A", 5, null, null);
      for (let i = 0; i < 3; i++) {
        map.markActionTried("fp_A", `action_${i}`);
      }
      assert.strictEqual(map.isScreenExhausted("fp_A"), false);

      map.markActionTried("fp_A", "action_3");
      assert.strictEqual(map.isScreenExhausted("fp_A"), true);
    });

    it("screen with 1 action exhausts at 1 tried", () => {
      map.registerScreen("fp_A", 1, null, null);
      map.markActionTried("fp_A", "action_0");
      assert.strictEqual(map.isScreenExhausted("fp_A"), true);
    });

    it("isScreenExhausted returns false for unknown screens", () => {
      assert.strictEqual(map.isScreenExhausted("fp_unknown"), false);
    });

    it("tab exhaustion triggers when all tab screens exhausted", () => {
      map.setNavTabs([
        { label: "Home", cx: 108, cy: 2300 },
        { label: "Search", cx: 324, cy: 2300 },
      ]);
      map.registerScreen("fp_home", 2, null, null);
      map.registerTabRoot(0, "fp_home");
      map.registerScreen("fp_detail", 1, "fp_home", "tap:1");

      // Exhaust both screens in tab 0
      map.markActionTried("fp_home", "tap:1");
      map.markActionTried("fp_home", "tap:2");
      map.markActionTried("fp_detail", "tap:3");

      assert.strictEqual(map.navTabs[0].exhausted, true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Exploration directives
  // ─────────────────────────────────────────────────────────────────────

  describe("getExplorationDirective", () => {
    it("returns explore for unknown screen", () => {
      const d = map.getExplorationDirective("fp_unknown", []);
      assert.strictEqual(d.type, "explore");
    });

    it("returns explore when untried actions exist", () => {
      map.registerScreen("fp_A", 5, null, null);
      const candidates = [
        { key: "tap:1" }, { key: "tap:2" }, { key: "tap:3" },
      ];
      const d = map.getExplorationDirective("fp_A", candidates);
      assert.strictEqual(d.type, "explore");
      assert.ok(d.reason.includes("3 untried"));
    });

    it("returns backtrack when screen exhausted with parent", () => {
      map.registerScreen("fp_A", 5, null, null);
      map.registerScreen("fp_B", 2, "fp_A", "tap:1");

      // Exhaust fp_B
      map.markActionTried("fp_B", "tap:x");
      map.markActionTried("fp_B", "tap:y");

      const d = map.getExplorationDirective("fp_B", [{ key: "tap:x" }, { key: "tap:y" }]);
      assert.strictEqual(d.type, "backtrack");
      assert.ok(d.reason.includes("screen_exhausted"));
    });

    it("returns backtrack when depth limit exceeded", () => {
      // Build a chain deeper than MAX_DEPTH
      let parentFp = null;
      for (let i = 0; i <= MAX_DEPTH + 1; i++) {
        const fp = `fp_${i}`;
        map.registerScreen(fp, 3, parentFp, parentFp ? `tap:${i}` : null);
        parentFp = fp;
      }

      const deepFp = `fp_${MAX_DEPTH + 1}`;
      const d = map.getExplorationDirective(deepFp, [{ key: "tap:x" }]);
      assert.strictEqual(d.type, "backtrack");
      assert.ok(d.reason.includes("depth_limit"));
    });

    it("returns switch_tab when tab root exhausted with tabs available", () => {
      map.setNavTabs([
        { label: "Home", cx: 108, cy: 2300 },
        { label: "Search", cx: 324, cy: 2300 },
      ]);
      map.registerScreen("fp_home", 2, null, null);
      map.registerTabRoot(0, "fp_home");

      // Exhaust home root
      map.markActionTried("fp_home", "tap:1");
      map.markActionTried("fp_home", "tap:2");

      const d = map.getExplorationDirective("fp_home", [{ key: "tap:1" }, { key: "tap:2" }]);
      assert.strictEqual(d.type, "switch_tab");
    });

    it("returns explore when no candidates and no alternatives", () => {
      map.registerScreen("fp_A", 0, null, null);
      const d = map.getExplorationDirective("fp_A", []);
      // No parent, no tabs — nothing to do
      assert.strictEqual(d.type, "explore");
      assert.strictEqual(d.reason, "no_alternatives");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Coverage stats
  // ─────────────────────────────────────────────────────────────────────

  describe("getCoverageStats", () => {
    it("returns correct stats", () => {
      map.setNavTabs([
        { label: "Home", cx: 108, cy: 2300 },
        { label: "Search", cx: 324, cy: 2300 },
      ]);
      map.registerScreen("fp_A", 2, null, null);
      map.registerTabRoot(0, "fp_A");
      map.registerScreen("fp_B", 1, "fp_A", "tap:1");
      map.registerScreen("fp_C", 3, null, null);

      // Exhaust fp_B
      map.markActionTried("fp_B", "act_1");

      const stats = map.getCoverageStats();
      assert.strictEqual(stats.totalScreens, 3);
      assert.strictEqual(stats.exhaustedScreens, 1);
      assert.strictEqual(stats.tabStats.length, 2);
      assert.strictEqual(stats.tabStats[0].explored, true);
      assert.strictEqual(stats.tabStats[1].explored, false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // updateActionsTotal
  // ─────────────────────────────────────────────────────────────────────

  describe("updateActionsTotal", () => {
    it("updates total upward", () => {
      map.registerScreen("fp_A", 3, null, null);
      map.updateActionsTotal("fp_A", 8);
      assert.strictEqual(map.screenNodes.get("fp_A").actionsTotal, 8);
    });

    it("does not decrease total", () => {
      map.registerScreen("fp_A", 8, null, null);
      map.updateActionsTotal("fp_A", 3);
      assert.strictEqual(map.screenNodes.get("fp_A").actionsTotal, 8);
    });

    it("ignores unknown screens", () => {
      map.updateActionsTotal("fp_unknown", 5); // should not throw
    });
  });
});
