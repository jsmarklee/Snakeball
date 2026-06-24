/**
 * Snakeball — Cloud Functions (서버 권위 리더보드 + 안티치트)
 *
 * MinefieldSweeper의 세션 기반 안티치트 패턴을 엔들리스 러너에 맞게 이식.
 * 함수: startRun (세션 발급) → submitScore (세션 검증 + 점수 등록) , setName (닉네임).
 *
 * 리더보드는 클라이언트가 Firestore에서 직접 top-N 읽기 (firestore.rules에서
 * leaderboard_* 는 read 허용 / write 차단). 쓰기는 이 함수들(Admin SDK)만 가능.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { checkBlocklist } = require("./blocklist");

initializeApp();
const db = getFirestore();

// MinefieldSweeper와 동일 리전 (한국 사용자/Toss 대상).
const REGION = "asia-northeast3";

// ─── 안티치트 상수 ────────────────────────────────────────────
//
// Snakeball 점수 = score(큐브 파괴 × 콤보 배수) + floor(gameTimer).
// 콤보 배수는 5콤보마다 +0.5 (x1 → x1.5 @5 → x2 @10 ...)로 사실상 상한이 있고,
// 큐브 점수도 HP 비례라 초당 수백 점이 현실적인 상한이다. 따라서:
//   - MAX_SCORE_PER_SEC: 초당 허용 점수. 매우 빠른 콤보 폭발을 감안해 넉넉히 300.
//   - BASE_BUFFER: 게임 시작 직후 짧은 세션의 초기 버스트 + 시계 오차 흡수용 2000.
// 검증식: score <= MAX_SCORE_PER_SEC * elapsedSeconds + BASE_BUFFER.
// 정상 플레이는 절대 못 넘고, 명백한 조작(예: 5초에 100만 점)만 걸린다.
const MAX_SCORE_PER_SEC = 300;
const BASE_BUFFER = 2000;
// 절대 상한 — 어떤 세션 길이여도 이 이상은 비현실적.
const ABSOLUTE_MAX_SCORE = 100_000_000;
// 세션 TTL — 너무 오래된 세션으로 제출 시도 차단 (30분).
const SESSION_TTL_MS = 30 * 60 * 1000;
// rank 카운트 쿼리 상한 (비용 보호).
const RANK_QUERY_CAP = 1000;

/**
 * ISO 주차(YYYYWW) 키 — KST 기준.
 * 주간 리더보드 컬렉션 이름 leaderboard_weekly_{YYYYWW} 에 사용.
 */
function isoWeekKeyKST(date = new Date()) {
  // KST = UTC+9
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  // UTC 메서드로 KST 보정된 값을 읽는다 (DST 없는 한국에 안전).
  const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
  // ISO 주차: 목요일 기준
  const dayNum = (d.getUTCDay() + 6) % 7; // 월=0 ... 일=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${d.getUTCFullYear()}${String(week).padStart(2, "0")}`;
}

/** 닉네임 정리 + 검증. 통과하면 정리된 문자열, 아니면 HttpsError throw. */
function sanitizeName(raw) {
  if (typeof raw !== "string") {
    throw new HttpsError("invalid-argument", "이름이 필요합니다.");
  }
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > 16) {
    throw new HttpsError("invalid-argument", "이름은 1~16자여야 합니다.");
  }
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
exports.startRun = onCall({ region: REGION }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "인증이 필요합니다.");
  }
  const uid = request.auth.uid;

  // 랜덤 토큰 = Firestore auto-id.
  const sessionRef = db.collection("game_sessions").doc();
  await sessionRef.set({
    uid,
    startedAt: FieldValue.serverTimestamp(),
    used: false,
  });

  return { sessionToken: sessionRef.id };
});

/**
 * submitScore — 세션 검증 + 점수 등록.
 * 입력: { sessionToken, score, name? }
 *  1) 세션 존재 / uid 일치 / used=false 확인 후 트랜잭션으로 used:true (리플레이 방지)
 *  2) 경과 시간 기반 점수 상한으로 안티치트
 *  3) 개인 최고점 초과 시 leaderboard_global + leaderboard_weekly_{YYYYWW} upsert,
 *     users/{uid}.bestScore 갱신
 *  4) 반환: { best, rank }
 */
