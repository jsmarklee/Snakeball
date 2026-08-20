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
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const fail = [];
const note = [];

const grab = (re, what) => {
  const m = src.match(re);
  if (!m) { fail.push(`[읽기] ${what} 를 소스에서 찾지 못했다 — 관문이 낡았거나 코드가 옮겨졌다`); return null; }
  return m[1];
};

// [1] 노면에 눈금 텍스처가 실제로 걸려 있는가.
if (!/roadMaterial\s*=\s*new THREE\.MeshStandardMaterial\(\{[^}]*map:\s*roadTexture/s.test(src)) {
  fail.push('[1] roadMaterial 에 map 이 없다 — 노면이 단색이면 전진해도 아무것도 다가오지 않는다');
}

// [2] 눈금이 **실제 이동 거리**에 묶여 있는가 (고정 속도 애니메이션이면 가속이 안 보인다).
if (!/roadTexture\.offset\.y\s*=\s*-\(\s*ballZ\s*\/\s*RUNG_SPACING\s*\)/.test(src)) {
  fail.push('[2] offset 이 이동 거리(ballZ)에 묶여 있지 않다 — 속도가 올라도 눈금이 빨라지지 않는다.\n'
    + '      부호 주의: v=0 이 지평선이므로 offset 은 감소해야 한다. 뒤집으면 후진처럼 보인다.');
}

// [3] 눈금 간격이 ROAD_LENGTH 에서 유도되는가 (literal 복사는 조용히 어긋난다).
if (!/roadTexture\.repeat\.set\(\s*1\s*,\s*ROAD_LENGTH\s*\/\s*RUNG_SPACING\s*\)/.test(src)) {
  fail.push('[3] repeat 이 ROAD_LENGTH 에서 유도되지 않는다 — 도로 길이를 바꾸면 눈금 간격이 어긋난다');
}

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

const base = grab(/ROAD_BASE_HEX\s*=\s*'(#[0-9a-fA-F]{6})'/, 'ROAD_BASE_HEX');
const rung = grab(/ROAD_RUNG_HEX\s*=\s*'(#[0-9a-fA-F]{6})'/, 'ROAD_RUNG_HEX');
const lane = grab(/roadLineMaterial\s*=\s*new THREE\.MeshStandardMaterial\(\{\s*color:\s*0x([0-9a-fA-F]{6})/, '차선 색');

if (base && rung) {
  const c = cr(hex(base), hex(rung));
  if (c < 3.0) fail.push(`[4] 눈금 대비 ${c.toFixed(2)} < 3.0 — 흘러도 안 보이면 없는 것과 같다 (${base} vs ${rung})`);
  else note.push(`[4] 눈금 대비 ${c.toFixed(2)} (${base} vs ${rung})`);
}
if (base && lane) {
  const c = cr(hex(base), parseInt(lane, 16));
  if (c < 1.8) fail.push(`[4] 차선 대비 ${c.toFixed(2)} < 1.8 — 어느 차선에 있는지 안 읽힌다 (#${lane})`);
  else note.push(`[4] 차선 대비 ${c.toFixed(2)} (#${lane})`);
}

// [5] 눈금 간격이 속도 대비 합리적인가. 초당 지나가는 눈금 수로 판정한다.
const spacing = Number(grab(/RUNG_SPACING\s*=\s*([\d.]+)/, 'RUNG_SPACING'));
const vMin = Number(grab(/INITIAL_SPEED\s*=\s*([\d.]+)/, 'INITIAL_SPEED'));
const vMax = Number(grab(/MAX_SPEED\s*=\s*([\d.]+)/, 'MAX_SPEED'));
if (spacing && vMin && vMax) {
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
