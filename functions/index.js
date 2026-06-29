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
const { defineSecret } = require("firebase-functions/params");
const crypto = require("crypto");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { checkBlocklist } = require("./blocklist");
const { verifyAndFulfill } = require("./iapVerification");

initializeApp();
const db = getFirestore();

// MinefieldSweeper와 동일 리전 (한국 사용자/Toss 대상).
const REGION = "asia-northeast3";

// ─── IAP 검증용 시크릿 (verifyAndFulfillPurchase에 바인딩) ─────
// 값은 `firebase functions:secrets:set <NAME>` 으로 설정 (배포 전 필수).
//
//  APP_STORE_KEY_ID / APP_STORE_ISSUER_ID / APP_STORE_PRIVATE_KEY
//    → App Store Connect > Users and Access > Integrations > In-App Purchase 키.
//      KEY_ID = 키 ID, ISSUER_ID = Issuer ID, PRIVATE_KEY = 다운로드한 .p8 내용.
//  GOOGLE_PLAY_SERVICE_ACCOUNT
//    → Google Play Console에 연결한 GCP 서비스 계정의 JSON 키 (androidpublisher 권한).
//  TOSS_IAP_API_KEY / TOSS_IAP_BASE_URL / TOSS_MTLS_CERT / TOSS_MTLS_KEY
//    → Toss 개발자 콘솔. BASE_URL=https://apps-in-toss-api.toss.im,
//      CERT/KEY = 콘솔 > mTLS 인증서에서 발급한 client cert(.crt)/key(.key) PEM.
const appStoreKeyId = defineSecret("APP_STORE_KEY_ID");
const appStoreIssuerId = defineSecret("APP_STORE_ISSUER_ID");
const appStorePrivateKey = defineSecret("APP_STORE_PRIVATE_KEY");
const googlePlayServiceAccount = defineSecret("GOOGLE_PLAY_SERVICE_ACCOUNT");
const tossIapApiKey = defineSecret("TOSS_IAP_API_KEY");
const tossIapBaseUrl = defineSecret("TOSS_IAP_BASE_URL");
const tossMtlsCert = defineSecret("TOSS_MTLS_CERT");
const tossMtlsKey = defineSecret("TOSS_MTLS_KEY");

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
exports.startRun = onCall({ region: REGION, minInstances: 1 }, async (request) => {
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
exports.submitScore = onCall({ region: REGION, minInstances: 1 }, async (request) => {
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
  // 복구로 다른 uid로 이전된(tombstone) 계정으로의 점수 기록을 차단. (플레이북 21 §2)
  assertNotMigrated(userData);

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

  const nameRef = db.collection("users").doc(uid);
  const nameDoc = await nameRef.get();
  assertNotMigrated(nameDoc.exists ? nameDoc.data() : {});

  await nameRef.set({ name }, { merge: true });

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

// ─── 계정 복구 (stableId 자동 + 복구 코드 수동) ─────────────────
// 익명 게임이라 진행이 기기에 묶인다. 새 기기/재설치에서 리더보드 신원
// (users/{uid}: name/bestScore)을 되살리는 경로. (플레이북 20 §1, 21 §2)
// ⚠️ Snakeball 코인/젬은 localStorage(기기-로컬)라 이 경로로 복구되지 않는다 —
//    리더보드 신원/이름/최고점만 이전한다. 클라우드 세이브 도입 시 경제도 함께.

// 0/O/1/I/L 제외(필기 혼동 방지). 31^8 ≈ 8.5e11 엔트로피 → 무차별 대입 비현실적.
const RECOVERY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function generateRecoveryCodeString() {
  let s = "SNB-";
  for (let i = 0; i < 4; i++) s += RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)];
  s += "-";
  for (let i = 0; i < 4; i++) s += RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)];
  return s;
}

function normalizeRecoveryCode(code) {
  if (typeof code !== "string") return "";
  return code.toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9-]/g, "");
}

/** migrated_to 가 찍힌 tombstone doc으로의 모든 grant/score/이름 op를 막는다. */
function assertNotMigrated(data) {
  if (data && data.migrated_to) {
    throw new HttpsError("failed-precondition", "ACCOUNT_MIGRATED");
  }
}

/**
 * generateRecoveryCode — 호출자의 복구 코드 발급(이미 있으면 그대로 반환).
 * 반환: { code }. 클라이언트는 표시 + 자동 클립보드 복사.
 */
