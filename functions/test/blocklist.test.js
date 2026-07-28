"use strict";
/**
 * blocklist.test.js — 닉네임 금칙어 회귀 테스트.
 *
 * 실행: node --test functions/test/
 *
 * 왜 있나: 닉네임은 공개 글로벌 리더보드에 그대로 노출되고(submitScore 가 저장된 name 을
 * 리더보드로 복사), 신고/차단 UI 가 없다. blocklist 가 유일한 모더레이션 통제다.
 * 2026-07-28 에 유니코드 호환 변형(전각/수학볼드/원문자)이 전부 우회하던 걸 고치면서 추가.
 */
const test = require("node:test");
const assert = require("node:assert");
const { checkBlocklist } = require("../blocklist");

const MUST_BLOCK = [
  ["plain ascii", "fuck"],
  ["fullwidth (한/일 IME 한 키)", "ｆｕｃｋ"],
  ["fullwidth uppercase", "ＦＵＣＫ"],
  ["mathematical bold", "𝐟𝐮𝐜𝐤"],
  ["mathematical script", "𝓯𝓾𝓬𝓴"],
  ["circled letters", "ⓕⓤⓒⓚ"],
  ["fullwidth sex", "ｓｅｘ"],
  ["cyrillic homoglyph", "ѕех"],
  ["mixed cyrillic/latin", "ѕhit"],
  ["korean", "시발"],
  ["fullwidth shit", "ｓｈｉｔ"],
];

const MUST_ALLOW = [
  ["latin", "Snake"],
  ["korean", "마크"],
  ["accented latin", "José"],
  ["cyrillic word (실제 이름)", "снежок"],
  ["generated default", "TurboSnake72"],
  ["katakana", "ボール"],
  ["han", "小球"],
  ["fullwidth benign", "Ｓｎａｋｅ"],
  ["greek letters", "αβγ"],
];

test("blocked names stay blocked across unicode variants", () => {
  for (const [label, name] of MUST_BLOCK) {
    assert.strictEqual(checkBlocklist(name).blocked, true, `should block ${label}: ${name}`);
  }
});

test("legitimate names are not false-positived", () => {
  for (const [label, name] of MUST_ALLOW) {
    assert.strictEqual(checkBlocklist(name).blocked, false, `should allow ${label}: ${name}`);
  }
});

test("empty / non-string input is safe", () => {
  for (const v of ["", null, undefined, 0, {}, []]) {
    assert.strictEqual(checkBlocklist(v).blocked, false);
  }
});
