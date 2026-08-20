#!/usr/bin/env node
// 스킨 가독성 관문 — 플레이어 공이 월드 오브젝트와 구별되는지 소스에서 직접 판정한다.
//
//   node tools/check-skin-readability.mjs      (npm run check:skins)
//
// **이 파일이 있는 이유.** 스킨을 하나씩 보면 전부 예쁘다. 월드 오브젝트 색과 **함께**
// 표에 놓아야 보인다. 2026-08-20 실측: 단색 유료 스킨 6종 중 5종이 월드 오브젝트와
// **바이트 단위로 동일**했다(CIE Lab dE76 = 0.00).
//
//   mint(300코인)   #63f8cf == 도로 경계        — 상시 화면에 있다
//   lime(600코인)   #4ad585 == 큐브 type1 + 볼 픽업
//   coral(900코인)  #e87352 == 큐브 type3
//   gold(1800코인)  #ffd23f == **주우러 다니는 코인**
//   galaxy(30젬)    #a965aa == 큐브 type4
//
// 돈을 내고 산 스킨이 장애물·픽업과 같은 색이 되는 상태였다. 리포는 같은 위험을
// index.html 주석(민트/라임)에서 이미 인지하고 있었지만 판정하는 곳이 없었다.

import { readFileSync } from 'node:fs';

const SRC = new URL('../index.html', import.meta.url);
const MIN_WORLD = 22; // 스킨 ↔ 월드 오브젝트 최소 dE76
const MIN_SKIN = 18;  // 스킨끼리 최소 dE76

const html = readFileSync(SRC, 'utf8');
const fails = [];

function die(msg) {
  console.error(`check:skins 중단 — ${msg}\n  파서가 못 따라간 것이지 통과가 아니다.`);
  process.exit(1);
}

// --- 스킨: 단색만 (color 0xffffff 는 텍스처 스킨이라 색 충돌 대상이 아니다)
const skinBlock = /const SKINS = \[\n([\s\S]*?)\n\];/.exec(html);
if (!skinBlock) die('SKINS 배열을 못 찾았다');
const skins = [];
for (const line of skinBlock[1].split('\n')) {
  const id = /id:'(\w+)'/.exec(line);
  const color = /color:0x([0-9a-fA-F]{6})/.exec(line);
  const cost = /cost:\{([^}]*)\}/.exec(line);
  if (id && color) skins.push({ id: id[1], hex: color[1].toLowerCase(), cost: (cost?.[1] ?? '').trim() });
}
if (skins.length < 10) die(`스킨을 ${skins.length}종밖에 못 읽었다`);
const solid = skins.filter((s) => s.hex !== 'ffffff');

// --- 월드 오브젝트: 큐브 팔레트 + 경계/픽업/코인 머티리얼
const world = new Map();
const cubeBlock = /const CUBE_COLORS = \[([\s\S]*?)\n\];/.exec(html);
if (!cubeBlock) die('CUBE_COLORS 를 못 찾았다');
[...cubeBlock[1].matchAll(/THREE\.Color\((\d+)\/255, (\d+)\/255, (\d+)\/255\)/g)].forEach((m, i) =>
  world.set(`cube${i}`, [1, 2, 3].map((k) => Number(m[k]).toString(16).padStart(2, '0')).join('')),
);
for (const name of ['borderMaterial', 'freeBallItemMaterial', 'megaBallItemMaterial', 'coinMaterial']) {
  const at = html.indexOf(`const ${name} = new THREE.MeshStandardMaterial({`);
  if (at < 0) die(`${name} 를 못 찾았다`);
  const hex = /color:\s*0x([0-9a-fA-F]{6})/.exec(html.slice(at, at + 400));
  if (!hex) die(`${name} 의 color 를 못 읽었다`);
  world.set(name.replace('Material', ''), hex[1].toLowerCase());
}
if (world.size < 8) die(`월드 오브젝트를 ${world.size}종밖에 못 읽었다`);

// --- CIE Lab dE76
function lab(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  const X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const Y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const dE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

for (const s of solid)
  for (const [wk, wc] of world) {
    const d = dE(s.hex, wc);
    if (d < MIN_WORLD)
      fails.push(`[1] ${s.id}(${s.cost || '무료'}) #${s.hex} ↔ ${wk} #${wc} — dE ${d.toFixed(1)} < ${MIN_WORLD}`);
  }
for (let i = 0; i < solid.length; i++)
  for (let j = i + 1; j < solid.length; j++) {
    const d = dE(solid[i].hex, solid[j].hex);
    if (d < MIN_SKIN) fails.push(`[2] ${solid[i].id} ↔ ${solid[j].id} — dE ${d.toFixed(1)} < ${MIN_SKIN}`);
  }

// --- [3] StoreKit 상품 설명이 실제 지급량과 일치한다 -----------------------------
// 2026-08-20 실측: .storekit 의 4개 상품 설명이 전부 '5,000 coins' 였다.
// coins.30000 은 6배를 축소해 적고 있었고, 젬 상품 2개는 아예 코인이라고 적혀 있었다.
// 가격·SKU 는 맞아서 기존 SKU 대조 검증은 전부 통과한다 — 설명만 아무도 안 봤다.
{
  const storekitUrl = new URL('../Mobile/iOS/Snakeball/Snakeball.storekit', import.meta.url);
  let doc;
  try {
    doc = JSON.parse(readFileSync(storekitUrl, 'utf8'));
  } catch {
    die('Snakeball.storekit 을 읽지 못했다');
  }
  const storeBlock = /const STORE = \[\n([\s\S]*?)\n\];/.exec(html);
  if (!storeBlock) die('STORE 배열을 못 찾았다');
  const grants = new Map();
  for (const m of storeBlock[1].matchAll(/id:'([\w.]+)'[\s\S]{0,120}?grant:\{(\w+):(\d+)\}/g))
    grants.set(m[1], `${Number(m[3]).toLocaleString('en-US')} ${m[2]}`);
  if (grants.size < 3) die(`STORE 지급량을 ${grants.size}개밖에 못 읽었다`);

  let checked = 0;
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    if (node.productID && Array.isArray(node.localizations)) {
      const want = grants.get(node.productID);
      if (want)
        for (const loc of node.localizations) {
          checked++;
          if (loc.description !== want)
            fails.push(`[3] ${node.productID} 설명 '${loc.description}' ≠ 실제 지급 '${want}'`);
        }
    }
    Object.values(node).forEach(visit);
  };
  visit(doc);
  if (checked === 0) die('.storekit 에서 대조할 상품을 하나도 못 찾았다');
}

console.log(`스킨 ${skins.length}종(단색 ${solid.length}) · 월드 오브젝트 ${world.size}종 — ${solid.length * world.size + (solid.length * (solid.length - 1)) / 2}쌍 검사`);
if (fails.length) {
  console.error('\n' + fails.join('\n'));
  console.error(`\n❌ check:skins FAIL — ${fails.length}건`);
  process.exit(1);
}
console.log('✅ check:skins OK');
