import assert from "node:assert/strict";
import test from "node:test";
import { TicketSchema } from "../build/schema.js";

test("TicketSchema applies defaults for optional fields", () => {
  const ticket = TicketSchema.parse({
    id: "T-0001",
    title: "Sample ticket",
    type: "feature",
    priority: "P1",
    status: "BACKLOG",
    owner: {
      role: "LEADER",
      agent: "leader",
    },
  });

  assert.deepEqual(ticket.assignees, []);
  assert.deepEqual(ticket.file_ownership, []);
  assert.deepEqual(ticket.acceptance_criteria, []);
  assert.deepEqual(ticket.artifacts, {
    proposed_changes: [],
    pr_links: [],
    commits: [],
  });
  assert.deepEqual(ticket.quality_gates, {
    verify_commands: [],
  });
  assert.deepEqual(ticket.log, []);
});

test("TicketSchema rejects invalid ticket id format", () => {
  assert.throws(() =>
    TicketSchema.parse({
      id: "ticket-1",
      title: "Bad id",
      type: "feature",
      priority: "P1",
      status: "BACKLOG",
      owner: {
        role: "LEADER",
        agent: "leader",
      },
    })
  );
});
