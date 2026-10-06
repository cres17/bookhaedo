# Drift Gate 검증과 Book해도 `ver2` 재검토 — AI 제안 불수용 사례 포함

작성일: 2026-10-06 · 작성: 이 세션의 AI(Claude) · 커밋·푸시하지 않은 로컬 문서

| 항목 | 값 |
|---|---|
| 검증 대상 | `cres17/bookhaedo` `ver2` @ `91aaa285525987c47bb033701ef9fa2ee8a5594d` (기준 `454a8707078d46d50db978df3ce539b9b0fa775c`, 두 커밋 차이는 1개) |
| 사용 도구 | `cres17/pr-convention-checker` `ver2`. Book해도 wrapper의 고정본 `01e28e1620941a539d3e9c14972201b30adafd3b`를 주 검증에 사용, 최신 `f43cada`는 비교용 |
| 환경 | Python 3.11.15 가상환경(pyyaml 6.0.3, tree-sitter 0.26.0, tree-sitter-language-pack 1.20.0), optional LLM 비활성(`--anthropic-api-key ''`), PostgreSQL 16 + PostGIS 3.4(빈 catalog, CI는 PostGIS 17-3.5) |
| 표기 | **[사실]** 이 세션에서 직접 실행·재현 · **[의견]** 판단 · **[미검증]** 확인하지 못함 |

증거 파일(패치, 결과 JSON, 재현 스크립트)은 [`evidence/`](evidence)에 있다.

---

## 1. 결론

1. **Drift Gate 재현 [사실].** 현재 결과물은 PASS다. 첨부 보고서와 판정·규칙별 결과·위반 수가 같고, 작성자의 8개 대조군은 같은 종료 코드(0, 1, 1, 2, 2, 2, 2, 2)로 재현됐다. 도구 자체 테스트는 고정본 783개, 최신 823개가 통과했고(skip 6), 최신 버전도 4개 입력에서 판정이 같았다.
2. **Gate가 하는 일과 못 하는 일 [사실].** Gate는 "코드 변경에 문서·테스트 파일이 함께 바뀌었는가"만 본다. 보호 규칙을 약화한 코드, 형식만 맞춘 문서 수정, 실제 입력과 다른 fixture로 통과한 결함은 잡지 못했다. 이런 문제는 DB 테스트와 독립 프로브가 잡았다.
3. **새로 확인한 결함 1건 [사실, 재현].** 응답을 놓친 저장 뒤 "현재 일정 확인" GET이 날짜 전환 후에 성공하면 복구 표시는 지워지지만 화면의 일정은 최신으로 바뀌지 않는다(§6 F1).
4. **이전에 지적한 결함 2건 해결 확인 [사실].** 후라노 URL 거절(22개 허용·거절 사례 TS/Python 일치)과 감사 재시도 분류(실제 npm 출력 3종 모두 retry)가 현재 head에서 해결돼 있다.
5. **정책 약점 [사실].** (a) PR이 정책 자체를 약화해도 통과한다(C6). (b) `server/routes/**`의 구현만 바뀐 수정은 만족시킬 수 없는 요구가 걸린다(C1). (c) 소스 172개 중 29개(17%)만 어떤 규칙의 트리거가 될 수 있고, 관광·Valhalla·감사 관련 26개 파일은 전부 규칙 밖이다.
6. **권장 우선순위 [의견].** F1 수정 → Gate를 CI에 붙이기 전에 기준 정책 분리(F2) → 규칙 범위·강도 조정(F3, F4) → 나머지 유지보수.

---

## 2. 재현 방법과 범위

```sh
# 1) 도구 준비: 고정본은 별도 worktree, 의존성은 pyproject 고정 버전
python3 -m venv venv && venv/bin/pip install 'pyyaml>=6.0,<7' 'tree-sitter>=0.26,<0.27' 'tree-sitter-language-pack==1.20.0'
git -C pr-convention-checker worktree add --detach tool-pinned 01e28e1620941a539d3e9c14972201b30adafd3b

# 2) Book해도 head에서 작성자의 wrapper 그대로 실행
python3 scripts/check-drift-gate.py --base 454a8707078d46d50db978df3ce539b9b0fa775c \
  --tool <tool-pinned> --python <venv>/bin/python --out <out>

# 3) 작성자의 대조군 재실행
python3 docs/research/drift-gate-fixes-20261006/run-controls.py --repo . --base 454a870... --tool <tool-pinned> --python <venv>/bin/python --out <out>
```

