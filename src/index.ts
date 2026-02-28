#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  getTicket,
  listTickets,
  createTicket,
  updateTicket,
  transitionTicket,
  validateAllTickets,
  nextTicketId,
  saveTicket,
} from "./ticket.js";
import {
  validateCommandBranch,
  ticketBranchName,
  branchExists,
  createBranch,
  createWorktree,
  commitAll,
  checkout,
  squashMerge,
  mergeNoFf,
  getCurrentBranch,
  getChangedFiles,
  getMergeBase,
  getDiffStat,
} from "./git.js";
import { projectRoot } from "./root.js";
import { summarizeConflictRisk } from "./conflict.js";
import { assertLeaderCaller, assertQualityCaller } from "./policy.js";

// ═══════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function fail(e: unknown) {
  return {
    content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
    isError: true as const,
  };
}

// ═══════════════════════════════════════════════════
// Embedded Workflow Instructions (v2)
// ═══════════════════════════════════════════════════

const WORKFLOW_INSTRUCTIONS = `
# Agent Team Kanban Workflow v2

## 역할 분리

Worker:   구현 + 커밋 + PR (merge 안 함)
Quality:  PR 리뷰 + 명령 브랜치에 통합 merge (사소한 수정 가능)
Leader:   명령 브랜치 최종 검토 + main merge

## Agent 실행 모델

모든 Agent는 Task tool sub-agent로 실행.
각 sub-agent는 필요한 정보만 prompt로 받아 깨끗한 context에서 시작.

Worker는 2단계로 실행:
1. Plan Agent — 코드베이스 탐색 + PLAN 작성 (→ ticket에 plan 기록)
2. Execute Agent — PLAN만 받고 구현 (worktree에서, clean context)

Quality는 1개 Agent가 전체 PR을 리뷰:
- 명령 브랜치 기준으로 모든 티켓 diff 확인
- 티켓 간 교차 문제 감지
- APPROVE한 티켓을 squash merge
- 통합 중 사소한 수정 직접 가능

## 피드백 루프

Inner Loop (Execute Agent 내부):
1. verify_commands / smoke_test 실행
2. 자가 검증 (4가지 코딩 규칙)
3. 최대 2회 수정. 초과 시 BLOCKED.

Outer Loop (Quality → Fix Agent):
1. Quality APPROVE → merge
2. Quality REQUEST_CHANGES → Fix Agent(MUST_FIX만 수정) → 재검증
3. 최대 2회 왕복. 초과 시 Leader 에스컬레이션.

심각도:
- MUST_FIX: 반드시 수정. Fix Agent가 처리.
- NOTE: 참고만. Fix Agent에 전달하지 않음.

## Git 워크플로우

1. Leader: git_init_command → 명령 브랜치 생성
2. Worker: git_create_ticket_branch → 서브 브랜치 (worktree)
3. Worker: 구현 → git_commit_ticket → REVIEW 전환 (merge 안 함)
4. Quality: 전체 PR 리뷰 → git_merge_ticket → 명령 브랜치에 통합
5. Leader: 명령 브랜치 최종 검토 → git_merge_command → main merge

## 티켓 소유권

- assignees에 지정된 Agent만 IN_PROGRESS 전환 가능
- IN_PROGRESS/DONE 티켓은 다른 Agent가 가져갈 수 없음

## 커밋 규칙

- 형식: "T-XXXX: {요약}"
- git_commit_ticket 도구만 사용
- file_ownership 위반 경고 시 Leader에게 보고

## 사용 가능한 MCP 도구

| 도구 | 용도 | 누가 사용 |
|---|---|---|
| ticket_create | 티켓 생성 | Leader |
| ticket_get | 티켓 상세 조회 | 모두 |
| ticket_list | 필터 조회 | 모두 |
| ticket_update | 필드 수정 | Leader, Worker |
| ticket_transition | 상태 변경 | 모두 |
| ticket_validate | 스키마 검증 | Quality |
| git_init_command | 명령 브랜치 생성 | Leader |
| git_create_ticket_branch | 티켓 서브 브랜치 + worktree | Worker |
| git_commit_ticket | 티켓 커밋 | Worker, Fix Agent |
| git_check_conflicts | 충돌 사전 확인 | Quality |
| git_merge_ticket | 티켓→명령 브랜치 squash merge | Quality (by=quality) |
| git_checkout | 브랜치 전환 | 모두 |
| git_merge_command | 명령→main merge commit | Leader (by=leader) |
`.trim();

