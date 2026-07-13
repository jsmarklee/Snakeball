/**
 * coinSystem.js — Snakeball 서버 권위 경제(코인 + 젬) 코어 로직
 *
 * MinefieldSweeper functions/coinSystem.js 의 applyCoinDelta(단일 트랜잭션 라이터
 * + 멱등 + 음수 가드 + 데일리 캡)와 KST 데일리 리셋 패턴을 이식한다. 단, Snakeball은
 * 하트 시스템이 없으므로 STANDALONE — 어떤 heart 코드도 import 하지 않는다.
 *
 * 서버가 users/{uid}.coins/.gems 를 "사용 가능 잔액(spendable balance)"으로 권위 관리한다.
 * (iapVerification.js 는 여전히 coins/gems 를 additive 로 지급 — 그 값도 이 잔액에 반영됨.)
 *
 * 설계: docs/economy-migration-design.md — FINAL CORRECTIONS(FC1~FC7)가 authoritative.
 */

const { getFirestore, FieldValue } = require("firebase-admin/firestore");

// KST = UTC+9. (index.js isoWeekKeyKST 와 동일 기준)
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 마이그레이션 컷오프: 이 시각 "이전"에 생성된 users/{uid}(createdAt < CUTOFF)만
// localStorage 잔액 임포트 대상. 컷오프 이후 생성 doc(신규/치터가 새로 판 uid)은
// 서버 잔액만 신뢰 → 신규 uid 에 sb_coins 를 seed 해서 임포트로 무료 코인 받는
// 파세트(FC2/C2) 차단.
// ★★ 배포 직전 갱신 필수 ★★ 이 값을 "실제 배포 시각"으로 맞춰라. 값이 실제 배포보다
//   앞서면(=너무 이른 시각) 배포 지연 사이에 처음 접속한 기존 유저의 createdAt 이
//   컷오프보다 뒤가 되어 localStorage 잔액 임포트 대상에서 빠진다(잔액 증발).
const MIGRATION_CUTOFF_MS = Date.parse("2026-07-11T00:00:00Z");

/** Firestore Timestamp | epoch ms | ISO 문자열 → epoch ms (없으면 null). */
function toMillis(ts) {
  if (ts == null) return null;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts === "number") return ts;
  const p = Date.parse(ts);
  return Number.isNaN(p) ? null : p;
}

/**
 * 하드코딩 fallback 경제 설정. config/economy Firestore 문서가 있으면 그 값으로 얕게
 * 덮어쓴다(Mineta 패턴). ★ 클라이언트 index.html 의 SKINS/POWERUPS/MISSION_POOL/
 * DAILY_REWARDS 테이블과 반드시 동기화 유지 — 값이 어긋나면 표시가와 실제 청구가가
 * 달라진다(코드리뷰 동기화 체크).
 *
 * 값 출처(index.html):
 *   skin_costs      — SKINS[]        (index.html:632-648)
 *   powerup_costs   — POWERUPS[]     (index.html:650-654)
 *   mission_rewards — MISSION_POOL[] (index.html:664-673)
 *   daily_rewards   — DAILY_REWARDS[](index.html:676-678)
 *   revive base/step— reviveVia 'gem' 5 + revivesUsed*5 (index.html:3401)
 *   coin_per_score  — floor(finalScore/10) (index.html:3675, 3871) → 0.1
 *   crosspromo      — index.js CROSSPROMO_REWARDS {mineta:3, pow2:3}
 */
