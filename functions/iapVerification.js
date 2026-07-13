/**
 * iapVerification.js — IAP 영수증 서버 검증 + 상품 지급 (Snakeball)
 *
 * MinefieldSweeper의 검증 로직을 엔들리스 러너용 소비성(consumable) 상품에 맞게 이식.
 *  - iOS:     App Store Server API v2 (JWT, bid claim, PEM 정규화, Sandbox fallback)
 *  - Android: Google Play Developer API v3 (purchaseToken, purchaseState=0)
 *  - Toss:    mTLS 클라이언트 인증서로 주문 상태 조회 (sku fail-closed 매칭)
 *
 * 멱등성: 전역 top-level processed_transactions/{platform}:{txId} 문서를
 *         Firestore 트랜잭션 안에서 체크+생성 (네트워크 전체 1회성 redemption).
 *
 * 지급 금액은 절대 클라이언트에서 받지 않는다. 서버 권위 PRODUCTS 맵에서 조회.
 */

const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { SignJWT, importPKCS8 } = require("jose");
const { GoogleAuth } = require("google-auth-library");
const https = require("https");

// 번들/패키지 식별자 — iOS/Android 동일.
const BUNDLE_ID = "studio.hodgepodge.snakeball";

/**
 * 테스터 화이트리스트 (fail-closed). config/test_accounts 문서의 uids 배열에 든
 * caller만 비-Production(Sandbox/Xcode/라이선스 테스트) 결제로 실상품을 받을 수 있다.
 * config/* 는 firestore.rules에서 client read/write 전면 차단(Admin SDK 전용)이라
 * 안전하며, 테스터 추가/삭제는 콘솔에서 문서만 고치면 된다(재배포 불필요).
 * 조회 실패는 fail-closed(=테스터 아님)로 처리.
 */
async function isTestAccount(db, uid) {
  try {
    const doc = await db.collection("config").doc("test_accounts").get();
    if (!doc.exists) return false;
    const uids = doc.data().uids;
    return Array.isArray(uids) && uids.includes(uid);
  } catch (e) {
    return false;
  }
}

// ─── 서버 권위 상품 정의 ─────────────────────────────────────
// SKU(productId) → 지급량. 이 맵이 단일 진실 소스다. 클라이언트가 보낸
// grant 금액은 무시되며, 여기 정의된 amount만 지급된다 (index.html STORE와 동기 유지).
const PRODUCTS = {
  coins_small: { coins: 5000 },
  coins_big:   { coins: 30000 },
  gems_small:  { gems: 50 },
  gems_big:    { gems: 200 },
};

// Toss 콘솔 자동생성 SKU(ait.xxx) → 내부 상품 id(PRODUCTS 키) 역참조 맵.
// ⚠️ Toss 미출시 — 콘솔에서 SKU 발급 후 채운다(credential/config). 비어 있으면 그 상품은
//    지급 불가(fail-closed: verifyAndFulfill 이 INVALID_PRODUCT throw). 클라 index.html 의
//    TOSS_SKU_BY_ID(내부→sku)와 **같은 커밋에서 함께** 채워야 드리프트(결제됨/미지급)가 없다.
// 보안: 지급 tier 는 클라가 주장한 productId 가 아니라 Toss 가 검증해준 실제 sku 로만 도출한다
//       (LL40 rule7 "derive tier from the order"). → "싼 결제로 비싼 상품" 원천 차단 +
//       앱이 죽어 getPendingOrders 가 orderId/sku 만 줘도 복구 가능.
const TOSS_SKU_TO_INTERNAL = {
  // 'ait.xxxxxxxx': 'coins_small',
  // 'ait.xxxxxxxx': 'coins_big',
  // 'ait.xxxxxxxx': 'gems_small',
  // 'ait.xxxxxxxx': 'gems_big',
};

// ─── App Store Server API v2 ───────────────────────────────

/**
 * PEM 키 정규화: Firebase Secret에서 가져온 키의 이스케이프된 줄바꿈(\n literal)을
 * 실제 줄바꿈으로 변환하고, 헤더가 없으면 PKCS8 마커로 감싼다.
 */