// ═══════════════════════════════════════════════════
// Server
// ═══════════════════════════════════════════════════

const server = new McpServer({
  name: "claude-kanban",
  version: "2.0.0",
});

// ── Tool: ticket_create ─────────────────────────────

server.tool(
  "ticket_create",
  "Create a new kanban ticket. Returns the created ticket YAML.",
  {
    id: z.string().optional().describe("Ticket ID (T-XXXX). Auto-generated if omitted."),
    title: z.string().describe("Short title starting with a verb"),
    type: z.enum(["feature", "bug", "chore", "docs", "test"]),
    priority: z.enum(["P0", "P1", "P2", "P3"]),
    status: z.enum(["BACKLOG", "READY"]).optional().describe("Initial status. Default: BACKLOG"),
    description: z.string().optional(),
    assignees: z.array(z.string()).optional(),
    file_ownership: z.array(z.string()).optional(),
    acceptance_criteria: z.array(z.string()).optional(),
    owner_agent: z.string().optional().describe("Agent name for owner. Default: leader"),
    owner_role: z.enum(["LEADER", "WORKER", "QUALITY"]).optional(),
    verify_commands: z.array(z.string()).optional().describe("Commands to run for verification (e.g. ['npm test', 'npm run lint'])"),
    smoke_test: z.string().optional().describe("Quick smoke test command"),
    plan: z.object({
      steps: z.array(z.object({ description: z.string(), verification: z.string() })).optional(),
      assumptions: z.array(z.string()).optional(),
    }).optional().describe("Implementation plan"),
    git: z.object({
      command_branch: z.string().optional(),
      ticket_branch: z.string().optional(),
      base_branch: z.string().optional(),
    }).optional().describe("Git branch info"),
  },
  async (args) => {
    try {
      const id = args.id || nextTicketId();
      const ticket = createTicket({
        id,
        title: args.title,
        type: args.type,
        priority: args.priority,
        status: (args.status as any) ?? "BACKLOG",
        description: args.description ?? "",
        assignees: args.assignees ?? [],
        file_ownership: args.file_ownership ?? [],
        acceptance_criteria: args.acceptance_criteria ?? [],
        owner: {
          role: (args.owner_role as any) ?? "LEADER",
          agent: args.owner_agent ?? "leader",
        },
        quality_gates: {
          verify_commands: args.verify_commands ?? [],
          smoke_test: args.smoke_test,
        },
        plan: args.plan ? {
          steps: args.plan.steps ?? [],
          assumptions: args.plan.assumptions ?? [],
        } : undefined,
        git: args.git ? {
          ...args.git,
          base_branch: args.git.base_branch ?? "main",
        } : undefined,
      });
      return ok(`Created ${ticket.id}: ${ticket.title}\n\nStatus: ${ticket.status}\nAssignees: ${ticket.assignees.join(", ") || "none"}\nAC: ${ticket.acceptance_criteria.length} items\nFiles: ${ticket.file_ownership.length} files`);
    } catch (e) {
      return fail(e);
    }
  }
);

// ── Tool: ticket_get ────────────────────────────────

server.tool(
  "ticket_get",
  "Get a single ticket by ID. Returns full YAML content.",
  {
    id: z.string().describe("Ticket ID (e.g. T-0001)"),
  },
  async ({ id }) => {
    try {
      const t = getTicket(id);
      return ok(yaml.dump(t, { lineWidth: 120, noRefs: true }));
    } catch (e) {
      return fail(e);
    }
  }
);

// ── Tool: ticket_list ───────────────────────────────

server.tool(
  "ticket_list",
  "List tickets with optional filters (status, assignee, priority).",
  {
    status: z.string().optional().describe("Filter by status (BACKLOG|READY|IN_PROGRESS|REVIEW|DONE|BLOCKED)"),
    assignee: z.string().optional().describe("Filter by assignee name"),
    priority: z.string().optional().describe("Filter by priority (P0|P1|P2|P3)"),
  },
  async (args) => {
    try {
      const tickets = listTickets(args);
      if (tickets.length === 0) {
        return ok("No tickets found matching filters.");
      }
      const lines = tickets.map(
        (t) => `${t.id} [${t.status}] [${t.priority}] ${t.title} → ${t.assignees.join(", ") || "unassigned"}`
      );
      return ok(`Found ${tickets.length} ticket(s):\n\n${lines.join("\n")}`);
    } catch (e) {
      return fail(e);
    }
  }
);

