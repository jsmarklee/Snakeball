# 작업 규칙 — 누가 작업하든 먼저 읽을 것

> 이 폴더의 `TASK-*.md` 는 **기계적으로 실행 가능한 작업지시서**다. 각 파일은 단독으로
> 완결돼 있어 그대로 복사해 Gemini 등에게 붙여넣으면 된다.
> **이 문서는 그 전에 반드시 읽어야 하는 공통 규칙이다.**

---

## 0. 이 프로젝트가 지금 어떤 상태인가

- **백엔드가 이미 프로덕션에서 라이브**다. Cloud Functions·Firestore 룰·호스팅 전부 실서비스.
- 스토어에는 **아직 제출 전**. 유일한 코드 외 블로커는 Android 릴리스 키스토어(오너 전용).
- 즉 **여기서 잘못 건드리면 실사용자에게 바로 나간다.** 실험은 로컬에서.

---

## 1. 절대 건드리지 말 것 (Hard Gate)

아래를 바꿔야 할 것 같으면 **작업을 멈추고 사람에게 물어라.** 작업지시서에 명시되지 않은 한 손대지 않는다.

| 대상 | 위치 | 이유 |
|---|---|---|
| `MIGRATION_CUTOFF_MS` | `functions/coinSystem.js:31` | 경제 마이그레이션 컷오프. **올리면 신규 계정이 무료 코인 임포트 대상이 된다.** 주석에 "배포 직전 갱신"이라 써 있지만 그건 최초 1회용이고 이미 끝났다 |
| `MAX_SCORE_PER_SEC` / `BASE_BUFFER` / `MAX_CREDITED_SECONDS` | `functions/index.js:55,62,66` | 리더보드 안티치트 상한. 느슨하게 하면 위조 1위, 조이면 정상 플레이어가 거부된다 |
| `MISSIONS_PER_DAY` | `functions/coinSystem.js:37` | 클라가 뽑는 데일리 미션 개수와 짝. 어긋나면 정상 유저가 미션을 못 받는다 |
| `firestore.rules` 의 `users/{uid}` | `allow write: if false` | **의도된 것.** 클라이언트는 Firestore 에 문서를 단 한 번도 쓰지 않는다. 열면 무료 코인·닉네임 모더레이션 우회가 재발한다 |
| `functions/iapVerification.js` 전체 | — | 결제 영수증 검증. 상수/추가 필드 외 구조 변경 금지 |
| `grantRunCoins` 및 그 호출부 | `functions/coinSystem.js`, `index.js` | 코인 지급 경로 |

### 순서가 중요한 곳 (틀리면 치트가 통과한다)

`functions/index.js` 의 `submitScore` 는 이렇게 흐른다:

```
1) 세션 트랜잭션 — used:true 로 마킹 (리플레이 방지)
2) 안티치트 상한 검증 — score > maxAllowed 면 throw
3) 리더보드/users 갱신 + 코인 지급
```

**세션에 무언가를 기록하는 코드는 반드시 (2) 이후에 넣는다.** (1) 단계의 트랜잭션 안에
넣으면 **검증에 실패한 위조 점수도 기록된다.**

---

## 2. 파일 구조 (index.html 이 특이하다)

`index.html` 은 5,440줄짜리 단일 파일이고 **`<script type="module">` 이 두 개**다:

| 블록 | 줄 범위(대략) | 내용 | 주의 |
|---|---|---|---|
| script #1 | 626 ~ 2531 | `window.SB` — 경제·브리지·상점/미션/데일리 UI, Firebase | `load()`/`save()`/`state` 가 여기 산다 |
| script #2 | 2556 ~ 5438 | 게임 — Three.js 씬, 루프, 충돌, 부활/결과 | **script #1 의 지역 함수를 못 쓴다** |

> ⚠️ **두 블록은 스코프가 분리돼 있다.** script #2 에서 `load()`/`save()` 를 부르면
> `ReferenceError` 다. 실제로 이 실수가 한 번 났다 — script #2 에서는
> `localStorage` 를 직접 쓰거나 `window.SB` / `window.__xxx` 브리지를 통해야 한다.

