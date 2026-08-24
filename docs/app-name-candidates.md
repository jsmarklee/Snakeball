# 앱 이름 후보 — 2026-08-25

> `LAUNCH.md` 의 이름 결정 항목을 닫기 위한 문서. 후보 33개를 4가지 작명 전략으로 만들고
> 30개를 적대 검증한 뒤, **App Store 검색 API 로 4개 스토어프런트(US/KR/JP/TW)를 직접 조회**해
> 최종 정리한 것이다.

## 결론

**1위 `Cubeball` / 큐브볼 / 슬러그 `cubeball`.**
`-dozer` 계열을 원하면 **`Rolldozer` 가 아니라 `Balldozer`** 다 — 원어민 4명이 전원 `Rolldozer` 를
문제 삼았고 그중 둘은 스토어 실측으로 확인됐다(§6).
그리고 **`Ballstorm` 과 `Numbash` 는 쓸 수 없다** — 아래 §2 참고.

---

## 1. 순위

| # | 이름 | 한국어 | 일본어 | 번체 | 슬러그 | 받아쓰기 | 장르적합 | 상표여지 | ASO |
|---|---|---|---|---|---|---|---|---|---|
| **1** | **Cubeball** | **큐브볼** | キューブボール | 方塊球 | `cubeball` | ★★★★★ | ★★★★★ | ★☆☆☆☆ | ★★★★★ |
| 2 | **Balldozer** | 볼도저 | ボールドーザー | — | `balldozer` | ★★★★★ | ★★★★★ | ★★★★★ | ★★★☆☆ |
| ⚠️ | Rolldozer | 롤도저 | ロールドーザー | — | `rolldozer` | ★★☆☆☆ | ★★★★★ | ★★★★★ | ★★★☆☆ |
| 3 | Countball | 카운트볼 | カウントボール | — | `countball` | ★★★★★ | ★★★★★ | ★★☆☆☆ | ★★★☆☆ |
| 4 | Ballnova | 볼노바 | ボールノヴァ | — | `ballnova` | ★★★☆☆ | ★★★★☆ | ★★★★★ | ★★★☆☆ |
| 5 | Comboball | 콤보볼 | コンボボール | — | `comboball` | ★★★★★ | ★★★★☆ | ★★☆☆☆ | ★★★☆☆ |
| ❌ | ~~Ballstorm~~ | — | — | — | — | — | — | — | **동명 앱 실재** |
| ❌ | ~~Numbash~~ | — | — | — | — | — | — | — | **동명 게임 실재** |
| ❌ | ~~Snakeball 유지~~ | — | — | — | — | — | ★☆☆☆☆ | — | 장르 오인 |

번체 표기는 1위만 확정했다. 나머지는 이름이 정해진 뒤에 정하면 된다.
**어느 후보든 번체명에 `滾球` 를 쓰면 안 된다** — 대만·홍콩에서 페탕크/보체 종목명이자
`滾球盤`(스포츠 라이브 베팅) 용어다. `球球` 도 대만 히트작 *球球大作戰* 을 직결한다.

---

## 2. 쓸 수 없는 이름 2개 — 근거

검증 에이전트는 이 둘을 각각 "충돌 low", "충돌 none" 으로 통과시켰다. **틀렸다.**
둘 다 2026-08 에 나온 신작이라 웹 검색 색인에 아직 안 잡힌 것으로 보인다.
아래는 iTunes Search API 원본 조회 결과다.

### ❌ Ballstorm — 동명 앱이 US·KR·JP·TW 전부에 있다

```
Ballstorm WorldsSlot
  판매자   TUNG PHAT TRADING DEVELOPMENT COMPANY LIMITED
  분류     Entertainment
  출시     2026-08-05
  설명     "...spinning wheels, and glowing rewards.
            BALL RUSH — Roll your mystic [ball]..."
  https://apps.apple.com/us/app/ballstorm-worldsslot/id6798464176
```

