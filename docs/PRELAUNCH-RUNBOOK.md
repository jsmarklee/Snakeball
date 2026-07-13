# Snakeball — 출시 직전 런북 (2026-07-11 패스)

대상: **iOS · Android + Toss(코드만 완성, 실기기 E2E 전 제출 비활성)**.
이 패스에서 **코드로 끝낸 것**과 **형 손이 필요한 것**, 그리고 **배포 순서(순서 틀리면 기존
유저 잔액이 날아감)**를 정리한다. 상위 콘솔 체크리스트는 `LAUNCH.md` 참조(중복 최소화).

전문가 3인(결제 무결성 / Firestore 마이그레이션 / 아키텍처) 적대 검토 + LessonLearned
31 §6·40·45 대조로 설계 확정 후 구현함.

---

## 0. 🔴 배포 게이트 순서 (functions 배포 — 반드시 이 순서)

기존 라이브 웹 유저(snakeball-game.web.app) 잔액/스킨을 첫 접속에 0으로 초기화하지 않기
위한 순서. **1→5를 분 단위로 좁혀서** 한 번에 진행.

```
1) node functions/scripts/backfill-createdAt.js            # DRY-RUN — missing 카운트 확인
2) node functions/scripts/backfill-createdAt.js --commit   # 실제 백필(createdAt sentinel)
3) node functions/scripts/backfill-createdAt.js --commit   # 재실행 → "written: 0" (완전성 게이트)
4) functions/coinSystem.js 의 MIGRATION_CUTOFF_MS 를 "지금(배포 직전) 시각"으로 갱신
5) firebase deploy --only functions                        # 즉시
```

- **왜 백필이 먼저?** `getEconomyStatus` import 게이트는 `createdAt<CUTOFF`(preCutoff)이거나
  `bestScore/recoveryCode` 보유(legacyNoCreatedAt)여야 localStorage 잔액을 임포트한다. 라이브
  코드는 createdAt 을 안 써서, 백필로 모든 레거시 doc 을 preCutoff 자격화해야 확실히 보존된다.
- **왜 컷오프 = 배포 직전 시각?** 미래/배포후로 잡으면 배포 후 신규 uid 가 preCutoff 로 오인돼
  localStorage-seed faucet 이 열린다. sentinel(2026-06-01)보다는 뒤여야 레거시 전원 preCutoff.
- 백필 스크립트 안전장치: projectId!=='snakeball-game' 이면 거부, dry-run 기본, identity-only
  (createdAt 만 set, 경제필드 미접촉), **배포 후 재실행 거부**(economy_initialized doc 발견 시).
- 자격증명: `firebase login`(gcloud ADC) 또는 `GOOGLE_APPLICATION_CREDENTIALS=<서비스계정.json>`.
  `firebase-admin` 은 `functions/node_modules` 에서 resolve → 리포 루트에서 위 명령 실행.
- ⚠️ **functions 배포는 아래 §2 시크릿 8개 설정 후에만** 성공(IAP 검증 함수가 시크릿 바인딩).
- LessonLearned 45 §5 "결제 심사 중 배포 금지" — App Review 진행 중엔 functions 배포 미루기.

---

## 1. ✅ 이 패스에서 코드로 끝낸 것 (배포/치환 대기)

**경제 import 하드닝 (`functions/coinSystem.js`)**
- FC2 정합: 임포트에서 `max(existingCoins,…)` 제거 → `min(client, cap)`. (이미-소비 IAP 코인
  재발행 + cap 우회 차단. 이번 배포엔 잠복이나 latent 결함 제거.)
- `import_cap_gems` 300 → 120 (레거시 계정당 1회 무료 젬 민팅 여지 축소).

**Toss IAP — 클라이언트 (`index.html`)**
- `createOneTimePurchaseOrder` 흐름: `processProductGrant` 는 orderId 를 **charge 전
  localStorage pending 큐에 적고 즉시 true**(네트워크 금지, LL31 §6 자동환불 방지).
- 서버검증·지급은 `onEvent 'success'` 에서. 성공 시 **`completeProductGrant`(Toss 판
  finish/consume)** + 큐 dequeue. **`onError` + 120s 워치독** 추가(취소/에러 시 hang 방지 —
  기존 코드엔 둘 다 없어 취소 시 상점이 영구 잠기는 버그였음).
- **부팅 복구 루프 `flushTossPending()`**: SDK `getPendingOrders()` + 로컬 큐 재검증 →
  성공 dequeue / 영구실패(terminal) dequeue / 트랜지언트 유지. sku→내부id 역참조 포함.
