# Snakeball — 출시 전 최종 점검 (2026-07-28)

`docs/PRELAUNCH-RUNBOOK.md` + `LAUNCH.md` 게이트를 코드/배포/스토어 요건과 1:1 대조.
실행한 검증: 라이브 E2E(경제 API·리더보드·콘솔), iOS/Android 실빌드, vite/functions 빌드,
Firestore 룰, IAP SKU 정합성, 시크릿·함수 배포 상태, 백필 상태 확인.

---

> **2026-07-28 갱신 — B1·B2 해소됨.** 아이콘 3플랫폼 배치 완료(커밋 `13a79d9`), 법무 문구
> 실문구 교체 완료(커밋 `42fc346`), `minInstances` 1→0 배포 완료(커밋 `23d071d`).
> **남은 블로커는 B3(릴리스 키스토어) 하나 — 오너만 가능.**
> 배포 검증: privacy/terms/app-icon 전부 HTTP 200 · 플레이스홀더 0 · `getEconomyStatus`
> 708ms(콜드스타트) · `startRun` 세션 발급 정상 · 콘솔 에러 0 · 배포 함수 minInstanceCount=0.

---

## 🔴 블로커 — 이대로면 제출 불가

### ✅ B1. 앱 아이콘 (해소 2026-07-28)
| 플랫폼 | 상태 | 결과 |
|---|---|---|
| iOS | `Assets.xcassets/AppIcon.appiconset` 에 `Contents.json` 만, **PNG 0개** (1024 슬롯에 `filename` 없음) | App Store Connect 업로드 **거부** |
| Android | 런처 아이콘이 **MinefieldSweeper 것과 바이트 동일** (`ic_launcher.webp` MD5 `d687a25bd7dd937ebbf9960ea5ce198d` 양쪽 일치) | 잘못된 브랜드로 출시 |
| Toss | `granite.config.ts` → `https://snakeball-game.web.app/app-icon.png` = **HTTP 404** | 검수 반려 |

리포 전체에 아이콘 소스 PNG **없음**. `LAUNCH.md §B` 가 말한 `/tmp/sb_icon.png` 플레이스홀더는 사라짐.
→ **아이콘 1종(1024×1024) 확정이 최우선 블로커.** 확정되면 3플랫폼 배치는 코드작업으로 처리 가능.

### ✅ B2. 개인정보처리방침 / 이용약관 (해소 2026-07-28 — 스튜디오 문구 기반, Snakeball 사실로 교정)
`static/privacy.html` 8곳, `static/terms.html` 7곳에 `[PLACEHOLDER — …]` 잔존 (라이브 200 응답).
미기재: **법인명 · 시행일 · 환불/청약철회 정책 · 아동 개인정보(연령등급) · 책임한계/준거법 · AdMob 데이터 공시 · 보관기간**.
→ Apple/Google 심사 게이트. 한국 전자상거래법/개인정보보호법 이슈도 동반.

### B3. Android 릴리스 서명 미구성 (조용한 폴백 = 함정)
`Mobile/Android/keystore.properties` 없음. `build.gradle.kts` 가 keystore 부재 시 **debug 서명으로 조용히 폴백**.
→ `./gradlew bundleRelease` 가 성공한 것처럼 보이지만 Play 업로드에서 거부. 빌드 시점에 안 터지므로 놓치기 쉬움.

---

## 🟠 출시 전 결정/작업 필요

| # | 항목 | 현재 | 영향 |
|---|---|---|---|
| O1 | **광고 마스터 스위치** | `ADS_ENABLED = false` | 주 수익원(부활·더블코인 리워드 광고) 전부 숨김. 이대로 출시 시 **광고 매출 0**. 런북 §3: 실기기 E2E 통과 후 true. |
| O2 | **AdMob testDeviceIds** | iOS/Android 양쪽 **빈 배열** | internal-test 빌드는 실광고 요청 → 본인 기기로 탭 시 **AdMob 계정 정지** 위험(포트폴리오 전 게임 광고수익 0). 광고 켜기 전 필수. |
| O3 | **Play Games 리더보드** | `games_app_id = 0000000000` | Android 네이티브 리더보드 미동작 (서버 리더보드는 정상). |
| O4 | **Toss IAP SKU** | 클라 `TOSS_SKU_BY_ID` / 서버 `TOSS_SKU_TO_INTERNAL` **양쪽 비어있음** | Toss 결제 불가. 양쪽 fail-closed라 죽은 버튼은 없음(안전). 콘솔 SKU 발급 후 **같은 커밋에 양쪽 동시** 반영. |
| O5 | **Toss 광고 그룹 ID** | `TOSS_AD_GROUP_ID = ''` | Toss 광고 미노출(게이트로 버튼 숨김 — 안전). |
| ~~O6~~ | ~~미커밋 변경~~ | ✅ **완료** — 커밋 `23d071d` + 배포. 실측 `minInstanceCount=0` 확인, 콜드스타트 708ms. | 상시 인스턴스 과금 제거됨. |
| O7 | **IAP 상품 등록 / 서명 / 콘솔** | `LAUNCH.md §D/§F/§G/§H` 미완 | 4종 SKU(`coins.5000`/`coins.30000`/`gems.small`/`gems.big`) ASC·Play 등록, iOS 프로비저닝, Toss 콘솔. |
| O8 | **`config/test_accounts`** | 미확인(콘솔 작업) | 비워두면 Sandbox/TestFlight 결제가 `permission-denied`. IAP E2E 전 본인 UID 등록 필요, 출시 후 제거. |

