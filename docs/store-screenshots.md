# 스토어 스크린샷

한국어 · English · 日本語 · 繁體中文 4개 언어, App Store 6.9" + Google Play 2개 규격.
**총 40장** = 4 언어 × 2 규격 × 5 프레임.

```bash
node tools/make-store-screenshots.mjs docs/store/frames docs/store/out
```

| | |
|---|---|
| 원본 프레임 | `docs/store/frames/FRAME-{1..5}-*.png` (1320×2868, 커밋됨) |
| 생성 결과 | `docs/store/out/<규격>/<언어>/01..05.png` (gitignore — 위 명령으로 재생성) |
| 합성기 | [tools/store_screenshots.py](../tools/store_screenshots.py) (카피·순서·레이아웃이 전부 여기 있다) |

## 언어 코드 ↔ 스토어 로케일

번체 중국어는 **대만과 홍콩이 서로 다른 로케일**이다. 한 세트를 양쪽에 올려도 되지만,
업로드는 두 번 해야 한다.

| 우리 폴더 | App Store Connect | Google Play |
|---|---|---|
| `ko` | 한국어 | 한국어 |
| `en` | English (U.S.) — 기본 | English (United States) — 기본 |
| `ja` | 일본어 | 日本語 |
| `zh-Hant` | 중국어(번체) = **대만** / 중국어(홍콩) | 中文(繁體) 台灣 / 中文(香港) |

간체(중국 본토)는 없다. 중국 본토 App Store 는 별도 ICP 비안이 필요해 이번 출시 대상이 아니다.

## 규격

| 규격 | 크기 | 쓰는 곳 |
|---|---|---|
| `appstore-6.9` | 1320×2868 | App Store 6.9"(iPhone 17 Pro Max 등). 이 한 세트로 6.5"·6.1" 까지 자동 대체된다 |
| `play-phone` | 1080×1920 | Google Play 휴대전화. Play 의 9:16 비율 요건에 맞춘 것 |

## 프레임 5장 (순서 = 스토어 노출 순서)

순서는 파일명이 아니라 `store_screenshots.py` 의 `ORDER` 가 정한다.

| # | 키 | 화면 | 노리는 것 |
|---|---|---|---|
| 1 | `hero` | 게임플레이 — 34볼 민트 행렬, 12콤보 | 3초 안에 "무슨 게임인지" |
| 2 | `mega` | 게임플레이 — 62볼 골드 행렬, 23콤보 x3.0 | 성장의 보상 |
| 3 | `shop` | 스킨 상점 | 수집 요소 |
| 4 | `rank` | 전 세계 리더보드 | 경쟁 동기 |
| 5 | `menu` | 홈 | 브랜드·진입 |

**게임 UI 는 영어 전용이다**(i18n 은 출시 후 과제 — `LAUNCH.md`). 현지화는 캡션 오버레이로만
한다. 앱 화면 자체를 조작하지 않으므로 App Store 심사 지침 2.3.3 을 위반하지 않는다.

캡션에는 **앱 이름이 들어가지 않는다.** 이름이 아직 미정이라서다(`docs/app-store-listing.md`).
이름이 정해져도 이 스크린샷은 그대로 쓸 수 있다.

## 프레임을 다시 찍어야 한다면

게임플레이 프레임은 그냥 플레이해서 찍을 수 없다 — 34볼·62볼·23콤보 상태를 손으로 만들려면
운이 좋아야 한다. **임시 스크린샷 하니스**를 쓴다. 레포에는 절대 커밋하지 않는다.

1. `index.html` 을 스크래치 폴더로 복사하고, **두 번째** `</script>` 바로 앞에 폴링 스니펫을 넣는다.
   게임 모듈 스코프 안에서 `eval` 하므로 `ballCount` / `score` / `combo` 같은 module-level `let`
   에 그대로 접근된다. 재빌드 없이 `scene.txt` 만 바꿔 장면을 갈아끼울 수 있다.

   ```js
   (async function pollScene(){let last='';for(;;){try{
     const t=await(await fetch('/scene.txt?_='+Date.now())).text();
     if(t!==last){last=t;try{eval(t)}catch(e){console.error('[shot]',e)}}
   }catch(e){} await new Promise(r=>setTimeout(r,500));}})();
   ```

2. 그 폴더를 `python3 -m http.server 8811` 로 띄운다.
3. `Mobile/iOS/Snakeball/ContentView.swift` 의 URL 을 `http://localhost:8811/index.html` 로
   **임시** 변경한다. (`Info.plist` 의 `NSAllowsArbitraryLoadsInWebContent` 덕에 http 가 뜬다.)
4. iPhone 17 Pro Max 시뮬레이터(440×956pt)로 빌드·설치한다 → `xcrun simctl io <udid> screenshot`
   가 **정확히 1320×2868** 을 뱉는다. 브라우저 프리뷰는 800px 로 잘리므로 못 쓴다.
5. 장면 예시 — `scene.txt` 에 쓰면 0.5초 안에 반영된다:

   ```js
   startGame();
   setTimeout(() => {
       checkCollisions = () => {};            // 촬영 중 죽지 않게
       window.__shotTimer = setInterval(() => {  // 매 프레임 다시 박는다(감쇠 방지)
           ballCount = 34; score = 1480; combo = 12; comboTimer = 3;
           comboDisplay().style.display = 'block';   // 기본이 display:none 이다
       }, 60);
   }, 1800);
   ```

6. **끝나면 `git checkout Mobile/iOS/Snakeball/ContentView.swift`** 로 URL 을 되돌리고 서버를 내린다.
   되돌리지 않으면 로컬호스트를 가리키는 앱이 스토어로 나간다.

## 남은 것 (오너)

- [ ] App Store Connect 에 4개 로케일 업로드 (`appstore-6.9/`)
- [ ] Play Console 에 4개 로케일 업로드 (`play-phone/`) — 번체는 대만·홍콩 각각
- [ ] 앱 이름 확정 후 스토어 설명문 작성 (`docs/app-store-listing.md`)