const DEFAULT_ECONOMY = {
  // ── 스킨 가격 (id → {coins?, gems?}) ──
  skin_costs: {
    white: {},
    mint: { coins: 300 },
    lime: { coins: 600 },
    coral: { coins: 900 },
    gold: { coins: 1800 },
    ruby: { coins: 2800 },
    galaxy: { gems: 30 },
    rainbow: { gems: 80 },
    beach: { coins: 800 },
    bball: { coins: 1200 },
    eightball: { coins: 1600 },
    melon: { coins: 2200 },
    eye: { gems: 25 },
    disco: { gems: 45 },
  },

  // ── 파워업 가격 (id → coins) ──
  powerup_costs: { headstart: 200, magnet: 250, shield: 300 },

  // ── 젬 부활 (per-run 카운터는 game_sessions 에 서버 저장 — FC4) ──
  revive_gem_base: 5,
  revive_gem_step: 5,

  // ── per-run 코인 획득 (submitScore fold-in) ──
  coin_per_score: 0.1,       // floor(score * 0.1) == 기존 floor(score/10)
  coins_per_sec_cap: 30,     // 초당 pickup 코인 상한 (안티치트)
  coin_earn_daily_cap: 5000, // 하루 per-run 코인 획득 상한

  // ── 미션 보상 (missionId → {coins?, gems?}) ──
  mission_rewards: {
    games3: { coins: 150 },
    score500: { coins: 200 },
    cubes100: { coins: 250 },
    coins300: { coins: 200 },
    mega3: { gems: 5 },
    combo15: { coins: 300 },
    balls40: { coins: 200 },
    revive1: { coins: 150 },
  },

  // ── 7일 로그인 스트릭 보상 ──
  daily_rewards: [
    { coins: 100 },
    { coins: 200 },
    { coins: 400 },
    { gems: 5 },
    { coins: 800 },
    { coins: 1500 },
    { coins: 2000, gems: 10 },
  ],

  // ── 크로스프로모 보상 (index.js CROSSPROMO_REWARDS 와 일치) ──
  crosspromo_rewards: { mineta: 3, pow2: 3 },

  // ── rewarded/케이던스 상한 ──
  rewarded_daily_cap: 20,       // double_coins 하루 상한
  revive_daily_cap: 10,         // 광고 부활 하루 상한
  rewarded_rate_limit_ms: 60000,

  // ── 마이그레이션 1회성 캡드 임포트 (FC2) ──
  import_cap_coins: 30000, // 최상위 SKU(coins.30000) 수준
  // 결제 젬은 서버 gems 에 additive 기록되므로 import_cap 은 F2P 가 localStorage 에 쌓을 수
  // 있는 무료 젬(daily/mission 수십 개 수준)만 커버하면 된다. 300 은 전 젬스킨(80+45+30+25)을
  // 사고도 남아 레거시 계정당 1회 민팅 여지가 큼 → 120 으로 축소(faucet blast 억제).
  import_cap_gems: 120,

  // IAP 지급 상한(방어).
  iap_max: 99999,
};

// ─── Remote config (60s TTL cache) ────────────────────────
const CONFIG_TTL_MS = 60 * 1000;
let _configCache = null;
let _configFetchedAt = 0;

/**
 * config/economy 를 60s TTL 캐시로 읽는다. 실패 시 마지막 정상 캐시 또는
 * DEFAULT_ECONOMY 로 폴백. 절대 throw 하지 않는다.
 */
async function getEconomyConfig() {
  const now = Date.now();
  if (_configCache && now - _configFetchedAt < CONFIG_TTL_MS) {
    return _configCache;
  }
  try {
    const doc = await getFirestore().collection("config").doc("economy").get();
    _configCache = doc.exists
      ? { ...DEFAULT_ECONOMY, ...doc.data() }
      : { ...DEFAULT_ECONOMY };
  } catch (err) {
    console.error("getEconomyConfig failed, using fallback:", err);
    _configCache = _configCache || { ...DEFAULT_ECONOMY };
  }
  _configFetchedAt = now;
  return _configCache;
}

// ─── KST 데일리 리셋 ───────────────────────────────────────

/** KST 기준 날짜 키(YYYY-MM-DD). */
function kstDateKey(date = new Date()) {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  return kst.toISOString().slice(0, 10);
}

/**
 * KST 자정 롤오버 시 0으로 되돌릴 데일리 카운터 업데이트를 반환.
 * 같은 날이면 {} (변경 없음).
 */
function getDailyResetUpdates(data) {
  const todayKey = kstDateKey();
  if (data.daily_reset_key === todayKey) return {};
  return {
    daily_reset_key: todayKey,
    daily_coin_earned: 0,
    daily_rewarded_count: 0,
    daily_revive_count: 0,
  };
}

// ─── 잔액 뮤테이터 (단일 트랜잭션 라이터) ──────────────────

