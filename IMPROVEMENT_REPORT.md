# Claude Kanban MCP 개선 보고서 v6

> 작성일: 2026-02-27
> 대상: claude-kanban-mcp v1.0.0
> 목적: Team Agent 기반 Git 워크플로우 통합 + 피드백 루프 품질 관리
> v6 변경: Worktree 멀티 에이전트 실증 테스트 결과 반영 (Appendix A)

---

## 1. 현재 상태 분석

```
현재 구조:
┌─────────────────────────────────────────┐
│           MCP Server (stdio)            │
│  9 Tools + 1 Prompt (kickoff)           │
├─────────────────────────────────────────┤
│  ticket.ts  │  board.ts  │  schema.ts   │
│  (CRUD)     │  (렌더링)  │  (Zod 검증)  │
└──────────────────┬──────────────────────┘
                   │
              tickets/*.yml
```

| 항목 | 상태 | 비고 |
|------|------|------|
| 티켓 CRUD | ✅ 구현됨 | 9개 도구 |
| 상태 머신 | ✅ 구현됨 | 6 상태, 10 전이 규칙 |
| 역할 프롬프트 | ✅ 구현됨 | leader, worker, quality |
| 감사 로그 | ✅ 구현됨 | 자동 ISO8601 타임스탬프 |
| 티켓 중복 할당 방지 | ⚠️ 부분적 | 상태 머신은 방어하나, assignee 검증 없음 |
| 파일 소유권 | ⚠️ 관례적 | 프롬프트로만 강제, 코드 검증 없음 |
| Git 통합 | ❌ 없음 | 브랜치/커밋/머지 전무 |
| PLAN 프로세스 | ❌ 없음 | Worker가 바로 구현 착수 |
| Context 관리 | ❌ 없음 | PLAN 후 깨끗한 context에서 시작하는 메커니즘 없음 |
| 피드백 루프 | ❌ 없음 | 리뷰 후 수정 재검증 프로세스 없음 |

### 참고한 업계 패턴