이름이 같은 것보다 나쁜 게 **이웃**이다. 슬롯머신 앱이고, 그 안에 "구슬 굴리기" 미니게임이
들어 있다. 4+ 등급 캐주얼 게임이 스토어 검색에서 카지노 앱과 나란히 뜬다.

### ❌ Numbash — 동명 게임이, 같은 장르로, 우리와 같은 4개 언어로

```
NumBash: Math Run Battle          (KR) NumBash: 수학 러너 대모험
  판매자   dongmin song            (JP) NumBash: 計算ランナー大冒険
  분류     Games                   (TW) NumBash: 數學跑酷大冒險
  출시     2026-08-07
  설명     "NumBash is a pixel-art runner where you battle monsters with math."
  https://apps.apple.com/us/app/numbash-math-run-battle/id6798232256
```

**러너 장르에, 숫자를 소재로, 우리가 노리는 4개 로케일에 이미 등록돼 있다.**
`LAUNCH.md §A` 의 Numbash 후보는 여기서 닫는다.

### ❌ Snakeball 유지

`Snake Balls`(평점 825개)가 US 스토어에 있다. 그보다 큰 문제는 **장르 오인**이다 —
'스네이크'를 검색해 들어온 사람이 기대하는 게임과 실제가 다르니, 검색 노출이 곧
잘못된 설치가 되고 D1 리텐션으로 되돌아온다. 이 게임은 뱀 게임이 아니다.

---

## 3. 스토어 충돌 실측 (2026-08-25)

**App Store** — iTunes Search API, `entity=software`, 접두 일치 기준, US/KR/JP/TW 4개 스토어프런트.

| 이름 | 결과 |
|---|---|
| Cubeball / Countball / Comboball / Ballcade / Rolldozer / Ballnova / Boomcube | **접두 일치 없음** |
| Ballstorm | Ballstorm WorldsSlot — 4개 스토어프런트 전부 |
| Numbash | NumBash: Math Run Battle — 4개 스토어프런트 전부 |
| Snakeball | Snake Balls (평점 825), Snake-Ball |

**Google Play** — 공식 API 가 없어 검색 페이지 HTML 을 긁었다. 위 후보 전부 접두 일치가
안 나왔지만, **이건 약한 신호다** — Play 는 결과 상당수를 JS 로 그리므로 누락이 있을 수 있다.
등록 직전에 Play Console 에서 한 번 더 볼 것.

---

## 4. 1위 `Cubeball` 을 고른 이유, 그리고 그 대가

| | |
|---|---|
| **받아쓰기** | '큐브'·'볼' 둘 다 한국어에 완전히 정착한 외래어다. 듣고 `Cubeball` 로 되짚어 쓰는 데 실패할 여지가 없다. 토스가 100% 한국인이고 초기 유저 대부분이 거기서 나오므로 이 항목을 가장 무겁게 봤다. |
| **장르적합** | 이 게임은 말 그대로 **공으로 큐브를 부수는** 게임이다. 이름이 게임을 그대로 말한다 — 개명하는 이유가 바로 이것이다. |
| **ASO** | 이 장르에서 사람들이 실제로 치는 두 단어 `cube` 와 `ball` 이 이름 하나에 다 들어간다. |
| **⚠️ 대가** | **이름을 소유할 수 없다.** 게임 내용을 그대로 서술한 조합이라 상표 등록이 어렵고, 카피캣이 `Cube Ball 3D` 로 붙어도 막을 법적 수단이 없다. 브랜드 검색량도 스스로 만들지 못한다. |
| **⚠️ 작은 위험** | `cube` 가 앞에 와서 "플레이어가 큐브"로 읽힐 여지가 조금 있다. 아이콘·스크린샷이 바로 잡아주지만, 부제에서 **공이 주어**임을 분명히 할 것. |

**`-dozer` 의 리듬이 마음에 든다면 `Balldozer`(볼도저).** `Rolldozer` 는 원어민 4명 전원이
문제를 지적했다 — 상세는 §6. `Balldozer` 는 그 문제 중 방어 불가한 것(한국어 '롤')을 한 글자로
없앤다. 4개 스토어프런트 모두 충돌 없음(2026-08-25 실측).

