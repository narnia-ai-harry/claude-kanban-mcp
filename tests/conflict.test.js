import assert from "node:assert/strict";
import test from "node:test";
import { summarizeConflictRisk } from "../build/conflict.js";

test("summarizeConflictRisk returns high risk on overlapping files", () => {
  const summary = summarizeConflictRisk(
    ["src/a.ts", "src/shared.ts"],
    ["src/shared.ts", "src/other.ts"]
  );

  assert.equal(summary.risk, "high");
  assert.deepEqual(summary.overlapFiles, ["src/shared.ts"]);
});

test("summarizeConflictRisk returns medium risk for large change set", () => {
  const ticketFiles = Array.from({ length: 16 }, (_, i) => `src/t-${i}.ts`);
  const summary = summarizeConflictRisk(ticketFiles, ["src/only-command.ts"]);

  assert.equal(summary.risk, "medium");
  assert.equal(summary.overlapFiles.length, 0);
});

test("summarizeConflictRisk returns low risk for small non-overlapping changes", () => {
  const summary = summarizeConflictRisk(["src/a.ts"], ["src/b.ts"]);

  assert.equal(summary.risk, "low");
  assert.equal(summary.overlapFiles.length, 0);
});
