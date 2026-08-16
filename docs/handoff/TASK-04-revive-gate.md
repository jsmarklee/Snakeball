# T4 · Kill the dead revive screen: skip it when no revive path exists, upsell gems when short, shorten the result delay, drop the unachievable revive mission

> 이 파일은 **단독 실행 가능한 작업지시서**다. 그대로 복사해 붙여넣으면 된다.
> **시작 전 [RULES.md](RULES.md) 를 먼저 읽을 것** — 건드리면 안 되는 것들이 있다.

- **난이도/소요**: Small — about 30-45 minutes. 9 mechanical hunks in one file (~60 lines added, ~8 removed), no new dependencies, no server work. Most of the time is the verification pass: run the node verifier before editing to see it fail, apply the hunks, run it again, then the syntax gate and the browser smoke test. This exact patch was applied to a scratchpad copy and validated end-to-end (verifier 9 fails → 0 fails; `node --check` clean on both module scripts).
- **배포 필요**: Hosting only.

  cd /Users/mark/repos/Snakeball
  npm run sync:public        # MANDATORY after any index.html edit
  npm run deploy:web         # = sync:public + firebase deploy --only hosting + rules

NOT needed:
  - firebase deploy --only functions — no server file changed.
  - firestore.rules change — none made (deploy:web re-pushes the unchanged rules; harmless).
  - iOS / Android native rebuild — both shells load the hosted URL, so the deploy reaches
    installed builds without a store review. No bridge contract change was made.
  - Toss rebuild — only needed for the next `ait build && ait deploy` cycle, not for this fix.

Order matters: run `npm run sync:public` (or deploy:web, which includes it) BEFORE claiming
the fix is live, otherwise public/index.html still serves the old revive flow.


---

## 1. 대상 파일

```
/Users/mark/repos/Snakeball/index.html  (single file, 9 hunks — A..I. Apply ALL of them, in order. Do not touch any other file. `public/index.html` is generated later by `npm run sync:public`, never edited by hand.)
```


## 2. 현재 코드 (파일에서 이대로 찾을 것)

> 줄 번호는 밀릴 수 있다. **아래 문자열로 검색**해서 찾아라.
> 안 찾아지면 누가 이미 고친 것이니 **멈추고 사람에게 물어라.**

````
Each block below is copied VERBATIM from /Users/mark/repos/Snakeball/index.html. Every one of these strings occurs EXACTLY ONCE in the file (verified). Match them exactly, including indentation, the Korean comments, and the em-dashes. Do not reformat.

