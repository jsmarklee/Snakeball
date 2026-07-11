# Snakeball — 출시 체크리스트 (형이 할 일)

> 🔴 **이번 패스(2026-07-11) 실행 순서·Toss 콘솔값·배포 게이트·E2E 절차는
> [`docs/PRELAUNCH-RUNBOOK.md`](docs/PRELAUNCH-RUNBOOK.md) 참조.** 특히 functions 배포 전
> **createdAt 백필 → MIGRATION_CUTOFF_MS 갱신 → 배포** 순서를 지켜야 기존 유저 잔액이 보존됨.
> 이 문서(LAUNCH.md)는 콘솔/계정 상위 목록. 아래.

코드로 할 수 있는 건 다 끝냈습니다. 아래는 **콘솔/계정/시크릿/자산처럼 내 인풋이 못 하는 것**들만 모은 목록입니다.
각 항목은 "어디서 / 무엇을" 형태로 적었고, 끝나면 나한테 알려주면 내가 이어서(배포·치환·검증) 진행합니다.

---

## ✅ 이미 끝난 것 (코드 + 일부 라이브)
- **리더보드** (서버+클라, 4플랫폼) — **라이브, e2e 검증 완료**. `snakeball-game.web.app`에서 동작.
- **IAP 영수증 검증 백엔드** (App Store/Play/Toss) — 코드 완료, 배포는 시크릿 대기 (아래 C).
- **네이티브 리더보드** (Game Center/Play Games) — 코드 완료, 콘솔 설정 대기 (아래 F).
- **3플랫폼 래퍼**: iOS(WKWebView), Android(WebView), Toss(granite) — 코드 완료.
- 웹 빌드 배포됨(호스팅) — iOS/Android/Toss 웹뷰가 이 URL을 로드.

---

## 🟣 플레이북 적용 (2026-06-29, 이번 패스 — 코드 완료, 배포/액션 필요)

`~/repos/LessonLearned`(20/21/30) 1:1 대조로 누락돼 있던 핵심 픽스를 적용했습니다.

**보안/안정성 (배포 필요):**
- **IAP environment 게이트** (`functions/iapVerification.js`) — Sandbox/Xcode/라이선스-테스트 영수증이 $0로 실재화를 발행하던 구멍을 막음. 비-Production은 `config/test_accounts` 화이트리스트에 든 UID만 허용. (플레이북 §9-4 A1)
  - ⚠️ **테스트 결제하려면**: Firestore에서 `config/test_accounts` 문서에 `{ uids: ["<내 익명 UID>"] }`를 넣어야 Sandbox/TestFlight 구매가 지급됩니다. 안 넣으면 테스터 구매가 `permission-denied`로 거부됩니다(정상 동작). 출시 후엔 빼기.
- **firestore.rules** — 서버 모더레이션 필드 `name`(+`bestScore`)을 클라 쓰기 화이트리스트에서 제거(욕설 닉네임이 리더보드로 새던 우회 차단). (§5)
- **hosting 캐시 헤더**(`firebase.json`) — 진입 문서 `/`가 1시간 캐시돼 배포가 WebView에 안 닿던 함정 수정. (§30 §9)
- **Firestore long-polling**(`index.html`) — WebView에서 리더보드 쿼리가 영영 hang하던 문제 + 8초 read 타임아웃. (§30 §9 / §21 P2.4)
- 배포: `firebase deploy --only firestore:rules,hosting` (시크릿 불필요, 지금 가능) / `--only functions` (C의 시크릿 8개 설정 후).

**게임 개선 (배포 필요):**
- **광고 마스터 스위치** `ADS_ENABLED`(`index.html` 상단) — 광고 정지/심사 중이거나 실 광고 ID 없으면 `false`로 바꿔 보상형 광고 UI(부활/더블코인 ▶)를 전부 숨기고 코인·젬 폴백만 노출. (§21 §9-6)
- **About 섹션**(설정) — Privacy / Terms / Support / 버전. iOS는 SafariVC·MailCompose 시트, Android는 브라우저·메일 인텐트, web/Toss는 새 탭·mailto 폴백. 법적 페이지는 `www.hodgepodge.studio/privacy.html|terms.html`, 문의 `support@hodgepodge.studio` (`index.html` `LEGAL` 상수에서 변경). **iOS/Android는 네이티브 핸들러를 추가했으니 재빌드 필요**.

