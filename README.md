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

## 시작 가이드

## 시나리오 A: 다른 로컬 환경에서 첫 프로젝트 시작 (처음 설치)

### 1) MCP 저장소 설치/빌드

```bash
git clone https://github.com/narnia-ai-harry/claude-kanban-mcp.git
cd claude-kanban-mcp
npm install
npm run build
```

### 2) Claude Code에 MCP 등록

`user scope` 등록을 권장합니다. 한 번 등록하면 다른 프로젝트에서도 재등록 없이 사용 가능합니다.

```bash
# 권장: 유저 스코프 (모든 프로젝트 공통)
claude mcp add --transport stdio --scope user claude-kanban -- node /absolute/path/to/claude-kanban-mcp/build/index.js

# 대안: 프로젝트 스코프 (현재 프로젝트에서만)
claude mcp add --transport stdio claude-kanban -- node /absolute/path/to/claude-kanban-mcp/build/index.js
```

### 3) 대상 프로젝트에서 작업 시작

대상 프로젝트 루트로 이동해서 2개 터미널을 사용합니다.

```bash
# Terminal A: Claude Code 세션
cd /path/to/target-repo
claude
```

```bash
# Terminal B: Board Viewer
cd /path/to/target-repo
npm run --prefix /absolute/path/to/claude-kanban-mcp board -- --root "$(pwd)"
```

브라우저에서 `http://127.0.0.1:4310` 접속.

---

## 시나리오 B: 이미 MCP install/build/register 완료, 다른 레포에서 시작

이미 `--scope user`로 등록되어 있다면 설치/등록 단계는 생략합니다.

### 1) 새 대상 레포로 이동

```bash
cd /path/to/another-repo
```

필요 시 티켓 디렉토리 생성:

```bash
mkdir -p tickets
```

### 2) Claude + Viewer 실행

```bash
# Terminal A
claude
```

```bash
# Terminal B
npm run --prefix /absolute/path/to/claude-kanban-mcp board -- --root "$(pwd)"
```

중요:
- MCP와 Viewer는 같은 프로젝트 루트를 바라봐야 합니다.
- 프로젝트 스코프로 MCP를 등록한 경우, 새 레포에서 `claude mcp add ...`를 다시 실행해야 합니다.

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

권장 실행(대상 프로젝트 루트에서):

```bash
npm run --prefix /absolute/path/to/claude-kanban-mcp board -- --root "$(pwd)"
```

절대 경로 직접 지정:

```bash
npm run --prefix /absolute/path/to/claude-kanban-mcp board -- --root /absolute/path/to/target-repo --port 4310
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

## 개발 명령

```bash
npm run dev          # MCP 서버(tsx)
npm run board -- --root "$(pwd)"  # claude-kanban-mcp 레포에서 직접 실행할 때
npm run build        # TypeScript 빌드
npm run start        # 빌드된 MCP 실행
npm run lint         # tsc --noEmit
npm run test         # build + node:test
npm run typecheck    # tsc --noEmit
npm run check        # lint + test + typecheck
```
