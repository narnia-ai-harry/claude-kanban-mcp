# Claude Kanban MCP Server

Claude Code 에이전트 팀을 위한 티켓 기반 Kanban MCP 서버입니다.  
보드 기능은 MCP 본체에서 분리되어 별도 **읽기 전용 Board Viewer**로 동작합니다.

## 핵심 변경사항

- MCP 도구 `board_view`, `board_generate` 제거
- Board는 별도 Viewer 프로세스로 제공
- `git_merge_ticket`, `git_merge_command`는 `by` 파라미터 필수

## 구성

- MCP Server (stdio): 티켓/상태전이/Git 워크플로우 오케스트레이션
- Board Viewer (웹): `tickets/*.yml` 읽기 전용 표시
- 데이터 원본: `tickets/*.yml`

---

## 시작 가이드 (작업 레포에서 시작)

이 문서는 **현재 위치가 작업 대상 레포 루트**라고 가정합니다.

```bash
pwd
# 예: /mnt/c/.../my-project
```

## 시나리오 A: 새 로컬 환경에서 첫 프로젝트 시작 (처음 설치)

### 1) MCP 저장소 설치 위치 고정

작업 레포에서 바로 아래 명령을 실행하면, MCP를 `$HOME/.claude-kanban-mcp`에 설치합니다.

```bash
git clone https://github.com/narnia-ai-harry/claude-kanban-mcp.git "$HOME/.claude-kanban-mcp"
npm --prefix "$HOME/.claude-kanban-mcp" install
npm --prefix "$HOME/.claude-kanban-mcp" run build
```

### 2) Claude Code에 MCP 등록

`user scope` 등록을 권장합니다. (한 번 등록하면 다른 프로젝트에서도 재사용 가능)

```bash
# 권장: 유저 스코프
claude mcp add --transport stdio --scope user claude-kanban -- node "$HOME/.claude-kanban-mcp/build/index.js"

# 대안: 프로젝트 스코프(현재 레포에서만)
claude mcp add --transport stdio claude-kanban -- node "$HOME/.claude-kanban-mcp/build/index.js"
```

### 3) 작업 시작 (2개 터미널)

```bash
# Terminal A (작업 레포 루트에서)
claude
```

```bash
# Terminal B (작업 레포 루트에서)
npm --prefix "$HOME/.claude-kanban-mcp" run board -- --root "$(pwd)"
```

브라우저에서 `http://127.0.0.1:4310` 접속.

---

## 시나리오 B: 이미 install/build/register 완료, 다른 레포에서 시작

이미 `$HOME/.claude-kanban-mcp` 설치 + `claude-kanban` 등록이 끝난 상태라면 설치/등록은 건너뜁니다.

### 1) 새 작업 레포로 이동

```bash
cd /path/to/another-project
mkdir -p tickets
```

### 2) 바로 실행

```bash
# Terminal A
claude
```

```bash
# Terminal B
npm --prefix "$HOME/.claude-kanban-mcp" run board -- --root "$(pwd)"
```

중요:
- MCP와 Viewer는 같은 프로젝트 루트를 바라봐야 합니다.
- 예시처럼 `--scope user` 등록을 해두면 레포를 바꿔도 재등록이 필요 없습니다.
- 과거에 프로젝트 스코프로만 등록했다면, 새 레포에서 `claude mcp add ...`를 다시 실행해야 합니다.

---

## MCP 사용 예시

Claude Code 세션 안에서:

```text
# 워크플로우 시작
/mcp__claude-kanban__kickoff

# 또는 개별 도구 요청
ticket_create 실행해줘
```

---

## MCP 도구 목록

### Ticket Tools (7)

| Tool | 설명 | 주요 파라미터 |
|---|---|---|
| `ticket_create` | 티켓 생성 | title, type, priority, assignees, AC |
| `ticket_get` | 티켓 조회 (YAML) | id |
| `ticket_list` | 티켓 목록/필터 조회 | status?, assignee?, priority? |
| `ticket_update` | 티켓 필드 수정 | id, by, ... |
| `ticket_transition` | 상태 전이 | id, to, by, note? |
| `ticket_validate` | 전체 티켓 검증 | (없음) |
| `ticket_next_id` | 다음 티켓 ID 조회 | (없음) |

### Git Tools (7)

| Tool | 설명 | 주요 파라미터 |
|---|---|---|
| `git_init_command` | 명령 브랜치 생성 (`feat/{slug}`) | slug, base? |
| `git_create_ticket_branch` | 티켓 브랜치 + worktree 생성 | ticket_id, command_branch |
| `git_commit_ticket` | 티켓 prefix 커밋 | ticket_id, summary, cwd? |
| `git_check_conflicts` | merge 리스크 분석 (파일/overlap/risk) | ticket_branch, command_branch |
| `git_merge_ticket` | 티켓 -> 명령 브랜치 squash merge | ticket_id, command_branch, **by** |
| `git_merge_command` | 명령 -> 기준 브랜치 merge (`--no-ff`) | command_branch, base_branch?, message?, **by** |
| `git_checkout` | 브랜치 전환 | branch |

---

## Board Viewer

작업 레포 루트에서 실행:

```bash
npm --prefix "$HOME/.claude-kanban-mcp" run board -- --root "$(pwd)"
```

포트 변경:

```bash
npm --prefix "$HOME/.claude-kanban-mcp" run board -- --root "$(pwd)" --port 4311
```

동작:
- `tickets/*.yml` 로드
- 6개 상태 컬럼 렌더링
- 필터: status / assignee / priority
- 상세 패널 제공
- 1초 polling 갱신
- malformed YAML 존재 시 하단 에러 섹션 분리 표시

---

## 상태 전이 규칙

```text
BACKLOG     -> READY | BLOCKED
READY       -> IN_PROGRESS | BLOCKED
IN_PROGRESS -> REVIEW | BLOCKED
REVIEW      -> DONE | IN_PROGRESS | BLOCKED
BLOCKED     -> BACKLOG | READY | IN_PROGRESS | REVIEW
DONE        -> IN_PROGRESS
```

---

## 개발 명령 (MCP 레포 내부에서)

```bash
npm run dev
npm run board -- --root "$(pwd)"
npm run build
npm run start
npm run lint
npm run test
npm run typecheck
npm run check
```