**New GAME Day-1 체크리스트 적용 (2차, 2026-06-29):**
- **계정 복구** — `generateRecoveryCode`/`recoverByCode`/`recoverAccount` 추가(`functions/index.js`, `users` 컬렉션, `SNB-XXXX-XXXX`). 같은-기기 재설치는 stableId로 자동 복구, 새 기기는 코드로. 모든 grant/score/이름 op에 `migrated_to` tombstone 가드. 설정에 "Recovery Code"(발급+자동복사)·"Restore from Code"(입력+덮어쓰기 확인) 행. ⚠️ 코인/젬은 localStorage라 **복구는 리더보드 신원(이름/최고점)만** 이전.
- **stableId 캡처** — 런치 시 `getDeviceId` 브리지로 IDFV/ANDROID_ID 캡처 → `recoverAccount`로 재설치 시 신원 유지(+유니크 유저 지표 기반).
- **이모지 폰트 폴백** — `font-family`에 Apple/Segoe/Noto Color Emoji 추가(Android WebView tofu 방지).
- **onTap** — 햅틱+throttle 래퍼를 메뉴/설정/상점/모달 버튼에 적용.
- **minInstances:1** — `startRun`/`submitScore` 콜드스타트 제거. ⚠️ **always-on 인스턴스라 과금 발생**(원치 않으면 빼기). 배포 시 `--force` 필요할 수 있음.
- **iOS 하드닝**(`WebView.swift`, **재빌드 필요**): `window.prompt` 텍스트입력 패널(없으면 닉네임/복구 입력이 조용히 무시됨), 오프라인 재시도 오버레이(2.1 리젝 방지), content-process 종료 시 리로드, **빌드타입 광고유닛**(Debug/TestFlight=테스트, App Store만 실광고 — self-click 정지 예방).