| 출처 | 패턴 | 우리 적용 |
|------|------|-----------|
| [Spotify Background Coding Agent](https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3) | Inner Loop(결정론적 검증) + LLM Judge | Inner Loop 자가 검증 구조 |
| [AWS Evaluator-Reflect-Refine](https://docs.aws.amazon.com/prescriptive-guidance/latest/agentic-ai-patterns/evaluator-reflect-refine-loop-patterns.html) | Generator→Evaluator→Refiner + 명확한 종료 조건 | Outer Loop 종료 조건 설계 |
| [Multi-Agent Reflexion (MAR)](https://arxiv.org/html/2512.20845) | Acting/Evaluation/Critique 역할 분리 | Execute/Quality/Leader 역할 분리 |
| [Addy Osmani Agent Teams](https://addyosmani.com/blog/claude-code-agent-teams/) | Builder→Reviewer→Builder 루프 | Fix Agent 재작업 패턴 |

---

## 2. 핵심 결정사항 (반드시 고정)

### 결정 1: 역할별 책임 분리 — Worker / Quality / Leader

```
Worker:   구현 + 커밋 + PR 생성 (merge 안 함)
Quality:  PR 리뷰 + 명령 브랜치에 통합 merge (필요시 직접 수정)
Leader:   명령 브랜치 전체 검토 + main 최종 merge
```

**Worker (구현자)**
- 할당된 티켓의 코드를 작성
- 자기 티켓 브랜치에서만 작업 (worktree)
- commit 후 PR을 올림 (merge 권한 없음)
- REVIEW 전환으로 "리뷰 요청" 신호

**Quality (통합자 + 검증자)**
- 모든 티켓의 PR을 **명령 브랜치 위에서** 통합 리뷰
- 티켓 간 교차 문제 감지 (import 관계, config 호환성 등)
- PR을 명령 브랜치에 squash merge
- 통합 과정에서 사소한 충돌/불일치는 **직접 수정** 가능
- REQUEST_CHANGES 시 구체적 피드백 + Worker에게 돌려보냄

**Leader (설계자 + 최종 결정자)**
- 명령 브랜치 전체를 검토 ("처음 계획대로 잘 구현되었는가?")
- 미흡하면 리뷰 피드백 또는 추가 티켓 생성
- 모든 것이 완료되면 main으로 최종 merge
- 코드를 직접 작성하지 않음

### 결정 2: 동시성 = Worktree

**파일 잠금은 불필요하다.**

| 자원 | 충돌 가능성 | 이유 |
|------|-------------|------|
| 소스 코드 | 없음 | 각 Worker가 자기 worktree에서 작업 |
| tickets/T-XXXX.yml | 없음 | 각 Agent는 자기 티켓만 수정 |
| nextTicketId() | 없음 | Leader만 호출 (Leader는 1명) |

```
동시 실행 모델:

Leader (메인 repo)
  ├── Worker1 (worktree)  ← T-0001 티켓 브랜치
  ├── Worker2 (worktree)  ← T-0002 티켓 브랜치
  └── Worker3 (worktree)  ← T-0003 티켓 브랜치

Quality (메인 repo — 명령 브랜치에서 통합 작업)
```

### 결정 3: 티켓 중복 할당 방지 — assignee 검증 강제

```typescript
// ticket.ts — transitionTicket() 내부에 추가
if (from === "READY" && to === "IN_PROGRESS") {
  if (!ticket.assignees.includes(by)) {
    throw new Error(
      `Agent "${by}" is not assigned to ${id}. Assignees: [${ticket.assignees.join(", ")}]`
    );
  }
}
```

| 시나리오 | 방어 | 메커니즘 |
|---------|------|----------|
| 미할당 티켓을 Worker가 가져감 | ✅ 차단 | assignee 검증 (신규) |
| 다른 Worker의 티켓을 가져감 | ✅ 차단 | assignee 검증 (신규) |
| IN_PROGRESS 티켓을 다시 가져감 | ✅ 차단 | 상태 전이 규칙 (기존) |
| DONE 티켓을 다시 가져감 | ✅ 차단 | DONE은 터미널 상태 (기존) |

### 결정 4: Agent 실행 = Task tool Sub-Agent (PLAN 후 clean context)

**문제:** Agent가 `/clear`나 context compression을 트리거할 수 없다.

**해결:** Task tool sub-agent는 새 context에서 시작한다. PLAN 결과물만 전달하면 탐색 과정 없이 깨끗하게 시작.

```
1단계: Plan Agent (탐색 + PLAN 작성)
  - 코드베이스 탐색, 의존성 파악, 구현 방법 검토
  - 최종 산출물: PLAN (steps + assumptions)
  - context 소멸

2단계: Execute Agent (PLAN 기반 구현)
  - PLAN + AC + file_ownership만 받음
  - 깨끗한 context에서 즉시 구현 착수
```

### 결정 5: 2겹 피드백 루프 (Inner Loop + Outer Loop)

```
┌─────────────────────────────────────────────────┐
│  Inner Loop: Execute Agent 내부 자가 검증        │
│  (빠름, 명백한 문제 사전 제거)                    │
│                                                   │
│  검증 명령 실행 (프로젝트에 있으면)               │
│  + LLM 자가 검증: 4가지 코딩 규칙 체크리스트      │
│  + 최대 2회 자체 수정                             │
└───────────────────────┬─────────────────────────┘
                        │ PR 생성 + REVIEW 전환
┌───────────────────────▼─────────────────────────┐
│  Outer Loop: Quality → Fix Agent 왕복            │
│  (정확함, 통합 관점의 독립 검증)                  │
│                                                   │
│  Quality가 PR 리뷰 → 피드백 → Fix Agent 수정     │
│  + 최대 2회 왕복                                  │
│  + 초과 시 Leader 에스컬레이션                    │
└─────────────────────────────────────────────────┘
```

**Inner Loop (Execute Agent 내부):**

```
[Step 1: 검증 명령 실행]
  quality_gates.verify_commands가 있으면 → 실행
  없으면 → smoke_test라도 실행
  둘 다 없으면 → 건너뜀 (Step 2가 주 검증)
  실패 시 → 수정 후 재실행

[Step 2: 코딩 규칙 자가 검증]
  □ file_ownership 밖 파일을 건드리지 않았는가?
  □ AC와 무관한 코드를 추가하지 않았는가?
  □ PLAN에 없는 단계를 임의로 수행하지 않았는가?
  □ 불필요한 추상화/설정을 넣지 않았는가?
  위반 시 → 제거 후 Step 1 재실행

[Step 3: 완료]
  모두 통과 → git_commit_ticket + REVIEW 전환

자체 수정: 최대 2회. 초과 시 BLOCKED + Leader 보고.
```

**Outer Loop (Quality ↔ Fix Agent):**

```
[시도 1]
  Quality Agent가 명령 브랜치에서 전체 PR 리뷰:
  - 각 티켓의 변경을 명령 브랜치 기준으로 diff 확인
  - 코딩 규칙 4가지 체크리스트
  - 티켓 간 교차 문제 확인 (import, config 호환성)
  - 충돌 확인
  - APPROVE → Quality가 squash merge
  - REQUEST_CHANGES → 해당 티켓의 Fix Agent 실행

[REQUEST_CHANGES면]
  Fix Agent (해당 ticket의 worktree) {
    MUST_FIX만 수정 + Inner Loop 재실행 + 추가 커밋
  } → context 소멸

[시도 2]
  Quality 재검증
  APPROVE → merge
  REQUEST_CHANGES → Leader 에스컬레이션

※ 2회 넘으면 PLAN 자체가 잘못된 것. Leader가 재설계.
```

**종료 조건:**

| 조건 | 동작 | 판단 주체 |
|------|------|-----------|
| Quality APPROVE | Quality가 명령 브랜치에 merge | Quality |
| MUST_FIX 0개 (NOTE만) | APPROVE 처리 | Quality |
| Outer Loop 2회 소진 | Leader 에스컬레이션 | 시스템 |
| Inner Loop 3회 실패 | BLOCKED + Leader 보고 | Execute Agent |

### 결정 6: 심각도 2단계 (MUST_FIX / NOTE)

```
MUST_FIX:  이것 없이는 APPROVE 불가. Fix Agent가 반드시 수정.
  예: AC 미충족, 실행 에러, 로직 오류, 티켓 간 호환성 문제

NOTE:      참고사항. Fix Agent는 처리하지 않음.
  예: 네이밍 제안, 리팩토링 아이디어
  → Quality가 후속 티켓으로 제안하거나 무시
```

### 결정 7: quality_gates = 프로젝트별 유연한 검증

```yaml
# 변경 전 (백엔드 특화)
quality_gates:
  lint: true
  tests: true
  typecheck: true
  coverage_min: 70

# 변경 후 (프로젝트 무관)
quality_gates:
  verify_commands:
    - "python -m pytest tests/"
    - "ruff check src/"
  smoke_test: "python main.py --dry-run"
```

검증 명령이 없으면 LLM 자가 검증이 주 방어선. 최소한 smoke_test 지정 권장.

### 결정 8: 브랜치 네이밍 컨벤션

```
명령 브랜치:  feat/{command-slug}
티켓 브랜치:  feat/{command-slug}--T-XXXX
```

> **`/` 구분자가 아닌 `--` 구분자를 사용하는 이유:**
> Git ref는 파일시스템 경로와 동일한 구조를 사용한다.
> `feat/my-task`가 브랜치(파일)로 존재하면, `feat/my-task/T-0001`은
> 같은 경로를 디렉토리로 사용하므로 **생성 자체가 불가능**하다.
> (실제 테스트에서 `fatal: cannot lock ref` 에러 확인됨)

- 티켓 브랜치는 명령 브랜치에서 분기
- 명령 브랜치는 main(또는 지정 브랜치)에서 분기

### 결정 9: 커밋 메시지 컨벤션

```
T-XXXX: {한 줄 요약}

예: T-0001: Add JWT token issuance and validation
```

- `T-XXXX:` 접두사 필수
- 영문, 동사 원형 시작, 50자 이내

### 결정 10: 머지 전략

```
티켓 브랜치 → 명령 브랜치:  squash merge (Quality가 실행)
명령 브랜치 → main:         merge commit --no-ff (Leader가 실행)
```

### 결정 11: PLAN은 티켓 필드 (별도 상태 아님)

기존 6 상태 유지. plan 필드는 optional로 추가:
```yaml
plan:
  steps:
    - description: "JWT 발급 함수 작성"
      verification: "단위 테스트 통과"
  assumptions:
    - "토큰 만료 시간은 1시간으로 가정"
```

### 결정 12: Git 도구는 MCP에 포함

```
MCP git 도구가 하는 일:
1. 컨벤션 강제 (브랜치명, 커밋 메시지 형식)
2. 티켓 YAML 자동 업데이트 (git.ticket_branch, artifacts.commits)
3. 역할 제한 (Worker: commit만, Quality: merge to command, Leader: merge to main)
```

### 결정 13: 코드 규칙 검증 = Quality 프롬프트 강화

별도 자동화 도구를 만들지 않는다. Quality 프롬프트에 체크리스트를 넣으면 충분.
유일한 자동 검증: `git_commit_ticket`이 file_ownership 위반 경고.

---

## 3. 필요한 변경 전체 목록

### 3.1 스키마 변경 (`src/schema.ts`)

```typescript
// 변경: QualityGates 유연화
export const QualityGates = z.object({
  verify_commands: z.array(z.string()).default([]),
  smoke_test: z.string().optional(),
});

// 추가: Plan 필드
export const PlanStep = z.object({
  description: z.string(),
  verification: z.string(),
});
export const Plan = z.object({
  steps: z.array(PlanStep).default([]),
  assumptions: z.array(z.string()).default([]),
});

// 추가: Git 필드
export const GitInfo = z.object({
  command_branch: z.string().optional(),
  ticket_branch: z.string().optional(),
  base_branch: z.string().default("main"),
});

// TicketSchema에 추가 (optional → 하위 호환)
plan: Plan.optional(),
git: GitInfo.optional(),
```

상태 머신 변경: 없음. 기존 6 상태 유지.

### 3.2 티켓 소유권 검증 (`src/ticket.ts`)

```typescript
// transitionTicket() 내부에 추가
if (from === "READY" && to === "IN_PROGRESS") {
  if (!ticket.assignees.includes(by)) {
    throw new Error(
      `Agent "${by}" is not assigned to ${id}. Assignees: [${ticket.assignees.join(", ")}]`
    );
  }
}
```

### 3.3 신규 파일: `src/git.ts`

```
child_process.execSync 기반 git 명령 래퍼.

함수 목록:
- getCurrentBranch(): string
- branchExists(name): boolean
- createAndCheckoutBranch(name, base?): void
- commitAll(message): string
- getChangedFiles(base, head): string[]
- hasConflicts(source, target): boolean
- mergeBranch(source, strategy): void
- getDiffStat(base, head): string
```

### 3.4 신규 MCP 도구 (6개)

| # | 도구 | 설명 | 주요 사용자 |
|---|------|------|-------------|
| 1 | `git_init_command` | 명령 브랜치 생성. `feat/{slug}` 형식 강제. | Leader |
| 2 | `git_create_ticket_branch` | 티켓 서브 브랜치 생성. `feat/{slug}--T-XXXX` 형식. 명령 브랜치에서 분기 + worktree 생성. 티켓 YAML의 `git.ticket_branch` 자동 업데이트. | Worker |
| 3 | `git_commit_ticket` | 커밋. `T-XXXX: {msg}` 형식 강제. file_ownership 위반 경고. 티켓 `artifacts.commits` 자동 업데이트. | Worker, Fix Agent |
| 4 | `git_check_conflicts` | 티켓 브랜치 → 명령 브랜치 충돌 확인. 충돌 파일 목록 반환. | Quality |
| 5 | `git_merge_ticket` | 티켓 브랜치 → 명령 브랜치 squash merge. REVIEW 이상 상태만 허용. | **Quality** |
| 6 | `git_merge_command` | 명령 브랜치 → main merge commit (--no-ff). 모든 티켓 DONE일 때만 허용. | **Leader** |

**역할별 merge 권한:**

| 역할 | commit | merge to command | merge to main |
|------|--------|------------------|---------------|
| Worker | ✅ | ❌ | ❌ |
| Quality | ✅ (통합 수정) | ✅ | ❌ |
| Leader | ❌ | ❌ | ✅ |

### 3.5 기존 도구 변경

| 도구 | 변경 내용 |
|------|-----------|
| `ticket_create` | `plan`, `git` 파라미터 추가. quality_gates를 verify_commands/smoke_test로 변경 |
| `ticket_update` | `plan`, `git` 필드 업데이트 지원 |
| `ticket_transition` | assignee 검증 추가 (READY→IN_PROGRESS 시) |
| `board_view` | 티켓별 브랜치명 표시 |

### 3.6 프롬프트 변경

**`prompts/leader.md` — 추가 섹션:**
```markdown
## 브랜치 관리

### 명령 수신 시
1. git_init_command로 명령 브랜치 생성
2. 티켓 분할 시 각 티켓에 git.command_branch 기록
3. quality_gates에 프로젝트에 맞는 verify_commands 지정

### Worker 실행 (2단계 sub-agent)

1단계 — Plan Agent (병렬):
  티켓별 Task(subagent) 생성
  → PLAN 반환 → ticket_update로 plan 필드에 기록

2단계 — Execute Agent (병렬, worktree):
  티켓별 Task(subagent, worktree) 생성
  PLAN + AC + file_ownership + verify_commands 전달
  → 구현 + Inner Loop 자가 검증 + commit + REVIEW 전환

### Quality 실행 (1개 sub-agent)
  모든 Worker가 REVIEW로 올린 후:
  Task(quality subagent) {
    prompt: "명령 브랜치 기준으로 전체 PR 리뷰.
             티켓 목록: {T-0001, T-0002, T-0003}
             각 티켓의 AC, PLAN, file_ownership.
             코딩 규칙 4가지 체크리스트.
             티켓 간 교차 문제 확인.
             APPROVE → squash merge.
             REQUEST_CHANGES → MUST_FIX 명시."
  }

### 피드백 루프

Quality가 REQUEST_CHANGES 시:
1. 해당 티켓의 Fix Agent 생성 (MUST_FIX만 전달)
2. Fix Agent 수정 완료 후 Quality 재실행
3. 최대 2회. 초과 시 직접 판단 (추가 티켓 / 재설계)

### 명령 브랜치 최종 검토

Quality가 모든 PR을 merge한 후:
1. 명령 브랜치에서 전체 verify_commands 실행
2. 처음 계획(원래 명령)대로 구현되었는지 확인
3. 미흡하면 → 추가 티켓 생성 또는 리뷰 피드백
4. 완료 확인 → git_merge_command로 main merge
5. board_generate → BOARD.md 갱신
```

**`prompts/worker.md` — 추가 섹션:**
```markdown
## 브랜치 & PLAN

### 착수 시 (Execute Agent로 실행될 때)
1. git_create_ticket_branch로 서브 브랜치 생성
2. ticket_transition → IN_PROGRESS
3. PLAN의 steps를 순서대로 실행

### 자가 검증 (Inner Loop)

구현 완료 후 반드시:

[Step 1: 검증 명령]
  verify_commands 실행 (있으면). 없으면 smoke_test.
  실패 시 → 수정 후 재실행.

[Step 2: 코딩 규칙 자가 검증]
  □ file_ownership 밖 파일 미수정
  □ AC 밖 코드 미추가
  □ PLAN 밖 행위 미수행
  □ 불필요한 추상화 미추가
  위반 시 → 제거 후 Step 1 재실행.

최대 수정 2회. 초과 시 BLOCKED.

### 완료 시
1. git_commit_ticket으로 커밋
2. ticket_transition → REVIEW
※ merge하지 않음. PR만 올림. Quality가 merge 담당.

### Fix Agent로 실행될 때
1. MUST_FIX 항목만 수정 (NOTE 무시)
2. Inner Loop 재실행
3. git_commit_ticket으로 추가 커밋
```

**`prompts/quality.md` — 추가 섹션:**
```markdown
## 역할 변경: 통합자 + 검증자

당신은 PR을 리뷰하고, 명령 브랜치에 **직접 통합(merge)**한다.
통합 과정에서 사소한 충돌/불일치는 직접 수정할 수 있다.

### 할 수 있는 것 (변경)
- Worker가 변경한 파일을 읽고 분석
- verify_commands 직접 실행
- git_merge_ticket으로 티켓 브랜치를 명령 브랜치에 squash merge
- 통합 중 사소한 충돌/import 수정 (직접 commit 가능)
- 티켓 YAML 업데이트 (status, log)

### 할 수 없는 것
- 명령 브랜치를 main에 merge (Leader만 가능)
- 티켓의 AC/스코프 변경 (Leader에게 에스컬레이션)
- Worker의 구현을 대규모로 재작성 (REQUEST_CHANGES로 돌려보냄)

## 리뷰 프로세스

### Step 1 — 전체 PR 파악
명령 브랜치 기준으로 모든 REVIEW 상태 티켓의 diff 확인.
각 티켓의 AC, PLAN, file_ownership 참조.

### Step 2 — 티켓별 검증
각 티켓에 대해:
1. verify_commands 실행
2. AC 충족 확인
3. 코딩 규칙 4가지 체크리스트:

[규칙 1: Think Before Coding]  ✅/❌
  PLAN의 assumptions에 가정이 명시되었는가?
[규칙 2: Simplicity First]    ✅/❌
  요청 범위 밖의 코드, 불필요한 추상화가 없는가?
[규칙 3: Surgical Changes]    ✅/❌
  file_ownership 밖 파일 변경이 없는가?
[규칙 4: Goal-Driven]         ✅/❌
  PLAN 단계별 검증이 수행/기록되었는가?

### Step 3 — 교차 검증 (통합 관점)
- 티켓 간 import/호출 관계 일관성
- 공유 config/type 호환성
- 전체 verify_commands가 통합 후에도 통과하는가

### Step 4 — 판정

APPROVE인 경우:
  1. git_merge_ticket으로 각 티켓 브랜치를 명령 브랜치에 squash merge
  2. 통합 중 사소한 수정이 필요하면 직접 commit
  3. ticket_transition → DONE (각 티켓)

REQUEST_CHANGES인 경우 (티켓별로 분리하여 출력):
  T-XXXX:
    MUST_FIX:
      1. {file}:{line} — {구체적 문제와 기대 동작}
    NOTE:
      1. {참고사항}

  T-YYYY:
    MUST_FIX: (없음 → 이 티켓은 APPROVE)
    NOTE:
      1. {참고사항}

※ MUST_FIX가 0개인 티켓은 먼저 merge 가능.
※ MUST_FIX가 있는 티켓만 Fix Agent로 돌려보냄.
```

### 3.7 `WORKFLOW_INSTRUCTIONS` 변경 (`src/index.ts`)

```
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
```

---

## 4. 전체 워크플로우 (확정)

```
[명령 수신]
    │
    ▼
[Phase 1: 초기화] — Leader (메인 context)
    1. git_init_command → feat/{slug} 브랜치 생성
    2. ticket_create × N → 티켓 분할 (git.command_branch, quality_gates 포함)
    3. ticket_transition → READY
    │
    ▼
[Phase 2: PLAN 작성] — Plan Agent × N (Task sub-agent, 병렬)
    Leader가 티켓별로 Plan Agent 생성:
    1. Plan Agent가 코드베이스 탐색 + 구현 계획 수립
    2. PLAN (steps + assumptions) 반환
    3. Leader가 ticket_update로 plan 필드에 기록
    ※ Plan Agent의 context 소멸
    │
    ▼
[Phase 3: 구현] — Execute Agent × N (Task sub-agent + worktree, 병렬)
    Leader가 티켓별로 Execute Agent 생성 (PLAN만 전달):
    1. git_create_ticket_branch → 서브 브랜치 생성
    2. ticket_transition → IN_PROGRESS (assignee 검증)
    3. PLAN steps 순서대로 구현
    4. [Inner Loop] 자가 검증
    5. git_commit_ticket → 커밋
    6. ticket_transition → REVIEW (merge 안 함, PR만 올림)
    ※ Execute Agent의 context 소멸
    │
    ▼
[Phase 4: 통합 리뷰] — Quality Agent × 1 (Task sub-agent)
    Leader가 Quality Agent 1개 생성 (모든 REVIEW 티켓 대상):
    1. 명령 브랜치 기준으로 전체 diff 확인
    2. 티켓별 코딩 규칙 4가지 + AC 확인
    3. 티켓 간 교차 문제 확인 (import, config 호환성)
    4. 문제 없는 티켓 → git_merge_ticket으로 squash merge + DONE
    5. 문제 있는 티켓 → REQUEST_CHANGES (MUST_FIX 명시)
    6. 통합 중 사소한 충돌/불일치 → Quality가 직접 수정 후 commit
    ※ Quality Agent의 context 소멸
    │
    ├─ [Phase 4a: 수정] (MUST_FIX가 있는 티켓만, 최대 2회)
    │   Leader가 해당 티켓의 Fix Agent 생성 (MUST_FIX만 전달):
    │   1. MUST_FIX 항목 수정
    │   2. [Inner Loop] 자가 검증
    │   3. git_commit_ticket → 추가 커밋
    │   ※ Fix Agent context 소멸
    │   │
    │   ▼
    │   새 Quality Agent → 해당 티켓만 재검증
    │   APPROVE → merge + DONE
    │   REQUEST_CHANGES (2회째) → Leader 에스컬레이션
    │
    ▼
[Phase 5: 최종 검토 + 통합] — Leader (메인 context)
    1. 명령 브랜치에서 전체 verify_commands 실행
    2. 처음 명령의 의도대로 구현되었는지 검토
    3. 미흡하면 → 추가 티켓 생성 or 리뷰 피드백 (Phase 2~4 반복)
    4. 완료 확인 → git_merge_command → main merge commit
    5. board_generate → BOARD.md 갱신
    6. 완료 보고
```

### Context 흐름 시각화

```
Leader context ─────────────────────────────────────────────────────────
  │              │              │
  │ [spawn]      │ [spawn]      │ [spawn]        ← Plan Agent 병렬
  ▼              ▼              ▼
Plan Agent     Plan Agent     Plan Agent
(T-0001)       (T-0002)       (T-0003)
  │ PLAN 반환    │ PLAN 반환    │ PLAN 반환
  ▼              ▼              ▼                 ← context 소멸
Leader context ─────────────────────────────────────────────────────────
  │              │              │
  │ [spawn]      │ [spawn]      │ [spawn]        ← Execute Agent 병렬
  ▼              ▼              ▼
Execute Agent  Execute Agent  Execute Agent
(worktree)     (worktree)     (worktree)
  │ 구현+commit   │ 구현+commit   │ 구현+commit
  │ →REVIEW       │ →REVIEW       │ →REVIEW
  ▼              ▼              ▼                 ← context 소멸
Leader context ─────────────────────────────────────────────────────────
  │
  │ [spawn]                                       ← Quality 1개
  ▼
Quality Agent (전체 PR 리뷰)
  │ T-0001: APPROVE → merge
  │ T-0002: APPROVE → merge
  │ T-0003: REQUEST_CHANGES (MUST_FIX)
  ▼                                               ← context 소멸
Leader context ─────────────────────────────────────────────────────────
  │
  │ [spawn]                                       ← Fix Agent (T-0003만)
  ▼
Fix Agent (T-0003, worktree)
  │ MUST_FIX 수정 + commit
  ▼                                               ← context 소멸
Leader context ─────────────────────────────────────────────────────────
  │
  │ [spawn]                                       ← Quality 재검증
  ▼
Quality Agent (T-0003만 재검증)
  │ APPROVE → merge
  ▼                                               ← context 소멸
Leader context ─────────────────────────────────────────────────────────
  │
  │ 명령 브랜치 최종 검토
  │ verify_commands 실행
  │ 원래 명령 의도 대로 구현되었는가?
  │ ✅ → git_merge_command → main merge
  │
  완료
```

---

## 5. 신규/변경 파일 요약

| 파일 | 작업 | 내용 |
|------|------|------|
| `src/git.ts` | **신규** | Git 명령 래퍼 (~150 LOC) |
| `src/schema.ts` | 수정 | QualityGates 유연화, Plan, GitInfo 스키마 추가 |
| `src/index.ts` | 수정 | 신규 도구 6개 등록, WORKFLOW_INSTRUCTIONS 확장 |
| `src/ticket.ts` | 수정 | assignee 검증 추가, plan/git 필드 지원 |
| `src/board.ts` | 수정 | 브랜치 정보 표시 |
| `prompts/leader.md` | 수정 | 최종 검토 프로세스, sub-agent 실행, 피드백 루프 추가 |
| `prompts/worker.md` | 수정 | Inner Loop 자가 검증, "merge 안 함" 명시, Fix Agent 모드 추가 |
| `prompts/quality.md` | 수정 | 통합자 역할, merge 권한, 교차 검증, MUST_FIX/NOTE 형식 추가 |

**추가하지 않는 파일과 이유:**

| 불필요 파일 | 이유 |
|-------------|------|
| `src/lock.ts` | Worktree + 티켓 1:1 할당 → 충돌 없음 |
| `src/code-review.ts` | LLM 판단 → Quality 프롬프트로 처리 |
| `src/merge.ts` | merge 로직은 git.ts에 포함 |
| `src/plan.ts` | plan은 ticket_update의 필드 |

---

## 6. 위험 요소 및 대응

| 위험 | 대응 |
|------|------|
| Git 명령 실행 실패 | execSync 래핑 + 상세 에러 메시지 |
| Git ref 네이밍 충돌 | `feat/{slug}/T-XXXX` 사용 불가 → `feat/{slug}--T-XXXX`로 회피 (실증됨) |
| Worker가 직접 git commit | 프롬프트 명시 + Quality가 감지 |
| Worker가 직접 merge 시도 | git_merge_ticket이 역할 검증. Worker 호출 시 거부 |
| 동일 파일 수정 → merge 충돌 | file_ownership 분리로 예방. 불가피 시 Quality가 직접 해소 (실증됨) |
| 기존 티켓 하위 호환 | plan, git 필드 optional → 기존 YAML 동작 |
| Plan Agent 부정확 PLAN | Leader 검토 후 기록. 부적절 시 재생성 |
| Execute Agent PLAN 무시 | Inner Loop 자가 검증 + Quality가 PLAN 대조 |
| Outer Loop 무한 반복 | 최대 2회. 초과 시 Leader 에스컬레이션 |
| verify_commands 없는 프로젝트 | LLM 자가 검증이 주 방어선 + smoke_test 권장 |
| Quality 통합 수정이 과도해짐 | "사소한 수정"만 허용. 대규모 재작성은 REQUEST_CHANGES |
| 티켓 간 교차 문제 | Quality가 1개 Agent로 전체를 보므로 감지 가능 |
| Leader 최종 검토에서 재설계 필요 | 추가 티켓 생성 → Phase 2~4 반복 |

---

## 7. 구현 순서

| Phase | 작업 | 의존성 |
|-------|------|--------|
| 1 | `src/schema.ts` — QualityGates 변경, Plan, GitInfo 추가 | 없음 |
| 2 | `src/git.ts` — Git 래퍼 구현 (역할 검증 포함) | 없음 |
| 3 | `src/ticket.ts` — assignee 검증 + plan/git 필드 지원 | Phase 1 |
| 4 | `src/index.ts` — 6개 도구 등록 | Phase 2, 3 |
| 5 | `src/board.ts` — 브랜치 표시 | Phase 1 |
| 6 | 프롬프트 3개 업데이트 (leader, worker, quality) | Phase 4 |
| 7 | WORKFLOW_INSTRUCTIONS 확장 + kickoff 프롬프트 | Phase 6 |

Phase 1~2는 병렬 가능. 이후 순차.

---

## 8. 핵심 결정 요약 (Quick Reference)

| # | 결정 | 내용 |
|---|------|------|
| 1 | 역할 분리 | Worker: commit+PR, Quality: 리뷰+merge to command, Leader: 최종검토+merge to main |
| 2 | 동시성 | Worktree 격리. 파일 잠금 불필요 |
| 3 | 티켓 보호 | transitionTicket()에 assignee 검증 |
| 4 | Agent 실행 | Task sub-agent. Plan Agent → Execute Agent 2단계 |
| 5 | Context 관리 | Sub-agent 분리로 clean context |
| 6 | 피드백 루프 | Inner Loop(자가 검증 2회) + Outer Loop(Quality↔Fix 2회) |
| 7 | 심각도 | MUST_FIX / NOTE 2단계. Fix Agent는 MUST_FIX만 |
| 8 | Quality 리뷰 | 1개 Agent가 전체 PR 통합 리뷰. 교차 문제 감지. 사소한 수정 직접 가능 |
| 9 | quality_gates | verify_commands[] + smoke_test. 프로젝트별 유연 |
| 10 | 브랜치 네이밍 | `feat/{slug}` / `feat/{slug}--T-XXXX` (`/` 아닌 `--` 구분) |
| 11 | 커밋 메시지 | `T-XXXX: {요약}` |
| 12 | 머지 전략 | 티켓→명령: squash (Quality), 명령→main: merge commit (Leader) |
| 13 | PLAN | 티켓 필드 (별도 상태 아님). Plan Agent가 작성 |
| 14 | Git 도구 | MCP에 6개. 컨벤션 강제 + 역할별 권한 제한 |
| 15 | 코드 규칙 | Quality 프롬프트 체크리스트 + file_ownership 자동 경고 |
| 16 | 상태 수 | 기존 6개 유지 |

---

## Appendix A. Worktree 멀티 에이전트 실증 테스트

> 테스트 일시: 2026-02-27
> 환경: WSL2 (Linux 6.6.87), Git 2.x, claude-kanban-mcp 레포지토리

### A.1 테스트 시나리오

3개 Worker가 **동일한 파일**(`test-shared.ts`)을 각각의 worktree에서 독립적으로 수정하고,
Quality가 순차적으로 명령 브랜치에 squash merge하는 전체 플로우를 검증.

```
test-shared.ts (원본)
├── Worker1: greet() 수정 + subtract() 추가
├── Worker2: add()에 로깅 추가 + divide() 추가
└── Worker3: multiply()에 로깅 추가 + power() 추가
```

### A.2 실행 절차 (정규화)

아래는 실제 테스트에서 작동이 확인된 정확한 절차이다.
다른 프로젝트에서 재현할 때 이 순서를 따른다.

```bash
# ── Phase 0: 준비 ──────────────────────────────────
# 현재 작업을 보존
git stash -u -m "before worktree test"

# ── Phase 1: 명령 브랜치 생성 (Leader) ─────────────
git checkout -b feat/{slug}

# ── Phase 2: Worktree 생성 (Worker × N) ───────────
# 주의: 브랜치 구분자는 `/` 가 아닌 `--` (Git ref 충돌 방지)
git worktree add .claude/worktrees/worker1 \
  -b feat/{slug}--T-0001 feat/{slug}

git worktree add .claude/worktrees/worker2 \
  -b feat/{slug}--T-0002 feat/{slug}

git worktree add .claude/worktrees/worker3 \
  -b feat/{slug}--T-0003 feat/{slug}

# ── Phase 3: 독립 작업 + 커밋 (Worker × N, 병렬 가능) ──
# 각 worktree는 완전히 독립된 폴더. 동시 수정 가능.
cd .claude/worktrees/worker1
# ... 파일 수정 ...
git add -A && git commit -m "T-0001: {요약}"

# worker2, worker3도 동일 (병렬 실행 가능)

# ── Phase 4: 순차 Squash Merge (Quality) ──────────
cd /path/to/main/repo   # 명령 브랜치 위치
git checkout feat/{slug}

# 첫 번째 티켓 (보통 충돌 없음)
git merge --squash feat/{slug}--T-0001
git commit -m "T-0001: {요약} (squash)"

# 두 번째 이후 (동일 파일 수정 시 충돌 가능)
git merge --squash feat/{slug}--T-0002
# 충돌 발생 시: 수동 해소 → git add → git commit

# ── Phase 5: 정리 ─────────────────────────────────
git worktree remove .claude/worktrees/worker1
git worktree remove .claude/worktrees/worker2
git worktree remove .claude/worktrees/worker3
git branch -D feat/{slug}--T-0001
git branch -D feat/{slug}--T-0002
git branch -D feat/{slug}--T-0003
```

### A.3 발견된 문제 + 해결

#### 문제 1: Git ref 계층 충돌 (`/` 구분자 사용 불가)

```
시도:     git worktree add ... -b feat/my-task/T-0001 feat/my-task
결과:     fatal: cannot lock ref 'refs/heads/feat/my-task/T-0001':
          'refs/heads/feat/my-task' exists;
          cannot create 'refs/heads/feat/my-task/T-0001'
원인:     Git은 ref를 파일시스템에 저장한다.
          feat/my-task가 "파일"로 존재하면 feat/my-task/를 "디렉토리"로
          동시에 사용할 수 없다.
해결:     feat/{slug}--T-XXXX 형식으로 변경 (같은 디렉토리 레벨)
```

**git_create_ticket_branch 구현 시 검증 코드:**

```typescript
function createTicketBranch(commandBranch: string, ticketId: string) {
  // ❌ 절대 하면 안 되는 것
  // const branch = `${commandBranch}/${ticketId}`;

  // ✅ 올바른 방법
  const branch = `${commandBranch}--${ticketId}`;

  if (branchExists(branch)) {
    throw new Error(`Branch ${branch} already exists`);
  }
  execSync(`git worktree add .claude/worktrees/${ticketId} -b ${branch} ${commandBranch}`);
}
```

#### 문제 2: 동일 파일 수정 시 merge 충돌은 불가피

```
상황:     Worker1, Worker2, Worker3가 test-shared.ts를 각각 수정
결과:     T-0001 merge → 성공 (fast-forward squash)
          T-0002 merge → CONFLICT (같은 파일의 다른 부분)
          T-0003 merge → CONFLICT (같은 파일의 다른 부분)
원인:     Git의 근본 속성. worktree와 무관.
          같은 파일의 다른 함수를 수정해도 context line이 겹치면 충돌.
```

**대응 전략 (우선순위 순):**

| 순위 | 전략 | 적용 시점 | 효과 |
|------|------|-----------|------|
| 1 | file_ownership 분리 | Leader 티켓 분할 시 | 충돌 자체를 예방 |
| 2 | merge 순서 최적화 | Quality merge 시 | 변경량 적은 티켓 먼저 merge → 충돌 범위 축소 |
| 3 | Quality 수동 해소 | 충돌 발생 시 | 불가피한 충돌을 직접 해소 |

**Leader 티켓 분할 시 검증 규칙 (추가):**

```
규칙: 2개 이상의 티켓이 동일 파일을 file_ownership에 포함하면 경고.
      불가피한 경우 (공유 파일) → Quality에게 merge 순서 힌트 제공.
```

**Quality merge 순서 가이드:**

```
1. 변경 파일이 적은 티켓부터 merge (충돌 확률 최소화)
2. 공유 파일을 건드리지 않는 티켓을 먼저 merge
3. 공유 파일을 건드리는 티켓은 마지막에 merge
4. 충돌 발생 시 양쪽 변경을 모두 보존하는 방향으로 해소
```

### A.4 검증 결과 요약

| 검증 항목 | 결과 | 비고 |
|-----------|------|------|
| Worktree 3개 동시 생성 | **성공** | `.claude/worktrees/{name}` 경로 |
| 각 worktree에서 독립 브랜치 | **성공** | `--` 구분자 사용 필수 |
| 동일 파일 독립 수정 (3 worktree) | **성공** | 서로 간섭 없음 |
| 각 worktree에서 독립 커밋 | **성공** | 동시 실행 가능 |
| 첫 번째 squash merge | **성공** | 충돌 없음 (fast-forward) |
| 두 번째 이후 squash merge | **충돌 발생** | 동일 파일 수정 시 불가피 |
| Quality 충돌 수동 해소 | **성공** | 양쪽 변경 모두 보존 가능 |
| Worktree 정리 + 브랜치 삭제 | **성공** | 원래 상태로 완전 복원 |
| stash 보존/복원 | **성공** | 테스트 전후 작업 보존 |

### A.5 MCP 도구 구현 시 반영 사항

위 테스트 결과를 바탕으로 MCP 도구 구현 시 아래를 **강제**해야 한다:

```
git_init_command:
  - 명령 브랜치 생성 전 동명 브랜치 존재 여부 확인
  - 브랜치명 형식 검증: feat/{slug} (슬래시 1개까지만)

git_create_ticket_branch:
  - 구분자는 반드시 `--` 사용 (코드에서 하드코딩)
  - worktree 경로: .claude/worktrees/{ticket-id}
  - 명령 브랜치가 존재하는지 확인 후 생성
  - 생성 후 ticket YAML의 git.ticket_branch 자동 업데이트

git_merge_ticket:
  - merge 전 git_check_conflicts로 충돌 사전 감지
  - 충돌 발생 시: 충돌 파일 목록 + conflict marker 내용 반환
  - Quality가 해소 후 다시 호출하는 2단계 패턴 지원
  - merge 순서: 변경량 적은 순서 권장 (도구가 힌트 제공)

git_commit_ticket:
  - file_ownership 위반 확인: git diff --name-only로 변경 파일 추출
  - 위반 파일이 있으면 경고 메시지 (커밋은 허용, 경고만)
```
