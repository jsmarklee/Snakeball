# Snakeball 스토어 출시 준비 종합 인스펙션 보고서 (Apple App Store & Google Play)

**검사 일시**: 2026-08-28  
**검사 대상**: `Snakeball` (`index.html`, `Mobile/iOS`, `Mobile/Android`, `functions/`, `docs/`)  
**검사 방식**: 양방향 전문가 검증 (Positive Expert: 강점/적합성 검증 vs Negative Expert: 적대적 취약점/결함/스토어 거절 요인 분석)

---

## 1. 종합 판정 (Overall Verdict)

### 🟡 **REQUIRES OWNER ACTIONS (스토어 콘솔/키 설정 완료 시 즉시 제출 가능)**
- **코드 및 빌드 상태**: 클라이언트, 네이티브 래퍼, 백엔드 로직 모두 정상 빌드 및 런타임 방어 설계 완료.
- **남은 선행 작업**: 개발자가 스토어 콘솔에서 직접 발급/등록해야 하는 **인증서, 키스토어, IAP 상품 등록, 실 AdMob ID** 설정 필요.

---

## 2. 6축 인스펙션 결과 요약 (6-Axis Pass/Fail)

| 축 | 평가 | 실측 근거 / 핵심 요약 |
|---|---|---|
| **1. ⚡ 플랫폼 & 빌드 적합성** | **PASS** | iOS `xcodebuild` 성공, Android `assembleDebug` 성공 (`targetSdk 35`), `index.html` ↔ `public/index.html` 완벽 일치 |
| **2. 🛡 보안 & 백엔드 무결성** | **PASS** | `users/{uid}` 클라이언트 직접 쓰기 차단(`firestore.rules`), Cloud Functions 세션 토큰(`startRun`→`submitScore`) 안티치트 검증 |
| **3. 💳 수익화 & IAP 무결성** | **CONDITIONAL** | 4종 소비성 SKU(`coins.5000`, `coins.30000`, `gems.small`, `gems.big`) 일치. 단, 서버 영수증 검증 시크릿 및 스토어 상품 등록 필요 |
| **4. 🎮 코어 게임플레이 & 성능** | **PASS** | 5레인 3D 러너 루프, 콤보 배수 공식 정상, Fast-fall/점프/오버헤드 충돌 판정, 오브젝트 풀링 정상 |
| **5. 📱 모바일 UX & 래퍼 브리지** | **PASS** | iOS/Android Webview 백그라운드 색상 일치(`#0a0a1a`), 햅틱/IAP/리워드 브리지 페일클로즈드(Fail-closed) 안전 설계 |
| **6. 📜 법무 & 스토어 메타데이터** | **PASS** | 4개 국어(KO, EN, JA, ZH-Hant) 메타데이터/스크린샷/1024x500 그래픽 구비, `privacy.html`/`terms.html` 플레이스홀더 0개 |

---

## 3. 전문가 대조 분석 (Positive vs Negative Expert Review)

### 🟢 긍정적 전문가 (Positive Expert) — 준비된 강점 및 방어 설계
1. **스토어 메타데이터 및 에셋 준비 완료**:
   - App Store 6.9인치 4개 언어 스크린샷 세트 및 Google Play 폰 스크린샷 + 1024×500 그래픽 에셋이 정밀하게 제작되어 배치됨.
   - 4개 국어 스토어 등록 문구(`docs/store-listing.md`)가 문자수 제한을 엄격히 준수하며 가챠/과장 표현 없이 작성됨.
   - 앱 아이콘 1024x1024 (iOS) 및 전용 mipmap 런처 아이콘(Android) 배포 확인.
2. **견고한 페일세이프(Fail-safe) 래퍼 설계**:
   - `ADS_ENABLED = false` 상태에서 UI에 죽은 광고 버튼이 노출되지 않고 젬/코인 플로우로 부드럽게 폴백됨.
   - Android에서 Play Games 미설정 시 앱이 비정상 종료(Crash)되지 않도록 `playGamesManager` null 세이프티 구현.
   - iOS WebView 뷰 계층에서 메모리 릭(Retain Cycle)을 방지하는 `WeakScriptMessageDelegate` 적용.
