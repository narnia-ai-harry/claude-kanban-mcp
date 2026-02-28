import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { TicketSchema, type Ticket, type TicketStatus } from "../schema.js";

export interface InvalidTicket {
  file: string;
  errors: string[];
}

export interface BoardSnapshot {
  root: string;
  generatedAt: string;
  statusOrder: TicketStatus[];
  tickets: Ticket[];
  invalidTickets: InvalidTicket[];
  counts: Record<TicketStatus, number>;
  assignees: string[];
  priorities: string[];
}

const STATUS_ORDER: TicketStatus[] = [
  "BACKLOG",
  "READY",
  "IN_PROGRESS",
  "REVIEW",
  "DONE",
  "BLOCKED",
];

function emptyCounts(): Record<TicketStatus, number> {
  return {
    BACKLOG: 0,
    READY: 0,
    IN_PROGRESS: 0,
    REVIEW: 0,
    DONE: 0,
    BLOCKED: 0,
  };
}

export function loadBoardSnapshot(root: string): BoardSnapshot {
  const ticketsDir = path.join(root, "tickets");
  const tickets: Ticket[] = [];
  const invalidTickets: InvalidTicket[] = [];

  if (!fs.existsSync(ticketsDir) || !fs.statSync(ticketsDir).isDirectory()) {
    invalidTickets.push({
      file: "tickets/",
      errors: [`Directory not found: ${ticketsDir}`],
    });
  } else {
    const files = fs
      .readdirSync(ticketsDir)
      .filter((f) => f.endsWith(".yml"))
      .sort((a, b) => a.localeCompare(b));

    for (const file of files) {
      const fullPath = path.join(ticketsDir, file);
      try {
        const raw = yaml.load(fs.readFileSync(fullPath, "utf-8"));
        const parsed = TicketSchema.safeParse(raw);
        if (parsed.success) {
          tickets.push(parsed.data);
        } else {
          invalidTickets.push({
            file,
            errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
          });
        }
      } catch (e) {
        invalidTickets.push({
          file,
          errors: [`YAML parse error: ${e instanceof Error ? e.message : String(e)}`],
        });
      }
    }
  }

  tickets.sort((a, b) => a.id.localeCompare(b.id));

  const counts = emptyCounts();
  for (const ticket of tickets) {
    counts[ticket.status] += 1;
  }

  const assignees = [...new Set(tickets.flatMap((t) => t.assignees))].sort((a, b) => a.localeCompare(b));
  const priorities = [...new Set(tickets.map((t) => t.priority))].sort((a, b) => a.localeCompare(b));

  return {
    root,
    generatedAt: new Date().toISOString(),
    statusOrder: STATUS_ORDER,
    tickets,
    invalidTickets,
    counts,
    assignees,
    priorities,
  };
}