function normalizePEM(pem) {
  if (!pem) return pem;
  let normalized = pem.replace(/\\n/g, "\n");
  if (!normalized.includes("-----BEGIN")) {
    normalized = `-----BEGIN PRIVATE KEY-----\n${normalized.trim()}\n-----END PRIVATE KEY-----`;
  }
  return normalized;
}

/** App Store Server API용 ES256 JWT 생성 (bid claim = bundleId). */
async function generateAppStoreJWT(keyId, issuerId, privateKeyPEM, bundleId) {
  const normalizedPEM = normalizePEM(privateKeyPEM);
  const privateKey = await importPKCS8(normalizedPEM, "ES256");
  return new SignJWT({ bid: bundleId })
    .setProtectedHeader({ alg: "ES256", kid: keyId, typ: "JWT" })
    .setIssuer(issuerId)
    .setIssuedAt()
    .setExpirationTime("1h")
    .setAudience("appstoreconnect-v1")
    .sign(privateKey);
}

/**
 * App Store Server API v2로 트랜잭션 정보 조회.
 * Production에서 404/401이면 Sandbox 엔드포인트로 재시도 (TestFlight/Sandbox 영수증).
 * @returns {Object} { transactionId, originalTransactionId, productId, environment, type }
 */
async function verifyWithAppStore(transactionId, keyId, issuerId, privateKey, environment, bundleId) {
  const jwt = await generateAppStoreJWT(keyId, issuerId, privateKey, bundleId);

  const baseUrl = environment === "Sandbox"
    ? "https://api.storekit-sandbox.itunes.apple.com"
    : "https://api.storekit.itunes.apple.com";
  const url = `${baseUrl}/inApps/v1/transactions/${transactionId}`;

  const response = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`App Store API error (${response.status}): env=${environment}, txId=${transactionId}, body=${errorText}`);
    // Sandbox 트랜잭션은 Production 엔드포인트에서 404/401을 반환할 수 있다 → Sandbox 재시도.
    if ((response.status === 404 || response.status === 401) && environment !== "Sandbox") {
      console.log(`Transaction ${response.status} in Production, trying Sandbox...`);
      return verifyWithAppStore(transactionId, keyId, issuerId, privateKey, "Sandbox", bundleId);
    }
    throw new Error(`APP_STORE_VERIFICATION_FAILED: ${response.status}`);
  }

  const data = await response.json();
  // signedTransactionInfo는 JWS — 페이로드 디코딩 (서명은 Apple이 보장).
  const signedInfo = data.signedTransactionInfo;
  const payload = JSON.parse(
    Buffer.from(signedInfo.split(".")[1], "base64url").toString("utf-8")
  );

  return {
    transactionId: String(payload.transactionId),
    originalTransactionId: String(payload.originalTransactionId),
    productId: payload.productId,
    environment: payload.environment, // "Production" | "Sandbox"
    type: payload.type,
    // 환불/취소된 트랜잭션은 revocationDate(ms)가 실린다. 지급부에서 거부(환불-후-재상환
    // 어뷰징 차단). LL40 line85-86 / 감사 L1. (ASSN v2 클로백 미연동이라 사후 회수는 별도.)
    revocationDate: payload.revocationDate ?? null,
  };
}

// ─── Google Play Developer API ─────────────────────────────

/**
 * Google Play Developer API v3로 구매 검증.
 * @param {string} purchaseToken - Google Play purchaseToken
 * @param {string} productId     - 상품 ID (= SKU)
 * @param {string} packageName   - Android 패키지명
 * @param {string} serviceAccountJson - Service Account JSON (Firebase Secret)
 */