/**
 * coins/gems 2-통화 트랜잭션 잔액 뮤테이터 — coins/gems 의 유일한 라이터.
 * 반드시 db.runTransaction 안에서 호출.
 *
 * @param {Transaction} tx
 * @param {DocumentReference} userRef
 * @param {object} data  트랜잭션 안 유저 스냅샷(호출자가 데일리 리셋을 미리 병합했을 수 있음).
 * @param {object} delta { coins=0, gems=0 } — >0 지급, <0 소비.
 * @param {object} opts
 *   - reason, source: 감사 문자열.
 *   - capField: 데일리 카운터 필드명. data[capField] 에서 capAmount(기본 max(0,coins)) 만큼 증가.
 *   - capAmount: capField 증가량(명시 시).
 *   - idempotencyToken: processed_ad_callbacks/{token} 재사용. 설정 시 dedup 문서를 여기서
 *     READ 하므로 호출자는 그 전에 어떤 write 도 큐잉하지 않아야 한다.
 * @returns {{coins:number, gems:number}} 새 잔액.
 * @throws INSUFFICIENT_COINS, INSUFFICIENT_GEMS, DUPLICATE_CALLBACK
 */
async function applyBalanceDelta(tx, userRef, data, delta = {}, opts = {}) {
  const { coins: dCoins = 0, gems: dGems = 0 } = delta;
  const {
    reason = "unknown",
    source = "unknown",
    capField = null,
    capAmount = null,
    idempotencyToken = null,
  } = opts;

  // 멱등 (이 호출 내 어떤 write 보다 먼저 read).
  let callbackRef = null;
  if (idempotencyToken) {
    callbackRef = userRef.collection("processed_ad_callbacks").doc(idempotencyToken);
    const callbackDoc = await tx.get(callbackRef);
    if (callbackDoc.exists) {
      throw new Error("DUPLICATE_CALLBACK");
    }
  }

  const curCoins = data.coins ?? 0;
  const curGems = data.gems ?? 0;
  const newCoins = curCoins + dCoins;
  const newGems = curGems + dGems;
  if (dCoins < 0 && newCoins < 0) throw new Error("INSUFFICIENT_COINS");
  if (dGems < 0 && newGems < 0) throw new Error("INSUFFICIENT_GEMS");

  const updates = { coins_updated_at: FieldValue.serverTimestamp() };
  if (dCoins !== 0) updates.coins = newCoins;
  if (dGems !== 0) updates.gems = newGems;

  if (capField) {
    const inc = capAmount != null ? capAmount : Math.max(0, dCoins);
    updates[capField] = (data[capField] ?? 0) + inc;
  }

  // set(merge) — 유저 doc 이 아직 없을 수 있는 경로(crosspromo/첫 런)도 안전하게 생성.
  tx.set(userRef, updates, { merge: true });

  if (idempotencyToken) {
    tx.set(callbackRef, {
      type: source,
      reason,
      delta_coins: dCoins,
      delta_gems: dGems,
      processed_at: FieldValue.serverTimestamp(),
    });
  }

  return { coins: newCoins, gems: newGems };
}

// ─── 유틸 ─────────────────────────────────────────────────

/** ACCOUNT_MIGRATED tombstone 가드 (coinSystem 내부용 — index.js 가 HttpsError 로 매핑). */
function assertNotMigrated(data) {
  if (data && data.migrated_to) throw new Error("ACCOUNT_MIGRATED");
}

const DEFAULT_OWNED = ["white"];
const DEFAULT_POWERUPS = { headstart: 0, magnet: 0, shield: 0 };

/** 임포트 owned_skins 정제: 유효 스킨 id 만, 중복 제거, white 항상 포함. */
function sanitizeOwnedSkins(list, cfg) {
  const valid = new Set(Object.keys(cfg.skin_costs || {}));
  const out = new Set(DEFAULT_OWNED);
  if (Array.isArray(list)) {
    for (const s of list) {
      if (typeof s === "string" && valid.has(s)) out.add(s);
    }
  }
  return [...out];
}

