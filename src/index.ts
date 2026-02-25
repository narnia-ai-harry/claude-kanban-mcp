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
} from "./ticket.js";
import { boardView, generateBoardMd, writeBoardMd } from "./board.js";

// ═══════════════════════════════════════════════════
// Embedded Workflow Instructions
// ═══════════════════════════════════════════════════

const WORKFLOW_INSTRUCTIONS = `
# Agent Team Kanban Workflow

## 팀 구성

| 역할 | 이름 | 설명 |
|---|---|---|
| Leader | leader | 티켓 분할, Worker 조율, Quality 리뷰 트리거 |
| Worker | worker1~worker3 | 코드 구현, 테스트 작성 |
| Quality | quality | 코드 리뷰, 품질 게이트 검증 |

## 작업 프로세스

### Step 1: Leader — 티켓 분할
- 작업을 2~6개 티켓으로 분할 (ticket_create)
- 파일 소유권을 티켓별로 겹치지 않게 분리
- 각 티켓에 AC(acceptance_criteria), file_ownership 필수 포함

### Step 2: Leader — Worker 할당
- 티켓별로 Worker를 지정 (ticket_update로 assignees 설정)
- Worker에게 지시: 담당 파일만 수정, 완료 시 REVIEW로 전환

### Step 3: Worker — 구현
- READY 티켓을 IN_PROGRESS로 전환 (ticket_transition)
- file_ownership에 명시된 파일만 수정 (다른 파일 수정 금지)
- 구현 완료 후 lint/test/typecheck 실행
- 통과하면 REVIEW로 전환, Leader에게 보고

### Step 4: Quality — 리뷰
- 코드를 직접 읽고 lint/test/typecheck 실행
- AC 충족 여부 검증
- APPROVE → Leader에게 보고 (Leader가 DONE 전환)
- REQUEST_CHANGES → IN_PROGRESS로 되돌림, 수정 사항 명시

### Step 5: Leader — 마무리
- 모든 티켓 DONE 확인
- board_generate로 BOARD.md 갱신
- 완료 보고: 변경 파일, 검증 결과, 남은 이슈

## 상태 흐름

BACKLOG → READY → IN_PROGRESS → REVIEW → DONE
                                   ↓
                              IN_PROGRESS (수정 요청)
어디서든 → BLOCKED (해소 플랜 필수)

## 핵심 규칙

1. 파일 소유권 분리: 동일 파일이 2개 이상의 티켓에 나타나면 안 된다
2. Worker는 담당 파일만 수정: file_ownership 밖의 파일 수정 금지
3. 모든 상태 변경은 log 기록: ticket_transition이 자동으로 기록
4. Quality 통과 없이 DONE 금지: 반드시 Quality APPROVE 후 DONE 전환
5. BLOCKED 시 해소 플랜 필수: 이유와 다음 액션을 note에 기록

## 사용 가능한 MCP 도구

| 도구 | 용도 | 누가 사용 |
|---|---|---|
| ticket_create | 티켓 생성 | Leader |
| ticket_get | 티켓 상세 조회 | 모두 |
| ticket_list | 필터 조회 | 모두 |
| ticket_update | 필드 수정 | Leader, Worker |
| ticket_transition | 상태 변경 | 모두 |
| ticket_validate | 스키마 검증 | Quality |
| board_view | 칸반 보드 확인 | Leader |
| board_generate | BOARD.md 생성 | Leader |
`.trim();

// ═══════════════════════════════════════════════════
// Server
// ═══════════════════════════════════════════════════