async function verifyWithGooglePlay(purchaseToken, productId, packageName, serviceAccountJson) {
  const credentials = JSON.parse(serviceAccountJson);
  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });
  const client = await auth.getClient();
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/products/${productId}/tokens/${purchaseToken}`;

  const response = await client.request({ url });
  const data = response.data;

  // purchaseState: 0 = purchased, 1 = canceled, 2 = pending
  if (data.purchaseState !== 0) {
    throw new Error(`GOOGLE_PLAY_INVALID_STATE: purchaseState=${data.purchaseState}`);
  }

  return {
    transactionId: data.orderId || purchaseToken,
    productId,
    purchaseToken,
    environment: data.purchaseType === 0 ? "Sandbox" : "Production",
  };
}

/**
 * Google Play 소비성 구매 서버 consume.
 * 서버가 지급을 확정한 뒤 직접 :consume 를 호출한다(클라 consume 에 의존 금지).
 * Google 은 3일 내 미소비 소비성 구매를 자동 환불/회수하므로, 서버 consume 로
 *   (a) 정상 유저의 합법 결제가 3일 후 자동취소되는 것
 *   (b) consume 를 생략하고 자동환불받아 무료 코인을 얻는 어뷰징
 * 을 함께 막는다.
 */
async function consumeGooglePlayPurchase(purchaseToken, productId, packageName, serviceAccountJson) {
  const credentials = JSON.parse(serviceAccountJson);
  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });
  const client = await auth.getClient();
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/products/${productId}/tokens/${purchaseToken}:consume`;
  await client.request({ url, method: "POST" });
}

// ─── Toss IAP 검증 (mTLS) ──────────────────────────────────

/**
 * Firebase Secret 저장 시 PEM 줄바꿈이 사라지거나 \n literal로 escape되는
 * 경우를 정상 multi-line 형태로 복원.
 */
function restorePEM(pem) {
  if (!pem) return pem;
  const normalized = pem.replace(/\\n/g, "\n");
  const beginMatch = normalized.match(/-----BEGIN ([A-Z0-9 ]+)-----/);
  if (!beginMatch) return normalized;
  const header = beginMatch[0];
  const keyType = beginMatch[1];
  const footer = `-----END ${keyType}-----`;
  const beginIdx = normalized.indexOf(header);
  const endIdx = normalized.indexOf(footer, beginIdx + header.length);
  if (endIdx === -1) return normalized;
  const base64 = normalized
    .slice(beginIdx + header.length, endIdx)
    .replace(/\s/g, "");
  const wrapped = base64.match(/.{1,64}/g).join("\n");
  return `${header}\n${wrapped}\n${footer}`;
}

/**
 * mTLS 클라이언트 인증으로 Toss API에 POST 요청.
 * Node 글로벌 fetch는 client cert/key를 직접 지원하지 않아 https 모듈 사용.
 */