// ── Tool: ticket_transition ─────────────────────────

server.tool(
  "ticket_transition",
  "Change ticket status with validation. Auto-records log entry. Valid transitions are enforced by status machine in schema.ts.",
  {
    id: z.string().describe("Ticket ID"),
    to: z.enum(["BACKLOG", "READY", "IN_PROGRESS", "REVIEW", "DONE", "BLOCKED"]).describe("Target status"),
    by: z.string().describe("Who is making this change (e.g. leader, worker1, quality)"),
    note: z.string().optional().describe("Reason for transition"),
  },
  async ({ id, to, by, note }) => {
    try {
      const ticket = transitionTicket(id, to, by, note);
      const lastLog = ticket.log[ticket.log.length - 1];
      return ok(`${id}: ${lastLog.from} → ${lastLog.to}\nBy: ${by}\nNote: ${lastLog.note ?? ""}\n\nCurrent status: ${ticket.status}`);
    } catch (e) {
      return fail(e);
    }
  }
);

// ── Tool: ticket_update ─────────────────────────────

server.tool(
  "ticket_update",
  "Update ticket fields (title, description, assignees, AC, file_ownership, artifacts, etc). Does NOT change status — use ticket_transition for that.",
  {
    id: z.string().describe("Ticket ID"),
    by: z.string().describe("Who is making this update"),
    note: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    assignees: z.array(z.string()).optional(),
    file_ownership: z.array(z.string()).optional(),
    acceptance_criteria: z.array(z.string()).optional(),
    priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
    proposed_changes: z.array(z.string()).optional().describe("Add to artifacts.proposed_changes"),
    pr_links: z.array(z.string()).optional().describe("Add to artifacts.pr_links"),
    verify_commands: z.array(z.string()).optional().describe("Quality gate verify commands"),
    smoke_test: z.string().optional().describe("Quality gate smoke test command"),
    plan: z.object({
      steps: z.array(z.object({ description: z.string(), verification: z.string() })).optional(),
      assumptions: z.array(z.string()).optional(),
    }).optional().describe("Implementation plan"),
    git: z.object({
      command_branch: z.string().optional(),
      ticket_branch: z.string().optional(),
      base_branch: z.string().optional(),
    }).optional().describe("Git branch info"),
  },
  async (args) => {
    try {
      const updates: Record<string, any> = {};
      if (args.title !== undefined) updates.title = args.title;
      if (args.description !== undefined) updates.description = args.description;
      if (args.assignees !== undefined) updates.assignees = args.assignees;
      if (args.file_ownership !== undefined) updates.file_ownership = args.file_ownership;
      if (args.acceptance_criteria !== undefined) updates.acceptance_criteria = args.acceptance_criteria;
      if (args.priority !== undefined) updates.priority = args.priority;

      if (args.proposed_changes || args.pr_links) {
        updates.artifacts = {};
        if (args.proposed_changes) updates.artifacts.proposed_changes = args.proposed_changes;
        if (args.pr_links) updates.artifacts.pr_links = args.pr_links;
      }

      if (args.verify_commands !== undefined || args.smoke_test !== undefined) {
        updates.quality_gates = {};
        if (args.verify_commands !== undefined) updates.quality_gates.verify_commands = args.verify_commands;
        if (args.smoke_test !== undefined) updates.quality_gates.smoke_test = args.smoke_test;
      }

      if (args.plan !== undefined) {
        updates.plan = {
          steps: args.plan.steps ?? [],
          assumptions: args.plan.assumptions ?? [],
        };
      }

      if (args.git !== undefined) {
        updates.git = args.git;
      }

      const ticket = updateTicket(args.id, updates, args.by, args.note);
      return ok(`${ticket.id} updated by ${args.by}\nUpdated fields: ${Object.keys(updates).join(", ")}`);
    } catch (e) {
      return fail(e);
    }
  }
);

// ── Tool: ticket_validate ───────────────────────────