exports.generateRecoveryCode = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "인증이 필요합니다.");
  const uid = request.auth.uid;
  const ref = db.collection("users").doc(uid);
  const doc = await ref.get();
  const data = doc.exists ? doc.data() : null;
  assertNotMigrated(data || {});
  if (data && data.recoveryCode) return { code: data.recoveryCode };

  // 충돌 시 재시도(거의 발생 안 함).
  let attempts = 0;
  while (attempts < 8) {
    const candidate = generateRecoveryCodeString();
    const taken = await db.collection("users").where("recoveryCode", "==", candidate).limit(1).get();
    if (taken.empty) {
      await ref.set(
        { recoveryCode: candidate, createdAt: data?.createdAt || FieldValue.serverTimestamp() },
        { merge: true }
      );
      return { code: candidate };
    }
    attempts++;
  }
  throw new HttpsError("internal", "코드 생성에 실패했습니다. 다시 시도해주세요.");
});

/**
 * recoverByCode — 다른 기기에서 발급한 코드로 소스 계정을 현재 익명 uid로 이전.
 * 입력: { code, force? }. 이미 데이터가 있으면 force=true 필요(클라가 파괴적 확인 후).
 * 소스는 migrated_to 스탬프 + recoveryCode 삭제로 잠근다(복제 방지). 반환: { recovered, name, bestScore }.
 */
exports.recoverByCode = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "인증이 필요합니다.");
  const { code, force } = request.data || {};
  const normalized = normalizeRecoveryCode(code);
  if (!normalized || !/^SNB-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalized)) {
    throw new HttpsError("invalid-argument", "복구 코드 형식이 올바르지 않습니다.");
  }

  const snap = await db.collection("users").where("recoveryCode", "==", normalized).limit(1).get();
  if (snap.empty) throw new HttpsError("not-found", "복구 코드를 찾을 수 없습니다.");
  const sourceDoc = snap.docs[0];
  const targetUid = sourceDoc.id;
  const uid = request.auth.uid;
  if (targetUid === uid) throw new HttpsError("failed-precondition", "SELF_RECOVERY_CODE");

  const userRef = db.collection("users").doc(uid);
  const currentDoc = await userRef.get();
  if (currentDoc.exists && !force) throw new HttpsError("already-exists", "EXISTING_DATA");

  const cloned = { ...sourceDoc.data() };
  cloned.clonedFrom = targetUid;
  // 목적지의 stableId(=이 기기)를 유지.
  if (currentDoc.exists && currentDoc.data().stableId) cloned.stableId = currentDoc.data().stableId;
  else delete cloned.stableId;
  delete cloned.migrated_to;
  delete cloned.migrated_at;
  delete cloned.recoveryCode; // 1회성 — 새 기기에서 재발급 가능.

  await db.runTransaction(async (t) => {
    t.set(userRef, cloned);
    t.update(sourceDoc.ref, {
      migrated_to: uid,
      migrated_at: FieldValue.serverTimestamp(),
      recoveryCode: FieldValue.delete(),
    });
  });

  return { recovered: true, name: cloned.name || null, bestScore: cloned.bestScore || 0 };
});

/**
 * recoverAccount — 콜드스타트마다 stableId로 같은-기기 재설치 자동 복구.
 * 입력: { stableId }(iOS identifierForVendor / Android ANDROID_ID).
 * ⚠️ 같은-기기 경로는 소스에 migrated_to를 찍지 않는다 — 식별자(stableId/recoveryCode)만
 *    소스에서 제거해 stableId를 정확히 한 doc만 소유하게 한다. 안 그러면 재설치가
 *    tombstone된 소스를 만나 신규계정으로 라우팅돼 진행을 잃는다. (플레이북 21 §2 M4)
 */
