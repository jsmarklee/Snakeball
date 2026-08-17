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