server.tool(
  "ticket_validate",
  "Validate all ticket YAML files against the schema. Returns per-file results.",
  {},
  async () => {
    try {
      const results = validateAllTickets();
      if (results.length === 0) {
        return ok("No ticket files found in tickets/ directory.");
      }

      const lines = results.map((r) => {
        if (r.valid) return `PASS ${r.file}`;
        return `FAIL ${r.file}\n${r.errors.map((e) => `   - ${e}`).join("\n")}`;
      });

      const valid = results.filter((r) => r.valid).length;
      return ok(`Validation: ${valid}/${results.length} valid\n\n${lines.join("\n")}`);
    } catch (e) {
      return fail(e);
    }
  }
);

// ── Tool: ticket_next_id ────────────────────────────

server.tool(
  "ticket_next_id",
  "Get the next available ticket ID.",
  {},
  async () => {
    try {
      return ok(nextTicketId());
    } catch (e) {
      return fail(e);
    }
  }
);

// ═══════════════════════════════════════════════════
// Git Tools (6 new tools)
// ═══════════════════════════════════════════════════

// ── Tool: git_init_command ──────────────────────────

server.tool(
  "git_init_command",
  "Create a command branch (feat/{slug}) from base branch. Used by Leader at workflow start.",
  {
    slug: z.string().describe("Command slug (lowercase, hyphens). e.g. 'add-auth'"),
    base: z.string().optional().describe("Base branch to fork from. Default: current branch"),
  },
  async ({ slug, base }) => {
    try {
      const branchName = validateCommandBranch(slug);
      createBranch(branchName, base);
      return ok(`Command branch created: ${branchName}\nBase: ${base ?? "current branch"}`);
    } catch (e) {
      return fail(e);
    }
  }
);

// ── Tool: git_create_ticket_branch ──────────────────

server.tool(
  "git_create_ticket_branch",
  "Create a ticket sub-branch with worktree from command branch. Used by Worker. Branch: feat/{slug}--T-XXXX",
  {
    ticket_id: z.string().describe("Ticket ID (e.g. T-0001)"),
    command_branch: z.string().describe("Parent command branch (e.g. feat/add-auth)"),
  },
  async ({ ticket_id, command_branch }) => {
    try {
      if (!branchExists(command_branch)) {
        throw new Error(`Command branch "${command_branch}" does not exist.`);
      }

      const branchName = ticketBranchName(command_branch, ticket_id);
      const worktreePath = path.join(".claude", "worktrees", ticket_id);
      createWorktree(worktreePath, branchName, command_branch);

      // Auto-update ticket YAML
      const ticket = getTicket(ticket_id);
      ticket.git = {
        command_branch,
        ticket_branch: branchName,
        base_branch: ticket.git?.base_branch ?? "main",
      };
      ticket.log.push({
        at: new Date().toISOString(),
        by: "system",
        action: "BRANCH_CREATED",
        note: `Branch: ${branchName}, Worktree: ${worktreePath}`,
      });
      saveTicket(ticket);

      return ok(`Ticket branch created: ${branchName}\nWorktree: ${worktreePath}\nTicket ${ticket_id} git info updated.`);
    } catch (e) {
      return fail(e);
    }
  }
);

// ── Tool: git_commit_ticket ─────────────────────────

