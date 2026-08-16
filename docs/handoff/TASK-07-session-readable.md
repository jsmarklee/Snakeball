# T7 · T7 — OPERATIONS: make game_sessions readable (1 composite index + read-only D1/D7 retention script)

> 이 파일은 **단독 실행 가능한 작업지시서**다. 그대로 복사해 붙여넣으면 된다.
> **시작 전 [RULES.md](RULES.md) 를 먼저 읽을 것** — 건드리면 안 되는 것들이 있다.

- **난이도/소요**: ~45-60 minutes total, mostly waiting.

  - Edit firestore.indexes.json: 2 min.
  - Create analytics-retention.js (paste + chmod +x): 5 min.
  - V1-V3 offline verification: 5 min. No credentials needed, so this is the part you can
    always complete.
  - V4 index deploy + build wait: 5 min of work, then minutes of index-build latency on a
    small/empty collection (longer if game_sessions is already large).
  - V5-V6 against production: 5-10 min, gated on having `firebase login` + ADC or a service
    account. If credentials are unavailable, stop after V4 and report that V5-V7 are pending —
    do NOT skip them silently.
  - V7 TTL audit: 2 min. Do not skip this one; it is the highest-value line in the task.

Complexity is low — one JSON file and one standalone script. Nothing in the game, the bridge,
or the Cloud Functions runtime changes.
- **배포 필요**: DEPLOY REQUIRED: firestore indexes ONLY.

  cd /Users/mark/repos/Snakeball
  firebase deploy --only firestore:indexes

NOT required, and must NOT be run as part of this change:
  - npm run sync:public      — index.html is untouched.
  - npm run deploy:web       — no hosting change.
  - firebase deploy --only functions — no file under functions/ that ships is modified.
    functions/scripts/** is already excluded by firebase.json's functions.ignore, so the new
    script is never uploaded to Cloud Functions; it runs from your laptop against production
    via the Admin SDK.
  - firebase deploy --only firestore:rules — firestore.rules is untouched.
  - iOS / Android native rebuild — nothing in the bridge contract changes.

⚠️ Do NOT run `firebase deploy --only firestore` (without `:indexes`). That target also pushes
firestore.rules, which is out of scope and touches the users/{uid} write lockdown.

Runtime prerequisite for running the script (not a deploy): credentials, either
`firebase login` + gcloud ADC, or GOOGLE_APPLICATION_CREDENTIALS=<service-account.json>.
firebase-admin resolves from functions/node_modules, which is why the script is invoked as
`node functions/scripts/analytics-retention.js` from the repo root.


---

## 1. 대상 파일

```
TWO files.
(1) EDIT: /Users/mark/repos/Snakeball/firestore.indexes.json
(2) CREATE (new file, does not exist yet): /Users/mark/repos/Snakeball/functions/scripts/analytics-retention.js

=== DECISION (read this before touching anything) ===
Option (a) — composite index + admin query script in functions/scripts/ — is what you implement.
Option (b) — BigQuery export — is REJECTED for now. Reasons, in order of weight:

1. RETROACTIVITY. The firestore-bigquery-export extension only streams writes that happen
   AFTER it is installed. If it is not installed before launch, the first days of retention
   data — the only cohort data that matters for a launch — never reach BigQuery, and you
   must run a separate fs-bq-import-collection backfill anyway. A script is retroactive by
   construction: it reads whatever is in Firestore whenever you run it. Shipping the script
   today costs nothing and preserves the option to add BigQuery later.
2. BLAST RADIUS. The BQ extension installs a Cloud Function that fires on EVERY write to
   game_sessions. game_sessions is written 2-3x per run by startRun / submitScore /
   spendCurrency(revive) — i.e. it sits directly on the anti-cheat path, in the same project
   as the money path. A read-only script cannot affect it at all.
3. COST FLOOR. BigQuery adds standing storage + query + streaming-insert cost and needs a
   dataset, IAM, and billing wiring the owner has not done. The script's cost is ~$0.06 per
   100k sessions read, only when you run it, and $0 when you do not.
4. VOLUME. At launch the collection starts empty. Firestore's per-document read price makes a
   full scan trivially cheap until roughly 1M+ sessions.

TRIP-WIRE TO REVISIT (encoded in the script as DEFAULT_MAX_SCAN = 1500000): when
game_sessions exceeds ~1.5M docs the script refuses to run and tells you to move to BigQuery.
That is the moment to install the extension — not before.

=== WHAT ACTUALLY NEEDS AN INDEX (do not over-index) ===
The retention script's main scan orders by document ID only. Firestore auto-indexes single
fields, so THE MAIN SCAN NEEDS NO COMPOSITE INDEX AND IS NOT BLOCKED ON AN INDEX BUILD.
The only query that needs one is the per-player drill-down (--uid), which is
where('uid','==',x).orderBy('startedAt','desc') -> composite (uid ASC, startedAt DESC).
So exactly ONE composite index is added. Every composite index costs extra index-entry writes
on every single game_sessions write, so do NOT add speculative extras.
```


## 2. 현재 코드 (파일에서 이대로 찾을 것)

> 줄 번호는 밀릴 수 있다. **아래 문자열로 검색**해서 찾아라.
> 안 찾아지면 누가 이미 고친 것이니 **멈추고 사람에게 물어라.**

````
=== FILE 1: /Users/mark/repos/Snakeball/firestore.indexes.json ===
This is the ENTIRE current file, verbatim (4 lines, trailing newline). Verified byte-for-byte
with `od -c`:

{
  "indexes": [],
  "fieldOverrides": []
}

=== FILE 2: /Users/mark/repos/Snakeball/functions/scripts/analytics-retention.js ===
DOES NOT EXIST. `functions/scripts/` currently contains exactly one file,
backfill-createdAt.js. You are creating a second, sibling file. Do not modify
backfill-createdAt.js — it is only the source of the safety conventions being copied.

For your reference, these are the conventions being copied from backfill-createdAt.js
(lines 32-63 of that file, verbatim), so you can confirm the new file matches its style:

"use strict";

const admin = require("firebase-admin");

// ── 설정 ────────────────────────────────────────────────
const EXPECTED_PROJECT = "snakeball-game";
// sentinel: 경제 마이그레이션/컷오프보다 확실히 과거 → 어떤 합리적 컷오프에도 preCutoff.
// (clock-skew 안전. 실제 계정 생성시각이 아니라 "레거시 표식"일 뿐.)
const SENTINEL = new Date("2026-06-01T00:00:00Z");
const PAGE = 400;                        // 페이지 크기 = 배치 쓰기 크기(<500)
const COMMIT = process.argv.includes("--commit");

function resolveProjectId() {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    (() => { try { return admin.app().options.projectId; } catch (e) { return null; } })()
  );
}

async function main() {
  // projectId 를 명시적으로 주입해 초기화(ADC/서비스계정과 함께).
  const projectId = resolveProjectId() || EXPECTED_PROJECT;
  admin.initializeApp({ projectId });

  const actualProject = admin.app().options.projectId || projectId;
  if (actualProject !== EXPECTED_PROJECT) {
    console.error(`✋ ABORT: projectId='${actualProject}' (expected '${EXPECTED_PROJECT}').`);
    console.error("   잘못된 프로젝트에 쓰는 사고 방지. GOOGLE_CLOUD_PROJECT / ADC 를 확인하세요.");
    process.exit(1);
  }

=== THE DATA SHAPE YOU ARE READING (do not change any of this) ===
game_sessions/{autoId} is written in exactly three places and has exactly these fields:
  functions/index.js startRun          -> { uid, startedAt: serverTimestamp, used: false }
  functions/index.js submitScore (tx)  -> { used: true, endedAt: serverTimestamp }
  functions/coinSystem.js spend revive -> { reviveCount: n+1 }
There is no score field on the session. Run length = endedAt - startedAt. A session with no
endedAt was never submitted (player quit / offline / still in flight).
````


## 3. 교체할 코드

````
########################################################################
# STEP 1 of 2 — REPLACE the entire contents of
#   /Users/mark/repos/Snakeball/firestore.indexes.json
# with exactly this (keep the trailing newline):
########################################################################

{
  "indexes": [
    {
      "collectionGroup": "game_sessions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "uid", "order": "ASCENDING" },
        { "fieldPath": "startedAt", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}

# WHY ONLY ONE INDEX: the retention scan orders by document ID and needs no composite index
# (Firestore auto-indexes single fields; commit f8f1485 already dropped a redundant
# single-field index here for the same reason). The only composite query in the repo is the
# --uid drill-down. Every extra composite index costs additional index-entry writes on every
# game_sessions write, and that collection is written 2-3x per run on the anti-cheat path.

########################################################################
# STEP 2 of 2 — CREATE the new file
#   /Users/mark/repos/Snakeball/functions/scripts/analytics-retention.js
# with exactly this content. Do not reformat, do not translate the Korean comments,
# do not "clean up" the box-drawing characters.
########################################################################

#!/usr/bin/env node
/**
 * analytics-retention.js — game_sessions 를 읽어 D1/D7 리텐션 + 런 길이 분포를 출력하는
 * **읽기 전용** 운영 스크립트.
 *
 * 왜: game_sessions 는 이 게임의 유일한 실사용 로그다(런 1회 = doc 1개; uid / startedAt /
 *     endedAt / used / reviveCount). 그런데 firestore.rules 에서 클라이언트 접근이 전면 차단
 *     (`allow read, write: if false`)이고 doc 수가 콘솔에서 손으로 셀 규모가 아니다.
 *     즉 Admin SDK 로 읽는 이 스크립트가 없으면 출시 후 "어제 온 유저 중 몇 %가 오늘 다시
 *     왔는가"를 알 방법이 **아예 없다**. 광고를 더 붙일지, 어떤 기능을 팔지, 마케팅에 돈을 쓸지가
 *     전부 이 숫자 하나에 달려 있다.
 *
 * 안전장치 (functions/scripts/backfill-createdAt.js 의 규약을 그대로 따름):
 *   - 프로젝트 오조작 방지: projectId 가 'snakeball-game' 이 아니면 즉시 종료(exit 1).
 *   - **완전 읽기 전용, 런타임으로 강제**: 시작하자마자 lockWrites() 가 Firestore 쓰기 API
 *     (set/update/delete/create/add/batch/runTransaction/bulkWriter)를 전부 throw 로 바꾼다.
 *     나중에 누가 이 스크립트에 쓰기를 한 줄 넣어도 운영 DB 에 조용히 쓰이는 대신 즉시 터진다.
 *     --commit 같은 쓰기 플래그를 붙이면 아무것도 읽지 않고 거부한다(backfill 스크립트를
 *     복사해 쓰다 손가락이 기억하는 사고 방지).
 *   - 스캔 폭주 방지: 스캔 전에 count() 로 doc 수를 먼저 세고, MAX_SCAN 을 넘으면 거부한다
 *     (--max 로 명시적 상향). 여기 걸리기 시작하면 = BigQuery 로 옮길 때다.
 *
 * 실행:
 *   node functions/scripts/analytics-retention.js --selftest     # 오프라인 자체검증(자격증명 불필요)
 *   node functions/scripts/analytics-retention.js                # 최근 30 코호트일
 *   node functions/scripts/analytics-retention.js --days 60
 *   node functions/scripts/analytics-retention.js --json         # 기계 판독용
 *   node functions/scripts/analytics-retention.js --uid <uid>    # 한 유저의 세션 타임라인
 *                                                               #  ↑ 복합 인덱스 필요:
 *                                                               #    game_sessions(uid ASC, startedAt DESC)
 *
 * 자격증명: `firebase login` 후 gcloud ADC, 또는 GOOGLE_APPLICATION_CREDENTIALS=<서비스계정.json>.
 *   (firebase-admin 은 functions/node_modules 에서 resolve — 레포 루트에서 위 경로 그대로 실행)
 *
 * ⚠️ TTL 경고: 이 컬렉션에 Firestore TTL 정책을 걸면 리텐션 로그가 **조용히** 사라진다.
 *    TTL 은 콘솔(또는 gcloud)에서만 설정되고 이 레포에는 아무 흔적도 남지 않는다. 아래 출력의
 *    "oldest session" 날짜가 실행할 때마다 앞으로 밀리면 누군가 TTL 을 걸었거나 수동 삭제한 것이다.
 *    D7/D30 은 소급 계산이 불가능하므로 한 번 지워지면 영영 못 본다.
 */

