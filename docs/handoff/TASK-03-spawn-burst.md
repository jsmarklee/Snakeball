# T3 · Obstacle burst at every difficulty tier change — replace index*spacing spawn-z with a monotonic z cursor

> 이 파일은 **단독 실행 가능한 작업지시서**다. 그대로 복사해 붙여넣으면 된다.
> **시작 전 [RULES.md](RULES.md) 를 먼저 읽을 것** — 건드리면 안 되는 것들이 있다.

- **난이도/소요**: ~15 minutes. Three small hunks in one file, plus verification. Net change: 1 variable renamed to a cursor, 2 constants added, 3 lines of loop body rewritten, 1 reset line updated, plus Korean explanatory comments. No new dependencies, no async, no state machine changes.
- **배포 필요**: Hosting only.
  1. npm run sync:public          (MANDATORY — index.html was edited; public/index.html is the
                                   copy iOS/Android WebViews and the web build actually load)
  2. npm run deploy:web           (runs sync:public again + firebase deploy --only hosting + rules)
NOT required: firebase deploy --only functions (no functions/ change), no firestore.rules change,
no iOS rebuild, no Android rebuild, no Toss rebuild. Both native shells load the hosted URL, so
the fix reaches installed apps the moment hosting is deployed.


---

## 1. 대상 파일

```
/Users/mark/repos/Snakeball/index.html (single file, 3 edit sites, all inside the second `<script type="module">` block which spans lines 2556–5438)
```


## 2. 현재 코드 (파일에서 이대로 찾을 것)

> 줄 번호는 밀릴 수 있다. **아래 문자열로 검색**해서 찾아라.
> 안 찾아지면 누가 이미 고친 것이니 **멈추고 사람에게 물어라.**

````
There are THREE hunks. Apply all three. Each snippet below is copied VERBATIM from the file including indentation and comments. Each is unique in the file — search for it literally.

=== HUNK 1 — around line 3158–3164 (the LEVEL GENERATION state block) ===

// ============================================================
// LEVEL GENERATION
// ============================================================
let nextSpawnZ = 0;
let patternIndex = 0;
let difficulty = 1;
let spawnedPatternCount = 0;

=== HUNK 2 — around line 3633–3644 (inside function ensureRoadsAndPatterns) ===

        nextSpawnZ += ROAD_SEGMENT_LENGTH;
    }

    // Spawn patterns ahead
    const patternSpacing = Math.max(5, 8 - getDifficulty() * 0.4);
    while (patternIndex * patternSpacing < ballZ + VISIBLE_DISTANCE) {
        const z = patternIndex * patternSpacing + 20;
        spawnPatternAt(z);
        patternIndex++;
    }

    // Despawn behind

=== HUNK 3 — around line 4531–4537 (inside function resetGameState) ===

    playerWorldZ = 0;
    cameraShake = 0;
    nextSpawnZ = 0;
    patternIndex = 0;
    spawnedPatternCount = 0;
````


## 3. 교체할 코드

````
=== HUNK 1 REPLACEMENT ===

// ============================================================
// LEVEL GENERATION
// ============================================================
let nextSpawnZ = 0;
// 패턴 스폰 커서. 예전엔 patternIndex * patternSpacing 로 z를 계산했는데, spacing이
// 난이도에 따라 줄어들기 때문에 티어가 바뀌는 순간 "이미 지나간 인덱스들"까지 새 간격으로
// 다시 계산되면서 스폰 z가 뒤로 점프했다(자세한 내용은 ensureRoadsAndPatterns 주석 참고).
// 그래서 인덱스 곱셈 대신 단조 증가하는 z 커서를 쓴다.
const PATTERN_START_Z = 20;                                  // 첫 패턴은 원점 앞 20 유닛 (기존 "+ 20" 과 동일)
const PATTERN_LOOKAHEAD = VISIBLE_DISTANCE + PATTERN_START_Z; // 선행 스폰 한계선 = 기존 조건과 동일한 지점
let nextPatternZ = PATTERN_START_Z;
let difficulty = 1;
let spawnedPatternCount = 0;

