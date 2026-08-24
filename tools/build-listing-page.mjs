#!/usr/bin/env node
// docs/store-listing.md → 붙여넣기용 웹 페이지 한 장.
//
//   node tools/build-listing-page.mjs <출력.html>
//
// **손으로 옮겨 적지 않는다.** 39개 필드를 HTML 에 다시 타이핑하면 반드시 어긋난다.
// 마크다운을 파싱해 생성하므로 문구를 고치면 이 페이지도 같이 바뀐다.
// 파서는 tools/check-store-listing.mjs 와 같은 규칙을 쓴다(### 헤딩 + 다음 코드펜스).

import { readFileSync, writeFileSync } from 'node:fs';

const DOC = new URL('../docs/store-listing.md', import.meta.url);
const out = process.argv[2];
if (!out) {
  console.error('사용법: node tools/build-listing-page.mjs <출력.html>');
  process.exit(1);
}
const doc = readFileSync(DOC, 'utf8');

// ── 파싱: 언어(#) → 스토어(##) → 필드(###) ─────────────────────────────────
const LANGS = [
  { key: 'ko', flag: '🇰🇷', label: '한국어', note: 'App Store 한국어 · Play 한국어 · Apps in Toss' },
  { key: 'en', flag: '🇺🇸', label: 'English', note: 'App Store English (U.S.) · Play en-US — 기본 로케일' },
  { key: 'ja', flag: '🇯🇵', label: '日本語', note: 'App Store 日本語 · Play ja-JP' },
  { key: 'zh', flag: '🇹🇼', label: '繁體中文', note: '대만·홍콩 각각 업로드 (zh-TW / zh-HK)' },
];

const lines = doc.split('\n');
const sections = [];
let lang = null;
let store = null;
for (let i = 0; i < lines.length; i++) {
  const L = lines[i];
  const h1 = /^# (🇰🇷|🇺🇸|🇯🇵|🇹🇼🇭🇰) /.exec(L);
  if (h1) {
    const key = { '🇰🇷': 'ko', '🇺🇸': 'en', '🇯🇵': 'ja', '🇹🇼🇭🇰': 'zh' }[h1[1]];
    lang = { key, stores: [] };
    sections.push(lang);
    store = null;
    continue;
  }
  const h2 = /^## (.+)$/.exec(L);
  if (h2 && lang) {
    store = { name: h2[1].trim(), fields: [] };
    lang.stores.push(store);
    continue;
  }
  const h3 = /^### (.+?) — ([\d,]+)자(?: \/ ([\d,]+))?(.*)$/.exec(L);
  if (h3 && store) {
    // 다음 코드펜스가 값이다
    let j = i + 1;
    while (j < lines.length && lines[j] !== '```') j++;
    let k = j + 1;
    const buf = [];
    while (k < lines.length && lines[k] !== '```') buf.push(lines[k++]);
    // 펜스 뒤의 인용문(> …)은 그 필드에 대한 주석이다
    let m = k + 1;
    const notes = [];
    while (m < lines.length && (lines[m].startsWith('>') || lines[m].trim() === '')) {
      if (lines[m].startsWith('>')) notes.push(lines[m].replace(/^>\s?/, ''));
      else if (notes.length) break;
      m++;
    }
    store.fields.push({
      name: h3[1].trim(),
      count: Number(h3[2].replace(/,/g, '')),
      limit: h3[3] ? Number(h3[3].replace(/,/g, '')) : null,
      extra: h3[4].trim(),
      value: buf.join('\n'),
      note: notes.join(' ').trim(),
    });
  }
}
const total = sections.reduce((n, l) => n + l.stores.reduce((m, s) => m + s.fields.length, 0), 0);
if (total < 36) {
  console.error(`필드를 ${total}개밖에 못 찾았다 — 문서 구조가 바뀌었는지 보라`);
  process.exit(1);
}

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── 렌더 ────────────────────────────────────────────────────────────────────
// 문서 docs/app-name-candidates.md §6 에서 실측으로 확인된 지뢰. 값에 들어 있으면 카드에 띄운다.
// (문구를 자동으로 고치지는 않는다 — 이름이 확정돼야 대체어를 정할 수 있다.)
const CAUTIONS = [
  [/滾球/, '⚠️ 滾球 — 대만·홍콩에서 페탕크/보체 종목명이자 滾球盤(스포츠 라이브 베팅) 용어다. 이름 확정 때 다른 말로 바꿀 것.'],
  [/推土機/, '⚠️ 推土機 — 대만에서 강제철거 관련 정치 기억과 붙는다. 쓰지 말 것.'],
];
const cautions = (f) => CAUTIONS.filter(([re]) => re.test(f.value)).map(([, m]) => m);