/** 클라이언트에 노출할 공개 설정(표시가 + canAfford 프리체크용, FC7). */
function buildConfigPublic(cfg) {
  return {
    skin_costs: cfg.skin_costs,
    powerup_costs: cfg.powerup_costs,
    revive_gem_base: cfg.revive_gem_base,
    revive_gem_step: cfg.revive_gem_step,
    mission_rewards: cfg.mission_rewards,
    daily_rewards: cfg.daily_rewards,
    coin_per_score: cfg.coin_per_score,
    coins_per_sec_cap: cfg.coins_per_sec_cap,
    crosspromo_rewards: cfg.crosspromo_rewards,
  };
}

/** 상태 응답 공통 조립(merged 유저 데이터 + config 기반 remaining). */
function buildStatusResponse(merged, cfg) {
  const rewardedCount = merged.daily_rewarded_count ?? 0;
  const reviveCount = merged.daily_revive_count ?? 0;
  return {
    coins: merged.coins ?? 0,
    gems: merged.gems ?? 0,
    owned_skins: merged.owned_skins || DEFAULT_OWNED,
    powerups: merged.powerups || { ...DEFAULT_POWERUPS },
    daily: merged.daily || { last: "", streak: 0 },
    missions: merged.missions || { date: "", claimed: {} },
    daily_coin_earned: merged.daily_coin_earned ?? 0,
    daily_coin_earn_remaining: Math.max(0, (cfg.coin_earn_daily_cap ?? 0) - (merged.daily_coin_earned ?? 0)),
    daily_rewarded_remaining: Math.max(0, (cfg.rewarded_daily_cap ?? 0) - rewardedCount),
    daily_revive_remaining: Math.max(0, (cfg.revive_daily_cap ?? 0) - reviveCount),
    config_public: buildConfigPublic(cfg),
  };
}

// ─── 핸들러 로직 (index.js 가 onCall 로 래핑) ──────────────

/**
 * getEconomyStatus — lazy-init + KST 데일리 리셋 + 1회성 캡드 임포트(FC2).
 *
 * 임포트 게이트: users/{uid} doc 이 마이그레이션 이전부터 존재(createdAt/bestScore/
 * recoveryCode 중 하나 보유)할 때만 클라 localStorage 잔액을 min(client, cap) 로 임포트.
 * 신규 doc 은 0/0 — 절대 클라 잔액을 임포트하지 않는다(신규 uid seed 파세트 차단).
 * server IAP total 과 max() 하지 않는다(그 값은 lifetime-grant total 이라 이미-소비분을 재발행).
 *
 * @param {string} uid
 * @param {object} clientImport { coins?, gems?, owned_skins? } — 임포트 게이트에서만 사용.
 */