exports.recoverAccount = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "인증이 필요합니다.");
  const uid = request.auth.uid;
  const { stableId } = request.data || {};
  if (!stableId || typeof stableId !== "string" || stableId.length < 8) {
    throw new HttpsError("invalid-argument", "stableId가 필요합니다.");
  }

  const userRef = db.collection("users").doc(uid);
  const currentDoc = await userRef.get();
  if (currentDoc.exists) {
    if (!currentDoc.data().stableId) await userRef.set({ stableId }, { merge: true });
    return { recovered: false, alreadyHadData: true };
  }

  const snap = await db.collection("users").where("stableId", "==", stableId).limit(1).get();
  if (snap.empty) {
    await userRef.set({ stableId, createdAt: FieldValue.serverTimestamp() }, { merge: true });
    return { recovered: false, alreadyHadData: false };
  }

  const sourceDoc = snap.docs[0];
  const sourceData = sourceDoc.data();
  if (sourceData.migrated_to) {
    // 소스가 코드로 다른 곳에 이전됨 — 새 계정으로 취급.
    await userRef.set({ stableId, createdAt: FieldValue.serverTimestamp() }, { merge: true });
    return { recovered: false, sourceLocked: true };
  }

  const cloned = { ...sourceData };
  cloned.stableId = stableId;
  cloned.clonedFrom = sourceDoc.id;
  delete cloned.migrated_to;
  delete cloned.migrated_at;
  delete cloned.recoveryCode;

  await db.runTransaction(async (t) => {
    t.set(userRef, cloned);
    // 같은-기기: tombstone 금지. 식별자만 제거해 stableId 단일 소유 + 재설치 멱등.
    t.update(sourceDoc.ref, {
      stableId: FieldValue.delete(),
      recoveryCode: FieldValue.delete(),
      superseded_by: uid,
      superseded_at: FieldValue.serverTimestamp(),
    });
  });

  return { recovered: true, name: cloned.name || null, bestScore: cloned.bestScore || 0 };
});

// ─── 크로스프로모 설치 보상 (서버 검증, 평생 상한) ─────────────
// 형제 게임 설치 시 코인 보상. 보상액은 서버 상수(CROSSPROMO_REWARDS)가 결정 —
// 클라는 gameId만 보낸다. 설치 신호는 스푸핑 가능하므로 방어를 겹친다:
//   (a) 게임당 1회 멱등 (crossPromoClaimed)
//   (b) 유저별 rate limit (lastCrossPromoClaim)
//   (c) 계정 평생 상한 (crossPromoCoinsTotal) — 상한까지만 부분 지급
// ⚠️ Snakeball 경제(코인/젬)는 localStorage라 서버가 잔액을 들고 있지 않다. 이 함수는
//    "청구 자격"만 서버 권위로 판정하고 지급 코인 수를 반환 — 실제 지급은 클라가
//    SB.addCoins로 로컬 반영한다(2048과 달리 코인 잔액을 서버가 안 가짐).
const CROSSPROMO_REWARDS = {
  mineta: 3,
  pow2: 3,
};
const CROSSPROMO_LIFETIME_MAX_COINS = 15;   // 계정 평생 크로스프로모 코인 상한
const CROSSPROMO_RATE_LIMIT_MS = 30 * 1000; // 연속 청구 throttle (lastCrossPromoClaim)

exports.claimCrossPromoReward = onCall({ region: REGION, minInstances: 1 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "인증이 필요합니다.");
  }
  const uid = request.auth.uid;
  const { gameId } = request.data || {};
  if (!gameId || typeof gameId !== "string") {
    throw new HttpsError("invalid-argument", "gameId가 필요합니다.");
  }

  const reward = CROSSPROMO_REWARDS[gameId];
  if (reward === undefined) {
    throw new HttpsError("invalid-argument", "알 수 없는 크로스프로모 게임입니다.");
  }

  const ref = db.collection("users").doc(uid);

  return db.runTransaction(async (t) => {
    const doc = await t.get(ref);
    const data = doc.exists ? doc.data() : {};
    assertNotMigrated(data);

    // (a) 게임당 1회, 영구 — 멱등.
    const claimed = data.crossPromoClaimed || [];
    if (claimed.includes(gameId)) {
      throw new HttpsError("already-exists", "이미 받은 보상입니다.");
    }

    // (b) 유저별 rate limit (rapid-fire/자동화 완화).
    const last = data.lastCrossPromoClaim;
    const lastMs = last && last.toMillis ? last.toMillis() : 0;
    if (lastMs && Date.now() - lastMs < CROSSPROMO_RATE_LIMIT_MS) {
      throw new HttpsError("resource-exhausted", "잠시 후 다시 시도해주세요.");
    }

    // (c) 계정 평생 상한 — 상한까지만 부분 지급, 가득 차면 거부.
    const spentTotal = data.crossPromoCoinsTotal || 0;
    if (spentTotal >= CROSSPROMO_LIFETIME_MAX_COINS) {
      throw new HttpsError("failed-precondition", "평생 보상 상한에 도달했습니다.");
    }
    const grant = Math.min(reward, CROSSPROMO_LIFETIME_MAX_COINS - spentTotal);

    t.set(ref, {
      crossPromoClaimed: [...claimed, gameId],
      crossPromoCoinsTotal: spentTotal + grant,
      lastCrossPromoClaim: FieldValue.serverTimestamp(),
      createdAt: data.createdAt || FieldValue.serverTimestamp(),
    }, { merge: true });

    // 지급액만 반환 — 코인 잔액은 클라(localStorage)가 들고 있다.
    return { reward: grant, gameId };
  });
});