server.tool(
  "git_commit_ticket",
  "Commit all changes with ticket prefix. Format: 'T-XXXX: {summary}'. Warns on file_ownership violations. Used by Worker/Fix Agent.",
  {
    ticket_id: z.string().describe("Ticket ID (e.g. T-0001)"),
    summary: z.string().describe("Commit summary (without ticket prefix)"),
    cwd: z.string().optional().describe("Working directory (worktree path). Default: current directory"),
  },
  async ({ ticket_id, summary, cwd }) => {
    try {
      const message = `${ticket_id}: ${summary}`;
      const ticket = getTicket(ticket_id);
      let ownershipViolations: string[] = [];

      // Check file_ownership violations
      let warning = "";
      if (ticket.file_ownership.length > 0) {
        try {
          const base = ticket.git?.command_branch ?? "HEAD~1";
          const changed = getChangedFiles(base, "HEAD", cwd);
          ownershipViolations = changed.filter(
            (f) => !ticket.file_ownership.some((owned) => f === owned || f.startsWith(owned + "/"))
          );
          if (ownershipViolations.length > 0) {
            warning = `\n\nWARNING: Files outside file_ownership:\n${ownershipViolations.map((f) => `  - ${f}`).join("\n")}\nReport this to Leader.`;
          }
        } catch {
          // Ignore diff errors (e.g. first commit)
        }
      }

      const { sha, warnings: commitWarnings } = commitAll(message, cwd);
      if (commitWarnings.length > 0) {
        warning += `\n\nSENSITIVE FILES:\n${commitWarnings.join("\n")}`;
      }

      // Auto-update ticket artifacts
      ticket.artifacts.commits.push(sha);
      ticket.log.push({
        at: new Date().toISOString(),
        by: "system",
        action: "COMMITTED",
        note: `${sha}: ${message}`,
      });
      if (ownershipViolations.length > 0) {
        ticket.log.push({
          at: new Date().toISOString(),
          by: "system",
          action: "OWNERSHIP_VIOLATION_WARN",
          note: `Changed files outside file_ownership: ${ownershipViolations.join(", ")}`,
        });
      }
      saveTicket(ticket);

      return ok(`Committed: ${sha} ${message}${warning}`);
    } catch (e) {
      return fail(e);
    }
  }
);

// ── Tool: git_check_conflicts ───────────────────────

server.tool(
  "git_check_conflicts",
  "Analyze merge risk between ticket and command branches (changed files, overlap, risk level). Used by Quality before merge.",
  {
    ticket_branch: z.string().describe("Ticket branch name"),
    command_branch: z.string().describe("Command branch name"),
  },
  async ({ ticket_branch, command_branch }) => {
    try {
      const base = getMergeBase(command_branch, ticket_branch);
      const ticketFiles = getChangedFiles(base, ticket_branch);
      const commandFiles = getChangedFiles(base, command_branch);
      const summary = summarizeConflictRisk(ticketFiles, commandFiles);
      const stat = getDiffStat(command_branch, ticket_branch);

      const lines = [
        `Conflict precheck: ${ticket_branch} -> ${command_branch}`,
        `merge_base: ${base}`,
        `risk: ${summary.risk.toUpperCase()}`,
      ];

      if (summary.reasons.length > 0) {
        lines.push(`reasons: ${summary.reasons.join("; ")}`);
      }

      lines.push("");
      lines.push(`ticket_changed_files (${summary.ticketFiles.length}):`);
      lines.push(...(summary.ticketFiles.length ? summary.ticketFiles.map((f) => `  - ${f}`) : ["  (none)"]));
      lines.push("");
      lines.push(`command_changed_files (${summary.commandFiles.length}):`);
      lines.push(...(summary.commandFiles.length ? summary.commandFiles.map((f) => `  - ${f}`) : ["  (none)"]));
      lines.push("");
      lines.push(`overlap_files (${summary.overlapFiles.length}):`);
      lines.push(...(summary.overlapFiles.length ? summary.overlapFiles.map((f) => `  - ${f}`) : ["  (none)"]));
      lines.push("");
      lines.push(`diff_stat (${command_branch}..${ticket_branch}):`);
      lines.push(stat || "  (none)");

      return ok(lines.join("\n"));
    } catch (e) {
      return fail(e);
    }
  }
);

// ── Tool: git_merge_ticket ──────────────────────────

server.tool(
  "git_merge_ticket",
  "Squash merge ticket branch into command branch. Only for REVIEW+ tickets. Used by Quality.",
  {
    ticket_id: z.string().describe("Ticket ID"),
    command_branch: z.string().describe("Target command branch"),
    by: z.string().describe("Caller identity. Must be quality."),
  },
  async ({ ticket_id, command_branch, by }) => {
    try {
      assertQualityCaller("git_merge_ticket", by);
      const ticket = getTicket(ticket_id);

      if (!["REVIEW", "DONE"].includes(ticket.status)) {
        throw new Error(`Ticket ${ticket_id} is ${ticket.status}. Must be REVIEW or DONE to merge.`);
      }

      const ticketBranch = ticket.git?.ticket_branch;
      if (!ticketBranch) {
        throw new Error(`Ticket ${ticket_id} has no git.ticket_branch set.`);
      }

      // Ensure we are on command branch — auto checkout if needed
      const current = getCurrentBranch();
      if (current !== command_branch) {
        checkout(command_branch);
      }

      squashMerge(ticketBranch, `${ticket_id}: ${ticket.title} (squash)`);

      ticket.log.push({
        at: new Date().toISOString(),
        by,
        action: "MERGED",
        note: `Squash merged ${ticketBranch} into ${command_branch}`,
      });
      saveTicket(ticket);

      return ok(`Squash merged ${ticketBranch} → ${command_branch}\nTicket: ${ticket_id}`);
    } catch (e) {
      return fail(e);
    }
  }
);

