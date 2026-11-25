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
import { openWorldSource, ARRAY_MUTATORS, COLOR_MUTATORS, MATERIAL_COLOR_MUTATORS } from './check-world-source.mjs';

const SRC = new URL('../index.html', import.meta.url);
const MIN_WORLD = 22; // 스킨 ↔ 월드 오브젝트 최소 dE76
const MIN_SKIN = 18;  // 스킨끼리 최소 dE76
const PICKUPS = ['freeBallItemMaterial', 'megaBallItemMaterial', 'coinMaterial'];

const fails = [];

function die(msg) {
  console.error(`check:skins 중단 — ${msg}\n  파서가 못 따라간 것이지 통과가 아니다.`);
  process.exit(1);
}

const w = await openWorldSource(SRC, die);
const html = w.html;

// --- 스킨: 유료(cost 비어 있지 않음) 단색(tex·rainbow 없음)만 비교한다
const skins = w.elements('SKINS').map((el, i) => {
  const p = w.props(el, `SKINS[${i}]`);
  const id = p.get('id');
  if (!w.isStr(id)) w.fail(id ?? el, `SKINS[${i}].id 는 문자열 리터럴이어야 한다`);
  const cost = w.props(p.get('cost'), `${id.value}.cost`, el);
  for (const [k, v] of cost) if (v.type !== 'Literal' || typeof v.value !== 'number') w.fail(v, `${id.value}.cost.${k} 는 숫자 리터럴이어야 한다`);
  const tex = p.get('tex');
  if (tex && !w.isStr(tex)) w.fail(tex, `${id.value}.tex 는 문자열 리터럴이어야 한다`);
  const rainbow = p.get('rainbow');
  if (rainbow && !(rainbow.type === 'Literal' && rainbow.value === true)) w.fail(rainbow, `${id.value}.rainbow 는 true 리터럴이어야 한다`);
  return {
    id: id.value,
    hex: w.hex(p.get('color'), `${id.value}.color`, el),
    cost: [...cost].map(([k, v]) => `${k}:${v.value}`).join(','),
    paid: cost.size > 0,
    solid: !tex && !rainbow,
  };
});
if (skins.length < 10) die(`스킨을 ${skins.length}종밖에 못 읽었다`);
const dupId = skins.find((s, i) => skins.findIndex((t) => t.id === s.id) !== i);
if (dupId) die(`SKINS 에 id '${dupId.id}' 가 두 번 있다`);
const solid = skins.filter((s) => s.paid && s.solid);

