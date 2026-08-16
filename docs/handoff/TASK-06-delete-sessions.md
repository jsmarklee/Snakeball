# T6 · COMPLIANCE — deleteMyData must also delete the caller's game_sessions documents (bounded, idempotent sweep)

> 이 파일은 **단독 실행 가능한 작업지시서**다. 그대로 복사해 붙여넣으면 된다.
> **시작 전 [RULES.md](RULES.md) 를 먼저 읽을 것** — 건드리면 안 되는 것들이 있다.

- **난이도/소요**: ~30 minutes total. Roughly: 5 min creating functions/deleteSessions.js, 5 min for the two index.js edits, 10 min creating and running the test file, 5 min deploy, 5 min for the production end-to-end check (VERIFY-3). No new dependencies, no package.json change, no schema migration, no backfill script.
- **배포 필요**: FUNCTIONS ONLY. Nothing else.

  cd /Users/mark/repos/Snakeball && firebase deploy --only functions:deleteMyData

Use the single-function form deliberately: it uploads the whole functions/ source (so the new deleteSessions.js ships) but redeploys only deleteMyData, leaving the live money-path functions (verifyAndFulfillPurchase, spendCurrency, rewardFromAd, submitScore) running untouched revisions. Do NOT run a bare `firebase deploy --only functions` for this change.

NOT required:
  - npm run sync:public       (index.html unchanged)
  - npm run deploy:web        (no hosting change)
  - firebase deploy --only firestore:rules     (rules unchanged)
  - firebase deploy --only firestore:indexes   (indexes unchanged — see rationale)
  - iOS / Android native rebuild               (no bridge change)
  - Toss ait build / ait deploy                (no client change)

No new secrets or environment config. Run VERIFY-1 and VERIFY-2 BEFORE deploying; run VERIFY-3 after.


---

## 1. 대상 파일

```
THREE files are touched. Two are NEW (create them exactly as given), one is EDITED in two places.

NEW FILE 1: /Users/mark/repos/Snakeball/functions/deleteSessions.js
NEW FILE 2: /Users/mark/repos/Snakeball/functions/test/deleteSessions.test.js
EDITED:     /Users/mark/repos/Snakeball/functions/index.js  (edit A at line ~19, edit B at lines 650-676)

NOT touched: index.html, public/, firestore.rules, firestore.indexes.json, functions/coinSystem.js, functions/iapVerification.js, functions/blocklist.js, functions/test/blocklist.test.js.
```


## 2. 현재 코드 (파일에서 이대로 찾을 것)

> 줄 번호는 밀릴 수 있다. **아래 문자열로 검색**해서 찾아라.
> 안 찾아지면 누가 이미 고친 것이니 **멈추고 사람에게 물어라.**

````
There are exactly TWO anchors in /Users/mark/repos/Snakeball/functions/index.js. Both are quoted verbatim below (2-space indent, double quotes, Korean comments as-is). Do not reformat.

──────────────────────────────────────────────────────────────────────
ANCHOR A — the require block near the top of functions/index.js (lines 15-22).
Match this text exactly:

const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { checkBlocklist } = require("./blocklist");
const { verifyAndFulfill } = require("./iapVerification");
const coin = require("./coinSystem");

initializeApp();
const db = getFirestore();

──────────────────────────────────────────────────────────────────────
ANCHOR B — the whole deleteMyData block, comment header included
(functions/index.js lines 650-676). Match this text exactly:

// ─── 유저 데이터 삭제 (Apple 5.1.1(v) / Play Data Safety) ───────
//
// 익명 auth라 법적 의무는 아니나, stableId(IDFV/ANDROID_ID)·닉네임·점수·잔액을
// 서버에 저장하므로 리뷰어 재량/데이터 안전 라벨 일치를 위해 삭제 경로를 제공한다.
// users/{uid} + 리더보드 문서(global + 이번 주 weekly)를 지우고 auth 계정을 삭제한다.
// ⚠️ 과거 주차 weekly 문서와 processed_transactions(멱등 원장)는 남긴다 —
//    전자는 컬렉션명이 주차별이라 일괄 조회가 비싸고, 후자는 영수증 재사용 방지에
//    필요(개인식별정보 없음).
exports.deleteMyData = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "인증이 필요합니다.");
  const uid = request.auth.uid;

  const batch = db.batch();
  batch.delete(db.collection("users").doc(uid));
  batch.delete(db.collection("leaderboard_global").doc(uid));
  batch.delete(db.collection(`leaderboard_weekly_${isoWeekKeyKST()}`).doc(uid));
  await batch.commit();

  // auth 계정 삭제 — 실패해도 데이터는 이미 지워졌으므로 성공으로 처리(로그만).
  try {
    await getAuth().deleteUser(uid);
  } catch (e) {
    console.error("deleteMyData: auth.deleteUser failed:", e.message);
  }

  return { deleted: true };
});
──────────────────────────────────────────────────────────────────────