[사실] 모든 변경 실험은 `git clone --shared`로 만든 일회용 복제본에서만 했다. Book해도·도구 원본 저장소의 작업 트리는 변경하지 않았다.

[미검증] 아래는 하지 않았다: 전체 Vitest 471개(catalog 20,810곳 필요), 실제 발행 자료를 쓰는 E2E, Windows/macOS 데스크톱 앱, Gate의 GitHub Actions 경로(`action.yml`), HARP·삿포로 자료의 이용 허락·robots 정책.

---

## 3. 현재 결과물의 Drift Gate 검증

### 3.1 판정 [사실]

`pass | scope=evaluated | passed matched rules=3 | configured rules=6`, wrapper 종료 코드 0, 실행 약 2.9초.

| 규칙 | 상태 | 트리거 파일 |
|---|---|---|
| `api-contract` | pass | `scripts/write-api-spec.mjs` (1개) |
| `course-recovery` | pass | `DayAlternatives.vue`, `recommendation-recovery.ts`, `Planner.vue` |
| `quality-contract` | pass | `.drift-gate.yml`, `package.json`, `scripts/check-drift-gate.py` |
| `trip-write-contract` · `provider-boundary` · `schema-contract` | unmatched | 해당 변경 없음 |

첨부 보고서와 대조한 결과는 판정, 규칙별 상태, 위반 수, 변경 유형(`cli-public-interface, other`)이 모두 같다. 차이는 검사 파일 수(104 대 100)뿐이며, 커밋에 포함된 증거 파일 4개(`gate/current/{report.json,report.md,run.log}`, `manifest.json`)가 첨부 보고서 시점에는 없었다. 판정에는 영향이 없다.

### 3.2 작성자 대조군 8개 재현 [사실]

| 입력 | 기대 | 실제 |
|---|---:|---:|
| 최신 수정안 | 0 | 0 |
| OpenAPI 3개 변경 되돌림 | 1 | 1 |
| 복구 E2E 변경 되돌림 | 1 | 1 |
| 정책 삭제 | 2 | 2 |
| 빈 정책 | 2 | 2 |
| 도구 추적 소스 변경 | 2 | 2 |
| 도구 미추적 소스 추가 | 2 | 2 |
| 잘못된 기준 + 이전 PASS JSON | 2 | 2 |

### 3.3 도구 신뢰 근거 [사실]

- 도구 자체 pytest: 고정본 `01e28e1` 783개 통과·6 skip, 최신 `f43cada` 823개 통과·6 skip. (첫 실행의 1개 실패는 패키지가 import되지 않는 제 환경 문제였고 `PYTHONPATH` 지정 후 사라졌다. 이 테스트는 하위 프로세스에서 패키지를 import한다.)
- 최신 버전(`f43cada`)과 고정본의 판정이 4개 입력(실제 변경, C1, C2, C3a)에서 동일했다. 고정 버전 갱신을 검토할 근거가 되지만 4개 입력으로는 부족하다 **[의견]**.

### 3.4 보고서 문구 문제 [사실]

Markdown 보고서가 `No contract drift found. All configured policy rules passed.`라고 쓰지만, 같은 실행에서 6개 규칙 중 3개는 어떤 변경과도 일치하지 않아 평가되지 않았다. 규칙별 상태는 JSON에만 있고 `report.md`에는 없다. 실패 보고서도 위반 `message`가 빈 문자열이다. wrapper 출력(`passed matched rules=3 | configured rules=6`)이 더 정확하다.

---

## 4. "AI 제안 → 검증 → 불수용" 사례

사례는 이 세션 대화에서 실제로 나온 AI(Claude)의 제안·주장 중, 사람 검토와 검증으로 받아들이지 않은 것들이다. 같은 AI가 만든 주장이므로 자기 검토라는 한계가 있다 **[의견]**. 각 사례를 Head `91aaa28` 위에 적용하고 Gate 판정과 실제 동작 검증을 나란히 기록했다.