**의도적 미적용 (Snakeball 설계상 N/A 또는 보류):**
- ~~**코인 서버권위(체크리스트 §2)** — localStorage라 미적용~~ → **적용됨(2026-07)**: 경제를 서버권위로 마이그레이션함(`functions/coinSystem.js` + `getEconomyStatus`/`spendCurrency`/`rewardFromAd`/`claimDaily`/`claimMission`, IAP는 `verifyAndFulfillPurchase`). `users/{uid}.coins/.gems/.owned_skins/.powerups` 가 진실이고 localStorage 는 부팅에 down-reconcile 되는 캐시. 설계: `docs/economy-migration-design.md`.
- **온보딩 튜토리얼(§7)** — 게임에 튜토리얼 스캐폴딩이 있으나 `gameState='tutorial'`이 어디서도 설정 안 돼 **죽은 코드**. 검증 안 된 튜토리얼을 첫-실행 경로에 켜면 소프트락 위험 → 실기기 QA 후 활성화 권장(또는 가벼운 첫-실행 힌트 오버레이로 교체).
- **크로스프로모(§15/§16)** — 네트워크 기능(증폭기, §6): 콜드스타트(첫 코호트) 이후 도입이 맞음.
  - ✅ **URL 스킴 등록 완료(2026-06-29)**: iOS `Info.plist`에 자체 스킴 `snakeball://`(CFBundleURLTypes) + 형제 조회 스킴 `mineta`/`pow2`(LSApplicationQueriesSchemes); Android `AndroidManifest.xml`에 형제 패키지 `<queries>`(`studio.hodgepodge.minefieldsweeper`/`pow2`). → **재빌드 필요**. (olympic은 당분간 미출시라 네트워크 전체에서 제거함.)
  - ✅ **검증 완료(2026-07-07)**: 두 파일 모두 실제로 엔트리 존재 확인(커밋 `a19b397`). 재빌드 상태 — iOS는 6/29 커밋 직후 로컬 Debug 빌드만 됨(**.xcarchive 없음** → 스토어/TestFlight 빌드에는 아직 미반영), Android는 변경 후 빌드된 APK/AAB 없음. 어차피 양쪽 다 스토어 미출시 상태라 첫 스토어 빌드에 자동 포함됨 — 별도 액션 불필요, 단 기존 빌드 재사용 금지.
  - ✅ **games.json 404 해결(2026-07-07)**: HodgepodgeStudio 리포에는 파일이 있었으나 호스팅에 미배포 상태였음 → `deploy-games.sh`로 Firebase Hosting(`hodgepodge-studio`) 재배포, 현재 **200 + CORS(`access-control-allow-origin: *`) + 유효 JSON** 확인. 겸사겸사 `firebase.json` ignore에 `docs/**`·`deploy-games.sh` 추가(내부 문서가 공개 서빙되는 것 방지, 배포 후 404 확인).
  - ✅ **①도 같은 배포에 포함(2026-07-07)**: Snakeball 엔트리 = `id:"snakeball"`, `scheme:"snakeball://"`, `package:"studio.hodgepodge.snakeball"`, `platforms.web:"https://snakeball-game.web.app"` 라이브 확인. 주의: 클라(Pow2/Mineta `crosspromo.js`)는 링크를 `platforms[플랫폼]`에서 읽으므로 `web`은 최상위가 아니라 **`platforms` 안**에 둠. `reward`는 표시용이며 서버 진실 테이블(양쪽 `CROSSPROMO_REWARDS`)에 `snakeball: 3` 이미 등록돼 있음. 잔여: 세 엔트리 모두 `platforms.ios`가 `idREPLACE_WITH_*` placeholder — 실제 App Store ID 확정 시 교체 필요.
  - 남은 작업: ② **형제 앱(Mineta/Pow2)이 각자 LSApplicationQueriesSchemes/`<queries>`에 snakeball/`studio.hodgepodge.snakeball`을 추가해 재빌드**해야 Snakeball이 감지됨. ③ Snakeball이 형제 게임 카드를 *보여주려면* 클라(코너카드+설정 목록)+서버(`claimCrossPromoReward`+`CROSSPROMO_REWARDS`) 포팅 필요(아직 미구현). 원하면 다음에 진행.

**보류 (형 결정 대기):**
- **다국어(i18n)** — 현재 영어 전용. Toss가 한국 플랫폼이라 **한국어는 가치가 큼**. 단 단일 HTML에 하드코딩 문자열이 많아 작업량/회귀위험 큼 + 3D라 시각 QA 필요. 할지 알려주면 en/ko부터 진행.
- **복구 코드 / 클라우드 세이브** — 경제가 서버권위로 이전되면서(2026-07) 코인·젬·스킨이 `users/{uid}` 에 있으므로, 복구 코드/stableId 자동복구가 이제 **리더보드 신원 + 경제 전체**를 이전한다(기존 localStorage 한계 해소). 데이터 삭제 경로(`deleteMyData`)도 추가됨.

---

## 🔵 형이 해야 하는 것

### A. 게임 제목 확정 ⚠️ (먼저)
- 영문/한글 최종 결정 (후보: **Numbash / 넘배시: 숫자 뿌수기**, 또는 Snakeball 유지).
- **이게 먼저인 이유**: Toss 콘솔 슬러그(H)는 **등록 후 변경 불가**라 제목을 먼저 정해야 함. 스토어 표시명/아이콘에도 영향.
- 정하면 내가 메뉴 타이틀·iOS/Android 표시명·`granite.config.ts` displayName에 반영.

### B. 앱 아이콘
- 내가 만든 네온볼 플레이스홀더가 있음(`/tmp/sb_icon.png`) — **그대로 쓸지(A) / 손볼지(B) / 직접 디자인(C)** 결정.
- 정해지면 내가 `public/app-icon.png`(Toss 검수용, 현재 404)·Android `mipmap`·iOS 에셋에 넣고 배포.