CONTEXT (do not edit, for locating only): ANCHOR B is immediately followed by
"// ─── IAP 영수증 검증 ──────────────────────────────────────────" and then
exports.verifyAndFulfillPurchase. Stop your replacement before that line.
````


## 3. 교체할 코드

````
Perform 4 mechanical steps in order.

══════════════════════════════════════════════════════════════════════
STEP 1 — CREATE new file /Users/mark/repos/Snakeball/functions/deleteSessions.js
with EXACTLY this content:
══════════════════════════════════════════════════════════════════════
"use strict";
/**
 * deleteSessions.js — deleteMyData 전용: uid 소유 game_sessions 문서 일괄 삭제.
 *
 * 왜 별도 파일인가: game_sessions 는 doc id 가 auto-id 라 uid 필드로 "쿼리해서" 지워야
 * 하고, Firestore 배치는 500 write 상한이 있어 루프가 필요하다. index.js 안에 인라인으로
 * 넣으면 Admin SDK 초기화 없이 테스트가 불가능해서 db 를 주입받는 헬퍼로 뺐다.
 * 결제 경로(coinSystem.js / iapVerification.js)와는 아무 관련이 없다.
 *
 * 쿼리는 uid 단일 equality + limit 뿐이다 → Firestore 자동 단일 필드 색인으로 처리되며
 * 복합 색인(firestore.indexes.json)이 필요 없다. orderBy 를 추가하면 복합 색인이
 * 필요해지므로 절대 추가하지 말 것.
 */

// Firestore 배치 상한은 500 write. 여유를 두고 400 으로 자른다.
const SESSION_DELETE_PAGE = 400;
// 한 호출에서 도는 최대 페이지 수. 400 * 25 = 10,000 세션 = 게임 10,000 판이라 사실상
// 도달 불가한 상한이며, onCall 기본 타임아웃(60s) 안에 끝나게 하는 안전장치다.
const SESSION_DELETE_MAX_PAGES = 25;

/**
 * uid 소유 game_sessions 문서를 페이지 단위로 삭제한다. 멱등 — 남은 문서가 없으면
 * 쿼리 1회로 { deleted: 0, truncated: false } 를 돌려주고 아무것도 쓰지 않는다.
 *
 * @param {FirebaseFirestore.Firestore} db Admin SDK Firestore 인스턴스.
 * @param {string} uid 삭제 대상 uid.
 * @param {{pageSize?:number, maxPages?:number}} [opts] 테스트용 오버라이드.
 * @returns {Promise<{deleted:number, truncated:boolean}>}
 *   truncated=true 면 상한에 걸려 아직 남은 문서가 있다는 뜻(운영자 수동 정리 필요).
 */
async function deleteUserSessions(db, uid, opts = {}) {
  const pageSize = opts.pageSize || SESSION_DELETE_PAGE;
  const maxPages = opts.maxPages || SESSION_DELETE_MAX_PAGES;

  let deleted = 0;
  for (let page = 0; page < maxPages; page++) {
    const snap = await db
      .collection("game_sessions")
      .where("uid", "==", uid)
      .limit(pageSize)
      .get();
    if (snap.empty) return { deleted, truncated: false };

    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snap.size;

    // limit 보다 적게 왔다 = 마지막 페이지.
    if (snap.size < pageSize) return { deleted, truncated: false };
  }

  // 상한 소진 — 정말 남았는지 1건만 확인한다.
  const rest = await db
    .collection("game_sessions")
    .where("uid", "==", uid)
    .limit(1)
    .get();
  return { deleted, truncated: !rest.empty };
}