async function getEconomyStatus(uid, clientImport = {}) {
  const cfg = await getEconomyConfig();
  const db = getFirestore();
  const userRef = db.collection("users").doc(uid);

  const merged = await db.runTransaction(async (tx) => {
    const doc = await tx.get(userRef);
    const data = doc.exists ? doc.data() : {};
    assertNotMigrated(data);

    const updates = {};

    // 1회성 임포트 / 초기화.
    // ★ 기존 서버 coins/gems 는 어떤 분기에서도 절대 0 으로 덮지 않는다 — 그 값은
    //   IAP 로 결제된 잔액일 수 있다(iapVerification 이 additive 로 기록). 결제분 보존.
    if (!data.economy_initialized) {
      const existingCoins = Number(data.coins) || 0;
      const existingGems = Number(data.gems) || 0;
      // 임포트 자격: 마이그레이션 컷오프 "이전"에 생성된 진짜 레거시 계정만.
      // createdAt 존재만 보는 게이트는 치터가 generateRecoveryCode 등으로 createdAt 을
      // 만들어 우회 가능 → 컷오프 타임스탬프 비교로 강화(FC2/C2).
      // 자격 판정. createdAt < 컷오프가 깨끗한 신호지만, submitScore 는 users doc 에
      // name/bestScore 만 쓰고 createdAt 을 남기지 않는다 → 점수만 제출해온 진짜 레거시
      // 유저가 createdAt 없이 존재한다. createdAt-단독 게이트는 이들을 "신규"로 오판해
      // localStorage 잔액을 버리고(이후 클라 down-reconcile 이 0 으로 정리) 전 유저의
      // 코인/젬/스킨을 증발시킨다. 따라서 createdAt 없이도 레거시 증거(bestScore/
      // recoveryCode)를 지닌 pre-existing doc 은 임포트 허용. 임포트는 1회성 + 캡드라,
      // 최악의 남용도 "신규 설치가 캡까지 1회 임포트"(비환금성 코인)로 제한된다.
      const createdMs = toMillis(data.createdAt);
      const preCutoff = createdMs != null && createdMs < MIGRATION_CUTOFF_MS;
      const legacyNoCreatedAt =
        createdMs == null && (data.bestScore != null || data.recoveryCode != null);
      const importEligible = preCutoff || legacyNoCreatedAt;
      if (importEligible) {
        const cCoins = Number(clientImport.coins);
        const cGems = Number(clientImport.gems);
        const impCoins = Number.isFinite(cCoins) ? Math.max(0, Math.floor(cCoins)) : 0;
        const impGems = Number.isFinite(cGems) ? Math.max(0, Math.floor(cGems)) : 0;
        // FC2 rule2: 기존 서버 coins/gems 와 max() 하지 않는다. 그 값은 lifetime-grant total
        // (IAP 가 additive 로 기록, 소비로 감소하지 않는 스냅샷일 수 있음)이라 max 로 바닥을
        // 깔면 결제자에게 "이미 소비한 IAP 코인"을 재발행 + import_cap 우회가 된다. 클라의
        // post-spend localStorage 잔액을 캡드 신뢰한다(재설치-결제자가 구기기 localStorage 만
        // 잔액을 가진 경우 손실은 FC2 가 수용한 pre-existing risk — minting 으로 고치지 않는다).
        updates.coins = Math.min(impCoins, cfg.import_cap_coins ?? 0);
        updates.gems = Math.min(impGems, cfg.import_cap_gems ?? 0);
        updates.owned_skins = sanitizeOwnedSkins(clientImport.owned_skins, cfg);
      } else {
        // 컷오프 이후 생성 / createdAt 없음 → 클라 잔액 미신뢰, 기존 서버 잔액만 보존.
        updates.coins = existingCoins;
        updates.gems = existingGems;
        updates.owned_skins = data.owned_skins || [...DEFAULT_OWNED];
      }
      updates.powerups = data.powerups || { ...DEFAULT_POWERUPS };
      updates.economy_initialized = true;
      updates.coins_updated_at = FieldValue.serverTimestamp();
    }

    // KST 데일리 리셋.
    Object.assign(updates, getDailyResetUpdates(data));

    if (Object.keys(updates).length > 0) {
      tx.set(userRef, updates, { merge: true });
    }
    return { ...data, ...updates };
  });

  return buildStatusResponse(merged, cfg);
}

/**
 * spendCurrency — 서버 권위 소비. 비용은 config 에서만 읽는다(클라 금액 미신뢰).
 *   reason 'skin'    → itemId 스킨 구매, owned_skins 에 추가(이미 보유 시 거부).
 *   reason 'powerup' → itemId 파워업 카운트 +1.
 *   reason 'revive'  → sessionToken 필요. 비용 = base + step * (세션 서버 카운터)(FC4).
 *
 * @param {string} uid
 * @param {object} params { reason, itemId?, sessionToken? }
 */