"use strict";

const admin = require("firebase-admin");

// ── 설정 ────────────────────────────────────────────────
const EXPECTED_PROJECT = "snakeball-game";
const COLLECTION = "game_sessions";
const PAGE = 1000;                       // 페이지 크기(읽기 전용 — 배치 쓰기 500 제한과 무관)
const DEFAULT_DAYS = 30;                 // 표에 출력할 코호트 일수
const DEFAULT_MAX_SCAN = 1500000;        // 이 이상은 스크립트 스캔이 부적절 → BigQuery 전환 신호
// index.js SESSION_TTL_MS(30분)보다 긴 duration = "만료 후 제출"이라 실제 런 길이가 아니다.
// 백분위에서 제외하고 따로 센다(안 빼면 p99 가 통째로 오염된다).
const SESSION_TTL_SEC = 30 * 60;
// 일 버킷은 KST 기준 — index.js 의 isoWeekKeyKST 와 같은 기준이라 주간 리더보드와 눈금이 맞는다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const READ_COST_PER_100K_USD = 0.06;     // 대략치(리전별 상이) — 스캔 전 비용 감각용

// ── 인자 파싱 + 읽기전용 하드가드 ───────────────────────
const argv = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = argv.indexOf(flag);
  if (i === -1 || i + 1 >= argv.length) return fallback;
  return argv[i + 1];
}
const WRITE_FLAGS = ["--commit", "--write", "--fix", "--delete", "--purge", "--force", "--repair"];
const DAYS = Math.max(1, parseInt(argValue("--days", String(DEFAULT_DAYS)), 10) || DEFAULT_DAYS);
const MAX_SCAN = Math.max(1, parseInt(argValue("--max", String(DEFAULT_MAX_SCAN)), 10) || DEFAULT_MAX_SCAN);
const AS_JSON = argv.includes("--json");
const SELFTEST = argv.includes("--selftest");
const UID = argValue("--uid", null);

// ── 순수 헬퍼 (테스트 가능하도록 export) ────────────────
function kstDayIndex(ms) {
  return Math.floor((ms + KST_OFFSET_MS) / DAY_MS);
}
function kstDayLabel(dayIdx) {
  return new Date(dayIdx * DAY_MS).toISOString().slice(0, 10);
}
/** nearest-rank 백분위. sorted 는 오름차순 정렬된 숫자 배열. */
function pct(sorted, p) {
  if (!sorted.length) return NaN;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}
function fmtSec(v) {
  return Number.isFinite(v) ? `${v.toFixed(1)}s` : "  n/a";
}
function pctStr(num, den) {
  if (!den) return "  n/a";
  return `${((num / den) * 100).toFixed(1)}%`;
}

/**
 * 스캔 결과(uid별 최초일/활동일/런수 + duration 배열)에서 코호트 표를 만든다.
 * todayIdx 를 주입받으므로 순수 함수 — 테스트로 검증 가능.
 */
function buildCohorts(first, daysByUid, todayIdx, days) {
  // 오늘은 아직 진행 중이라 미완결. D_n 은 (코호트일 + n) 이 "완결된 날"일 때만 의미가 있다.
  const lastCompleteDay = todayIdx - 1;
  const byDay = new Map();
  for (const [uid, day] of first) {
    let arr = byDay.get(day);
    if (!arr) { arr = []; byDay.set(day, arr); }
    arr.push(uid);
  }
  const rows = [];
  const cohortDays = [...byDay.keys()].sort((a, b) => a - b).filter((d) => d > todayIdx - days);
  for (const day of cohortDays) {
    const uids = byDay.get(day);
    let d1 = 0;
    let d7 = 0;
    for (const u of uids) {
      const s = daysByUid.get(u);
      if (!s) continue;
      if (s.has(day + 1)) d1++;
      if (s.has(day + 7)) d7++;
    }
    rows.push({
      day,
      label: kstDayLabel(day),
      newUsers: uids.length,
      d1,
      d7,
      d1Mature: day + 1 <= lastCompleteDay,
      d7Mature: day + 7 <= lastCompleteDay,
    });
  }
  return rows;
}

function resolveProjectId() {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    (() => { try { return admin.app().options.projectId; } catch (e) { return null; } })()
  );
}

function toMs(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate().getTime();
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * 읽기전용 런타임 락 — Firestore 쓰기 API 를 전부 throw 로 교체한다.
 * "쓰기 안 함"을 주석으로 약속하는 대신 런타임으로 강제하는 이유: 이 스크립트는 운영 DB 를
 * 상대로 돌고, game_sessions 는 안티치트 앵커라 잘못 건드리면 세션 검증이 깨진다.
 * ref/collection 객체를 만드는 것 자체는 네트워크 I/O 가 아니라 프로토타입을 안전하게 얻을 수 있다.
 */
function lockWrites(db) {
  const deny = (name) => function denied() {
    throw new Error(`READ-ONLY script: Firestore ${name}() is disabled in analytics-retention.js`);
  };
  const colRef = db.collection("__readonly_lock__");
  const docRef = colRef.doc("__readonly_lock__");
  const DocumentReference = Object.getPrototypeOf(docRef).constructor;
  const CollectionReference = Object.getPrototypeOf(colRef).constructor;
  for (const m of ["set", "update", "delete", "create"]) {
    DocumentReference.prototype[m] = deny(m);
  }
  CollectionReference.prototype.add = deny("add");
  db.batch = deny("batch");
  db.runTransaction = deny("runTransaction");
  db.bulkWriter = deny("bulkWriter");
  db.recursiveDelete = deny("recursiveDelete");
}

/**
 * --selftest — 자격증명도 네트워크도 없이 산술과 읽기전용 락을 검증한다.
 * 리텐션 숫자는 한 번 잘못 계산하면 눈으로 못 잡는다(그럴듯한 %가 나온다). 그래서 합성
 * 데이터로 D1/D7 성숙도 경계와 백분위를 못 박아 둔다.
 */
function runSelfTest() {
  const assert = require("assert");
  const fails = [];
  const check = (label, fn) => {
    try { fn(); console.log(`  ✓ ${label}`); }
    catch (e) { fails.push(label); console.log(`  ✗ ${label} — ${e.message}`); }
  };

  check("KST 일 버킷: 2026-08-15T15:30Z → 2026-08-16 (KST 00:30)", () => {
    assert.strictEqual(kstDayLabel(kstDayIndex(Date.parse("2026-08-15T15:30:00Z"))), "2026-08-16");
    assert.strictEqual(kstDayLabel(kstDayIndex(Date.parse("2026-08-15T14:59:00Z"))), "2026-08-15");
  });

  check("백분위(nearest-rank)", () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    assert.strictEqual(pct(s, 50), 5);
    assert.strictEqual(pct(s, 90), 9);
    assert.strictEqual(pct(s, 99), 10);
    assert.ok(Number.isNaN(pct([], 50)));
  });

  const TODAY = kstDayIndex(Date.parse("2026-08-16T03:00:00Z"));
  check("코호트 D1/D7 카운트", () => {
    const C = TODAY - 10;
    const first = new Map([["u1", C], ["u2", C], ["u3", C], ["u4", C]]);
    const daysByUid = new Map([
      ["u1", new Set([C, C + 1, C + 7])],
      ["u2", new Set([C, C + 1])],
      ["u3", new Set([C, C + 7])],
      ["u4", new Set([C])],
    ]);
    const r = buildCohorts(first, daysByUid, TODAY, 30).find((x) => x.day === C);
    assert.strictEqual(r.newUsers, 4);
    assert.strictEqual(r.d1, 2);
    assert.strictEqual(r.d7, 2);
  });

  check("성숙도 경계: 오늘은 미완결이라 어제 코호트의 D1 은 아직 못 읽는다", () => {
    const mk = (c) => buildCohorts(new Map([["x", c]]), new Map([["x", new Set([c])]]), TODAY, 30)[0];
    assert.strictEqual(mk(TODAY - 1).d1Mature, false);
    assert.strictEqual(mk(TODAY - 2).d1Mature, true);
    assert.strictEqual(mk(TODAY - 7).d7Mature, false);
    assert.strictEqual(mk(TODAY - 8).d7Mature, true);
  });

  check("--days 윈도우 필터", () => {
    const rows = buildCohorts(
      new Map([["a", TODAY - 40], ["b", TODAY - 3]]),
      new Map([["a", new Set()], ["b", new Set()]]), TODAY, 30);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].day, TODAY - 3);
  });

  check("읽기전용 락: 쓰기 API 가 전부 throw 한다", () => {
    admin.initializeApp({ projectId: EXPECTED_PROJECT });
    const db = admin.firestore();
    lockWrites(db);
    const ref = db.collection(COLLECTION).doc("selftest");
    for (const m of ["set", "update", "delete", "create"]) {
      assert.throws(() => ref[m]({ x: 1 }), /READ-ONLY script/, `${m} must throw`);
    }
    assert.throws(() => db.collection(COLLECTION).add({ x: 1 }), /READ-ONLY script/);
    assert.throws(() => db.batch(), /READ-ONLY script/);
    assert.throws(() => db.runTransaction(async () => {}), /READ-ONLY script/);
    // 읽기 쿼리는 그대로 만들어져야 한다(락이 읽기 경로를 부수지 않았는지).
    const q = db.collection(COLLECTION)
      .orderBy(admin.firestore.FieldPath.documentId()).limit(10)
      .select("uid", "startedAt", "endedAt", "used", "reviveCount");
    assert.ok(q && typeof q.get === "function");
    assert.ok(typeof db.collection(COLLECTION).count === "function");
  });

  console.log(fails.length ? `\n  SELFTEST FAILED (${fails.length})\n` : "\n  SELFTEST PASSED\n");
  process.exit(fails.length ? 1 : 0);
}