// ── Tool: git_merge_command ─────────────────────────

server.tool(
  "git_merge_command",
  "Merge command branch into main (--no-ff). All tickets must be DONE. Used by Leader.",
  {
    command_branch: z.string().describe("Command branch to merge"),
    base_branch: z.string().optional().describe("Target branch. Default: main"),
    message: z.string().optional().describe("Merge commit message"),
    by: z.string().describe("Caller identity. Must be leader."),
  },
  async ({ command_branch, base_branch, message, by }) => {
    try {
      assertLeaderCaller("git_merge_command", by);
      const target = base_branch ?? "main";

      // Verify all tickets for this command are DONE
      const allTickets = listTickets();
      const commandTickets = allTickets.filter(
        (t) => t.git?.command_branch === command_branch
      );

      const notDone = commandTickets.filter((t) => t.status !== "DONE");
      if (notDone.length > 0) {
        const list = notDone.map((t) => `  ${t.id} [${t.status}]`).join("\n");
        throw new Error(`Not all tickets are DONE:\n${list}`);
      }

      // Ensure we are on target branch — auto checkout if needed
      const current = getCurrentBranch();
      if (current !== target) {
        checkout(target);
      }

      const msg = message ?? `Merge ${command_branch} into ${target}`;
      mergeNoFf(command_branch, msg);

      return ok(`Merged ${command_branch} → ${target} (--no-ff)\nTickets: ${commandTickets.map((t) => t.id).join(", ")}`);
    } catch (e) {
      return fail(e);
    }
  }
);

// ── Tool: git_checkout ───────────────────────────────

server.tool(
  "git_checkout",
  "Checkout a branch. Used before merge or to switch context.",
  {
    branch: z.string().describe("Branch name to checkout"),
  },
  async ({ branch }) => {
    try {
      checkout(branch);
      return ok(`Checked out branch: ${branch}`);
    } catch (e) {
      return fail(e);
    }
  }
);

// ═══════════════════════════════════════════════════
// Resources (role prompts)
// ═══════════════════════════════════════════════════

for (const role of ["leader", "worker", "quality"] as const) {
  server.registerResource(
    `prompt-${role}`,
    `kanban://prompt/${role}`,
    { description: `${role} agent role prompt`, mimeType: "text/markdown" },
    async (uri) => {
      const content = fs.readFileSync(
        path.join(projectRoot(), "prompts", `${role}.md`),
        "utf-8"
      );
      return { contents: [{ uri: uri.href, text: content, mimeType: "text/markdown" }] };
    }
  );
}

// ═══════════════════════════════════════════════════
// Prompts (slash commands only)
// ═══════════════════════════════════════════════════

server.prompt(
  "kickoff",
  "Start a kanban workflow for a task. Returns team instructions and next ticket ID.",
  { task: z.string().describe("What you want to accomplish") },
  async ({ task }) => {
    const nid = nextTicketId();

    const msg = [
      WORKFLOW_INSTRUCTIONS,
      "",
      `## 다음 티켓 ID: ${nid}`,
      "",
      "---",
      "",
      "## 작업 요청",
      "",
      task,
      "",
      "## 지시",
      "",
      "위 워크플로우 규칙에 따라 이 작업을 티켓으로 분할하고 팀을 운영하세요.",
      "git_init_command → ticket_create → ticket_transition 순서로 진행하세요.",
      "보드 관찰은 별도 Viewer에서 수행하세요: npm run board -- --root /abs/path/to/project",
    ].join("\n");

    return { messages: [{ role: "user", content: { type: "text", text: msg } }] };
  }
);

// ═══════════════════════════════════════════════════
// Start
// ═══════════════════════════════════════════════════

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("claude-kanban MCP server v2.0.0 running on stdio");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