// --- 카탈로그 → 브리지 → 렌더러: 검사한 SKINS 가 실제로 공을 칠하는 것인지 직접 묶는다
{
  const skinsB = w.bindingsOf('SKINS')[0];
  const block = w.parent(skinsB.stmt);
  const asB = w.bindingsOf('activeSkin');
  const bad = (node, what) => w.fail(node, `카탈로그↔렌더러 연결이 다르다: ${what}`);
  if (!w.inModuleIife(skinsB.stmt)) bad(skinsB.id, 'SKINS 는 모듈 IIFE 본문의 const 여야 한다');
  if (asB.length !== 1 || asB[0].kind !== 'function' || w.parent(asB[0].stmt) !== block)
    bad(asB[0]?.id, 'activeSkin 은 SKINS 와 같은 IIFE 본문의 유일한 function 선언이어야 한다');
  const as = asB[0].decl;
  const r = as.params.length === 0 && as.body.body.length === 1 ? as.body.body[0].argument : null;
  const f = r?.type === 'LogicalExpression' && r.operator === '||' ? r.left : null;
  const cmp = f?.type === 'CallExpression' && w.isPath(f.callee, 'SKINS', ['find']) && f.arguments.length === 1 ? f.arguments[0].body : null;
  const sp = f?.arguments[0].params;
  const ok = cmp?.type === 'BinaryExpression' && cmp.operator === '===' && sp.length === 1 && sp[0].type === 'Identifier'
    && w.isPath(cmp.left, sp[0].name, ['id']) && w.isPath(cmp.right, 'state', ['skin'])
    && r.right.type === 'MemberExpression' && r.right.computed && w.isId(r.right.object, 'SKINS') && w.isNum(r.right.property, 0);
  if (!ok) bad(as, 'activeSkin 은 `return SKINS.find(s => s.id === state.skin) || SKINS[0];` 여야 한다');

  const sbSet = w.nodes.filter((n) => n.type === 'AssignmentExpression' && w.isPath(n.left, 'window', ['SB']));
  const sbOk = sbSet.length === 1 && sbSet[0].operator === '=' && w.parent(sbSet[0]).type === 'ExpressionStatement'
    && w.parent(w.parent(sbSet[0])) === block && sbSet[0].right.type === 'ObjectExpression'
    && sbSet[0].right.properties.every((p) => p.type === 'Property' && p.kind === 'init' && !p.computed && !p.method)
    && sbSet[0].right.properties.filter((p) => w.isId(p.key, 'activeSkin') || (w.isStr(p.key) && p.key.value === 'activeSkin'))
      .length === 1
    && sbSet[0].right.properties.some((p) => (w.isId(p.key, 'activeSkin') || (w.isStr(p.key) && p.key.value === 'activeSkin'))
      && w.isId(p.value, 'activeSkin'));
  if (!sbOk || w.bindingsOf('SB').length || w.bindingsOf('window').length)
    bad(sbSet[0], 'IIFE 본문의 유일한 `window.SB = { …, activeSkin, … }` (activeSkin 은 위 함수 그대로, SB·window 가려짐 없음) 여야 한다');

  const ap = w.requireFunction('applyActiveSkin');
  const b = ap.body.body;
  const sDecl = b[1]?.type === 'VariableDeclaration' && b[1].kind === 'const' && b[1].declarations.length === 1 ? b[1].declarations[0] : null;
  const mIdxs = b.flatMap((st, i) => i > 1 && st.type === 'VariableDeclaration' && st.kind === 'const' && st.declarations.length === 1
    && st.declarations[0].id.type === 'Identifier' && w.isPath(st.declarations[0].init, 'mainBallMesh', ['material']) ? [i] : []);
  const mAt = mIdxs.length === 1 ? mIdxs[0] : -1;
  const mDecl = mAt > 0 ? b[mAt].declarations[0] : null;
  const sName = sDecl?.id.type === 'Identifier' ? sDecl.id.name : null;
  const mName = mDecl?.id.type === 'Identifier' ? mDecl.id.name : null;
  const guard = b[0]?.type === 'IfStatement' && !b[0].alternate && b[0].test.type === 'UnaryExpression' && b[0].test.operator === '!'
    && w.isPath(b[0].test.argument, 'window', ['SB'])
    && (b[0].consequent.type === 'ReturnStatement'
      || (b[0].consequent.type === 'BlockStatement' && b[0].consequent.body.length === 1 && b[0].consequent.body[0].type === 'ReturnStatement'));
  const call = sDecl?.init;
  const setAt = b.filter((st) => {
    const c = st.type === 'ExpressionStatement' ? st.expression : null;
    return mName && c?.type === 'CallExpression' && w.isPath(c.callee, mName, ['color', 'setHex']) && c.arguments.length === 1
      && sName && w.isPath(c.arguments[0], sName, ['color']);
  });
  if (!guard || !sName || !mName || call?.type !== 'CallExpression' || !w.isPath(call.callee, 'SB', ['activeSkin']) || call.arguments.length
    || setAt.length !== 1 || b.indexOf(setAt[0]) < mAt
    || b.some((st, i) => i > 0 && st.type === 'ReturnStatement' && b.indexOf(setAt[0]) > i))
    bad(ap, 'applyActiveSkin 본문 최상위에 `if (!window.SB) return;` · `const s = SB.activeSkin();` · '
      + '`const m = mainBallMesh.material;` · `m.color.setHex(s.color)` 가 순서대로 있어야 한다');
  if (!w.refsOutside(ap)) bad(ap, 'applyActiveSkin 을 부르는 곳이 없다');
}