module.exports = { deleteUserSessions, SESSION_DELETE_PAGE, SESSION_DELETE_MAX_PAGES };

══════════════════════════════════════════════════════════════════════
STEP 2 — EDIT functions/index.js, ANCHOR A. Replace the quoted block with:
══════════════════════════════════════════════════════════════════════
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { checkBlocklist } = require("./blocklist");
const { verifyAndFulfill } = require("./iapVerification");
const coin = require("./coinSystem");
const { deleteUserSessions } = require("./deleteSessions");

initializeApp();
const db = getFirestore();

(The only change is the added `deleteSessions` require line. Everything else is byte-identical.)

══════════════════════════════════════════════════════════════════════
STEP 3 — EDIT functions/index.js, ANCHOR B. Replace the whole quoted block with:
══════════════════════════════════════════════════════════════════════
// ─── 유저 데이터 삭제 (Apple 5.1.1(v) / Play Data Safety) ───────
//
// 익명 auth라 법적 의무는 아니나, stableId(IDFV/ANDROID_ID)·닉네임·점수·잔액을
// 서버에 저장하므로 리뷰어 재량/데이터 안전 라벨 일치를 위해 삭제 경로를 제공한다.
// users/{uid} + 리더보드 문서(global + 이번 주 weekly) + 이 uid 의 game_sessions 를
// 지우고 auth 계정을 삭제한다.
// ⚠️ game_sessions 는 doc id 가 auto-id 라 uid 필드로 쿼리해서 지워야 하고, 배치 500
//    상한 때문에 페이지 루프가 필요하다(deleteSessions.js). 이걸 빼먹으면
//    static/privacy.html §6 과 양대 스토어 데이터 안전 신고("삭제 요청 시 30일 내
//    제거")가 사실과 달라진다 — 2026-08 이전 버전의 실제 버그였다.
// ⚠️ 과거 주차 weekly 문서와 processed_transactions(멱등 원장)는 남긴다 —
//    전자는 컬렉션명이 주차별이라 일괄 조회가 비싸고, 후자는 영수증 재사용 방지에
//    필요(개인식별정보 없음).
exports.deleteMyData = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "인증이 필요합니다.");
  const uid = request.auth.uid;

  const batch = db.batch();
  batch.delete(db.collection("users").doc(uid));
  batch.delete(db.collection("leaderboard_global").doc(uid));
  batch.delete(db.collection(`leaderboard_weekly_${isoWeekKeyKST()}`).doc(uid));
  await batch.commit();

  // game_sessions 스윕 — 반드시 위 배치 커밋 "다음"에 돈다. 스윕이 실패해도 개인정보가
  // 담긴 users/리더보드 문서는 이미 지워진 상태여야 하기 때문이다. 스윕 실패는 요청
  // 전체를 실패시키지 않고 로그만 남긴다(헬퍼가 멱등이라 재실행해도 안전).
  let sessions = { deleted: 0, truncated: false };
  try {
    sessions = await deleteUserSessions(db, uid);
    if (sessions.truncated) {
      // 상한(10,000건)에 걸린 극단 케이스. 곧 auth 계정이 지워져 같은 uid 로는 재호출이
      // 불가능하니, 운영자가 콘솔에서 마무리할 수 있도록 uid 를 남긴다.
      console.error(
        `deleteMyData: game_sessions sweep truncated for uid=${uid} (deleted=${sessions.deleted}) — finish manually`
      );
    }
  } catch (e) {
    console.error("deleteMyData: game_sessions sweep failed:", e.message);
  }

  // auth 계정 삭제 — 실패해도 데이터는 이미 지워졌으므로 성공으로 처리(로그만).
  try {
    await getAuth().deleteUser(uid);
  } catch (e) {
    console.error("deleteMyData: auth.deleteUser failed:", e.message);
  }

  // 반환 shape 는 하위호환 — index.html 의 deleteMyData() 는 deleted 만 보고 나머지
  // 필드는 무시한다. 필드 추가만 했으므로 클라이언트 변경/재배포가 필요 없다.
  return { deleted: true, sessionsDeleted: sessions.deleted };
});

