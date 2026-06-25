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

// ─── 서버 권위 상품 정의 ─────────────────────────────────────
// SKU(productId) → 지급량. 이 맵이 단일 진실 소스다. 클라이언트가 보낸
// grant 금액은 무시되며, 여기 정의된 amount만 지급된다 (index.html STORE와 동기 유지).
const PRODUCTS = {
  coins_small: { coins: 5000 },
  coins_big:   { coins: 30000 },
  gems_small:  { gems: 50 },
  gems_big:    { gems: 200 },
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
 * Fail-closed: 응답의 sku가 없거나 클라이언트가 주장한 productId와 다르면 거부.
 * Snakeball은 내부 productId == 콘솔 SKU 라고 가정 (MFS의 내부ID↔SKU 매핑 테이블처럼
 * 별도 매핑이 필요하면 TOSS_INTERNAL_TO_SKU를 추가하면 된다).
 */
async function verifyWithToss(orderId, productId, tossBaseUrl, mtlsCert, mtlsKey) {
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

  // Fail-closed sku 매칭: sku가 없거나 productId와 다르면 지급 거부.
  // (없으면 싼 결제로 비싼 상품을 받아낼 수 있으므로 반드시 존재 + 일치 확인.)
  if (!orderInfo.sku) {
    console.error(`Toss order-status missing sku: orderId=${orderId}, productId=${productId}`);
    throw new Error("PRODUCT_ID_MISMATCH");
  }
  if (orderInfo.sku !== productId) {
    console.error(`Toss SKU mismatch: verified=${orderInfo.sku}, claimed=${productId}`);
    throw new Error("PRODUCT_ID_MISMATCH");
  }

  return {
    transactionId: String(orderId),
    originalTransactionId: String(orderId),
    productId,
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

  // 1. 서버 권위 상품 정의 확인 — 지급량은 여기서만 나온다.
  const grant = PRODUCTS[productId];
  if (!grant) {
    throw new Error("INVALID_PRODUCT");
  }

  // 2. 전역 멱등성 키. 영수증 검증은 "이 트랜잭션이 실제 결제됨"만 보장할 뿐
  // "호출자가 소유함"을 보장하지 않는다. user별로 키를 잡으면 같은 영수증을
  // 무한 익명 계정에서 재사용할 수 있으므로 {platform}:{txId} 전역 원장으로 잠근다.
  const dedupKey = `${platform}:${String(transactionId)}`;
  const txRef = db.collection("processed_transactions").doc(dedupKey);

  const priorDoc = await txRef.get();
  if (priorDoc.exists) {
    console.log(`Transaction already processed (key=${dedupKey})`);
    return { success: true, productId, grant, already_processed: true };
  }

  // 3. 플랫폼별 영수증 검증.
  let verifiedData;
  if (platform === "ios") {
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
  } else if (platform === "android") {
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
      String(transactionId), productId,
      secrets.tossIapBaseUrl, secrets.tossMtlsCert, secrets.tossMtlsKey
    );
  } else {
    throw new Error("UNSUPPORTED_PLATFORM");
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

    const updates = {};
    if (grant.coins) updates.coins = (userData.coins ?? 0) + grant.coins;
    if (grant.gems) updates.gems = (userData.gems ?? 0) + grant.gems;
    transaction.set(userRef, updates, { merge: true });

    transaction.set(txRef, {
      uid,
      product_id: productId,
      platform,
      grant,
      processed_at: FieldValue.serverTimestamp(),
      environment: verifiedData?.environment || "unknown",
      transaction_id: String(transactionId),
      original_transaction_id: verifiedData?.originalTransactionId || null,
    });
  });

  console.log(`[IAP] granted: uid=${uid} platform=${platform} product=${productId} grant=${JSON.stringify(grant)}`);
  return { success: true, productId, grant, already_processed: false };
}

module.exports = {
  PRODUCTS,
  verifyAndFulfill,
};