const server = new McpServer({
  name: "claude-kanban",
  version: "1.0.0",
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
    coverage_min: z.number().optional().describe("Min coverage %. Default: 70"),
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
          lint: true,
          tests: true,
          typecheck: true,
          coverage_min: args.coverage_min ?? 70,
        },
      });
      return { content: [{ type: "text", text: `✅ Created ${ticket.id}: ${ticket.title}\n\nStatus: ${ticket.status}\nAssignees: ${ticket.assignees.join(", ") || "none"}\nAC: ${ticket.acceptance_criteria.length} items\nFiles: ${ticket.file_ownership.length} files` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `❌ Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
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
      return { content: [{ type: "text", text: yaml.dump(t, { lineWidth: 120, noRefs: true }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `❌ ${e instanceof Error ? e.message : String(e)}` }], isError: true };
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
        return { content: [{ type: "text", text: "No tickets found matching filters." }] };
      }
      const lines = tickets.map(
        (t) => `${t.id} [${t.status}] [${t.priority}] ${t.title} → ${t.assignees.join(", ") || "unassigned"}`
      );
      return { content: [{ type: "text", text: `Found ${tickets.length} ticket(s):\n\n${lines.join("\n")}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `❌ ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  }
);

// ── Tool: ticket_transition ─────────────────────────

server.tool(
  "ticket_transition",
  "Change ticket status with validation. Auto-records log entry. Valid transitions: BACKLOG→READY, READY→IN_PROGRESS, IN_PROGRESS→REVIEW, REVIEW→DONE|IN_PROGRESS, any→BLOCKED.",
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
      return {
        content: [{
          type: "text",
          text: `✅ ${id}: ${lastLog.from} → ${lastLog.to}\nBy: ${by}\nNote: ${lastLog.note ?? ""}\n\nCurrent status: ${ticket.status}`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `❌ ${e instanceof Error ? e.message : String(e)}` }], isError: true };
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
    coverage_min: z.number().optional(),
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

      if (args.coverage_min !== undefined) {
        updates.quality_gates = { coverage_min: args.coverage_min };
      }

      const ticket = updateTicket(args.id, updates, args.by, args.note);
      return {
        content: [{
          type: "text",
          text: `✅ ${ticket.id} updated by ${args.by}\nUpdated fields: ${Object.keys(updates).join(", ")}`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `❌ ${e instanceof Error ? e.message : String(e)}` }], isError: true };
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
        return { content: [{ type: "text", text: "No ticket files found in tickets/ directory." }] };
      }

      const lines = results.map((r) => {
        if (r.valid) return `✅ ${r.file}`;
        return `❌ ${r.file}\n${r.errors.map((e) => `   - ${e}`).join("\n")}`;
      });

      const valid = results.filter((r) => r.valid).length;
      return {
        content: [{
          type: "text",
          text: `Validation: ${valid}/${results.length} valid\n\n${lines.join("\n")}`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `❌ ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  }
);

// ── Tool: board_view ────────────────────────────────

server.tool(
  "board_view",
  "Display the kanban board — all tickets grouped by status.",
  {},
  async () => {
    try {
      return { content: [{ type: "text", text: boardView() }] };
    } catch (e) {
      return { content: [{ type: "text", text: `❌ ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  }
);

// ── Tool: board_generate ────────────────────────────

server.tool(
  "board_generate",
  "Generate/update BOARD.md file in the project root.",
  {},
  async () => {
    try {
      const outPath = writeBoardMd();
      const content = generateBoardMd();
      return { content: [{ type: "text", text: `✅ BOARD.md written to ${outPath}\n\n${content}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `❌ ${e instanceof Error ? e.message : String(e)}` }], isError: true };
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
      return { content: [{ type: "text", text: nextTicketId() }] };
    } catch (e) {
      return { content: [{ type: "text", text: `❌ ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  }
);

// ═══════════════════════════════════════════════════
// Prompts (slash commands only)
// ═══════════════════════════════════════════════════

// /mcp__claude-kanban__kickoff — 유일한 진입점
server.prompt(
  "kickoff",
  "Start a kanban workflow for a task. Returns full team instructions + current board state.",
  { task: z.string().describe("What you want to accomplish") },
  async ({ task }) => {
    const board = boardView();
    const nid = nextTicketId();

    const msg = [
      WORKFLOW_INSTRUCTIONS,
      "",
      "---",
      "",
      "## 현재 보드 상태",
      "",
      board,
      "",
      `## 다음 티켓 ID: ${nid}`,
      "",
      "---",
      "",
      "## 📌 작업 요청",
      "",
      task,
      "",
      "## 지시",
      "",
      "위 워크플로우 규칙에 따라 이 작업을 티켓으로 분할하고 팀을 운영하세요.",
      "ticket_create → ticket_transition → board_view 순서로 진행하세요.",
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
  console.error("claude-kanban MCP server running on stdio");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});