// ── 한 유저 드릴다운 (지원/치트 조사용) ─────────────────
async function drilldown(col, uid) {
  console.log(`\n[uid drill-down] ${uid} — 최근 50 세션 (최신순)\n`);
  let snap;
  try {
    // 복합 인덱스 필요: game_sessions (uid ASC, startedAt DESC). firestore.indexes.json 참고.
    snap = await col.where("uid", "==", uid).orderBy("startedAt", "desc").limit(50).get();
  } catch (e) {
    if (/index/i.test(String((e && e.message) || e))) {
      console.error("✋ 복합 인덱스가 아직 없습니다 — game_sessions(uid ASC, startedAt DESC).");
      console.error("   `firebase deploy --only firestore:indexes` 실행 후 빌드가 끝나면 다시 시도하세요.");
      process.exit(4);
    }
    throw e;
  }
  if (snap.empty) {
    console.log("  (세션 없음)");
    return;
  }
  console.log("  startedAt (KST)        dur      used   revives");
  console.log("  ─────────────────────────────────────────────────");
  for (const d of snap.docs) {
    const s = d.data();
    const startMs = toMs(s.startedAt);
    const endMs = toMs(s.endedAt);
    const dur = startMs != null && endMs != null ? `${((endMs - startMs) / 1000).toFixed(1)}s` : "—";
    const kst = startMs != null ? new Date(startMs + KST_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ") : "?";
    console.log(`  ${kst}  ${String(dur).padStart(7)}  ${String(!!s.used).padStart(5)}  ${String(s.reviveCount || 0).padStart(7)}`);
  }
}

async function main() {
  // 읽기전용 하드가드 — 쓰기 플래그가 섞여 들어오면 아무것도 하지 않는다.
  const stray = argv.filter((a) => WRITE_FLAGS.includes(a));
  if (stray.length) {
    console.error(`✋ ABORT: '${stray.join(" ")}' — analytics-retention 은 읽기 전용 스크립트입니다.`);
    console.error("   쓰기 플래그를 받지 않습니다(백필 스크립트와 헷갈린 실행 방지). 아무것도 읽지 않고 종료합니다.");
    process.exit(1);
  }

  // --selftest 는 네트워크/자격증명 없이 도는 오프라인 검증이라 프로젝트 가드보다 먼저.
  if (SELFTEST) {
    console.log("\n[analytics-retention] SELFTEST — Firestore 접속 없음\n");
    runSelfTest();
    return;
  }

  const projectId = resolveProjectId() || EXPECTED_PROJECT;
  admin.initializeApp({ projectId });

  const actualProject = admin.app().options.projectId || projectId;
  if (actualProject !== EXPECTED_PROJECT) {
    console.error(`✋ ABORT: projectId='${actualProject}' (expected '${EXPECTED_PROJECT}').`);
    console.error("   잘못된 프로젝트를 읽는 사고 방지. GOOGLE_CLOUD_PROJECT / ADC 를 확인하세요.");
    process.exit(1);
  }

  const db = admin.firestore();
  lockWrites(db);              // 이 줄 아래로는 어떤 쓰기도 런타임에서 막힌다.
  const col = db.collection(COLLECTION);

  // --json 은 파이프로 jq 에 넘기는 용도라 stdout 을 순수 JSON 으로 유지한다(헤더 출력 금지).
  if (!AS_JSON) console.log(`\n[analytics-retention] project=${actualProject}  mode=READ-ONLY  days=${DAYS}`);

  if (UID) {
    await drilldown(col, UID);
    process.exit(0);
  }

  // ── 스캔 전 규모/비용 확인 ──
  // count() 는 aggregate 쿼리라 1000 index entry 당 읽기 1회로 과금 — 사실상 공짜.
  const total = (await col.count().get()).data().count;
  const estUsd = (total / 100000) * READ_COST_PER_100K_USD;
  if (!AS_JSON) console.log(`  ${COLLECTION} docs = ${total.toLocaleString()}   (전체 스캔 예상 비용 ≈ $${estUsd.toFixed(2)})`);
  if (total > MAX_SCAN) {
    console.error(`\n✋ ABORT: doc 수(${total.toLocaleString()})가 MAX_SCAN(${MAX_SCAN.toLocaleString()})을 넘습니다.`);
    console.error("   전량 스캔이 비싸지는 구간입니다. 한 번만 필요하면 `--max <N>` 으로 올려서 실행하고,");
    console.error("   상시로 필요해졌다면 BigQuery 익스포트로 옮길 시점입니다(docs/ 참고).");
    process.exit(3);
  }
  if (total === 0) {
    if (AS_JSON) console.log(JSON.stringify({ project: actualProject, scanned: 0, users: 0, cohorts: [] }, null, 2));
    else console.log("\n  (game_sessions 비어 있음 — 아직 플레이 기록이 없거나 TTL/수동 삭제로 지워졌습니다.)");
    process.exit(0);
  }

  // ── 전량 스캔 ──
  // "최초 세션이 언제인가"는 전체 이력을 봐야 정확하므로 윈도우로 자르지 않는다.
  // documentId 커서 페이지네이션 = 인덱스 불필요 + 커서 의미가 단순(backfill 스크립트와 동일 패턴).
  const first = new Map();      // uid -> 최초 세션 dayIdx
  const daysByUid = new Map();  // uid -> Set<dayIdx>
  const runsByUid = new Map();  // uid -> 세션 수
  const durations = [];         // 정상 런 길이(초)
  let scanned = 0;
  let malformed = 0;            // uid/startedAt 없는 doc
  let open = 0;                 // endedAt 없음 = 제출 안 된 런(이탈/오프라인/진행중)
  let expired = 0;              // duration > SESSION_TTL — 만료 후 제출
  let negative = 0;             // 시계 이상(있으면 안 됨)
  let revivedRuns = 0;
  let minMs = Infinity;
  let maxMs = -Infinity;

  let last = null;
  for (;;) {
    let q = col
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(PAGE)
      .select("uid", "startedAt", "endedAt", "used", "reviveCount");
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned++;
      const d = doc.data() || {};
      const startMs = toMs(d.startedAt);
      if (!d.uid || startMs == null) { malformed++; continue; }

      if (startMs < minMs) minMs = startMs;
      if (startMs > maxMs) maxMs = startMs;

      const day = kstDayIndex(startMs);
      runsByUid.set(d.uid, (runsByUid.get(d.uid) || 0) + 1);
      const prevFirst = first.get(d.uid);
      if (prevFirst === undefined || day < prevFirst) first.set(d.uid, day);
      let set = daysByUid.get(d.uid);
      if (!set) { set = new Set(); daysByUid.set(d.uid, set); }
      set.add(day);

      if ((d.reviveCount || 0) > 0) revivedRuns++;

      const endMs = toMs(d.endedAt);
      if (endMs == null) { open++; continue; }
      const dur = (endMs - startMs) / 1000;
      if (dur < 0) negative++;
      else if (dur > SESSION_TTL_SEC) expired++;
      else durations.push(dur);
    }

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }

  // ── 집계 ──
  const users = first.size;
  const todayIdx = kstDayIndex(Date.now());
  const rows = buildCohorts(first, daysByUid, todayIdx, DAYS);

  let d1Num = 0, d1Den = 0, d7Num = 0, d7Den = 0;
  for (const r of rows) {
    if (r.d1Mature) { d1Num += r.d1; d1Den += r.newUsers; }
    if (r.d7Mature) { d7Num += r.d7; d7Den += r.newUsers; }
  }

  durations.sort((a, b) => a - b);
  const durMean = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : NaN;
  const runCounts = [...runsByUid.values()].sort((a, b) => a - b);
  const oneAndDone = runCounts.reduce((n, v) => n + (v === 1 ? 1 : 0), 0);
  // 비율의 분모는 malformed 를 뺀 "실제 세션"이어야 한다(안 빼면 지표가 조용히 희석된다).
  const validSessions = scanned - malformed;
  const runsMean = users ? validSessions / users : NaN;

  if (AS_JSON) {
    console.log(JSON.stringify({
      project: actualProject,
      scanned, validSessions, users, malformed, open, expired, negative, revivedRuns,
      oldest: Number.isFinite(minMs) ? kstDayLabel(kstDayIndex(minMs)) : null,
      newest: Number.isFinite(maxMs) ? kstDayLabel(kstDayIndex(maxMs)) : null,
      d1: d1Den ? d1Num / d1Den : null,
      d7: d7Den ? d7Num / d7Den : null,
      runLengthSec: {
        n: durations.length,
        mean: durMean,
        p10: pct(durations, 10), p25: pct(durations, 25), p50: pct(durations, 50),
        p75: pct(durations, 75), p90: pct(durations, 90), p95: pct(durations, 95),
        p99: pct(durations, 99),
      },
      runsPerUser: { mean: runsMean, p50: pct(runCounts, 50), p90: pct(runCounts, 90), oneAndDone },
      cohorts: rows,
    }, null, 2));
    process.exit(0);
  }

  console.log("──────────────────────────────────────────────────────────");
  console.log("  VOLUME");
  console.log(`    sessions scanned      : ${scanned.toLocaleString()}`);
  console.log(`    unique players        : ${users.toLocaleString()}`);
  console.log(`    oldest session (KST)  : ${Number.isFinite(minMs) ? kstDayLabel(kstDayIndex(minMs)) : "n/a"}   ← 실행할 때마다 앞으로 밀리면 TTL/삭제 의심`);
  console.log(`    newest session (KST)  : ${Number.isFinite(maxMs) ? kstDayLabel(kstDayIndex(maxMs)) : "n/a"}`);
  console.log(`    never submitted       : ${open.toLocaleString()} (${pctStr(open, validSessions)})  ← 이탈/오프라인/진행중`);
  console.log(`    expired (>${SESSION_TTL_SEC}s)      : ${expired.toLocaleString()}  ← 만료 후 제출. 런 길이 통계에서 제외됨`);
  console.log(`    runs with gem revive  : ${revivedRuns.toLocaleString()} (${pctStr(revivedRuns, validSessions)})`);
  if (malformed) console.log(`    malformed docs        : ${malformed.toLocaleString()}`);
  if (negative) console.log(`    negative duration     : ${negative.toLocaleString()}  ← 있으면 안 됨. 조사할 것`);

  console.log("\n  RETENTION (KST 일 기준, 미완결일은 '—')");
  console.log("    cohort        new    D1            D7");
  console.log("    ────────────────────────────────────────────");
  for (const r of rows) {
    const d1s = r.d1Mature ? `${String(r.d1).padStart(4)} ${pctStr(r.d1, r.newUsers).padStart(6)}` : "     —     ";
    const d7s = r.d7Mature ? `${String(r.d7).padStart(4)} ${pctStr(r.d7, r.newUsers).padStart(6)}` : "     —     ";
    console.log(`    ${r.label}  ${String(r.newUsers).padStart(5)}  ${d1s}  ${d7s}`);
  }
  console.log("    ────────────────────────────────────────────");
  console.log(`    OVERALL (mature cohorts)   D1 ${pctStr(d1Num, d1Den)} (n=${d1Den})   D7 ${pctStr(d7Num, d7Den)} (n=${d7Den})`);

  console.log("\n  RUN LENGTH (초, 제출된 세션 기준, 만료 제외)");
  console.log(`    n=${durations.length.toLocaleString()}  mean=${fmtSec(durMean)}`);
  console.log(`    p10 ${fmtSec(pct(durations, 10))}   p25 ${fmtSec(pct(durations, 25))}   p50 ${fmtSec(pct(durations, 50))}   p75 ${fmtSec(pct(durations, 75))}`);
  console.log(`    p90 ${fmtSec(pct(durations, 90))}   p95 ${fmtSec(pct(durations, 95))}   p99 ${fmtSec(pct(durations, 99))}`);

  console.log("\n  RUNS PER PLAYER");
  console.log(`    mean=${Number.isFinite(runsMean) ? runsMean.toFixed(2) : "n/a"}   p50=${pct(runCounts, 50)}   p90=${pct(runCounts, 90)}`);
  console.log(`    one-and-done (1회만 플레이): ${oneAndDone.toLocaleString()} / ${users.toLocaleString()} (${pctStr(oneAndDone, users)})`);
  console.log("──────────────────────────────────────────────────────────\n");

  process.exit(0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error("analytics-retention failed:", e);
    process.exit(1);
  });
}

// 순수 헬퍼는 export — 산술(코호트/백분위)을 Firestore 없이 검증할 수 있게.
module.exports = { kstDayIndex, kstDayLabel, pct, buildCohorts };

########################################################################
# STEP 3 — make it executable (matches backfill-createdAt.js's shebang):
#   chmod +x /Users/mark/repos/Snakeball/functions/scripts/analytics-retention.js
########################################################################
````


## 3-B. ⚠️ 검토에서 정정된 부분 — **이쪽이 우선**

독립 검토에서 위 내용 중 일부(주로 검증 절차)에 오류가 발견됐다.
**충돌하면 아래를 따른다.**

````
########################################################################
T7 (CORRECTED) — composite index + read-only D1/D7 retention script
Two files. Nothing else in the repo changes.
########################################################################

=== CURRENT CODE (verified byte-for-byte with `od -c`) ===

FILE 1: /Users/mark/repos/Snakeball/firestore.indexes.json
This is the ENTIRE current file — 4 lines, trailing newline:

{
  "indexes": [],
  "fieldOverrides": []
}

FILE 2: /Users/mark/repos/Snakeball/functions/scripts/analytics-retention.js
DOES NOT EXIST. `functions/scripts/` currently holds exactly one file,
`backfill-createdAt.js` (mode 644, not executable). Do not modify it — it is only
the source of the safety conventions being copied.

