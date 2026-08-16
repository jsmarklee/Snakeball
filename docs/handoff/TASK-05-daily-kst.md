# T5 · Daily streak: derive "yesterday" from the KST today() helper, and reconcile daily/missions from the server response

> 이 파일은 **단독 실행 가능한 작업지시서**다. 그대로 복사해 붙여넣으면 된다.
> **시작 전 [RULES.md](RULES.md) 를 먼저 읽을 것** — 건드리면 안 되는 것들이 있다.

- **난이도/소요**: ~20 minutes. Four small edits in one file (net +30 / -4 lines), all in inline module script #1. No new dependencies, no API changes, no data migration. Verification adds ~5 minutes.
- **배포 필요**: Hosting only.

    cd /Users/mark/repos/Snakeball
    npm run sync:public      # REQUIRED after any index.html edit
    npm run deploy:web       # sync:public + firebase deploy --only hosting + deploy:rules

NOT required: `firebase deploy --only functions` (functions/ is untouched — the server was already
correct), no firestore.rules change beyond what deploy:web already re-pushes unchanged, no iOS
rebuild, no Android rebuild, no Toss `ait build`/`ait deploy` for the fix itself. iOS and Android
load the hosted URL, so `npm run deploy:web` reaches all three of Web/iOS/Android with no store
review. Toss picks it up on its next `npm run toss:build && npm run toss:deploy` (this change is
inside a plain module script, uses no @apps-in-toss API, and needs no Toss-specific handling).



---

## 1. 대상 파일

```
/Users/mark/repos/Snakeball/index.html (all four edits are in inline `<script type="module">` #1, the window.SB layer). No other file changes. After editing, run `npm run sync:public`.
```


## 2. 현재 코드 (파일에서 이대로 찾을 것)

> 줄 번호는 밀릴 수 있다. **아래 문자열로 검색**해서 찾아라.
> 안 찾아지면 누가 이미 고친 것이니 **멈추고 사람에게 물어라.**

````
There are FOUR edit sites, all in /Users/mark/repos/Snakeball/index.html. Apply them in this order. Each CURRENT block below is copied verbatim from the file (as of commit 09132ef) and is uniquely findable.

════════ SITE 1 — around line 683-692 (the Persistence block) ════════

// ---------- Persistence ----------
const LS = window.localStorage;
// KST(UTC+9) 기준 날짜 키 — 서버(coinSystem/index.js)가 KST로 데일리/미션/주차를
// 리셋하므로 클라도 KST로 맞춘다. UTC로 두면 09:00 KST 전후로 클라-서버 날짜가
// 어긋나 "토스트는 뜨는데 서버는 ALREADY_CLAIMED 거부"하는 유령 클레임이 난다.
const today = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10); // YYYY-MM-DD (KST)
function load(key, def) {
    try { const v = LS.getItem(key); return v === null ? def : JSON.parse(v); }
    catch (e) { return def; }
}

════════ SITE 2 — around line 1301-1314 (claimDaily) ════════

// ---------- Daily reward ----------
function dailyAvailable() { return state.daily.last !== today(); }
async function claimDaily() {
    if (!dailyAvailable()) return;
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const streak = state.daily.last === yesterday ? Math.min(state.daily.streak + 1, 7) : 1;
    const reward = DAILY_REWARDS[(streak - 1) % 7];
    state.daily = { last: today(), streak };   // 낙관적 로컬(재청구 방지). 코인/젬은 서버 지급.
    vibrate('success');
    persist();
    renderDaily(); updateBadges();
    toast('Day ' + streak + ' reward! ' + rewardText(reward));
    await submitEarn('claimDaily', 'claimDaily', {});
}

════════ SITE 3 — around line 1518-1527 (renderDaily) ════════

// --- Daily ---
function renderDaily() {
    const grid = $('daily-grid'); if (!grid) return;
    grid.innerHTML = '';
    const claimedToday = !dailyAvailable();
    const curStreak = state.daily.streak || 0;
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    // Effective streak that the NEXT claim will award (mirrors claimDaily logic)
    const nextStreak = state.daily.last === yesterday ? Math.min(curStreak + 1, 7) : 1;
    for (let i = 0; i < 7; i++) {

════════ SITE 4 — around line 1796-1805 (tail of applyServerBalance) ════════

            state.powerups[id] = Math.min(local, server);
        }
    }
    if (resp.config_public) adoptConfigPublic(resp.config_public);
    refreshHUD();
    persist();
}
````


