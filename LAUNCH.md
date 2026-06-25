# Snakeball — 출시 체크리스트 (형이 할 일)

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