PREREQ: `ls functions/node_modules/firebase-admin` must exist (it is gitignored).
If missing: `npm install --prefix /Users/mark/repos/Snakeball/functions`.
The script resolves firebase-admin from ITS OWN directory, not from cwd, so running
it from the repo root as `node functions/scripts/analytics-retention.js` is correct.

########################################################################
STEP 1 of 2 — REPLACE the entire contents of firestore.indexes.json
########################################################################
Everything between the two markers is the literal file body. Keep the trailing
newline. DO NOT paste any `#` comment line into this file — JSON has no comments
and the deploy will fail.

--------8<-------- BEGIN firestore.indexes.json --------8<--------
{
  "indexes": [
    {
      "collectionGroup": "game_sessions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "uid", "order": "ASCENDING" },
        { "fieldPath": "startedAt", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
--------8<-------- END firestore.indexes.json --------8<--------

(Rationale, for the commit message only — not for the file: the retention scan
orders by document ID and needs no composite index; Firestore auto-indexes single
fields, which is why commit f8f1485 dropped a redundant single-field index here.
The only composite query in the repo is the --uid drill-down. Every extra composite
index costs index-entry writes on every game_sessions write, and that collection is
written 2-3x per run on the anti-cheat path — so add exactly one, no speculative extras.)

########################################################################
STEP 2 of 2 — CREATE functions/scripts/analytics-retention.js
########################################################################
Everything between the markers is the literal file body. Do not reformat, do not
translate the Korean comments, do not "clean up" the box-drawing characters.
Do NOT chmod +x (the sibling backfill script is 644; keep the modes consistent).

--------8<-------- BEGIN functions/scripts/analytics-retention.js --------8<--------
#!/usr/bin/env node
/**
 * analytics-retention.js — game_sessions 를 읽어 D1/D7 리텐션 + 런 길이 분포를 출력하는
 * **읽기 전용** 운영 스크립트.
 *
 * 왜: game_sessions 는 이 게임의 유일한 실사용 로그다(런 1회 = doc 1개; uid / startedAt /
 *     endedAt / used / reviveCount). 그런데 firestore.rules 에서 클라이언트 접근이 전면 차단
 *     (`allow read, write: if false`)이고 doc 수가 콘솔에서 손으로 셀 규모가 아니다.
 *     즉 Admin SDK 로 읽는 이 스크립트가 없으면 출시 후 "어제 온 유저 중 몇 %가 오늘 다시
 *     왔는가"를 알 방법이 **아예 없다**. 광고를 더 붙일지, 어떤 기능을 팔지, 마케팅에 돈을 쓸지가
 *     전부 이 숫자 하나에 달려 있다.
 *
 * 안전장치 (functions/scripts/backfill-createdAt.js 의 규약을 그대로 따름):
 *   - 프로젝트 오조작 방지: projectId 가 'snakeball-game' 이 아니면 즉시 종료(exit 1).
 *   - **완전 읽기 전용, 런타임으로 강제**: 시작하자마자 lockWrites() 가 Firestore 쓰기 API
 *     (set/update/delete/create/add/batch/runTransaction/bulkWriter)를 전부 throw 로 바꾼다.
 *     나중에 누가 이 스크립트에 쓰기를 한 줄 넣어도 운영 DB 에 조용히 쓰이는 대신 즉시 터진다.
 *     --commit 같은 쓰기 플래그를 붙이면 아무것도 읽지 않고 거부한다(backfill 스크립트를
 *     복사해 쓰다 손가락이 기억하는 사고 방지).
 *   - 스캔 폭주 방지: 스캔 전에 count() 로 doc 수를 먼저 세고, MAX_SCAN 을 넘으면 거부한다
 *     (--max 로 명시적 상향). 여기 걸리기 시작하면 = BigQuery 로 옮길 때다.
 *
 * 실행:
 *   node functions/scripts/analytics-retention.js --selftest     # 오프라인 자체검증(자격증명 불필요)
 *   node functions/scripts/analytics-retention.js                # 최근 30 코호트일
 *   node functions/scripts/analytics-retention.js --days 60
 *   node functions/scripts/analytics-retention.js --json         # 기계 판독용
 *   node functions/scripts/analytics-retention.js --uid <uid>    # 한 유저의 세션 타임라인
 *                                                               #  ↑ 복합 인덱스 필요:
 *                                                               #    game_sessions(uid ASC, startedAt DESC)
 *
 * 자격증명: `firebase login` 후 gcloud ADC, 또는 GOOGLE_APPLICATION_CREDENTIALS=<서비스계정.json>.
 *   (firebase-admin 은 이 파일 기준으로 functions/node_modules 에서 resolve — cwd 무관)
 *
 * ⚠️ TTL 경고: 이 컬렉션에 Firestore TTL 정책을 걸면 리텐션 로그가 사라진다. D7/D30 은 소급
 *    계산이 불가능하므로 한 번 지워지면 영영 못 본다. 아래 출력의 "oldest session" 날짜가
 *    실행할 때마다 앞으로 밀리면 누군가 TTL 을 걸었거나 수동 삭제한 것이다.
 *    (TTL 은 firestore.indexes.json 의 fieldOverrides `ttl` 키로 확인/고정할 수 있다.
 *     `firebase firestore:indexes` 출력의 fieldOverrides 에도 그대로 드러난다.)
 */

"use strict";

const admin = require("firebase-admin");

// ── 설정 ────────────────────────────────────────────────
const EXPECTED_PROJECT = "snakeball-game";
const COLLECTION = "game_sessions";
const PAGE = 1000;                       // 페이지 크기(읽기 전용 — 배치 쓰기 500 제한과 무관)
const DEFAULT_DAYS = 30;                 // 표에 출력할 코호트 일수
const DEFAULT_MAX_SCAN = 1500000;        // 이 이상은 스크립트 스캔이 부적절 → BigQuery 전환 신호
// index.js SESSION_TTL_MS(30분)보다 긴 duration = "만료 후 제출"이라 실제 런 길이가 아니다.
// (submitScore 는 만료 세션에도 endedAt 을 찍고 throw 하므로 이런 doc 이 실제로 생긴다.)
// 백분위에서 제외하고 따로 센다(안 빼면 p99 가 통째로 오염된다).
const SESSION_TTL_SEC = 30 * 60;
// 일 버킷은 KST 기준 — index.js 의 isoWeekKeyKST 와 같은 기준이라 주간 리더보드와 눈금이 맞는다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const READ_COST_PER_100K_USD = 0.06;     // 대략치(리전별 상이) — 스캔 전 비용 감각용

// ── 인자 파싱 + 읽기전용 하드가드 ───────────────────────
const argv = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = argv.indexOf(flag);
  if (i === -1 || i + 1 >= argv.length) return fallback;
  return argv[i + 1];
}
const WRITE_FLAGS = ["--commit", "--write", "--fix", "--delete", "--purge", "--force", "--repair"];
const DAYS = Math.max(1, parseInt(argValue("--days", String(DEFAULT_DAYS)), 10) || DEFAULT_DAYS);
const MAX_SCAN = Math.max(1, parseInt(argValue("--max", String(DEFAULT_MAX_SCAN)), 10) || DEFAULT_MAX_SCAN);
const AS_JSON = argv.includes("--json");
const SELFTEST = argv.includes("--selftest");
const UID = argValue("--uid", null);

/**
 * macOS 에서 stdout/stderr 이 **파이프**면 write 가 비동기다. 따라서 console.log 직후
 * process.exit() 을 부르면 파이프 버퍼(64KB)를 넘는 출력이 조용히 잘린다 —
 * `--json | jq` 가 깨진 JSON 을 받는다(실측 확인: 300KB → 65536B). 빈 write 의 콜백은
 * 앞선 write 들이 OS 로 넘어간 뒤에 호출되므로 거기서 종료한다.
 * ⚠️ 이 함수는 즉시 반환한다(process.exit 처럼 그 자리에서 멈추지 않는다). 반드시
 *    `return exitAfterFlush(n);` 형태로, 함수의 마지막 문장에서만 쓸 것.
 */
function exitAfterFlush(code) {
  process.exitCode = code;
  process.stdout.write("", () => process.stderr.write("", () => process.exit(code)));
}

// ── 순수 헬퍼 (테스트 가능하도록 export) ────────────────
function kstDayIndex(ms) {
  return Math.floor((ms + KST_OFFSET_MS) / DAY_MS);
}
function kstDayLabel(dayIdx) {
  return new Date(dayIdx * DAY_MS).toISOString().slice(0, 10);
}
/** nearest-rank 백분위. sorted 는 오름차순 정렬된 숫자 배열. */
function pct(sorted, p) {
  if (!sorted.length) return NaN;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}
function fmtSec(v) {
  return Number.isFinite(v) ? `${v.toFixed(1)}s` : "  n/a";
}
function pctStr(num, den) {
  if (!den) return "  n/a";
  return `${((num / den) * 100).toFixed(1)}%`;
}

/**
 * 스캔 결과(uid별 최초일/활동일/런수 + duration 배열)에서 코호트 표를 만든다.
 * todayIdx 를 주입받으므로 순수 함수 — 테스트로 검증 가능.
 */
function buildCohorts(first, daysByUid, todayIdx, days) {
  // 오늘은 아직 진행 중이라 미완결. D_n 은 (코호트일 + n) 이 "완결된 날"일 때만 의미가 있다.
  const lastCompleteDay = todayIdx - 1;
  const byDay = new Map();
  for (const [uid, day] of first) {
    let arr = byDay.get(day);
    if (!arr) { arr = []; byDay.set(day, arr); }
    arr.push(uid);
  }
  const rows = [];
  const cohortDays = [...byDay.keys()].sort((a, b) => a - b).filter((d) => d > todayIdx - days);
  for (const day of cohortDays) {
    const uids = byDay.get(day);
    let d1 = 0;
    let d7 = 0;
    for (const u of uids) {
      const s = daysByUid.get(u);
      if (!s) continue;
      if (s.has(day + 1)) d1++;
      if (s.has(day + 7)) d7++;
    }
    rows.push({
      day,
      label: kstDayLabel(day),
      newUsers: uids.length,
      d1,
      d7,
      d1Mature: day + 1 <= lastCompleteDay,
      d7Mature: day + 7 <= lastCompleteDay,
    });
  }
  return rows;
}

function resolveProjectId() {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    (() => { try { return admin.app().options.projectId; } catch (e) { return null; } })()
  );
}

function toMs(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate().getTime();
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * 읽기전용 런타임 락 — Firestore 쓰기 API 를 전부 throw 로 교체한다.
 * "쓰기 안 함"을 주석으로 약속하는 대신 런타임으로 강제하는 이유: 이 스크립트는 운영 DB 를
 * 상대로 돌고, game_sessions 는 안티치트 앵커라 잘못 건드리면 세션 검증이 깨진다.
 * ref/collection 객체를 만드는 것 자체는 네트워크 I/O 가 아니라 프로토타입을 안전하게 얻을 수 있다.
 */
function lockWrites(db) {
  const deny = (name) => function denied() {
    throw new Error(`READ-ONLY script: Firestore ${name}() is disabled in analytics-retention.js`);
  };
  const colRef = db.collection("__readonly_lock__");
  const docRef = colRef.doc("__readonly_lock__");
  const DocumentReference = Object.getPrototypeOf(docRef).constructor;
  const CollectionReference = Object.getPrototypeOf(colRef).constructor;
  for (const m of ["set", "update", "delete", "create"]) {
    DocumentReference.prototype[m] = deny(m);
  }
  CollectionReference.prototype.add = deny("add");
  db.batch = deny("batch");
  db.runTransaction = deny("runTransaction");
  db.bulkWriter = deny("bulkWriter");
  db.recursiveDelete = deny("recursiveDelete");
}

/**
 * --selftest — 자격증명도 네트워크도 없이 산술과 읽기전용 락을 검증한다.
 * 리텐션 숫자는 한 번 잘못 계산하면 눈으로 못 잡는다(그럴듯한 %가 나온다). 그래서 합성
 * 데이터로 D1/D7 성숙도 경계와 백분위를 못 박아 둔다.
 */
function runSelfTest() {
  const assert = require("assert");
  const fails = [];
  const check = (label, fn) => {
    try { fn(); console.log(`  ✓ ${label}`); }
    catch (e) { fails.push(label); console.log(`  ✗ ${label} — ${e.message}`); }
  };

  check("KST 일 버킷: 2026-08-15T15:30Z → 2026-08-16 (KST 00:30)", () => {
    assert.strictEqual(kstDayLabel(kstDayIndex(Date.parse("2026-08-15T15:30:00Z"))), "2026-08-16");
    assert.strictEqual(kstDayLabel(kstDayIndex(Date.parse("2026-08-15T14:59:00Z"))), "2026-08-15");
  });

  check("백분위(nearest-rank)", () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    assert.strictEqual(pct(s, 50), 5);
    assert.strictEqual(pct(s, 90), 9);
    assert.strictEqual(pct(s, 99), 10);
    assert.ok(Number.isNaN(pct([], 50)));
  });

  const TODAY = kstDayIndex(Date.parse("2026-08-16T03:00:00Z"));
  check("코호트 D1/D7 카운트", () => {
    const C = TODAY - 10;
    const first = new Map([["u1", C], ["u2", C], ["u3", C], ["u4", C]]);
    const daysByUid = new Map([
      ["u1", new Set([C, C + 1, C + 7])],
      ["u2", new Set([C, C + 1])],
      ["u3", new Set([C, C + 7])],
      ["u4", new Set([C])],
    ]);
    const r = buildCohorts(first, daysByUid, TODAY, 30).find((x) => x.day === C);
    assert.strictEqual(r.newUsers, 4);
    assert.strictEqual(r.d1, 2);
    assert.strictEqual(r.d7, 2);
  });

  check("성숙도 경계: 오늘은 미완결이라 어제 코호트의 D1 은 아직 못 읽는다", () => {
    const mk = (c) => buildCohorts(new Map([["x", c]]), new Map([["x", new Set([c])]]), TODAY, 30)[0];
    assert.strictEqual(mk(TODAY - 1).d1Mature, false);
    assert.strictEqual(mk(TODAY - 2).d1Mature, true);
    assert.strictEqual(mk(TODAY - 7).d7Mature, false);
    assert.strictEqual(mk(TODAY - 8).d7Mature, true);
  });

  check("--days 윈도우 필터", () => {
    const rows = buildCohorts(
      new Map([["a", TODAY - 40], ["b", TODAY - 3]]),
      new Map([["a", new Set()], ["b", new Set()]]), TODAY, 30);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].day, TODAY - 3);
  });

  check("읽기전용 락: 쓰기 API 가 전부 throw 한다", () => {
    admin.initializeApp({ projectId: EXPECTED_PROJECT });
    const db = admin.firestore();
    lockWrites(db);
    const ref = db.collection(COLLECTION).doc("selftest");
    for (const m of ["set", "update", "delete", "create"]) {
      assert.throws(() => ref[m]({ x: 1 }), /READ-ONLY script/, `${m} must throw`);
    }
    assert.throws(() => db.collection(COLLECTION).add({ x: 1 }), /READ-ONLY script/);
    assert.throws(() => db.batch(), /READ-ONLY script/);
    assert.throws(() => db.runTransaction(async () => {}), /READ-ONLY script/);
    // 읽기 쿼리는 그대로 만들어져야 한다(락이 읽기 경로를 부수지 않았는지).
    const q = db.collection(COLLECTION)
      .orderBy(admin.firestore.FieldPath.documentId()).limit(10)
      .select("uid", "startedAt", "endedAt", "used", "reviveCount");
    assert.ok(q && typeof q.get === "function");
    assert.ok(typeof db.collection(COLLECTION).count === "function");
  });

  console.log(fails.length ? `\n  SELFTEST FAILED (${fails.length})\n` : "\n  SELFTEST PASSED\n");
  return exitAfterFlush(fails.length ? 1 : 0);
}