## 3. 교체할 코드

````
Paste each REPLACEMENT over the matching CURRENT block. Indentation is 4 spaces, matching the file. Do not reflow or re-indent anything else.

════════ SITE 1 — REPLACEMENT ════════

// ---------- Persistence ----------
const LS = window.localStorage;
// KST(UTC+9) 기준 날짜 키 — 서버(coinSystem/index.js)가 KST로 데일리/미션/주차를
// 리셋하므로 클라도 KST로 맞춘다. UTC로 두면 09:00 KST 전후로 클라-서버 날짜가
// 어긋나 "토스트는 뜨는데 서버는 ALREADY_CLAIMED 거부"하는 유령 클레임이 난다.
const today = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10); // YYYY-MM-DD (KST)
// 어제 키 — 반드시 today() 에서 파생시킨다. +9h 오프셋을 세 번째 장소에 복사하면
// 또 어긋난다. today() 결과(KST 날짜)를 UTC 자정으로 파싱해 하루 빼는 방식이라
// 산술이 순수 UTC 라 DST/로컬 타임존 영향이 없고, 서버 kstDateKey(now-86400000) 과
// 항상 같은 값이 나온다. (raw `Date.now() - 86400000` 을 쓰면 00:00~09:00 KST 구간에서
// 그제 날짜가 나와 스트릭 판정이 하루 밀린다.)
const yesterday = () => new Date(Date.parse(today() + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
function load(key, def) {
    try { const v = LS.getItem(key); return v === null ? def : JSON.parse(v); }
    catch (e) { return def; }
}

════════ SITE 2 — REPLACEMENT ════════
(the local `const yesterday = ...` line is DELETED, not renamed — leaving it would shadow the new
 module-level helper and `yesterday()` would throw "yesterday is not a function")

// ---------- Daily reward ----------
function dailyAvailable() { return state.daily.last !== today(); }
async function claimDaily() {
    if (!dailyAvailable()) return;
    const streak = state.daily.last === yesterday() ? Math.min(state.daily.streak + 1, 7) : 1;
    const reward = DAILY_REWARDS[(streak - 1) % 7];
    state.daily = { last: today(), streak };   // 낙관적 로컬(재청구 방지). 코인/젬은 서버 지급.
    vibrate('success');
    persist();
    renderDaily(); updateBadges();
    toast('Day ' + streak + ' reward! ' + rewardText(reward));
    await submitEarn('claimDaily', 'claimDaily', {});
}

════════ SITE 3 — REPLACEMENT ════════
(same: the local `const yesterday = ...` line is DELETED)

// --- Daily ---
function renderDaily() {
    const grid = $('daily-grid'); if (!grid) return;
    grid.innerHTML = '';
    const claimedToday = !dailyAvailable();
    const curStreak = state.daily.streak || 0;
    // Effective streak that the NEXT claim will award (mirrors claimDaily logic)
    const nextStreak = state.daily.last === yesterday() ? Math.min(curStreak + 1, 7) : 1;
    for (let i = 0; i < 7; i++) {

════════ SITE 4 — REPLACEMENT ════════

            state.powerups[id] = Math.min(local, server);
        }
    }
    // 데일리/미션도 서버가 권위다. 여기서 반영하지 않으면 클라 localStorage 의 streak/claimed
    // 이 서버와 어긋난 채로 영원히 남는다 — UI 는 "Day 7 보상"이라고 약속하는데 서버는 Day 1 을
    // 지급하는 식(잔액 자체는 서버가 진실이라 화폐 손실은 없고, 표시만 거짓말한다).
    let dailyStateTouched = false;
    if (resp.daily && typeof resp.daily.last === 'string') {
        state.daily = { last: resp.daily.last, streak: Number(resp.daily.streak) || 0 };
        dailyStateTouched = true;
    }
    // 서버 missions 는 { date, claimed:{id:true} } 만 안다 — 어떤 3개를 뽑았는지도, progress 도
    // 클라 전용이다. 그래서 응답이 "오늘자"이고 로컬 목록도 오늘자일 때만 claimed 플래그를
    // 서버값으로 맞추고, list/progress 는 손대지 않는다. (날짜가 다르면 서로 다른 날 이야기라 무시.)
    if (resp.missions && typeof resp.missions === 'object' && resp.missions.date === today()
        && state.missions && state.missions.date === today() && Array.isArray(state.missions.list)) {
        const claimedMap = resp.missions.claimed || {};
        for (const entry of state.missions.list) entry.claimed = !!claimedMap[entry.id];
        dailyStateTouched = true;
    }
    if (resp.config_public) adoptConfigPublic(resp.config_public);
    refreshHUD();
    if (dailyStateTouched) {
        updateBadges();
        // 부팅 리컨사일이 데일리 자동 팝업(+600ms)보다 늦게 올 수 있다 → 열려 있는 모달만 다시 그린다.
        if ($('daily-modal')?.classList.contains('open')) renderDaily();
        if ($('missions-modal')?.classList.contains('open')) renderMissions();
    }
    persist();
}

════════ AFTER ALL FOUR EDITS ════════
Run, from /Users/mark/repos/Snakeball:
    npm run sync:public
````


## 4. 검증 (수정 전 실패 → 수정 후 성공이어야 함)

````
PRIMARY (deterministic, timezone-independent, no network). Save this file as /tmp/verify_t5.mjs
and run `node /tmp/verify_t5.mjs`. It parses index.html, fakes the clock to an instant inside the
old bug window, and exercises the real `applyServerBalance` source extracted from the file.

--- BEGIN /tmp/verify_t5.mjs ---
// T5 verification — KST daily streak + server daily/missions reconcile.
import fs from 'node:fs';

const FILE = '/Users/mark/repos/Snakeball/index.html';
const src = fs.readFileSync(FILE, 'utf8');
const fail = (m) => { console.error('FAIL: ' + m); process.exit(1); };

// ---- 1) no raw-UTC yesterday left anywhere ----
if (/new Date\(Date\.now\(\) - 86400000\)/.test(src)) fail('raw UTC yesterday still present in index.html');

// ---- 2) today()/yesterday() are both KST and exactly one day apart ----
const todayLine = src.match(/^const today = .*$/m);
const yestLine = src.match(/^const yesterday = .*$/m);
if (!todayLine) fail('const today = ... not found');
if (!yestLine) fail('const yesterday = ... helper not found (fix 1 not applied)');

Date.now = () => Date.parse('2026-08-16T16:00:00Z'); // = 2026-08-17 01:00 KST (inside the old bug window)
const { today, yesterday } = new Function(
  todayLine[0] + '\n' + yestLine[0] + '\nreturn { today, yesterday };')();

if (today() !== '2026-08-17') fail(`today() = ${today()}, expected 2026-08-17`);
if (yesterday() !== '2026-08-16') fail(`yesterday() = ${yesterday()}, expected 2026-08-16 (got the UTC day, not the KST day)`);

// ---- 3) applyServerBalance reconciles daily + missions ----
const sig = 'function applyServerBalance(resp, opts = {}) {';
const i = src.indexOf(sig);
if (i < 0) fail('applyServerBalance not found');
const j = src.indexOf('\n}\n', i);
const abSrc = src.slice(i, j + 2);

const state = {
  coins: 0, gems: 0, owned: [], powerups: { headstart: 0, magnet: 0, shield: 0 },
  daily: { last: '2020-01-01', streak: 6 },
  missions: { date: today(), list: [{ id: 'm1', progress: 5, claimed: false }] },
};
const noop = () => {};
const applyServerBalance = new Function(
  'state', 'today', 'refreshHUD', 'persist', 'updateBadges', 'renderDaily', 'renderMissions', '$', 'adoptConfigPublic',
  abSrc + '\nreturn applyServerBalance;',
)(state, today, noop, noop, noop, noop, noop, () => null, noop);

applyServerBalance({
  coins: 10,
  daily: { last: today(), streak: 3 },
  missions: { date: today(), claimed: { m1: true } },
});

if (state.daily.streak !== 3 || state.daily.last !== today()) {
  fail(`daily not reconciled from server: ${JSON.stringify(state.daily)} (expected {"last":"${today()}","streak":3})`);
}
if (state.missions.list[0].claimed !== true) fail('mission claimed flag not reconciled from server');
if (state.missions.list[0].progress !== 5) fail('mission progress was clobbered (must stay client-side)');

console.log('PASS: KST yesterday helper + daily/missions reconcile OK');
--- END /tmp/verify_t5.mjs ---

EXPECTED, before the change (already confirmed against commit 09132ef):
    $ node /tmp/verify_t5.mjs ; echo "exit=$?"
    FAIL: raw UTC yesterday still present in index.html
    exit=1

EXPECTED, after the change (already confirmed against a patched copy):
    $ node /tmp/verify_t5.mjs ; echo "exit=$?"
    PASS: KST yesterday helper + daily/missions reconcile OK
    exit=0

If it prints any other FAIL line, the edit is wrong — re-read that FAIL message, it names the
exact assertion that broke. Do not "fix" the script.

SECOND GATE — syntax. Both inline module scripts must still parse:
    cd /Users/mark/repos/Snakeball
    node -e "const fs=require('fs');const s=fs.readFileSync('index.html','utf8');const re=/<script type=\"module\">([\s\S]*?)<\/script>/g;let m,n=0;while((m=re.exec(s))){n++;fs.writeFileSync('/tmp/mod'+n+'.mjs',m[1]);}console.log('modules:',n)" \
      && node --check /tmp/mod1.mjs && node --check /tmp/mod2.mjs && echo "SYNTAX OK"
Expected output:
    modules: 2
    SYNTAX OK

THIRD GATE — sync check. After `npm run sync:public`:
    diff -q /Users/mark/repos/Snakeball/index.html /Users/mark/repos/Snakeball/public/index.html && echo "SYNCED"
Expected output:  SYNCED

OPTIONAL browser smoke test for the reconcile half (needs network; backend is live):
  1. cd /Users/mark/repos/Snakeball && python3 -m http.server 8799
  2. Open http://localhost:8799/index.html, open devtools console.
  3. Run: localStorage.setItem('sb_daily', JSON.stringify({last:'2020-01-01', streak:6}))
  4. Reload, wait ~5 seconds for the boot reconcile.
  5. Run: localStorage.getItem('sb_daily')
     BEFORE the change: still '{"last":"2020-01-01","streak":6}'  (the bug — client never self-corrects)
     AFTER  the change: the server's value, e.g. '{"last":"","streak":0}' for a fresh anonymous
                        user, or '{"last":"<KST today>","streak":N}' if you already claimed today.
  Note: a browser check of the *streak arithmetic* only discriminates between 00:00 and 09:00 KST
  (the bug window), which is why the node harness above — which fakes the clock — is the real gate.
````


## 5. 건드리지 말 것

Adjacent things that must NOT change, and why:

1. `const today = () => new Date(Date.now() + 9 * 60 * 60 * 1000)...` (index.html ~line 688).
   Already correct and already matches the server. Leave the line and its three comment lines
   byte-for-byte as they are; only ADD the new `yesterday` helper below it.

2. functions/coinSystem.js — DO NOT OPEN IT AS PART OF THIS FIX. `kstDateKey()`, `claimDaily()`,
   `claimMission()` and `buildStatusResponse()` are already correct; the whole bug is client-side.
   This is the money path: constants and additive fields only, and this task needs neither.

3. `MIGRATION_CUTOFF_MS` in functions/coinSystem.js — never changed, not even read here.

4. functions/index.js `submitScore` — untouched. The anti-cheat bound (MAX_SCORE_PER_SEC=300,
   BASE_BUFFER=200, MAX_CREDITED_SECONDS=600) and the `grantRunCoins` call are not part of this fix.
   Add no write there.

5. functions/iapVerification.js — untouched.

6. firestore.rules — untouched. `users/{uid}` stays `allow write: if false`; this fix adds no
   direct client write to Firestore, only reads of a Cloud Function response.

7. Inside `applyServerBalance`, do NOT modify these existing lines:
   - the `coins`/`gems` upOnly guards (FC5 protects unsynced earnings),
   - the `owned_skins` slice,
   - the whole `resp.powerups` `Math.min(local, server)` block and its comment (that min() is a
     deliberate workaround for un-reported power-up consumption),
   - `adoptConfigPublic(resp.config_public)` and `refreshHUD()`.
   The new daily/missions block is NOT gated on `upOnly` — that is intentional: `upOnly` protects
   currency, and daily/missions carry no currency, so they are always taken from the server.

8. `persist()` must stay the LAST statement of `applyServerBalance`, after the new re-render block,
   so the reconciled daily/missions are what gets cached.

9. `bootEconomy()` — do not reorder. `applyServerBalance(res?.data)` must stay BEFORE
   `await flushPendingEarns()`. That order is what lets an offline mission claim be un-claimed by
   the server snapshot and then re-claimed by the queue replay. Reversing it double-flips the flag.

10. The optimistic local writes in `claimDaily()` (`state.daily = { last: today(), streak }`) and
    `claimMission()` (`entry.claimed = true`) stay. They are the anti-double-tap guard; the server
    response now corrects them a moment later.

11. `DAILY_REWARDS`, `MISSION_POOL`, `ensureMissions()`, `dailyAvailable()`, the `toast('Day ' + ...)`
    string, and the auto-pop block in `wire()` (`if (dailyAvailable() && state.daily.last !== '')`)
    — all unchanged. The toast is already correct once the streak arithmetic is fixed.

12. Do not edit public/index.html by hand. It is a generated, gitignored copy; `npm run sync:public`
    regenerates it.


## 6. 리스크

LOW. No currency is at risk in either half — the server has always been the sole authority on
balances and on which daily tier is granted (`claimDaily` in functions/coinSystem.js recomputes the
streak from `daily.last` + `kstDateKey` and ignores anything the client sends). This fix only stops
the client from displaying a promise the server will not honour, in both directions.

Specific risks to be aware of:

1. Legacy pre-migration users may see their streak visibly reset once. If a user's local
   `sb_daily` carries a streak from the localStorage-only era but the server doc has
   `{last:"", streak:0}`, the new reconcile adopts the server's zero. That is the truth — the
   server would have granted Day 1 on their next claim regardless — but it is now visible instead
   of hidden. One-time, self-healing on the next claim.

2. Side effect of #1: the boot auto-pop is guarded by `state.daily.last !== ''`, so such a user
   will not get the auto-popped Daily modal on the boot where the reset lands. They can still open
   Daily from the home screen and claim normally. Cosmetic, one boot only.

3. Mission `claimed` flags can flip from true to false for an offline claim that never reached the
   server. This is correct (the reward was never granted, so the user should be able to claim it),
   and `flushPendingEarns()` runs immediately after the boot reconcile to replay the queued claim
   and flip it back. Worst case the user sees CLAIM for a fraction of a second.

4. `Date.parse('YYYY-MM-DDT00:00:00Z')` is spec-mandated for the ISO date-time form with an
   explicit `Z`, so it behaves identically in WKWebView, Android WebView, the Toss RN webview and
   desktop browsers. The arithmetic is pure UTC, so it is immune to DST and to the device's local
   timezone.

5. The `?.` optional chaining in the re-render guard is already used elsewhere in this file
   (`window.webkit?.messageHandlers?.adHandler`), so it is within the supported baseline.

6. Shadowing trap — the one way to break this: if the implementer renames rather than DELETES the
   local `const yesterday = ...` lines in `claimDaily()`/`renderDaily()`, or leaves them in place,
   the local binding shadows the module-level helper and `yesterday()` throws
   "yesterday is not a function" at claim time. The node harness in VERIFICATION catches this via
   assertion #1 (the raw-UTC regex still matching).


## 7. 커밋 메시지

```
fix: daily streak compared a KST date against a UTC date

index.html computes the daily/mission date key in KST (`today()` = now + 9h) to match the
server's `kstDateKey()` in functions/coinSystem.js, but both "yesterday" computations —
one in `claimDaily()`, one in `renderDaily()` — used raw UTC
(`new Date(Date.now() - 86400000).toISOString().slice(0,10)`). Between 15:00 and 24:00 UTC
(= 00:00–09:00 KST) the UTC calendar day is one behind the KST day, so the client's
"yesterday" was actually the day before yesterday, and streak continuation was judged
against the wrong day for nine hours out of every twenty-four — in both directions: a user
who claimed KST-yesterday was shown Day 1 (streak silently reset in the UI), and a user who
skipped a day was shown Day N+1 and promised the Day 7 jackpot while the server's
`claimDaily` correctly reset them to Day 1. "yesterday" is now a single module-level helper
derived from `today()` rather than a third copy of the +9h offset, so the two can never drift
apart again. Second half: `applyServerBalance()` — the single reconcile point for every server
response — silently discarded the `daily` and `missions` fields that `getEconomyStatus`,
`claimDaily` and `claimMission` return, so a client whose local streak had drifted never
self-corrected; it now adopts the server's `daily` verbatim and syncs mission `claimed` flags
from the server's claimed map (leaving client-only `list`/`progress` alone), and re-renders any
open Daily/Missions modal since the boot reconcile can land after the +600ms auto-pop. No
currency is at risk in either half — the server is and always was authoritative on the balance
and on which reward tier is granted; this is purely a UI-truth bug where the client's promise
disagreed with the server's grant.
```
