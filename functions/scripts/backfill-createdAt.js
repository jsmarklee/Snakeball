#!/usr/bin/env node
/**
 * backfill-createdAt.js — 서버권위 경제 첫 배포 "직전"에 1회 실행하는 마이그레이션 백필.
 *
 * 왜: getEconomyStatus 의 1회성 import 게이트는 `preCutoff(createdAt<MIGRATION_CUTOFF_MS)`
 *     또는 `legacyNoCreatedAt(bestScore/recoveryCode 보유)` 를 만족하는 pre-existing doc 만
 *     localStorage 잔액을 임포트한다. 라이브 코드는 createdAt 을 쓰지 않으므로, 기존 유저
 *     doc 에 createdAt 을 심어 **모든 레거시 계정을 preCutoff 자격화**한다(잔액/스킨 증발 방지).
 *     legacyNoCreatedAt 폴백이 못 잡는 갭(오프라인 전용/무스코어 IAP 구매자)까지 덮는 belt.
 *
 * 안전장치(전문가 검토 반영):
 *   - 프로젝트 오조작 방지: projectId 가 'snakeball-game' 이 아니면 즉시 종료.
 *   - dry-run 기본. 실제 쓰기는 `--commit` 플래그로만.
 *   - identity-only: `createdAt` 없는 doc 에 sentinel 만 set(merge). coins/gems/owned_skins/
 *     powerups 절대 미접촉.
 *   - 배포-후 재실행 하드가드: economy_initialized 필드를 가진 doc 이 하나라도 있으면 = 신규
 *     코드가 이미 라이브 → **거부**(재실행이 배포 후 신규 uid 에 createdAt 을 찍어 import
 *     자격을 주면 localStorage-seed faucet 이 열린다). 백필/재검증은 배포 "전"에만 안전.
 *   - 완전성 게이트: 배포 직전 --commit 을 멱등 재실행해 written==0 을 확인(모든 레거시 커버 증명).
 *
 * 배포 순서(반드시):
 *   1) node functions/scripts/backfill-createdAt.js            # dry-run 확인
 *   2) node functions/scripts/backfill-createdAt.js --commit   # 실제 백필
 *   3) node functions/scripts/backfill-createdAt.js --commit   # 재실행 → "written: 0" 확인(완전성)
 *   4) coinSystem.js MIGRATION_CUTOFF_MS 를 "지금(배포 직전)" 시각으로 갱신(미래/배포후 금지)
 *   5) firebase deploy --only functions   ← 창을 분 단위로 좁혀서 즉시
 *
 * 자격증명: `firebase login` 후 gcloud ADC, 또는 GOOGLE_APPLICATION_CREDENTIALS=<서비스계정.json>.
 *   (firebase-admin 은 functions/node_modules 에서 resolve — 이 스크립트를 functions/ 기준으로 실행)
 */

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

  const db = admin.firestore();
  const col = db.collection("users");

  console.log(`\n[backfill-createdAt] project=${actualProject}  mode=${COMMIT ? "COMMIT" : "DRY-RUN"}`);
  console.log(`  sentinel createdAt = ${SENTINEL.toISOString()}\n`);

  // ── 배포-후 재실행 하드가드 (쓰기 전에 먼저) ──
  // economy_initialized 를 가진 doc 이 하나라도 있으면 = 신규 코드가 이미 라이브. 이 시점에
  // 백필하면 배포 후 신규 uid 에 createdAt 을 찍어 localStorage-seed faucet 을 열 수 있다.
  // (orderBy(field) 는 그 필드를 가진 doc 만 반환 → 존재 여부 cheap 체크.)
  const initProbe = await col.orderBy("economy_initialized").limit(1).get();
  if (!initProbe.empty) {
    console.error("✋ REFUSING: a users doc already has economy_initialized → new code is LIVE.");
    console.error("   백필은 배포 '전'에만 안전합니다. 배포 후 실행 시 신규 uid 에 createdAt 을 찍어");
    console.error("   localStorage-seed faucet 을 열 수 있어 중단합니다(아무것도 쓰지 않음).");
    process.exit(2);
  }

  let scanned = 0;
  let missing = 0;                // createdAt 없는 doc(백필 대상)
  let written = 0;
  const writtenUids = [];

  // Firestore 는 "필드 없음" 쿼리가 없으므로 전체 스캔 + 클라 필터. __name__ 커서로 페이지네이션.
  let last = null;
  for (;;) {
    let q = col.orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    let batch = db.batch();
    let batchCount = 0;
    for (const doc of snap.docs) {
      scanned++;
      const data = doc.data() || {};
      if (!Object.prototype.hasOwnProperty.call(data, "createdAt")) {
        missing++;
        if (COMMIT) {
          batch.set(doc.ref, { createdAt: admin.firestore.Timestamp.fromDate(SENTINEL) }, { merge: true });
          batchCount++;
          writtenUids.push(doc.id);
        }
      }
    }
    if (COMMIT && batchCount > 0) {
      await batch.commit();
      written += batchCount;
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }

  console.log("──────────────────────────────────────────");
  console.log(`  scanned (users docs)        : ${scanned}`);
  console.log(`  missing createdAt (targets) : ${missing}`);
  console.log(`  written                     : ${written}${COMMIT ? "" : "  (dry-run — 쓰지 않음)"}`);
  console.log("──────────────────────────────────────────");

  if (!COMMIT && missing > 0) {
    console.log(`\n  → 확인 후 실제 백필: node functions/scripts/backfill-createdAt.js --commit`);
  }
  if (COMMIT) {
    console.log(`\n  written uids (${writtenUids.length}): ${writtenUids.slice(0, 20).join(", ")}${writtenUids.length > 20 ? " …" : ""}`);
    if (written === 0) {
      console.log("  ✅ written==0 → 모든 레거시 doc 이 이미 createdAt 보유(완전성 게이트 통과).");
      console.log("     이제 MIGRATION_CUTOFF_MS 를 지금 시각으로 갱신하고 즉시 functions 배포하세요.");
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("backfill-createdAt failed:", e);
  process.exit(1);
});