// ── 한 유저 드릴다운 (지원/치트 조사용) ─────────────────
async function drilldown(col, uid) {
  console.log(`\n[uid drill-down] ${uid} — 최근 50 세션 (최신순)\n`);
  let snap;
  try {
    // 복합 인덱스 필요: game_sessions (uid ASC, startedAt DESC). firestore.indexes.json 참고.
    snap = await col.where("uid", "==", uid).orderBy("startedAt", "desc").limit(50).get();
  } catch (e) {
    if (/index/i.test(String((e && e.message) || e))) {
      console.error("✋ 복합 인덱스가 아직 없습니다 — game_sessions(uid ASC, startedAt DESC).");
      console.error("   `firebase deploy --only firestore:indexes` 실행 후 빌드가 끝나면 다시 시도하세요.");
      process.exit(4);
    }
    throw e;
  }
  if (snap.empty) {
    console.log("  (세션 없음)");
    return;
  }
  console.log("  startedAt (KST)        dur      used   revives");
  console.log("  ─────────────────────────────────────────────────");
  for (const d of snap.docs) {
    const s = d.data();
    const startMs = toMs(s.startedAt);
    const endMs = toMs(s.endedAt);
    const dur = startMs != null && endMs != null ? `${((endMs - startMs) / 1000).toFixed(1)}s` : "—";
    const kst = startMs != null ? new Date(startMs + KST_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ") : "?";
    console.log(`  ${kst}  ${String(dur).padStart(7)}  ${String(!!s.used).padStart(5)}  ${String(s.reviveCount || 0).padStart(7)}`);
  }
}

async function main() {
  // 읽기전용 하드가드 — 쓰기 플래그가 섞여 들어오면 아무것도 하지 않는다.
  const stray = argv.filter((a) => WRITE_FLAGS.includes(a));
  if (stray.length) {
    console.error(`✋ ABORT: '${stray.join(" ")}' — analytics-retention 은 읽기 전용 스크립트입니다.`);
    console.error("   쓰기 플래그를 받지 않습니다(백필 스크립트와 헷갈린 실행 방지). 아무것도 읽지 않고 종료합니다.");
    process.exit(1);
  }

  // --selftest 는 네트워크/자격증명 없이 도는 오프라인 검증이라 프로젝트 가드보다 먼저.
  if (SELFTEST) {
    console.log("\n[analytics-retention] SELFTEST — Firestore 접속 없음\n");
    return runSelfTest();
  }

  const projectId = resolveProjectId() || EXPECTED_PROJECT;
  admin.initializeApp({ projectId });

  const actualProject = admin.app().options.projectId || projectId;
  if (actualProject !== EXPECTED_PROJECT) {
    console.error(`✋ ABORT: projectId='${actualProject}' (expected '${EXPECTED_PROJECT}').`);
    console.error("   잘못된 프로젝트를 읽는 사고 방지. GOOGLE_CLOUD_PROJECT / ADC 를 확인하세요.");
    process.exit(1);
  }

  const db = admin.firestore();
  lockWrites(db);              // 이 줄 아래로는 어떤 쓰기도 런타임에서 막힌다.
  const col = db.collection(COLLECTION);

  // --json 은 파이프로 jq 에 넘기는 용도라 stdout 을 순수 JSON 으로 유지한다(헤더 출력 금지).
  if (!AS_JSON) console.log(`\n[analytics-retention] project=${actualProject}  mode=READ-ONLY  days=${DAYS}`);

  if (UID) {
    await drilldown(col, UID);
    return exitAfterFlush(0);
  }

  // ── 스캔 전 규모/비용 확인 ──
  // count() 는 aggregate 쿼리라 1000 index entry 당 읽기 1회로 과금 — 사실상 공짜.
  const total = (await col.count().get()).data().count;
  const estUsd = (total / 100000) * READ_COST_PER_100K_USD;
  if (!AS_JSON) console.log(`  ${COLLECTION} docs = ${total.toLocaleString()}   (전체 스캔 예상 비용 ≈ $${estUsd.toFixed(2)})`);
  if (total > MAX_SCAN) {
    console.error(`\n✋ ABORT: doc 수(${total.toLocaleString()})가 MAX_SCAN(${MAX_SCAN.toLocaleString()})을 넘습니다.`);
    console.error("   전량 스캔이 비싸지는 구간입니다. 한 번만 필요하면 `--max <N>` 으로 올려서 실행하고,");
    console.error("   상시로 필요해졌다면 BigQuery 익스포트로 옮길 시점입니다(docs/ 참고).");
    process.exit(3);
  }
  if (total === 0) {
    if (AS_JSON) console.log(JSON.stringify({ project: actualProject, scanned: 0, users: 0, cohorts: [] }, null, 2));
    else console.log("\n  (game_sessions 비어 있음 — 아직 플레이 기록이 없거나 TTL/수동 삭제로 지워졌습니다.)");
    return exitAfterFlush(0);
  }

  // ── 전량 스캔 ──
  // "최초 세션이 언제인가"는 전체 이력을 봐야 정확하므로 윈도우로 자르지 않는다.
  // documentId 커서 페이지네이션 = 인덱스 불필요 + 커서 의미가 단순(backfill 스크립트와 동일 패턴).
  const first = new Map();      // uid -> 최초 세션 dayIdx
  const daysByUid = new Map();  // uid -> Set<dayIdx>
  const runsByUid = new Map();  // uid -> 세션 수
  const durations = [];         // 정상 런 길이(초)
  let scanned = 0;
  let malformed = 0;            // uid/startedAt 없는 doc
  let open = 0;                 // endedAt 없음 = 제출 안 된 런(이탈/오프라인/진행중)
  let expired = 0;              // duration > SESSION_TTL — 만료 후 제출
  let negative = 0;             // 시계 이상(있으면 안 됨)
  let revivedRuns = 0;
  let minMs = Infinity;
  let maxMs = -Infinity;

  let last = null;
  for (;;) {
    let q = col
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(PAGE)
      .select("uid", "startedAt", "endedAt", "used", "reviveCount");
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned++;
      const d = doc.data() || {};
      const startMs = toMs(d.startedAt);
      if (!d.uid || startMs == null) { malformed++; continue; }

      if (startMs < minMs) minMs = startMs;
      if (startMs > maxMs) maxMs = startMs;

      const day = kstDayIndex(startMs);
      runsByUid.set(d.uid, (runsByUid.get(d.uid) || 0) + 1);
      const prevFirst = first.get(d.uid);
      if (prevFirst === undefined || day < prevFirst) first.set(d.uid, day);
      let set = daysByUid.get(d.uid);
      if (!set) { set = new Set(); daysByUid.set(d.uid, set); }
      set.add(day);

      if ((d.reviveCount || 0) > 0) revivedRuns++;

      const endMs = toMs(d.endedAt);
      if (endMs == null) { open++; continue; }
      const dur = (endMs - startMs) / 1000;
      if (dur < 0) negative++;
      else if (dur > SESSION_TTL_SEC) expired++;
      else durations.push(dur);
    }

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }

  // ── 집계 ──
  const users = first.size;
  const todayIdx = kstDayIndex(Date.now());
  const rows = buildCohorts(first, daysByUid, todayIdx, DAYS);

  let d1Num = 0, d1Den = 0, d7Num = 0, d7Den = 0;
  for (const r of rows) {
    if (r.d1Mature) { d1Num += r.d1; d1Den += r.newUsers; }
    if (r.d7Mature) { d7Num += r.d7; d7Den += r.newUsers; }
  }

  durations.sort((a, b) => a - b);
  const durMean = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : NaN;
  const runCounts = [...runsByUid.values()].sort((a, b) => a - b);
  const oneAndDone = runCounts.reduce((n, v) => n + (v === 1 ? 1 : 0), 0);
  // 비율의 분모는 malformed 를 뺀 "실제 세션"이어야 한다(안 빼면 지표가 조용히 희석된다).
  const validSessions = scanned - malformed;
  const runsMean = users ? validSessions / users : NaN;

  if (AS_JSON) {
    console.log(JSON.stringify({
      project: actualProject,
      scanned, validSessions, users, malformed, open, expired, negative, revivedRuns,
      oldest: Number.isFinite(minMs) ? kstDayLabel(kstDayIndex(minMs)) : null,
      newest: Number.isFinite(maxMs) ? kstDayLabel(kstDayIndex(maxMs)) : null,
      d1: d1Den ? d1Num / d1Den : null,
      d7: d7Den ? d7Num / d7Den : null,
      runLengthSec: {
        n: durations.length,
        mean: durMean,
        p10: pct(durations, 10), p25: pct(durations, 25), p50: pct(durations, 50),
        p75: pct(durations, 75), p90: pct(durations, 90), p95: pct(durations, 95),
        p99: pct(durations, 99),
      },
      runsPerUser: { mean: runsMean, p50: pct(runCounts, 50), p90: pct(runCounts, 90), oneAndDone },
      cohorts: rows,
    }, null, 2));
    return exitAfterFlush(0);
  }

  console.log("──────────────────────────────────────────────────────────");
  console.log("  VOLUME");
  console.log(`    sessions scanned      : ${scanned.toLocaleString()}`);
  console.log(`    unique players        : ${users.toLocaleString()}`);
  console.log(`    oldest session (KST)  : ${Number.isFinite(minMs) ? kstDayLabel(kstDayIndex(minMs)) : "n/a"}   ← 실행할 때마다 앞으로 밀리면 TTL/삭제 의심`);
  console.log(`    newest session (KST)  : ${Number.isFinite(maxMs) ? kstDayLabel(kstDayIndex(maxMs)) : "n/a"}`);
  console.log(`    never submitted       : ${open.toLocaleString()} (${pctStr(open, validSessions)})  ← 이탈/오프라인/진행중`);
  console.log(`    expired (>${SESSION_TTL_SEC}s)      : ${expired.toLocaleString()}  ← 만료 후 제출. 런 길이 통계에서 제외됨`);
  console.log(`    runs with gem revive  : ${revivedRuns.toLocaleString()} (${pctStr(revivedRuns, validSessions)})`);
  if (malformed) console.log(`    malformed docs        : ${malformed.toLocaleString()}`);
  if (negative) console.log(`    negative duration     : ${negative.toLocaleString()}  ← 있으면 안 됨. 조사할 것`);

  console.log("\n  RETENTION (KST 일 기준, 미완결일은 '—')");
  console.log("    cohort        new    D1            D7");
  console.log("    ────────────────────────────────────────────");
  for (const r of rows) {
    const d1s = r.d1Mature ? `${String(r.d1).padStart(4)} ${pctStr(r.d1, r.newUsers).padStart(6)}` : "     —     ";
    const d7s = r.d7Mature ? `${String(r.d7).padStart(4)} ${pctStr(r.d7, r.newUsers).padStart(6)}` : "     —     ";
    console.log(`    ${r.label}  ${String(r.newUsers).padStart(5)}  ${d1s}  ${d7s}`);
  }
  console.log("    ────────────────────────────────────────────");
  console.log(`    OVERALL (mature cohorts)   D1 ${pctStr(d1Num, d1Den)} (n=${d1Den})   D7 ${pctStr(d7Num, d7Den)} (n=${d7Den})`);

  console.log("\n  RUN LENGTH (초, 제출된 세션 기준, 만료 제외)");
  console.log(`    n=${durations.length.toLocaleString()}  mean=${fmtSec(durMean)}`);
  console.log(`    p10 ${fmtSec(pct(durations, 10))}   p25 ${fmtSec(pct(durations, 25))}   p50 ${fmtSec(pct(durations, 50))}   p75 ${fmtSec(pct(durations, 75))}`);
  console.log(`    p90 ${fmtSec(pct(durations, 90))}   p95 ${fmtSec(pct(durations, 95))}   p99 ${fmtSec(pct(durations, 99))}`);

  console.log("\n  RUNS PER PLAYER");
  console.log(`    mean=${Number.isFinite(runsMean) ? runsMean.toFixed(2) : "n/a"}   p50=${pct(runCounts, 50)}   p90=${pct(runCounts, 90)}`);
  console.log(`    one-and-done (1회만 플레이): ${oneAndDone.toLocaleString()} / ${users.toLocaleString()} (${pctStr(oneAndDone, users)})`);
  console.log("──────────────────────────────────────────────────────────\n");

  return exitAfterFlush(0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error("analytics-retention failed:", e);
    process.exit(1);
  });
}