async function spendCurrency(uid, params = {}) {
  const { reason, itemId, sessionToken } = params;
  const cfg = await getEconomyConfig();
  const db = getFirestore();
  const userRef = db.collection("users").doc(uid);

  if (reason === "skin") {
    const cost = cfg.skin_costs ? cfg.skin_costs[itemId] : undefined;
    if (!cost) throw new Error("UNKNOWN_SKIN");
    return db.runTransaction(async (tx) => {
      const doc = await tx.get(userRef);
      if (!doc.exists) throw new Error("USER_NOT_FOUND");
      const data = doc.data();
      assertNotMigrated(data);

      const owned = data.owned_skins || DEFAULT_OWNED;
      if (owned.includes(itemId)) throw new Error("ALREADY_OWNED");

      const bal = await applyBalanceDelta(tx, userRef, data,
        { coins: -(cost.coins || 0), gems: -(cost.gems || 0) },
        { reason: "skin", source: itemId });

      const newOwned = [...owned, itemId];
      tx.set(userRef, { owned_skins: newOwned }, { merge: true });
      return { coins: bal.coins, gems: bal.gems, owned_skins: newOwned };
    });
  }

  if (reason === "powerup") {
    const cost = cfg.powerup_costs ? cfg.powerup_costs[itemId] : undefined;
    if (cost == null) throw new Error("UNKNOWN_POWERUP");
    return db.runTransaction(async (tx) => {
      const doc = await tx.get(userRef);
      if (!doc.exists) throw new Error("USER_NOT_FOUND");
      const data = doc.data();
      assertNotMigrated(data);

      const bal = await applyBalanceDelta(tx, userRef, data,
        { coins: -cost },
        { reason: "powerup", source: itemId });

      const powerups = { ...DEFAULT_POWERUPS, ...(data.powerups || {}) };
      powerups[itemId] = (powerups[itemId] || 0) + 1;
      tx.set(userRef, { powerups }, { merge: true });
      return { coins: bal.coins, gems: bal.gems, powerups };
    });
  }

  if (reason === "revive") {
    if (!sessionToken || typeof sessionToken !== "string") {
      throw new Error("SESSION_NOT_FOUND");
    }
    const sessionRef = db.collection("game_sessions").doc(sessionToken);
    return db.runTransaction(async (tx) => {
      const [sDoc, uDoc] = await Promise.all([tx.get(sessionRef), tx.get(userRef)]);
      if (!sDoc.exists) throw new Error("SESSION_NOT_FOUND");
      if (sDoc.data().uid !== uid) throw new Error("SESSION_NOT_OWNED");
      if (!uDoc.exists) throw new Error("USER_NOT_FOUND");
      const data = uDoc.data();
      assertNotMigrated(data);

      const reviveCount = sDoc.data().reviveCount || 0;
      const gemCost = (cfg.revive_gem_base ?? 0) + (cfg.revive_gem_step ?? 0) * reviveCount;

      const bal = await applyBalanceDelta(tx, userRef, data,
        { gems: -gemCost },
        { reason: "revive", source: "revive" });

      tx.update(sessionRef, { reviveCount: reviveCount + 1 });
      return { coins: bal.coins, gems: bal.gems, revive_count: reviveCount + 1, gem_cost: gemCost };
    });
  }

  throw new Error("INVALID_SPEND_REASON");
}

/**
 * rewardFromAd — bounded-trust rewarded 처리(SSV 없음). adToken 멱등.
 *   context 'double_coins' → 서버 기록 last_run_base_coins 만큼 지급.
 *                            게이트: 멱등 + rate-limit + rewarded_daily_cap.
 *   context 'revive'       → 코인 이동 없이 impression 만 기록.
 *                            게이트: 멱등 + revive_daily_cap. (rate-limit/보상캡 미적용 —
 *                            런 도중 부활을 막지 않기 위해, 코인 미지급이라 남용가치 낮음.)
 *
 * @param {string} uid
 * @param {string} adToken 매 호출 고유(클라 crypto.randomUUID).
 * @param {string} context 'double_coins' | 'revive'
 */
