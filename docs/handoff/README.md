# Snakeball — 출시 전 작업 인계 패키지

> 스토어 제출 **전에** 끝내야 하는 7건. 전부 코드 작업이고, 콘솔/크레덴셜은 없다.
> 각 `TASK-*.md` 는 단독 실행 가능한 지시서다 — 그대로 복사해 Gemini 등에게 주면 된다.

## 시작하기 전에

1. **[RULES.md](RULES.md) 를 먼저 읽는다.** 건드리면 안 되는 것(머니패스·안티치트 상한·
   마이그레이션 컷오프·Firestore 룰)과 `index.html` 의 모듈 2개 스코프 함정이 있다.
2. 작업 브랜치를 판다. `main` 은 이미 프로덕션에 배포된 상태다.
3. **한 번에 한 태스크.** 각 태스크의 검증을 그 자리에서 돌리고 다음으로 넘어간다.

## 왜 이 7건인가

전부 **지금이 아니면 못 하거나(소급 불가), 지금 안 하면 손해가 누적되는** 것들이다.

| # | 태스크 | 한 줄 이유 |
|---|---|---|
| T1 | 세션에 platform/appVersion | 4개 채널 동시 출시. **백필 불가** — 나중엔 날짜로만 구분됨 |
| T2 | 세션에 검증된 런 통계 | "얼마나 오래" 말고 **"어떻게 갔는지"**. 역시 소급 불가 |
| T3 | 난이도 전환 스폰 버스트 | 첫 2분 안에 6번 발생하는 **확실한 결함**. 3줄 |
| T4 | 죽은 부활 화면 | 광고 OFF + 젬 0 = **매 런 끝 의미 없는 탭 + 1.5초 지연** |
| T5 | 데일리 스트릭 KST/UTC | 클라가 "Day 7" 띄우고 서버는 Day 1 지급. **5줄** |
| T6 | deleteMyData 가 세션 미삭제 | 개인정보처리방침이 약속한 삭제와 불일치. **심사 리스크** |
| T7 | game_sessions 읽을 수단 | 데이터를 모으는데 **꺼낼 방법이 없다** |

> 게임플레이 개선(연속 드래그·펜타토닉·바이옴·탤런트 트리 등)은 **여기 없다.** 그건 출시
> 후 데이터를 보고 정하는 게 맞다. 판단 근거는 `docs/ADDICTIVE_GAMEPLAY_IMPROVEMENT_PLAN.md`
> 와 그에 대한 검토 결과 참조.

---

## 1. 실행 순서

한 번에 한 태스크만. **각 태스크의 자체 검증을 그 태스크 편집 직후에 돌린 뒤** 다음으로 넘어간다 (그래야 각 스펙의 before/after 기준선이 유효하다).