// 순수 헬퍼는 export — 산술(코호트/백분위)을 Firestore 없이 검증할 수 있게.
module.exports = { kstDayIndex, kstDayLabel, pct, buildCohorts };
--------8<-------- END functions/scripts/analytics-retention.js --------8<--------

########################################################################
VERIFICATION (corrected — every step's expected output was produced on this
machine: Node v20.20.1, firebase-admin 12.7.0, firebase-tools 15.22.0, macOS)
Run IN ORDER. If a step's actual output differs, STOP and report it.
########################################################################

V0 — BASELINE (run BEFORE any change; this is the FAIL state)
  cd /Users/mark/repos/Snakeball
  node functions/scripts/analytics-retention.js --selftest 2>&1 | grep -c MODULE_NOT_FOUND
  node functions/scripts/analytics-retention.js --selftest >/dev/null 2>&1; echo "exit=$?"
EXPECT:
  1
  exit=1
(Node prints a full 12-line stack block, NOT a single "Error:" line — that is why
this step greps instead of comparing text. Do not be alarmed by the stack.)

  node -e "console.log(require('./firestore.indexes.json').indexes.length)"
EXPECT: 0

V1 — INDEX FILE IS VALID JSON AND SAYS THE RIGHT THING (no credentials)
  cd /Users/mark/repos/Snakeball
  node -e "const i=require('./firestore.indexes.json'); const x=i.indexes[0]; console.log('n='+i.indexes.length, x.collectionGroup, x.queryScope, x.fields.map(f=>f.fieldPath+':'+f.order).join(' | '), 'fo='+i.fieldOverrides.length);"
EXPECT EXACTLY:
  n=1 game_sessions COLLECTION uid:ASCENDING | startedAt:DESCENDING fo=0
(If this throws a JSON parse error you pasted a `#` comment line into the JSON.)

V2 — SCRIPT SELF-TEST (no credentials, no network — the main correctness gate)
  cd /Users/mark/repos/Snakeball
  node --check functions/scripts/analytics-retention.js && echo "SYNTAX OK"
  node functions/scripts/analytics-retention.js --selftest ; echo "exit=$?"
EXPECT (6 checks, all ✓):
  SYNTAX OK

  [analytics-retention] SELFTEST — Firestore 접속 없음

    ✓ KST 일 버킷: 2026-08-15T15:30Z → 2026-08-16 (KST 00:30)
    ✓ 백분위(nearest-rank)
    ✓ 코호트 D1/D7 카운트
    ✓ 성숙도 경계: 오늘은 미완결이라 어제 코호트의 D1 은 아직 못 읽는다
    ✓ --days 윈도우 필터
    ✓ 읽기전용 락: 쓰기 API 가 전부 throw 한다

    SELFTEST PASSED

  exit=0
Any ✗, "SELFTEST FAILED", or exit != 0 => STOP, you mistyped the file.

V2b — COHORT MATH AGAINST A KNOWN-ANSWER DATASET (no credentials)
  cd /Users/mark/repos/Snakeball
  node -e "
  const m=require('./functions/scripts/analytics-retention.js');
  const T=m.kstDayIndex(Date.now());
  const first=new Map(), days=new Map();
  for(let c=14;c>=1;c--){const C=T-c;for(let u=0;u<20;u++){const id='u'+c+'_'+u;first.set(id,C);
    const s=new Set([C]); if(u<7)s.add(C+1); if(u<3)s.add(C+7); days.set(id,s);}}
  const rows=m.buildCohorts(first,days,T,30);
  let a=0,b=0,x=0,y=0;
  for(const r of rows){if(r.d1Mature){a+=r.d1;b+=r.newUsers;} if(r.d7Mature){x+=r.d7;y+=r.newUsers;}}
  console.log('rows='+rows.length,'D1='+(a/b*100).toFixed(1)+'%','n='+b,'D7='+(x/y*100).toFixed(1)+'%','n='+y,
              'immatureD1='+rows.filter(r=>!r.d1Mature).length,'immatureD7='+rows.filter(r=>!r.d7Mature).length);"
EXPECT EXACTLY:
  rows=14 D1=35.0% n=260 D7=15.0% n=140 immatureD1=1 immatureD7=7
(The dataset is seeded at exactly 35% D1 / 15% D7. Recovering those rates proves the
cohort bucketing, the maturity gate, and the window filter simultaneously.)

V3 — SAFETY GUARDS (no credentials)
  cd /Users/mark/repos/Snakeball
  node functions/scripts/analytics-retention.js --commit ; echo "exit=$?"
EXPECT:
  ✋ ABORT: '--commit' — analytics-retention 은 읽기 전용 스크립트입니다.
     쓰기 플래그를 받지 않습니다(백필 스크립트와 헷갈린 실행 방지). 아무것도 읽지 않고 종료합니다.
  exit=1

  GOOGLE_CLOUD_PROJECT=wrong-project node functions/scripts/analytics-retention.js ; echo "exit=$?"
EXPECT:
  ✋ ABORT: projectId='wrong-project' (expected 'snakeball-game').
     잘못된 프로젝트를 읽는 사고 방지. GOOGLE_CLOUD_PROJECT / ADC 를 확인하세요.
  exit=1

V3b — PIPE-FLUSH REGRESSION (no credentials; proves --json will not be truncated)
  cd /Users/mark/repos/Snakeball
  node -e "
  const s=require('fs').readFileSync('functions/scripts/analytics-retention.js','utf8');
  const bad=/console\.log\([\s\S]{0,200}?JSON\.stringify[\s\S]{0,400}?\);\s*process\.exit\(/.test(s);
  console.log('exitAfterFlush present:', s.includes('function exitAfterFlush'));
  console.log('raw process.exit after JSON output:', bad);"
EXPECT:
  exitAfterFlush present: true
  raw process.exit after JSON output: false
(Why this exists: on macOS stdout is asynchronous when it is a pipe. `console.log(big);
process.exit(0)` delivers only the first 65536 bytes — measured, not theoretical.
V5's `--json | jq` would then silently receive invalid JSON on a large `--days`.)

V4 — DEPLOY THE INDEX
  cd /Users/mark/repos/Snakeball
  firebase deploy --only firestore:indexes 2>&1 | tee /tmp/t7-deploy.log

⚠️ USE EXACTLY `--only firestore:indexes`. NOT `--only firestore` — that also deploys
   firestore.rules, which is out of scope.
⚠️ The CLI can raise TWO deletion prompts: "Would you like to delete these indexes?"
   and "Would you like to delete these field overrides?". Answer N to BOTH and report
   what it wanted to delete. It should not want to delete anything.
   (Confirmed safe: an empty `fieldOverrides: []` will NOT delete an existing TTL
   policy — the CLI only logs a warning unless you write `"ttl": false` explicitly.)

  grep -c "deployed indexes in firestore.indexes.json successfully" /tmp/t7-deploy.log
EXPECT: 1
(The real line is `✔  firestore: deployed indexes in firestore.indexes.json
successfully for (default) database`. Do not expect a `+` prefix.)

Then confirm it landed:
  firebase firestore:indexes 2>/dev/null | node -e "
  let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
    const j=JSON.parse(s.slice(s.indexOf('{')));
    const hit=(j.indexes||[]).filter(i=>i.collectionGroup==='game_sessions');
    console.log('game_sessions composite indexes:',hit.length);
    console.log(JSON.stringify(hit));
    console.log('fieldOverrides with ttl:',JSON.stringify((j.fieldOverrides||[]).filter(f=>f.ttl)));});"