| # | AI의 제안·주장 | 검증 | 결정 | Gate 반응 (현재 정책) | 동작 검증 반응 |
|---|---|---|---|---|---|
| C1 | "NEEDS_ANCHOR 응답에 `no-store`가 없다" | 공통 미들웨어 `middleware.ts:22`가 설정, `ai-recommendations.test.ts:162`가 단언 | **불수용(거짓)** | 제안 패치 적용 시 FAIL (`api-contract` BLOCKER) | 7/7 → 7/7, 동작 변화 없음 |
| C2 | "더 새 npm으로 CI 감사 실패 해결" | 첫 실패는 레지스트리 400, 같은 커밋 재실행 통과, 해결 근거 없음 | **불수용(근거 없음)** | 적용 시 FAIL (`quality-contract`) | 해당 없음(CI 환경 필요) |
| C3 | "별칭 지문을 행 단위로 전환" (보호 완화) | 완화 시 별칭 테스트 3개 실패 | **불수용(보호 규칙 완화)** | **PASS** (`no-matching-rule`) | 3 failed / 30 passed |
| C5 | "철회 해제는 `withdrawal` 행만 지우면 된다" | 실제 DB에서 검색 노출 확인 | **불수용(거짓)** | 코드 변경이 아니라 해당 없음 | 아래 표 |
| C4 | (수용된 변경) `%` 포함 URL 전면 거절 | 실제 후라노 URL로 정제·발행 실행 | 수용 후 결함, `a9b31c8`에서 수정 | 소급 적용 시 규칙 밖 파일 8개 | CI·테스트는 통과했었음 |

### C1 — 잘못된 사실 주장을 코드로 옮긴 경우

- [사실] 제안 패치는 한 줄(`res.json` → `res.set('Cache-Control','no-store').json`)이다. 적용하면 Gate가 FAIL하고 OpenAPI 3개와 API 회귀 테스트 변경을 요구한다. 그러나 이 수정은 동작을 바꾸지 않는다.
- [사실] 이 요구는 만족시키기 어렵다. 3개 OpenAPI 파일은 `spec:check`가 생성기 출력과 일치해야 하므로 계약이 바뀌지 않으면 변경할 방법이 없다. 정책은 `allow_ignore: false`라 우회도 막혀 있다(§5 E1에서 정책 조정안을 시험).
- 해석 [의견]: Gate는 "근거 없이 route 파일을 건드리는 수정"에 마찰을 만들어 주지만, 변경이 틀렸는지는 판단하지 못한다. 틀림을 가린 것은 기존 테스트와 미들웨어 확인이었다.

### C2 — 근거 없는 제안

- [사실] 첫 실패 원인은 `POST /-/npm/v1/security/audits/quick`의 `400 Invalid package tree`이고 같은 커밋 재실행은 통과했다. npm 버전을 올리면 해결된다는 근거는 로그에 없다.
- [사실] 채택된 대안은 재시도 래퍼다. `c217502` 시점에는 실제 npm 출력에 `error.code`가 없어 재시도가 작동하지 않았다. 현재 head에서는 실제 출력 3종(400 Invalid package tree, 503, 연결 거부)이 모두 `retry`로 분류된다(`evidence/results/npm-audit-real-output-*.json`).
- Gate: 적용 시 `quality-contract`가 `docs/quality-gates.md` 변경을 요구한다. 이 경우 요구는 합리적이다.

### C3 — 보호 규칙을 약화하는 제안

패치: `server/tourism-matching.ts`의 별칭 변경 검사 목록에서 `contentSha256`을 제거(`evidence/cases/c3-relax-alias.patch`).

| 단계 | Gate | 별칭 테스트 |
|---|---|---|
| C3a 현재 정책 | **PASS**, `scope=no-matching-rule` | 3 failed / 30 passed |
| C3b 연결 보호 규칙이 있는 정책(제안), 코드만 변경 | FAIL | - |
| C3c 같은 코드 + 테스트에 주석 한 줄, 문서에 빈 줄만 추가 | **PASS** | 3 failed / 30 passed |

- [사실] 실패한 테스트: `fails closed after source identity/content changes`, `keeps an alias unlinked after a new CSV hash...`, `explains a rejected alias without weakening the matching rule: ALIAS_SOURCE_CHANGED`.
- [사실] 현재 정책에서는 보호 코드가 약화되어도 Gate는 아무 반응이 없다. 규칙을 추가하면 코드만 바꾼 경우는 막지만, 형식적 동반 변경(C3c)으로 통과한다.
- 해석 [의견]: `content: paths`는 "파일이 바뀌었는가"만 보므로 약화를 막는 장치는 테스트다. Gate 규칙은 변경 시 검토자에게 증거를 요구하는 용도로만 의미가 있다.

### C5 — 문서 없이 말로만 나온 주장

실제 DB(`searchTourism`)에서 발행한 시설 근거를 철회한 뒤 각 조작을 하고 검색 노출을 확인했다(`evidence/results/probe-withdrawal.json`).