### C. Firebase 시크릿 8개 (IAP 검증 켜기)
콘솔에서 발급받아 나한테 주거나, 직접 `firebase functions:secrets:set <NAME>` 실행:
- `APP_STORE_KEY_ID`, `APP_STORE_ISSUER_ID`, `APP_STORE_PRIVATE_KEY` — App Store Connect → Users and Access → Integrations → **In-App Purchase 키**(.p8 내용 + Key ID + Issuer ID)
- `GOOGLE_PLAY_SERVICE_ACCOUNT` — GCP 서비스계정 JSON (Play Console 연결, `androidpublisher` 권한)
- `TOSS_IAP_API_KEY`, `TOSS_IAP_BASE_URL`(`https://apps-in-toss-api.toss.im`), `TOSS_MTLS_CERT`, `TOSS_MTLS_KEY` — Toss 개발자 콘솔 → mTLS 인증서
- 다 되면 내가 `firebase deploy --only functions` 으로 검증 함수 배포.

### D. IAP 상품 등록 (각 스토어, SKU 4종 — 전부 소비성)
`coins_small`, `coins_big`, `gems_small`, `gems_big` (ID 정확히 일치):
- **App Store Connect** → In-App Purchases (소비성)
- **Google Play Console** → 인앱 상품
- **Toss 콘솔** → 상품 (등록 + ON, 슬러그가 위와 다르면 알려줘 — 매핑 추가 필요)

### E. AdMob 실제 광고 ID (보상형)
현재 Google **테스트 ID** 플레이스홀더. 실제 ID로 교체 필요 (iOS + Android 각각: app id + rewarded unit id).
- AdMob 콘솔에서 발급 → 나한테 주면 iOS/Android에 치환.

### F. 네이티브 리더보드 콘솔 설정
- **iOS Game Center**: Apple Developer App ID(`studio.hodgepodge.snakeball`)에 Game Center 활성화 + App Store Connect에 리더보드 생성 (ID 정확히 **`snakeball.leaderboard.global`**, 단일·전체기간·높을수록 좋음). Game Center entitlement는 이미 `Snakeball.entitlements`에 들어있음.
- **Android Play Games**: Play Console → Play Games Services 설정 → ① 숫자 **`games_app_id`** 발급 → `Mobile/Android/.../res/values/strings.xml`의 `0000000000` 치환 ② 리더보드 생성 → `leaderboard_global` 값(현재 `snakeball.leaderboard.global`) 치환 ③ OAuth 동의화면 + 앱 연결(SHA-1) → 발급값을 나한테 주면 치환해줌.

### G. 서명 (Signing)
- **iOS**: Apple Developer 인증서 + 프로비저닝 프로파일 (App Store 배포용)
- **Android**: 릴리스 **키스토어** 생성 → `Mobile/Android/keystore.properties`(`.example` 참고) 채우기

### H. Toss 콘솔
- 앱 등록 — 슬러그 `snakeball` (⚠️ 변경 불가, A 먼저 결정)
- `npx ait token add --api-key <콘솔키>`
- 콘솔에서 받은 **광고 ad group id** → 내가 `index.html`의 `TOSS_AD_GROUP_ID`에 입력
- IAP SKU 4종 콘솔 등록 (D)

### I. 빌드 & 제출 (콘솔 작업 다 끝난 뒤)
- **iOS**: `cd Mobile/iOS && xcodegen generate && open Snakeball.xcodeproj` → Archive → App Store Connect → TestFlight → 심사 제출
- **Android**: `cd Mobile/Android && ./gradlew bundleRelease` → Play Console 내부테스트 → 심사 제출
- **Toss**: `npm run toss:build && npm run toss:deploy` → 콘솔 QR로 실기기 확인 → 검수 제출

---

## 권장 순서
1. **A 제목 확정** → 2. **C/D IAP**(결제), **F 리더보드 콘솔**, **E AdMob** (병렬 가능) → 3. **G 서명** → 4. **H Toss** → 5. **I 빌드/제출**
2. 리더보드는 이미 라이브라 **지금 바로 `snakeball-game.web.app`에서 플레이 테스트** 가능.

각 항목 끝낼 때마다 알려주면 내가 배포·치환·검증으로 받아서 진행합니다.
