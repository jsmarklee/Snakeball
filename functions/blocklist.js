/**
 * blocklist.js — 닉네임 금칙어 검사 (MinefieldSweeper에서 이식, 단순화)
 * - 다국어(한/영/일/중) 지원, 초성 욕설 감지, leet 우회 방어
 * Snakeball은 AI 모더레이션 없이 블록리스트만 사용한다 (HARD만 차단).
 */

// ========================
// 1. WORD SETS
// ========================
const BLOCKED = {
  HARD: [
    // Korean (완성형 + 초성)
    "시발", "씨발", "씨팔", "시팔", "쓰발", "쒸발", "ㅅㅂ", "ㅆㅂ",
    "병신", "빙신", "ㅂㅅ", "지랄", "ㅈㄹ",
    "개새끼", "개새기", "개색기", "개쉐끼", "개쌔끼", "새끼", "쌔끼",
    "좆", "좃", "졷", "미친놈", "미친년", "미친새끼", "꺼져",
    "존나", "졸라", "존니", "ㅈㄴ", "보지", "자지", "ㅂㅈ", "ㅈㅈ",
    "니애미", "니엄마", "느금마", "느개비", "애미", "애비", "엿먹어",
    "뒤져", "디져", "뒈져", "걸레", "화냥년",
    // English
    "fuck", "fuk", "fck", "fuq", "phuck", "shit", "shite", "sht",
    "bitch", "btch", "b1tch", "asshole", "dick", "d1ck", "cock",
    "pussy", "cunt", "bastard", "whore", "hoe", "slut", "faggot",
    "fag", "nigger", "nigga", "nigg", "retard", "porn", "p0rn", "rape", "r4pe",
    // Sexual / Global
    "sex", "s3x", "boob", "boobs", "tits", "tit", "milf", "blowjob", "bj",
    "handjob", "cum", "cumming", "orgasm", "horny", "xxx", "hentai",
    "섹스", "야스", "야동", "자위", "딸딸이", "꼴림", "꼴려",
    // Japanese
    "くそ", "クソ", "死ね", "しね", "ばか", "バカ", "あほ", "アホ",
    "キチガイ", "ちんこ", "まんこ", "エロ", "オナニー",
    // Chinese
    "操", "肏", "草泥马", "草你妈", "他妈的", "你妈的",
    "傻逼", "傻b", "煞笔", "沙比", "鸡巴", "婊子", "妓女", "王八蛋",
    "去死", "色情", "做愛",
  ],
};

// ========================
// 2. LEET MAP
// ========================
const LEET_MAP = {
  "@": "a", "4": "a", "^": "a", "8": "b", "(": "c", "3": "e", "6": "g", "9": "g",
  "#": "h", "!": "i", "1": "i", "|": "i", "l": "i", "0": "o", "5": "s", "$": "s", "7": "t", "+": "t",
};

// ========================
// 3. NORMALIZE
// ========================
// 키릴/그리스 동형이의 문자(homoglyph) — NFKC 가 접지 못하는 범위.
// 주의: 여기서 접은 결과는 "판정용 후보"로만 쓴다(checkBlocklist 참조). 정상 키릴 이름
// (снежок 등)을 파괴하지 않으면서 'ѕех' 같은 위장만 잡기 위함.
const HOMOGLYPH_MAP = {
  "а": "a", "в": "b", "с": "c", "е": "e", "н": "h", "і": "i", "ј": "j", "к": "k",
  "м": "m", "о": "o", "р": "p", "ѕ": "s", "т": "t", "у": "y", "х": "x",
  "α": "a", "β": "b", "ε": "e", "ι": "i", "κ": "k", "ο": "o", "ρ": "p", "τ": "t", "υ": "u", "ν": "v",
};
function foldHomoglyphs(s) {
  return s.split("").map((c) => HOMOGLYPH_MAP[c] || c).join("");
}