EXPECT:
  game_sessions composite indexes: 1
  [{"collectionGroup":"game_sessions","queryScope":"COLLECTION","fields":[{"fieldPath":"uid","order":"ASCENDING"},{"fieldPath":"startedAt","order":"DESCENDING"}]}]
  fieldOverrides with ttl: []
(`firebase firestore:indexes` without --pretty prints the pure JSON spec. The last
line is a second, independent TTL check — see V7.)
Index builds take minutes; if V6 says the index is missing, wait and retry.

V5 — READ REAL DATA (needs `firebase login` + gcloud ADC, or
     GOOGLE_APPLICATION_CREDENTIALS=<service-account.json>)
  cd /Users/mark/repos/Snakeball
  node functions/scripts/analytics-retention.js --days 30 ; echo "exit=$?"
EXPECT exit=0 and these section headers in order:
  VOLUME / RETENTION (KST 일 기준, 미완결일은 '—') / (table) / RUN LENGTH / RUNS PER PLAYER
Pre-launch the collection may be empty; "(game_sessions 비어 있음 …)" with exit=0 is a
PASS at this stage — it proves connectivity, the project guard and the read path.

  node functions/scripts/analytics-retention.js --json | jq -r '"D1=\(.d1) D7=\(.d7) p50=\(.runLengthSec.p50)"'
EXPECT: one line like `D1=0.357 D7=0.135 p50=52.038`, jq exit 0.
(Empty collection prints `D1=null D7=null p50=null` — still a pass.)
Also confirm the JSON is complete, not truncated:
  node functions/scripts/analytics-retention.js --json | jq -e 'type=="object"' >/dev/null; echo "jq=$?"
EXPECT: jq=0

V6 — DRILL-DOWN (proves the composite index is live). Needs one real uid.
Document ids in leaderboard_global ARE uids. Then:
  node functions/scripts/analytics-retention.js --uid <that-uid> ; echo "exit=$?"
EXPECT: a "startedAt (KST) / dur / used / revives" table, exit=0.
"✋ 복합 인덱스가 아직 없습니다" (exit 4) means the V4 index is still building — wait and
retry. Seeing that message once and the table after the build IS the proof the index took
effect (it is the exact pre-change failure mode).

V7 — TTL AUDIT ⚠️ MANDATORY
A Firestore TTL policy on game_sessions would delete the retention log, and D7/D30 are
not recomputable afterwards.
  gcloud firestore fields ttls list --project=snakeball-game
EXPECT: "Listed 0 items." (or an empty result). ANY row naming game_sessions is a
five-alarm finding — report it immediately and delete nothing.
(Syntax verified against `gcloud firestore fields ttls list --help`; --collection-group
is optional, so this lists the whole database.)
CORRECTION to the original spec: it claimed TTL "lives in the console, not in this repo"
and that firestore.indexes.json "cannot express, prevent, or reveal" it. That is FALSE.
firebase-tools supports a `"ttl"` boolean on fieldOverrides entries, `firebase
firestore:indexes` prints `ttl` for every field override (see the last line of V4), and
deploying `"ttl": false` actively removes a console-created TTL. Both V4's last line and
this gcloud call are therefore valid detectors.
DO NOT act on that in this task. Report to the owner as a follow-up: the invariant can be
pinned in-repo by adding to fieldOverrides —
  { "collectionGroup": "game_sessions", "fieldPath": "startedAt", "ttl": false,
    "indexes": [ { "order": "ASCENDING", "queryScope": "COLLECTION" },
                 { "order": "DESCENDING", "queryScope": "COLLECTION" },
                 { "arrayConfig": "CONTAINS", "queryScope": "COLLECTION" } ] }
— where the three `indexes` entries MUST be present, because a fieldOverride with
`"indexes": []` disables automatic single-field indexing for that field. Out of scope here.

########################################################################
DO-NOT-TOUCH (unchanged from the original spec, plus two corrections)
########################################################################
1. functions/coinSystem.js — NOT MODIFIED. Money path. MIGRATION_CUTOFF_MS must NEVER change.
2. functions/iapVerification.js — NOT MODIFIED. Money path.
3. functions/index.js — NOT MODIFIED. Do NOT add any write to submitScore "to make
   analytics easier". Run length is derived from the endedAt/startedAt fields that already
   exist precisely so zero writes are added to the anti-cheat path. If a future task ever
   does add one, it goes strictly AFTER `if (score > maxAllowed) { throw ... }`, and
   MAX_SCORE_PER_SEC=300 / BASE_BUFFER=200 / MAX_CREDITED_SECONDS=600 keep their values.
4. firestore.rules — NOT MODIFIED. `match /game_sessions/{token} { allow read, write: if
   false; }` and `match /users/{uid} { ... allow write: if false; }` stay exactly as they
   are. The script reads via the Admin SDK, which bypasses rules entirely.
5. functions/scripts/backfill-createdAt.js — READ ONLY, DO NOT EDIT, DO NOT RUN (it has a
   deploy-order guard and running it post-deploy is harmful).
6. firebase.json — NOT MODIFIED. `functions.ignore` already contains "scripts/**", which is
   why the new script never uploads to Cloud Functions. Do not remove it.
7. index.html / public/index.html — NOT TOUCHED, so `npm run sync:public` is NOT required
   and must not be run as a side effect.
8. `"fieldOverrides": []` — keep it, keep it empty for this task. CORRECTION to the original
   reasoning: an empty array does not change automatic single-field indexing; what would is
   ADDING an entry whose `indexes` array is empty. See the V7 follow-up for the safe form.
9. No additional composite index. Not on `used`, not on `endedAt`, not "just in case".
10. Do not remove lockWrites(), the WRITE_FLAGS guard, the EXPECTED_PROJECT guard, the
    MAX_SCAN check, or exitAfterFlush(). V2/V3/V3b verify all of them.
11. CORRECTION: do NOT `chmod +x` the new file. backfill-createdAt.js is mode 644 despite
    having a shebang; keep the two siblings consistent and the diff free of mode noise.

########################################################################
DEPLOY / EFFORT
########################################################################
DEPLOY REQUIRED: firestore indexes ONLY —
  cd /Users/mark/repos/Snakeball && firebase deploy --only firestore:indexes
NOT required and must not be run: `npm run sync:public`, `npm run deploy:web`,
`firebase deploy --only functions`, `firebase deploy --only firestore:rules`, iOS/Android
rebuild. Never `firebase deploy --only firestore` (that pushes rules too).
Runtime prerequisite for running the script (not a deploy): `firebase login` + gcloud ADC,
or GOOGLE_APPLICATION_CREDENTIALS.
EFFORT: ~45-60 min, mostly index-build waiting. V0-V3b are offline and always completable.
If credentials are unavailable, stop after V4 and report V5-V7 as pending — do not skip silently.
````


## 4. 검증 (수정 전 실패 → 수정 후 성공이어야 함)

````
Run these IN ORDER. Every step states what you should see. If a step's actual output differs, STOP and report it — do not proceed or "fix" it yourself.

──────────────────────────────────────────────────────────────
V0 — BASELINE (run BEFORE making any change, so you can prove the change did something)
──────────────────────────────────────────────────────────────
  cd /Users/mark/repos/Snakeball
  node functions/scripts/analytics-retention.js --selftest ; echo "exit=$?"

EXPECT (before the change):
  Error: Cannot find module '/Users/mark/repos/Snakeball/functions/scripts/analytics-retention.js'
  exit=1
This is the FAIL state. Record it.

  cat firestore.indexes.json
EXPECT: "indexes": [] (empty array).

──────────────────────────────────────────────────────────────
V1 — JSON VALIDITY OF THE INDEX FILE (no credentials needed)
──────────────────────────────────────────────────────────────
  cd /Users/mark/repos/Snakeball
  node -e "const i=require('./firestore.indexes.json'); const x=i.indexes[0]; console.log('n='+i.indexes.length, x.collectionGroup, x.queryScope, x.fields.map(f=>f.fieldPath+':'+f.order).join(' | '));"

EXPECT EXACTLY:
  n=1 game_sessions COLLECTION uid:ASCENDING | startedAt:DESCENDING

──────────────────────────────────────────────────────────────
V2 — SCRIPT SELF-TEST (no credentials, no network — this is the main correctness gate)
──────────────────────────────────────────────────────────────
  cd /Users/mark/repos/Snakeball
  node --check functions/scripts/analytics-retention.js && echo "SYNTAX OK"
  node functions/scripts/analytics-retention.js --selftest ; echo "exit=$?"

EXPECT EXACTLY (6 checks, all with ✓):
  SYNTAX OK

  [analytics-retention] SELFTEST — Firestore 접속 없음

    ✓ KST 일 버킷: 2026-08-15T15:30Z → 2026-08-16 (KST 00:30)
    ✓ 백분위(nearest-rank)
    ✓ 코호트 D1/D7 카운트
    ✓ 성숙도 경계: 오늘은 미완결이라 어제 코호트의 D1 은 아직 못 읽는다
    ✓ --days 윈도우 필터
    ✓ 읽기전용 락: 쓰기 API 가 전부 throw 한다

    SELFTEST PASSED

  exit=0

Any ✗, or "SELFTEST FAILED", or exit != 0 => STOP, you mistyped the file.
(This exact output was produced on Node v20.20.1 with firebase-admin 12.7.0 from
functions/node_modules. The selftest does not contact Firestore.)

──────────────────────────────────────────────────────────────
V3 — SAFETY GUARDS (no credentials needed)
──────────────────────────────────────────────────────────────
  cd /Users/mark/repos/Snakeball
  node functions/scripts/analytics-retention.js --commit ; echo "exit=$?"
EXPECT:
  ✋ ABORT: '--commit' — analytics-retention 은 읽기 전용 스크립트입니다.
     쓰기 플래그를 받지 않습니다(백필 스크립트와 헷갈린 실행 방지). 아무것도 읽지 않고 종료합니다.
  exit=1

  GOOGLE_CLOUD_PROJECT=wrong-project node functions/scripts/analytics-retention.js ; echo "exit=$?"
EXPECT:
  ✋ ABORT: projectId='wrong-project' (expected 'snakeball-game').
     잘못된 프로젝트를 읽는 사고 방지. GOOGLE_CLOUD_PROJECT / ADC 를 확인하세요.
  exit=1

──────────────────────────────────────────────────────────────
V4 — DEPLOY THE INDEX
──────────────────────────────────────────────────────────────
  cd /Users/mark/repos/Snakeball
  firebase deploy --only firestore:indexes

⚠️ USE EXACTLY `--only firestore:indexes`. Do NOT use `--only firestore` — that also deploys
   firestore.rules, which is out of scope for this task.
⚠️ If the CLI asks to DELETE any existing index, answer N and STOP, then report which index it
   wanted to delete. It should not want to delete anything (the file was previously empty and
   the client only issues single-field leaderboard queries), but a console-created index would
   show up here and deleting it could break a live query.

EXPECT: "+  firestore: deployed indexes in firestore.indexes.json successfully"

Then confirm it landed and is BUILDING/READY:
  firebase firestore:indexes
EXPECT: a JSON block containing collectionGroup "game_sessions" with fields uid ASCENDING and
startedAt DESCENDING. Index builds take minutes on an empty/small collection; if the --uid
drill-down (V6) reports "복합 인덱스가 아직 없습니다", wait and retry.

──────────────────────────────────────────────────────────────
V5 — READ REAL DATA (needs credentials: `firebase login` + gcloud ADC, or
     GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account json)
──────────────────────────────────────────────────────────────
  cd /Users/mark/repos/Snakeball
  node functions/scripts/analytics-retention.js --days 30 ; echo "exit=$?"

EXPECT exit=0 and a report with these five section headers, in this order:
  VOLUME / RETENTION (KST 일 기준, 미완결일은 '—') / (table) / RUN LENGTH / RUNS PER PLAYER