=== HUNK 2 REPLACEMENT ===

        nextSpawnZ += ROAD_SEGMENT_LENGTH;
    }

    // Spawn patterns ahead
    // patternSpacing은 난이도가 오를수록 좁아진다. 예전 코드는 z를 patternIndex * patternSpacing
    // 으로 매 프레임 "다시" 계산했기 때문에, 티어 경계에서 spacing이 줄어드는 순간 스폰 z가
    // patternIndex * 0.4 만큼 뒤로 밀렸다 → 이미 장애물이 깔린 구간을 while 루프가 한 프레임에
    // 다시 채워서 장애물이 무더기로 쏟아졌다(70초 지점 21개, 123초 지점 24개, 최대 116 유닛 역행).
    // 풀 크기가 작아서(CUBE_POOL_SIZE 60) 이 폭발이 풀을 고갈시키고, 그 뒤 구간은 오히려
    // 텅 비는 2차 증상까지 있었다.
    // 이제는 단조 증가 커서를 현재 spacing만큼 전진시킨다 → 간격 변화는 "앞으로 스폰될 패턴"에만
    // 영향을 주고 이미 배치된 구간은 건드리지 않는다. spacing 값과 패턴 선택 로직은 그대로다.
    const patternSpacing = Math.max(5, 8 - getDifficulty() * 0.4);
    while (nextPatternZ < ballZ + PATTERN_LOOKAHEAD) {
        spawnPatternAt(nextPatternZ);
        nextPatternZ += patternSpacing;
    }

    // Despawn behind

=== HUNK 3 REPLACEMENT ===

    playerWorldZ = 0;
    cameraShake = 0;
    nextSpawnZ = 0;
    nextPatternZ = PATTERN_START_Z;   // 인덱스가 아니라 z 커서를 리셋 (첫 패턴 z = 20, 기존과 동일)
    spawnedPatternCount = 0;

=== NOTES FOR THE IMPLEMENTER (do not paste these into the file) ===
- After all three hunks, the identifier `patternIndex` must no longer exist anywhere in
  index.html. Verify with: grep -c "patternIndex" /Users/mark/repos/Snakeball/index.html  → must print 0
- Do NOT change the loop bound to `ballZ + VISIBLE_DISTANCE`. The old code compared
  (z - 20) against ballZ + VISIBLE_DISTANCE, so the real frontier was ballZ + 100.
  PATTERN_LOOKAHEAD = VISIBLE_DISTANCE + PATTERN_START_Z reproduces that exactly.
  Shrinking it to 80 would make obstacles pop into view 20 units late.
- PATTERN_LOOKAHEAD references VISIBLE_DISTANCE, which is declared at line 2579 in the same
  module, i.e. BEFORE line 3161. Do not move either declaration.
````


## 3-B. ⚠️ 검토에서 정정된 부분 — **이쪽이 우선**

독립 검토에서 위 내용 중 일부(주로 검증 절차)에 오류가 발견됐다.
**충돌하면 아래를 따른다.**

````
CORRECTED SPEC — T3 (only currentCode is unchanged from the original; replacementCode comments and the whole verification section are corrected)

=====================================================================
FILE: /Users/mark/repos/Snakeball/index.html   (three hunks, all inside the second <script type="module"> block, lines 2556–5438)
=====================================================================

--------------------------------------------------------------------
CURRENT CODE (verified byte-for-byte, each unique in the file)
--------------------------------------------------------------------

=== HUNK 1 — lines 3158–3164 ===

// ============================================================
// LEVEL GENERATION
// ============================================================
let nextSpawnZ = 0;
let patternIndex = 0;
let difficulty = 1;
let spawnedPatternCount = 0;

=== HUNK 2 — lines 3633–3644 ===

        nextSpawnZ += ROAD_SEGMENT_LENGTH;
    }

    // Spawn patterns ahead
    const patternSpacing = Math.max(5, 8 - getDifficulty() * 0.4);
    while (patternIndex * patternSpacing < ballZ + VISIBLE_DISTANCE) {
        const z = patternIndex * patternSpacing + 20;
        spawnPatternAt(z);
        patternIndex++;
    }

    // Despawn behind

=== HUNK 3 — lines 4533–4537 ===

    playerWorldZ = 0;
    cameraShake = 0;
    nextSpawnZ = 0;
    patternIndex = 0;
    spawnedPatternCount = 0;