3. **서버 권위형 경제 및 안티치트**:
   - 코인/젬/스킨/파워업을 서버에서 검증·기록하여 클라이언트 변조 차단.
   - 일일 보상/미션 쿨다운 및 리더보드 점수 상한(`MAX_SCORE_PER_SEC`, `BASE_BUFFER`) 정상 작동.

---

### 🔴 부정적/적대적 전문가 (Negative Expert) — 잠재적 리젝 및 결함 위험 분석

#### ⚠️ 1. [CRITICAL] Android 릴리스 서명 키스토어 부재 시 `Debug` 키 조용한 폴백
- **위험 내용**: `Mobile/Android/keystore.properties`가 없으면 `build.gradle.kts`가 에러를 내지 않고 **Debug 키로 서명된 AAB**를 생성함.
- **영향**: Play Console 업로드 시 즉시 거부됨.
- **조치**: 릴리스 키스토어 생성 후 `keystore.properties` 설정 필수.

#### ⚠️ 2. [HIGH] App Store Connect & Google Play Console IAP 상품 등록 미완료 시 결제 실패
- **위험 내용**: 인게임 IAP SKU 4종(`coins.5000`, `coins.30000`, `gems.small`, `gems.big`)이 스토어 콘솔에 등록되지 않은 채 심사 제출되면 결제 모달 호출 실패 또는 `SKErrorPaymentInvalid` 발생.
- **조치**: 각 스토어 콘솔에 4개 소비성 상품 생성 및 활성화 필요.

#### ⚠️ 3. [HIGH] Firebase 시크릿 미설정 시 서버 영수증 검증 실패
- **위험 내용**: `functions/iapVerification.js`는 App Store Private Key 및 Google Play 서비스 계정 시크릿을 참조함. 시크릿 미등록 상태에서 라이브 인앱 결제 시 서버 보상 지급 단계에서 500/권한 에러 발생.
- **조치**: `firebase functions:secrets:set`으로 8개 시크릿 주입 후 functions 재배포 필요.

#### ⚠️ 4. [MEDIUM] AdMob 테스트 ID 및 `ADS_ENABLED=false` 상태
- **위험 내용**: 현재 상태로 출시하면 광고 수익이 0원이며, 테스트 ID 상태로 실서버에서 광고를 켤 경우 계정 정지 위험이 있음.
- **조치**: AdMob 콘솔에서 실 ID 발급 후 교체하고, 실기기 테스트 완료 후 `ADS_ENABLED=true`로 전환.

#### ⚠️ 5. [MEDIUM] 최종 앱 명칭(Title) 확정 동기화
- **위험 내용**: 현재 코드는 `Snakeball`을 기본으로 유지하고 있으나, 스토어 기획상 `Cubeball` 또는 `Balldozer` 등 후보가 검토된 바 있음.
- **조치**: 최종 앱 이름을 확정하고 필요 시 앱 번들 표시명(`CFBundleDisplayName`, `app_name`) 및 스토어 타이틀과 1:1 일치 확인.

---

## 4. 출시 전 최종 액션 체크리스트 (Action Plan)

1. **[Apple App Store]**:
   - [ ] App Store Connect에 앱 생성 및 Bundle ID `studio.hodgepodge.snakeball` 매핑
   - [ ] IAP 소비성 상품 4종 등록 (`coins.5000`, `coins.30000`, `gems.small`, `gems.big`)
   - [ ] Game Center 리더보드 ID `snakeball.leaderboard.global` 등록
   - [ ] 4개 국어 등록 문구 및 6.9인치 스크린샷 5장 업로드
   - [ ] Xcode에서 Release Archive 생성 및 App Store Connect 업로드

2. **[Google Play Store]**:
   - [ ] `Mobile/Android/keystore.properties` 생성 및 릴리스 키 서명 설정
   - [ ] Play Console에 인앱 상품 4종 등록
   - [ ] 4개 국어 등록 문구, 폰 스크린샷, 1024×500 그래픽 이미지 업로드
   - [ ] `./gradlew bundleRelease`로 AAB 생성 후 내부 테스트 트랙 업로드

3. **[Firebase / 백엔드]**:
   - [ ] Firebase Secrets 설정 (App Store 키, Google Play 서비스 계정 JSON)
   - [ ] `firebase deploy --only functions` 실행