| 조작 | 검색 노출 |
|---|---:|
| 발행 직후 | 노출 |
| 철회 도구 실행 후 | 숨김 |
| **`withdrawal` 행만 삭제 (AI 주장)** | **숨김 (주장 반증)** |
| `withdrawal` 행 삭제 + `record.withdrawn_at` 초기화 | 노출 |
| 대조: `record.withdrawn_at`만 초기화(행 유지) | 숨김 |

철회 해제는 두 상태를 함께 바꿔야 한다. 이것을 하나의 절차로 제공하는 도구는 아직 없다(§6 F10).

### C4 — Gate도 CI도 통과했던 실제 결함

- [사실] `c217502`는 `%` 포함 URL을 전부 거절해, 실제 후라노 URL 두 개가 정제와 발행에서 막혔다. 당시 CI는 통과했다(fixture가 ASCII 파일명이었다).
- [사실] 현재 정책을 그 diff에 소급 적용하면 FAIL하지만 이유는 `quality-contract`(CI·package.json 변경) 하나뿐이다. 결함이 있던 `server/tourism-source-policy.ts`, `scripts/tourism/source_policy.py`, `server/tourism-knowledge.ts`, `server/tourism-matching.ts` 등 관련 8개 파일은 어떤 규칙에도 걸리지 않았다.
- [사실] 현재 head에서 허용·거절 22개 사례(UTF-8 인코딩 허용, `%2e%2e`, `%2f`, `%5c`, 이중 인코딩, 사용자 정보, 쿼리, 비ASCII 원문 등)가 TS와 Python에서 모두 기대대로이고 서로 일치한다(`evidence/scripts/parity.ts`).

### 4.1 사례가 보여 주는 계층별 역할 [사실·의견]

| 위험 | Drift Gate | 단위·DB 테스트 | 독립 프로브 |
|---|---|---|---|
| 코드 변경 때 문서·테스트 파일 누락 (C1, C2, E2) | 잡음 | - | - |
| 보호 규칙 약화 (C3) | 규칙 밖이면 못 잡음 | 잡음 | - |
| 형식적 동반 변경 (C3c, E2) | 못 잡음 | 동작은 잡음 | - |
| 거짓 사실 주장 (C1, C5) | 해당 없음 | 기존 테스트 일부 | 실제 응답·DB로 반증 |
| 실제 입력과 다른 fixture (C4) | 못 잡음 | 못 잡음 | 실제 URL·npm 출력으로 잡음 |
| 정책 자기 약화 (C6) | 못 잡음 | - | - |

---

## 5. 정책·도구 실험 결과

### E1 — `min_change_intensity` 조정 [사실]

`api-contract`의 `when`에 `min_change_intensity: route-contract-change`를 추가했다.

| 변경 | 결과 |
|---|---|
| E1a 헤더 한 줄(구현만) | PASS (규칙 미적용) — C1 문제 해소 |
| E1b 새 라우트 추가 | FAIL (OpenAPI·테스트 요구) — 탐지 동작 |
| E1c **응답 JSON에 필드 추가** | **PASS (규칙 미적용)** — 문서 누락 가능 |

- [의견] 강도 조정은 구현 전용 수정 마찰을 줄이지만 응답 형태 변경을 놓친다. 이를 보완하려면 구현 전용 변경은 MINOR로 경고하고(현재 `fail_on_major_count: 1`이라 MINOR는 실패하지 않음), 응답 형태는 `spec:check`와 API 회귀 테스트가 막는 구성이 필요하다.

### E2 — 라우트 이름 변경과 OpenAPI 동반 변경 [사실]

`/ai-recommendations` → `/ai-recs`를 코드와 생성기에서 바꾸고 OpenAPI를 재생성했다.

| 변경 | `content: paths` (현재) | `content: api-routes` |
|---|---|---|
| 코드만 변경 | FAIL | FAIL |
| 코드 + 재생성한 OpenAPI + 테스트 변경 | PASS | **FAIL (올바른 문서를 거절)** |
| 코드 + OpenAPI에 설명 문자열만 수정 | **PASS (형식적)** | FAIL |

