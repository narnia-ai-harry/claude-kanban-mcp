import fs from "node:fs";
import path from "node:path";
import { listTickets } from "./ticket.js";
import type { Ticket, TicketStatus } from "./schema.js";

const STATUS_ORDER: TicketStatus[] = [
  "BACKLOG",
  "READY",
  "IN_PROGRESS",
  "REVIEW",
  "DONE",
  "BLOCKED",
];

const STATUS_EMOJI: Record<string, string> = {
  BACKLOG: "📋",
  READY: "🟢",
  IN_PROGRESS: "🔨",
  REVIEW: "🔍",
  DONE: "✅",
  BLOCKED: "🚫",
};

// ── Board View (text) ───────────────────────────────

export function boardView(): string {
  const tickets = listTickets();
  const grouped: Record<string, Ticket[]> = {};

  for (const s of STATUS_ORDER) grouped[s] = [];
  for (const t of tickets) {
    if (!grouped[t.status]) grouped[t.status] = [];
    grouped[t.status].push(t);
  }

  const lines: string[] = ["═══ KANBAN BOARD ═══", ""];

  for (const status of STATUS_ORDER) {
    const items = grouped[status];
    const emoji = STATUS_EMOJI[status] ?? "";
    lines.push(`${emoji} ${status} (${items.length})`);
    lines.push("─".repeat(40));

    if (items.length === 0) {
      lines.push("  (empty)");
    } else {
      for (const t of items) {
        const assignee = t.assignees.length > 0 ? t.assignees.join(", ") : "unassigned";
        lines.push(`  ${t.id} [${t.priority}] ${t.title}`);
        lines.push(`         → ${assignee}`);
      }
    }
    lines.push("");
  }

  // Summary
  const total = tickets.length;
  const done = grouped["DONE"].length;
  const blocked = grouped["BLOCKED"].length;
  lines.push(`── Summary: ${total} total | ${done} done | ${blocked} blocked ──`);

  return lines.join("\n");
}

// ── BOARD.md Generation ─────────────────────────────

export function generateBoardMd(): string {
  const tickets = listTickets();
  const grouped: Record<string, Ticket[]> = {};

  for (const s of STATUS_ORDER) grouped[s] = [];
  for (const t of tickets) {
    if (!grouped[t.status]) grouped[t.status] = [];
    grouped[t.status].push(t);
  }

  const now = new Date().toISOString();
  const lines: string[] = [
    "# 📋 Kanban Board",
    "",
    `> Auto-generated at ${now}`,
    "",
  ];

  for (const status of STATUS_ORDER) {
    const items = grouped[status];
    const emoji = STATUS_EMOJI[status] ?? "";
    lines.push(`## ${emoji} ${status} (${items.length})`);
    lines.push("");

    if (items.length === 0) {
      lines.push("_No tickets_");
      lines.push("");
      continue;
    }

    lines.push("| ID | Priority | Title | Assignees |");
    lines.push("|---|---|---|---|");
    for (const t of items) {
      const assignee = t.assignees.length > 0 ? t.assignees.join(", ") : "_unassigned_";
      lines.push(`| ${t.id} | ${t.priority} | ${t.title} | ${assignee} |`);
    }
    lines.push("");
  }

  // Summary
  const total = tickets.length;
  const done = grouped["DONE"].length;
  const inProgress = grouped["IN_PROGRESS"].length;
  const blocked = grouped["BLOCKED"].length;
  lines.push("---");
  lines.push(`**Total:** ${total} | **Done:** ${done} | **In Progress:** ${inProgress} | **Blocked:** ${blocked}`);

  return lines.join("\n");
}

export function writeBoardMd(): string {
  const content = generateBoardMd();
  const outPath = path.join(process.cwd(), "BOARD.md");
  fs.writeFileSync(outPath, content, "utf-8");
  return outPath;
}