---

## 6. `Rolldozer` — 원어민 판정과 실측 (오너 선호 후보)

en / ja / zh-Hant / ko 원어민이 각각 독립 판정했다. **네 명 다 문제를 지적했고**
(en RISKY · ja RISKY · zh-Hant AVOID · ko AVOID), 그중 둘은 스토어 API 로 직접 확인했다.

### ① `dozer` 는 **코인 푸셔(카지노) 장르어**다 — 예상 못 했던 것

App Store 에서 `dozer` 를 검색한 결과 상위 14개:

| 스토어 | 코인 푸셔류 | 대표 |
|---|---|---|
| **US** | **6/14** | `Coin Dozer` **평점 87,126** — `dozer` 검색 2위 |
| **TW** | **11/14** | `推金幣經典街機遊戲 - Prizes Dozer`, `熊貓抓抓-9698推幣機捕魚機` 등 |

4+ 등급 캐주얼 게임이 **카지노 인접 클러스터**에 놓인다. 대만·홍콩에서 가장 심하다.

### ② 한국어 '롤' — Apple 의 색인 자체가 LoL 이다

KR App Store `롤` 검색 상위 10개가 **전부 라이엇 생태계**다:
와일드 리프트(43,913) · TFT(173,838) · 라이엇 모바일 · OP.GG · 롤 전적검색 · 와딩-롤 프로경기.
`롤도저` 로 검색하면 **JCB 굴착기 운전 앱**이 나온다. 기계도 사람도 같은 오독을 한다.

### ③ roll + dozer = **건설장비 × 2**

영어권 지적 중 가장 날카로운 것. `dozer` 는 bulldozer 이고 **`roll` 도 road roller(로드롤러)** 라
양쪽 다 중장비를 가리킨다. 실제로 US `dozer` 결과에 Dozer Demolish(19,338) ·
Excavator Simulator · Realistic Excavator Dozer 가 줄줄이 나온다.
일본어 `ロールドーザー` 는 `ロードローラー` 와 음이 섞이고 가타카나 표기가 갈린다.

### ④ 대안 `Balldozer` — 리듬은 남기고 방어 불가 문제만 제거

| | |
|---|---|
| **한국어** | `볼도저` — '볼'은 정착 외래어라 **LoL 충돌이 완전히 사라진다.** ②번이 해결된다 |
| **영어** | ball + bulldozer 의 말장난. 원어민이 즉시 알아채고, **게임을 정확히 묘사한다**(공 무리가 큐브를 밀어버림) |
| **일본어** | `ボールドーザー` — 오분절 없음 |
| **스토어** | US·KR·JP·TW **4곳 전부 접두 일치 없음** (2026-08-25 실측) |
| **⚠️ 남는 대가** | `dozer` 의 짐(①코인푸셔·③중장비)은 그대로다. 대만에서 가장 크다. Bulldozer 와 한 글자 차이라 검색에서 건설 앱 옆에 앉는다 |

**`Balldozer` 로 갈 경우 필수 보완**
- [ ] Apple Keywords 에 **`dozer` 를 절대 넣지 말 것** — 코인 푸셔 쿼리 유입은 CVR 을 깎는다
- [ ] 아이콘이 이름을 반박해야 한다 — 공 행렬 + 숫자 큐브가 한 화면에. 금속 질감은 중장비 연상을 키우니 피할 것
- [ ] 번체 중문명을 만들지 말고 영문 그대로 둘 것 (`推土機` 는 대만에서 강제철거 정치 기억과 붙는다)
- [ ] 표기는 `Balldozer` 한 단어, B만 대문자 (캐멀케이스 `BallDozer` 금지)

---

## 5. 결정 후 해야 할 일

