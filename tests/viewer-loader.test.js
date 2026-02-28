import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadBoardSnapshot } from "../build/viewer/loader.js";

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kanban-viewer-test-"));
}

test("loadBoardSnapshot separates valid and invalid tickets", () => {
  const root = makeTempRoot();
  const ticketsDir = path.join(root, "tickets");
  fs.mkdirSync(ticketsDir, { recursive: true });

  fs.writeFileSync(
    path.join(ticketsDir, "T-0001.yml"),
    [
      "id: T-0001",
      "title: Add endpoint",
      "type: feature",
      "priority: P1",
      "status: READY",
      "owner:",
      "  role: LEADER",
      "  agent: leader",
      "assignees:",
      "  - worker1",
      "quality_gates:",
      "  verify_commands:",
      "    - npm run test",
      "log: []",
      "",
    ].join("\n"),
    "utf-8"
  );

  fs.writeFileSync(
    path.join(ticketsDir, "T-0002.yml"),
    [
      "id: T-0002",
      "title: Broken ticket",
      "type: feature",
      "priority: P2",
      "status: UNKNOWN_STATUS",
      "owner:",
      "  role: LEADER",
      "  agent: leader",
      "",
    ].join("\n"),
    "utf-8"
  );

  const snapshot = loadBoardSnapshot(root);
  assert.equal(snapshot.tickets.length, 1);
  assert.equal(snapshot.invalidTickets.length, 1);
  assert.equal(snapshot.tickets[0].id, "T-0001");
  assert.equal(snapshot.counts.READY, 1);
  assert.deepEqual(snapshot.assignees, ["worker1"]);

  fs.rmSync(root, { recursive: true, force: true });
});

test("loadBoardSnapshot reports missing tickets directory", () => {
  const root = makeTempRoot();
  const snapshot = loadBoardSnapshot(root);

  assert.equal(snapshot.tickets.length, 0);
  assert.equal(snapshot.invalidTickets.length, 1);
  assert.match(snapshot.invalidTickets[0].errors[0], /Directory not found/);

  fs.rmSync(root, { recursive: true, force: true });
});
