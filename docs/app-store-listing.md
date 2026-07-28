# 스토어 등록 문구 (초안)

> 제출 시 각 콘솔에 붙여넣는 필드 모음. **아직 확정 아님** — §0 의 결정 대기 항목부터 처리.
> 여기 적힌 숫자는 전부 코드에서 확인한 실제 값이다(스킨 14, 파워업 3, 미션 8 중 3 로테이션,
> 7일 출석). **없는 기능을 쓰지 말 것** — 특히 광고는 현재 `ADS_ENABLED=false` 라 꺼져 있고,
> `remove.ads`/스타터팩은 존재하지 않는다.

---

## 0. 먼저 결정해야 하는 것 (오너)

| 항목 | 상태 |
|---|---|
| **앱 이름** | ⚠️ **미확정**. `LAUNCH.md §A` 에 "Numbash / 넘배시" 후보가 열려 있음. **Toss 슬러그는 등록 후 변경 불가**라 이것부터. 아래 문구는 전부 "Snakeball" 기준. |
| 가격 | 무료 + 인앱결제 4종 |
| 연령 등급 | 아래 §5 답안 초안 참고 |
| 출시 국가 | 미정 (Toss 는 한국 전용) |

---

## 1. Apple App Store

**Name** (30자):
```
Snakeball
```

**Subtitle** (30자):
```
Roll, smash, grow, repeat
```
(25자)

**Promotional Text** (170자 · 심사 없이 수정 가능):
```
New: swipe down to drop fast and dodge overhead bars. Plus a calmer soundtrack you
can toggle on in Settings.
```

**Keywords** (100 **바이트**, 쉼표 구분, 공백 넣지 말 것):
```
ball,roll,runner,endless,arcade,smash,cube,neon,combo,dodge,casual,one hand,skins
```
(81바이트)

**Description**:
```
Roll a growing ball of balls down a neon highway.

Smash through numbered cubes — but only if your ball count beats their number.
Dodge iron cubes and overhead bars, grab mega-balls to blast through anything,
and chain breaks into a combo multiplier that pays out in coins.

One thumb. No timers. Just how far can you get.

WHAT'S IN IT
• Endless neon highway that keeps getting faster
• 14 ball skins — from a plain classic to a beach ball, an 8-ball, an eyeball,
  and an animated rainbow
• 3 power-ups: Head Start, Coin Magnet, Shield
• Daily missions and a 7-day reward streak
• Global leaderboard — see where you land worldwide

Free to play. Optional in-app purchases for coins and gems.
```

**What's New** (첫 출시):
```
First release. Roll out.
```

**Support URL**: `https://www.hodgepodge.studio/support.html`
**Privacy Policy URL**: `https://snakeball-game.web.app/privacy.html`

---

## 2. Google Play

**앱 이름** (30자): `Snakeball`

**간단한 설명** (80자):
```
Roll a growing ball down a neon highway. Smash cubes, chain combos, go further.
```
(78자)

**자세한 설명** (4000자) — App Store 본문 재사용 가능. Play 는 이모지/과장 표현
("최고", "1위")에 민감하니 위 문구 그대로가 안전.

---

## 3. Apps in Toss (한국어)

**앱 이름**: `스네이크볼` (`granite.config.ts` `displayName` 과 일치)

**한 줄 소개**:
```
네온 도로를 굴러 내려가며 숫자 큐브를 부수는 원터치 아케이드
```

**설명**:
```
공을 굴려 숫자 큐브를 부수세요.

내 공 개수가 큐브의 숫자보다 많아야 부술 수 있습니다. 철 큐브와 공중 바를 피하고,
메가볼을 먹어 전부 밀어버리세요. 연속으로 부술수록 콤보 배수가 올라가고 코인도 더 많이
쌓입니다.

• 점점 빨라지는 무한 네온 하이웨이
• 볼 스킨 14종 · 파워업 3종
• 일일 미션 · 7일 출석 보상
• 전 세계 랭킹
```

---

## 4. 스크린샷 (미제작)

필요 규격 — **제가 시뮬레이터/브라우저로 뽑을 수 있음**:

| 스토어 | 규격 | 장수 |
|---|---|---|
| App Store | 6.9" (1320×2868) + 6.5" (1242×2688) | 3~10 |
| Play | 1080×1920 이상, 16:9~9:16 | 2~8 |
| Play 그래픽 이미지 | 1024×500 | 1 (필수) |

찍을 화면 추천: ① 콤보가 터지는 게임플레이 ② 볼이 길게 늘어난 순간 ③ 상점 스킨 그리드
④ 리더보드 ⑤ 결과 화면. **첫 장이 전환율을 지배**하므로 ①을 대표로.

---

## 5. 연령 등급 설문 답안 초안

코드 기준 사실:
- 폭력/공포/성적 콘텐츠 **없음**
- 도박 요소 **없음** (확률형 아이템 없음 — 스킨은 전부 고정가 직접 구매)
- 사용자 간 채팅/메시지 **없음**
- 유저 생성 콘텐츠: **닉네임만** (서버 금칙어 필터 + 1~16자)
- 위치정보 수집 **없음**
- 인앱결제 **있음** (소비성 4종)
- 광고: **현재 비활성**(`ADS_ENABLED=false`). 켤 때 설문을 다시 확인할 것 — 리워드 광고만
  있고 개인화 광고는 하지 않음(iOS ATT 미사용, Android npa=1 강제)

→ 예상 등급: App Store **4+**, Play **전체이용가**(광고 켜면 재확인).

---

## 6. Play 데이터 보안 (Data safety) 답안 초안

`static/privacy.html` 및 `PrivacyInfo.xcprivacy` 와 반드시 일치시킬 것.

| 항목 | 답 |
|---|---|
| 데이터 수집 | 예 |
| 수집 항목 | 앱 활동(게임 진행도) · 기기 식별자 · 구매 내역 · 사용자 ID |
| 계정에 연결됨 | 예 (전부 `users/{uid}` 문서) |
| 추적 목적 사용 | **아니요** |
| 전송 중 암호화 | 예 (HTTPS/TLS) |
| 삭제 요청 가능 | 예 — 설정 → Delete My Data |
| 제3자 공유 | 광고 SDK(AdMob)만, 광고 켤 때 해당 |
