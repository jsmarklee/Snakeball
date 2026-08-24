# Snakeball 스토어 등록 문구 — 최종본 (4개 언어)

**작성 2026-08-25 · 검수자 지적 반영 완료 · 코드(`index.html`, `functions/`) 대조 검증 완료**

## 이 문서 쓰는 법

- 각 필드는 코드펜스 안의 텍스트를 **그대로 복사해서** 스토어 콘솔에 붙여넣는다. 펜스 바깥의 `(NN자 / 한도)` 는 참고용이며 붙여넣지 않는다.
- 글자 수는 전부 `python3 len()`(코드포인트) 실측이다. 스토어 콘솔이 카운트를 다르게 셀 수 있으니 붙여넣은 뒤 콘솔 표시도 한 번 확인한다.
- Apple Keywords 는 **쉼표만, 공백 0개**다. 편집기가 공백을 넣지 않도록 주의.
- 줄바꿈이 있는 필드(Description / What's New)는 빈 줄까지 그대로 살려야 한다.

## ⚠️ 앱 이름은 아직 미확정이다

본문 전체가 **"Snakeball" 을 자리표시자로** 쓴다. 본문 카피는 어디에서도 이름의 뜻(뱀/스네이크/이어짐)에 기대지 않으므로, 이름이 확정되면 **이름 필드만 바꾸면 되고 본문은 손댈 필요가 없다.** 바꿔야 하는 자리는 맨 아래 체크리스트에 모아 뒀다.

## 4개 언어 공통 사실 (교차 일관성 기준값)

이 값들은 4개 언어가 **모두 동일하게** 말한다. 하나를 고치면 4개 언어를 같이 고친다.

| 항목 | 확정 표기 | 근거 |
|---|---|---|
| 레인 | 5 | 코드 확인 |
| 공중 바 | 빨강 = 즉사, 나머지 = 볼 약 45% 손실 | 코드 확인 |
| 콤보 | 5연속마다 +0.5, x1.5/x2.0/x3.0, **상한 없음**, 3초 미달성 시 초기화 | `comboMultiplier() = 1 + floor(combo/5)*0.5` (index.html:5217) |
| 스킨 | 14종, **Watermelon / Disco Ball**(Melon·Disco 아님), 기본 스킨 Classic 은 무료 | index.html:712~727 |
| 파워업 | Head Start 200 / Coin Magnet 250 / Shield 300 코인, Shield = **즉사 1회 방어** | index.html:731~733 (`Survive one deadly hit`) |
| 데일리 미션 | **매일 3개, 날마다 새로 로테이션** — 풀 크기 숫자는 쓰지 않는다 | 풀 8개 중 `revive1`(needsAds)이 `ADS_ENABLED=false`에서 제외돼 실제 7개 (index.html:680, 744-757, 1258) |
| 출석 | 7일 연속, 하루 빠지면 처음부터 | functions/coinSystem.js |
| 리더보드 | 전 세계 상위 50위, 닉네임 1~16자 | 코드 확인 |
| 부활 | 한 판 최대 3회, 젬 지불, **매회 비용 상승 — 숫자는 쓰지 않는다** | 비용이 서버 `config_public.revive_gem_base/step` 런타임 값 (index.html:1941) |
| 인앱결제 | 4종 소비형: 코인 5,000 / 코인 30,000 / **젬 50 / 젬 200**, 구독 없음 | index.html:738~741 |
| 게임 내 언어 | **영어 UI** — 한국어/일본어/번체 본문에 1줄 고지 | `<html lang="en">`, HUD·상점 전부 영문 |
| 광고 | 언급 0건 (ADS_ENABLED=false) | index.html:680 |
| 오프라인 | 주장 0건, 반대로 "인터넷 연결 필요" 명시 | 서버 권위 경제 |

## 검수자 의견 중 **일부러 반영하지 않은** 것

| 검수자 | 지적 | 판단 |
|---|---|---|
| 한국어 · 繁體 | 키워드에 `무료` / `免費` 추가 | **미반영.** 일본어 검수자가 지적한 App Store 심사 가이드 2.3.7(메타데이터에 가격 표현 금지)이 4개 언어에 똑같이 적용된다. Apple Keywords 에서만 뺐고, 같은 규제가 없는 **Play 간단한 설명에는 `무료`/`免費` 를 남겼다.** |
| English | 부활 비용 `5, then 10, then 15` 유지 | **미반영.** 한국어 검수자 지적대로 이 값은 서버 config 런타임 값이라 심사 없이 못 고치는 Apple Description 에 박으면 안 된다. 4개 언어 모두 숫자를 뺐다. |
| 日本語 · 繁體 | 콤보 상한 문제를 못 잡음 | **추가 수정.** 두 언어 모두 x3.0 이 상한처럼 읽혔다. 영어·한국어와 동일하게 "상한 없음"으로 통일. 繁體는 `連擊倍率最高 x3.0` 이라는 소제목·whatsNew 문구까지 교체했다. |
| 한국어 · 繁體 | 미션 풀 `8개` 를 못 잡음 | **추가 수정.** 실제 로테이션 풀이 7개라 4개 언어 모두 풀 크기 숫자를 삭제했다. |
| 한국어 | 파워업 코인 가격(200/250/300) 생략 | **미반영(가격 포함).** 영어·일본어·번체가 전부 표기하고 있어 한국어만 빼면 교차 불일치가 된다. 4개 언어 모두 표기. |
| 日本語 | 게임 내 영어 UI 고지 1줄 추가 | **확대 적용.** 일본어에만 넣으면 한국·대만 유저에게는 같은 리스크가 남는다. 한국어·번체·Toss 에도 동일 취지의 1줄을 넣었다(영어는 불필요). |

---

# 🇰🇷 한국어 (ko)

## Apple App Store

### Name — 19자 / 30

```
Snakeball: 볼 굴리기 러너
```

### Subtitle — 25자 / 30

```
한 손 스와이프, 숫자 큐브 부수고 콤보 쌓기
```

### Promotional Text — 127자 / 170

```
오늘도 한 판. 볼을 모아 큐브를 부수고, 콤보가 끊기기 전에 다음 큐브로.
스킨 14종, 매일 새로 도는 미션 3개, 7일 출석 보상까지. 확률형(가챠) 상품은 하나도 없습니다.
전 세계 상위 50위 랭킹에 이름을 올려보세요.
```

### Keywords — 96자 / 100 (공백 0개, 24토큰)

```
캐주얼,미니,게임,킬링타임,시간때우기,무한,달리기,장애물,피하기,점프,랭킹,점수,스킨,꾸미기,3D,아케이드,순발력,반사신경,중독성,고득점,한손,혼자하는게임,심심풀이,공굴리기
```

### Description — 1,373자 / 4,000

```
볼을 굴려 5개 레인을 달리는 3D 러너입니다.
내 볼보다 숫자가 작은 큐브만 부술 수 있습니다.
조작은 스와이프 하나. 좌우로 이동, 위로 점프, 아래로 급강하.

[ 굴릴수록 길어집니다 ]
바닥에 떨어진 볼을 먹으면 뒤로 행렬이 길어집니다. 행렬이 길수록 더 큰 숫자의 큐브를 뚫을 수 있고, 부순 만큼 볼은 다시 줄어듭니다. 어디까지 모으고 어디서 쓸지, 그 판단이 기록을 만듭니다.

[ 한눈에 보고 정하세요 ]
· 숫자 큐브 — 내 볼이 더 많으면 통과, 적으면 거기서 끝입니다.
· 철 큐브 — 부술 수 없습니다. 닿으면 즉시 종료됩니다.
· 공중 바 — 빨간 레이저는 닿는 순간 끝, 나머지는 볼의 약 45%가 날아갑니다.
· 메가볼 — 먹으면 일정 시간 동안 앞에 있는 걸 전부 밀어버립니다.
· 코인 — 노면에 흩뿌려져 있고, 주운 만큼 한 판이 끝날 때 지급됩니다.

[ 콤보가 점수를 만듭니다 ]
큐브를 연속으로 부수면 5연속마다 배수가 0.5씩 오릅니다. 5연속 x1.5, 10연속 x2.0, 20연속 x3.0 — 상한은 없습니다.
단, 3초 안에 다음 큐브를 못 부수면 배수는 처음으로 돌아갑니다. 점수가 높을수록 받는 코인도 늘어납니다.

[ 모으는 재미 ]
· 볼 스킨 14종 — Classic, Mint, Lime, Coral, Gold, Ruby, Galaxy, 색이 계속 도는 Rainbow, Beach Ball, Basketball, 8-Ball, Watermelon, Eyeball, Disco Ball. 기본 스킨은 무료이고, 나머지는 전부 고정가 직접 구매입니다. 확률형(가챠) 상품은 없습니다.
· 파워업 3종 — Head Start(+8볼로 시작, 200코인), Coin Magnet(한 판 내내 코인 자동 수집, 250코인), Shield(즉사 1회 방어, 300코인).
· 데일리 미션 — 매일 3개가 새로 돌아옵니다. 보상은 코인 또는 젬.
· 출석 보상 — 7일 연속 스트릭. 하루라도 빠지면 처음부터 다시 시작합니다.

[ 기록으로 남습니다 ]
전 세계 상위 50위 랭킹에 이름을 올릴 수 있습니다. 닉네임은 1~16자.
한 판에서 최대 3회까지 부활할 수 있고, 부활할 때마다 젬 비용이 올라갑니다.

[ 미리 알아두실 점 ]
· 무료로 플레이합니다. 인앱결제는 코인 2종과 젬 2종, 모두 4가지입니다(코인 5,000 / 코인 30,000 / 젬 50 / 젬 200). 구독은 없습니다.
· 점수와 재화는 서버에 저장됩니다. 플레이하려면 인터넷 연결이 필요합니다.
· 게임 안의 글자는 영어입니다. 조작은 스와이프뿐이고, 규칙은 숫자와 아이콘으로 보여줍니다.
· 스테이지도 제한 시간도 없습니다. 얼마나 멀리 가느냐만 남습니다.

한 손이 비는 순간마다 한 판. 어제의 기록을 깨는 게 목표입니다.
```

### What's New — 133자 / 4,000

```
첫 출시입니다.

볼 스킨 14종, 파워업 3종, 매일 3개씩 새로 도는 데일리 미션, 7일 출석 보상, 전 세계 상위 50위 랭킹까지 모두 담았습니다.

플레이해 보시고 불편한 점이나 아쉬운 점은 언제든 알려주세요. 빠르게 고치겠습니다.
```

## Google Play

### 앱 이름 — 19자 / 30

```
Snakeball: 볼 굴리기 러너
```

### 간단한 설명 — 66자 / 80

```
볼을 모아 숫자 큐브를 부수는 무료 3D 러닝 게임. 한 손 스와이프로 달리고, 콤보 쌓아 전 세계 랭킹에 도전하세요.
```

### 자세한 설명 — 1,330자 / 4,000

```
볼을 굴려 5개 레인을 달리는 3D 러너입니다. 내 볼보다 숫자가 작은 큐브만 부술 수 있습니다. 조작은 스와이프 하나 — 좌우로 이동, 위로 점프, 아래로 급강하.

■ 굴릴수록 길어집니다
바닥의 볼을 먹으면 뒤로 행렬이 길어집니다. 행렬이 길수록 더 큰 숫자의 큐브를 뚫을 수 있고, 부순 만큼 볼은 다시 줄어듭니다. 어디까지 모으고 어디서 쓸지 정하는 게 이 게임의 전부입니다.

■ 코스에서 만나는 것들
· 숫자 큐브 — 내 볼이 더 많으면 통과, 적으면 거기서 끝입니다.
· 철 큐브 — 부술 수 없습니다. 닿으면 즉시 종료됩니다.
· 공중 바 — 빨간 레이저는 닿는 순간 끝, 나머지는 볼의 약 45%가 날아갑니다.
· 메가볼 — 먹으면 일정 시간 동안 앞에 있는 걸 전부 밀어버립니다.
· 코인 — 노면에 흩뿌려져 있고, 주운 만큼 한 판이 끝날 때 지급됩니다.

■ 콤보가 점수를 만듭니다
큐브를 연속으로 부수면 5연속마다 배수가 0.5씩 오릅니다. 5연속 x1.5, 10연속 x2.0, 20연속 x3.0이고 상한은 없습니다. 3초 안에 다음 큐브를 못 부수면 처음으로 돌아갑니다. 점수가 높을수록 받는 코인도 늘어납니다.

■ 모으는 재미
· 볼 스킨 14종 — Classic, Mint, Lime, Coral, Gold, Ruby, Galaxy, 색이 계속 도는 Rainbow, Beach Ball, Basketball, 8-Ball, Watermelon, Eyeball, Disco Ball. 기본 스킨은 무료이고, 나머지는 전부 고정가 직접 구매입니다. 확률형(가챠) 상품은 없습니다.
· 파워업 3종 — Head Start(+8볼로 시작, 200코인), Coin Magnet(한 판 내내 코인 자동 수집, 250코인), Shield(즉사 1회 방어, 300코인).
· 데일리 미션 — 매일 3개가 새로 돌아옵니다. 보상은 코인 또는 젬.
· 출석 보상 — 7일 연속 스트릭. 하루라도 빠지면 처음부터 다시 시작합니다.
· 전 세계 상위 50위 랭킹 — 닉네임은 1~16자로 정합니다.
· 부활 — 한 판에서 최대 3회, 부활할 때마다 젬 비용이 올라갑니다.

■ 미리 알아두실 점
· 무료로 플레이합니다. 인앱결제는 코인 2종과 젬 2종, 모두 4가지입니다(코인 5,000 / 코인 30,000 / 젬 50 / 젬 200). 구독은 없습니다.
· 점수와 재화는 서버에 저장됩니다. 플레이하려면 인터넷 연결이 필요합니다.
· 게임 안의 글자는 영어입니다. 조작은 스와이프뿐이고, 규칙은 숫자와 아이콘으로 보여줍니다.
· 스테이지도 제한 시간도 없습니다. 얼마나 멀리 가느냐만 남습니다.

한 손이 비는 순간마다 한 판. 어제의 기록을 깨는 게 목표입니다.
```

## Apps in Toss

### 앱 이름 — 5자 (`granite.config.ts` displayName 과 일치 확인함)

```
스네이크볼
```

### 한 줄 소개 — 32자

```
한 손 스와이프로 볼을 굴려 숫자 큐브를 부수는 3D 러너
```

### 설명 — 672자

```
볼을 굴려 5개 레인을 달리는 3D 러너입니다. 조작은 스와이프 하나 — 좌우로 이동, 위로 점프, 아래로 급강하. 한 손이면 충분합니다.

바닥의 볼을 먹으면 뒤로 행렬이 길어지고, 내 볼보다 숫자가 작은 큐브만 부술 수 있습니다. 부순 만큼 볼은 다시 줄어드니 어디까지 모으고 어디서 쓸지 정하는 게 기록을 가릅니다. 검은 철 큐브와 빨간 레이저는 닿는 순간 끝이니 피하세요.

큐브를 연속으로 부수면 5연속마다 점수 배수가 0.5씩 오릅니다. 5연속 x1.5, 10연속 x2.0, 20연속 x3.0이고 상한은 없습니다. 3초 안에 다음 큐브를 못 부수면 처음으로 돌아갑니다.

· 볼 스킨 14종 (기본 스킨은 무료, 나머지는 고정가 직접 구매 · 확률형 없음)
· 파워업 3종 — Head Start(+8볼, 200코인), Coin Magnet(250코인), Shield(즉사 1회 방어, 300코인)
· 데일리 미션 매일 3개, 7일 연속 출석 보상
· 전 세계 상위 50위 랭킹, 한 판 최대 3회 부활(젬으로 지불)

무료로 플레이하고, 인앱결제는 코인 5,000 / 코인 30,000 / 젬 50 / 젬 200 네 가지뿐입니다. 게임 안의 글자는 영어이며, 조작은 스와이프뿐이라 규칙은 숫자와 아이콘으로 보여줍니다. 점수와 재화가 서버에 저장되므로 플레이하려면 인터넷 연결이 필요합니다.
```

---

# 🇺🇸 English (en-US)

## Apple App Store

### Name — 24자 / 30

```
Snakeball: Neon Ball Run
```

### Subtitle — 28자 / 30

```
Endless runner. Smash cubes.
```

### Promotional Text — 164자 / 170

```
Roll a growing ball. Break numbered cubes only when your count beats the number. Chain 20 in a row, ride the x3.0 multiplier, then take a slot in the global top 50.
```

### Keywords — 96자 / 100 (공백 0개, 16토큰)

```
3d,rolling,crowd,dodge,swipe,combo,jump,lane,dash,rush,arcade,casual,hyper,reflex,stack,obstacle
```

> 여유 4자. 앱 이름이 `Snakeball` 로 확정되면 Apple 은 이를 한 토큰으로만 색인하므로 `,snake`(6자)를 넣을 자리가 없다 — 넣으려면 `obstacle` 대신 교체할 것.

### Description — 2,142자 / 4,000

```
Roll a growing ball down a neon highway. Numbered cubes block the road — you only break the ones your ball count beats, and you lose that many balls doing it.

One thumb runs everything. Swipe left and right across five lanes, up to jump, down to slam back down.

WHAT KILLS YOU
Black iron cubes cannot be broken. Touch one and the run is over. Red laser bars do the same. Other overhead bars are survivable — they shave off about 45% of your balls. Grab a Mega Ball and none of it matters for a few seconds: you plow straight through.

COMBOS PAY
Break cubes back to back and the multiplier climbs. Every 5 in a row adds another half: x1.5 at 5, x2.0 at 10, x3.0 at 20, and it keeps going from there. Go three seconds without a break and it drops to x1. The multiplier feeds your score, and your score feeds your coin payout, so a clean streak is worth grinding for.

NO STAGES, NO CEILING
No levels, no bosses, no timer, no story. The road just gets faster and the field of view keeps widening until you make a mistake. Then you go again.

WHAT YOU KEEP
- 14 ball skins: Classic, Mint, Lime, Coral, Gold, Ruby, Galaxy, Beach Ball, Basketball, 8-Ball, Watermelon, Eyeball, Disco Ball, and an animated Rainbow that cycles color. The starter skin is free. Every other one is a fixed price you buy directly with coins or gems — no loot boxes, no crates, no odds.
- 3 power-ups you arm before a run: Head Start (+8 balls, 200 coins), Coin Magnet (pulls in coins for the whole run, 250 coins), Shield (survive one deadly hit, 300 coins).
- 3 daily missions, rotated fresh every day. Play 3 games. Break 100 cubes. Land a 15x combo. Coins or gems either way.
- A 7-day login streak that resets if you skip a day.
- Revives. Up to 3 per run, paid in gems, and the price climbs each time.

THE BOARD
One global leaderboard, top 50 only. Pick a name up to 16 characters and go take a slot.

Free to play. Four in-app purchases, all consumable: 5,000 coins, 30,000 coins, 50 gems, and 200 gems. Nothing is a subscription. An internet connection is required — your coins, gems, and skins are stored on the server, not on the device, so they follow you.
```

### What's New — 216자 / 4,000

```
First release.

14 ball skins, 3 power-ups, 3 daily missions that rotate fresh every day, a 7-day streak, and a global top 50 to climb.

Found something broken or unfair? Tell us. We read everything and we ship fast.
```

## Google Play

### 앱 이름 — 24자 / 30

```
Snakeball: Neon Cube Run
```

> Apple 과 **일부러 다르다.** Play 는 부분문자열 매칭이라 `Snakeball` 안의 `ball` 이 이미 잡히므로 `Ball` 반복은 스팸 신호만 되고 얻는 게 없다. 그 자리를 `Cube` 로 바꿔 핵심 명사를 하나 더 색인시킨다. Apple 은 `Snakeball` 을 통짜 한 토큰으로 색인하므로 `Ball` 을 남기는 편이 유리하다.

### 간단한 설명 — 77자 / 80

```
Roll a growing ball, smash numbered cubes, chase combos. One-thumb 3D runner.
```

### 자세한 설명 — 2,267자 / 4,000

```
Roll a growing ball down a neon highway and smash your way through numbered cubes.

The rule is simple: a cube shows a number, and you only break it if your ball count is higher. Break it and you lose that many balls. Get greedy at the wrong cube and the run ends.

CONTROLS
One thumb. Swipe left and right across five lanes, swipe up to jump, swipe down to slam.

THE ROAD
- Numbered cubes: break them if your count beats the number.
- Iron cubes (black): unbreakable. Contact ends the run.
- Overhead bars: red lasers end the run. The rest take roughly 45% of your balls.
- Mega Balls: for a few seconds you push through anything.
- Coins: scattered across the road, paid out when the run ends.

COMBOS
Break cubes back to back and the multiplier climbs. Every 5 in a row adds another half: x1.5 at 5, x2.0 at 10, x3.0 at 20, and it keeps going from there. Three seconds without a break and it resets. Score is multiplied, and score decides your coin payout.

COLLECT
14 ball skins: Classic, Mint, Lime, Coral, Gold, Ruby, Galaxy, Beach Ball, Basketball, 8-Ball, Watermelon, Eyeball, Disco Ball, and an animated Rainbow that cycles color. The starter skin is free. Every other one is a fixed price you buy directly with coins or gems — no loot boxes, no crates, no odds.

3 power-ups you arm before a run:
- Head Start: begin with +8 balls (200 coins)
- Coin Magnet: pull in coins for the whole run (250 coins)
- Shield: survive one deadly hit (300 coins)

COME BACK
3 daily missions rotate in fresh every day — play 3 games, break 100 cubes, collect 300 coins, land a 15x combo, and more. They pay coins or gems. A 7-day login streak runs alongside them, and it resets if you skip a day.

Died on a good run? Revive with gems, up to 3 times per run. The price climbs each time.

LEADERBOARD
One global board, top 50. Pick a name up to 16 characters and take a slot.

WHAT TO EXPECT
No stages, no bosses, no story, no timer. Single player, no chat. The road gets faster, the view gets wider, and you keep going until you make a mistake.

Free to play with four consumable in-app purchases: 5,000 coins, 30,000 coins, 50 gems, and 200 gems. No subscriptions. An internet connection is required — coins, gems, and skins live on the server so they follow your account.
```

---

# 🇯🇵 日本語 (ja)

## Apple App Store

### Name — 21자 / 30

```
Snakeball：ボール転がしアクション
```

### Subtitle — 18자 / 30

```
片手スワイプの暇つぶし3Dランゲーム
```

### Promotional Text — 112자 / 170

```
配信開始。数字より多くのボールを集めてキューブを砕く、片手だけの3Dランゲームです。コンボ倍率でスコアを伸ばし、世界ランキング上位50位に挑戦できます。スキン14種・パワーアップ3種・毎日入れ替わるミッションを用意しました。
```

### Keywords — 97자 / 100 (공백 0개, 19토큰)

```
玉転がし,ひまつぶし,カジュアル,エンドレス,ランナー,反射神経,ハイスコア,ランキング,コンボ,障害物,避ける,ネオン,爽快,シンプル,やりこみ,ミッション,デイリー,着せ替え,スコアアタック
```

### Description — 1,235자 / 4,000

```
数字より多くのボールを集めて、キューブを砕く。
指1本のスワイプだけで走る、3Dのエンドレスランゲームです。
ステージも制限時間もなく、始めた瞬間から走り出せます。

■ 操作は指1本
・左右スワイプで5レーンを移動
・上スワイプでジャンプ、下スワイプで急降下
・覚えることはこれだけ。あとは反射神経の勝負です

■ 増やすか、砕くか
・手持ちのボールがキューブの数字を上回っているときだけ、そのキューブを砕けます
・砕くと、その数だけボールが減ります
・黒い鉄キューブは砕けません。触れるとそこで終了です
・赤いレーザーバーに当たっても終了です。それ以外の空中バーに当たると、ボールを約45%失います
・メガボールを取ると、一定時間なんでも弾き飛ばせます
・路面に散らばったコインは、プレイ終了時にまとめて受け取れます

■ コンボが伸びるほど、スコアが跳ねる
・5連続ごとに倍率が0.5ずつ上がります（上限なし）
・5連続でx1.5、10連続でx2.0、20連続でx3.0
・3秒以内に次のキューブを砕けないとリセット
・倍率はスコアに掛かり、スコアはコイン獲得量に反映されます

■ 集めて、着せ替える
・ボールスキン14種 — Classic、Mint、Lime、Coral、Gold、Ruby、Galaxy、色が巡るRainbow、Beach Ball、Basketball、8-Ball、Watermelon、Eyeball、Disco Ball
・初期スキンは無料。ほかはコインまたはジェムで買います
・すべて固定価格の直接購入です。ガチャ・抽選・ランダム要素はありません

■ パワーアップ3種（消費型・コインで購入）
・ヘッドスタート：ボール8個を持ってスタート（200コイン）
・コインマグネット：プレイ中のコインを自動で集める（250コイン）
・シールド：一発アウトを1回だけ防ぐ（300コイン）

■ 毎日、戻ってくる理由
・デイリーミッションは毎日3つ、日替わりで入れ替わります
・ログインボーナスは7日連続のストリーク。1日でも空くと最初に戻ります
・報酬はコインまたはジェム

■ 世界ランキング
・上位50位まで掲載
・ニックネームは1〜16文字。サーバー側で不適切な語をフィルタリングします

■ もう一度だけ走りたいときに
・1回のプレイでコンティニューは最大3回まで
・ジェムで支払い、費用は1回ごとに上がります

■ 課金について
・基本プレイ無料
・アプリ内課金は消費型4種のみ（コイン5,000枚／コイン30,000枚／ジェム50個／ジェム200個）。サブスクリプションはありません
・ゲーム内の表記は英語です（操作はスワイプのみ、ルールは数字とアイコンで示されます）
・ランキングとアイテムはサーバーで管理しているため、プレイにはインターネット接続が必要です

数分の待ち時間にも、寝る前の一戦にも。次はもう少しだけ遠くへ。
```

### What's New — 167자 / 4,000

```
初回リリースです。

・5レーンを走る3Dラン、数字キューブのコアルール
・コンボ倍率、メガボール、コイン集め
・ボールスキン14種、パワーアップ3種
・デイリーミッション（毎日3つ）と7日間のログインボーナス
・世界ランキング上位50位

遊んでいて気になった点があれば、ぜひご意見をお寄せください。次のアップデートの参考にします。
```

## Google Play

### 앱 이름 — 20자 / 30

```
Snakeball：ボール転がし3Dラン
```

### 간단한 설명 — 64자 / 80

```
数字より多くのボールを集めてキューブを砕く、片手スワイプの爽快カジュアルアクション。コンボをつないで世界ランキング上位50位へ。
```

### 자세한 설명 — 1,211자 / 4,000

```
数字より多くのボールを集めて、キューブを砕く。
指1本のスワイプだけで遊べる、3Dのエンドレスランゲームです。
ステージも制限時間もなく、始めた瞬間から走り出せます。

【操作】
・左右スワイプで5レーンを移動
・上スワイプでジャンプ、下スワイプで急降下
・覚えることはこれだけです

【コアルール】
・手持ちのボールがキューブの数字を上回っているときだけ、そのキューブを砕けます
・砕くと、その数だけボールが減ります
・黒い鉄キューブは砕けません。触れるとそこで終了です
・赤いレーザーバーに当たっても終了です。それ以外の空中バーに当たると、ボールを約45%失います
・メガボールを取ると、一定時間なんでも弾き飛ばせます
・路面に散らばったコインは、プレイ終了時にまとめて受け取れます
・進むほど速度が上がり、視界も広がっていきます

【コンボ】
・5連続ごとに倍率が0.5ずつ上がります（上限なし）
・5連続でx1.5、10連続でx2.0、20連続でx3.0
・3秒以内に次のキューブを砕けないとリセット
・倍率はスコアに掛かり、スコアはコイン獲得量に反映されます

【コレクション】
・ボールスキン14種：Classic、Mint、Lime、Coral、Gold、Ruby、Galaxy、色が巡るRainbow、Beach Ball、Basketball、8-Ball、Watermelon、Eyeball、Disco Ball
・初期スキンは無料。ほかはコインまたはジェムで買います
・すべて固定価格の直接購入です。ガチャ・抽選・ランダム要素はありません

【パワーアップ3種（消費型・コインで購入）】
・ヘッドスタート：ボール8個を持ってスタート（200コイン）
・コインマグネット：プレイ中のコインを自動で集める（250コイン）
・シールド：一発アウトを1回だけ防ぐ（300コイン）

【毎日の楽しみ】
・デイリーミッション：毎日3つ、日替わりで入れ替わります
・ログインボーナス：7日連続のストリーク。1日でも空くと最初に戻ります
・報酬はコインまたはジェム

【ランキング】
・世界ランキングは上位50位まで掲載
・ニックネームは1〜16文字。サーバー側で不適切な語をフィルタリングします

【コンティニュー】
・1回のプレイで最大3回まで
・ジェムで支払い、費用は1回ごとに上がります

【課金について】
・基本プレイ無料
・アプリ内課金は消費型4種のみ（コイン5,000枚／コイン30,000枚／ジェム50個／ジェム200個）。サブスクリプションはありません
・ゲーム内の表記は英語です（操作はスワイプのみ、ルールは数字とアイコンで示されます）
・ランキングとアイテムはサーバーで管理しているため、プレイにはインターネット接続が必要です

数分の待ち時間にも、寝る前の一戦にも。次はもう少しだけ遠くへ。
```

---

# 🇹🇼🇭🇰 繁體中文 (zh-Hant · 台灣/香港 공용)

## Apple App Store

### Name — 16자 / 30

```
Snakeball 霓虹滾球跑酷
```

### Subtitle — 25자 / 30

```
單手滑動，撞碎數字方塊，閃過鐵方塊，連擊衝上排行榜
```

### Promotional Text — 99자 / 170

```
球越滾越多，才撞得碎更大的數字方塊。每連續撞碎 5 個，連擊倍率就再加 0.5，分數與拿到的金幣一起往上跳。黑色鐵方塊、紅色橫桿碰到就結束。14 種造型、每天 3 個任務、全球前 50 名榜單等你。
```

### Keywords — 96자 / 100 (공백 0개, 28토큰)

```
休閒,小遊戲,手遊,街機,無盡,閃避,反應,極速,賽道,跳躍,衝刺,排名,道具,造型,挑戰,上癮,打發時間,球,速度,紀錄,3D,runner,endless,反射神經,放鬆,彈跳,躲避,單手
```

### Description — 942자 / 4,000

```
帶著一長串球，一路滾下霓虹賽道。球比方塊上的數字多，就撞得碎；不夠，就先閃過去。
一根手指決定一切：左右滑動在 5 條車道間移動，向上滑跳起來，向下滑砸下去。
沒有關卡、沒有倒數，只有越跑越快的無盡賽道。

■ 越滾越大，也越難收手
球會一路增加，球串越長，能撞碎的數字就越大。但撞碎方塊會消耗等量的球，所以每一次「撞不撞」都是取捨。
・黑色鐵方塊：撞不碎，碰到就結束
・空中橫桿：紅色的碰到就結束，其他顏色會削掉約 45% 的球
・Mega Ball：短時間內把擋路的一切推開
・金幣：散落在路面，這局結束後結算入袋

■ 連擊倍率越疊越高
每連續撞碎 5 個方塊，倍率就再加 0.5：5 連 x1.5、10 連 x2.0、20 連 x3.0，而且沒有上限。3 秒內沒有再撞碎方塊就歸零。
倍率會直接乘上分數，分數又決定這局能拿多少金幣——不停手，才是最划算的打法。

■ 14 種造型，明碼標價不用抽
Classic、Mint、Lime、Coral、Gold、Ruby、Galaxy、Beach Ball、Basketball、8-Ball、Watermelon、Eyeball、Disco Ball，還有會不斷變色的 Rainbow。
預設造型免費，其餘用金幣或寶石固定價格直接購買，沒有隨機抽獎，也沒有寶箱。

■ 3 種道具，開局前自己選
・Head Start：開場多 8 顆球（200 金幣）
・Coin Magnet：整局自動吸取金幣（250 金幣）
・Shield：擋下 1 次會直接結束遊戲的撞擊（300 金幣）

■ 每天都有回來的理由
・每日任務：每天 3 個，天天換新，完成後拿金幣或寶石
・登入獎勵：連續登入 7 天，每天簽到都能領獎，中斷一天就從頭開始
・全球排行榜：只留前 50 名，暱稱 1～16 字，送出前會過濾不當字詞
・復活：一局最多 3 次，用寶石支付，每復活一次費用就往上加

■ 關於付費
免費遊玩。內購只有 4 種消耗性商品：金幣 5,000、金幣 30,000、寶石 50、寶石 200。沒有訂閱，也沒有隨機抽獎商品。
遊戲畫面內的文字為英文（操作只有滑動，規則用數字和圖示呈現）。
分數、金幣與造型都保存在伺服器，遊玩時請保持連線。
```

### What's New — 128자 / 4,000

```
首次推出。

・5 條車道的無盡霓虹賽道，單手滑動操作
・連擊倍率每 5 連再加 0.5，沒有上限
・14 種球體造型、3 種道具
・每日任務與 7 天登入獎勵
・全球前 50 名排行榜

有任何問題或建議，歡迎透過開發者聯絡方式告訴我們，我們會持續調整。
```

## Google Play

### 앱 이름 — 16자 / 30

```
Snakeball 霓虹滾球跑酷
```

### 간단한 설명 — 62자 / 80

```
單手滑動的 3D 無盡跑酷：球夠多就撞碎數字方塊，不夠就閃過去。連擊越疊越高，14 種造型任你換，免費衝進全球前 50 名。
```

### 자세한 설명 — 1,000자 / 4,000

```
帶著一長串球，一路滾下霓虹賽道。球比方塊上的數字多，就撞得碎；不夠，就先閃過去。
一根手指決定一切：左右滑動在 5 條車道間移動，向上滑跳起來，向下滑砸下去。沒有關卡、沒有倒數，只有越跑越快的無盡賽道。

【球數就是你的武器】
球會一路增加，球串越長，能撞碎的數字就越大。但撞碎方塊會消耗等量的球，所以每一次「撞不撞」都是取捨。
・黑色鐵方塊：撞不碎，碰到就結束
・空中橫桿：紅色的碰到就結束，其他顏色會削掉約 45% 的球
・Mega Ball：短時間內把擋路的一切推開
・金幣：散落在路面，這局結束後結算入袋

【連擊倍率越疊越高】
每連續撞碎 5 個方塊，倍率就再加 0.5：5 連 x1.5、10 連 x2.0、20 連 x3.0，而且沒有上限。3 秒內沒有再撞碎方塊就歸零。
倍率會直接乘上分數，分數又決定這局能拿多少金幣。不停手，才是最划算的打法。

【14 種造型，明碼標價不用抽】
Classic、Mint、Lime、Coral、Gold、Ruby、Galaxy、Beach Ball、Basketball、8-Ball、Watermelon、Eyeball、Disco Ball，還有會不斷變色的 Rainbow。
預設造型免費，其餘用金幣或寶石固定價格直接購買，沒有隨機抽獎，也沒有寶箱。

【3 種道具，開局前自己選】
・Head Start：開場多 8 顆球（200 金幣）
・Coin Magnet：整局自動吸取金幣（250 金幣）
・Shield：擋下 1 次會直接結束遊戲的撞擊（300 金幣）

【每天都有回來的理由】
・每日任務：每天 3 個，天天換新，完成後拿金幣或寶石
・登入獎勵：連續登入 7 天，每天簽到都能領獎，中斷一天就從頭開始
・全球排行榜：只留前 50 名，暱稱 1～16 字，送出前會過濾不當字詞
・復活：一局最多 3 次，用寶石支付，每復活一次費用就往上加

【你會得到什麼】
沒有關卡、沒有王、沒有劇情、沒有倒數。單人遊玩，沒有聊天。賽道越跑越快，視野越開越廣，直到你失手為止。

【關於付費】
免費遊玩。內購只有 4 種消耗性商品：金幣 5,000、金幣 30,000、寶石 50、寶石 200。沒有訂閱，也沒有隨機抽獎商品。
遊戲畫面內的文字為英文（操作只有滑動，規則用數字和圖示呈現）。
分數、金幣與造型都保存在伺服器，遊玩時請保持連線。
```

---

# 로케일 매핑

| 이 문서 | App Store Connect 로케일 | Google Play 언어 | Apps in Toss |
|---|---|---|---|
| 한국어 | Korean (ko) | 한국어 (ko-KR) | ✅ 사용 |
| English | English (U.S.) — **기본 로케일** | English (United States) (en-US) | — |
| 日本語 | Japanese (ja) | 日本語 (ja-JP) | — |
| 繁體中文 | **Chinese (Traditional)** + **Chinese (Hong Kong)** — 같은 텍스트를 두 로케일에 각각 업로드 | **繁體中文（台灣) zh-TW** + **繁體中文（香港) zh-HK** — 같은 텍스트를 두 언어에 각각 업로드 | — |