const card = (f) => {
  const pct = f.limit ? Math.min(100, Math.round((f.count / f.limit) * 100)) : null;
  const state = pct === null ? '' : pct >= 93 ? ' is-tight' : pct >= 80 ? ' is-near' : '';
  const isName = /Name|앱 이름/.test(f.name);
  return `<article class="field${state}${isName ? ' is-name' : ''}">
  <header class="field-head">
    <h4>${esc(f.name)}</h4>
    <div class="gauge">
      ${
        f.limit
          ? `<div class="bar" role="img" aria-label="${f.count} / ${f.limit}자"><span style="width:${pct}%"></span></div>
         <span class="num"><b>${f.count.toLocaleString()}</b><i>/${f.limit.toLocaleString()}</i></span>`
          : `<span class="num"><b>${f.count.toLocaleString()}</b><i>자</i></span>`
      }
    </div>
    <button class="copy" type="button" data-copy>복사</button>
  </header>
  <pre class="value" tabindex="0"${isName ? ' data-name-field' : ''}>${esc(f.value)}</pre>
  ${cautions(f).map((c) => `<p class="note is-caution">${esc(c)}</p>`).join('')}
  ${f.note ? `<p class="note">${esc(f.note)}</p>` : ''}
</article>`;
};

const langPanel = (l) => {
  const meta = LANGS.find((x) => x.key === l.key);
  return `<section class="panel" id="panel-${l.key}" role="tabpanel" aria-labelledby="tab-${l.key}" hidden>
  <p class="locale-note">${esc(meta.note)}</p>
  ${l.stores
    .map(
      (s) => `<section class="store">
    <h3>${esc(s.name)}</h3>
    <div class="fields">${s.fields.map(card).join('\n')}</div>
  </section>`,
    )
    .join('\n')}
</section>`;
};

