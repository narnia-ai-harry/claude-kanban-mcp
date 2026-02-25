# Claude Kanban MCP Server

Ticket-based kanban workflow for Claude Code agents — as an MCP server.

## Features

- **9 Tools**: `ticket_create`, `ticket_get`, `ticket_list`, `ticket_update`, `ticket_transition`, `ticket_validate`, `board_view`, `board_generate`, `ticket_next_id`
- **1 Prompt**: `kickoff` — 팀 워크플로우 지침 + 보드 상태를 한번에 제공
- **YAML Tickets**: `tickets/*.yml` — version-controllable, human-readable
- **Status Validation**: enforces valid state transitions with auto-logged history
- **BOARD.md**: auto-generated kanban board markdown

## 설치 및 MCP 등록 (3단계)

### Step 1: 클론 & 빌드

```bash
git clone https://github.com/narnia-ai-harry/claude-kanban-mcp.git
cd claude-kanban-mcp
npm install
npm run build
```

### Step 2: MCP 등록

```bash
# 유저 스코프 (모든 프로젝트에서 사용)
claude mcp add --transport stdio --scope user claude-kanban -- node /absolute/path/to/claude-kanban-mcp/build/index.js

# 또는 프로젝트 스코프 (현재 프로젝트에서만)
claude mcp add --transport stdio claude-kanban -- node /absolute/path/to/claude-kanban-mcp/build/index.js
```

### Step 3: 확인

```bash
claude
# Claude Code 안에서:
> /mcp
# claude-kanban: connected 가 보이면 성공
```

## 사용법

Claude Code 세션에서:

```
# kickoff 프롬프트로 팀 워크플로우 시작
/mcp__claude-kanban__kickoff

# 또는 개별 도구 호출
board_view 실행해줘
```

## MCP Tools

| Tool | 설명 | 주요 파라미터 |
|---|---|---|
| `ticket_create` | 티켓 생성 | title, type, priority, assignees, AC |
| `ticket_get` | 티켓 조회 (YAML) | id |
| `ticket_list` | 필터 조회 | status?, assignee?, priority? |
| `ticket_update` | 필드 수정 | id, by, + 수정할 필드들 |
| `ticket_transition` | 상태 변경 | id, to, by, note? |
| `ticket_validate` | 전체 검증 | (없음) |
| `board_view` | 칸반 보드 텍스트 | (없음) |
| `board_generate` | BOARD.md 생성 | (없음) |
| `ticket_next_id` | 다음 티켓 ID | (없음) |

## 상태 전환 규칙

```
BACKLOG → READY → IN_PROGRESS → REVIEW → DONE
                                   ↓
                              IN_PROGRESS (수정 요청)

어디서든 → BLOCKED (해소 플랜 필수)
BLOCKED → BACKLOG | READY | IN_PROGRESS | REVIEW
```

## 개발

```bash
npm run dev          # tsx로 즉시 실행
npm run build        # TypeScript 빌드
npm run start        # 빌드된 서버 실행
```