| # | 태스크 | 파일 | 이 순서인 이유 |
|---|---|---|---|
| 0 | 준비 | — | `git status --porcelain` 이 `?? docs/…` 만 나오는지 확인. 브랜치 생성. |
| 1 | **T7** | `firestore.indexes.json` + 새 스크립트 | 공유 파일 0개. 인덱스 빌드가 비동기라 **제일 먼저 배포**해 두면 나머지 작업 중에 빌드된다. |
| 2 | **T2** | `functions/index.js` → `index.html` | **functions/index.js 편집 중 반드시 1순위.** T2의 CHECK 1은 절대 문자 오프셋(`7359/7710/9106`)을 검사하는데, T1·T6이 먼저 들어가면 오프셋이 밀려 무조건 FAIL 난다. |
| 3 | **T1** | `functions/index.js` + `index.html` | T1의 클라 앵커(startRun, 1730-1740)가 T2 클라 앵커(submitScore, 1742-)의 **바로 위 2줄**. T2를 먼저 넣어야 T2가 인용한 위쪽 컨텍스트가 원본 그대로 잡힌다. |
| 4 | **T6** | `functions/index.js` | edit A가 19행 `require` 라 파일 전체 줄번호를 +1 민다. functions 편집 중 **마지막**. |
| 5 | **T3** | `index.html` (script #2, 게임 로직) | 이후는 index.html 전용. 서로 독립. |
| 6 | **T5** | `index.html` (script #1, SB 레이어) | |
| 7 | **T4** | `index.html` 9훅 | 훅이 가장 많고 사망/부활 흐름을 가장 크게 바꾼다. 마지막에 넣어 다시 밀리지 않게. |

---

## 2. 충돌

### 실제 텍스트 겹침: **없음** (전 훅 좌표 확인함)

| 파일 | 태스크별 영역 (원본 기준) | 겹침 |
|---|---|---|
| `functions/index.js` | T6-A 19 / T1 102-128 / T2 139-269 / T6-B 650-676 | 없음 |
| `index.html` | T4-A 657·T5-1 683·T4-B 736·T4-C 1235·T5-2 1301·T5-3 1518·**T1 1730-1740·T2 1743-**·T5-4 1799·T4-D 2502·T3 3158·T3 3633·T4-E 3992·T4-F 4009·T4-G 4058·T4-H 4070/4121·**T2 4402**·T3 4533·**T2 4636·T4-I 4666** | 없음 (최근접: T1↔T2 2줄, T2↔T4-I 같은 `finalizeGameOver()` 안 25줄 간격) |

### 위험 3개와 회피법

1. **줄번호는 첫 태스크가 끝나는 순간 전부 무효.** 각 스펙의 "line ~NNNN" 은 **pristine 파일 기준 힌트일 뿐**이다. 규칙: 편집 위치는 **항상 verbatim 문자열 검색**으로 찾는다. 붙여넣기 전에 반드시
   `grep -cF -- "<앵커 첫 줄>" <파일>` → **정확히 1** 이어야 한다. 1이 아니면 중단(§5).
2. **T2의 절대 오프셋 검사.** 위 순서(T2 먼저)를 지킬 것. 전부 끝난 뒤 재확인할 때는 절대값 대신 **순서 불변식**으로만 검사한다:
   `indexOf('score > maxAllowed') < indexOf('runRecordedAt')` → PASS. (하드 제약: 텔레메트리 쓰기는 반드시 상한 체크 **뒤**.)
3. **`finalizeGameOver()` 공유.** T2가 `SB.submitScore(...)` 인자에 `runStats` 를 추가하고, T4-I가 25줄 아래 `setTimeout(…, 1500)` → `700` 으로 바꾼다. 서로 다른 문장이니 안전하지만, T4 훅 I를 넣을 때 **`submitScore` 가 들어간 줄은 건드리지 말 것**.

---

## 3. 배포 묶음 — 총 **3회** (네이티브 리빌드 0회)

| 순번 | 시점 | 명령 | 커버 |
|---|---|---|---|
| D1 | 1단계 직후 | `firebase deploy --only firestore:indexes` | T7 |
| D2 | 4단계 직후 | `firebase deploy --only functions:startRun,functions:submitScore,functions:deleteMyData` | T1·T2·T6 |
| D3 | 7단계 + 게이트 통과 후 | `npm run deploy:web` | T1c·T2c·T3·T4·T5 (sync:public 포함) |

- **순서 고정**: functions(D2) → hosting(D3). 반대로 하면 신규 필드를 무시하는 구서버에 잠깐 붙는다.
- **절대 금지**: 맨몸 `firebase deploy --only functions` (머니패스 `verifyAndFulfillPurchase`/`coinSystem` 전량 재배포 + 콜드스타트), `firebase deploy --only firestore` (rules까지 밀어버림).
- **rules 배포 없음.** `deploy:web` 이 변경 없는 rules를 재푸시하는 건 정상.
- **네이티브 리빌드 없음** — iOS/Android 셸은 호스팅 URL 로드. 스토어 심사 불필요.
- 선택: Toss 텔레메트리(`platform:"toss"`)를 원하면 D3 뒤 `npm run toss:build && npm run toss:deploy`.

---

---

## 5. 중단 조건 (사람에게 물어라)

즉시 STOP:

1. **앵커가 정확히 1개가 아니다** — 단, **지시서가 인용한 블록 전체**로 셀 것. 한 줄만 떼서
   세면 오탐이 난다(T5 의 `yesterday` 줄은 파일에 2번 나오지만, SITE 2/3 블록 전체로는
   각각 1개다). 블록 전체 `grep -cF` 가 0 또는 2+ 면 중단. 절대 "비슷한 곳"에 넣지 말 것.
2. **`git status` 에 `functions/coinSystem.js` / `functions/iapVerification.js` / `firestore.rules` 가 뜬다** — 머니패스·보안 규칙. `git checkout --` 로 되돌리고 보고.
3. **검증을 통과시키려고 상수를 바꿔야 할 것 같다** — `MIGRATION_CUTOFF_MS`, `MAX_SCORE_PER_SEC`, `BASE_BUFFER`, `MAX_CREDITED_SECONDS`, `firestore.rules` 의 `allow write: if false`. 이 중 어떤 것도 이번 7건에서 바뀌지 않는다.
4. **§4 [6] 이 `FAIL ORDER`** — 텔레메트리 쓰기가 상한 체크 앞에 들어갔다. 치트 점수가 기록된다.
5. **`node --test` 가 fail > 0**, 또는 `--selftest` exit ≠ 0.
6. **인덱스 배포가 삭제 확인을 묻는다** — `Would you like to delete these indexes?` / `…field overrides?` **둘 다 N**. 내가 추가하지 않은 인덱스나 TTL을 지우겠다고 하면 N 후 중단.
7. **functions 배포가 secret(`APP_STORE_*`, `GOOGLE_PLAY_*`, `TOSS_*`) 관련 에러**를 낸다.
8. **L1 이후 정상 플레이에서 `failed-precondition`** 이 뜬다 — 안티치트 회귀.

**STOP 아님 (이미 알려진 스펙 오류 — 고치지 말 것):**

| 현상 | 실제 |
|---|---|
| T3 `grep -c "patternIndex"` 가 0이 아니라 **3** | 교체 코드의 한글 주석에 그 단어가 3번 들어있다. 정상. |
| T6 `grep -c 'orderBy'` 가 0이 아니라 **1** | 주석에 있음. `grep -c '\.orderBy('` 로 봐야 0. |
| T4 gem 업셀이 **웹에서 안 뜬다** | `gemsPurchasable()` 은 웹/토스에서 항상 false. 설계대로다. **절대 웹에서 true 로 고치지 말 것** (상점 store 탭이 웹에선 "coming soon" 이라 막다른 길이 된다). 확인은 DevTools에서 `SB.gemsPurchasable = () => true` 로 임시 오버라이드. |
| T2 CHECK 4, T1 step 2 가 편집 **전에도 통과** | before/after 판별용이 아니라 회귀 가드다. |
| heredoc(`<<'EOF'`)이 안 끝나고 셸이 멈춤 | 종료자 `EOF` 가 들여쓰기됐다. **0열**로 옮길 것. |
| `python3 -m http.server 8799` 에서 셸이 멈춤 | 백그라운드로: `... & echo $!` 후 끝나면 `kill`. |

---

## 최종 검증

7개가 전부 끝나면 **[VERIFY.md](VERIFY.md) 를 처음부터 끝까지** 돌린다.
그게 통과해야 D3(호스팅) 배포다.