- `api-routes`는 중첩 OpenAPI JSON/YAML(Book해도의 생성본)에서 올바른 문서도 거절했다. 도구 README가 "여러 줄 라우트와 중첩 OpenAPI YAML 등은 지원 범위와 한계를 확인하라"고 안내하는 부분과 일치한다.
- `paths`만 쓸 수 있고, 형식적 수정이 통과한다. 실제 방어는 CI의 `spec:check`(생성기 출력과 파일 일치)다.
- [의견] Book해도에서 의미 있는 동반 변경 대상은 생성본 3개가 아니라 사람이 편집하는 `scripts/write-api-spec.mjs`다. 규칙의 요구 그룹을 생성기 파일 중심으로 바꾸는 방안이 있다(검증하지 않음).

### E3 — `env-keys` 규칙 [사실]

| 변경 | 결과 |
|---|---|
| E3a 서버 코드에 새 환경변수 읽기, `.env.example` 미변경 | FAIL |
| E3b 같은 변경 + `.env.example`에 키 추가 | PASS |
| E3c 기존 `API_RATE_LIMIT` 읽는 줄의 공백만 수정 | PASS (규칙 미적용) |
| E3d 같은 줄의 기본값 `300` → `500` 변경 | PASS (규칙 미적용) |

신규 키 탐지는 동작하지만, 이미 누락된 키는 diff 기반이라 보이지 않는다. 실제 누락은 head에 있다(§6 F6).

### C6 — PR이 정책을 약화하는 경우 [사실]

`.drift-gate.yml`에서 `api-contract` 규칙을 삭제하고, 문서 없이 route 파일을 수정한 변경이다.

| 평가에 쓴 정책 | 결과 |
|---|---|
| 정책 변경 + route 수정 (문서 미변경) | FAIL — `.drift-gate.yml`이 `quality-contract` 트리거라서 |
| 같은 변경 + `docs/quality-gates.md`에 한 줄만 추가 | **PASS** (`configured rules=5`) |
| **같은 변경을 기준 커밋의 정책으로 평가** | **FAIL** (`api-contract` 미충족) |

- wrapper는 작업 트리의 `.drift-gate.yml`을 읽는다(코드로 확인). Action은 `policy_file` 입력(기본값 `.drift-gate.yml`)을 받는데, 일반적인 PR 체크아웃에서는 PR 쪽 파일을 읽게 된다고 추정한다 **[미검증: Action 경로는 실행하지 않음]**. 도구의 CLI·Action·문서에서 `policy-ref`, `base-policy` 등 기준 ref에서 정책을 읽는 옵션은 검색되지 않았다.
- Book해도 `docs/quality-gates.md`는 CI 연결 시 기준 정책 분리가 필요하다고 이미 적어 두었다. 이 실험이 그 필요성을 재현으로 확인했다.

---

## 6. `91aaa28` 전체 재검토

### 6.1 로컬 재현으로 확인한 사항 [사실]

