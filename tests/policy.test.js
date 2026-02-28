import assert from "node:assert/strict";
import test from "node:test";
import { assertLeaderCaller, assertQualityCaller } from "../build/policy.js";

test("assertQualityCaller allows quality caller", () => {
  assert.doesNotThrow(() => assertQualityCaller("git_merge_ticket", "quality"));
  assert.doesNotThrow(() => assertQualityCaller("git_merge_ticket", "QUALITY"));
});

test("assertQualityCaller rejects non-quality caller", () => {
  assert.throws(() => assertQualityCaller("git_merge_ticket", "worker1"), /only be called by quality/);
});

test("assertLeaderCaller allows leader caller", () => {
  assert.doesNotThrow(() => assertLeaderCaller("git_merge_command", "leader"));
  assert.doesNotThrow(() => assertLeaderCaller("git_merge_command", "LEADER"));
});

test("assertLeaderCaller rejects non-leader caller", () => {
  assert.throws(() => assertLeaderCaller("git_merge_command", "quality"), /only be called by leader/);
});