══════════════════════════════════════════════════════════════════════
STEP 4 — CREATE new file /Users/mark/repos/Snakeball/functions/test/deleteSessions.test.js
with EXACTLY this content:
══════════════════════════════════════════════════════════════════════
"use strict";
/**
 * deleteSessions.test.js — deleteMyData 의 game_sessions 스윕 회귀 테스트.
 *
 * 실행: node --test functions/test/
 *
 * 왜 있나: static/privacy.html 과 양대 스토어 데이터 안전 신고가 "삭제 요청 시 30일 내
 * 제거"를 약속하는데, 2026-08 이전 deleteMyData 는 users/리더보드만 지우고 uid 가 박힌
 * game_sessions 문서를 남겨뒀다. 배치 500 상한 때문에 루프가 필요하고, 루프는 조용히
 * 틀리기 쉬워서(페이지 경계 / 남 uid 오삭제 / 멱등성) 스텁으로 고정해 둔다.
 */
const test = require("node:test");
const assert = require("node:assert");
const { deleteUserSessions } = require("../deleteSessions");

/** 최소 Firestore 스텁 — collection().where().limit().get() 과 batch() 만 흉내낸다. */
function makeFakeDb(seed) {
  const store = new Map(Object.entries(seed)); // docId -> uid
  const stats = { queries: 0, commits: 0 };
  const db = {
    collection(name) {
      assert.strictEqual(name, "game_sessions", "game_sessions 외 컬렉션을 건드리면 안 된다");
      return {
        where(field, op, value) {
          assert.strictEqual(field, "uid");
          assert.strictEqual(op, "==");
          return {
            limit(n) {
              return {
                async get() {
                  stats.queries++;
                  const hits = [...store.entries()]
                    .filter(([, u]) => u === value)
                    .slice(0, n)
                    .map(([id]) => ({ ref: { id } }));
                  return { empty: hits.length === 0, size: hits.length, docs: hits };
                },
              };
            },
          };
        },
      };
    },
    batch() {
      const pending = [];
      return {
        delete(ref) { pending.push(ref.id); },
        async commit() { stats.commits++; pending.forEach((id) => store.delete(id)); },
      };
    },
  };
  return { db, store, stats };
}

function seedFor(uid, n, prefix = "s") {
  const out = {};
  for (let i = 0; i < n; i++) out[`${prefix}${i}`] = uid;
  return out;
}

test("세션이 없으면 아무것도 쓰지 않는다 (멱등)", async () => {
  const { db, stats } = makeFakeDb({});
  const res = await deleteUserSessions(db, "u1");
  assert.deepStrictEqual(res, { deleted: 0, truncated: false });
  assert.strictEqual(stats.commits, 0, "빈 결과에 배치 커밋이 나가면 안 된다");
  assert.strictEqual(stats.queries, 1);
});

test("본인 세션만 지우고 남의 uid 는 남긴다", async () => {
  const { db, store } = makeFakeDb({ ...seedFor("u1", 5, "a"), ...seedFor("u2", 3, "b") });
  const res = await deleteUserSessions(db, "u1");
  assert.deepStrictEqual(res, { deleted: 5, truncated: false });
  assert.strictEqual(store.size, 3);
  assert.ok([...store.values()].every((u) => u === "u2"));
});

test("페이지 경계를 넘어 950건을 전부 지운다", async () => {
  const { db, store, stats } = makeFakeDb(seedFor("u1", 950));
  const res = await deleteUserSessions(db, "u1", { pageSize: 400, maxPages: 25 });
  assert.deepStrictEqual(res, { deleted: 950, truncated: false });
  assert.strictEqual(store.size, 0);
  assert.strictEqual(stats.commits, 3);
});

test("페이지 크기의 정확한 배수도 truncated 로 오판하지 않는다", async () => {
  const { db, store } = makeFakeDb(seedFor("u1", 800));
  const res = await deleteUserSessions(db, "u1", { pageSize: 400, maxPages: 25 });
  assert.deepStrictEqual(res, { deleted: 800, truncated: false });
  assert.strictEqual(store.size, 0);
});