async function rewardFromAd(uid, adToken, context) {
  if (!adToken || typeof adToken !== "string") throw new Error("INVALID_CONTEXT");
  if (context !== "double_coins" && context !== "revive") throw new Error("INVALID_CONTEXT");

  const cfg = await getEconomyConfig();
  const db = getFirestore();
  const userRef = db.collection("users").doc(uid);
  const rateLimitMs = cfg.rewarded_rate_limit_ms ?? 0;

  return db.runTransaction(async (tx) => {
    const callbackRef = userRef.collection("processed_ad_callbacks").doc(adToken);
    const [userDoc, callbackDoc] = await Promise.all([tx.get(userRef), tx.get(callbackRef)]);
    if (!userDoc.exists) throw new Error("USER_NOT_FOUND");
    const data = userDoc.data();
    assertNotMigrated(data);
    if (callbackDoc.exists) throw new Error("DUPLICATE_CALLBACK");

    const resets = getDailyResetUpdates(data);
    const post = { ...data, ...resets };

    if (context === "double_coins") {
      // rate-limit (Pow2 checkUserRateLimit 패턴).
      const lastAd = post.last_ad_reward;
      if (lastAd && rateLimitMs > 0) {
        const lastMs = lastAd.toMillis ? lastAd.toMillis() : new Date(lastAd).getTime();
        if (Date.now() - lastMs < rateLimitMs) throw new Error("RATE_LIMITED");
      }
      if ((post.daily_rewarded_count ?? 0) >= (cfg.rewarded_daily_cap ?? 0)) {
        throw new Error("REWARDED_LIMIT_REACHED");
      }
      // 런당 1회만 더블코인 청구 가능 — grantRunCoins 가 새 런마다 last_run_doubled=false 로
      // 리셋. 같은 런의 last_run_base_coins 를 여러 광고로 반복 지급하는 leak 차단.
      if (post.last_run_doubled) throw new Error("ALREADY_DOUBLED");

      const base = Math.max(0, Math.floor(post.last_run_base_coins ?? 0));
      const bal = await applyBalanceDelta(tx, userRef, post,
        { coins: base },
        { reason: "double_coins", source: "rewarded", capField: "daily_rewarded_count", capAmount: 1 });

      // 데일리 리셋 나머지 + last_ad_reward + last_run_doubled. (daily_rewarded_count 는 applyBalanceDelta 소유.)
      const { daily_rewarded_count: _drc, ...restResets } = resets;
      tx.set(userRef, { ...restResets, last_ad_reward: FieldValue.serverTimestamp(), last_run_doubled: true }, { merge: true });
      tx.set(callbackRef, {
        type: "double_coins",
        granted: base,
        processed_at: FieldValue.serverTimestamp(),
      });
      return { coins: bal.coins, gems: bal.gems, granted: base };
    }

    // context === 'revive' — 코인 이동 없음, impression + revive 카운트만.
    if ((post.daily_revive_count ?? 0) >= (cfg.revive_daily_cap ?? 0)) {
      throw new Error("REVIVE_LIMIT_REACHED");
    }
    tx.set(userRef, {
      ...resets,
      daily_revive_count: (post.daily_revive_count ?? 0) + 1,
    }, { merge: true });
    tx.set(callbackRef, {
      type: "revive",
      processed_at: FieldValue.serverTimestamp(),
    });
    return { coins: post.coins ?? 0, gems: post.gems ?? 0, granted: 0 };
  });
}

/**
 * claimDaily — 서버가 daily.last + KST 로 스트릭 계산. KST 하루 1회 멱등(FC3).
 * 클라 진행 추적 불필요.
 */
async function claimDaily(uid) {
  const cfg = await getEconomyConfig();
  const db = getFirestore();
  const userRef = db.collection("users").doc(uid);
  const rewards = cfg.daily_rewards || [];

  const todayKey = kstDateKey();
  const yesterdayKey = kstDateKey(new Date(Date.now() - 86400000));

  return db.runTransaction(async (tx) => {
    const doc = await tx.get(userRef);
    if (!doc.exists) throw new Error("USER_NOT_FOUND");
    const data = doc.data();
    assertNotMigrated(data);

    const daily = data.daily || { last: "", streak: 0 };
    if (daily.last === todayKey) throw new Error("ALREADY_CLAIMED");

    const streak = daily.last === yesterdayKey ? Math.min((daily.streak || 0) + 1, 7) : 1;
    const reward = rewards[(streak - 1) % 7] || {};

    const bal = await applyBalanceDelta(tx, userRef, data,
      { coins: reward.coins || 0, gems: reward.gems || 0 },
      { reason: "daily", source: "daily" });

    const newDaily = { last: todayKey, streak };
    tx.set(userRef, { daily: newDaily }, { merge: true });
    return { coins: bal.coins, gems: bal.gems, daily: newDaily, reward };
  });
}

/**
 * claimMission — missionId+KST날짜 로 멱등. 보상은 config mission_rewards 에서.
 * ⚠️ 진행도(progress)는 검증하지 않는다(FC3 — 진행은 클라, claim 만 서버 멱등).
 */