- **fail-closed 게이팅**: SKU 미매핑 상품은 상점에서 숨김(죽은 버튼 금지), 하나도 없으면
  "Store coming soon". 광고는 `TOSS_AD_GROUP_ID` 빈값이면 ▶버튼 숨김(기존 유지).
- web 데모 결제는 상점에서 숨김(공개 URL 무료코인 노출 방지).

**Toss IAP — 서버 (`functions/iapVerification.js`)**
- 지급 tier 를 **Toss 가 검증해준 실제 sku 로 역참조**(`TOSS_SKU_TO_INTERNAL`) → 클라 주장
  productId 불신(LL40 rule7). "싼 결제로 비싼 상품" 차단 + getPendingOrders(sku만) 복구 가능.
  (기존 `sku!==내부id` 비교는 콘솔 SKU 가 `ait.xxx` 라 **정상 결제도 전건 거부**하는 버그였음.)
- `already_processed` early-return 이 **원장에 저장된 grant** 반환(클라 주장 echo 금지).

**privacy/terms (`static/privacy.html`, `static/terms.html`)**
- 플레이스홀더 템플릿 생성(앱이 실제 수집하는 항목 기재). `LEGAL` 을 앱 도메인
  (`snakeball-game.web.app/privacy.html·terms.html`)으로 리포인트 → `sync:public` 배포처와 일치.
- ⚠️ **내용은 플레이스홀더** — 스토어 제출 전 실제 문구로 교체 필수(심사 게이트).

**빌드 검증**: functions 3파일 `node --check` OK, index.html 모듈 2개 syntax OK,
`vite build`(build:web) OK, Toss 회귀가드(processProductGrant 내부 무네트워크) 통과.

---

## 2. ✋ 형이 콘솔에서 발급 → 어느 파일/변수에 넣는지

### Toss (Apps in Toss) — 발급처 → 대상
| 값 | 발급처 | 넣는 곳 |
|---|---|---|
| **광고 ad group id** | Toss 개발자 콘솔 → 광고 | `index.html` 상단 `const TOSS_AD_GROUP_ID = ''` |
| **IAP SKU 4종** (`ait.xxx`) | Toss 콘솔 → 상품 (등록 + ON) | ① 클라: `index.html` `TOSS_SKU_BY_ID = { 'coins.5000':'ait…', 'coins.30000':'ait…', 'gems.small':'ait…', 'gems.big':'ait…' }` ② 서버: `functions/iapVerification.js` `TOSS_SKU_TO_INTERNAL = { 'ait…':'coins.5000', … }` (**역방향**) |
| `TOSS_IAP_API_KEY` | Toss 콘솔 | `firebase functions:secrets:set TOSS_IAP_API_KEY` |
| `TOSS_IAP_BASE_URL` | 고정값 `https://apps-in-toss-api.toss.im` | `firebase functions:secrets:set TOSS_IAP_BASE_URL` |
| `TOSS_MTLS_CERT` | Toss 콘솔 → mTLS 인증서 (client cert `.crt` PEM) | `firebase functions:secrets:set TOSS_MTLS_CERT` |
| `TOSS_MTLS_KEY` | Toss 콘솔 → mTLS 인증서 (key `.key` PEM) | `firebase functions:secrets:set TOSS_MTLS_KEY` |
| ait 토큰 | Toss 콘솔 API 키 | `npx ait token add --api-key <키>` (빌드/배포용) |

> ⚠️ **클라 `TOSS_SKU_BY_ID` 와 서버 `TOSS_SKU_TO_INTERNAL` 은 같은 SKU 를 양쪽에 채우고
> 반드시 같은 커밋에서 함께 배포**한다(한쪽만 채우면 결제됨/미지급 또는 죽은버튼). 두 맵은
> 서로 역방향(클라=내부→sku, 서버=sku→내부). 채우기 전엔 양쪽 fail-closed 라 죽은 결제는 없음.
> **Toss 제출은 실토스앱 E2E(§4) 전까지 활성화 금지.**

### Apple / Google 시크릿 (IAP 검증) — `firebase functions:secrets:set <NAME>`
| 값 | 발급처 |
|---|---|
| `APP_STORE_KEY_ID` / `APP_STORE_ISSUER_ID` / `APP_STORE_PRIVATE_KEY` | ASC → Users and Access → Integrations → **In-App Purchase 키**(.p8 내용 + Key ID + Issuer ID) |
| `GOOGLE_PLAY_SERVICE_ACCOUNT` | GCP 서비스계정 JSON (Play 연결, `androidpublisher` 권한) |

