#!/usr/bin/env node
/**
 * 관문: **속도가 화면에 보이는가.**
 *
 * 2026-08-20 실측. 이 게임은 12 → 28 (+133%) 로 가속하고 그 뒤로도 계속 빨라지는데,
 * 화면에는 그 단서가 **하나도 없었다**:
 *   · 차선이 전부 세로(PlaneGeometry(0.04, ROAD_LENGTH)) — 전진해도 상대 운동 0
 *   · 도로 메시는 매 프레임 플레이어를 따라 이동(roadMesh.position.set(0,0,roadCenter))
 *   · 도로↔차선 대비 1.25 — 있어도 안 보였다
 * 엔드리스 러너에서 속도감은 게임 그 자체다. 그게 통째로 비어 있었다.
 *
 * 이 관문은 노면 눈금이 (a) 존재하고 (b) 실제 이동 거리에 묶여 있고 (c) 보이는지를
 * **소스에서 직접 읽어** 판정한다. 상수를 여기로 옮겨 적으면 소스가 바뀌어도 낡은
 * 값을 통과시키므로 전부 index.html 에서 파싱한다. 못 읽으면 통과가 아니라 실패다.
 */
import { openWorldSource, VECTOR_MUTATORS } from './check-world-source.mjs';

const fail = [];
const note = [];

function die(msg) {
  console.error(`check:road 중단 — ${msg}\n  파서가 못 따라간 것이지 통과가 아니다.`);
  process.exit(1);
}

const w = await openWorldSource(new URL('../index.html', import.meta.url), die);
const palettes = w.palettes();

// [1] 노면에 눈금 텍스처가 실제로 걸려 있는가.
const roadTex = w.requireConst('roadTexture', 'CallExpression');
if (!w.isId(roadTex.callee, 'makeRoadTexture') || roadTex.arguments.length) w.fail(roadTex, 'roadTexture 는 makeRoadTexture() 여야 한다');
if (!w.isId(w.material('roadMaterial').props.get('map'), 'roadTexture')) {
  fail.push('[1] roadMaterial 에 map 이 없다 — 노면이 단색이면 전진해도 아무것도 다가오지 않는다');
}

// [2] 눈금이 **실제 이동 거리**에 묶여 있는가 (고정 속도 애니메이션이면 가속이 안 보인다).
//     모양: 함수 본문 최상위 `const ballZ = playerWorldZ;` 뒤 `roadTexture.offset.y = -(ballZ / RUNG_SPACING) % 1;`
const offsets = w.nodes.filter((n) => n.type === 'AssignmentExpression' && w.isPath(n.left, 'roadTexture', ['offset', 'y']));
const anchors = new Set(offsets);
const wrapOk = (n) => {
  const r = n.right, neg = r.left, d = neg?.argument;
  return n.operator === '=' && r.type === 'BinaryExpression' && r.operator === '%' && w.isNum(r.right, 1)
    && neg.type === 'UnaryExpression' && neg.operator === '-' && d.type === 'BinaryExpression' && d.operator === '/'
    && w.isId(d.left, 'ballZ') && w.isId(d.right, 'RUNG_SPACING');
};
const travelOk = (n) => {
  const st = w.parent(n), blk = st && w.parent(st), fn = blk && w.parent(blk);
  if (st?.type !== 'ExpressionStatement' || blk?.type !== 'BlockStatement' || !/Function/.test(fn?.type ?? '')) return false;
  return blk.body.slice(0, blk.body.indexOf(st)).some((s) => s.type === 'VariableDeclaration' && s.kind === 'const'
    && s.declarations.some((d) => w.isId(d.id, 'ballZ') && w.isId(d.init, 'playerWorldZ')));
};
if (offsets.length !== 1) {
  fail.push(`[2] roadTexture.offset.y 대입이 ${offsets.length}곳이다 — 정확히 한 곳이어야 한다`
    + offsets.map((n) => `\n      ${w.where(n)}`).join(''));
} else if (!wrapOk(offsets[0]) || !travelOk(offsets[0])) {
  fail.push('[2] offset 이 이동 거리(ballZ = playerWorldZ)에 `-(ballZ / RUNG_SPACING) % 1` 로 묶여 있지 않다 — 속도가 올라도 눈금이 빨라지지 않는다.\n'
    + '      부호 주의: v=0 이 지평선이므로 offset 은 감소해야 한다. 뒤집으면 후진처럼 보인다.\n'
    + `      ${w.where(offsets[0])}`);
}