async function claimMission(uid, missionId) {
  const cfg = await getEconomyConfig();
  const db = getFirestore();
  const userRef = db.collection("users").doc(uid);

  const reward = cfg.mission_rewards ? cfg.mission_rewards[missionId] : undefined;
  if (!reward) throw new Error("UNKNOWN_MISSION");

  const todayKey = kstDateKey();

  return db.runTransaction(async (tx) => {
    const doc = await tx.get(userRef);
    if (!doc.exists) throw new Error("USER_NOT_FOUND");
    const data = doc.data();
    assertNotMigrated(data);

    const missions = (data.missions && data.missions.date === todayKey)
      ? { date: todayKey, claimed: { ...(data.missions.claimed || {}) } }
      : { date: todayKey, claimed: {} };
    if (missions.claimed[missionId]) throw new Error("ALREADY_CLAIMED");
    missions.claimed[missionId] = true;

    const bal = await applyBalanceDelta(tx, userRef, data,
      { coins: reward.coins || 0, gems: reward.gems || 0 },
      { reason: "mission", source: missionId });

    tx.set(userRef, { missions }, { merge: true });
    return { coins: bal.coins, gems: bal.gems, missions };
  });
}

/**
 * grantRunCoins — submitScore 에 fold-in 되는 per-run 코인 획득.
 * grant = floor(validScore * coin_per_score) + min(pickupCoins, coins_per_sec_cap * elapsedSec),
 * coin_earn_daily_cap 로 상한. 서버 계산 last_run_base_coins 를 기록(double_coins 재읽기용).
 * 세션당 1회만 호출됨(submitScore 가 sessionToken 멱등).
 *
 * @returns {{coins:number, earned:number}}
 */
async function grantRunCoins(uid, validScore, clientPickupCoins, elapsedSeconds) {
  const cfg = await getEconomyConfig();
  const db = getFirestore();
  const userRef = db.collection("users").doc(uid);

  const coinPerScore = cfg.coin_per_score ?? 0.1;
  const coinsPerSecCap = cfg.coins_per_sec_cap ?? 30;
  const earnDailyCap = cfg.coin_earn_daily_cap ?? 5000;

  const scoreCoins = Math.floor(Math.max(0, validScore) * coinPerScore);
  const rawPickup = Number.isFinite(clientPickupCoins) ? Math.max(0, Math.floor(clientPickupCoins)) : 0;
  const pickupCap = Math.floor(coinsPerSecCap * Math.max(0, elapsedSeconds));
  const baseEarn = scoreCoins + Math.min(rawPickup, pickupCap);

  return db.runTransaction(async (tx) => {
    const doc = await tx.get(userRef);
    const data = doc.exists ? doc.data() : {};
    assertNotMigrated(data);

    const resets = getDailyResetUpdates(data);
    const post = { ...data, ...resets };
    const earnedSoFar = post.daily_coin_earned ?? 0;
    const remaining = Math.max(0, earnDailyCap - earnedSoFar);
    const earned = Math.min(baseEarn, remaining);

    const bal = await applyBalanceDelta(tx, userRef, post,
      { coins: earned },
      { reason: "run_earn", source: "run", capField: "daily_coin_earned", capAmount: earned });

    // 데일리 리셋 나머지(daily_coin_earned 제외 — applyBalanceDelta 소유) + last_run_base_coins.
    // last_run_doubled=false: 새 런의 더블코인 청구를 1회 허용(런당 재청구 방지, 아래 rewardFromAd).
    const { daily_coin_earned: _dce, ...restResets } = resets;
    tx.set(userRef, { ...restResets, last_run_base_coins: earned, last_run_doubled: false }, { merge: true });
    return { coins: bal.coins, earned };
  });
}

module.exports = {
  DEFAULT_ECONOMY,
  KST_OFFSET_MS,
  getEconomyConfig,
  kstDateKey,
  getDailyResetUpdates,
  applyBalanceDelta,
  buildConfigPublic,
  buildStatusResponse,
  getEconomyStatus,
  spendCurrency,
  rewardFromAd,
  claimDaily,
  claimMission,
  grantRunCoins,
};
