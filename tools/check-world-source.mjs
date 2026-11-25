// check:skins · check:road 공용 — index.html 의 인라인 <script type="module"> 을 acorn 으로
// 파싱해 검사 대상 선언을 AST 로 찾는다. 코드는 실행하지 않는다. 주석·문자열은 AST 에 없으므로
// 저절로 건너뛴다. 모양이 예상과 다르면 die(메시지) 로 멈춘다 — die 는 돌아오면 안 된다.
import { readFileSync } from 'node:fs';

export const ARRAY_MUTATORS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']);
export const COLOR_MUTATORS = new Set([
  'set', 'setHex', 'setRGB', 'setHSL', 'setStyle', 'setColorName', 'setScalar', 'setFromVector3', 'copy',
  'copySRGBToLinear', 'copyLinearToSRGB', 'convertSRGBToLinear', 'convertLinearToSRGB', 'lerp', 'lerpColors',
  'lerpHSL', 'offsetHSL', 'add', 'addColors', 'addScalar', 'sub', 'multiply', 'multiplyScalar', 'fromArray',
  'fromBufferAttribute', 'applyMatrix3',
]);
export const VECTOR_MUTATORS = new Set([
  'set', 'setX', 'setY', 'setScalar', 'setComponent', 'copy', 'add', 'addScalar', 'addVectors', 'addScaledVector',
  'sub', 'subScalar', 'subVectors', 'multiply', 'multiplyScalar', 'divide', 'divideScalar', 'negate', 'lerp',
  'lerpVectors', 'fromArray', 'fromBufferAttribute', 'clamp', 'clampScalar', 'clampLength', 'floor', 'ceil', 'round',
  'roundToZero', 'applyMatrix3', 'rotateAround', 'normalize', 'setLength', 'min', 'max', 'random',
]);
export const MATERIAL_COLOR_MUTATORS = new Set([...COLOR_MUTATORS, 'setValues']);
const REFLECTIVE = new Set([
  'Object.assign', 'Object.defineProperty', 'Object.defineProperties', 'Object.setPrototypeOf',
  'Reflect.set', 'Reflect.defineProperty', 'Reflect.deleteProperty', 'Reflect.setPrototypeOf',
]);