const html = `<meta charset="utf-8">
<title>스토어 문구 대조표</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{
  --ground:#f5f8f8; --surface:#fff; --surface-2:#eaf0ef; --sunk:#f0f4f4;
  --ink:#0f1718; --ink-2:#48585a; --ink-3:#7a8a8b;
  --line:#dae3e2; --line-2:#c3d0cf;
  --accent:#0d9a76; --accent-ink:#076b52; --accent-soft:#d8f1e9;
  --near:#a9702c; --tight:#ad3f2e;
  --sans:'Archivo',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  --mono:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  --cjk:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Hiragino Sans','PingFang TC','Noto Sans CJK',sans-serif;
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --ground:#0b0f10; --surface:#141b1c; --surface-2:#1c2526; --sunk:#101718;
    --ink:#e8f0ef; --ink-2:#a2b2b1; --ink-3:#6f7e7e;
    --line:#25302f; --line-2:#33403f;
    --accent:#5ceec6; --accent-ink:#8ff5da; --accent-soft:#0f2e26;
    --near:#dda86a; --tight:#ef8f7c;
  }
}
:root[data-theme="dark"]{
  --ground:#0b0f10; --surface:#141b1c; --surface-2:#1c2526; --sunk:#101718;
  --ink:#e8f0ef; --ink-2:#a2b2b1; --ink-3:#6f7e7e;
  --line:#25302f; --line-2:#33403f;
  --accent:#5ceec6; --accent-ink:#8ff5da; --accent-soft:#0f2e26;
  --near:#dda86a; --tight:#ef8f7c;
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--ground); color:var(--ink);
  font-family:var(--sans); font-size:15px; line-height:1.55;
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px 96px}
/* sticky 헤더 안의 .wrap 은 아래 여백을 물려받으면 안 된다 — 빈 띠가 생긴다 */
.top .wrap{padding-bottom:0}

/* ── 헤더 ── */
.top{
  position:sticky; top:0; z-index:20; background:var(--ground);
  border-bottom:1px solid var(--line); padding-top:26px;
}
.title{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px 16px;margin:0 0 4px}
.title h1{font-size:22px;font-weight:700;letter-spacing:-.01em;margin:0;text-wrap:balance}
.title .count{font-family:var(--mono);font-size:12px;color:var(--ink-3);font-variant-numeric:tabular-nums}
.sub{margin:0 0 16px;color:var(--ink-2);font-size:13.5px;max-width:64ch}
.sub code{font-family:var(--mono);font-size:12.5px;background:var(--surface-2);padding:1px 5px;border-radius:4px}

.controls{display:flex;flex-wrap:wrap;gap:14px 22px;align-items:center;padding-bottom:14px}
.tabs{display:flex;gap:4px;flex-wrap:wrap}
.tabs button{
  font:inherit;font-weight:600;font-size:13.5px;color:var(--ink-2);
  background:none;border:1px solid transparent;border-radius:7px;
  padding:6px 12px;cursor:pointer;display:flex;gap:7px;align-items:center;
}
.tabs button:hover{color:var(--ink);background:var(--surface-2)}
.tabs button[aria-selected="true"]{background:var(--surface);border-color:var(--line-2);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.04)}
.tabs button:focus-visible,.copy:focus-visible,.swap:focus-visible,.value:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

.swapwrap{display:flex;align-items:center;gap:9px;margin-left:auto}
.swapwrap span{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-3)}
.swap{display:flex;border:1px solid var(--line-2);border-radius:7px;overflow:hidden;background:var(--surface)}
.swap button{
  font:inherit;font-size:13px;font-weight:600;font-family:var(--mono);
  border:0;background:none;color:var(--ink-2);padding:6px 11px;cursor:pointer;
}
.swap button[aria-pressed="true"]{background:var(--accent-soft);color:var(--accent-ink)}

/* ── 본문 ── */
.locale-note{
  font-family:var(--mono);font-size:12px;color:var(--ink-3);
  margin:22px 0 0;padding-bottom:2px;
}
.store{margin-top:30px}
.store h3{
  font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;
  color:var(--accent-ink);margin:0 0 12px;
}
.fields{display:flex;flex-direction:column;gap:12px}

.field{background:var(--surface);border:1px solid var(--line);border-radius:11px;overflow:hidden}
.field.is-name{border-color:var(--line-2);box-shadow:inset 3px 0 0 var(--accent)}
.field-head{
  display:flex;align-items:center;gap:14px;flex-wrap:wrap;
  padding:11px 14px;border-bottom:1px solid var(--line);background:var(--sunk);
}
.field-head h4{margin:0;font-size:13.5px;font-weight:600;flex:1 1 auto;min-width:120px}
.gauge{display:flex;align-items:center;gap:9px}
.bar{width:74px;height:5px;border-radius:3px;background:var(--surface-2);overflow:hidden}
.bar span{display:block;height:100%;background:var(--accent);border-radius:3px}
.is-near .bar span{background:var(--near)}
.is-tight .bar span{background:var(--tight)}
.num{font-family:var(--mono);font-size:11.5px;font-variant-numeric:tabular-nums;color:var(--ink-3)}
.num b{font-weight:500;color:var(--ink-2)}
.is-near .num b{color:var(--near)}
.is-tight .num b{color:var(--tight)}
.num i{font-style:normal}

.copy{
  font:inherit;font-size:12px;font-weight:600;color:var(--ink-2);
  background:var(--surface);border:1px solid var(--line-2);border-radius:6px;
  padding:4px 11px;cursor:pointer;
}
.copy:hover{border-color:var(--accent);color:var(--accent-ink)}
.copy.done{background:var(--accent-soft);border-color:var(--accent);color:var(--accent-ink)}

.value{
  margin:0;padding:14px;font-family:var(--cjk);font-size:14px;line-height:1.72;
  white-space:pre-wrap;word-break:break-word;overflow-x:auto;color:var(--ink);
}
.field.is-name .value{font-size:16px;font-weight:600}
.note{
  margin:0;padding:10px 14px;border-top:1px dashed var(--line);
  background:var(--sunk);font-size:12.5px;color:var(--ink-2);
}
.note.is-caution{background:color-mix(in srgb,var(--tight) 10%,var(--sunk));color:var(--tight);font-weight:600}
mark{background:var(--accent-soft);color:var(--accent-ink);border-radius:3px;padding:0 2px;font-weight:700}

.foot{margin-top:44px;padding-top:18px;border-top:1px solid var(--line);color:var(--ink-3);font-size:12.5px}
.foot code{font-family:var(--mono)}
@media (max-width:560px){
  .swapwrap{margin-left:0}
  .bar{width:52px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style>

<div class="top">
  <div class="wrap">
    <div class="title">
      <h1>스토어 문구 대조표</h1>
      <span class="count">${total}개 필드 · 4개 언어</span>
    </div>
    <p class="sub">코드펜스 안 텍스트를 그대로 스토어 콘솔에 붙여넣는다.
      원본은 <code>docs/store-listing.md</code> — 이 페이지는 거기서 생성된다.
      막대는 한도 대비 사용량이고, 왼쪽에 초록 띠가 있는 카드가 <b>이름이 바뀌면 고쳐야 하는 자리</b>다.</p>
    <div class="controls">
      <div class="tabs" role="tablist" aria-label="언어">
        ${LANGS.map(
          (l) =>
            `<button role="tab" id="tab-${l.key}" aria-controls="panel-${l.key}" aria-selected="false" data-lang="${l.key}"><span aria-hidden="true">${l.flag}</span>${l.label}</button>`,
        ).join('\n        ')}
      </div>
      <div class="swapwrap">
        <span>앱 이름</span>
        <div class="swap">
          <button type="button" data-name="Snakeball" aria-pressed="true">Snakeball</button>
          <button type="button" data-name="Balldozer" aria-pressed="false">Balldozer</button>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="wrap">
  ${sections.map(langPanel).join('\n')}
  <p class="foot">앱 이름은 아직 확정이 아니다. 위 토글은 <b>Name 필드만</b> 바꿔 보여준다 —
    설명 본문에는 이름이 한 번도 안 나오므로 이름이 정해져도 본문은 손댈 필요가 없다.
    확정하면 <code>docs/store-listing.md</code> 를 고치고 <code>npm run check:listing</code> 을 돌릴 것.</p>
</div>

<script>
(function(){
  var tabs=[].slice.call(document.querySelectorAll('[role="tab"]'));
  function show(key){
    tabs.forEach(function(t){
      var on=t.dataset.lang===key;
      t.setAttribute('aria-selected',on?'true':'false');
      document.getElementById('panel-'+t.dataset.lang).hidden=!on;
    });
  }
  tabs.forEach(function(t){ t.addEventListener('click',function(){ show(t.dataset.lang); }); });
  show('ko');

  // 이름 교체 — Name 필드에만 적용한다. 원문을 data 에 보관해 원복이 손실 없이 된다.
  var nameFields=[].slice.call(document.querySelectorAll('[data-name-field]'));
  nameFields.forEach(function(el){ el.dataset.orig=el.textContent; });
  var swaps=[].slice.call(document.querySelectorAll('.swap button'));
  swaps.forEach(function(b){
    b.addEventListener('click',function(){
      swaps.forEach(function(x){ x.setAttribute('aria-pressed',x===b?'true':'false'); });
      var to=b.dataset.name;
      nameFields.forEach(function(el){
        // Toss 표시명은 한글이라 'Snakeball' 이 안 들어 있다 — 따로 매핑한다
        var ko={Snakeball:'스네이크볼',Balldozer:'볼도저'};
        var v=el.dataset.orig.split('Snakeball').join(to)
                             .split(ko.Snakeball).join(ko[to]);
        if(to==='Snakeball'){ el.textContent=v; return; }
        el.innerHTML='';
        var mark=v.indexOf(to)>=0?to:ko[to];
        v.split(mark).forEach(function(part,i){
          if(i){ var m=document.createElement('mark'); m.textContent=mark; el.appendChild(m); }
          el.appendChild(document.createTextNode(part));
        });
      });
      // 이름 길이가 바뀌면 글자수도 바뀐다 — 눈금을 다시 계산한다.
      // (Snakeball·Balldozer 는 우연히 둘 다 9자라 지금은 같지만, 다른 이름을 넣으면 어긋난다)
      nameFields.forEach(function(el){ recount(el); });
    });
  });

  function recount(el){
    var card=el.closest('.field'), num=card.querySelector('.num b'), bar=card.querySelector('.bar span');
    if(!num) return;
    var n=Array.from(el.textContent).length;
    num.textContent=n.toLocaleString();
    if(!bar) return;
    var lim=parseInt(card.querySelector('.num i').textContent.replace(/[^0-9]/g,''),10);
    if(!lim) return;
    var pct=Math.min(100,Math.round(n/lim*100));
    bar.style.width=pct+'%';
    card.classList.toggle('is-tight',pct>=93);
    card.classList.toggle('is-near',pct>=80&&pct<93);
  }

  // 복사 — 클립보드 API 가 막히면 선택으로 대체한다(샌드박스에서 흔하다)
  document.addEventListener('click',function(e){
    var btn=e.target.closest('[data-copy]'); if(!btn) return;
    var pre=btn.closest('.field').querySelector('.value');
    var text=pre.textContent, ok=false;
    try{
      if(navigator.clipboard&&navigator.clipboard.writeText){
        navigator.clipboard.writeText(text); ok=true;
      }
    }catch(_){}
    if(!ok){
      var r=document.createRange(); r.selectNodeContents(pre);
      var s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
      try{ ok=document.execCommand('copy'); }catch(_){}
    }
    btn.textContent=ok?'복사됨':'선택됨 ⌘C';
    btn.classList.add('done');
    setTimeout(function(){ btn.textContent='복사'; btn.classList.remove('done'); },1600);
  });

  // 값 영역을 클릭하면 전체 선택 — 버튼이 막혀도 손으로 복사할 수 있게
  document.addEventListener('focus',function(e){
    if(!e.target.classList||!e.target.classList.contains('value')) return;
    var r=document.createRange(); r.selectNodeContents(e.target);
    var s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
  },true);
})();
</script>
`;

writeFileSync(out, html, 'utf8');
console.log(`✅ ${out} — 필드 ${total}개 · 언어 ${sections.length}개`);
