# T2 · Record validated run telemetry (score + run stats) onto game_sessions, strictly AFTER the anti-cheat bound check

> 이 파일은 **단독 실행 가능한 작업지시서**다. 그대로 복사해 붙여넣으면 된다.
> **시작 전 [RULES.md](RULES.md) 를 먼저 읽을 것** — 건드리면 안 되는 것들이 있다.

- **난이도/소요**: Small — roughly 30-45 minutes of editing plus 15 minutes of verification/deploy. Six mechanical hunks, no restructuring, no new files, no dependencies. The only real cognitive load is HUNK 3's placement, which CHECK 1 verifies automatically.
- **배포 필요**: Two deploys are required, in this exact order:

  1. cd /Users/mark/repos/Snakeball && firebase deploy --only functions
     (server first — the new server tolerates payloads WITHOUT runStats, so old
     cached clients keep working during the gap. Deploying hosting first would
     merely mean stats are dropped for a few minutes, but functions-first has no
     downside so do it that way.)

  2. npm run deploy:web
     (this runs sync:public + firebase deploy --only hosting + deploy:rules.
     firestore.rules is unchanged in this task, so the rules step is a no-op
     re-deploy of the identical file — that is fine and expected.)

NOT required:
  - firestore.rules change (no rules edit).
  - firestore.indexes.json change (map subfields are auto-indexed).
  - iOS or Android native rebuild (the shells load the hosted URL).
  - Toss rebuild is only needed if you want Toss players' telemetry too; if so,
    run `npm run toss:build && npm run toss:deploy` as a third step.

Do NOT skip `npm run sync:public` (it is inside deploy:web, but if you deploy by
hand, public/index.html is what Hosting actually serves).



---

## 1. 대상 파일

```
/Users/mark/repos/Snakeball/functions/index.js (3 hunks) and /Users/mark/repos/Snakeball/index.html (3 hunks). Total 6 hunks. After editing index.html you MUST run `npm run sync:public`.
```


## 2. 현재 코드 (파일에서 이대로 찾을 것)

> 줄 번호는 밀릴 수 있다. **아래 문자열로 검색**해서 찾아라.
> 안 찾아지면 누가 이미 고친 것이니 **멈추고 사람에게 물어라.**

````
There are SIX hunks. Apply them in the order given. Each CURRENT block below is copied byte-for-byte from the file — search for it exactly (including the Korean comments and the ── box-drawing characters).

════════════════════════════════════════════════════════════════════
HUNK 1 of 6 — /Users/mark/repos/Snakeball/functions/index.js  (around line 96)
════════════════════════════════════════════════════════════════════
CURRENT:

  if (checkBlocklist(trimmed).blocked) {
    throw new HttpsError("invalid-argument", "사용할 수 없는 이름입니다.");
  }
  return trimmed;
}

/**
 * startRun — 게임 시작 시 세션 발급 (안티치트 앵커).
 * game_sessions/{token} = { uid, startedAt, used:false } 생성.
 * 반환: { sessionToken }.
 */

════════════════════════════════════════════════════════════════════
HUNK 2 of 6 — /Users/mark/repos/Snakeball/functions/index.js  (around line 130)
════════════════════════════════════════════════════════════════════
CURRENT:

/**
 * submitScore — 세션 검증 + 점수 등록.
 * 입력: { sessionToken, score, name? }
 *  1) 세션 존재 / uid 일치 / used=false 확인 후 트랜잭션으로 used:true (리플레이 방지)
 *  2) 경과 시간 기반 점수 상한으로 안티치트
 *  3) 개인 최고점 초과 시 leaderboard_global + leaderboard_weekly_{YYYYWW} upsert,
 *     users/{uid}.bestScore 갱신
 *  4) 반환: { best, rank }
 */