test("상한을 넘으면 truncated=true 로 보고한다", async () => {
  const { db, store } = makeFakeDb(seedFor("u1", 1000));
  const res = await deleteUserSessions(db, "u1", { pageSize: 10, maxPages: 3 });
  assert.deepStrictEqual(res, { deleted: 30, truncated: true });
  assert.strictEqual(store.size, 970);
});

test("두 번 호출해도 안전하다 (두 번째는 0건)", async () => {
  const { db } = makeFakeDb(seedFor("u1", 42));
  const first = await deleteUserSessions(db, "u1", { pageSize: 400, maxPages: 25 });
  const second = await deleteUserSessions(db, "u1", { pageSize: 400, maxPages: 25 });
  assert.strictEqual(first.deleted, 42);
  assert.deepStrictEqual(second, { deleted: 0, truncated: false });
});

══════════════════════════════════════════════════════════════════════
FIRESTORE INDEX: firestore.indexes.json needs NO entry. The sweep query is a
single equality filter (`uid == x`) plus `limit()` and no orderBy, which
Firestore serves from the automatic single-field index. Composite indexes are
only required for multi-field filters or a filter+orderBy on different fields.
firestore.indexes.json must stay exactly `{"indexes": [], "fieldOverrides": []}`.
Do not run `firebase deploy --only firestore:indexes`.
````


## 3-B. ⚠️ 검토에서 정정된 부분 — **이쪽이 우선**

독립 검토에서 위 내용 중 일부(주로 검증 절차)에 오류가 발견됐다.
**충돌하면 아래를 따른다.**

````
The implementer should use the ORIGINAL spec's currentCode and replacementCode with ONE one-word comment fix, and MUST replace the entire verification section with the version below.

──────────────────────────────────────────────────────────────────────
1) currentCode — UNCHANGED. Verified byte-exact and unique against
   /Users/mark/repos/Snakeball/functions/index.js. ANCHOR A (lines 15-22) and
   ANCHOR B (lines 650-676) both match exactly, one occurrence each. Do not
   re-quote or reformat them.

──────────────────────────────────────────────────────────────────────
2) replacementCode — UNCHANGED except one comment line in STEP 3.

   In STEP 3, find this line inside the new comment header:

//    static/privacy.html §6 과 양대 스토어 데이터 안전 신고("삭제 요청 시 30일 내

   and replace it with:

//    static/privacy.html §5(Data retention) 과 양대 스토어 데이터 안전 신고("삭제 요청 시 30일 내

   (Reason: the 30-day removal promise lives in §5 "Data retention", not §6.
   Verified in /Users/mark/repos/Snakeball/static/privacy.html line 96-98.)

   STEP 1, STEP 2 and STEP 4 are correct as written — I created those exact files
   in a scratch directory and ran them: 6/6 tests pass, and combined with the
   existing blocklist suite the total is 9/9. Do not change a byte of them.

──────────────────────────────────────────────────────────────────────
3) VERIFICATION — REPLACE THE SPEC'S ENTIRE VERIFICATION SECTION WITH THIS.
   Every expected value below was measured on this machine (node v20.20.1).

──────────────────────────────────────────────
VERIFY-1 — unit tests (hard gate: FAILS before, PASSES after)
──────────────────────────────────────────────
STEP 1a. BASELINE, on the unmodified tree, run:

  cd /Users/mark/repos/Snakeball && node --test functions/test/ 2>&1 | tail -8

  EXPECTED NOW (exact):
    # tests 3
    # suites 0
    # pass 3
    # fail 0
    # cancelled 0
    # skipped 0
    # todo 0
    # duration_ms <varies>

STEP 1b. To prove the new test actually gates the fix, create ONLY
functions/test/deleteSessions.test.js (STEP 4 of the work order) and run:

  cd /Users/mark/repos/Snakeball && node --test functions/test/ 2>&1 | tail -8

  EXPECTED (test file present, deleteSessions.js not yet created):
    # tests 4
    # suites 0
    # pass 3
    # fail 1
    ...
  (4 = the 3 pre-existing blocklist tests, which still run, + the 1 failing new
  file. It is NOT "tests 1". To see the reason, run without the pipe:
     cd /Users/mark/repos/Snakeball && node --test functions/test/ 2>&1 | grep -m1 "Cannot find module"
  EXPECTED: a line containing   Cannot find module '../deleteSessions'   )