- 繁體 문구는 대만/홍콩 분기 어휘(雷射↔激光, 轉蛋↔扭蛋, 網路↔網絡)를 전부 피해 **한 벌로 양 지역에 그대로 넣을 수 있게** 썼다. 나중에 지역을 분리하고 싶어지면 zh-HK 만 따로 손보면 된다.
- 简体中文 로케일은 이번 범위 밖이다. 이 문서를 그대로 简体 로 변환해 올리지 말 것(어휘가 다르다).
- 앱 이름이 로케일별로 다를 때 Apple 은 **기본 로케일(en-US)** 이름이 미지원 언어권에 노출된다.

# 이름이 확정되면 바꿔야 하는 자리 (체크리스트)

본문 카피는 어디에서도 이름의 뜻에 기대지 않는다. 아래 **9곳만** 교체하면 끝난다.

- [ ] `ko` Apple Name — `Snakeball: 볼 굴리기 러너`
- [ ] `ko` Play 앱 이름 — `Snakeball: 볼 굴리기 러너`
- [ ] `en` Apple Name — `Snakeball: Neon Ball Run`
- [ ] `en` Play 앱 이름 — `Snakeball: Neon Cube Run` (Apple 과 일부러 다름 — 위 주석 참고)
- [ ] `ja` Apple Name — `Snakeball：ボール転がしアクション` (전각 콜론 유지)
- [ ] `ja` Play 앱 이름 — `Snakeball：ボール転がし3Dラン`
- [ ] `zh-Hant` Apple Name — `Snakeball 霓虹滾球跑酷` (zh-TW/zh-HK 두 로케일 모두)
- [ ] `zh-Hant` Play 앱 이름 — `Snakeball 霓虹滾球跑酷` (zh-TW/zh-HK 두 언어 모두)
- [ ] `ko` Toss 앱 이름 — `스네이크볼` → 변경 시 `/Users/mark/repos/Snakeball/granite.config.ts:6` 의 `displayName` 도 **같이** 바꿔야 한다

