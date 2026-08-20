#!/usr/bin/env node
// 경제 계약 관문 — 화면이 약속한 것과 서버가 주는 것, 그리고 "치명타 1회" 문구를 소스에서 판정한다.
//
//   node tools/check-economy-contract.mjs      (npm run check:economy)
//
// **이 파일이 있는 이유.** 둘 다 "돈을 낸 유저가 손해 보는" 결함인데, 플레이해서는 잘 안 보인다.
// 일일 캡에 걸린 유저만, 침식형 bar 를 맞은 판만 겪기 때문이다. 2026-08 실측:
//
//   [1] 결과화면은 `runCoins + floor(score/10)` 로 약속했는데 서버(grantRunCoins)는
//       floor(score*coin_per_score) + min(pickup, coins_per_sec_cap*sec) 를 일일 캡으로 자른다.
//       서버가 내려주는 캡 잔량 4개를 클라가 **0회** 참조했다 → 캡에 걸리면 약속보다 적게 받고,
//       화면상으론 지급 누락처럼 보인다.
//   [2] Shield(300코인, "Survive one deadly hit")가 bar 충돌에서 치명 판정보다 **먼저** 소비됐다.
//       bar 는 즉사(레이저)와 침식(공 45% 손실)이 섞여 있어서, 안 죽는 히트에 파워업이 날아갔다.

import { readFileSync } from 'node:fs';

const SRC = new URL('../index.html', import.meta.url);
const SERVER = new URL('../functions/coinSystem.js', import.meta.url);
const html = readFileSync(SRC, 'utf8');
const server = readFileSync(SERVER, 'utf8');
const fails = [];

function die(msg) {
  console.error(`check:economy 중단 — ${msg}\n  파서가 못 따라간 것이지 통과가 아니다.`);
  process.exit(1);
}

// ── [1] 결과화면 코인 약속 ↔ 서버 지급 공식 ─────────────────────────────
// 서버가 실제로 쓰는 요소를 먼저 읽어, 클라가 그 요소들을 다 반영하는지 본다.
const grant = /async function grantRunCoins\([\s\S]*?\n}/.exec(server);
if (!grant) die('functions/coinSystem.js 에서 grantRunCoins 를 못 찾았다');
const serverUses = {
  coin_per_score: /coin_per_score/.test(grant[0]),
  coins_per_sec_cap: /coins_per_sec_cap/.test(grant[0]),
  daily_cap: /coin_earn_daily_cap/.test(grant[0]),
};
if (!serverUses.coin_per_score || !serverUses.daily_cap)
  die('grantRunCoins 가 예상과 다르다 — 공식이 바뀌었으면 이 관문부터 갱신해야 한다');

const estimate = /function estimateRunCoins\([\s\S]*?\n}/.exec(html);
if (!estimate) {
  fails.push('[1] estimateRunCoins 가 없다 — 결과화면이 서버 공식을 따르지 않는다는 뜻이다');
} else {
  const e = estimate[0];
  if (serverUses.coin_per_score && !/coin_per_score/.test(e))
    fails.push('[1] estimateRunCoins 가 coin_per_score 를 안 쓴다 — 서버가 설정을 바꾸면 약속이 어긋난다');
  if (serverUses.coins_per_sec_cap && !/coins_per_sec_cap/.test(e))
    fails.push('[1] estimateRunCoins 가 coins_per_sec_cap(픽업 초당 상한)을 안 쓴다 — 짧은 자석 런에서 과다 약속');
  if (serverUses.daily_cap && !/daily_coin_earn_remaining/.test(e))
    fails.push('[1] estimateRunCoins 가 일일 캡 잔량을 안 쓴다 — 캡에 걸린 유저에게 과다 약속');
}

// 결과화면이 옛 공식을 그대로 쓰고 있지 않은지 (되돌림 방지)
if (/lastRunBaseCoins\s*=\s*runCoins\s*\+\s*Math\.floor\(finalScore\s*\/\s*10\)/.test(html))
  fails.push('[1] 결과화면이 옛 로컬 추정식(runCoins + floor(score/10))으로 되돌아갔다');

// 서버가 내려주는 캡 잔량을 클라가 실제로 저장하는지
for (const f of ['daily_coin_earn_remaining', 'daily_rewarded_remaining', 'daily_revive_remaining']) {
  if (!server.includes(f)) die(`서버 응답에서 ${f} 가 사라졌다 — 관문을 갱신하라`);
  if (!html.includes(f)) fails.push(`[1] 클라가 서버의 ${f} 를 한 번도 참조하지 않는다`);
}