STEP 1c. AFTER all 4 steps are applied, run the same command again:

  cd /Users/mark/repos/Snakeball && node --test functions/test/ 2>&1 | tail -8

  EXPECTED AFTER (exact):
    # tests 9
    # suites 0
    # pass 9
    # fail 0
    ...
  (9 = 3 blocklist + 6 deleteSessions.)
  Anything other than "pass 9 / fail 0" means STOP — do not deploy.

──────────────────────────────────────────────
VERIFY-2 — the wiring is real (deterministic; note the ';' separators)
──────────────────────────────────────────────
Run each line separately, or exactly as written with ';' — do NOT use '&&',
because `grep -c` exits 1 when it prints 0 and would short-circuit the rest.

  cd /Users/mark/repos/Snakeball
  echo "wired: $(grep -c 'deleteUserSessions' functions/index.js)"
  echo "orderBy-calls: $(grep -c '\.orderBy(' functions/deleteSessions.js)"
  git diff --stat firestore.indexes.json firestore.rules index.html

  EXPECTED AFTER (exact):
    wired: 2
      (2 matching LINES: the require at the top + the call inside deleteMyData.)
    orderBy-calls: 0
      (No `.orderBy(` call → single equality filter → automatic single-field
       index → firestore.indexes.json needs no entry.
       ⚠️ DO NOT grep for the bare word 'orderBy' — it legitimately appears once
       in the Korean doc comment of deleteSessions.js warning you not to add one.
       `grep -c 'orderBy' functions/deleteSessions.js` correctly prints 1.
       That is expected and is NOT a failure.)
    git diff --stat prints NOTHING (those three files must be untouched).

  EXPECTED BEFORE THE CHANGE:
    wired: 0
    the orderBy line errors with "No such file or directory" (file not created yet)
    git diff --stat prints nothing

──────────────────────────────────────────────
VERIFY-3 — end-to-end against production, AFTER deploying
──────────────────────────────────────────────
  1. Open the hosted game in a desktop browser with devtools.
  2. Console (the page loads firebase-*-compat.js, so the `firebase` global
     exists — this works as written):
       firebase.auth().currentUser.uid
     Copy the value; call it UID.
  3. Play and die 2-3 times. Each run's startRun writes one game_sessions doc.
  4. Firebase console > Firestore > game_sessions > query `uid == UID`.
     EXPECTED: 2-3 documents.
  5. In the game: Settings > "Delete My Data" (exact on-screen label, capital M
     and D) > confirm. Wait for the reload.
  6. Re-run the SAME console query `uid == UID`.
     EXPECTED AFTER THE FIX: 0 documents.
     EXPECTED BEFORE THE FIX (this is the bug): the 2-3 documents are still there.
  7. Firebase console > Functions > deleteMyData > Logs. There must be NO line
     containing "sweep failed" or "sweep truncated". If a FAILED_PRECONDITION
     with an index-creation URL appears, stop and report it (it should not
     happen — single equality filters are auto-indexed).

──────────────────────────────────────────────────────────────────────
4) doNotTouch / effort / deploy — UNCHANGED from the original spec. They are
   correct. Two clarifications to add:
   - functions/test/ is NOT in firebase.json's ignore list, so the new test file
     is uploaded with the function source (exactly as blocklist.test.js already
     is). This is expected and harmless — index.js never requires it.
   - Do not delete or reword the "orderBy 를 추가하면 복합 색인이 필요해지므로
     절대 추가하지 말 것" comment in deleteSessions.js to make a grep come out
     to zero. Use the `\.orderBy(` pattern in VERIFY-2 instead.
````


## 4. 검증 (수정 전 실패 → 수정 후 성공이어야 함)

````
Run all three. VERIFY-1 is the hard gate: it fails before the change and passes after.