---

## 🟡 함정 / 권고

### ⚠️ T1. `MIGRATION_CUTOFF_MS` 를 **갱신하지 말 것** (코드 주석과 반대)
`functions/coinSystem.js:26` 주석은 *"★★ 배포 직전 갱신 필수 ★★"* 라고 되어 있으나 —
**백필 dry-run 결과 마이그레이션은 이미 완료됨**:
```
✋ REFUSING: a users doc already has economy_initialized → new code is LIVE.
```
지금 값을 "현재 시각"으로 올리면 **2026-07-11 이후 생성된 계정에 localStorage 임포트 faucet 이 열린다**.
→ O6(minInstances) 때문에 functions 를 재배포하더라도 **`2026-07-11` 그대로 유지**. 주석에 이 사실을 덧붙이는 게 안전.

### T2. App Check 미적용
콜러블 함수에 App Check 없음. 공개 웹 빌드가 있어 스크립트로 호출 가능.
완화 장치는 있음 — 서버 일일 캡(`coin_earn_daily_cap`/`rewarded_daily_cap`/`revive_daily_cap`), 세션 토큰(`startRun`→`submitScore`), 익명 인증.
→ 열린 수도꼭지는 아니나 defense-in-depth 갭. 출시 후 도입 권장.

### T3. 문서 드리프트 (실제 코드와 불일치)
- `CLAUDE.md`: STORE 에 `remove.ads`·`starter.pack` 언급 → **실제는 소비성 4종만**.
- `LAUNCH.md`: 크로스프로모 games.json 에 Snakeball 이 라이브라고 기재 → **실제는 `draft[]` 에 있고 `platforms:{}` 비어있음** (형제 앱이 Snakeball 을 못 찾음).
- `LAUNCH.md`: iOS 스킴 `snakeball://` → **실제는 `hp-snake://`** (games.json 과는 일치).

### T4. Three.js r160 deprecation 경고
`build/three.min.js` 사용 → 콘솔 경고(에러 아님). 버전이 `0.160.0` 로 핀되어 있어 현재는 안전.
CDN 버전을 올릴 경우 ES Module 로 전환 필요.

---

## ✅ 검증 통과 (실측)

**백엔드 — 라이브 정상**
- Cloud Functions **14개 전부 배포**(asia-northeast3), 시크릿 **8/8 SET**.
- 라이브 `getEconomyStatus` 왕복 성공 — `coins/gems/owned_skins/powerups/daily/missions` + 일일 캡 필드 반환.
- 리더보드 라이브 조회 성공(실데이터 3건).
- 익명 인증 정상(uid 발급 확인).

**결제 무결성**
- 클라 `STORE` ↔ 서버 `PRODUCTS` **4종 완전 일치**.
- Toss 지급 tier 를 **검증된 sku 로 역참조**(클라 주장 productId 불신) — "싼 결제로 비싼 상품" 차단.
- 멱등 원장(`processed_transactions`), `already_processed` 는 원장 grant 반환.
- 웹 플랫폼 IAP **숨김**(`iapPurchasable` → web false) — 공개 URL 무료코인 노출 없음.

**보안 / 룰**
- Firestore 룰: `name`/`bestScore` 클라 쓰기 **차단**(욕설 닉네임 리더보드 우회 방지), 세션/원장/config 전면 차단, users 화이트리스트 3필드.
- 호스팅 보안 헤더(nosniff·X-Frame-Options·Referrer-Policy·Permissions-Policy) + 진입문서 `no-cache`.
- 클라 하드코딩 시크릿 없음(Firebase apiKey 는 공개 설정 — 정상).

**빌드**
- **iOS `** BUILD SUCCEEDED **`** (xcodegen + xcodebuild, Xcode 26.6)
- **Android `BUILD SUCCESSFUL`** (assembleDebug, 29s)
- `vite build` OK (gzip 29.2KB 청크), functions 3파일 `node --check` OK.

**클라이언트 품질**
- 라이브 콘솔 **에러 0**(Three.js deprecation 경고만).
- 광고 OFF 상태에서 **죽은 버튼 없음** — 부활 화면은 광고 버튼 숨기고 젬 부활 유지, 결과화면 더블코인 숨김.
- 죽은 `gameState='tutorial'` 경로 **미도달**(소프트락 없음), `console.log` **0개**.
- iOS 심사 키: `ITSAppUsesNonExemptEncryption=false`, `GADApplicationIdentifier` 실 ID, SKAdNetwork 목록, Game Center entitlement, URL 스킴.
- `targetSdk 35`(Play 신규앱 요건 충족), `minSdk 24`, 버전 iOS 1.0.0(1) / Android 1.0.0(1) 일관.

---

## 권장 순서

1. **아이콘 확정**(B1) — 이게 3플랫폼 동시 블로커라 최우선.
2. **법무 문구 확정**(B2) — 법인명·시행일·환불정책·연령등급.
3. **키스토어 생성**(B3) + IAP 상품등록·서명·콘솔(O7).
4. **실기기 E2E**(런북 §4) — IAP 결제손실/복구, 경제 보존, 복구코드, 데이터삭제.
5. **testDeviceIds 등록**(O2) → **광고 ON**(O1) → 실광고 E2E.
6. functions 재배포 시 **T1 주의**(컷오프 고정).