--------------------------------------------------------------------
REPLACEMENT CODE
(comments deliberately do NOT contain the literal token `patternIndex`,
 so that the STEP 4 structural grep can be an exact `0`)
--------------------------------------------------------------------

=== HUNK 1 REPLACEMENT ===

// ============================================================
// LEVEL GENERATION
// ============================================================
let nextSpawnZ = 0;
// 패턴 스폰 커서. 예전엔 "인덱스 × 간격 + 20"으로 z를 매 프레임 다시 계산했는데,
// 간격(spacing)이 난이도에 따라 줄어들기 때문에 티어가 바뀌는 순간 이미 지나간 인덱스까지
// 새 간격으로 재계산되면서 스폰 z가 뒤로 점프했다 (자세한 내용은 ensureRoadsAndPatterns 주석 참고).
// 그래서 인덱스 곱셈 대신 단조 증가하는 z 커서를 쓴다.
const PATTERN_START_Z = 20;                                   // 첫 패턴은 원점 앞 20 유닛 (기존 "+ 20" 과 동일)
const PATTERN_LOOKAHEAD = VISIBLE_DISTANCE + PATTERN_START_Z; // 선행 스폰 한계선 = 기존 조건과 동일한 지점
let nextPatternZ = PATTERN_START_Z;
let difficulty = 1;
let spawnedPatternCount = 0;

=== HUNK 2 REPLACEMENT ===

        nextSpawnZ += ROAD_SEGMENT_LENGTH;
    }

    // Spawn patterns ahead
    // patternSpacing은 난이도가 오를수록 좁아진다. 예전 코드는 z를 "인덱스 × spacing + 20"으로
    // 매 프레임 다시 계산했기 때문에, 티어 경계에서 spacing이 줄어드는 순간 스폰 z가
    // "인덱스 × 0.4" 만큼 뒤로 밀렸다 → 이미 장애물이 깔린 구간을 while 루프가 한 프레임에
    // 다시 채워서 장애물이 무더기로 쏟아졌다(70초 지점 21개, 123초 지점 24개, 최대 116 유닛 역행).
    // 풀 크기가 작아서(CUBE_POOL_SIZE 60) 이 폭발이 풀을 고갈시키고, 그 뒤 구간은 오히려
    // 텅 비는 2차 증상까지 있었다.
    // 이제는 단조 증가 커서를 현재 spacing만큼 전진시킨다 → 간격 변화는 "앞으로 스폰될 패턴"에만
    // 영향을 주고 이미 배치된 구간은 건드리지 않는다. spacing 값과 패턴 선택 로직은 그대로다.
    const patternSpacing = Math.max(5, 8 - getDifficulty() * 0.4);
    while (nextPatternZ < ballZ + PATTERN_LOOKAHEAD) {
        spawnPatternAt(nextPatternZ);
        nextPatternZ += patternSpacing;
    }

    // Despawn behind

=== HUNK 3 REPLACEMENT ===

    playerWorldZ = 0;
    cameraShake = 0;
    nextSpawnZ = 0;
    nextPatternZ = PATTERN_START_Z;   // 인덱스가 아니라 z 커서를 리셋 (첫 패턴 z = 20, 기존과 동일)
    spawnedPatternCount = 0;

=== NOTES (do not paste into the file) ===
- The loop bound MUST be `ballZ + PATTERN_LOOKAHEAD`, never `ballZ + VISIBLE_DISTANCE`.
  The old code compared (z - 20) against ballZ + VISIBLE_DISTANCE, so the true frontier was
  ballZ + 100. Writing VISIBLE_DISTANCE alone silently shortens the horizon by 20 units and
  makes obstacles pop in late. STEP 4b below catches this mechanically.
- VISIBLE_DISTANCE is declared at line 2579, inside the same module and BEFORE line 3161, so
  PATTERN_LOOKAHEAD initialises correctly. Do not move either declaration.
- After the edit the identifier `patternIndex` must not appear anywhere in index.html —
  not in code and not in comments. That is what STEP 4a asserts.

--------------------------------------------------------------------
VERIFICATION (corrected — runs as written, fails before, passes after)
--------------------------------------------------------------------

