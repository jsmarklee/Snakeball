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