// fold=true 면 허용범위 스트립 **전에** 동형이의 문자를 라틴으로 접는다. 스트립 뒤에
// 접으면 키릴/그리스는 이미 제거된 뒤라 'ѕех' 가 빈 문자열이 되어 그대로 통과한다.
function normalize(input, fold) {
  // 문자열이 아니면 빈 문자열로. 현재 유일한 호출부(sanitizeName)가 typeof 로 먼저 막지만,
  // 모듈 자체가 던지지 않게 둔다 — 새 호출부가 생겨도 500 이 나지 않도록.
  if (typeof input !== "string" || !input) return "";
  // NFKC 를 toLowerCase 보다 **먼저**. NFKC 가 전각(ｆｕｃｋ)·수학 볼드(𝐟𝐮𝐜𝐤)·
  // 원문자(ⓕⓤⓒⓚ) 같은 호환 변형을 평문 ASCII 로 접는다. 순서를 뒤집으면 𝐅𝐔𝐂𝐊 가
  // FUCK 로 남아 소문자 HARD_SET 과 어긋난다.
  // (이전 코드는 NFC + "허용 범위 밖 제거" 라서 이 변형들이 전부 빈 문자열이 되어
  //  통과했다 — 전각은 한국어/일본어 IME 에서 한 키다.)
  let s = input.normalize("NFKC").toLowerCase();
  // 보이지 않는 채움/폭0 문자 제거. NFKC 가 U+3164(ㅤ)·U+FFA0 를 U+1160 으로 접는데,
  // U+1160 은 허용범위(ᄀ-ᇿ)라 아래 스트립을 통과한다 → '시ㅤ발' 이 '시ᅠ발' 로 남아
  // 금칙어를 비껴갔다. (구 NFC 경로는 U+3164 를 범위 밖으로 보고 지워 오히려 막고 있었다.)
  // 눈에 보이지 않으므로 지워서 얻는 오탐은 없다.
  s = s.replace(/[ᅟᅠㅤﾠ​-‍⁠﻿]/g, "");
  if (fold) s = foldHomoglyphs(s);
  // 허용 문자 범위: 라틴, 한글(완성형+호환자모+자모), 일어, 한자만 남김
  s = s.replace(/[^\x00-\x7F가-힣ᄀ-ᇿㄱ-ㅎㅏ-ㅣぁ-んァ-ヶ一-龥]/g, "");
  // Leet substitution
  s = s.split("").map((c) => LEET_MAP[c] || c).join("");
  // 특수문자 제거
  s = s.replace(/[\s.\-_*~`'",;:!?@#$%^&()[\]{}|/\\<>+=]/g, "");
  // 연속된 중복 문자 제거 (시이이발 -> 시발)
  s = s.replace(/(.)\1+/g, "$1");
  return s;
}

// ========================
// 4. PRECOMPUTE
// ========================
const HARD_SET = [...new Set(BLOCKED.HARD.map((w) => normalize(w)))];

// ========================
// 5. MATCHING LOGIC
// ========================
function matchWord(normalized, blockedWord) {
  // 1글자 욕설은 완전 일치해야 함 (과잉 차단 방지)
  if (blockedWord.length === 1) {
    return normalized === blockedWord;
  }
  return normalized.includes(blockedWord);
}

// ========================
// 6. MAIN CHECK
// ========================
function checkBlocklist(name) {
  const normalized = normalize(name);
  // 동형이의 문자를 접은 형태도 함께 검사한다. 접은 결과를 normalize() 안에 넣지 않는
  // 이유: 정상 키릴/그리스 이름이 라틴으로 뭉개져 엉뚱하게 걸리는 걸 막기 위해서다.
  // 여기서는 "둘 중 하나라도 금칙어면 차단" 이라 정상 이름은 원본 판정으로 통과한다.
  const candidates = new Set([normalized]);
  // 동형이의 접기는 **위장 증거가 있을 때만** 후보로 쓴다. 무조건 접으면 정상 키릴 이름이
  // 대량 오탐된다: HOMOGLYPH_MAP 에 없는 글자(л·ч·ж·г…)는 범위 스트립에서 삭제되면서
  // 남은 조각들이 붙어버려, 러시아어 중성형 어미 '-ное'(н→h, о→o, е→e)가 통째로 'hoe' 가
  // 된다 → красное·личное·мороженое·ночное 가 전부 차단됐다(2026-07-28 회귀).
  const folded = normalize(name, true);
  if (folded) {
    const nfkc = String(name).normalize("NFKC").toLowerCase();
    const cyrGreek = nfkc.match(/[Ѐ-ӿͰ-Ͽ]/g) || [];
    // (1) 매핑 안 된 키릴/그리스 글자가 하나라도 있으면 접은 결과는 인접성이 조작된
    //     가짜 문자열이므로 버린다.
    const allMapped = cyrGreek.length > 0 && cyrGreek.every((c) => HOMOGLYPH_MAP[c]);
    if (allMapped) {
      const hasLatin = /[a-z]/.test(nfkc);
      if (hasLatin) {
        // (2a) 라틴 + 동형이의 혼용 = 위장의 실제 시그니처(ѕhit, fuсk). 부분일치 허용.
        candidates.add(folded);
      } else {
        // (2b) 전부 비라틴이면 부분일치는 오탐이 크다 → 완전일치일 때만 차단.
        for (const word of HARD_SET) {
          if (folded === word) return { blocked: true };
        }
      }
    }
  }
  for (const cand of candidates) {
    if (!cand) continue;
    for (const word of HARD_SET) {
      if (matchWord(cand, word)) {
        return { blocked: true };
      }
    }
  }
  return { blocked: false };
}

module.exports = { checkBlocklist, normalize };