// 서버가 준 실제 지급액으로 화면을 정정하는지 (추정은 추정일 뿐)
if (!/__reconcileRunCoins/.test(html))
  fails.push('[1] submitScore 응답의 earned 로 결과화면을 정정하는 경로가 없다');

// ── [2] Shield 는 "치명타"에만 소비되는가 ────────────────────────────────
// 소비 지점마다, 그 분기가 실제로 죽는 경로인지 본다.
// 정의(`function consumeShield(...)`)가 아니라 **호출부**만 본다 — 정의는 소비 구현 자체라
// 치명 판정과 묶여 있을 수가 없다.
const consumeSites = [...html.matchAll(/(?<!function\s)consume(Bar)?Shield\(/g)].map((m) => m.index);
if (consumeSites.length < 2) die(`실드 소비 호출부를 ${consumeSites.length}곳밖에 못 찾았다`);

for (const at of consumeSites) {
  const before = html.slice(Math.max(0, at - 700), at);   // 이 분기에 들어오기까지의 조건
  const after = html.slice(at, at + 900);                 // 소비 안 했을 때 이어지는 처리
  // 치명 근거: 같은 분기가 즉사시키거나(triggerDeath/ballCount = 0), 치명 여부를 미리 계산했거나.
  const lethalHere =
    /barLethal|lethal/.test(before) ||           // 치명 여부를 먼저 계산한 형태
    /triggerDeath\(\)/.test(after) ||            // 실드가 없으면 바로 죽는 자리
    /ballCount\s*=\s*0/.test(after) ||
    /ballCount\s*<=\s*cube\.hp|ballCount\s*>\s*cube\.hp/.test(before); // 큐브: 못 깨면 죽음
  if (!lethalHere)
    fails.push(
      `[2] 실드 소비 지점(offset ${at})이 치명 판정과 묶여 있지 않다 — ` +
      '"Survive one deadly hit" 인데 안 죽는 히트에 소비될 수 있다',
    );
}

// 침식형 bar 는 손실을 먼저 계산한 뒤에 치명 여부를 판정해야 한다(되돌림 방지).
// ⚠️ 부분 문자열로 보면 안 된다 — `erosionLoss0` 같은 이름이 `erosionLoss` 를 포함해서
//    되돌린 코드가 통과해버린다(이 관문을 만들 때 실제로 그렇게 새어나갔다). 단어 경계로 본다.
const barConsume = html.indexOf('consumeBarShield(bar)');
if (barConsume < 0) die('consumeBarShield 호출부를 못 찾았다');
const barBefore = html.slice(Math.max(0, barConsume - 700), barConsume);
// 가드 자체를 요구한다: 치명일 때만 소비하는 형태여야 한다.
if (!/\bbarLethal\b\s*&&\s*\bshieldActive\b/.test(barBefore + html.slice(barConsume, barConsume + 60)))
  fails.push('[2] bar 실드 소비가 `barLethal && shieldActive` 로 가드되지 않는다 — 비치명 히트에 소비된다');
if (!/\berosionLoss\b\s*=/.test(barBefore))
  fails.push('[2] bar 실드 소비 전에 침식 손실량(erosionLoss)을 계산하지 않는다 — 치명 여부를 알 수 없다');
if (!/\bbarLethal\b\s*=[\s\S]{0,120}?\bbar\.deadly\b/.test(barBefore))
  fails.push('[2] barLethal 판정이 bar.deadly(즉사 레이저)를 반영하지 않는다');

// ── [3] 배포가 실제로 관문을 거치는가 ───────────────────────────────────
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const fnPkg = JSON.parse(readFileSync(new URL('../functions/package.json', import.meta.url), 'utf8'));
const fb = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));

if (/^echo\b/.test(fnPkg.scripts?.lint ?? ''))
  fails.push('[3] functions lint 가 echo 스텁이다 — 문법이 깨진 코드도 배포된다');
if (!fb.functions?.predeploy?.length)
  fails.push('[3] firebase.json functions 에 predeploy 훅이 없다 — 배포가 아무것도 검사하지 않는다');
if (!fb.hosting?.predeploy?.length)
  fails.push('[3] firebase.json hosting 에 predeploy 훅이 없다 — deploy:web 이 관문을 건너뛴다');
if (!pkg.scripts?.['check:economy'])
  fails.push('[3] package.json 에 check:economy 가 등록돼 있지 않다');

console.log(
  `check:economy — 서버 공식 요소 ${Object.values(serverUses).filter(Boolean).length}개 대조 · ` +
  `실드 소비 ${consumeSites.length}곳 · 배포 훅 4개`,
);
if (fails.length) {
  console.error('\n' + fails.join('\n'));
  console.error(`\n❌ check:economy FAIL — ${fails.length}건`);
  process.exit(1);
}
console.log('✅ check:economy OK');