──────────────────────────────────────────────────────────────
VERIFY-1 — unit tests (must FAIL before, PASS after)
──────────────────────────────────────────────────────────────
BASELINE, run this FIRST on the unmodified tree:

  cd /Users/mark/repos/Snakeball && node --test functions/test/ 2>&1 | tail -8

  EXPECTED NOW (before your change):
    # tests 3
    # pass 3
    # fail 0

  Then, to prove the new test actually gates the fix, create ONLY
  functions/test/deleteSessions.test.js (STEP 4) and re-run the same command.
  EXPECTED (fix not yet applied):
    # tests 1
    # pass 0
    # fail 1
  with "Cannot find module '../deleteSessions'" in the output.

AFTER all 4 steps are applied, run the same command again:

  cd /Users/mark/repos/Snakeball && node --test functions/test/ 2>&1 | tail -8

  EXPECTED AFTER:
    # tests 9
    # pass 9
    # fail 0

  (9 = 3 pre-existing blocklist tests + 6 new deleteSessions tests.
   Anything other than "pass 9 / fail 0" means STOP — do not deploy.)

──────────────────────────────────────────────────────────────
VERIFY-2 — the wiring is real (grep, deterministic)
──────────────────────────────────────────────────────────────
  cd /Users/mark/repos/Snakeball && \
  grep -c 'deleteUserSessions' functions/index.js && \
  grep -c 'orderBy' functions/deleteSessions.js ; \
  git diff --stat firestore.indexes.json firestore.rules index.html

  EXPECTED AFTER:
    2            <- the require line + the call inside deleteMyData
    0            <- grep exits 1 and prints 0: NO orderBy (no composite index needed)
    (git diff --stat prints NOTHING — those three files must be untouched)

  EXPECTED NOW (before the change): the first grep -c prints 0, and the second
  command errors with "No such file or directory".