### IAP 상품 등록 (SKU 4종 전부 소비성) — `LAUNCH.md §D`
`coins.5000` / `coins.30000` / `gems.small` / `gems.big` 를 ASC · Play Console 에 정확히 등록.
(Toss 는 위 표대로 `ait.xxx` 자동생성 SKU 를 매핑.)

### AdMob — **rewarded 실 ID 는 이미 코드에 배선됨** (iOS/Android `ca-app-pub-1020671244071695/…`)
남은 형 작업 = **testDeviceIds 채우기**(계정 정지 방지, internal-test QA 전 필수):
| 값 | 넣는 곳 |
|---|---|
| iOS 테스트기기 해시 | `Mobile/iOS/Snakeball/SnakeballApp.swift` `testDeviceIdentifiers` 배열 |
| Android 테스트기기 해시 | `Mobile/Android/app/.../MainActivity.kt` `testDeviceIds` 리스트 |
> 해시는 기기에서 앱 첫 실행 시 Xcode 콘솔 / logcat 에 SDK 가 출력. internal-test 빌드는
> DEBUG=false 라 실광고를 요청 → **본인 기기 등록 없이 실광고 노출 시 계정 정지 위험**
> (포트폴리오 공유 퍼블리셔라 1게임 사고 = 전 게임 광고 수익 0). LAUNCH.md §E 참조.
> iOS interstitial 은 아직 테스트 ID(ADS_ENABLED=false 라 무영향 — 켤 때 교체).

### 서명 / 콘솔 나머지 — `LAUNCH.md §F/§G/§H`
Game Center / Play Games 리더보드, iOS 프로비저닝, Android 키스토어.

---

## 3. 🟡 배포 후 광고 켜기 (별도 게이트)

`index.html` `const ADS_ENABLED = false` — **실기기 부활+더블코인 E2E 통과 후에만** true 로.
- adReward 콜백 별칭(`__bridgeCallbacks('adReward',…)`)은 이미 배선됨(웹 배포만으로 양 플랫폼 수정).
- 켜기 전 확인: 실기기에서 광고 끝까지 시청 → 부활/더블코인 실지급, dismiss-후-보상 레이스 OK.

---

## 4. 📱 실기기 E2E 절차 (제출 전 필수 — 코드로 검증 불가)

### 공통 (iOS/Android)
1. TestFlight / Play 내부테스트 빌드 설치(실기기).
2. **IAP 결제 손실 테스트**: coins.30000 구매 → 지급 확인. **네트워크 끊고** 구매 → 복구 →
   재접속 시 지급되는지(pending 큐/재전달). Ask-to-Buy(iOS)/미소비(Android) 승인분 지급 확인.
3. **광고**: 부활 + 더블코인 실광고 시청 → 실지급. (testDeviceIds 등록 후 테스트 유닛으로.)
4. **경제 마이그레이션**: 배포 전 잔액 있던 계정으로 첫 접속 → 잔액/스킨 보존 확인.
5. **복구코드**: 발급 → 새 기기/재설치에서 redeem → 경제+리더보드 신원 이전.
6. **데이터 삭제**: 설정 → Delete my data → 서버 doc/계정 삭제 확인.

### Toss (제출 활성화 전)
1. `npm run toss:build && npm run toss:deploy` → 콘솔 QR 로 **실토스앱** 로드(샌드박스 광고 X).
2. **IAP**: 위 표대로 SKU 양쪽 맵 채운 뒤 실₩ 1건 결제 → 서버 검증(sku 역참조)·지급 확인.
   결제 UI 중 웹뷰 suspend → 자동환불 안 나는지(processProductGrant 무네트워크 확인).
   결제 직후 앱 kill → 재실행 시 `flushTossPending`(getPendingOrders)로 지급 복구되는지.
3. `verifyWithToss` 응답 shape(`data.success.sku`, `status`)가 실제 Toss 파트너 API 와
   일치하는지 — **문서 대비 미검증 상태**라 1건으로 확인. mTLS 핸드셰이크 성공 확인.
4. 통과 후에만 Toss 검수 제출 활성화.

### (선택) E2E 전 에뮬레이터/유닛 검증 — 권장
Firestore 에뮬레이터로 `verifyWithToss` 케이스표(sku 일치/불일치/누락/REFUNDED/매핑없음),
멱등(동일 txId 2회 → 1회 지급, already_processed), 백필 dry-run 을 돌려두면 실기기 리스크 축소.

---

## 5. 후속 (출시 후)
Android `:consume` void 스윕(RTDN), AdMob SSV, KST 날짜 키 잔여, targetSdk 36,
IAP 가격 현지화(`getProducts` 브릿지), Toss 프로모션 포인트, 문서 드리프트 정리.
