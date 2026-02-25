import { z } from "zod";

// === Enums ===
export const TicketType = z.enum(["feature", "bug", "chore", "docs", "test"]);
export const Priority = z.enum(["P0", "P1", "P2", "P3"]);
export const Status = z.enum([
  "BACKLOG",
  "READY",
  "IN_PROGRESS",
  "REVIEW",
  "DONE",
  "BLOCKED",
]);
export const AgentRole = z.enum(["LEADER", "WORKER", "QUALITY"]);

// === Log Entry ===
export const LogEntry = z.object({
  at: z.string(), // ISO8601
  by: z.string(),
  action: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  note: z.string().optional(),
});

// === Quality Gates ===
export const QualityGates = z.object({
  lint: z.boolean().default(true),
  tests: z.boolean().default(true),
  typecheck: z.boolean().default(true),
  coverage_min: z.number().min(0).max(100).default(70),
});

// === Artifacts ===
export const Artifacts = z.object({
  proposed_changes: z.array(z.string()).default([]),
  pr_links: z.array(z.string()).default([]),
  commits: z.array(z.string()).default([]),
});

// === Full Ticket Schema ===
export const TicketSchema = z.object({
  id: z.string().regex(/^T-\d{4}$/, "Format: T-XXXX"),
  title: z.string().min(1),
  type: TicketType,
  priority: Priority,
  status: Status,

  owner: z.object({
    role: AgentRole,
    agent: z.string(),
  }),

  assignees: z.array(z.string()).default([]),

  description: z.string().default(""),

  file_ownership: z.array(z.string()).default([]),

  acceptance_criteria: z.array(z.string()).default([]),

  artifacts: Artifacts.default({
    proposed_changes: [],
    pr_links: [],
    commits: [],
  }),

  quality_gates: QualityGates.default({
    lint: true,
    tests: true,
    typecheck: true,
    coverage_min: 70,
  }),

  log: z.array(LogEntry).default([]),
});

export type Ticket = z.infer<typeof TicketSchema>;
export type TicketStatus = z.infer<typeof Status>;
export type LogEntryType = z.infer<typeof LogEntry>;

// === Valid State Transitions ===
export const VALID_TRANSITIONS: Record<string, string[]> = {
  BACKLOG: ["READY", "BLOCKED"],
  READY: ["IN_PROGRESS", "BLOCKED"],
  IN_PROGRESS: ["REVIEW", "BLOCKED"],
  REVIEW: ["DONE", "IN_PROGRESS", "BLOCKED"],
  BLOCKED: ["BACKLOG", "READY", "IN_PROGRESS", "REVIEW"],
  DONE: [], // terminal state
};