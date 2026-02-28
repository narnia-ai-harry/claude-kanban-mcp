import assert from "node:assert/strict";
import test from "node:test";
import { ticketBranchName, validateCommandBranch } from "../build/git.js";

test("validateCommandBranch builds feat/* branch name", () => {
  assert.equal(validateCommandBranch("add-auth"), "feat/add-auth");
});

test("validateCommandBranch rejects invalid slug", () => {
  assert.throws(() => validateCommandBranch("AddAuth"), /Invalid slug/);
  assert.throws(() => validateCommandBranch("add_auth"), /Invalid slug/);
});

test("ticketBranchName builds ticket branch under command branch", () => {
  assert.equal(ticketBranchName("feat/add-auth", "T-0001"), "feat/add-auth--T-0001");
});