exports.submitScore = onCall({ region: REGION }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "인증이 필요합니다.");
  }
  const uid = request.auth.uid;
  const { sessionToken, score, name } = request.data || {};

  if (!sessionToken || typeof sessionToken !== "string") {
    throw new HttpsError("invalid-argument", "sessionToken이 필요합니다.");
  }
  // 점수 기본 검증: 정수 / 음수 아님 / 비현실적 아님.
  if (typeof score !== "number" || !Number.isInteger(score)) {
    throw new HttpsError("invalid-argument", "score는 정수여야 합니다.");
  }
  if (score < 0 || score > ABSOLUTE_MAX_SCORE) {
    throw new HttpsError("invalid-argument", "score가 허용 범위를 벗어났습니다.");
  }

  // 닉네임은 선택 — 주어지면 검증, 없으면 저장된 이름 사용.
  let providedName = null;
  if (name !== undefined && name !== null) {
    providedName = sanitizeName(name);
  }

  const sessionRef = db.collection("game_sessions").doc(sessionToken);

  // ── 1) 세션 검증 + 리플레이 방지 (트랜잭션으로 used:true) ──
  const startedAtMs = await db.runTransaction(async (tx) => {
    const doc = await tx.get(sessionRef);
    if (!doc.exists) {
      throw new HttpsError("not-found", "세션을 찾을 수 없습니다.");
    }
    const s = doc.data();
    if (s.uid !== uid) {
      throw new HttpsError("permission-denied", "세션 소유자가 아닙니다.");
    }
    if (s.used === true) {
      throw new HttpsError("failed-precondition", "이미 제출된 세션입니다.");
    }
    if (!s.startedAt) {
      throw new HttpsError("failed-precondition", "세션이 손상되었습니다.");
    }
    const startMs = s.startedAt.toDate ? s.startedAt.toDate().getTime() : new Date(s.startedAt).getTime();
    if (Date.now() - startMs > SESSION_TTL_MS) {
      // 만료된 세션도 used 처리해 재사용 차단.
      tx.update(sessionRef, { used: true, endedAt: FieldValue.serverTimestamp() });
      throw new HttpsError("deadline-exceeded", "세션이 만료되었습니다.");
    }
    tx.update(sessionRef, { used: true, endedAt: FieldValue.serverTimestamp() });
    return startMs;
  });

  // ── 2) 안티치트 점수 상한 ──
  const elapsedSeconds = Math.max(0, (Date.now() - startedAtMs) / 1000);
  const maxAllowed = MAX_SCORE_PER_SEC * elapsedSeconds + BASE_BUFFER;
  if (score > maxAllowed) {
    // 세션은 이미 used 처리됨 — 조작 점수는 그냥 거부.
    throw new HttpsError("failed-precondition", "점수가 검증을 통과하지 못했습니다.");
  }

  // ── 3) 리더보드 / users 갱신 ──
  const userRef = db.collection("users").doc(uid);
  const userDoc = await userRef.get();
  const userData = userDoc.exists ? userDoc.data() : {};

  // 이름 우선순위: 이번 요청 > 저장된 이름 > Anonymous.
  const finalName = providedName || userData.name || "Anonymous";

  const globalRef = db.collection("leaderboard_global").doc(uid);
  const globalDoc = await globalRef.get();
  const prevBest = globalDoc.exists ? (globalDoc.data().score ?? 0) : (userData.bestScore ?? 0);

  const best = Math.max(prevBest, score);

  if (score > prevBest) {
    const weeklyCol = `leaderboard_weekly_${isoWeekKeyKST()}`;
    const weeklyRef = db.collection(weeklyCol).doc(uid);
    const entry = {
      uid,
      name: finalName,
      score,
      updatedAt: FieldValue.serverTimestamp(),
    };
    const batch = db.batch();
    batch.set(globalRef, entry, { merge: true });
    batch.set(weeklyRef, entry, { merge: true });
    batch.set(
      userRef,
      { name: finalName, bestScore: best },
      { merge: true }
    );
    await batch.commit();
  } else if (providedName && providedName !== userData.name) {
    // 신기록은 아니지만 이름이 새로 들어온 경우 users에만 반영.
    await userRef.set({ name: finalName }, { merge: true });
  }

  // ── 4) 순위 계산 (best 기준, 비용 보호 위해 RANK_QUERY_CAP 으로 제한) ──
  const higherSnap = await db
    .collection("leaderboard_global")
    .where("score", ">", best)
    .limit(RANK_QUERY_CAP)
    .get();
  const rank = higherSnap.size + 1;

  return { best, rank };
});

/**
 * setName — 닉네임 설정/변경.
 * 입력: { name }. 검증 후 users/{uid}.name 저장하고, 존재하면 리더보드 문서에 전파.
 * 반환: { name }.
 */
exports.setName = onCall({ region: REGION }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "인증이 필요합니다.");
  }
  const uid = request.auth.uid;
  const name = sanitizeName((request.data || {}).name);

  await db.collection("users").doc(uid).set({ name }, { merge: true });

  // 이 uid의 리더보드 문서들에 이름 전파 (global + 이번 주 weekly).
  const batch = db.batch();
  let hasWrites = false;

  const globalRef = db.collection("leaderboard_global").doc(uid);
  const globalDoc = await globalRef.get();
  if (globalDoc.exists) {
    batch.update(globalRef, { name });
    hasWrites = true;
  }

  const weeklyRef = db.collection(`leaderboard_weekly_${isoWeekKeyKST()}`).doc(uid);
  const weeklyDoc = await weeklyRef.get();
  if (weeklyDoc.exists) {
    batch.update(weeklyRef, { name });
    hasWrites = true;
  }

  if (hasWrites) await batch.commit();

  return { name };
});
