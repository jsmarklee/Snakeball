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
function normalize(input) {
  if (!input) return "";
  let s = input.toLowerCase();
  s = s.normalize("NFC");
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
  if (!normalized) return { blocked: false };
  for (const word of HARD_SET) {
    if (matchWord(normalized, word)) {
      return { blocked: true };
    }
  }
  return { blocked: false };
}

module.exports = { checkBlocklist, normalize };