이름 교체 시 같이 확인할 것:

- [ ] Apple **Keywords 재계산** — Name/Subtitle 에 들어간 단어는 키워드에서 빼야 한다. 새 이름에 이미 있는 토큰이 키워드에 남아 있지 않은지 확인(en 은 여유 4자, ko 4자, ja 3자, zh 4자밖에 없다).
- [ ] `en` Apple Subtitle 은 28/30 이라 여유가 2자뿐이다. 이름이 바뀌어 Subtitle 로 키워드를 옮겨야 하면 재작성 필요.
- [ ] 앱 이름이 확정되면 `en` Apple Keywords 에 `snake` 추가 검토(Apple 은 `Snakeball` 을 통짜 한 토큰으로만 색인한다).

# 밸런싱/설정을 바꾸면 같이 고쳐야 하는 숫자

Apple Description 은 **심사 없이 못 고친다.** 아래 값을 건드리면 4개 언어 Description·Play 자세한 설명을 동시에 갱신할 것.

| 값 | 문구에 박힌 형태 | 코드 위치 |
|---|---|---|
| 볼 손실률 45% | "약 45%" | 공중 바 처리 |
| 스킨 14종 + 이름 14개 | 전 언어 나열 | `index.html:712~727` |
| 파워업 가격 200/250/300 | 전 언어 표기 | `index.html:731~733` |
| 최대 부활 3회 | 전 언어 표기 | `MAX_REVIVES = 3` |
| 상위 50위 / 닉네임 16자 | 전 언어 표기 | 리더보드 |
| IAP 지급량 5,000·30,000·50·200 | 전 언어 표기 | `index.html:738~741` |
| 콤보 +0.5/5연속, 상한 없음 | 전 언어 표기 | `comboMultiplier()` |

**일부러 숫자를 안 쓴 것** — 부활 젬 비용(서버 `config_public` 런타임 값), 데일리 미션 풀 크기(광고 온/오프에 따라 7↔8 변동).

**`ADS_ENABLED` 를 true 로 켜는 날 해야 할 일** — 4개 언어 문구에 광고 언급이 없으므로 허위는 아니지만, Apple 개인정보 문항 / Play 데이터 보안·광고 포함 표시를 갱신해야 하고, 미션 풀이 8개가 되며 "광고 보고 부활" 동선이 생긴다(원하면 그때 Promotional Text 에만 추가 — 심사 없이 수정 가능한 필드다).
