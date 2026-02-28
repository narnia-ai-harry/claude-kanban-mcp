# Claude Kanban MCP Server

Ticket-based kanban workflow for Claude Code agents, with a separate local Board Viewer.

## Breaking Changes (v2 -> current)

- MCP tools `board_view`, `board_generate` are removed.
- Board is now provided by a separate read-only web Viewer.
- `git_merge_ticket`, `git_merge_command` now require `by` parameter.

## Features

- **14 MCP Tools**: Ticket 7 + Git 7
- **1 Prompt**: `kickoff` (workflow instructions + next ticket id)
- **3 Resources**: `kanban://prompt/leader|worker|quality`
- **YAML Tickets**: `tickets/*.yml`
- **Status Validation**: transition rules + assignee check (`READY -> IN_PROGRESS`)
- **Git Workflow**: command branch / ticket worktree / commit / merge tools
- **Board Viewer (separate process)**:
  - read-only
  - `--root` required
  - default port `4310` (`--port` override)
  - polling every 1 second
  - invalid ticket files shown in error section

## Install and MCP registration

### Step 1: clone and build

```bash
git clone https://github.com/narnia-ai-harry/claude-kanban-mcp.git
cd claude-kanban-mcp
npm install
npm run build
```

### Step 2: register MCP

```bash
# user scope
claude mcp add --transport stdio --scope user claude-kanban -- node /absolute/path/to/claude-kanban-mcp/build/index.js

# or project scope
claude mcp add --transport stdio claude-kanban -- node /absolute/path/to/claude-kanban-mcp/build/index.js
```

### Step 3: verify

```bash
claude
# inside Claude Code
/mcp
# claude-kanban: connected
```

## Standard operation (2 terminals)

```bash
# Terminal A: Claude Code + MCP workflow
claude

# Terminal B: Board Viewer (run from project root)
npm run board -- --root "$(pwd)"
```

If you need a different project path or custom port:

```bash
npm run board -- --root /absolute/path/to/target-repo --port 4310
```

Important: MCP and Viewer must point to the same project root.

## MCP usage

```text
# start workflow
/mcp__claude-kanban__kickoff

# use tools directly
ticket_create 실행해줘
```

## MCP Tools

### Ticket Tools (7)

| Tool | Description | Main Parameters |
|---|---|---|
| `ticket_create` | create ticket | title, type, priority, assignees, AC |
| `ticket_get` | get ticket YAML | id |
| `ticket_list` | list/filter tickets | status?, assignee?, priority? |
| `ticket_update` | update ticket fields | id, by, ... |
| `ticket_transition` | state transition | id, to, by, note? |
| `ticket_validate` | validate all tickets | (none) |
| `ticket_next_id` | next ticket id | (none) |

### Git Tools (7)

| Tool | Description | Main Parameters |
|---|---|---|
| `git_init_command` | create command branch (`feat/{slug}`) | slug, base? |
| `git_create_ticket_branch` | ticket branch + worktree | ticket_id, command_branch |
| `git_commit_ticket` | commit with ticket prefix | ticket_id, summary, cwd? |
| `git_check_conflicts` | merge risk analysis (files/overlap/risk) | ticket_branch, command_branch |
| `git_merge_ticket` | squash merge ticket -> command | ticket_id, command_branch, **by** |
| `git_merge_command` | merge command -> base (`--no-ff`) | command_branch, base_branch?, message?, **by** |
| `git_checkout` | checkout branch | branch |

## Board Viewer

- recommended command (from target project root):

```bash
npm run board -- --root "$(pwd)"
```

- alternative command (explicit absolute path):

```bash
npm run board -- --root /absolute/path/to/target-repo --port 4310
```

- behavior:
  - reads `tickets/*.yml`
  - renders 6 status columns
  - supports filters: status / assignee / priority
  - shows selected ticket details
  - refreshes every 1 second
  - keeps working even when malformed YAML exists

## State transitions

```text
BACKLOG     -> READY | BLOCKED
READY       -> IN_PROGRESS | BLOCKED
IN_PROGRESS -> REVIEW | BLOCKED
REVIEW      -> DONE | IN_PROGRESS | BLOCKED
BLOCKED     -> BACKLOG | READY | IN_PROGRESS | REVIEW
DONE        -> IN_PROGRESS
```

## Development

```bash
npm run dev          # MCP server via tsx
npm run board -- --root "$(pwd)"
npm run build        # TypeScript build
npm run start        # run built MCP server
npm run lint         # tsc --noEmit
npm run test         # build + node:test
npm run typecheck    # tsc --noEmit
npm run check        # lint + test + typecheck
```