STEP 1 — create the script. IMPORTANT: paste this so that `ENDOFSCRIPT` is at column 0
(no leading spaces), otherwise the heredoc never terminates and your shell hangs.

cat > /tmp/t3_spawn_check.js <<'ENDOFSCRIPT'
#!/usr/bin/env node
// T3 verification: pattern spawn-z must be monotonically increasing.
const fs = require('fs');
const path = process.argv[2] || '/Users/mark/repos/Snakeball/index.html';
const src = fs.readFileSync(path, 'utf8');

const OLD = /while\s*\(\s*patternIndex\s*\*\s*patternSpacing\s*<\s*ballZ\s*\+\s*VISIBLE_DISTANCE\s*\)/.test(src);
const NEW = /nextPatternZ\s*\+=\s*patternSpacing/.test(src);
if (OLD === NEW) {
  console.error('ABORT: could not classify the spawner in ' + path +
                ' (old-form=' + OLD + ', new-form=' + NEW + ')');
  process.exit(2);
}
console.log('spawner form detected: ' + (OLD ? 'OLD (patternIndex * patternSpacing)'
                                             : 'NEW (monotonic nextPatternZ cursor)'));

function num(name) {
  const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*(-?[\\d.]+)\\s*;'));
  if (!m) { console.error('ABORT: constant ' + name + ' not found'); process.exit(2); }
  return parseFloat(m[1]);
}
const INITIAL_SPEED     = num('INITIAL_SPEED');
const MAX_SPEED         = num('MAX_SPEED');
const SPEED_UP_DURATION = num('SPEED_UP_DURATION');
const VISIBLE_DISTANCE  = num('VISIBLE_DISTANCE');
const START_Z           = 20;

function getDifficulty(t) {
  if (t < 5)  return 1;
  if (t < 12) return 2;
  if (t < 22) return 3;
  if (t < 35) return 4;
  if (t < 50) return 5;
  if (t < 70) return 6;
  if (t < 95) return 7;
  return 7 + Math.floor((t - 95) / 28);
}
const spacingOf = t => Math.max(5, 8 - getDifficulty(t) * 0.4);

const dt = 1 / 60;
let gameTimer = 0, playerWorldZ = 0, vz = INITIAL_SPEED;
let patternIndex = 0;
let nextPatternZ = START_Z;
let lastZ = -Infinity, worstBack = 0, worstAt = 0, worstBurst = 0, burstAt = 0;

function emit(z) {
  const back = lastZ - z;
  if (back > worstBack) { worstBack = back; worstAt = gameTimer; }
  if (z > lastZ) lastZ = z;
}
function ensure() {
  const ballZ = playerWorldZ;
  const patternSpacing = spacingOf(gameTimer);
  let n = 0;
  if (OLD) {
    while (patternIndex * patternSpacing < ballZ + VISIBLE_DISTANCE) {
      emit(patternIndex * patternSpacing + START_Z); n++; patternIndex++;
    }
  } else {
    while (nextPatternZ < ballZ + VISIBLE_DISTANCE + START_Z) {
      emit(nextPatternZ); n++; nextPatternZ += patternSpacing;
    }
  }
  if (n > worstBurst) { worstBurst = n; burstAt = gameTimer; }
}

ensure();
for (let f = 0; f < 180 * 60; f++) {
  gameTimer += dt;
  const speedChange  = (MAX_SPEED - INITIAL_SPEED) / SPEED_UP_DURATION;
  const speedCeiling = MAX_SPEED + Math.max(0, gameTimer - SPEED_UP_DURATION) * 0.06;
  if (vz < speedCeiling) vz += speedChange * dt;
  playerWorldZ += vz * dt;
  ensure();
}

console.log('worst backwards jump : ' + worstBack.toFixed(2) + ' units (at t=' + worstAt.toFixed(1) + 's)');
console.log('worst single-frame burst: ' + worstBurst + ' patterns (at t=' + burstAt.toFixed(1) + 's)');
const ok = worstBack === 0 && worstBurst <= 12;
console.log('RESULT: ' + (ok ? 'PASS - spawn z is monotonic, no burst' : 'FAIL - spawn z jumps backwards'));
process.exit(ok ? 0 : 1);
ENDOFSCRIPT

