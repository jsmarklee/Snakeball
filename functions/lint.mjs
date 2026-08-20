#!/usr/bin/env node
// functions 배포 관문 — `npm --prefix functions run lint` (firebase.json predeploy 가 호출).
//
// **이 파일이 있는 이유.** 여기 lint 는 `echo 'lint ok'` 스텁이었고 firebase.json 에는
// predeploy 훅조차 없었다. 즉 **문법이 깨진 코드도 프로덕션에 그대로 배포됐다** — 결제
// 검증과 서버권위 경제가 도는 함수들인데도. 실제로 이 리포는 배포 순간에만 드러나는 사고를
// 여러 번 겪었다(룰 미배포로 한 달간 무료 코인, 미배포 커밋이 라이브인 줄 알았던 건 등).
//
// eslint 를 새로 끌어오지 않는다. 이 리포엔 eslint 설정도 devDependencies 도 없어서,
// 스타일 규칙을 새로 도입하는 건 이 결함(“배포가 아무것도 검사하지 않는다”)과 다른 문제다.
// 대신 **의존성 0으로 실제 사고를 잡는 것**만 검사한다: 문법 + 단위 테스트 + 하드게이트 상수.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const fails = [];

function die(msg) {
  console.error(`functions lint 중단 — ${msg}\n  검사기가 못 따라간 것이지 통과가 아니다.`);
  process.exit(1);
}

// --- [1] 문법: node_modules 를 뺀 모든 .js/.mjs
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}
const sources = walk(HERE);
if (sources.length < 4) die(`검사할 소스를 ${sources.length}개밖에 못 찾았다`);
for (const f of sources) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    fails.push(`[1] 문법 오류 — ${f.replace(HERE + '/', '')}\n    ${String(e.stderr || e).split('\n')[0]}`);
  }
}

// --- [2] 단위 테스트
try {
  execFileSync(process.execPath, ['--test', join(HERE, 'test')], { stdio: 'pipe' });
} catch (e) {
  const out = String(e.stdout || '') + String(e.stderr || '');
  const failing = out.split('\n').filter((l) => /^not ok /.test(l)).slice(0, 5);
  fails.push(`[2] 테스트 실패\n    ${failing.join('\n    ') || out.trim().split('\n').slice(-3).join('\n    ')}`);
}

// --- [3] 하드게이트 상수 — 조용히 바뀌면 돈이 새거나 정상 유저가 막힌다
//     (근거는 CLAUDE.md "건드리면 안 되는 것" 표. 값을 바꿔야 하면 여기도 같이 고치고,
//      왜 안전한지 커밋 메시지에 남겨야 한다 — 그게 이 관문의 목적이다.)
const GATES = [
  ['coinSystem.js', /const MIGRATION_CUTOFF_MS = Date\.parse\("2026-07-11T00:00:00Z"\)/,
    'MIGRATION_CUTOFF_MS — 올리면 신규 계정이 무료 코인 임포트 대상이 된다(마이그레이션은 이미 끝났다)'],
  ['coinSystem.js', /const MISSIONS_PER_DAY = 3;/,
    'MISSIONS_PER_DAY — 클라가 뽑는 데일리 미션 수와 짝이라, 어긋나면 정상 유저가 미션을 못 받는다'],
  ['index.js', /const MAX_SCORE_PER_SEC = 300;/, 'MAX_SCORE_PER_SEC — 리더보드 안티치트 상한'],
  ['index.js', /const BASE_BUFFER = 200;/,
    'BASE_BUFFER — 0초 세션 허용치. 2000 이던 시절 플레이 없이 리더보드 1위가 가능했다'],
  ['index.js', /const MAX_CREDITED_SECONDS = 600;/, 'MAX_CREDITED_SECONDS — 경과시간 크레딧 상한'],
];
for (const [file, re, why] of GATES) {
  const p = join(HERE, file);
  let src;
  try { src = readFileSync(p, 'utf8'); } catch { die(`${file} 를 못 읽었다`); }
  if (!re.test(src)) fails.push(`[3] 하드게이트 상수가 바뀌었다 — ${file}: ${why}`);
}

// --- [4] 순서 불변식: 텔레메트리 쓰기는 반드시 안티치트 상한 검증 **뒤**
//     앞에 두면 검증에 실패한 위조 점수까지 세션에 기록된다.
{
  const src = readFileSync(join(HERE, 'index.js'), 'utf8');
  const bound = src.indexOf('score > maxAllowed');
  const telem = src.indexOf('runRecordedAt');
  if (bound < 0) die('index.js 에서 안티치트 상한 검증을 못 찾았다');
  if (telem >= 0 && telem < bound)
    fails.push('[4] 런 텔레메트리 쓰기가 안티치트 상한 검증보다 앞에 있다 — 위조 점수가 기록된다');
}

console.log(`functions lint — 소스 ${sources.length}개 문법 · 테스트 · 하드게이트 ${GATES.length}개 · 순서 불변식 1개`);
if (fails.length) {
  console.error('\n' + fails.join('\n'));
  console.error(`\n❌ functions lint FAIL — ${fails.length}건`);
  process.exit(1);
}
console.log('✅ functions lint OK');
