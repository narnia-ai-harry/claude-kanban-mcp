import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { TicketSchema, VALID_TRANSITIONS, type Ticket, type LogEntryType } from "./schema.js";

/** Resolve tickets directory relative to working directory */
function ticketsDir(): string {
  const dir = path.join(process.cwd(), "tickets");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ticketPath(id: string): string {
  return path.join(ticketsDir(), `${id}.yml`);
}

// ── Read ────────────────────────────────────────────

export function getTicket(id: string): Ticket {
  const p = ticketPath(id);
  if (!fs.existsSync(p)) throw new Error(`Ticket ${id} not found at ${p}`);
  const raw = yaml.load(fs.readFileSync(p, "utf-8"));
  return TicketSchema.parse(raw);
}

export function listTickets(filter?: { status?: string; assignee?: string; priority?: string }): Ticket[] {
  const dir = ticketsDir();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".yml"));
  const tickets: Ticket[] = [];

  for (const f of files) {
    try {
      const raw = yaml.load(fs.readFileSync(path.join(dir, f), "utf-8"));
      const t = TicketSchema.parse(raw);
      if (filter?.status && t.status !== filter.status) continue;
      if (filter?.assignee && !t.assignees.includes(filter.assignee)) continue;
      if (filter?.priority && t.priority !== filter.priority) continue;
      tickets.push(t);
    } catch {
      // skip invalid files
    }
  }

  return tickets.sort((a, b) => a.id.localeCompare(b.id));
}

// ── Write ───────────────────────────────────────────

export function saveTicket(ticket: Ticket): void {
  const validated = TicketSchema.parse(ticket);
  const yml = yaml.dump(validated, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(ticketPath(validated.id), yml, "utf-8");
}

export function createTicket(data: Partial<Ticket> & Pick<Ticket, "id" | "title" | "type" | "priority">): Ticket {
  const p = ticketPath(data.id);
  if (fs.existsSync(p)) throw new Error(`Ticket ${data.id} already exists`);

  const now = new Date().toISOString();
  const ticket = TicketSchema.parse({
    status: "BACKLOG",
    owner: { role: "LEADER", agent: "leader" },
    assignees: [],
    description: "",
    file_ownership: [],
    acceptance_criteria: [],
    artifacts: { proposed_changes: [], pr_links: [], commits: [] },
    quality_gates: { lint: true, tests: true, typecheck: true, coverage_min: 70 },
    log: [{ at: now, by: data.owner?.agent ?? "leader", action: "CREATED", note: "Ticket created" }],
    ...data,
  });

  saveTicket(ticket);
  return ticket;
}

// ── Transition ──────────────────────────────────────

export function transitionTicket(
  id: string,
  to: string,
  by: string,
  note?: string
): Ticket {
  const ticket = getTicket(id);
  const from = ticket.status;

  const allowed = VALID_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(
      `Invalid transition: ${from} → ${to}. Allowed: ${allowed?.join(", ") ?? "none"}`
    );
  }

  const logEntry: LogEntryType = {
    at: new Date().toISOString(),
    by,
    action: "STATUS_CHANGE",
    from,
    to,
    note: note ?? `${from} → ${to}`,
  };

  ticket.status = to as Ticket["status"];
  ticket.log.push(logEntry);
  saveTicket(ticket);
  return ticket;
}

// ── Update (partial) ────────────────────────────────

export function updateTicket(
  id: string,
  updates: Partial<Omit<Ticket, "id" | "log">>,
  by: string,
  note?: string
): Ticket {
  const ticket = getTicket(id);

  // Merge updates (shallow for top-level, deep for nested objects)
  if (updates.title !== undefined) ticket.title = updates.title;
  if (updates.type !== undefined) ticket.type = updates.type;
  if (updates.priority !== undefined) ticket.priority = updates.priority;
  if (updates.description !== undefined) ticket.description = updates.description;
  if (updates.assignees !== undefined) ticket.assignees = updates.assignees;
  if (updates.file_ownership !== undefined) ticket.file_ownership = updates.file_ownership;
  if (updates.acceptance_criteria !== undefined) ticket.acceptance_criteria = updates.acceptance_criteria;
  if (updates.owner !== undefined) ticket.owner = updates.owner;

  if (updates.artifacts) {
    ticket.artifacts = { ...ticket.artifacts, ...updates.artifacts };
  }
  if (updates.quality_gates) {
    ticket.quality_gates = { ...ticket.quality_gates, ...updates.quality_gates };
  }

  const logEntry: LogEntryType = {
    at: new Date().toISOString(),
    by,
    action: "UPDATED",
    note: note ?? `Fields updated: ${Object.keys(updates).join(", ")}`,
  };
  ticket.log.push(logEntry);

  saveTicket(ticket);
  return ticket;
}

// ── Validate ────────────────────────────────────────

export interface ValidationResult {
  file: string;
  valid: boolean;
  errors: string[];
}

export function validateAllTickets(): ValidationResult[] {
  const dir = ticketsDir();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".yml"));
  const results: ValidationResult[] = [];

  for (const f of files) {
    const filePath = path.join(dir, f);
    try {
      const raw = yaml.load(fs.readFileSync(filePath, "utf-8"));
      const result = TicketSchema.safeParse(raw);
      if (result.success) {
        results.push({ file: f, valid: true, errors: [] });
      } else {
        const errs = result.error.issues.map(
          (i) => `${i.path.join(".")}: ${i.message}`
        );
        results.push({ file: f, valid: false, errors: errs });
      }
    } catch (e) {
      results.push({
        file: f,
        valid: false,
        errors: [`YAML parse error: ${e instanceof Error ? e.message : String(e)}`],
      });
    }
  }

  return results;
}

// ── Next ID ─────────────────────────────────────────

export function nextTicketId(): string {
  const dir = ticketsDir();
  const files = fs.readdirSync(dir).filter((f) => /^T-\d{4}\.yml$/.test(f));
  if (files.length === 0) return "T-0001";

  const maxNum = Math.max(
    ...files.map((f) => parseInt(f.replace("T-", "").replace(".yml", ""), 10))
  );
  return `T-${String(maxNum + 1).padStart(4, "0")}`;
}