STEP 2 — run it BEFORE editing. Expected output (measured on the real file today):

  $ node /tmp/t3_spawn_check.js /Users/mark/repos/Snakeball/index.html
  spawner form detected: OLD (patternIndex * patternSpacing)
  worst backwards jump : 116.60 units (at t=123.0s)
  worst single-frame burst: 24 patterns (at t=123.0s)
  RESULT: FAIL - spawn z jumps backwards
  ($? == 1)

  If the output differs, STOP and report back — the file is not in the expected state.

STEP 3 — apply the three hunks, then re-run. Expected output:

  $ node /tmp/t3_spawn_check.js /Users/mark/repos/Snakeball/index.html
  spawner form detected: NEW (monotonic nextPatternZ cursor)
  worst backwards jump : 0.00 units (at t=0.0s)
  worst single-frame burst: 11 patterns (at t=0.0s)
  RESULT: PASS - spawn z is monotonic, no burst
  ($? == 0)

  (The 11-pattern "burst" at t=0.0s is the legitimate initial road fill from startRun();
  it is identical before and after and is not the bug.)

STEP 4 — three structural greps. ALL THREE must print exactly the stated number.
(4a proves the old variable is fully gone; 4b proves the loop bound was not shortened to
VISIBLE_DISTANCE — the node script cannot detect that; 4c proves HUNK 3 was applied.)

  $ grep -c "patternIndex" /Users/mark/repos/Snakeball/index.html
  0
  $ grep -c "ballZ + PATTERN_LOOKAHEAD" /Users/mark/repos/Snakeball/index.html
  1
  $ grep -c "nextPatternZ = PATTERN_START_Z" /Users/mark/repos/Snakeball/index.html
  2

  4c returns 2 because the identifier is set in two places: the declaration
  `let nextPatternZ = PATTERN_START_Z;` and the reset inside resetGameState().
  If it prints 1, HUNK 3 was skipped — go back and apply it.

STEP 5 — syntax gate (catches a stray brace or typo without a browser).
Paste as-is; the `PY` terminator must also be at column 0.

python3 - <<'PY'
lines = open('/Users/mark/repos/Snakeball/index.html', encoding='utf-8').read().split('\n')
idx = [i for i, l in enumerate(lines) if l.strip() == '<script type="module">']
start = idx[1] + 1
end = next(i for i in range(start, len(lines)) if lines[i].strip().startswith('</script>'))
open('/tmp/t3_module2.mjs', 'w', encoding='utf-8').write('\n'.join(lines[start:end]))
print('extracted module #2:', end - start, 'lines')
PY
node --check /tmp/t3_module2.mjs && echo "SYNTAX OK"

  Expected: "extracted module #2: ~2882 lines" then "SYNTAX OK". Any parse error here means
  a hunk was mis-pasted — fix it before going further.

STEP 6 — sync the deploy copy and prove it carries the fix:

  $ cd /Users/mark/repos/Snakeball && npm run sync:public
  $ node /tmp/t3_spawn_check.js /Users/mark/repos/Snakeball/public/index.html
  → must print "RESULT: PASS" and exit 0
  $ grep -c "patternIndex" /Users/mark/repos/Snakeball/public/index.html
  0