> ⚠️ **줄 번호는 편집이 쌓이면 밀린다.** 작업지시서의 줄 번호는 참고용이고,
> **찾을 때는 반드시 지시서에 인용된 코드 문자열로 검색**한다.

---

## 3. 편집 후 반드시 할 것

| 무엇을 고쳤나 | 해야 할 일 |
|---|---|
| `index.html` | `npm run sync:public` — 안 하면 배포본(`public/`)이 옛날 코드로 남는다 |
| `static/*.html` | `npm run sync:public` |
| `functions/*.js` | `node --check <파일>` 로 문법 확인 → 배포는 사람이 판단 |
| `firestore.rules` | 배포 전 시뮬레이션 (아래 §5) |
| 네이티브(`Mobile/`) | 해당 플랫폼 빌드 |

---

## 4. 배포 명령 (사람 승인 후에만)

```bash
npm run sync:public                    # public/ 동기화 (배포 아님)
npm run deploy:web                     # 호스팅 + firestore 룰
firebase deploy --only functions       # Cloud Functions
```

> `deploy:web` 은 룰까지 함께 배포하도록 체이닝돼 있다. **일부러 그렇게 했다** —
> 예전에 룰만 배포가 안 돼 한 달간 취약점이 열려 있었다. 분리하지 말 것.

---

## 5. 검증 도구 (이미 검증된 방법들)

**Firestore 룰 시뮬레이션** (배포 없이, 읽기 전용):
```bash
TOKEN=$(gcloud auth print-access-token)
curl -s -X POST "https://firebaserules.googleapis.com/v1/projects/snakeball-game:test" \
  -H "Authorization: Bearer $TOKEN" -H "X-Goog-User-Project: snakeball-game" \
  -H "Content-Type: application/json" -d @testcases.json
```

**배포된 룰이 리포와 같은지 확인**:
```bash
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "X-Goog-User-Project: snakeball-game" \
  "https://firebaserules.googleapis.com/v1/projects/snakeball-game/releases/cloud.firestore"
```

**로컬 실행**: `python3 -m http.server 8799` → `http://localhost:8799/index.html`

**functions 테스트**: `node --test functions/test/`

**네이티브 빌드**:
```bash
cd Mobile/iOS && xcodegen generate && xcodebuild -project Snakeball.xcodeproj \
  -scheme Snakeball -sdk iphonesimulator build CODE_SIGNING_ALLOWED=NO
cd Mobile/Android && ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew assembleDebug
```

---

## 6. 코드 스타일

- **주석은 한국어로, "왜"를 쓴다.** 이 리포의 관례다. "무엇을"은 코드가 말한다.
  특히 **함정을 막으려고 넣은 코드에는 그 함정을 적어둔다** (다음 사람이 되돌리지 않게).
- 식별자·문자열은 영어. 앱은 영어 전용이다 (한국어 UI 문자열은 전부 번역됨 — 되돌리지 말 것).
- 기존 파일의 들여쓰기·따옴표 스타일을 따른다.

---

## 7. 멈추고 물어봐야 하는 경우

- 지시서의 "현재 코드"가 파일에서 **그대로 안 찾아질 때** (이미 누가 고쳤다는 뜻)

> ⚠️ **"1개여야 한다"를 한 줄만 보고 판정하지 말 것.**
> 검색은 지시서가 인용한 **블록 전체**(앞뒤 문맥 포함)로 한다. 한 줄만 떼서 세면 오탐이 난다.
> 실례: T5 의 `const yesterday = new Date(Date.now() - 86400000)...` 는 파일에 **2번** 나온다
> (`claimDaily` 안, `renderDaily` 안). 지시서는 이를 SITE 2 / SITE 3 으로 나눠 각각 앞뒤
> 문맥까지 인용해 구분해 뒀다. **블록 전체로 검색하면 각각 정확히 1개**다.
> 즉 "한 줄 grep 이 2개" 는 중단 사유가 아니고, "블록 전체 grep 이 0 또는 2+" 가 중단 사유다.
- 하드 게이트(§1)를 건드려야 할 것 같을 때
- 검증이 실패하는데 원인을 모를 때
- 지시서에 없는 파일을 고쳐야 할 것 같을 때

**추측해서 진행하지 말 것.** 이 프로젝트는 라이브고 결제가 붙어 있다.