// --- 월드 오브젝트: AFFORD_COLORS 4 + PALETTES border 4 + 픽업 머티리얼 3
const world = new Map();
w.elements('AFFORD_COLORS', 4).forEach((el, i) => world.set(`afford${i}`, w.newColor(el, `AFFORD_COLORS[${i}]`)));
const palettes = w.palettes();
palettes.forEach((p, i) => world.set(`border${i}(${p.name})`, p.border));
for (const name of PICKUPS) {
  const m = w.material(name);
  world.set(name.replace('Material', ''), w.hex(m.props.get('color'), `${name}.color`, m.init));
}
if (world.size !== 11) die(`월드 오브젝트가 ${world.size}종이다 — 11종이어야 한다`);

// 실제 큐브 칠하기가 AFFORD_COLORS 를 쓰는지 (죽은 복제 표를 검사하지 않도록)
{
  const fn = w.requireFunction('paintCube');
  const cube = fn.params[0];
  const body = fn.body.body;
  let mat;
  const matAt = body.findIndex((st) => st.type === 'VariableDeclaration' && st.kind === 'const' && st.declarations.length === 1
    && st.declarations[0].id.type === 'Identifier' && cube?.type === 'Identifier'
    && w.isPath(st.declarations[0].init, cube.name, ['mesh', 'material']) && (mat = st.declarations[0].id.name));
  const tierAt = body.findIndex((st) => st.type === 'VariableDeclaration' && st.kind === 'const'
    && st.declarations.some((d) => w.isId(d.id, 'tier')));
  const copyAt = body.flatMap((st, i) => {
    const c = st.type === 'ExpressionStatement' ? st.expression : null;
    const a = c?.arguments?.[0];
    return c?.type === 'CallExpression' && w.isPath(c.callee, mat, ['color', 'copy']) && c.arguments.length === 1
      && a.type === 'MemberExpression' && a.computed && w.isId(a.object, 'AFFORD_COLORS') && w.isId(a.property, 'tier') ? [i] : [];
  });
  const earlyReturn = body.findIndex((st) => st.type === 'ReturnStatement');
  if (matAt < 0 || tierAt < 0 || copyAt.length !== 1 || copyAt[0] < Math.max(matAt, tierAt)
    || (earlyReturn !== -1 && earlyReturn < copyAt[0]))
    w.fail(fn, 'paintCube 본문 최상위에 `const m = cube.mesh.material` · `const tier = …` 뒤 '
      + '`m.color.copy(AFFORD_COLORS[tier])` 가 정확히 한 번 있어야 한다');
  if (!w.refsOutside(fn)) w.fail(fn, 'paintCube 를 부르는 곳이 없다');
}

w.forbidWrites([
  { name: 'SKINS', under: [], methods: ARRAY_MUTATORS },
  { name: 'AFFORD_COLORS', under: [], methods: new Set([...ARRAY_MUTATORS, ...COLOR_MUTATORS]) },
  ...PICKUPS.map((name) => ({ name, under: ['color'], methods: MATERIAL_COLOR_MUTATORS })),
], `SKINS · AFFORD_COLORS · ${PICKUPS.map((n) => n + '.color').join(' · ')}`);

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

const accents = palettes.filter((p) => p.accent !== undefined).length;
console.log(`스킨 ${skins.length}종(유료 단색 ${solid.length}: ${solid.map((s) => s.id).join(' ')}) · 월드 오브젝트 ${world.size}종 — ${solid.length * world.size + (solid.length * (solid.length - 1)) / 2}쌍 검사`);
console.log(`  월드 기준 = AFFORD_COLORS 4 + PALETTES border 4 + ${PICKUPS.join(' · ')}`);
console.log(`  기준에 넣지 않은 PALETTES 키: lane(check:road 대비 판정) · top · horizon${accents ? ` · accent(${accents}개)` : ''}`);
if (fails.length) {
  console.error('\n' + fails.join('\n'));
  console.error(`\n❌ check:skins FAIL — ${fails.length}건`);
  process.exit(1);
}
console.log('✅ check:skins OK');