function httpsPostWithMtls(urlString, body, cert, key) {
  const url = new URL(urlString);
  const payload = JSON.stringify(body);
  const options = {
    method: "POST",
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname + url.search,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    },
    cert,
    key,
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Toss IAP 주문 상태 조회로 orderId 검증.
 * Endpoint: POST {baseUrl}/api-partner/v1/apps-in-toss/order/get-order-status
 * 인증: mTLS (Toss 콘솔 > mTLS 인증서에서 발급한 cert/key 페어).
 *
 * Fail-closed: 응답의 sku가 없거나 주문이 PURCHASED/PAYMENT_COMPLETED 상태가 아니면 거부.
 * 반환은 Toss가 검증해준 **실제 sku** — 지급 tier 는 호출자(verifyAndFulfill)가 이 sku 를
 * TOSS_SKU_TO_INTERNAL 로 역참조해 도출한다(클라 주장 productId 불신, LL40 rule7).
 */
async function verifyWithToss(orderId, tossBaseUrl, mtlsCert, mtlsKey) {
  if (!tossBaseUrl || !mtlsCert || !mtlsKey) {
    throw new Error("MISSING_TOSS_CREDENTIALS");
  }
  const cert = restorePEM(mtlsCert);
  const key = restorePEM(mtlsKey);

  const url = `${tossBaseUrl.replace(/\/$/, "")}/api-partner/v1/apps-in-toss/order/get-order-status`;
  let response;
  try {
    response = await httpsPostWithMtls(url, { orderId: String(orderId) }, cert, key);
  } catch (e) {
    console.error(`Toss IAP API request failed: orderId=${orderId}, error=${e.message}`);
    throw new Error(`TOSS_VERIFICATION_FAILED: ${e.code || "REQUEST_FAILED"}`);
  }

  if (response.status < 200 || response.status >= 300) {
    console.error(`Toss IAP API error (${response.status}): orderId=${orderId}, body=${response.text}`);
    throw new Error(`TOSS_VERIFICATION_FAILED: ${response.status}`);
  }

  let data;
  try {
    data = JSON.parse(response.text);
  } catch (e) {
    console.error(`Toss IAP API non-JSON response: orderId=${orderId}, body=${response.text}`);
    throw new Error("TOSS_VERIFICATION_FAILED: INVALID_JSON");
  }

  if (data.resultType !== "SUCCESS") {
    const err = data.error || {};
    console.error(`Toss IAP non-success resultType: orderId=${orderId}, resultType=${data.resultType}, error=${JSON.stringify(err)}`);
    throw new Error(`TOSS_VERIFICATION_FAILED: ${data.resultType}${err.errorCode ? `:${err.errorCode}` : ""}`);
  }

  const orderInfo = data.success || {};
  console.log(`Toss IAP success: orderId=${orderId}, status=${orderInfo.status}, sku=${orderInfo.sku}`);

  const status = orderInfo.status;
  if (status !== "PURCHASED" && status !== "PAYMENT_COMPLETED") {
    console.error(`Toss order in non-grant state: orderId=${orderId}, status=${status}`);
    throw new Error(`TOSS_INVALID_STATE: ${status}`);
  }

  // Fail-closed: sku 가 없으면 지급 tier 를 도출할 수 없으므로 거부.
  if (!orderInfo.sku) {
    console.error(`Toss order-status missing sku: orderId=${orderId}`);
    throw new Error("PRODUCT_ID_MISMATCH");
  }

  return {
    transactionId: String(orderId),
    originalTransactionId: String(orderId),
    sku: String(orderInfo.sku),   // 검증된 실제 sku — 호출자가 TOSS_SKU_TO_INTERNAL 로 매핑.
    environment: "Production",
  };
}

// ─── 메인 검증 + 지급 로직 ──────────────────────────────────

/**
 * IAP 검증 후 상품 지급.
 * @param {string} uid           - Firebase UID
 * @param {string} platform      - 'ios' | 'android' | 'toss'
 * @param {string} transactionId - 플랫폼별 트랜잭션 식별자
 *                                  (iOS: transaction.id, Android: purchaseToken, Toss: orderId)
 * @param {string} productId     - 구매한 상품 ID (= SKU)
 * @param {Object} secrets       - 플랫폼별 시크릿 묶음
 * @returns {Object} { success:true, productId, grant:{coins?,gems?}, already_processed }
 */
async function verifyAndFulfill(uid, platform, transactionId, productId, secrets) {
  const db = getFirestore();
  const userRef = db.collection("users").doc(uid);

  // 1. 전역 멱등성 키. 영수증 검증은 "이 트랜잭션이 실제 결제됨"만 보장할 뿐
  // "호출자가 소유함"을 보장하지 않는다. user별로 키를 잡으면 같은 영수증을
  // 무한 익명 계정에서 재사용할 수 있으므로 {platform}:{txId} 전역 원장으로 잠근다.
  const dedupKey = `${platform}:${String(transactionId)}`;
  const txRef = db.collection("processed_transactions").doc(dedupKey);

  const priorDoc = await txRef.get();
  if (priorDoc.exists) {
    // M2(defense-in-depth): 원장에 **저장된** product_id/grant 를 echo — 클라가 주장한
    // productId 로 재조회하지 않는다(재검증 없는 early-return 에서 클라 주장 상품을
    // 지급액으로 되돌려주면 잠재적 비싼상품 echo). 실제로 처리된 값만 반환.
    const prior = priorDoc.data() || {};
    console.log(`Transaction already processed (key=${dedupKey})`);
    return { success: true, productId: prior.product_id, grant: prior.grant, already_processed: true };
  }

  // 2. 플랫폼별 영수증 검증. 지급 상품 tier(effectiveProductId)는 iOS/Android 는 검증된
  //    productId 로, Toss 는 검증된 sku 역참조로 도출한다(클라 주장 productId 불신).
  let verifiedData;
  let effectiveProductId = productId;
  if (platform === "ios") {
    if (!PRODUCTS[productId]) throw new Error("INVALID_PRODUCT");
    if (!secrets.keyId || !secrets.issuerId || !secrets.privateKey) {
      throw new Error("MISSING_APP_STORE_CREDENTIALS");
    }
    verifiedData = await verifyWithAppStore(
      transactionId, secrets.keyId, secrets.issuerId, secrets.privateKey, "Production", secrets.bundleId
    );
    // 검증된 productId가 클라이언트 주장과 일치해야 한다 (싼 영수증으로 비싼 상품 차단).
    if (verifiedData.productId !== productId) {
      console.error(`Product ID mismatch (ios): verified=${verifiedData.productId}, claimed=${productId}`);
      throw new Error("PRODUCT_ID_MISMATCH");
    }
    // 환불/취소된 트랜잭션 거부 (구매→환불승인→재검증 경로에서 verify 통과 방지). LL40 / 감사 L1.
    if (verifiedData.revocationDate) {
      console.error(`Rejecting revoked (refunded) transaction: uid=${uid} txId=${transactionId} revocationDate=${verifiedData.revocationDate}`);
      throw new Error("TRANSACTION_REVOKED");
    }
  } else if (platform === "android") {
    if (!PRODUCTS[productId]) throw new Error("INVALID_PRODUCT");
    const packageName = secrets.androidPackageName || BUNDLE_ID;
    if (!secrets.googlePlayServiceAccount) {
      throw new Error("MISSING_GOOGLE_PLAY_CREDENTIALS");
    }
    verifiedData = await verifyWithGooglePlay(
      transactionId, productId, packageName, secrets.googlePlayServiceAccount
    );
    if (verifiedData.productId !== productId) {
      console.error(`Product ID mismatch (android): verified=${verifiedData.productId}, claimed=${productId}`);
      throw new Error("PRODUCT_ID_MISMATCH");
    }
  } else if (platform === "toss") {
    if (!secrets.tossIapBaseUrl || !secrets.tossMtlsCert || !secrets.tossMtlsKey) {
      throw new Error("MISSING_TOSS_CREDENTIALS");
    }
    verifiedData = await verifyWithToss(
      String(transactionId),
      secrets.tossIapBaseUrl, secrets.tossMtlsCert, secrets.tossMtlsKey
    );
    // 지급 tier 는 Toss 가 검증해준 실제 sku 로만 도출(클라 productId 불신). 매핑 없으면
    // fail-closed(콘솔 SKU 미기재 → 지급 불가). getPendingOrders 가 sku 만 줘도 복구 가능.
    effectiveProductId = TOSS_SKU_TO_INTERNAL[verifiedData.sku];
    if (!effectiveProductId || !PRODUCTS[effectiveProductId]) {
      console.error(`Toss sku not mapped to a product: sku=${verifiedData.sku}, orderId=${transactionId}`);
      throw new Error("INVALID_PRODUCT");
    }
  } else {
    throw new Error("UNSUPPORTED_PLATFORM");
  }

  // 지급량은 서버 권위 PRODUCTS 에서만 — effectiveProductId 기준(클라 grant 무시).
  const grant = PRODUCTS[effectiveProductId];
  if (!grant) throw new Error("INVALID_PRODUCT");

  // 3-1. 비-Production 게이트 — 플랫폼으로 결정 (LL40 rule4 caveat "resolve by platform,
  //   don't gamble"). 이전엔 "비-Production 전부 거부 + test_accounts 예외"였는데, 그러면
  //   App Review 심사관의 Sandbox 결제(익명 UID → 화이트리스트 불가)가 거부돼 2.1 리젝난다.
  //   · iOS Sandbox: App Store Server API 가 검증(위조 불가) + 정식 스토어 유저는 Production
  //     영수증만 받으므로 도달 불가 → ALLOW (심사관/TestFlight 가 상품 수령, 파밍 불가).
  //   · Android Sandbox(purchaseType=0 라이선스 테스트) + Xcode 로컬: 패치 클라/개발 전용으로
  //     도달 가능 → config/test_accounts 화이트리스트(형/QA UID)만 허용. Google 심사관은
  //     라이선스-테스트로 결제하지 않으므로 차단해도 Play 심사엔 무관.
  //   · Toss: verifyWithToss 가 항상 "Production" → 영향 없음.
  //   (env==="Xcode"는 서버검증 단계에서 이미 죽어 3플랫폼 전부 데드코드지만 방어선으로 유지.)
  //   캡 미도입: iOS Sandbox 캡은 심사관이 캡에 걸리면 곧 2.1 이라 리스크 비대칭이 나쁘고,
  //   재화가 현금화 불가라 파밍 인센티브도 낮다. 공개 TestFlight 를 열 때만 넉넉한 캡 재고.
  //   (Mineta 와 동일 게이트 — 이 패턴으로 심사 통과 확인됨.)
  const env = verifiedData?.environment;
  if (env && env !== "Production") {
    const isTester = await isTestAccount(db, uid);
    const blocked = !isTester && (env === "Xcode" || (env === "Sandbox" && platform !== "ios"));
    if (blocked) {
      console.error(`Rejecting non-production transaction: uid=${uid} platform=${platform} env=${env} product=${effectiveProductId}`);
      throw new Error(`NON_PRODUCTION_TRANSACTION: ${env}`);
    }
    console.log(`Allowing non-production transaction: uid=${uid} platform=${platform} env=${env} tester=${isTester}`);
  }

  // 4. Firestore 트랜잭션으로 원자적 dedup + 지급 (동시 구매 race condition 방지).
  await db.runTransaction(async (transaction) => {
    const txDoc = await transaction.get(txRef);
    if (txDoc.exists) {
      // 검증 사이에 다른 호출이 먼저 처리함 — 중복 지급 스킵.
      return;
    }
    const userDoc = await transaction.get(userRef);
    const userData = userDoc.exists ? userDoc.data() : {};
    // tombstone(migrated_to) 계정으로의 지급 차단 — 트랜잭션 안에서 재확인. (플레이북 §9-4 M3)
    if (userData.migrated_to) {
      throw new Error("ACCOUNT_MIGRATED");
    }

    const updates = {};
    if (grant.coins) updates.coins = (userData.coins ?? 0) + grant.coins;
    if (grant.gems) updates.gems = (userData.gems ?? 0) + grant.gems;
    transaction.set(userRef, updates, { merge: true });

    transaction.set(txRef, {
      uid,
      product_id: effectiveProductId,
      platform,
      grant,
      processed_at: FieldValue.serverTimestamp(),
      environment: verifiedData?.environment || "unknown",
      transaction_id: String(transactionId),
      original_transaction_id: verifiedData?.originalTransactionId || null,
    });
  });

  console.log(`[IAP] granted: uid=${uid} platform=${platform} product=${effectiveProductId} grant=${JSON.stringify(grant)}`);

  // 지급 트랜잭션 후 Android 소비성 구매를 서버에서 consume. 지급은 이미 원자적으로
  // 커밋됐고 dedup 원장(processed_transactions)이 재지급을 막으므로, consume 실패는
  // 로그만 남기고 지급을 되돌리지 않는다(환불/취소 회수는 RTDN 스윕이 담당 — 아래 TODO).
  // TODO(infra): Pub/Sub RTDN(voidedPurchases) 스윕으로 환불/취소된 구매를 원장에서
  //   회수. 현재는 미구축이라 서버 consume + 3일 자동취소 회피만 보장한다.
  if (platform === "android") {
    const packageName = secrets.androidPackageName || BUNDLE_ID;
    try {
      await consumeGooglePlayPurchase(
        String(transactionId), effectiveProductId, packageName, secrets.googlePlayServiceAccount
      );
    } catch (e) {
      console.error(`Google Play consume failed (grant already committed): txId=${transactionId}, error=${e.message}`);
    }
  }

  return { success: true, productId: effectiveProductId, grant, already_processed: false };
}

module.exports = {
  PRODUCTS,
  verifyAndFulfill,
};