Pre-launch the collection may be empty or nearly so; "(game_sessions 비어 있음 …)" with exit=0
is a PASS at this stage — it proves connectivity, the project guard, and the read path.

Machine-readable form must be pure JSON on stdout (no header lines), so this must work:
  node functions/scripts/analytics-retention.js --json | jq -r '"D1=\(.d1) D7=\(.d7) p50=\(.runLengthSec.p50)"'
EXPECT: one line like `D1=0.357 D7=0.135 p50=52.038` and jq exit 0.
(If the collection is empty jq prints `D1=null D7=null p50=null` — still a pass.)

REFERENCE RUN — this exact script was executed end-to-end against a Firestore emulator seeded
with 1,988 synthetic sessions across 14 cohorts (~35% D1, ~12% D7 by construction) and produced:
  sessions scanned 1,988 / unique players 280 / never submitted 222 (11.2%)
  OVERALL D1 35.8% (n=260)  D7 13.6% (n=140)
  p50 52.0s  p90 144.3s  p99 210.3s
i.e. it recovered the seeded rates and correctly blanked the immature cohorts (yesterday's
cohort showed "—" for D1; every cohort newer than TODAY-8 showed "—" for D7). Use this as the
shape you should see; the numbers will of course differ on real data.

──────────────────────────────────────────────────────────────
V6 — DRILL-DOWN (proves the composite index is live). Needs one real uid.
──────────────────────────────────────────────────────────────
Get a uid from the leaderboard (document ids in leaderboard_global ARE uids), then:
  node functions/scripts/analytics-retention.js --uid <that-uid>
EXPECT: a "startedAt (KST) / dur / used / revives" table, exit 0.
If you instead see "✋ 복합 인덱스가 아직 없습니다" (exit 4), the index from V4 has not finished
building — wait a few minutes and retry. That message IS the pre-change failure mode, so seeing
it once and then seeing the table after the build is itself the proof the index took effect.

──────────────────────────────────────────────────────────────
V7 — TTL AUDIT ⚠️ MANDATORY. THIS IS NOT OPTIONAL AND IT IS NOT IN THE REPO.
──────────────────────────────────────────────────────────────
A Firestore TTL policy on game_sessions would delete the retention log. TTL is configured in
the Firebase console / gcloud ONLY — nothing in firestore.rules, firestore.indexes.json, or
firebase.json can express it, prevent it, or reveal it. Verify it is ABSENT:

  gcloud firestore fields ttls list --project=snakeball-game

EXPECT: "Listed 0 items." (or an empty result). ANY row naming game_sessions is a
five-alarm finding — report it immediately and do not delete anything else.

Console fallback (if gcloud is not authenticated):
  Firebase console -> Firestore Database -> (default) -> the "TTL" tab.
  The policy list must be EMPTY.

Why this matters concretely: game_sessions has no dedicated expiry field, so anyone adding a
TTL "to control storage cost" would have to point it at startedAt or endedAt — both of which
are always in the past. Every session document would be deleted almost immediately. There is
no error, no alert, and no way to recompute D7/D30 afterwards; the script would simply report
fewer and fewer rows. The script's "oldest session (KST)" line is the standing canary: it
should stay pinned at the launch date forever. If it starts moving forward between runs,
someone enabled a TTL or ran a manual purge.
````


## 5. 건드리지 말 것

DO NOT TOUCH — each with the reason it would break something:

1. functions/coinSystem.js — NOT MODIFIED AT ALL by this task. It is the money path.
   In particular MIGRATION_CUTOFF_MS must NEVER be changed. This task adds no constants and no
   fields there. If you find yourself editing this file, you have misread the spec.

2. functions/iapVerification.js — NOT MODIFIED AT ALL. Money path. No changes of any kind.

3. functions/index.js — NOT MODIFIED AT ALL. Specifically do NOT add any write to submitScore.
   You may be tempted to store score or a duration on the session doc "to make analytics
   easier". DO NOT. This spec deliberately derives run length from the endedAt/startedAt fields
   that already exist, precisely so that zero writes are added to the anti-cheat path.
   For the record, if a future task ever does add a write there, it must go strictly AFTER the
   `if (score > maxAllowed) { throw ... }` bound check, never before — and MAX_SCORE_PER_SEC=300,
   BASE_BUFFER=200, MAX_CREDITED_SECONDS=600 must keep their current values. None of that is in
   scope here.

4. firestore.rules — NOT MODIFIED. In particular:
   - `match /game_sessions/{token} { allow read, write: if false; }` stays exactly as is. The
     script reads via the Admin SDK, which bypasses rules entirely. Loosening this rule to
     "make analytics easier" would expose every player's session log to any client.
   - `match /users/{uid} { ... allow write: if false; }` stays exactly as is. It is `false` on
     purpose (the long comment above it explains the free-currency faucet that re-opening it
     creates). This task does not read or write users at all.

5. functions/scripts/backfill-createdAt.js — READ ONLY, DO NOT EDIT, DO NOT RUN.
   It is the source of the conventions being copied. It also has a deploy-order guard that
   refuses to run post-deploy; running it now would either abort or be actively harmful.
   You are ADDING a sibling file, not modifying this one.

6. firebase.json — NOT MODIFIED. Note that `functions.ignore` already contains "scripts/**",
   which is why the new script is never uploaded to Cloud Functions. Do not remove that entry.

7. index.html and public/index.html — NOT TOUCHED. No client change, therefore
   `npm run sync:public` is NOT required for this task and must not be run as a side effect.

8. The `"fieldOverrides": []` key in firestore.indexes.json — keep it, keep it empty. Removing
   the key or putting anything in it changes Firestore's automatic single-field indexing, which
   is exactly what the main scan and the existing leaderboard queries depend on.

9. Do not add any additional composite index beyond the single one specified — not on `used`,
   not on `endedAt`, not "just in case". Every composite index adds index-entry writes to every
   game_sessions write, and that collection is written 2-3 times per run on the anti-cheat path.

10. Do not "simplify" the script by removing lockWrites(), the WRITE_FLAGS guard, the
    EXPECTED_PROJECT guard, or the MAX_SCAN check. They are the reason this is safe to run
    against production, and V2/V3 verify all of them.


## 6. 리스크

RISK 1 — ⚠️ FIRESTORE TTL SILENTLY DESTROYING THE RETENTION LOG (highest priority; OWNER ACTION)
  A TTL policy on game_sessions deletes documents on a schedule. Retention is not recomputable
  after the fact: once the sessions are gone, D7 and D30 for those cohorts are gone forever.
  The failure is completely silent — no error, no alert, no log line; the script just reports
  fewer rows and a more recent "oldest session".
  TTL LIVES IN THE CONSOLE, NOT IN THIS REPO. firestore.rules, firestore.indexes.json, and
  firebase.json cannot express, prevent, or reveal a TTL policy, so no code review will ever
  catch one. The owner must verify it is absent (V7) and must never add one to this collection.
  Extra hazard: game_sessions has no dedicated expiry field, so any TTL would have to target
  startedAt or endedAt — both always in the past — which would delete essentially the entire
  collection within one TTL cycle rather than trimming old rows.
  Standing canary: the "oldest session (KST)" line in the script output should stay pinned at
  the launch date forever. If it moves forward between runs, investigate immediately.
  Related but separate: do not let anyone add a scheduled "cleanup expired sessions" function
  either. The `used: true` flag already prevents session replay; deleting old session documents
  buys almost nothing and costs all of the analytics.

RISK 2 — Firestore read cost on a full scan.
  Each run reads every document once (~$0.06 per 100k reads; region-dependent). At 50k runs/day
  a monthly full scan is ~1.5M reads, ~$0.90. Acceptable, but do not put this script on a cron
  that runs hourly. The script prints the estimated cost before scanning and hard-refuses above
  MAX_SCAN (1.5M) so it cannot run away unattended.

RISK 3 — Memory on a large collection.
  The script holds one Map entry per uid plus a Set of active days and one number per completed
  run. At the MAX_SCAN ceiling this is a few hundred MB. If Node OOMs, that is the signal to
  migrate to BigQuery, not to raise --max indefinitely. Short-term workaround:
  `node --max-old-space-size=4096 functions/scripts/analytics-retention.js`.

RISK 4 — Index-build latency, and the deploy prompt.
  The composite index may take minutes to build; the --uid drill-down returns
  FAILED_PRECONDITION until it is READY (the script catches this and prints a clear message
  with exit code 4). Separately, `firebase deploy --only firestore:indexes` can offer to DELETE
  indexes that exist in the project but not in the file — answering yes could drop an index a
  live query depends on. Answer N and report if it offers this.

RISK 5 — Metric interpretation traps that will otherwise cause a wrong business decision.
  a) Immature cohorts. A cohort from yesterday cannot have a D1 number yet. The script prints
     "—" instead of 0%, and the OVERALL line only averages mature cohorts. Do not "fix" this to
     always show a number — it would make every fresh cohort look like total churn.
  b) Cohorts are derived from game_sessions only, so a player counts as "new" on the day of
     their first ever recorded session. A player who plays entirely offline, or whose startRun
     call fails (it is fire-and-forget and swallows errors), produces no session document and is
     invisible here. Retention is therefore measured over players who reached the server, not
     over installs. Treat it as directional, not as an install-based cohort.
  c) "never submitted" mixes genuine abandonment, offline players, and runs still in flight. A
     sudden spike in this number is more likely a broken submit path than a gameplay problem.
  d) Run length is server wall-clock between startRun and submitScore, so it includes time spent
     on the revive prompt and the result screen. It is not pure gameplay time.
  e) Sessions longer than the 30-minute SESSION_TTL are excluded from the percentiles and
     counted separately as "expired"; they are late submissions, not real runs.

RISK 6 — Someone later adds a write to this script.
  Mitigated in code: lockWrites() converts every Firestore write API into a throw at startup, so
  an accidental write fails loudly on the first call instead of mutating the anti-cheat
  collection in production. Do not remove it.

RISK 7 — Nothing here is reversible-by-accident, but note the one-way door:
  the data itself. Code and indexes can be rolled back at any time; deleted session documents
  cannot. That asymmetry is why RISK 1 outranks everything else in this list.


## 7. 커밋 메시지

```
ops: make game_sessions readable — add the one composite index it needs and a read-only retention/run-length script

game_sessions is the only real engagement log this game produces (one document per run, carrying uid, startedAt, endedAt, used and reviveCount), but it was write-only in practice: firestore.rules blocks all client access to it by design, and firestore.indexes.json was an empty index list, so after launch there was no supported way to answer "how many of yesterday's new players came back today" — the single number that decides whether to spend on ads, which features to sell, and whether the game is worth continuing. This adds a read-only admin script, functions/scripts/analytics-retention.js, that scans the collection once and prints volume, per-cohort D1/D7 retention (KST day buckets, matching isoWeekKeyKST, with immature cohorts explicitly blanked instead of silently reported as 0%), run-length percentiles derived from endedAt-startedAt with post-TTL submissions excluded so they cannot pollute p99, runs per player, and the one-and-done rate. It follows the safety conventions already established by functions/scripts/backfill-createdAt.js — a hard projectId guard that aborts unless the project is snakeball-game — and adds two more: it refuses any write-shaped flag, and lockWrites() replaces every Firestore write API with a throwing stub at startup, so the read-only property is enforced at runtime rather than merely promised in a comment. It also counts the collection before scanning and refuses to run past MAX_SCAN, which doubles as the documented trip-wire for migrating to a BigQuery export later. A BigQuery export was considered and deliberately deferred: it only captures writes made after installation (so it cannot recover launch-week cohorts retroactively, whereas the script can be run at any time against data already collected), it adds a Cloud Function on the write path of the anti-cheat session collection, and it carries a standing cost floor that is unjustified at this volume. The single composite index added, game_sessions(uid ASC, startedAt DESC), is the only one any query in the repo needs — the main scan paginates by document ID and is served by Firestore's automatic single-field indexes — and no extras were added because every composite index costs additional index-entry writes on a collection written two to three times per run.
```