────────────────────────── HUNK A  (script #1, ~line 961) ──────────────────────────
function iapPurchasable(id) {
    if (platform === 'toss') return !!TOSS_SKU_BY_ID[id];
    if (platform === 'web') return false;
    return true;
}

// ---------- Ads master switch (single source of truth) ----------

────────────────────────── HUNK B  (script #1, ~line 735) ──────────────────────────
    { id:'balls40', text:'Reach 40 balls in a run', type:'bestBalls',    target:40,  reward:{coins:200} },
    { id:'revive1', text:'Revive once',             type:'revives',      target:1,   reward:{coins:150} },
];

────────────────────────── HUNK C  (script #1, ~line 1235) ─────────────────────────
function ensureMissions() {
    if (!state.missions || state.missions.date !== today()) {
        const pool = MISSION_POOL.slice();
        const picks = [];

────────────────────────── HUNK D  (script #1, ~line 2498) ─────────────────────────
    showRewardedAd,
    canShowRewardedAd,
    openExternal, composeEmail,

────────────────────────── HUNK E  (script #2, ~line 3991) ─────────────────────────
function triggerDeath() {
    if (pendingDeathHandled) return;
    pendingDeathHandled = true;
    hideFirstRunHint();   // don't let the first-run banner linger over revive/result
    if (window.SB) SB.vibrate('error');

    const canRevive = revivesUsed < MAX_REVIVES;
    if (canRevive) {
        showReviveScreen();
    } else {
        finalizeGameOver();
    }
}

────────────────────────── HUNK F  (script #2, ~line 4009) ─────────────────────────
function showReviveScreen() {
    gameState = 'revive';
    // throw the trailing balls for drama but keep run alive
    const gemCost = window.SB ? SB.reviveGemCost(revivesUsed) : (5 + revivesUsed * 5);
    document.getElementById('revive-gem-cost').textContent = gemCost;
    const gemBtn = document.getElementById('revive-gem');
    gemBtn.disabled = (window.SB && SB.state.gems < gemCost);
    // Rewarded revive stays available even for "remove forced ads" buyers —

────────────────────────── HUNK G  (script #2, ~line 4057) ─────────────────────────
    } else if (method === 'gem') {
        const gemCost = window.SB ? SB.reviveGemCost(revivesUsed) : (5 + revivesUsed * 5);
        if (window.SB && SB.state.gems < gemCost) { SB.toast('Not enough gems'); showReviveScreen(); return; }
        const gemBtn = document.getElementById('revive-gem');

────────────────────────── HUNK H  (script #2, ~line 4070 and ~line 4121) ──────────
H-1:
function doRevive() {
    revivesUsed++;
    document.getElementById('revive-screen').style.display = 'none';

H-2:
function declineRevive() {
    clearInterval(reviveInterval);
    document.getElementById('revive-screen').style.display = 'none';
    finalizeGameOver();
}

────────────────────────── HUNK I  (script #2, ~line 4666) ─────────────────────────
        if (window.SB) SB.updateBadges();
    }, 1500);
````


## 3. 교체할 코드

````
Paste each replacement over the matching CURRENT block. Same labels, same order.

────────────────────────── HUNK A → replacement ──────────────────────────
function iapPurchasable(id) {
    if (platform === 'toss') return !!TOSS_SKU_BY_ID[id];
    if (platform === 'web') return false;
    return true;
}

// 이 플랫폼에서 '젬'을 실제로 살 수 있는가 — 부활 화면의 "젬 부족 → 상점" 유도를 켤지
// 판단하는 게이트. 살 수 없는 플랫폼(web / Toss SKU 미매핑)에서 상점으로 보내면
// renderShop 이 "Store coming soon." 만 띄우는 막다른 길에 도착한다(죽은 동선).
// 판정 기준은 renderShop 의 buyable 필터와 동일하게 iapPurchasable 하나로 맞춘다.
function gemsPurchasable() {
    return STORE.some(p => p.grant && p.grant.gems && iapPurchasable(p.id));
}

// ---------- Ads master switch (single source of truth) ----------

────────────────────────── HUNK B → replacement ──────────────────────────
    { id:'balls40', text:'Reach 40 balls in a run', type:'bestBalls',    target:40,  reward:{coins:200} },
    // needsAds — 보상형 광고가 꺼져 있으면(ADS_ENABLED=false / web / Toss adGroupId 미주입)
    // 부활 수단이 젬뿐이라 신규 유저(젬 0)는 이 미션을 영영 0/1 로 둔 채 슬롯만 날린다.
    // ensureMissions 가 로테이션 풀에서 제외한다. 정의 자체는 남겨야 어제 이미 뽑힌
    // 진행중 미션의 missionDef 조회가 깨지지 않는다(다음 KST 리셋에 자연히 빠짐).
    { id:'revive1', text:'Revive once',             type:'revives',      target:1,   reward:{coins:150}, needsAds:true },
];

────────────────────────── HUNK C → replacement ──────────────────────────
function ensureMissions() {
    if (!state.missions || state.missions.date !== today()) {
        // 달성 불가능한 미션은 로테이션에서 뺀다(needsAds 플래그). slice() → filter().
        const pool = MISSION_POOL.filter(m => !m.needsAds || canShowRewardedAd());
        const picks = [];

────────────────────────── HUNK D → replacement ──────────────────────────
    showRewardedAd,
    canShowRewardedAd,
    gemsPurchasable,
    openExternal, composeEmail,

────────────────────────── HUNK E → replacement ──────────────────────────
// 부활 경로 가용성 — "부활 화면을 띄울 가치가 있는가"의 단일 판정.
//  adOk      : 보상형 광고로 즉시 부활 가능(ADS_ENABLED + 플랫폼 게이트 = canShowRewardedAd).
//  gemOk     : 지금 가진 젬으로 즉시 부활 가능(gems >= reviveGemCost).
//  gemUpsell : 젬은 있는데 모자란다 → 광고가 꺼진 지금 IAP 가 유일한 매출이고 이 순간이
//              게임에서 유일하게 젬 수요가 생기는 지점이므로, 버튼을 비활성화하지 말고
//              상점(Get Coins 탭)으로 보낸다. 단 젬을 못 사는 플랫폼에선 켜지 않는다.
// 셋 다 false 면 화면 자체를 띄우지 않는다 — 신규 설치(젬 0 + 광고 off)에게 부활 화면은
// 매 판 끝마다 강제되는 무의미한 "No thanks" 탭 + 5초 카운트다운일 뿐이었다.
function reviveOptions() {
    const gemCost = window.SB ? SB.reviveGemCost(revivesUsed) : (5 + revivesUsed * 5);
    const gems = window.SB ? (SB.state.gems || 0) : 0;
    const adOk = !!(window.SB && SB.canShowRewardedAd());
    const gemOk = gems >= gemCost;
    const gemUpsell = !gemOk && gems > 0 && !!(window.SB && SB.gemsPurchasable && SB.gemsPurchasable());
    return { gemCost, adOk, gemOk, gemUpsell, any: adOk || gemOk || gemUpsell };
}

function triggerDeath() {
    if (pendingDeathHandled) return;
    pendingDeathHandled = true;
    hideFirstRunHint();   // don't let the first-run banner linger over revive/result
    if (window.SB) SB.vibrate('error');

    // 부활 횟수가 남아도 실행 가능한 경로가 없으면 결과 화면으로 직행한다.
    const canRevive = revivesUsed < MAX_REVIVES && reviveOptions().any;
    if (canRevive) {
        showReviveScreen();
    } else {
        finalizeGameOver();
    }
}

────────────────────────── HUNK F → replacement ──────────────────────────
let reviveShopWatch = null; // 상점이 닫히는지 감시하는 폴러(열려있는 동안 카운트다운 정지).
function showReviveScreen() {
    clearInterval(reviveShopWatch); reviveShopWatch = null;
    const opt = reviveOptions();
    // 방어 — 상점에서 아무것도 안 사고 돌아오는 등 triggerDeath 이외 경로로도 재진입한다.
    // 가용 경로가 사라졌으면 화면을 띄우지 말고 그대로 결과로 넘긴다.
    if (!opt.any) { declineRevive(); return; }
    gameState = 'revive';
    // throw the trailing balls for drama but keep run alive
    const gemCost = opt.gemCost;
    const gemBtn = document.getElementById('revive-gem');
    // 젬 버튼 3상태 — disabled 죽은 버튼은 만들지 않는다.
    //  gemOk     : "💎 5 REVIVE NOW"        → 즉시 부활
    //  gemUpsell : "💎 GET GEMS · NEED 5"   → 상점 Get Coins 탭 (reviveVia('gem') 이 분기)
    //  둘 다 아님 : 숨김
    // 라벨을 span 하나로 감싸는 이유는 double-coins 와 동일 — .big-btn 이 display:flex 라
    // 텍스트 조각을 형제로 두면 각자 flex item 이 되어 내부 공백에서 줄이 쪼개진다.
    gemBtn.style.display = (opt.gemOk || opt.gemUpsell) ? '' : 'none';
    gemBtn.disabled = false;
    gemBtn.innerHTML = opt.gemOk
        ? '<span>💎 <span id="revive-gem-cost">' + gemCost + '</span> REVIVE NOW</span>'
        : '<span>💎 GET GEMS · NEED <span id="revive-gem-cost">' + gemCost + '</span></span>';
    // Rewarded revive stays available even for "remove forced ads" buyers —

────────────────────────── HUNK G → replacement ──────────────────────────
    } else if (method === 'gem') {
        const opt = reviveOptions();
        const gemCost = opt.gemCost;
        // 젬이 모자라면 'Not enough gems' 토스트로 끝내지 않고 상점으로 보낸다.
        // 상점이 열려 있는 동안 카운트다운은 멈춘 상태(reviveVia 진입부에서 clear)로 두고,
        // 닫히면 showReviveScreen 이 잔액을 다시 계산해(사면 REVIVE NOW 로 바뀐다)
        // 카운트다운을 재시작한다. 폴러는 스스로 정리하고 gameState 도 재확인한다.
        if (!opt.gemOk) {
            if (!opt.gemUpsell) { showReviveScreen(); return; }
            if (window.SB) { SB.vibrate('light'); SB.openShop('store'); }
            clearInterval(reviveShopWatch);
            reviveShopWatch = setInterval(() => {
                const modal = document.getElementById('shop-modal');
                if (modal && modal.classList.contains('open')) return;
                clearInterval(reviveShopWatch); reviveShopWatch = null;
                if (gameState === 'revive') showReviveScreen();   // 잔액 재평가 + 카운트다운 재시작
            }, 300);
            return;
        }
        const gemBtn = document.getElementById('revive-gem');

────────────────────────── HUNK H → replacement ──────────────────────────
H-1:
function doRevive() {
    revivesUsed++;
    clearInterval(reviveShopWatch); reviveShopWatch = null;   // 상점 감시 폴러 정리
    document.getElementById('revive-screen').style.display = 'none';

H-2:
function declineRevive() {
    clearInterval(reviveInterval);
    clearInterval(reviveShopWatch); reviveShopWatch = null;   // 상점 감시 폴러 정리
    document.getElementById('revive-screen').style.display = 'none';
    finalizeGameOver();
}

────────────────────────── HUNK I → replacement ──────────────────────────
        if (window.SB) SB.updateBadges();
    // 1500ms 는 죽음 → 결과 사이의 죽은 시간이었다. 공 흩날리는 연출은 앞 0.5s 에
    // 다 읽히고, 부활 화면이 사라진 지금은 이 대기가 그대로 체감 지연이 된다.
    }, 700);
````


## 4. 검증 (수정 전 실패 → 수정 후 성공이어야 함)

````
TWO PARTS. Run part 1 before AND after; it must go from failing to passing.

PART 1 — automated (fails before, passes after; this was executed against the real file and against a patched copy)

Write this file to /tmp/verify-t4.js:

------------------------------------------------------------
// T4 verification — run:  node /tmp/verify-t4.js /Users/mark/repos/Snakeball/index.html
const fs = require('fs');
const file = process.argv[2] || '/Users/mark/repos/Snakeball/index.html';
const src = fs.readFileSync(file, 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

// ---- 1. reviveOptions() exists and behaves ----
const m = src.match(/function reviveOptions\(\) \{[\s\S]*?\n\}/);
check('reviveOptions() exists', !!m);
if (m) {
  const run = new Function('STUB', 'revivesUsed', `
    const window = { SB: STUB };
    const SB = STUB;
    ${m[0]}
    return reviveOptions();
  `);
  const stub = (ads, gems, buyable) => ({
    state: { gems },
    reviveGemCost: (i) => 5 + i * 5,
    canShowRewardedAd: () => ads,
    gemsPurchasable: () => buyable,
  });
  const cases = [
    ['new install: ads off + 0 gems -> screen SKIPPED', false, 0, true, false, false],
    ['ads off + 3 gems (cost 5) -> screen SHOWN as upsell', false, 3, true, true, true],
    ['ads off + 5 gems (cost 5) -> screen SHOWN, revive now', false, 5, true, true, false],
    ['ads on + 0 gems -> screen SHOWN', true, 0, true, true, false],
    ['web (gems not purchasable) + 3 gems -> screen SKIPPED', false, 3, false, false, false],
  ];
  for (const [label, ads, gems, buyable, expAny, expUp] of cases) {
    const r = run(stub(ads, gems, buyable), 0);
    check(label, r.any === expAny && r.gemUpsell === expUp,
      'got any=' + r.any + ' gemUpsell=' + r.gemUpsell);
  }
}

// ---- 2. triggerDeath gates on it ----
check('triggerDeath gates on reviveOptions().any',
  /const canRevive = revivesUsed < MAX_REVIVES && reviveOptions\(\)\.any;/.test(src));

// ---- 3. dead disabled gem button is gone; upsell routes to the shop ----
check('no disabled-gem dead button left',
  !/gemBtn\.disabled = \(window\.SB && SB\.state\.gems < gemCost\);/.test(src));
check('gem shortfall routes to the shop', /SB\.openShop\('store'\)/.test(src) &&
  /opt\.gemUpsell/.test(src));
check('SB exposes gemsPurchasable', /^\s*gemsPurchasable,$/m.test(src) &&
  /function gemsPurchasable\(\)/.test(src));

// ---- 4. result-screen delay shortened ----
const delay = src.match(/if \(window\.SB\) SB\.updateBadges\(\);[\s\S]{0,400}?\}, (\d+)\);/);
check('result delay <= 800ms (was 1500)', !!delay && Number(delay[1]) <= 800,
  delay ? delay[1] + 'ms' : 'delay not found');

// ---- 5. revive mission excluded from rotation while ads are off ----
const poolSrc = src.match(/const MISSION_POOL = \[[\s\S]*?\n\];/);
check('MISSION_POOL found', !!poolSrc);
const adsEnabled = /const ADS_ENABLED = (true|false);/.exec(src);
check('ADS_ENABLED found', !!adsEnabled);
check('ensureMissions filters needsAds missions',
  /const pool = MISSION_POOL\.filter\(m => !m\.needsAds \|\| canShowRewardedAd\(\)\);/.test(src));
if (poolSrc && adsEnabled) {
  const POOL = new Function(poolSrc[0] + ' return MISSION_POOL;')();
  const revive1 = POOL.find(x => x.id === 'revive1');
  check("'revive1' is flagged needsAds", !!revive1 && revive1.needsAds === true);
  const adsOn = adsEnabled[1] === 'true';
  const rotatable = POOL.filter(x => !x.needsAds || adsOn);
  check('rotation pool excludes revive1 while ads are off',
    adsOn || !rotatable.some(x => x.id === 'revive1'));
  check('rotation pool still has >= 3 missions', rotatable.length >= 3, rotatable.length + ' left');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
------------------------------------------------------------

Then:
  node /tmp/verify-t4.js /Users/mark/repos/Snakeball/index.html

EXPECTED BEFORE the change (exit code 1):
  "3 passed, 9 failed"   — with FAIL on: reviveOptions() exists / triggerDeath gates on
  reviveOptions().any / no disabled-gem dead button left / gem shortfall routes to the
  shop / SB exposes gemsPurchasable / result delay <= 800ms (-> 1500ms) / ensureMissions
  filters needsAds missions / 'revive1' is flagged needsAds / rotation pool excludes revive1

EXPECTED AFTER the change (exit code 0):
  "17 passed, 0 failed"   — every line PASS.

PART 2 — syntax gate (must print OK twice; catches any paste error)

  cd /Users/mark/repos/Snakeball && python3 - <<'EOF'
import re, io
s = io.open('index.html', encoding='utf-8').read()
b = re.findall(r'<script type="module">(.*?)</script>', s, re.S)
assert len(b) == 2, 'expected 2 module scripts, got %d' % len(b)
for i, x in enumerate(b):
    io.open('/tmp/sb_mod_%d.mjs' % i, 'w', encoding='utf-8').write(x)
print('extracted 2')
EOF
  node --check /tmp/sb_mod_0.mjs && echo OK1 && node --check /tmp/sb_mod_1.mjs && echo OK2

EXPECTED AFTER: "extracted 2", then "OK1", then "OK2". Any SyntaxError = bad paste, fix it.

PART 3 — browser smoke test (30 seconds, confirms the user-visible behaviour)

  cd /Users/mark/repos/Snakeball && python3 -m http.server 8799
  open http://localhost:8799/index.html in Chrome, DevTools open.

  Step 1 — make sure you are the "new install" case. In the console run:
      localStorage.setItem('sb_gems','0'); localStorage.removeItem('sb_missions'); location.reload();
  Step 2 — tap PLAY, then steer into a wall / an iron cube to die.
      BEFORE the change: the "CONTINUE?" screen appears with a 5→0 ring and a greyed-out
        "💎 5 REVIVE NOW" button; you must tap "No thanks"; then ~1.5s of nothing; then GAME OVER.
      AFTER the change:  no CONTINUE? screen at all — GAME OVER appears ~0.7s after death.
  Step 3 — the gem upsell path. In the console run:
      localStorage.setItem('sb_gems','3'); location.reload();
    (note: on a device with a live server session the boot reconcile will overwrite this with
     the server balance — do this on plain web where the economy stays offline, or use an
     account that genuinely has 1–4 gems.)
    Play, die.
      AFTER the change: CONTINUE? appears with "💎 GET GEMS · NEED 5" ENABLED. Tap it →
      the shop opens on the "Get Coins" tab and the ring stops counting down. Close the shop
      with ✕ → the CONTINUE? screen is still there and the 5s countdown restarts.
  Step 4 — daily missions. Open the ☰ / missions modal and confirm none of the three rows
      says "Revive once". (After Step 1 cleared sb_missions, this is a fresh roll.)
````


## 5. 건드리지 말 것

1. reviveGemCost (index.html ~line 1820) and every server-side spend path. The gem price
   ladder and the actual debit stay exactly as they are. reviveOptions() only READS
   SB.reviveGemCost(revivesUsed); it never computes or overrides a price.
2. functions/coinSystem.js, functions/iapVerification.js, functions/index.js — this task
   touches ZERO server files. Do not open them. MIGRATION_CUTOFF_MS, MAX_SCORE_PER_SEC,
   BASE_BUFFER, MAX_CREDITED_SECONDS, grantRunCoins: all untouched.
3. firestore.rules — untouched. users/{uid} stays 'allow write: if false'.
4. The spendCurrency({ reason: 'revive' }) call and the lines around it in reviveVia — the
   sessionToken injection and the `if (!r.ok) { showReviveScreen(); return; }` line stay
   byte-identical. Hunk G stops at `const gemBtn = document.getElementById('revive-gem');`.
5. ADS_ENABLED stays false. This task makes the ads-off case behave well; it does not turn
   ads on. When real AdMob ids land and ADS_ENABLED flips to true, every change here
   self-adjusts (reviveOptions().adOk becomes true, revive1 re-enters the mission pool).
6. MAX_REVIVES = 3 — unchanged. The `revivesUsed < MAX_REVIVES` term stays first in the
   && so the cheap check short-circuits before reviveOptions() runs.
7. The 5-second revive countdown itself, reviveStart, the visibilitychange handler that
   pushes reviveStart forward while backgrounded — all unchanged. Players who DO have a
   revive path still get the full 5 seconds. Only the result-screen delay (hunk I) shrinks.
8. The revive-screen HTML at ~line 503-512 — do not edit the markup. The gem button's label
   is now rewritten at runtime by showReviveScreen; the static "💎 <span
   id="revive-gem-cost">5</span>  REVIVE NOW" in the HTML is just the pre-paint default.
   Keep the id="revive-gem-cost" span present in BOTH runtime label variants (it is in the
   replacement code) so nothing that queries that id can hit null.
9. The #revive-ad button line and its Korean/English comment in showReviveScreen — leave
   exactly as-is; it already hides correctly. Hunk F's replacement ends on that comment's
   first line, which is included only as a match anchor.
10. Do not remove 'revive1' from MISSION_POOL. It is filtered out of the rotation pool at
    pick time only. Deleting it would make missionDef() return undefined for any player who
    already had it rolled today, silently dropping the row from their mission list.
11. Do not edit public/index.html by hand — it is gitignored and regenerated.


## 6. 리스크

1. A player who quits to the shop mid-revive leaves the run frozen on the CONTINUE? screen
   while the modal is open. Mitigated: the 300ms poller re-runs showReviveScreen the moment
   the modal loses .open, which restarts the countdown, and doRevive/declineRevive/
   showReviveScreen all clear the poller. Worst case the poller self-terminates on its next
   tick because it checks gameState === 'revive' before doing anything.
2. If the player spends their remaining gems on a SKIN inside that shop visit, they can come
   back with 0 gems and no revive path. The `if (!opt.any) { declineRevive(); return; }`
   guard at the top of showReviveScreen catches exactly this and falls through to the result
   screen instead of rendering an empty CONTINUE? panel.
3. finalizeGameOver is not idempotent (it grants coins and calls submitScore). Verify by
   reading that declineRevive is reached at most once per death: triggerDeath is guarded by
   pendingDeathHandled, and the showReviveScreen guard can only fire while gameState is
   'revive' or 'playing', never after a decline has already set it to 'result'.
4. Fewer revive screens means fewer rewarded-ad impressions ONCE ADS ARE ON. Today that is
   zero either way (ADS_ENABLED=false). When ads are flipped on, adOk becomes true and the
   screen shows for everyone again — no behaviour is lost, only the dead-configuration case
   is skipped.
5. 700ms may feel abrupt on very slow devices where the ball-throw animation lags. If it
   reads badly in the smoke test, 900ms is an acceptable alternative; the verifier accepts
   anything <= 800 so bump that threshold too if you go higher.
6. Players who already rolled 'revive1' for today keep it until the next 09:00 KST reset.
   That is intentional (see DO-NOT-TOUCH #10) — it is a one-day tail, not a bug.
7. The gem-upsell branch depends on SB.gemsPurchasable existing. reviveOptions guards with
   `SB.gemsPurchasable && SB.gemsPurchasable()`, so if hunks A/D are skipped the feature
   degrades to "hide the gem button" rather than throwing — but the verifier will fail, so
   do not skip them.


## 7. 커밋 메시지

```
The revive screen was dead UI for the launch configuration. ADS_ENABLED is false so the rewarded-ad button is hidden, and there is no gameplay gem faucet, so a new install always saw a single disabled 💎 button, a 5-second countdown, and a forced "No thanks" tap between every death and the result screen — followed by another 1.5s of dead time. triggerDeath now gates on reviveOptions().any, a single explicit definition of "a revive path actually exists" (rewarded ad available, OR enough gems to pay reviveGemCost, OR some gems plus a platform where gems are actually purchasable), and goes straight to finalizeGameOver when none of the three hold. When the player has gems but not enough, the gem button is no longer disabled: it becomes "GET GEMS · NEED n" and opens the shop's Get Coins tab, pausing the countdown until the shop closes and then re-evaluating the balance — with ads off, IAP is the only revenue and this death moment is the game's only point of genuine gem demand, so it must route to the store instead of dead-ending. The result-screen delay drops 1500ms → 700ms. Finally, the 'revive1' daily mission is flagged needsAds and filtered out of the rotation pool while rewarded ads are unavailable, so it stops burning one of the three daily mission slots on something unachievable; the pool entry itself is kept so already-rotated missions from a previous KST day still resolve through missionDef. No change to reviveGemCost, to spendCurrency, or to any server-side spend/grant logic.
```