| 항목 | 보고 | 직접 실행 |
|---|---|---|
| 원격 CI [run 37422040073](https://github.com/cres17/bookhaedo/actions/runs/37422040073) | 통과 | head `91aaa28`에 대한 1차 시도 `success`를 GitHub Actions 기록에서 확인 |
| `test:ci` (빈 DB) | 49개 파일 403개 | **49개 파일 403개 통과** |
| Python | 34개 | **34개 통과** |
| 정적 검사·마이그레이션·build | 통과 | lint·format·typecheck 오류 없음, 새 DB 마이그레이션 통과, build 성공 |
| OpenAPI / DBML | 45 paths / 29 tables | 일치 |
| 관광 E2E 3개 파일(CI와 동일) | 통과 | **6개 통과**(1440px·390px, 복구 E2E 포함) |
| 문서화된 58개 OpenAPI 작업의 실제 등록 | - | **58/58 등록** (미등록 0) |

### 6.2 이전 지적 2건의 해결 [사실]

| 항목 | 이전 상태 | 현재 |
|---|---|---|
| 후라노 URL 거절 (`c217502`) | 정제·발행 모두 거절 | 허용·거절 22개 사례가 TS/Python에서 일치 |
| 감사 재시도 분류 | 실제 npm 출력을 모두 `fail`로 분류 | 400 Invalid package tree, 503, 연결 거부 모두 `retry` |

### 6.3 결함과 개선점

**F1 [중간·사실·재현] 확인 GET이 늦게 성공하면 일정이 갱신되지 않는다**

`DayAlternatives.vue`의 `checkSavedState()`는 성공 시 `if (isCurrent(command)) emit('refresh', snapshot.data)`로 스냅샷을 현재 화면에만 전달하고, `isCurrent`와 무관하게 `recommendationRecovery.complete(command)`로 복구 표시를 지운다. 확인 요청 중 다른 날짜로 이동하면 스냅샷이 버려지고 표시만 사라진다.

실제 브라우저로 재현했다(`evidence/scripts/zz-late-check.spec.ts`, 결과 `probe-late-check.json`).

1. 응답 유실 저장(서버에는 커밋) → 복구 표시 생성
2. "현재 일정 확인" GET을 보류한 채 다른 날짜 탭으로 이동, GET 해제
3. 복구 표시는 제거됨, 서버 기준 1일차는 `복구 시설 2·3·4`
4. 1일차로 돌아오면 화면은 **`복구 시설 0·1`(이전 상태)**, 경고 없음

- [사실] 설계 문서(`recommendation-recovery.md`)는 "확인 성공: … 해당 응답을 부모 화면에 직접 전달한다"고 하지만 현재 날짜가 아닐 때의 동작은 정의되어 있지 않다. 같은 파일의 늦은 *저장 성공* 경로는 `succeeded()`로 부모를 갱신하고 E2E가 이를 검증한다. 늦은 *확인 성공* 경로만 빠져 있다.
- [의견] 영향은 표시 불일치다. 서버의 revision·장소 순서 검사로 덮어쓰기는 막힐 것으로 보이나 후속 저장을 시도해 보지는 않았다 **[미검증]**.
- 수정 방향 [의견]: 확인 성공도 `succeeded`처럼 사용자·여행 단위 갱신 신호를 올려 Planner가 재조회하게 하거나, 스냅샷이 부모에 적용되기 전에는 표시를 지우지 않는다. 위 프로브를 회귀 E2E로 전환한다.

**F2 [중간·사실] 정책 자기 약화가 통과한다** — §5 C6. Gate를 CI에 붙이기 전에 기준 ref의 정책으로 평가해야 한다.

**F3 [중간·사실] `api-contract`가 구현 전용 수정에도 만족시킬 수 없는 요구를 건다** — §4 C1, §5 E1. `server/routes/**` 전체가 트리거이고 생성본 3개 전부 변경을 요구한다. E1의 한계(E1c)까지 고려한 조정이 필요하다.

**F4 [중간·사실] 정책이 소스 대부분을 보지 않는다**

- 트리거가 될 수 있는 소스 파일은 172개 중 29개(17%)다(`server/` 15/66, `frontend/src/` 3/48, `scripts/` 2/40, `ops/` 0/5, `db/` 8/10, `shared/` 1/3; 기준: `91aaa28` 트리 중 `server/ shared/ scripts/ ops/ db/ frontend/src/`, 파이썬 테스트 제외).
- 관광·Valhalla·감사 관련 26개 파일(`server/tourism-*.ts`, `server/valhalla-*.ts`, `scripts/tourism/*`, `scripts/audit-dependencies.mjs`, `ops/tourism/*.json`)은 전부 규칙 밖이다. 승인 범위·별칭·출처 정책을 담은 `ops/tourism/*.json`도 포함된다.
- [의견] C3·C4처럼 승인·보호·허용 목록을 다루는 파일에 `any_changed` 규칙과 필수 테스트를 연결하는 것이 가장 비용 대비 효과가 크다. 단 C3c가 보여 주듯 이 규칙은 검토 유도 장치일 뿐이다.

**F5 [낮음·사실] `content: paths`의 형식적 충족** — C3c, E2. 방어는 `spec:check`와 동작 테스트에 있다는 점을 `docs/quality-gates.md`가 이미 밝히고 있어 문서와 일치한다.

**F6 [낮음·사실] `API_RATE_LIMIT`이 어디에도 문서화되지 않았다.** `server/http/rate-limit.ts:100`에서 읽고 `server/config.ts:21-22`에서 검증하는 운영 설정이지만 `.env.example`, `docs/*.md`, `README.md`에 없다. 정규식으로 점검한 결과, `server/ shared/ scripts/`가 읽는 키 17개 중 `.env.example`에 없는 것은 4개(`API_RATE_LIMIT`, `LOG_LEVEL`, `ALLOW_REMOTE_LOAD_TEST`, `APIFY_API_TOKEN`)이고 `API_RATE_LIMIT`을 뺀 3개는 스크립트 전용이다. 키를 추가하고 `env-keys` 규칙(E3a·E3b에서 동작 확인)을 도입하되, 기존 누락은 diff 기반으로 보이지 않으므로(E3c·E3d) 일회성 점검이 필요하다.

**F7 [낮음·사실] CI 테스트 목록이 수동 관리다.** `tests/*.test.ts` 55개 중 49개만 `test:ci`에 있고 제외 6개(`admin`, `api`, `collaboration`, `day-alternatives`, `place-search`, `weather-alternatives`)는 catalog 의존으로 문서화돼 있다. 새 테스트 파일이 목록에서 빠져도 알려 주는 장치가 없다(작성자도 후속 작업으로 기록). "모든 테스트 파일은 목록 또는 명시적 제외 목록에 있어야 한다"는 점검 테스트를 권한다 **[의견]**.

**F8 [낮음·사실] 커밋된 검증 산출물이 많다.** `docs/research`는 150개 파일, 3.1MB로 저장소 전체(470개, 7.1MB)의 약 44%다. 마지막 커밋에서만 88개 파일, 11,097줄이 추가됐다. 이번 Gate 실행에서 스캔된 104개 파일 중 88개가 `docs/research` 파일이었고, JSON 보고서의 `analysis_notes` 104개 중 96개가 "문법 분석기 없음" 항목이다. 이 파일들이 변경되는 PR마다 같은 노이즈가 생긴다. 원시 로그는 CI 아티팩트나 릴리스 첨부로 옮기고 요약만 두는 편이 낫다 **[의견]**.

**F9 [참고·사실] 문서-코드 라우트 점검이 부분적이다.** `api-contract.test.ts`의 정규식은 `app|healthRoutes|aiRecommendations`로 선언한 리터럴 `'/api…'` 라우트만 본다. 제 근사 계산으로는 코드의 리터럴 `/api` 등록 31개 중 29개를 보고, 문서화된 58개 작업 중 27개는 리터럴 등록으로 찾을 수 없다(서브 라우터로 등록된 것으로 보임). 실제 드리프트는 없다(런타임 프로브 58/58 등록, `evidence/scripts/zz-openapi-probe.test.ts`). 그 프로브를 정식 테스트로 채택하면 문서→코드 방향이 전부 보호된다. 코드→문서 방향은 완전히 검증하지 못했다 **[미검증]**. 메서드별 등록 수는 문서 58, 코드 60이며 차이 2개 중 1개는 `/internal/metrics`이고 나머지 1개는 확인하지 않았다.

**F10 [참고·사실] 남은 계약 공백.**
- 철회 해제 절차 없음(§4 C5). 현재는 `withdrawal` 행과 `record.withdrawn_at`을 모두 수동으로 바꿔야 한다.
- `commandId`는 서버로 전송되지 않는다. 복구는 현재 일정 GET에 의존하며 서버 idempotency는 없다(문서가 범위 밖으로 명시).
- 복구 모듈은 `crypto.randomUUID()`를 쓴다. 보안 컨텍스트(HTTPS 또는 localhost)에서만 있으며, 운영은 HTTPS 필수이므로 영향은 작다 **[의견]**.
- `commandState`가 계산 속성 안에서 `hydrate()`로 반응형 맵을 수정한다. E2E는 통과하고 `pageerror`는 없었지만 Vue 경고 로그는 확인하지 않았다 **[미검증]**.

---

## 7. Drift Gate 도구 개선 제안 (`pr-convention-checker`)

| # | 제안 | 근거 |
|---|---|---|
| T1 | 기준 ref에서 정책을 읽는 옵션(`--policy-ref <ref>` 및 Action 입력)과, 정책 변경 자체를 별도 위반으로 보고 | §5 C6: 정책 약화가 통과, 기준 정책으로 평가하면 차단 |
| T2 | `report.md`에 규칙별 표(pass/fail/unmatched, 트리거 파일)를 넣고 "All configured policy rules passed" 문구는 미적용 규칙이 있으면 쓰지 않기 | §3.4 |
| T3 | 위반 `message` 채우기. `content: paths`임을 보고서에 명시해 "파일이 바뀌었음만 확인" 한계를 알리기 | §3.4, C3c, E2 |
| T4 | 변경 diff와 무관한 저장소 전체 환경변수 점검 모드 | E3c·E3d, F6 |
| T5 | 생성된 중첩 OpenAPI에서 `api-routes`가 올바른 문서를 거절하는 문제 해결, 또는 지원 불가를 보고서에서 안내 | E2 |
| T6 | 도구 문서의 `route-contract-change` 정의가 두 곳에서 다르다(`docs/detector-guide.md`의 신호 표는 "sdk/client 공개 export", 강도 표는 "route handler 또는 schema 변경"). 구현 기준으로 통일 | 문서 대조 |
| T7 | `analysis_notes`에서 "문법 분석기 없음"을 요약 건수로 접어 노이즈 줄이기 | F8, 보고서 JSON |
| T8 | (아이디어) 거절한 AI 제안을 근거와 함께 기록하는 결정 로그 형식 지원 | §4 전체: 현재는 거절 이유가 대화에만 남음 [의견] |

---

## 8. 권장 우선순위 [의견]

| 순위 | 작업 | 크기 | 비고 |
|---|---|---|---|
| P0 | F1 수정 + E2E 회귀 | 작음 | 사용자에게 보이는 불일치 |
| P0 | Gate를 CI에 붙이기 전 기준 정책 분리(F2, T1) | 중간 | 지금은 로컬 전용이라 노출은 작음 |
| P1 | `api-contract` 강도·요구 그룹 조정(F3), 관광·승인 파일 규칙 추가(F4) | 중간 | 먼저 소규모로 검증 |
| P1 | `API_RATE_LIMIT` 문서화와 `env-keys` 규칙(F6) | 작음 | |
| P2 | 테스트 목록 점검(F7), 런타임 라우트 프로브 채택(F9), 산출물 정리(F8) | 작음~중간 | |
| P2 | 철회 해제 절차, 서버 idempotency, 도구 개선 T2~T7 | 큼 | 범위 결정 필요 |

---

## 9. 한계

- 모든 실험은 로컬 일회용 복제본과 빈 catalog DB, 고정된 단일 도구 버전(`01e28e1`)에서 했다. 다른 정책이나 큰 diff에서의 동작은 일반화할 수 없다.
- Gate의 GitHub Actions 경로, Windows/macOS 앱, optional LLM 판정은 쓰지 않았다.
- C3b·C3c의 "연결 보호 규칙"과 E1·E2·E3의 정책 변경은 제 제안이며 Book해도에 적용된 것이 아니다. 시험 결과는 규칙이 의도대로 동작한다는 것만 보여 준다.
- 사례의 AI 제안은 같은 AI가 낸 것이므로 선택 편향이 있을 수 있다.
- F1은 한 시나리오(저장 응답 유실 → 확인 지연 → 날짜 전환)에서만 재현했고 다른 경로(패널 닫기, 여행 이동)는 코드 읽기 기반이다 **[미검증]**.
- 프로브 JSON의 첫 항목 `0 day1 items before save: []`는 렌더링 전에 읽은 값이라 의미가 없다(이후 항목과 판정에는 영향 없음).

---

## 10. 증거 파일

| 경로 | 내용 |
|---|---|
| `evidence/cases/*.patch` | C1·C2·C3 패치(`91aaa28` 기준) |
| `evidence/results/case-results.json` | C0~C4 Gate 판정과 동작 테스트 결과 |
| `evidence/results/case-results2.json` | E1~E4 정책·내용 모드·도구 버전 비교 |
| `evidence/results/case-results3.json`, `case-results4.json` | C6 정책 자기 약화, E1c 응답 형태 변경 |
| `evidence/results/policy-coverage.json` | 규칙 트리거 커버리지(172개 중 29개) |
| `evidence/results/head-gate-report.md`, `head-gate-decisions.json` | head 실행 보고서와 규칙별 판정(분석 노트 제외) |
| `evidence/results/author-controls-rerun.json` | 작성자 대조군 8개 재실행 결과 |
| `evidence/results/probe-*.json` | 철회 주장 반증(C5), 늦은 확인 재현(F1), OpenAPI 58/58 등록 프로브 |
| `evidence/results/npm-audit-real-output-*.json` | 가짜 레지스트리로 재현한 실제 `npm audit --json` 출력 3종 |
| `evidence/scripts/` | 케이스 실행기(`run_cases*.py`), 브라우저·DB 프로브, URL 정책 비교(`parity.ts`), 가짜 레지스트리 |

`run_cases*.py`는 첫 인자로 작업 폴더를 받으며, 그 안에 `bookhaedo-head`(`91aaa28` worktree), `tool-pinned`(도구 `01e28e1` worktree), `venv`가 있어야 한다. 프로브 테스트는 해당 복제본의 `tests/` 아래에 두고 실행했다. 경로는 이 세션 기준이므로 다른 환경에서는 조정이 필요하다.