STEP 7 — browser smoke test. Run the server in the BACKGROUND (a foreground
`python3 -m http.server` blocks the shell forever):

  $ cd /Users/mark/repos/Snakeball && (python3 -m http.server 8799 >/tmp/t3_http.log 2>&1 &) 
  open http://localhost:8799/index.html with DevTools console open, then play a run.
  Required:
    - ZERO console errors (a half-applied hunk gives "patternIndex is not defined" or
      "nextPatternZ is not defined" / "Cannot access 'PATTERN_START_Z' before initialization").
    - Obstacles keep appearing continuously; crossing ~70s shows no visible clump.
    - Die, then start a SECOND run: the road must be populated from the start. (If HUNK 3 was
      skipped the cursor stays far ahead and run #2 looks empty — STEP 4c also catches this.)
  When finished:
  $ pkill -f "http.server 8799"

--------------------------------------------------------------------
UNCHANGED FROM THE ORIGINAL SPEC (verified accurate, keep as written)
--------------------------------------------------------------------
- rationale: every number in it checks out (bursts at t=12/22/35/50/70/123s of 2/3/7/13/21/24
  patterns, worst back-jump 116.6 units, 1015 → 943 total patterns over a 180s run).
- doNotTouch list items 1–10: all verified correct (pool sizes 60/20/16/40, getFreeCube()
  returning null, `let difficulty = 1;` being unused, VISIBLE_DISTANCE 80 / DESPAWN_DISTANCE -5
  at 2579–2580, module #1 at 626–2531). No money-path, anti-cheat, rules, or MIGRATION_CUTOFF_MS
  exposure — nothing outside index.html changes.
- effort: ~15 minutes.
- deploy: hosting only — `npm run sync:public` (mandatory) then `npm run deploy:web`
  (which itself re-runs sync:public, deploys hosting, then firestore rules). No functions
  deploy, no native rebuild; iOS/Android load the hosted URL.
````


## 4. 검증 (수정 전 실패 → 수정 후 성공이어야 함)

````
A node script that replays the spawner against the real constants read out of index.html.
It FAILS (exit 1) on the current file and PASSES (exit 0) after the change. It auto-detects
which formula is present, so it cannot be fooled by a half-applied edit.

STEP 1 — create the script (path is outside the repo on purpose; nothing to clean up in git):

  cat > /tmp/t3_spawn_check.js <<'ENDOFSCRIPT'
  #!/usr/bin/env node
  // T3 verification: pattern spawn-z must be monotonically increasing.
  const fs = require('fs');
  const path = process.argv[2] || '/Users/mark/repos/Snakeball/index.html';
  const src = fs.readFileSync(path, 'utf8');

  const OLD = /while\s*\(\s*patternIndex\s*\*\s*patternSpacing\s*<\s*ballZ\s*\+\s*VISIBLE_DISTANCE\s*\)/.test(src);
  const NEW = /nextPatternZ\s*\+=\s*patternSpacing/.test(src);
  if (OLD === NEW) {
    console.error('ABORT: could not classify the spawner in ' + path +
                  ' (old-form=' + OLD + ', new-form=' + NEW + ')');
    process.exit(2);
  }
  console.log('spawner form detected: ' + (OLD ? 'OLD (patternIndex * patternSpacing)'
                                               : 'NEW (monotonic nextPatternZ cursor)'));

  function num(name) {
    const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*(-?[\\d.]+)\\s*;'));
    if (!m) { console.error('ABORT: constant ' + name + ' not found'); process.exit(2); }
    return parseFloat(m[1]);
  }
  const INITIAL_SPEED     = num('INITIAL_SPEED');
  const MAX_SPEED         = num('MAX_SPEED');
  const SPEED_UP_DURATION = num('SPEED_UP_DURATION');
  const VISIBLE_DISTANCE  = num('VISIBLE_DISTANCE');
  const START_Z           = 20;

  function getDifficulty(t) {
    if (t < 5)  return 1;
    if (t < 12) return 2;
    if (t < 22) return 3;
    if (t < 35) return 4;
    if (t < 50) return 5;
    if (t < 70) return 6;
    if (t < 95) return 7;
    return 7 + Math.floor((t - 95) / 28);
  }
  const spacingOf = t => Math.max(5, 8 - getDifficulty(t) * 0.4);

  const dt = 1 / 60;
  let gameTimer = 0, playerWorldZ = 0, vz = INITIAL_SPEED;
  let patternIndex = 0;
  let nextPatternZ = START_Z;
  let lastZ = -Infinity, worstBack = 0, worstAt = 0, worstBurst = 0, burstAt = 0;

  function emit(z) {
    const back = lastZ - z;
    if (back > worstBack) { worstBack = back; worstAt = gameTimer; }
    if (z > lastZ) lastZ = z;
  }
  function ensure() {
    const ballZ = playerWorldZ;
    const patternSpacing = spacingOf(gameTimer);
    let n = 0;
    if (OLD) {
      while (patternIndex * patternSpacing < ballZ + VISIBLE_DISTANCE) {
        emit(patternIndex * patternSpacing + START_Z); n++; patternIndex++;
      }
    } else {
      while (nextPatternZ < ballZ + VISIBLE_DISTANCE + START_Z) {
        emit(nextPatternZ); n++; nextPatternZ += patternSpacing;
      }
    }
    if (n > worstBurst) { worstBurst = n; burstAt = gameTimer; }
  }

  ensure();
  for (let f = 0; f < 180 * 60; f++) {
    gameTimer += dt;
    const speedChange  = (MAX_SPEED - INITIAL_SPEED) / SPEED_UP_DURATION;
    const speedCeiling = MAX_SPEED + Math.max(0, gameTimer - SPEED_UP_DURATION) * 0.06;
    if (vz < speedCeiling) vz += speedChange * dt;
    playerWorldZ += vz * dt;
    ensure();
  }

  console.log('worst backwards jump : ' + worstBack.toFixed(2) + ' units (at t=' + worstAt.toFixed(1) + 's)');
  console.log('worst single-frame burst: ' + worstBurst + ' patterns (at t=' + burstAt.toFixed(1) + 's)');
  const ok = worstBack === 0 && worstBurst <= 12;
  console.log('RESULT: ' + (ok ? 'PASS - spawn z is monotonic, no burst' : 'FAIL - spawn z jumps backwards'));
  process.exit(ok ? 0 : 1);
  ENDOFSCRIPT

STEP 2 — run it BEFORE editing. Expected output (verbatim, already measured):

  $ node /tmp/t3_spawn_check.js /Users/mark/repos/Snakeball/index.html
  spawner form detected: OLD (patternIndex * patternSpacing)
  worst backwards jump : 116.60 units (at t=123.0s)
  worst single-frame burst: 24 patterns (at t=123.0s)
  RESULT: FAIL - spawn z jumps backwards
  ($? == 1)

  If you do NOT see exactly this, stop — the file is not in the state this spec was written
  against; do not guess, report back.

STEP 3 — apply the three hunks, then run it again. Expected output:

  $ node /tmp/t3_spawn_check.js /Users/mark/repos/Snakeball/index.html
  spawner form detected: NEW (monotonic nextPatternZ cursor)
  worst backwards jump : 0.00 units (at t=0.0s)
  worst single-frame burst: 11 patterns (at t=0.0s)
  RESULT: PASS - spawn z is monotonic, no burst
  ($? == 0)

  (The 11-pattern "burst" at t=0.0s is the legitimate initial road fill from startRun();
  it is identical before and after and is not the bug.)

STEP 4 — structural check, must print exactly 0:

  $ grep -c "patternIndex" /Users/mark/repos/Snakeball/index.html
  0

STEP 5 — sync the deploy copy and prove it carries the fix too:

  $ cd /Users/mark/repos/Snakeball && npm run sync:public
  $ node /tmp/t3_spawn_check.js /Users/mark/repos/Snakeball/public/index.html
  → must also print "RESULT: PASS"

STEP 6 — smoke test in a real browser (catches a typo the sim cannot):

  $ cd /Users/mark/repos/Snakeball && python3 -m http.server 8799
  open http://localhost:8799/index.html , open DevTools console, start a run.
  Required: ZERO console errors (a misapplied hunk gives "patternIndex is not defined" or
  "nextPatternZ is not defined"), obstacles appear continuously, and crossing 70s does not
  produce a visible clump. Die and start a second run — the road must be populated from the
  start (this is the hunk-3 reset check; if hunk 3 was skipped, run #2 spawns nothing until
  the player catches up to the previous run's cursor).
````


## 5. 건드리지 말 것

1. `const patternSpacing = Math.max(5, 8 - getDifficulty() * 0.4);` — the expression itself
   must stay byte-identical. It is the difficulty curve. Only WHERE it is applied changes.
2. `function getDifficulty()` (~line 3179) and its tier thresholds (5/12/22/35/50/70/95, +28
   endless step) — not part of this fix.
3. `generatePattern()`, `spawnPatternAt()`, `spawnedPatternCount`, and the `spawnedPatternCount % 3`
   collectible rule — pattern SELECTION is unchanged; only pattern POSITION is being fixed.
4. `nextSpawnZ` / `ROAD_SEGMENT_LENGTH` / `spawnRoadSegment()` — the road-segment loop directly
   above already uses the correct cursor pattern. Leave it exactly as is. Do not "unify" the
   two loops.
5. `VISIBLE_DISTANCE = 80` and `DESPAWN_DISTANCE = -5` (lines 2579–2580) — do not change the
   values and do not move the declarations (PATTERN_LOOKAHEAD depends on VISIBLE_DISTANCE being
   declared earlier in the same module).
6. The whole "Despawn behind" block that follows the spawn loop — untouched.
7. Pool sizes CUBE_POOL_SIZE 60 / WALL_POOL_SIZE 20 / BAR_POOL_SIZE 16 / COIN_POOL_SIZE 40 —
   do NOT enlarge them "to be safe". The burst is the bug; the pools are fine once it is gone.
8. `let difficulty = 1;` on the line after the edited declaration — it is a separate (currently
   unused) variable. Leave it.
9. Nothing outside index.html changes. Specifically: no edits to functions/coinSystem.js,
   functions/iapVerification.js, functions/index.js (submitScore / the MAX_SCORE_PER_SEC=300,
   BASE_BUFFER=200, MAX_CREDITED_SECONDS=600 bound), MIGRATION_CUTOFF_MS, or firestore.rules.
   This is a pure client-side rendering/spawn fix and touches none of the money path.
10. Do not touch the first `<script type="module">` block (window.SB, lines 626–2531).


## 6. 리스크

LOW. Confined to obstacle placement in the client render loop.
- Zero economy/anti-cheat exposure: no server call, no coin/gem/score path touched. submitScore's
  bound and grantRunCoins are untouched.
- Intended behavioural delta: over a 180s run the spawner emits 943 patterns instead of 1015.
  The 72 removed were the duplicate re-fills — i.e. the bug. Perceived difficulty at any given
  point on the road is unchanged (same spacing, same pattern mix); what disappears is the
  double-density clump at 12s/22s/35s/50s/70s/123s.
- Side effect worth knowing: because the duplicate spawns are gone, generatePattern()'s
  spawnedPatternCount counter advances differently, so the exact sequence of patterns a player
  meets will differ from before. This is expected and not a regression — the pattern-selection
  probabilities are identical.
- Main failure mode to guard against: forgetting HUNK 3. If resetGameState() still resets an
  identifier that no longer exists, the second run of a session starts with a stale cursor far
  ahead of the player and the road looks empty. Step 6 of the verification catches exactly this.
- Second failure mode: writing the loop bound as `ballZ + VISIBLE_DISTANCE` instead of
  `ballZ + PATTERN_LOOKAHEAD`, which silently shortens the spawn horizon by 20 units and makes
  obstacles pop in late. The node script will still print PASS in that case, so follow the
  replacement code literally.


## 7. 커밋 메시지

```
fix: stop the obstacle burst at every difficulty tier boundary

The pattern spawner in ensureRoadsAndPatterns() computed each spawn position as
`patternIndex * patternSpacing + 20`, but patternSpacing is derived from getDifficulty()
and shrinks as the run progresses (8 - d*0.4, floored at 5). Because the position was
recomputed from the index on every frame, the instant a difficulty tier boundary was
crossed the entire index space was re-scaled and the computed spawn z jumped BACKWARDS by
patternIndex * 0.4 — landing deep inside a stretch of road that was already populated. The
while-loop then re-filled that stretch in a single frame. Replaying the real speed and
difficulty curves shows this fires at t=12s, 22s, 35s, 50s, 70s and 123s, worst case a
116.6-unit backwards jump spawning 24 extra patterns in one frame at t=123s. The visible
symptom is a wall of obstacles materialising on top of the player; the secondary symptom is
that the burst drains the small object pools (CUBE_POOL_SIZE 60, WALL_POOL_SIZE 20,
BAR_POOL_SIZE 16 — getFreeCube() silently returns null when exhausted), so the road just
ahead of the burst goes suspiciously empty. The fix advances a monotonically increasing z
cursor (nextPatternZ) by the current spacing instead of multiplying an index, so a spacing
change only affects patterns that have not been placed yet. Spacing values, the lookahead
distance, the +20 start offset and generatePattern()'s selection logic are all unchanged —
the only behavioural delta is that the duplicate re-fills are gone (943 patterns instead of
1015 over a 180s run, i.e. the 72 that were the bug).
```