// ─── IAP 영수증 검증 ──────────────────────────────────────────

/**
 * verifyAndFulfillPurchase — IAP 영수증 서버 검증 + 상품 지급.
 * 입력: { platform:'ios'|'android'|'toss', productId, transactionId?, purchaseToken? }
 *  - iOS:     transactionId = StoreKit2 transaction.id
 *  - Android: transactionId 또는 purchaseToken = Play purchaseToken
 *  - Toss:    transactionId = SDK 구매 결과 orderId
 *
 * 검증 통과 시 서버 권위 PRODUCTS 맵의 grant를 반환 ({ success, productId, grant }).
 * 지급량은 절대 클라이언트가 정하지 못한다. 실패하면 HttpsError를 throw하므로
 * 클라이언트는 grant를 하지 않는다.
 */
exports.verifyAndFulfillPurchase = onCall(
  {
    region: REGION,
    secrets: [
      appStoreKeyId, appStoreIssuerId, appStorePrivateKey,
      googlePlayServiceAccount,
      tossIapApiKey, tossIapBaseUrl, tossMtlsCert, tossMtlsKey,
    ],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "인증이 필요합니다.");
    }

    const { platform, productId } = request.data || {};
    // Android는 purchaseToken, iOS/Toss는 transactionId — 둘 중 하나를 transaction 식별자로.
    const transactionId = request.data?.transactionId ?? request.data?.purchaseToken;

    if (!platform || typeof platform !== "string") {
      throw new HttpsError("invalid-argument", "platform이 필요합니다.");
    }
    if (!transactionId) {
      throw new HttpsError("invalid-argument", "transactionId가 필요합니다.");
    }
    if (!productId || typeof productId !== "string") {
      throw new HttpsError("invalid-argument", "productId가 필요합니다.");
    }

    const uid = request.auth.uid;

    try {
      return await verifyAndFulfill(uid, platform, String(transactionId), productId, {
        keyId: appStoreKeyId.value(),
        issuerId: appStoreIssuerId.value(),
        privateKey: appStorePrivateKey.value(),
        bundleId: "studio.hodgepodge.snakeball",
        androidPackageName: "studio.hodgepodge.snakeball",
        googlePlayServiceAccount: googlePlayServiceAccount.value(),
        // 미설정 시 ""로 resolve → verifyWithToss가 MISSING_TOSS_CREDENTIALS throw.
        tossIapBaseUrl: tossIapBaseUrl.value() || null,
        tossMtlsCert: tossMtlsCert.value() || null,
        tossMtlsKey: tossMtlsKey.value() || null,
      });
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      const msg = error.message || "";
      if (msg === "INVALID_PRODUCT") {
        throw new HttpsError("invalid-argument", "알 수 없는 상품입니다.");
      }
      if (msg === "PRODUCT_ID_MISMATCH") {
        throw new HttpsError("invalid-argument", "상품 ID가 일치하지 않습니다.");
      }
      if (msg === "UNSUPPORTED_PLATFORM") {
        throw new HttpsError("unimplemented", "지원하지 않는 플랫폼입니다.");
      }
      if (msg === "ACCOUNT_MIGRATED") {
        throw new HttpsError("failed-precondition", "복구된 계정입니다. 앱을 재시작해주세요.");
      }
      if (msg === "MISSING_APP_STORE_CREDENTIALS"
        || msg === "MISSING_GOOGLE_PLAY_CREDENTIALS"
        || msg === "MISSING_TOSS_CREDENTIALS") {
        throw new HttpsError("internal", "서버 설정 오류입니다.");
      }
      if (msg.startsWith("APP_STORE_VERIFICATION_FAILED")
        || msg.startsWith("GOOGLE_PLAY_INVALID_STATE")
        || msg.startsWith("TOSS_VERIFICATION_FAILED")
        || msg.startsWith("TOSS_INVALID_STATE")
        || msg.startsWith("NON_PRODUCTION_TRANSACTION")) {
        throw new HttpsError("permission-denied", "구매 검증에 실패했습니다.");
      }
      console.error("verifyAndFulfillPurchase error:", error);
      throw new HttpsError("internal", "결제 처리에 실패했습니다.");
    }
  }
);
