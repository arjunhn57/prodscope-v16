"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createStateGraph } = require("../state");

test("new graph reports 0 unique screens", () => {
  const g = createStateGraph();
  assert.equal(g.uniqueScreenCount(), 0);
  assert.deepEqual(g.history(), []);
});

test("recordVisit marks first visit isNew=true, subsequent isNew=false", () => {
  const g = createStateGraph();
  const a = g.recordVisit("fp1", { activity: "a/b", packageName: "com.a", step: 1 });
  const b = g.recordVisit("fp1", { activity: "a/b", packageName: "com.a", step: 2 });
  assert.equal(a.isNew, true);
  assert.equal(a.visitCount, 1);
  assert.equal(b.isNew, false);
  assert.equal(b.visitCount, 2);
});

test("unique screen count tracks distinct fingerprints", () => {
  const g = createStateGraph();
  g.recordVisit("fp1", { activity: "x", packageName: "com.a", step: 1 });
  g.recordVisit("fp2", { activity: "x", packageName: "com.a", step: 2 });
  g.recordVisit("fp1", { activity: "x", packageName: "com.a", step: 3 });
  assert.equal(g.uniqueScreenCount(), 2);
});

test("history preserves chronological order", () => {
  const g = createStateGraph();
  g.recordVisit("fp1", { activity: "A", packageName: "p", step: 1 });
  g.recordVisit("fp2", { activity: "B", packageName: "p", step: 2 });
  g.recordVisit("fp1", { activity: "A", packageName: "p", step: 3 });
  const h = g.history();
  assert.equal(h.length, 3);
  assert.deepEqual(h.map((v) => v.fingerprint), ["fp1", "fp2", "fp1"]);
  assert.deepEqual(h.map((v) => v.step), [1, 2, 3]);
});

test("visitCounts returns map of fingerprint → count", () => {
  const g = createStateGraph();
  g.recordVisit("fp1", { activity: "x", packageName: "p", step: 1 });
  g.recordVisit("fp2", { activity: "x", packageName: "p", step: 2 });
  g.recordVisit("fp1", { activity: "x", packageName: "p", step: 3 });
  assert.deepEqual(g.visitCounts(), { fp1: 2, fp2: 1 });
});

test("recordVisit rejects empty fingerprint", () => {
  const g = createStateGraph();
  assert.throws(() => g.recordVisit("", { step: 1 }), /non-empty fingerprint/);
  assert.throws(() => g.recordVisit(null, { step: 1 }), /non-empty fingerprint/);
});

test("history() returns defensive copy", () => {
  const g = createStateGraph();
  g.recordVisit("fp1", { activity: "x", packageName: "p", step: 1 });
  const h1 = g.history();
  h1.push({ fingerprint: "bogus" });
  assert.equal(g.history().length, 1);
});
