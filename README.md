# Claude Kanban MCP Server

Ticket-based kanban workflow for Claude Code agents — as an MCP server.

## Features

- **8 Tools**: `ticket_create`, `ticket_get`, `ticket_list`, `ticket_update`, `ticket_transition`, `ticket_validate`, `board_view`, `board_generate`
- **3 Resources**: Leader / Worker / Quality agent prompts
- **2 Prompt Templates**: `assign-ticket`, `review-request`
- **YAML Tickets**: `tickets/*.yml` — version-controllable, human-readable
- **Status Validation**: enforces valid state transitions with auto-logged history
- **BOARD.md**: auto-generated kanban board markdown

## Quick Start (이 레포에서 개발)

```bash
npm install
npm run build

# 로컬 테스트 (stdio)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node build/index.js
```

## 다른 레포에 이식하기 (3단계)

### Step 1: 설치

```bash
# 방법 A: npm 패키지로 설치 (npm에 publish한 경우)
npm install claude-kanban-mcp

# 방법 B: git repo에서 직접 설치
npm install git+https://github.com/YOUR_ORG/claude-kanban-mcp.git

# 방법 C: 로컬 경로로 설치 (모노레포 등)
npm install ../path/to/claude-kanban-mcp
```

### Step 2: MCP 등록

**방법 A: `.mcp.json` 파일 생성** (프로젝트 루트에)

```json
{
  "mcpServers": {
    "claude-kanban": {
      "type": "stdio",
      "command": "node",
      "args": ["./node_modules/claude-kanban-mcp/build/index.js"]
    }
  }
}
```

**방법 B: Claude Code CLI로 등록**

```bash
# 프로젝트 스코프 (현재 프로젝트에서만)
claude mcp add --transport stdio claude-kanban -- node ./node_modules/claude-kanban-mcp/build/index.js

# 유저 스코프 (모든 프로젝트에서)
claude mcp add --transport stdio --scope user claude-kanban -- node /absolute/path/to/claude-kanban-mcp/build/index.js
```

### Step 3: 초기 파일 구조 세팅

```bash
mkdir -p tickets prompts
# 프롬프트 파일 복사 (선택)
cp node_modules/claude-kanban-mcp/prompts/*.md prompts/
```

### 확인

```bash
claude
# Claude Code 안에서:
> /mcp
# claude-kanban: connected 가 보이면 성공
```

## MCP Tools 상세

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

## 상태 전환 규칙

```
BACKLOG → READY → IN_PROGRESS → REVIEW → DONE
                                   ↓
                              IN_PROGRESS (수정 요청)

어디서든 → BLOCKED (해소 플랜 필수)
BLOCKED → BACKLOG | READY | IN_PROGRESS | REVIEW
```

## Agent 프롬프트

`prompts/` 디렉토리에 Agent별 프롬프트를 넣으면 MCP Resource로 자동 노출됩니다:

- `prompts/leader.md` → Team Leader 역할/규칙
- `prompts/worker.md` → Worker 구현 가이드
- `prompts/quality.md` → Quality 리뷰 체크리스트

## 개발

```bash
npm run dev          # tsx로 즉시 실행
npm run build        # TypeScript 빌드
npm run start        # 빌드된 서버 실행
```