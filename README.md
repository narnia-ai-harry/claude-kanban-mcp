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

이 문서는 **터미널에서 이미 작업 대상 레포 루트로 `cd`한 상태**를 가정합니다.

```bash
pwd
# 예: /mnt/c/.../my-project
```

중요:
- `MCP_DIR` = `claude-kanban-mcp`가 실제 설치된 경로
- 현재 작업 레포 경로는 필요할 때 `$(pwd)`로 직접 사용
- `MCP_DIR`와 `$(pwd)`는 보통 서로 다릅니다.

---

## 시나리오 A: 새 로컬 환경에서 첫 프로젝트 시작 (처음 설치)

### 1) MCP 저장소 설치/빌드

작업 레포 기준으로 부모 디렉토리에 MCP를 clone하는 예시입니다.

```bash
git clone https://github.com/narnia-ai-harry/claude-kanban-mcp.git ../claude-kanban-mcp
MCP_DIR="$(cd ../claude-kanban-mcp && pwd)"

npm --prefix "$MCP_DIR" install
npm --prefix "$MCP_DIR" run build
```

### 2) Claude Code에 MCP 등록

`user scope` 등록 권장 (한 번 등록하면 다른 프로젝트에서도 재사용 가능)

```bash
# 권장: 유저 스코프
claude mcp add --transport stdio --scope user claude-kanban -- node "$MCP_DIR/build/index.js"

# 대안: 프로젝트 스코프(현재 레포에서만)
claude mcp add --transport stdio claude-kanban -- node "$MCP_DIR/build/index.js"
```

### 3) 작업 시작 (2개 터미널)

```bash
# Terminal A (작업 레포 루트)
claude
```

```bash
# Terminal B (작업 레포 루트)
npm --prefix "$MCP_DIR" run board -- --root "$(pwd)"
```

브라우저에서 `http://127.0.0.1:4310` 접속.

---

## 시나리오 B: 이미 install/build/register 완료, 다른 레포에서 시작

설치/등록이 이미 끝났다면, 새 레포에서는 `MCP_DIR`만 정확히 잡아서 바로 시작하면 됩니다.

### 1) 새 작업 레포로 이동

```bash
cd /path/to/another-project
mkdir -p tickets
```

### 2) 등록된 경로에서 MCP_DIR 추출

아래 명령은 `claude mcp list` 출력에서 `claude-kanban`의 실행 경로를 추출합니다.

```bash
MCP_DIR="$(claude mcp list | sed -n 's/^claude-kanban: node \(.*\)\/build\/index\.js.*/\1/p')"
```

확인:

```bash
echo "$MCP_DIR"
test -f "$MCP_DIR/build/index.js" && echo "MCP 경로 확인 완료"
```

### 3) 바로 실행

```bash
# Terminal A
claude
```

```bash
# Terminal B
npm --prefix "$MCP_DIR" run board -- --root "$(pwd)"
```

중요:
- MCP와 Viewer는 같은 프로젝트 루트를 바라봐야 합니다.
- 프로젝트 스코프로만 등록했다면 새 레포에서 `claude mcp add ...`를 다시 실행해야 합니다.

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

```bash
npm --prefix "$MCP_DIR" run board -- --root "$(pwd)"
```

포트 변경:

```bash
npm --prefix "$MCP_DIR" run board -- --root "$(pwd)" --port 4311
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
