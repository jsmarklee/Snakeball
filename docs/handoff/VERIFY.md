# 최종 검증 — 7건 전부 끝난 뒤 / 호스팅 배포 **전에**

> [README.md](README.md) 의 순서대로 7개를 끝내고, functions 배포(D2)까지 마친 뒤 실행한다.
> 하나라도 실패하면 **배포하지 말고** README §5(중단 조건)를 본다.

## 4. 한 번에 검증 (7단계 전부 끝난 뒤, D3 **전에**)

```bash
cd /Users/mark/repos/Snakeball

# [1] 금지 파일 침범 감지 — 아래 3개 + 새 파일 3개 외에 tracked 변경이 있으면 실패
git status --porcelain
#   기대: M firestore.indexes.json / M functions/index.js / M index.html
#         ?? functions/deleteSessions.js ?? functions/test/deleteSessions.test.js
#         ?? functions/scripts/analytics-retention.js ?? docs/…
#   coinSystem.js · iapVerification.js · firestore.rules 가 보이면 즉시 중단

# [2] 문법
node --check functions/index.js && node --check functions/deleteSessions.js \
  && node --check functions/scripts/analytics-retention.js && echo "JS OK"
node -e "const s=require('fs').readFileSync('index.html','utf8');const m=[...s.matchAll(/<script type=\"module\">([\s\S]*?)<\/script>/g)];console.log('modules:',m.length);m.forEach(x=>new Function(x[1]));console.log('HTML MODULES OK')"
#   기대: modules: 2 / HTML MODULES OK

# [3] 유닛테스트 (T6)
node --test functions/test/ 2>&1 | tail -4     # 기대: # tests 9 / # pass 9 / # fail 0

# [4] 스크립트 셀프테스트 (T7)
node functions/scripts/analytics-retention.js --selftest; echo "exit=$?"   # 6 checks / exit=0
python3 -c "import json;print(len(json.load(open('firestore.indexes.json'))['indexes']),'composite index')"  # 1

# [5] 7개 변경이 전부 실제로 들어갔는가
for p in "functions/index.js|sanitizeTelemetry" "functions/index.js|runRecordedAt" \
         "functions/index.js|deleteUserSessions" "index.html|appVersion: APP_VERSION" \
         "index.html|endReason" "index.html|nextPatternZ" \
         "index.html|gemsPurchasable" "index.html|function yesterday"; do
  f="${p%%|*}"; s="${p#*|}"
  grep -qF -- "$s" "$f" && echo "OK      $f  <- $s" || echo "MISSING $f  <- $s"
done
#   MISSING 이 하나라도 나오면 그 태스크가 반영 안 된 것

# [6] 하드 제약 불변식 — 텔레메트리는 안티치트 상한 '뒤'
node -e "const s=require('fs').readFileSync('functions/index.js','utf8');const b=s.indexOf('score > maxAllowed'),t=s.indexOf('runRecordedAt');console.log(b>0&&t>b?'PASS bound<telemetry':'FAIL ORDER')"

# [7] 머니패스 무결성 — 반드시 no diff
git diff --stat -- functions/coinSystem.js functions/iapVerification.js firestore.rules
#   기대: 출력 없음

# [8] 호스팅 동기화
npm run sync:public && diff -q index.html public/index.html && echo SYNCED
```

**D3 배포 후 라이브 확인 (실기기 iOS/Android 1대, 5분):**

| 단계 | 동작 | 기대 |
|---|---|---|
| L1 | 앱에서 1판 플레이 → 사망 | T4: 부활 경로 없으면 CONTINUE? 화면이 **뜨지 않고** 결과창이 ~0.7초 만에 뜬다 |
| L2 | 60초 이상 플레이 후 사망 | T3: 난이도 구간 전환에서 장애물 **뭉텅이 스폰 없음**, 뒤로 튀는 z 없음 |
| L3 | Firestore 콘솔 → `game_sessions`, **`runRecordedAt` desc 정렬** (`startedAt` 아님 — 다른 유저/재시작에 밀린다) | 최신 문서에 `platform`, `appVersion`, `run.{score,endReason,…}` 존재 (T1+T2) |
| L4 | 자정 KST 넘겨 재접속 or 기기 시계 조작 | T5: 데일리 스트릭 유지, 서버값과 일치 |
| L5 | Settings → **Delete My Data** | 응답 `sessionsDeleted > 0`, 위 문서 사라짐 (T6) |
| L6 | `node functions/scripts/analytics-retention.js --days 7` | 코호트 표 출력, exit 0 (T7) |

---

---

## 통과 후

`npm run deploy:web` (D3) 실행 → 위 표의 L1~L6 라이브 확인.