export async function openWorldSource(url, die) {
  const stop = (msg) => { die(msg); throw new Error(msg); };

  let parse;
  try {
    ({ parse } = await import('acorn'));
  } catch (e) {
    stop(`acorn 을 불러오지 못했다 — devDependency acorn ^8.16.0 이 설치돼 있어야 한다 (${e.code ?? e.message})`);
  }
  let html;
  try {
    html = readFileSync(url, 'utf8');
  } catch (e) {
    stop(`${url.pathname} 을 읽지 못했다 (${e.code ?? e.message})`);
  }

  // --- 위치 표시: 모듈 내부 오프셋 → index.html 줄:열 + 그 줄 원문
  const lineStarts = [0];
  for (let i = html.indexOf('\n'); i !== -1; i = html.indexOf('\n', i + 1)) lineStarts.push(i + 1);
  const whereOff = (off) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= off) lo = mid; else hi = mid - 1;
    }
    const end = html.indexOf('\n', lineStarts[lo]);
    const text = html.slice(lineStarts[lo], end === -1 ? undefined : end).trim().slice(0, 100);
    return `index.html:${lo + 1}:${off - lineStarts[lo] + 1}  ${text}`;
  };
  const modOf = new WeakMap();
  const parentOf = new WeakMap();
  const where = (node) => whereOff(modOf.get(node).start + node.start);
  const fail = (node, msg) => stop(node ? `${msg}\n  위치 ${where(node)}` : msg);

  // --- 인라인 모듈 추출 (src 있는 스크립트·고전 스크립트·HTML 주석 안의 태그는 제외)
  const modules = [];
  const tagRe = /<!--[\s\S]*?-->|<script\b([^>]*)>/gi;
  for (let m; (m = tagRe.exec(html)); ) {
    if (m[1] === undefined) continue;
    const start = m.index + m[0].length;
    const endRe = /<\/script[\s/>]/gi;
    endRe.lastIndex = start;
    const end = endRe.exec(html);
    if (!end) stop(`닫히지 않은 <script> — ${whereOff(m.index)}`);
    tagRe.lastIndex = end.index;
    const attrs = new Map();
    for (const a of m[1].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))
      attrs.set(a[1].toLowerCase(), (a[2] ?? a[3] ?? a[4] ?? '').trim().toLowerCase());
    if (attrs.has('src') || attrs.get('type') !== 'module') continue;
    let ast;
    try {
      ast = parse(html.slice(start, end.index), { ecmaVersion: 'latest', sourceType: 'module' });
    } catch (e) {
      stop(`인라인 모듈 #${modules.length + 1} 을 acorn 이 파싱하지 못했다: ${e.message}\n  위치 ${whereOff(start + (e.pos ?? 0))}`);
    }
    modules.push({ index: modules.length + 1, start, ast });
  }
  if (!modules.length) stop('index.html 에서 인라인 <script type="module"> 을 하나도 찾지 못했다');

  // --- 전체 노드 · 부모 · 모든 바인딩(선언/매개변수/import/catch/class) 수집
  const nodes = [];
  const bindings = new Map();
  const ids = (p, out = []) => {
    if (!p) return out;
    if (p.type === 'Identifier') out.push(p);
    else if (p.type === 'ObjectPattern') for (const q of p.properties) ids(q.type === 'RestElement' ? q.argument : q.value, out);
    else if (p.type === 'ArrayPattern') for (const q of p.elements) ids(q, out);
    else if (p.type === 'AssignmentPattern') ids(p.left, out);
    else if (p.type === 'RestElement') ids(p.argument, out);
    return out;
  };
  const bind = (id, kind, decl, stmt) => {
    if (!bindings.has(id.name)) bindings.set(id.name, []);
    bindings.get(id.name).push({ id, kind, decl, stmt });
  };
  const visit = (node, parent, mod) => {
    modOf.set(node, mod);
    parentOf.set(node, parent);
    nodes.push(node);
    switch (node.type) {
      case 'VariableDeclaration':
        for (const d of node.declarations) for (const id of ids(d.id)) bind(id, node.kind, d, node);
        break;
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression':
        if (node.id) bind(node.id, node.type === 'FunctionDeclaration' ? 'function' : 'function-expression', node, node);
        for (const p of node.params) for (const id of ids(p)) bind(id, 'param', node, node);
        break;
      case 'ClassDeclaration': case 'ClassExpression':
        if (node.id) bind(node.id, 'class', node, node);
        break;
      case 'CatchClause':
        for (const id of ids(node.param)) bind(id, 'catch', node, node);
        break;
      case 'ImportSpecifier': case 'ImportDefaultSpecifier': case 'ImportNamespaceSpecifier':
        bind(node.local, 'import', node, node);
        break;
    }
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') visit(c, node, mod); }
      else if (v && typeof v.type === 'string') visit(v, node, mod);
    }
  };
  for (const mod of modules) visit(mod.ast, null, mod);

  // --- 모양 술어
  const isId = (n, name) => n?.type === 'Identifier' && n.name === name;
  const isNum = (n, v) => n?.type === 'Literal' && n.value === v;
  const isStr = (n) => n?.type === 'Literal' && typeof n.value === 'string';
  const chain = (n) => {
    const path = [];
    while (n?.type === 'MemberExpression') {
      const p = n.property;
      path.unshift(!n.computed ? p.name : p.type === 'Literal' ? String(p.value) : '*');
      n = n.object;
    }
    return n?.type === 'Identifier' ? { root: n.name, path } : null;
  };
  const isPath = (n, root, path) => {
    const c = chain(n);
    return !!c && c.root === root && c.path.length === path.length && c.path.every((p, i) => p === path[i]);
  };
  const within = (n, outer) => modOf.get(n) === modOf.get(outer) && n.start >= outer.start && n.end <= outer.end;

  // --- 선언 해석: 이름당 바인딩이 정확히 하나, 모듈 최상위, 모든 검사 대상이 같은 모듈
  let home = null;
  const settle = (b, name) => {
    const m = modOf.get(b.id);
    if (!home) home = m;
    else if (home !== m) fail(b.id, `${name} 이 인라인 모듈 #${m.index} 에 있다 — 검사 대상 선언은 모두 모듈 #${home.index} 에 있어야 한다`);
  };
  const topLevel = (stmt) => {
    const p = parentOf.get(stmt);
    return p?.type === 'Program' || (p?.type === 'ExportNamedDeclaration' && parentOf.get(p)?.type === 'Program');
  };
  const unique = (name) => {
    const list = bindings.get(name) ?? [];
    if (!list.length) stop(`${name} 선언을 인라인 모듈에서 찾지 못했다`);
    if (list.length > 1)
      fail(list[1].id, `${name} 바인딩이 ${list.length}개다 (첫째 ${where(list[0].id)}) — 유일해야 어느 값이 쓰이는지 정해진다`);
    return list[0];
  };
  // 모듈 최상위 `(function () { … })();` — 모듈 최상위 ExpressionStatement 가 직접 호출하는 일반 함수 표현식의 본문 직계 문장인가
  const inModuleIife = (stmt) => {
    const block = parentOf.get(stmt);
    const fn = block?.type === 'BlockStatement' ? parentOf.get(block) : null;
    if (fn?.type !== 'FunctionExpression' || fn.async || fn.generator || fn.body !== block) return false;
    const call = parentOf.get(fn);
    if (call?.type !== 'CallExpression' || call.callee !== fn) return false;
    const es = parentOf.get(call);
    return es?.type === 'ExpressionStatement' && es.expression === call && parentOf.get(es)?.type === 'Program';
  };
  const requireConst = (name, type) => {
    const b = unique(name);
    // SKINS 만 별도 카탈로그 모듈의 IIFE 본문 직계도 허용하고, 렌더러 홈(settle)은 강제하지 않는다.
    const skins = name === 'SKINS';
    if (b.kind !== 'const' || b.decl.id !== b.id || !(topLevel(b.stmt) || (skins && inModuleIife(b.stmt))))
      fail(b.id, `${name} 는 모듈 최상위 \`const ${name} = …\` 여야 한다 (지금 ${b.kind} 바인딩)`);
    if (!skins) settle(b, name);
    const init = b.decl.init;
    if (!init) fail(b.id, `${name} 에 초기값이 없다`);
    if (type && init.type !== type) fail(init, `${name} 의 초기값은 ${type} 여야 한다 (지금 ${init.type})`);
    return init;
  };
  const requireFunction = (name) => {
    const b = unique(name);
    if (b.kind !== 'function' || !topLevel(b.stmt)) fail(b.id, `${name} 는 모듈 최상위 function 선언이어야 한다 (지금 ${b.kind} 바인딩)`);
    settle(b, name);
    return b.decl;
  };
  const refsOutside = (fn) => nodes.filter((n) => {
    if (!isId(n, fn.id.name) || n === fn.id || within(n, fn)) return false;
    const p = parentOf.get(n);
    if (p?.type === 'MemberExpression' && p.property === n && !p.computed) return false;
    if (p?.type === 'Property' && p.key === n && !p.computed && !p.shorthand) return false;
    return true;
  }).length;

  // --- 값 읽기
  const hexStr = (v) => v.toString(16).padStart(6, '0');
  const isHex = (n) => n?.type === 'Literal' && Number.isInteger(n.value) && n.value >= 0 && n.value <= 0xffffff;
  const hex = (n, what, ctx) => {
    if (!isHex(n)) fail(n ?? ctx, `${what} 는 0xRRGGBB 숫자 리터럴이어야 한다`);
    return hexStr(n.value);
  };
  const newColor = (n, what) => {
    if (n?.type !== 'NewExpression' || !isPath(n.callee, 'THREE', ['Color']) || n.arguments.length !== 1)
      fail(n, `${what} 는 new THREE.Color(0xRRGGBB) 여야 한다`);
    return hex(n.arguments[0], what, n);
  };
  const elements = (name, count) => {
    const arr = requireConst(name, 'ArrayExpression');
    if (arr.elements.some((e) => !e || e.type === 'SpreadElement')) fail(arr, `${name} 에 빈 칸이나 펼침(...)이 있다`);
    if (count !== undefined && arr.elements.length !== count) fail(arr, `${name} 는 정확히 ${count}개여야 한다 (지금 ${arr.elements.length})`);
    return arr.elements;
  };
  const props = (n, what, ctx) => {
    if (n?.type !== 'ObjectExpression') fail(n ?? ctx, `${what} 는 객체 리터럴이어야 한다`);
    const out = new Map();
    for (const p of n.properties) {
      if (p.type !== 'Property' || p.kind !== 'init' || p.computed || p.method || p.shorthand)
        fail(p, `${what} 에 펼침·계산 키·메서드·축약 속성이 있다 — 값을 정적으로 확정할 수 없다`);
      const key = p.key.type === 'Identifier' ? p.key.name : String(p.key.value);
      if (out.has(key)) fail(p, `${what} 에 ${key} 키가 두 번 있다`);
      out.set(key, p.value);
    }
    return out;
  };
  const material = (name) => {
    const init = requireConst(name, 'NewExpression');
    if (!isPath(init.callee, 'THREE', ['MeshStandardMaterial']) || init.arguments.length !== 1)
      fail(init, `${name} 는 new THREE.MeshStandardMaterial({…}) 여야 한다`);
    return { init, props: props(init.arguments[0], name, init) };
  };

  // --- 직접 변이 탐지 (범위 한정: 별칭 추적 없음)
  // targets: [{ name, under: [경로 접두], methods: Set }] — 경로가 서로 접두 관계면 같은 대상이다.
  const related = (a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i] && a[i] !== '*' && b[i] !== '*') return false;
    return true;
  };
  const writes = (targets, allowed = new Set()) => {
    const hitBy = (n, method) => {
      const c = chain(n);
      return !!c && targets.some((t) => t.name === c.root && related(c.path, t.under) && (method === undefined || t.methods.has(method)));
    };
    return nodes.filter((n) => {
      if (allowed.has(n)) return false;
      if (n.type === 'AssignmentExpression') return hitBy(n.left);
      if (n.type === 'UpdateExpression') return hitBy(n.argument);
      if (n.type === 'UnaryExpression' && n.operator === 'delete') return hitBy(n.argument);
      if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression') {
        const c = chain(n.callee);
        if (c && REFLECTIVE.has(`${c.root}.${c.path.join('.')}`)) return !!n.arguments[0] && hitBy(n.arguments[0]);
        const p = n.callee.property;
        const method = !n.callee.computed ? p.name : isStr(p) ? p.value : null;
        return method !== null && hitBy(n.callee.object, method);
      }
      return false;
    });
  };
  const forbidWrites = (targets, label) => {
    const hits = writes(targets);
    if (hits.length) stop(`${label} 을 소스 다른 곳에서 직접 바꾼다 — 선언값만 보는 판정을 믿을 수 없다:\n`
      + hits.map((n) => `  위치 ${where(n)}`).join('\n'));
  };

  // --- 팔레트: PALETTES 4레코드 + 시작 머티리얼 바인딩 + applyPalette 의 lane/border 경로
  const palettes = () => {
    const BASE = ['name', 'top', 'horizon', 'lane', 'border'];
    const els = elements('PALETTES', 4);
    const list = els.map((el, i) => {
      const p = props(el, `PALETTES[${i}]`);
      const missing = BASE.filter((k) => !p.has(k));
      const extra = [...p.keys()].filter((k) => !BASE.includes(k) && k !== 'accent');
      if (missing.length || extra.length)
        fail(el, `PALETTES[${i}] 키가 다르다 — 없음 [${missing}] · 모르는 키 [${extra}] (허용: ${BASE.join('/')} + accent)`);
      if (!isStr(p.get('name'))) fail(p.get('name'), `PALETTES[${i}].name 은 문자열 리터럴이어야 한다`);
      const rec = { name: p.get('name').value };
      for (const k of ['top', 'horizon', 'lane', 'border', 'accent']) if (p.has(k)) rec[k] = hex(p.get(k), `PALETTES[${i}].${k}`, el);
      return rec;
    });
    // accent: 전부 있거나 전부 없어야 한다. 실제 AST 가 pal.accent 를 읽으면 4개 모두 필수.
    const accentN = list.filter((rec) => rec.accent !== undefined).length;
    const usesAccent = nodes.some((n) => n.type === 'MemberExpression' && isPath(n, 'pal', ['accent']));
    if (accentN !== 0 && accentN !== 4)
      fail(els[0], `PALETTES accent 가 ${accentN}/4 개만 있다 — 전부 있거나 전부 없어야 한다`);
    if (usesAccent && accentN !== 4)
      fail(els[0], `소스가 pal.accent 를 읽는데 PALETTES accent 가 ${accentN}/4 개다 — 4개 모두 0xRRGGBB 로 있어야 한다`);
    const seen = new Set();
    list.forEach((rec, i) => {
      if (seen.has(rec.name)) fail(els[i], `PALETTES 에 단계 이름 ${JSON.stringify(rec.name)} 이 두 번 있다 — 이름은 유일해야 한다`);
      seen.add(rec.name);
    });

    const line = material('roadLineMaterial');
    if (!isPath(line.props.get('color'), 'PALETTES', ['0', 'lane']))
      fail(line.props.get('color') ?? line.init, 'roadLineMaterial 의 color 는 PALETTES[0].lane 이어야 한다');
    const border = material('borderMaterial');
    const bc = border.props.get('color');
    if (!isPath(bc, 'PALETTES', ['0', 'border']) && !(isHex(bc) && hexStr(bc.value) === list[0].border))
      fail(bc ?? border.init, `borderMaterial 의 color 는 PALETTES[0].border 또는 같은 값 리터럴 0x${list[0].border} 이어야 한다`);

    // lerpHex(a, b, t, out) { return out.set(a).lerp(<scratch>.set(b), t); }
    const lh = requireFunction('lerpHex');
    const [la, lb, lt, lo] = lh.params;
    const setCall = (n, objOk, arg) => n?.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed
      && n.callee.property.name === 'set' && n.callee.object.type === 'Identifier' && objOk(n.callee.object.name)
      && n.arguments.length === 1 && isId(n.arguments[0], arg);
    const r = lh.body.body[0]?.argument;
    if (lh.params.length !== 4 || !lh.params.every((p) => p.type === 'Identifier') || lh.body.body.length !== 1
      || lh.body.body[0].type !== 'ReturnStatement' || r?.type !== 'CallExpression' || r.callee.type !== 'MemberExpression'
      || r.callee.computed || r.callee.property.name !== 'lerp' || r.arguments.length !== 2 || !isId(r.arguments[1], lt.name)
      || !setCall(r.callee.object, (o) => o === lo.name, la.name) || !setCall(r.arguments[0], (o) => o !== lo.name, lb.name))
      fail(lh, 'lerpHex 는 `function lerpHex(a, b, t, out) { return out.set(a).lerp(_cB.set(b), t); }` 모양이어야 한다');

    const cA = requireConst('_cA', 'NewExpression');
    if (!isPath(cA.callee, 'THREE', ['Color']) || cA.arguments.length) fail(cA, '_cA 는 new THREE.Color() 여야 한다');

    const ap = requireFunction('applyPalette');
    const [pa, pb, pt] = ap.params;
    if (ap.params.length !== 3 || !ap.params.every((p) => p.type === 'Identifier')) fail(ap, 'applyPalette(a, b, t) 매개변수 모양이 다르다');
    const body = ap.body.body;
    const lerpTo = (key, outOk) => body.flatMap((st, i) => {
      const c = st.type === 'ExpressionStatement' ? st.expression : null;
      return c?.type === 'CallExpression' && isId(c.callee, 'lerpHex') && c.arguments.length === 4
        && isPath(c.arguments[0], pa.name, [key]) && isPath(c.arguments[1], pb.name, [key])
        && isId(c.arguments[2], pt.name) && outOk(c.arguments[3]) ? [i] : [];
    });
    const laneAt = lerpTo('lane', (n) => isPath(n, 'roadLineMaterial', ['color']));
    const borderAt = lerpTo('border', (n) => isId(n, '_cA'));
    const loop = body[borderAt[0] + 1];
    const loopOk = loop?.type === 'ForOfStatement' && isId(loop.right, 'borderMats') && loop.left.type === 'VariableDeclaration'
      && loop.left.declarations.length === 1 && loop.left.declarations[0].id.type === 'Identifier'
      && loop.body.type === 'BlockStatement' && loop.body.body.some((st) => st.type === 'ExpressionStatement'
        && st.expression.type === 'CallExpression' && isPath(st.expression.callee, loop.left.declarations[0].id.name, ['color', 'copy'])
        && st.expression.arguments.length === 1 && isId(st.expression.arguments[0], '_cA'));
    const lastAt = borderAt[0] + 1;
    const earlyReturn = body.findIndex((st) => st.type === 'ReturnStatement');
    if (laneAt.length !== 1 || borderAt.length !== 1 || !loopOk || (earlyReturn !== -1 && earlyReturn < lastAt))
      fail(ap, 'applyPalette 본문 최상위에 `lerpHex(a.lane, b.lane, t, roadLineMaterial.color)` 한 번, '
        + '`lerpHex(a.border, b.border, t, _cA)` 한 번, 바로 뒤 `for (const m of borderMats) { m.color.copy(_cA); … }` 가 있어야 한다 '
        + `(찾음: lane ${laneAt.length} · border ${borderAt.length} · 경계 루프 ${loopOk ? 1 : 0})`);
    if (!refsOutside(ap)) fail(ap, 'applyPalette 를 부르는 곳이 없다');

    forbidWrites([
      { name: 'PALETTES', under: [], methods: new Set([...ARRAY_MUTATORS, ...COLOR_MUTATORS]) },
      { name: 'roadLineMaterial', under: ['color'], methods: MATERIAL_COLOR_MUTATORS },
      { name: 'borderMaterial', under: ['color'], methods: MATERIAL_COLOR_MUTATORS },
    ], 'PALETTES · roadLineMaterial.color · borderMaterial.color');
    return list;
  };

  return {
    html, nodes, fail, stop, where, isId, isNum, isStr, isPath, chain,
    parent: (n) => parentOf.get(n), bindingsOf: (name) => bindings.get(name) ?? [], inModuleIife,
    requireConst, requireFunction, refsOutside, hex, newColor, elements, props, material, writes, forbidWrites, palettes,
  };
}
