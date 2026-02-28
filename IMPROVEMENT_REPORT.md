# Claude Kanban MCP 개선 완료 보고서 v10

> 작성일: 2026-02-28  
> 대상: `claude-kanban-mcp` v2.0.0 코드베이스  
> 기준: 현재 저장소 구현/문서/테스트 상태  
> 핵심 원칙: **기능 확장보다 경량성 우선**

---

## 1. 목적

이 문서는 현재 시점에서:

- 실제로 반영된 개선 사항을 확정하고
- 운영/인터페이스 변경점을 명확히 기록하며
- 남은 후속 과제를 분리해 관리하기 위해 작성한다.

---

## 2. 현재 아키텍처 요약

### 2.1 실행 구성

- MCP Server (stdio): 티켓/Git 오케스트레이션 담당
- Board Viewer (별도 프로세스): 읽기 전용 웹 보드 담당
- 데이터 원본: `tickets/*.yml`

### 2.2 인터페이스 현황

- MCP Tools: 14개
  - Ticket: 7개
  - Git: 7개
- Prompt: 1개 (`kickoff`)
- Resources: 3개 (`leader`, `worker`, `quality`)

### 2.3 상태 전이/검증

- 상태: `BACKLOG`, `READY`, `IN_PROGRESS`, `REVIEW`, `DONE`, `BLOCKED`
- 허용 전이: 14개
- `READY -> IN_PROGRESS` 시 assignee 검증 적용

---

## 3. 이번 사이클 개선 완료 항목

## 3.1 MCP / Board 분리 완료

- [x] MCP에서 `board_view`, `board_generate` 제거
- [x] `kickoff`에서 board 요약/렌더링 제거
- [x] Board 기능을 별도 Viewer로 이관
- [x] 기존 `src/board.ts` 제거

결과:
- MCP 본체는 티켓/Git 오케스트레이션에 집중
- 보드 관찰은 별도 프로세스로 분리

## 3.2 Board Viewer 구현 완료 (읽기 전용)

- [x] 실행 엔트리: `npm run board`
- [x] 필수 인자: `--root` (미지정 시 오류/사용법 출력)
- [x] 기본 포트: `4310` (`--port` override 가능)
- [x] UI: 상태 컬럼 + 필터(status/assignee/priority) + 상세 패널
- [x] 갱신: polling 1초
- [x] invalid ticket: 하단 에러 섹션 분리 표시
- [x] 파일 단위 파싱 실패 격리 처리

권장 실행:

```bash
npm run board -- --root "$(pwd)"
```

## 3.3 도구 레벨 정책 강제 완료 (1차)

- [x] `git_merge_ticket`에 `by` 입력 추가
- [x] `git_merge_command`에 `by` 입력 추가
- [x] 역할 검증 코드 강제:
  - `git_merge_ticket`: `by=quality`만 허용
  - `git_merge_command`: `by=leader`만 허용

결과:
- 프롬프트 규약 의존이 아니라 코드 레벨에서 권한 위반 차단

## 3.4 충돌 검증 고도화 완료 (1차)

- [x] `git_check_conflicts`가 merge-base 기반 비교 수행
- [x] 티켓/명령 브랜치 변경 파일 목록 제공
- [x] 중복 변경 파일(overlap) 표시
- [x] 리스크 레벨(`low|medium|high`) 요약 제공
- [x] diff stat 보조 정보 포함

결과:
- 단순 diff stat보다 merge 의사결정에 직접 활용 가능한 출력 제공

## 3.5 파일 소유권 가시성 강화

- [x] `git_commit_ticket`에서 소유권 위반 감지 시 경고 유지
- [x] 티켓 log에 `OWNERSHIP_VIOLATION_WARN` 이벤트 기록 추가

결과:
- 승인 근거 검토를 위한 운영 가시성 상승

## 3.6 문서/운영 규약 동기화

- [x] README를 2-터미널 운영 모델로 갱신
- [x] Viewer 기본 명령을 `--root "$(pwd)"` 중심으로 명시
- [x] `prompts/leader.md`, `prompts/quality.md`에 `by` 규약 반영

---

## 4. 검증 결과 (현재 기준)

확인 완료:

- [x] `npm run check` 통과
  - `lint` 통과
  - `test` 통과
  - `typecheck` 통과
- [x] `npm run build` 통과

추가된 테스트:

- `tests/policy.test.js`
- `tests/conflict.test.js`
- `tests/viewer-loader.test.js`

---

## 5. 현재 기능 상태표

| 항목 | 상태 | 비고 |
|---|---|---|
| 티켓 CRUD/전이/검증 | ✅ 완료 | 생성/조회/목록/수정/전이/검증/다음 ID |
| 상태 머신 | ✅ 완료 | 6 상태, 14 허용 전이 |
| 역할 프롬프트 | ✅ 완료 | leader / worker / quality |
| Git 워크플로우 도구 | ✅ 완료 | 브랜치/워크트리/커밋/머지 |
| MCP/Board 분리 | ✅ 완료 | MCP 본체에서 board 도구 제거 |
| Board Viewer | ✅ 완료 | 읽기 전용, polling 1초, invalid 분리 |
| merge 권한 코드 강제 | ✅ 완료 | `by` 역할 검증 적용 |
| 충돌 검증 고도화(1차) | ✅ 완료 | 파일/overlap/risk 요약 |
| 파일 소유권 정책 강제 | ⚠️ 부분 | 경고+로그는 구현, 승인근거 하드강제는 후속 |
| PLAN/피드백 루프 강제 | ⚠️ 부분 | 규약 중심, 도구 강제는 후속 |
| E2E 자동화 | ⚠️ 부분 | 단위/로더 테스트는 추가, 전체 시나리오 E2E는 후속 |

---

## 6. 남은 후속 과제

### P1

- [ ] E2E 워크플로우 자동화 강화
  - 생성 -> 전이 -> 커밋 -> 머지 -> Viewer 반영까지 통합 회귀

### P2

- [ ] PLAN/피드백 루프의 도구 레벨 강제 강화
- [ ] 파일 소유권 예외 변경 시 승인 근거 검증의 하드 제약 도입

---

## 7. 경량성 가드레일 (유지 기준)

모든 후속 변경에서 아래를 유지한다:

- [ ] 이 변경 없이 목표 달성이 가능한지 먼저 검토
- [ ] 신규 의존성 추가는 기본 금지, 필요 시 근거 명시
- [ ] MCP 본체에 상시 프로세스/워치/캐시를 도입하지 않음
- [ ] 초기 실행 경로의 불필요 I/O 및 복잡도 증가를 피함
- [ ] 분리 가능한 기능은 별도 프로세스로 분리

---

## 8. 결론

이번 개선으로 MCP는 경량 오케스트레이터로 경계를 명확히 했고, Board는 별도 읽기 전용 Viewer로 안정적으로 분리되었다. 또한 merge 권한 검증과 충돌 리스크 요약이 코드 레벨에 반영되어 운영 일관성이 향상되었다.

다음 단계는 E2E 자동화와 정책 하드강제를 보강해 운영 편차를 줄이는 것이다.