### ⓪ 코드를 손대기 전에
- [ ] **토스 개발자 콘솔에서 슬러그 선점 가능 여부 확인.** 등록 후 영구 변경 불가라 이게 최우선.
- [ ] Play Console 에서 앱 이름 중복 재확인 (§3 의 Play 조회는 약한 신호다)
- [ ] 도메인은 `.app` / `.io` / `.game` 중 하나면 충분하다 (`.com` 은 대부분 임자가 있다)
- [ ] 번체 표기를 대만·홍콩 화자에게 1회 확인

### ① 바꾸지 않는 것 (확인함)
`studio.hodgepodge.snakeball`(번들 ID·패키지명), Firebase 프로젝트 `snakeball-game`,
호스팅 URL `https://snakeball-game.web.app`. **유저에게 안 보이고, 번들 ID 는 출시 후
변경 자체가 불가능하다.** 이름만 바꾸는 것이다.

### ② 코드 — 유저에게 보이는 이름
- [ ] `granite.config.ts:4` `appName` — **토스 슬러그, 등록 후 영구 불변.** 오타를 두 번 볼 것
- [ ] `granite.config.ts:6` `brand.displayName`
- [ ] `index.html:6` `<title>`
- [ ] `index.html:468` `<h1>` — **메뉴 화면의 대문 타이틀**
- [ ] `Mobile/iOS/Snakeball/Info.plist` — `CFBundleDisplayName` / `CFBundleName`
- [ ] `Mobile/iOS/Snakeball/WebView.swift:171` — 지원 메일 제목
- [ ] `Mobile/Android/app/src/main/res/values/strings.xml` — `app_name`
- [ ] `static/terms.html` · `static/privacy.html` 본문의 서비스명
- [ ] `npm run sync:public` → `npm run deploy:web`

### ③ 스크린샷 — **재작업이 필요하다**
`index.html:468` 의 `<h1>` 이 **메뉴 스크린샷(5번 프레임)에 그대로 찍혀 있다.**
캡션에는 이름이 없지만 게임 화면 안에 있다.

- [ ] `docs/store/frames/FRAME-5-menu.png` 재촬영 (절차: [store-screenshots.md](store-screenshots.md))
- [ ] `node tools/make-store-screenshots.mjs docs/store/frames docs/store/out` — 5번 8장 갱신
      (4언어 × 2규격). 1~4번과 Play 그래픽 이미지는 게임 화면에 이름이 없어 **그대로 쓴다**

### ④ 스토어 문구 — `docs/store-listing.md` 이름 필드 9곳
체크리스트가 그 문서 맨 아래에 있다. 바꾼 뒤 **반드시** `npm run check:listing` 을 돌릴 것
(글자수·Toss displayName 일치를 관문이 잡는다).

- [ ] Apple **Keywords 재계산** — 새 이름에 들어간 단어는 키워드에서 빼야 한다.
      `Cubeball` 이면 `cube`·`ball` 을 키워드에서 제거하고 그 자리를 다른 검색어로 채운다.
      (현재 여유: en 4자 · ko 4자 · ja 3자 · zh 4자밖에 없다)
- [ ] `en` Apple Subtitle 은 28/30 이라 여유가 2자뿐 — 키워드를 부제로 옮겨야 하면 재작성

---

## 부록 — 이 결론이 어떻게 나왔는가

- 생성 38개(4가지 전략: 서술형 / 조어 / 한국우선 / 소리우선) → 중복·하드제약 필터 후 **33개**
- 그중 **30개**를 원어민 적대 검증(스토어·상표·4개국어 어감·ASO 실조사).
  **3개는 검증하지 않았다** — 배치 상한(6개)에 걸려 `Rollbash` · `Combash` · `Boombap` 이
  누락됐다. 셋 다 소리우선 전략 산출물이고 같은 전략의 다른 후보가 대부분 REJECT 였다.
- 검증 결과 RECOMMEND 3개(Ballnova · Rolldozer · Ballstorm 3D), ACCEPTABLE 9개, 나머지 REJECT.
- **그 위에 App Store 검색 API 직접 조회를 얹어** 검증 에이전트의 판정 2건을 뒤집었다
  (Ballstorm·Numbash). 웹 검색만으로는 최근 출시 앱을 놓친다.