──────────────────────────────────────────────────────────────
VERIFY-3 — end-to-end against production, AFTER deploying
──────────────────────────────────────────────────────────────
  1. Open the hosted game in a desktop browser with devtools.
  2. In the console, capture the uid BEFORE deleting:
       firebase.auth().currentUser.uid
     Copy the value (call it UID).
  3. Play and die 2-3 times (each run's startRun writes one game_sessions doc).
  4. Firebase console > Firestore > game_sessions > filter `uid == UID`.
     EXPECTED: 2-3 documents listed.
  5. In the game: Settings > "Delete my data" > confirm. Wait for the reload.
  6. Re-run the SAME console query `uid == UID` in the Firebase console.
     EXPECTED AFTER THE FIX: 0 documents.
     EXPECTED BEFORE THE FIX (this is the bug): the 2-3 documents are still there.
  7. Firebase console > Functions > deleteMyData > Logs. There must be NO line
     containing "sweep failed" or "sweep truncated". If a FAILED_PRECONDITION
     mentioning an index-creation URL appears, the index assumption was wrong —
     stop and report it (it should not happen; single equality filters are
     auto-indexed).
````


## 5. 건드리지 말 것

1. functions/coinSystem.js — do not open it. MIGRATION_CUTOFF_MS in particular must NEVER change. This task adds nothing to the money path.
2. functions/iapVerification.js — do not open it. Untouched by this task.
3. exports.submitScore and the anti-cheat constants MAX_SCORE_PER_SEC=300, BASE_BUFFER=200, MAX_CREDITED_SECONDS=600, ABSOLUTE_MAX_SCORE, SESSION_TTL_MS — no edits. The sweep must NOT be called from submitScore, and no write may be added there.
4. The three existing `batch.delete(...)` lines inside deleteMyData and their ORDER relative to the sweep. The users/leaderboard batch must commit BEFORE the sweep runs — if the sweep throws, the personal-data documents must already be gone. Do not move the sweep above `await batch.commit()`.
5. The `leaderboard_weekly_${isoWeekKeyKST()}` line — only the current week is deleted, on purpose (past-week collection names are unenumerable cheaply). Do not "improve" this into a loop over past weeks.
6. processed_transactions (top-level) and users/{uid}/processed_ad_callbacks (subcollection) — do NOT add deletions for these. They are the IAP-receipt and rewarded-ad idempotency ledgers; wiping them re-opens receipt/ad-token replay. The retention decision is already documented in the comment header.
7. firestore.rules — `match /game_sessions/{token} { allow read, write: if false; }` stays exactly as is, and `match /users/{uid}` keeps `allow write: if false`. The sweep runs through the Admin SDK, which bypasses rules. Do not re-open anything.
8. firestore.indexes.json — must remain `{"indexes": [], "fieldOverrides": []}`. Adding a fieldOverride that disables single-field indexing on game_sessions.uid would break the sweep query at runtime.
9. Do NOT add `.orderBy(...)`, a second `.where(...)`, or `.select(...)` to the sweep query. A second filter or an orderBy on another field would require a composite index that does not exist, and the callable would start throwing FAILED_PRECONDITION in production.
10. index.html and public/ — no changes. The return value only gained an additive field; the client reads only `deleted`. Do NOT run `npm run sync:public` and do NOT deploy hosting for this task.
11. functions/test/blocklist.test.js — untouched. It must still report its 3 passing tests inside the post-change total of 9.
12. Do not change the `{ region: REGION }` options object on deleteMyData (no timeoutSeconds, no memory bump) — the default 60s is analysed as sufficient below.


## 6. 리스크

1. Function timeout. onCall v2 defaults to 60s. Worst case here is 25 queries + 25 batch commits of 400 deletes each, roughly 10-25s in asia-northeast3 — inside budget. This is why the page cap exists; do not raise SESSION_DELETE_MAX_PAGES without also raising timeoutSeconds.

2. Truncation is a genuine (if unreachable) hole. If a user somehow has >10,000 sessions, the sweep stops, the auth account is still deleted, and that uid can never call back to finish. That is why truncation logs at console.error with the uid — an operator finishes it from the Firebase console. The alternative (aborting the deletion) was rejected: leaving a live account with live personal data is worse than a residual, PII-free session row. game_sessions rows contain only {uid, startedAt, used, endedAt} — no name, no score, no balance.

3. Cost. Deletion now costs N extra reads + N deletes per user (N = that user's lifetime run count, typically <100). Negligible, and only on an explicit user-initiated deletion.

4. Partial-sweep window. If the sweep throws mid-loop, some sessions are deleted and some remain, and the request still returns success. Acceptable: the helper is idempotent, the personal-data documents are already gone, and the residual is PII-free. It is logged.

5. OUT OF SCOPE, but flag to Mark — two related items this fix deliberately does NOT address:
   (a) game_sessions has no TTL or scheduled GC at all. Every run by every player writes a document that is never cleaned up. That is a cost and data-minimisation problem independent of deletion requests, and wants a Firestore TTL policy on startedAt or a scheduled sweeper. Separate task.
   (b) Firestore does not cascade-delete subcollections. Deleting users/{uid} leaves users/{uid}/processed_ad_callbacks/* orphaned. Those docs hold ad tokens only (no PII) and are the rewarded-ad replay guard, so they are intentionally kept — but if a store reviewer asks "does deleting the parent remove everything under it", the honest answer is no. Worth a decision before submission; explicitly NOT changed here because it touches replay protection.

6. Regression surface is small: the only behavioural change to an existing path is the extra `sessionsDeleted` key in the deleteMyData response, which index.html ignores (it awaits the call and reads nothing off the result).


## 7. 커밋 메시지

```
deleteMyData deleted users/{uid}, leaderboard_global/{uid} and the current week's leaderboard doc, but left every game_sessions document behind. Those documents are auto-id keyed with a `uid` field written by startRun on every single run, so a player who used the in-app "Delete my data" control kept an unbounded, uid-attributable trail on our servers — directly contradicting static/privacy.html §6 and the App Store / Play data-safety declarations, both of which promise removal within 30 days. This adds a bounded, idempotent sweep (functions/deleteSessions.js) that pages through `game_sessions where uid == caller` in batches of 400 (under Firestore's 500-write batch cap) for at most 25 pages (10,000 sessions), and calls it from deleteMyData after the existing users/leaderboard batch commits so a sweep failure can never leave the PII-bearing documents in place. The query uses a single equality filter with no orderBy, so it is served by Firestore's automatic single-field index and firestore.indexes.json is unchanged. The sweep is wrapped in try/catch and never fails the request; on the (practically unreachable) cap it logs the uid at error level for manual finishing. The callable's return value only gains an additive `sessionsDeleted` field, so the client needs no change. A node --test suite covers paging boundaries, foreign-uid safety, the cap, and idempotency.
```