// [3] 눈금 간격이 ROAD_LENGTH 에서 유도되는가 (literal 복사는 조용히 어긋난다).
const repeats = w.nodes.filter((n) => n.type === 'CallExpression' && w.isPath(n.callee, 'roadTexture', ['repeat', 'set'])
  && n.arguments.length === 2 && w.isNum(n.arguments[0], 1) && n.arguments[1].type === 'BinaryExpression'
  && n.arguments[1].operator === '/' && w.isId(n.arguments[1].left, 'ROAD_LENGTH') && w.isId(n.arguments[1].right, 'RUNG_SPACING'));
if (repeats.length !== 1) {
  fail.push(`[3] repeat 이 ROAD_LENGTH 에서 유도되지 않는다 — 도로 길이를 바꾸면 눈금 간격이 어긋난다 (roadTexture.repeat.set(1, ROAD_LENGTH / RUNG_SPACING) ${repeats.length}곳)`);
}
for (const n of repeats) anchors.add(n);

for (const n of w.writes([
  { name: 'roadTexture', under: ['offset'], methods: VECTOR_MUTATORS },
  { name: 'roadTexture', under: ['repeat'], methods: VECTOR_MUTATORS },
], anchors)) fail.push(`[2/3] roadTexture.offset/repeat 을 기준 대입 밖에서 바꾼다 — ${w.where(n)}`);

// [4] 보이는가. 대비를 계산한다(비텍스트 그래픽 기준 3.0 / 차선은 보조라 1.8).
const hex = (s2) => parseInt(String(s2).replace('#', ''), 16);
const lum = (h) => {
  const ch = [h >> 16 & 255, h >> 8 & 255, h & 255].map((c) => {
    const s2 = c / 255;
    return s2 <= 0.03928 ? s2 / 12.92 : ((s2 + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
const cr = (a, b) => {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

const cssHex = (name) => {
  const n = w.requireConst(name, 'Literal');
  if (typeof n.value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(n.value)) w.fail(n, `${name} 는 '#RRGGBB' 문자열 리터럴이어야 한다`);
  return n.value;
};
const base = cssHex('ROAD_BASE_HEX');
const rung = cssHex('ROAD_RUNG_HEX');

{
  const c = cr(hex(base), hex(rung));
  if (c < 3.0) fail.push(`[4] 눈금 대비 ${c.toFixed(2)} < 3.0 — 흘러도 안 보이면 없는 것과 같다 (${base} vs ${rung})`);
  else note.push(`[4] 눈금 대비 ${c.toFixed(2)} (${base} vs ${rung})`);
}
// 차선 색은 PALETTES[*].lane 이다 (roadLineMaterial 시작값·applyPalette 경로는 w.palettes() 가 확인).
for (const p of palettes) {
  const c = cr(hex(base), parseInt(p.lane, 16));
  if (c < 1.8) fail.push(`[4] 차선 대비 ${c.toFixed(2)} < 1.8 — 어느 차선에 있는지 안 읽힌다 (${p.name} #${p.lane})`);
  else note.push(`[4] 차선 대비 ${c.toFixed(2)} (${p.name} #${p.lane})`);
}

// [5] 눈금 간격이 속도 대비 합리적인가. 초당 지나가는 눈금 수로 판정한다.
const num = (name) => {
  const n = w.requireConst(name, 'Literal');
  if (typeof n.value !== 'number' || !(n.value > 0)) w.fail(n, `${name} 는 양수 숫자 리터럴이어야 한다`);
  return n.value;
};
const spacing = num('RUNG_SPACING');
const vMin = num('INITIAL_SPEED');
const vMax = num('MAX_SPEED');
{
  const perSecMin = vMin / spacing, perSecMax = vMax / spacing;
  // 너무 성기면 속도가 안 읽히고, 너무 촘촘하면 원근 압축에서 뭉개져 깜빡임이 된다.
  if (perSecMin < 2) fail.push(`[5] 최저 속도에서 초당 ${perSecMin.toFixed(1)}개 — 너무 성기다 (2 이상)`);
  if (perSecMax > 15) fail.push(`[5] 최고 속도에서 초당 ${perSecMax.toFixed(1)}개 — 너무 촘촘해 뭉개진다 (15 이하)`);
  note.push(`[5] 눈금 통과율 ${perSecMin.toFixed(1)}~${perSecMax.toFixed(1)}개/초 (간격 ${spacing}, 속도 ${vMin}~${vMax})`);
}

for (const n of note) console.log('  ' + n);
if (fail.length) {
  console.error(`\n노면 속도감 관문 실패 ${fail.length}건:\n`);
  for (const f of fail) console.error('  ✗ ' + f);
  console.error('');
  process.exit(1);
}
console.log('\n노면 속도감 관문 통과\n');
