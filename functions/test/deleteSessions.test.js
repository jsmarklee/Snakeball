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