exports.submitScore = onCall({ region: REGION, minInstances: 0 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "인증이 필요합니다.");
  }
  const uid = request.auth.uid;
  const { sessionToken, score, name, pickupCoins } = request.data || {};

  if (!sessionToken || typeof sessionToken !== "string") {

════════════════════════════════════════════════════════════════════
HUNK 3 of 6 — /Users/mark/repos/Snakeball/functions/index.js  (around line 191)
════════════════════════════════════════════════════════════════════
CURRENT:

  // ── 2) 안티치트 점수 상한 ──
  const elapsedSeconds = Math.max(0, (Date.now() - startedAtMs) / 1000);
  const creditedSeconds = Math.min(elapsedSeconds, MAX_CREDITED_SECONDS);
  const maxAllowed = MAX_SCORE_PER_SEC * creditedSeconds + BASE_BUFFER;
  if (score > maxAllowed) {
    // 세션은 이미 used 처리됨 — 조작 점수는 그냥 거부.
    throw new HttpsError("failed-precondition", "점수가 검증을 통과하지 못했습니다.");
  }

  // ── 3) 리더보드 / users 갱신 ──
  const userRef = db.collection("users").doc(uid);

════════════════════════════════════════════════════════════════════
HUNK 4 of 6 — /Users/mark/repos/Snakeball/index.html  (around line 1742)
════════════════════════════════════════════════════════════════════
CURRENT (note: 4-space indent, single quotes — this is the client file):

// submitScore — 1회성 토큰으로 점수 제출. 성공 시 myStanding 저장.
async function submitScore(score, pickupCoins) {
    if (!lbAvailable || !fbFns || !sessionToken || !Number.isFinite(score)) return;
    const token = sessionToken;
    sessionToken = null;        // 1회성 — 즉시 비워 중복 제출 방지
    const payload = {
        sessionToken: token,
        score: Math.round(score),
        name: state.name || undefined,
        pickupCoins: Number.isFinite(pickupCoins) ? Math.max(0, Math.floor(pickupCoins)) : 0,
    };
    try {

════════════════════════════════════════════════════════════════════
HUNK 5 of 6 — /Users/mark/repos/Snakeball/index.html  (around line 4400, inside quitToMenu)
════════════════════════════════════════════════════════════════════
CURRENT:

        SB.consumeArmed();
        if (earned > 0) SB.toast('🪙 +' + earned + ' earned');
        // 서버 권위 코인 획득 + 온라인 글로벌 리더보드 점수 제출 (pickupCoins=runCoins)
        SB.submitScore && SB.submitScore(finalScore, runCoins);
        // 네이티브 리더보드(Game Center / Play Games)에도 추가 제출
        SB.submitNativeScore && SB.submitNativeScore(finalScore);

════════════════════════════════════════════════════════════════════
HUNK 6 of 6 — /Users/mark/repos/Snakeball/index.html  (around line 4634, inside finalizeGameOver)
════════════════════════════════════════════════════════════════════
CURRENT:

    // ---- 서버 권위 코인 획득 + 온라인 글로벌 리더보드 점수 제출 (pickupCoins=runCoins) ----
    window.SB && SB.submitScore && SB.submitScore(finalScore, runCoins);
    // ---- 네이티브 리더보드(Game Center / Play Games)에도 추가 제출 ----
    window.SB && SB.submitNativeScore && SB.submitNativeScore(finalScore);
````


## 3. 교체할 코드

````
════════════════════════════════════════════════════════════════════
HUNK 1 of 6 — /Users/mark/repos/Snakeball/functions/index.js
Insert the RUN_STAT_CAPS block + sanitizeRunStats helper between the end of
sanitizeName and the startRun docblock. Nothing existing is modified.
════════════════════════════════════════════════════════════════════
REPLACE WITH:

  if (checkBlocklist(trimmed).blocked) {
    throw new HttpsError("invalid-argument", "사용할 수 없는 이름입니다.");
  }
  return trimmed;
}

// ─── 런 텔레메트리 (game_sessions 기록용) ─────────────────────
// ⚠️ 돈/점수 경로가 아니다. 여기 값은 리더보드 점수나 코인 지급 계산에 일절 쓰이지
//    않고, 오직 game_sessions 문서에 "이 런이 실제로 어땠는지"를 남기는 분석용이다.
//    startedAt/endedAt 으로 런의 "길이"는 이미 알 수 있었지만 "내용"(점수·큐브·볼)은
//    어디에도 남지 않아 "이탈 전에 얼마나 진행했나"를 영원히 답할 수 없었다.
// 조작된 숫자가 집계 평균을 망치지 않도록 상식적인 상한으로 클램프만 한다.
// 상한을 넘겼다고 제출을 거부하지는 않는다 — 점수 자체는 이미 안티치트를 통과했고,
// 텔레메트리 때문에 정상 플레이의 점수 등록이 막히면 안 된다.
const RUN_STAT_CAPS = { cubes: 100000, megas: 1000, revives: 20, combo: 1000, balls: 100000, pickupCoins: 100000 };
const RUN_END_REASONS = ["death", "quit"];

/**
 * sanitizeRunStats — 클라가 보고한 런 통계를 텔레메트리용으로 정리.
 * 숫자가 아니거나 음수/NaN 이면 0, 상한 초과면 캡, 소수는 내림.
 * 항상 모든 필드를 채운 객체를 반환한다 — 필드가 빠지면 나중에 집계 쿼리
 * (예: run.cubes 로 정렬/필터)에서 그 문서가 통째로 사라지기 때문.
 */
function sanitizeRunStats(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const clamp = (v, cap) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(Math.floor(n), cap);
  };
  return {
    cubes: clamp(src.cubes, RUN_STAT_CAPS.cubes),
    megas: clamp(src.megas, RUN_STAT_CAPS.megas),
    revives: clamp(src.revives, RUN_STAT_CAPS.revives),
    combo: clamp(src.combo, RUN_STAT_CAPS.combo),
    balls: clamp(src.balls, RUN_STAT_CAPS.balls),
    pickupCoins: clamp(src.pickupCoins, RUN_STAT_CAPS.pickupCoins),
    endReason: RUN_END_REASONS.includes(src.endReason) ? src.endReason : "unknown",
  };
}

/**
 * startRun — 게임 시작 시 세션 발급 (안티치트 앵커).
 * game_sessions/{token} = { uid, startedAt, used:false } 생성.
 * 반환: { sessionToken }.
 */

════════════════════════════════════════════════════════════════════
HUNK 2 of 6 — /Users/mark/repos/Snakeball/functions/index.js
Only two things change: the docblock gains step (2-b), and `runStats` is added
to the destructure. Everything else is byte-identical.
════════════════════════════════════════════════════════════════════
REPLACE WITH:

/**
 * submitScore — 세션 검증 + 점수 등록.
 * 입력: { sessionToken, score, name?, pickupCoins?, runStats? }
 *  1) 세션 존재 / uid 일치 / used=false 확인 후 트랜잭션으로 used:true (리플레이 방지)
 *  2) 경과 시간 기반 점수 상한으로 안티치트
 *  2-b) ⚠️ (2)를 통과한 뒤에만 game_sessions 에 런 텔레메트리(run.*) 기록
 *  3) 개인 최고점 초과 시 leaderboard_global + leaderboard_weekly_{YYYYWW} upsert,
 *     users/{uid}.bestScore 갱신
 *  4) 반환: { best, rank }
 */
exports.submitScore = onCall({ region: REGION, minInstances: 0 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "인증이 필요합니다.");
  }
  const uid = request.auth.uid;
  // runStats 는 텔레메트리 전용(선택). 없으면(구버전 클라/오프라인 큐) 0으로 채워진다.
  const { sessionToken, score, name, pickupCoins, runStats } = request.data || {};

  if (!sessionToken || typeof sessionToken !== "string") {

════════════════════════════════════════════════════════════════════
HUNK 3 of 6 — /Users/mark/repos/Snakeball/functions/index.js
★ THE CRITICAL HUNK. The new block goes BETWEEN the closing brace of the
  `if (score > maxAllowed)` check and the `// ── 3) 리더보드 / users 갱신 ──`
  comment. It must be BELOW the throw. Do not move it up. Do not put it inside
  the transaction in section (1).
════════════════════════════════════════════════════════════════════
REPLACE WITH:

  // ── 2) 안티치트 점수 상한 ──
  const elapsedSeconds = Math.max(0, (Date.now() - startedAtMs) / 1000);
  const creditedSeconds = Math.min(elapsedSeconds, MAX_CREDITED_SECONDS);
  const maxAllowed = MAX_SCORE_PER_SEC * creditedSeconds + BASE_BUFFER;
  if (score > maxAllowed) {
    // 세션은 이미 used 처리됨 — 조작 점수는 그냥 거부.
    throw new HttpsError("failed-precondition", "점수가 검증을 통과하지 못했습니다.");
  }

  // ── 2-b) 런 텔레메트리 기록 ──
  // ⚠️⚠️ 순서 고정. 이 블록은 **반드시 위 (2) 상한 검증을 통과한 뒤**에 있어야 한다.
  //     (1)의 세션 트랜잭션은 리플레이 방지를 위해 검증보다 **먼저** used:true 를 찍는다.
  //     그래서 이 기록을 트랜잭션 안으로 옮기거나 (2) 위로 올리면, 검증에서 거부된
  //     조작 점수까지 game_sessions 에 "정상 런"처럼 남아 분석 데이터가 영구히 오염된다.
  //     위로 옮기지 말 것. 트랜잭션 안에 넣지 말 것.
  // 기록만 하고 반환값은 쓰지 않는다. 실패해도 점수 등록/코인 지급을 막지 않는다
  // (텔레메트리 < 게임 플로우). 세션은 이미 used 라 세션당 정확히 1회만 기록된다.
  try {
    const runStatsClean = sanitizeRunStats(Object.assign({}, runStats, { pickupCoins }));
    await sessionRef.update({
      // run.* = "안티치트를 통과한 런"만 담긴다. score 는 서버가 검증한 값 그대로.
      // durationSec 는 startedAt/endedAt 으로도 구할 수 있지만, Firestore 가 파생값을
      // 쿼리할 수 없어 정렬/필터용으로 미리 박아둔다.
      // revives 는 클라 보고(광고+젬 합계)다 — 세션의 reviveCount 는 젬 부활만 세므로 상보적.
      run: Object.assign({ score, durationSec: Math.round(elapsedSeconds) }, runStatsClean),
      runRecordedAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error("run telemetry write failed (score still recorded):", err);
  }

  // ── 3) 리더보드 / users 갱신 ──
  const userRef = db.collection("users").doc(uid);

════════════════════════════════════════════════════════════════════
HUNK 4 of 6 — /Users/mark/repos/Snakeball/index.html
Adds a 3rd optional parameter and a sanitized `runStats` key on the payload.
The `try {` line that follows is unchanged — it is shown only as an anchor.
════════════════════════════════════════════════════════════════════
REPLACE WITH:

// submitScore — 1회성 토큰으로 점수 제출. 성공 시 myStanding 저장.
// runStats(선택) = 텔레메트리 전용 { cubes, megas, revives, combo, balls, endReason }.
// 서버는 안티치트 상한 검증을 통과한 런만 game_sessions 에 기록한다(index.js 2-b).
async function submitScore(score, pickupCoins, runStats) {
    if (!lbAvailable || !fbFns || !sessionToken || !Number.isFinite(score)) return;
    const token = sessionToken;
    sessionToken = null;        // 1회성 — 즉시 비워 중복 제출 방지
    const rs = (runStats && typeof runStats === 'object') ? runStats : {};
    const int0 = (v) => Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
    const payload = {
        sessionToken: token,
        score: Math.round(score),
        name: state.name || undefined,
        pickupCoins: Number.isFinite(pickupCoins) ? Math.max(0, Math.floor(pickupCoins)) : 0,
        // 텔레메트리 — payload 통째로 오프라인 큐에 저장되므로 재전송(FC6) 때도 유지된다.
        runStats: {
            cubes: int0(rs.cubes),
            megas: int0(rs.megas),
            revives: int0(rs.revives),
            combo: int0(rs.combo),
            balls: int0(rs.balls),
            endReason: rs.endReason === 'quit' ? 'quit' : 'death',
        },
    };
    try {

════════════════════════════════════════════════════════════════════
HUNK 5 of 6 — /Users/mark/repos/Snakeball/index.html (quitToMenu)
Note: the key is `revives` here (server field name), NOT `revived`.
`revived` belongs to SB.reportRun and must stay as-is — see DO-NOT-TOUCH.
════════════════════════════════════════════════════════════════════
REPLACE WITH:

        SB.consumeArmed();
        if (earned > 0) SB.toast('🪙 +' + earned + ' earned');
        // 서버 권위 코인 획득 + 온라인 글로벌 리더보드 점수 제출 (pickupCoins=runCoins)
        // 3번째 인자 = 런 텔레메트리. 서버가 안티치트 통과 후 game_sessions.run 에 기록.
        SB.submitScore && SB.submitScore(finalScore, runCoins, {
            cubes: cubesBrokenThisRun, megas: megasThisRun, revives: revivesUsed,
            combo: bestComboThisRun, balls: ballCountPeak, endReason: 'quit',
        });
        // 네이티브 리더보드(Game Center / Play Games)에도 추가 제출
        SB.submitNativeScore && SB.submitNativeScore(finalScore);

════════════════════════════════════════════════════════════════════
HUNK 6 of 6 — /Users/mark/repos/Snakeball/index.html (finalizeGameOver)
════════════════════════════════════════════════════════════════════
REPLACE WITH:

    // ---- 서버 권위 코인 획득 + 온라인 글로벌 리더보드 점수 제출 (pickupCoins=runCoins) ----
    // 3번째 인자 = 런 텔레메트리. 서버가 안티치트 통과 후 game_sessions.run 에 기록.
    window.SB && SB.submitScore && SB.submitScore(finalScore, runCoins, {
        cubes: cubesBrokenThisRun, megas: megasThisRun, revives: revivesUsed,
        combo: bestComboThisRun, balls: ballCountPeak, endReason: 'death',
    });
    // ---- 네이티브 리더보드(Game Center / Play Games)에도 추가 제출 ----
    window.SB && SB.submitNativeScore && SB.submitNativeScore(finalScore);

════════════════════════════════════════════════════════════════════
AFTER ALL SIX HUNKS — mandatory, not optional:
    cd /Users/mark/repos/Snakeball && npm run sync:public
════════════════════════════════════════════════════════════════════
````


## 4. 검증 (수정 전 실패 → 수정 후 성공이어야 함)

````
Run these from /Users/mark/repos/Snakeball. Checks 1-4 are offline and deterministic: each FAILS before the change and PASSES after. Run them BEFORE editing to see the failures, then after editing to see the passes.

────────────────────────────────────────────────────────────────
CHECK 1 — the ordering constraint (the one that matters most).
Asserts, by character offset in the source, that: used:true comes first,
then the anti-cheat bound check, then the telemetry write.
────────────────────────────────────────────────────────────────
node -e "
const s=require('fs').readFileSync('functions/index.js','utf8');
const a=s.lastIndexOf('tx.update(sessionRef, { used: true');
const b=s.indexOf('if (score > maxAllowed)');
const c=s.indexOf('runRecordedAt: FieldValue.serverTimestamp()');
console.log({usedTrue:a,boundCheck:b,telemetry:c});
const ok=a>0&&b>a&&c>b;console.log(ok?'PASS':'FAIL');process.exit(ok?0:1);
"

BEFORE the change, prints exactly:
  { usedTrue: 7359, boundCheck: 7710, telemetry: -1 }
  FAIL
(exit code 1 — telemetry:-1 means the write does not exist yet)

AFTER the change, must print three positive numbers in strictly increasing
order and then:
  PASS
(exit code 0)

If it prints PASS but telemetry < boundCheck is somehow reported, you put the
block in the wrong place — move it below the `if (score > maxAllowed) { ... }`
closing brace.

────────────────────────────────────────────────────────────────
CHECK 2 — sanitizeRunStats actually clamps. Extracts the real function
from the file and executes it.
────────────────────────────────────────────────────────────────
node -e "
const fs=require('fs');
const s=fs.readFileSync('functions/index.js','utf8');
const a=s.indexOf('const RUN_STAT_CAPS');
const b=s.indexOf('function sanitizeRunStats',a);
const e=s.indexOf('\n}\n',b)+3;
if(a<0||b<0||e<3){console.log('FAIL: sanitizeRunStats not found');process.exit(1);}
const f=eval(s.slice(a,e)+'\nsanitizeRunStats');
const r1=f({cubes:12.7,megas:-3,revives:'x',combo:1e9,balls:null,pickupCoins:40,endReason:'quit'});
const r2=f(undefined);
console.log(JSON.stringify(r1));
console.log(JSON.stringify(r2));
const ok=r1.cubes===12&&r1.megas===0&&r1.revives===0&&r1.combo===1000&&r1.balls===0&&r1.pickupCoins===40&&r1.endReason==='quit'&&r2.cubes===0&&r2.endReason==='unknown';
console.log(ok?'PASS':'FAIL');process.exit(ok?0:1);
"

BEFORE: prints "FAIL: sanitizeRunStats not found", exit 1.
AFTER, must print exactly these three lines:
  {"cubes":12,"megas":0,"revives":0,"combo":1000,"balls":0,"pickupCoins":40,"endReason":"quit"}
  {"cubes":0,"megas":0,"revives":0,"combo":0,"balls":0,"pickupCoins":0,"endReason":"unknown"}
  PASS

────────────────────────────────────────────────────────────────
CHECK 3 — both client call sites pass stats, and the payload carries them.
────────────────────────────────────────────────────────────────
node -e "
const s=require('fs').readFileSync('index.html','utf8');
const d=(s.match(/endReason: 'death'/g)||[]).length;
const q=(s.match(/endReason: 'quit'/g)||[]).length;
const p=s.includes('runStats: {');
console.log({death:d,quit:q,payloadHasRunStats:p});
const ok=d===1&&q===1&&p;console.log(ok?'PASS':'FAIL');process.exit(ok?0:1);
"

BEFORE: { death: 0, quit: 0, payloadHasRunStats: false } / FAIL, exit 1.
AFTER:  { death: 1, quit: 1, payloadHasRunStats: true }  / PASS, exit 0.
(death must be exactly 1 = finalizeGameOver; quit exactly 1 = quitToMenu.
 2 means you edited a call site twice; 0 means you missed one.)

────────────────────────────────────────────────────────────────
CHECK 4 — functions still parse, and public/ is in sync.
────────────────────────────────────────────────────────────────
node --check functions/index.js && echo "SYNTAX OK"
npm run sync:public >/dev/null && diff -q index.html public/index.html && echo "PUBLIC IN SYNC"

Expected after the change:
  SYNTAX OK
  Files index.html and public/index.html are identical  →  (diff -q prints nothing on match)
  PUBLIC IN SYNC

────────────────────────────────────────────────────────────────
CHECK 5 — live end-to-end, AFTER deploying (see the deploy field).
────────────────────────────────────────────────────────────────
a) Open the deployed game, play one run and let the ball crash (do NOT quit
   from the pause menu). Let the result screen appear.
b) Read back the newest session document:

   gcloud auth application-default login      # once, if not already authed
   cd /Users/mark/repos/Snakeball/functions && node -e "
   const admin=require('firebase-admin');
   admin.initializeApp({projectId:'snakeball-game'});
   admin.firestore().collection('game_sessions').orderBy('startedAt','desc').limit(1).get()
     .then(s=>{s.forEach(d=>console.log(d.id, JSON.stringify(d.data(),null,1)));process.exit(0);});
   "

   Expected: the document now contains a `run` map and `runRecordedAt`, e.g.
     "run": { "score": 214, "durationSec": 37, "cubes": 11, "megas": 1,
              "revives": 0, "combo": 6, "balls": 23, "pickupCoins": 14,
              "endReason": "death" }
   run.score must equal the score shown on the result screen.
   run.endReason must be "death".

   (Firebase Console → Firestore → game_sessions → sort by startedAt desc
   is an equivalent way to read the same document if you prefer the UI.)

c) Repeat with a run you QUIT from the pause menu. The newest document must
   show "endReason": "quit".

d) Negative case — the ordering guarantee. In the browser devtools console on
   the deployed page, forge an impossible score on a fresh session:

     const fns = firebase.app().functions('asia-northeast3');
     const t = (await fns.httpsCallable('startRun')()).data.sessionToken;
     try { await fns.httpsCallable('submitScore')({sessionToken:t, score:9999999,
           runStats:{cubes:999,megas:9,revives:0,combo:99,balls:999,endReason:'death'}}); }
     catch(e){ console.log('rejected:', e.code, e.message); }
     console.log('session was:', t);

   Expected console output: rejected: functions/failed-precondition
   "점수가 검증을 통과하지 못했습니다."
   Then read that exact session id back with the node script in (b)
   (swap the query for .doc(t).get()). It MUST have used:true and endedAt,
   and MUST NOT have a `run` field or `runRecordedAt`.
   If `run` is present on that rejected session, the telemetry block is in the
   wrong place — go back to CHECK 1.
````


## 5. 건드리지 말 것

Things adjacent to this change that must NOT be modified. Changing any of these breaks money, anti-cheat, or the offline-recovery path.

1. functions/coinSystem.js — do not open it for this task. grantRunCoins and the
   spendCurrency 'revive' transaction (which writes reviveCount onto the SAME
   game_sessions doc) stay exactly as they are. Our write uses `update` with the
   distinct keys `run` and `runRecordedAt`, so it cannot collide with reviveCount.
   MIGRATION_CUTOFF_MS in that file must never be touched.

2. functions/iapVerification.js — untouched. Not involved.

3. The anti-cheat constants in functions/index.js: MAX_SCORE_PER_SEC = 300,
   BASE_BUFFER = 200, MAX_CREDITED_SECONDS = 600, ABSOLUTE_MAX_SCORE,
   SESSION_TTL_MS, RANK_QUERY_CAP. Do NOT change any value, and do NOT add the
   new RUN_STAT_CAPS into that constants block — RUN_STAT_CAPS belongs next to
   sanitizeRunStats (HUNK 1) so CHECK 2's extraction can find both together.

4. The session transaction in submitScore step (1) — every line of
   `db.runTransaction(async (tx) => { ... })`, including both
   `tx.update(sessionRef, { used: true, endedAt: ... })` calls. Do not add the
   telemetry write here. Do not reorder used:true relative to the bound check to
   "make it cleaner"; used:true intentionally lands before validation so a
   rejected submission still burns its session and cannot be retried.

5. The `if (score > maxAllowed) { throw ... }` block itself. Do not soften it,
   do not convert the throw into a warning, do not record the run and continue.

6. The grantRunCoins call in step (5) and its surrounding try/catch. Do not move
   it, do not pass runStats to it, do not make its result affect telemetry.

7. The leaderboard batch in step (3) — the `createdAt: userData.createdAt || ...`
   line in particular. That guard protects the economy-migration import gate;
   removing it wipes legacy players' localStorage balances.

8. firestore.rules — no change. users/{uid} stays `allow write: if false` and
   game_sessions stays `allow read, write: if false`. Telemetry is written by
   Admin SDK inside the function; the client must remain unable to touch
   game_sessions. Do not "open it up so the client can log directly."

9. firestore.indexes.json — no change. Firestore auto-indexes map subfields, so
   `run.score` / `run.durationSec` queries work without a composite index.

10. index.html — SB.reportRun and its `run.revived` key. reportRun drives daily
    missions and local stats; leave its signature and its `revived` spelling
    alone. The new telemetry path deliberately uses `revives` (matching the
    server field). Do not "unify" the two names.

11. index.html — enqueueEarn / flushPendingEarns / isTransientEarnError. The
    offline queue stores the whole payload object, so runStats rides along for
    free. Do not add special handling for it there.

12. index.html — startRun(), the `sessionToken = null` one-shot clearing, and
    applyServerBalance({coins}, {upOnly:true}). Untouched.

13. Mobile/iOS and Mobile/Android — no native change. The bridge contract is
    unaffected; no rebuild, no resubmission.


## 6. 리스크

1. One extra Firestore write per completed run on game_sessions. At launch scale
   this is negligible cost, but it is a real +1 write/run — worth knowing before
   any traffic spike.

2. submitScore gains one awaited Firestore round-trip (~10-30ms in-region). It
   happens after the game has ended, while the result screen is already drawn,
   so it is not on any interactive path. It is awaited deliberately: Cloud
   Functions v2 can freeze the container after the response is returned, and a
   fire-and-forget write would be silently lost.

3. Old cached clients and already-queued offline payloads have no runStats. Those
   sessions get run.* all zeros with endReason:"unknown". This is intentional and
   useful (it marks stale clients), but anyone querying this data must filter
   `run.endReason != "unknown"` before computing averages, or the zeros will drag
   every mean down. Say so to whoever consumes the data.

4. Client-reported counters are trust-on-report. A modified client can lie about
   cubes/megas/combo/balls within the caps. That is acceptable because these
   values touch neither the leaderboard nor the coin ledger — but do not later
   repurpose run.* as an input to any reward calculation without re-deriving them
   server-side. Only run.score and run.durationSec are server-validated.

5. game_sessions has no TTL/cleanup policy today, and this change makes each
   document slightly larger. Not a blocker now, but the collection grows without
   bound — a Firestore TTL policy on startedAt (or a scheduled purge) is a
   sensible follow-up, out of scope here.

6. The single highest-risk failure mode is misplacing HUNK 3. If it lands inside
   the step (1) transaction or above the bound check, cheated submissions get
   recorded as legitimate runs and the analytics data is quietly poisoned with no
   visible symptom. CHECK 1 and CHECK 5(d) exist specifically to catch this — run
   both, do not skip them.


## 7. 커밋 메시지

```
telemetry: record validated run content on game_sessions

game_sessions documents carried only startedAt (startRun) and endedAt/used (submitScore), so run *length* was derivable but run *content* was not — nothing recorded the score, cubes broken, mega-balls, peak ball count, best combo, revives, or whether the player died or quit. That made "how far did they get before they bailed?" permanently unanswerable, because unlogged runs cannot be reconstructed after the fact. This change extends the existing submitScore payload with an optional runStats object (the same numbers the client already computes for SB.reportRun, so no new tracking code is needed) and writes them onto the session doc under a single `run` map. Extending the existing call was chosen over a separate client write or a second callable: firestore.rules deliberately denies all client writes to game_sessions, a second callable would double the cold-start cost at the exact moment the result screen wants to be responsive, and — most importantly — only the inside of submitScore knows whether the score passed the anti-cheat bound. The placement is the whole point of the change: the session transaction in step (1) stamps used:true *before* the bound check in step (2) so replays are blocked even for rejected submissions, so a telemetry write placed in that transaction would have silently recorded cheated scores as legitimate runs. The write therefore sits in a new step (2-b), below the `score > maxAllowed` throw, guaranteeing run.* only ever contains validated runs. Client-reported counters are clamped by sanitizeRunStats to sane caps (telemetry robustness, not a security boundary — these values touch neither the leaderboard nor the coin ledger), the write is wrapped in try/catch so a telemetry failure can never block score submission or coin grants, and grantRunCoins and the entire money path are untouched.
```
