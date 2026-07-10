# Snakeball: Client → Server-Authoritative Economy — Migration Design

(Architect output + CRITIC CORRECTIONS. The "FINAL CORRECTIONS" block at the
bottom is AUTHORITATIVE and overrides anything above it where they conflict.)

> STATUS: design finalized (critic-reviewed). Snakeball is NOT live yet
> (games.json draft, ADS_ENABLED=false, test ad ids) → this is pre-launch
> hardening, not an active-exploit emergency.

## Verified correction
Snakeball does NOT mutate balance mid-gameplay. `runCoins` accumulates in a local var; actual `addCoins()` fires only at pause points: game-over (index.html:3873), quit (index.html:3677), double-coins ad (index.html:3929), gem-revive (index.html:3402). Shop spends are in a modal (index.html:1247,1252). Every mutation is at a UI pause point → de-risks async migration.

## Current state anchors
- Balance: state.coins/gems in localStorage (index.html:682-683 load, :711 persist)
- Mutators: index.html:995-998, payCost :1000-1005 — pure local, no caps
- Earn per-run: :3675-3677 (quit), :3871-3873 (gameover) — client computes runCoins+floor(score/10)
- Double-coins ad: :3922-3934 — client-granted, NO SSV, NO token (fixed key 'reward' :878)
- Missions/daily: :1077-1104 — client grant()
- Cross-promo: :1793-1830 → claimCrossPromoReward (server-gated) but client addCoins local :1830
- Spend skins/powerups: :1247,:1252 payCost; gem revive :3400-3403 (cost 5+revivesUsed*5)
- IAP: :929 → verifyAndFulfillPurchase; iapVerification.js:371-402 WRITES users/{uid}.coins/.gems (:385-386), returns grant → client re-adds local
- Auth: anonymous Firebase (index.html:1354-1386), whenAuthReady, 8s timeout, region asia-northeast3
- users/{uid} already holds name,bestScore,stableId,recoveryCode,crossPromo*, + IAP coins/gems

EXPLOIT: server already owns coins/gems (IAP writes it) but client treats localStorage as truth and never reads server value → devtools edit = unlimited spend, defeating server-verified IAP.

REFERENCE: MinefieldSweeper functions/coinSystem.js — DEFAULT_ECONOMY (:28-79), applyCoinDelta transactional single-writer + idempotency + ledger (:202-274), spendCoin (:302-337), rewardCoinBounded (:345-397), claimSafeReveal (:412-472).

## Recommendation on depth
Server-authoritative balance + server-validated spends + server-derived earns, ported from Mineta applyCoinDelta/spendCoin — but LIGHTER than full parity.
- Adopt: canonical server coins/gems, single transactional mutator, per-action idempotency tokens, daily caps + rate limits, config doc for cost/reward tables.
- Defer/drop: AdMob S2S SSV (use bounded-trust onCall); immutable coin_ledger (P2, but keep processed_* dedup from day 1); no heart-system coupling (standalone module, reimplement KST daily reset ~15 lines).
- Rejected HMAC-signed-balance: still client-computes deltas, rollback/replay vulnerable, still needs round-trip per spend. Since anon auth + users/{uid} + callable infra + IAP-writes-balance ALREADY exist, going fully authoritative is barely more work and strictly more robust.
- Safe for arcade: all mutations at pause points → optimistic UI + authoritative reconcile; loop never awaits.

## User-doc model (users/{uid})
coins, gems (authoritative; IAP already writes), coins_updated_at, economy_initialized (import gate),
owned_skins[] (MOVE server-side — durable product a spend buys), daily_coin_earned, daily_rewarded_count,
daily_revive_count, last_ad_reward, missions{date,claimed{}}, daily{last,streak}.
Power-up counts → P1 entitlement. skin/armed/settings/stats stay client. owned_skins P0 (else edit sb_owned → free skins).
Client read: on boot after whenAuthReady → getEconomyStatus → sets state; localStorage demoted to UI cache (written for first-paint, never read as truth after boot).

## Server API (new functions/coinSystem.js + onCall in index.js, region asia-northeast3, require auth, assertNotMigrated)
DEFAULT_ECONOMY config doc config/economy: skin_costs, powerup_costs{headstart:200,magnet:250,shield:300}, revive_gem_base:5/step:5, coin_per_score:0.1, coins_per_sec_cap:30, double_coins_multiplier:1.0, mission_rewards, daily_rewards[7], crosspromo_rewards{mineta:3,pow2:3}, coin_earn_daily_cap:5000, rewarded_daily_cap:20, revive_daily_cap:10, rewarded_rate_limit_ms:60000, iap_max:99999.

applyBalanceDelta(tx,userRef,data,{coins,gems},opts): port of coinSystem.js:202-274 for 2 currencies. Single writer. idempotencyToken (read processed_ad_callbacks/{token} BEFORE write → DUPLICATE_CALLBACK), negative-balance guard, optional capField, optional ledger (P2). In txn.

Handlers:
- getEconomyStatus() → lazy-init, KST daily-reset, one-time capped import → {coins,gems,owned_skins,powerups,daily,missions,remaining,config_public}
- spendCurrency({reason,itemId}) reason∈{skin,powerup,revive}, cost FROM CONFIG not client. skin→append owned_skins; powerup→inc count; revive→base+step*serverReviveCount → {coins,gems,owned_skins?,powerups?}
- rewardFromAd({adToken,context}) context∈{double_coins,revive}, bounded-trust port of rewardCoinBounded, idempotent on adToken, rate-limit, daily cap. double_coins grant=server-recomputed lastRunBaseCoins; revive=record impression only → {coins,granted}
- endRun (fold into submitScore): after anti-cheat validates score (index.js:180-186), grant coins server-side = floor(validScore*coin_per_score)+min(pickupCoins, coins_per_sec_cap*elapsedSec), cap coin_earn_daily_cap. Store lastRunBaseCoins for double_coins.
- claimMission({missionId}) validate not claimed today, reward from config → {coins,gems,missions}
- claimDaily() server computes streak from daily.last/KST, reward from config → {coins,gems,daily}
- IAP unchanged (already authoritative) — client only stops mirroring, re-reads from response.
Mission/daily PROGRESS stays client (reportRun :1041); only CLAIM grants + is server-validated/idempotent. (Trade-off: cheater can claim unearned missions. Accept now; full close needs endRun-driven progress P2.)
Double-coins integrity: endRun records server-computed lastRunBaseCoins; rewardFromAd(double_coins) grants exactly that (idempotent) — client can't inflate.

## Client refactor (monolith)
Keep addCoins/spendCoins/addGems/spendGems/payCost signatures, change bodies to server calls. Localize to js lines 986-1005 + ~8 call sites.
applyServerBalance(resp): sets state.coins/gems/owned/powerups from any handler resp, refreshHUD(), persist() (cache). Single reconcile point.
Spends → authoritative await-before-grant: payCost (:1247,1252) → await spendCurrency({reason,itemId}); gem revive (:3400-3403) → await spendCurrency({reason:revive}) then doRevive(). Spinner in modal ~200-500ms (onTap throttle :743 guards double-fire). Offline/auth-null → throw → toast "Store unavailable", NO grant (behavior change; non-core currency, gameplay unaffected offline).
Earns → optimistic UI + reconcile: loop still increments local runCoins for HUD. At gameover/quit show earned immediately (optimistic), fire endRun/submitScore{score,pickupCoins:runCoins}; on return applyServerBalance overwrites HUD. Fail(offline)→keep optimistic local as cache + enqueue reconcile. double-coins :3922-3934 → await rewardFromAd. missions/daily :1084,:1099 → await claimMission/claimDaily. cross-promo :1830 → server applies delta inside claimCrossPromoReward (index.js:498-506 needs applyBalanceDelta added), returns balance.
Offline write queue: pendingEarns[] in localStorage for failed endRun/claims, flush next boot after whenAuthReady. Idempotency tokens make double-flush safe. Spends NOT queued. ~30 lines new.

## Anti-abuse
Idempotency: unique adToken per rewarded call (fixes fixed-key :878); sessionToken unique per startRun (:116); processed_transactions dedups IAP (iapVerification.js:308); missionId+date / daily.last dedup claims. All writes read dedup doc BEFORE write.
Rate limits: rewarded_rate_limit_ms 60s; cross-promo already limited (index.js:487). Daily caps reset KST.
Server cost validation: spendCurrency reads cost from config, client sends only reason+itemId — core exploit closer.
Earn anti-cheat: per-run coins from already-validated score + coins_per_sec_cap-bounded pickups.
MIGRATION of legacy localStorage: one-time capped trust-import gated by economy_initialized. First getEconomyStatus with !economy_initialized: client sends localStorage {coins,gems,owned_skins,powerups} once; server imports min(clientCoins, IMPORT_CAP=50k) / min(clientGems,500), owned_skins verbatim, sets economy_initialized. THEN: if server doc already has coins/gems from IAP → take MAX not sum (localStorage already includes mirrored IAP grants; summing double-counts). coins=max(serverCoins, min(clientCoins,cap)).
Trade-off: trust-import rewards past cheaters once; alternative (discard) nukes legit balances + paid IAP coins only in localStorage on current device. Capped-import contains blast radius.

## Staging
P0 (stop exploit): 1) coinSystem.js applyBalanceDelta+config, 2) getEconomyStatus (capped import)+spendCurrency+owned_skins server, 3) client boot reconcile + convert spends to spendCurrency (balance read-only-from-server), 4) fold coin earn into submitScore/endRun + optimistic per-run. → localStorage edit no longer grants spend power. CRITICAL milestone.
P1: 5) rewardFromAd unique adToken (double-coins+revive), 6) claimMission/claimDaily + cross-promo server-applied, 7) powerups counts server, 8) offline queue.
P2: ledger; server-side mission progress; config tuning.
P3: AdMob S2S SSV if warranted.

Risks: breaking balances (capped max-not-sum import; test doc w/ existing IAP coins); offline spends now need connectivity (accept, clear toast, gameplay offline OK); latency (avoided by design); auth-null degrade to cached read-only, NEVER local-authoritative; config drift (keep sync note like coinSystem.js:26).

## Open questions
1. Discard vs capped-import legacy balances — rec capped max-import; confirm caps (50k coins/500 gems).
2. Power-up counts P0 or P1? scoped P1.
3. Mission/daily progress client-side (cheatable claims) or server P0? rec client-progress/server-claim.
4. IAP PRODUCTS coins (coins_small:5000, coins_big:30000) vs import cap — confirm cap above top SKU.

---

# FINAL CORRECTIONS (AUTHORITATIVE — overrides above)

Applied from adversarial critic review. Verified facts:
- iapVerification.js:385-386 writes users/{uid}.coins/.gems ADDITIVELY (IAP-only, never decremented) → server `coins` today is a LIFETIME IAP-GRANT TOTAL, not a spendable balance.
- submitScore (index.js:155-178) IS idempotent per sessionToken (marks used:true in txn first) → safe to fold coin grant here. Grant must sit OUTSIDE the score>prevBest branch (index.js:204) so every run earns.
- Anti-cheat: score ≤ 300·elapsed + 2000 (index.js:182). endRun faucet caps ~5000/day.

## FC1 (was C1) — P0 is ALL-OR-NOTHING on earns.
The release that makes boot read `getEconomyStatus` authoritative MUST also make EVERY grant() earn path server-backed in the SAME release. Otherwise boot-overwrite deletes legit daily/mission/double-coins/cross-promo rewards.
→ P0 now includes: spends (skin/powerup/revive) + per-run earn (endRun) + double-coins + claimDaily + claimMission + cross-promo server-apply. Nothing earn-related deferred to P1.

## FC2 (was C2+M1) — Migration import, corrected.
Trust-import is the ONLY dangerous part. Rules:
1. GATE: import runs ONLY for a user whose users/{uid} doc PRE-EXISTS the migration deploy (has createdAt/bestScore/recoveryCode/IAP history older than a cutoff timestamp). Fresh anonymous uids (no pre-existing doc) get INITIAL balance (0 or small), NEVER a localStorage import. Closes the "mint new uid + seed sb_coins=50000" faucet.
2. AMOUNT: imported balance = min(clientCoins, IMPORT_CAP). Do NOT max() with server IAP total (that total is lifetime-grant, not balance → max mints already-spent IAP coins to payers). Trust the post-spend local balance, capped.
3. owned_skins: import verbatim (cosmetic, low risk).
4. Set economy_initialized:true (server-side) after import; subsequent calls ignore client balance.
Note: reinstall-lost-paid-coins is a PRE-EXISTING risk (index.js:282-283); do NOT fix it by minting. If protecting reinstalled whales matters later → reconcile against unconsumed-IAP records, not a running total.
Caps: IMPORT_CAP_COINS ≤ top SKU-ish (coins_big=30000). Propose 30000 coins / 300 gems (NOT 50k). Confirm with owner if a legit player could exceed.

## FC3 (was M3) — claimDaily → P0. claimMission → may stay P1.
claimDaily needs NO client progress (server computes streak from daily.last + KST). Leaving it client = ~2000 coins/day faucet → must be P0.
claimMission needs client progress tracking; server-claim + idempotent per missionId/day is acceptable interim. Residual faucet ≈ ~750 coins + gems/day/account (3 claims × 150-300 + gems mission) ON TOP of 5000/day endRun cap. Acceptable pre-scale; full close (endRun-driven progress) = P2.

## FC4 (was M4) — Gem-revive per-run counter is SERVER-side.
Track revive count in the game_sessions/{sessionToken} doc; increment server-side on each revive spend; cost = revive_gem_base + revive_gem_step * serverPerRunReviveCount. Never trust client revivesUsed.

## FC5 (was M2) — Session-less / offline run earn.
submitScore no-ops when sessionToken null (index.html:1486); startRun is fire-and-forget (:3739), fails offline / on whenAuthReady 8s timeout. Offline queue CANNOT fabricate a session (elapsed-time anti-cheat). Decision: an offline/session-less run keeps its coins as LOCAL-CACHE-PENDING and is NOT reconcile-overwritten to a lower server value until a successful authoritative sync exists; show coins, message nothing, reconcile up only. Never reconcile-DOWN over unsynced local earn. (Simplest safe behavior; revisit if abused.)

## FC6 (was M5) — Offline queue dequeues on duplicate-as-success.
Queued endRun/claim replays whose response was lost will throw already-used/DUPLICATE. Client MUST treat those errors as terminal SUCCESS and dequeue (not retry forever). Flush reuses each item's STORED token (never regenerates; never the fixed 'reward' key at index.html:878).

## FC7 (was S1/S2) — Client display from config_public.
Move client price DISPLAY + canAfford pre-check to derive from getEconomyStatus's config_public (skin/powerup/daily/mission costs), so shown price == what spendCurrency charges. submitScore wiring: surface res.data.coins for applyServerBalance; grant OUTSIDE the PB branch.

## FINAL P0 SCOPE (implement in this order, single coherent release)
Server (functions/):
  1. coinSystem.js — DEFAULT_ECONOMY config + applyBalanceDelta(2-currency, idempotency, caps, negative-guard) + KST daily-reset helper (standalone, no heart import).
  2. onCall handlers in index.js: getEconomyStatus (FC2 import), spendCurrency (cost-from-config; skin→owned_skins, powerup→count, revive→FC4 session counter), rewardFromAd (unique adToken, double_coins re-reads server lastRunBaseCoins, revive impression), claimDaily (FC3), claimMission, fold coin-grant into submitScore/endRun (FC7, outside PB branch), add applyBalanceDelta into claimCrossPromoReward (index.js ~498-506).
Client (index.html):
  3. applyServerBalance(resp) single reconcile point; boot getEconomyStatus after whenAuthReady.
  4. Convert spends (payCost/skin/powerup/gem-revive) → await spendCurrency; offline/auth-null → toast, NO grant.
  5. Convert earns (endRun, double-coins, claimDaily, claimMission, cross-promo) → server + applyServerBalance; per-run optimistic + reconcile-up-only (FC5).
  6. Offline earn queue (FC6). Unique adToken (crypto.randomUUID) replacing fixed 'reward' key (index.html:878).
  7. Display/canAfford from config_public (FC7).
Deploy functions + build/deploy client. Verify: localStorage edit no longer grants spend power; legit daily/mission/double-coins survive restart; import gated on pre-existing doc; whale IAP not double-credited.

P1: powerups counts server-side; SSV (P3); ledger (P2); endRun-driven mission progress (P2).

---

# AS-IMPLEMENTED (server pass — authoritative for client pass)

Server files DONE + reviewed: functions/coinSystem.js (new), functions/index.js (handlers + submitScore fold + claimCrossPromo balance-apply). NOT deployed yet.

Handler response shapes the CLIENT must consume:
- getEconomyStatus({coins?,gems?,owned_skins?}) → {coins,gems,owned_skins[],powerups{headstart,magnet,shield},daily{last,streak},missions{date,claimed{}},daily_coin_earned,daily_coin_earn_remaining,daily_rewarded_remaining,daily_revive_remaining,config_public{skin_costs,powerup_costs,revive_gem_base,revive_gem_step,mission_rewards,daily_rewards,coin_per_score,coins_per_sec_cap,crosspromo_rewards}}. The {coins,gems,owned_skins} INPUT is the one-time import payload (send current localStorage on boot).
- spendCurrency({reason:'skin'|'powerup'|'revive', itemId?, sessionToken?}) → skin:{coins,gems,owned_skins}; powerup:{coins,gems,powerups}; revive:{coins,gems,revive_count,gem_cost}. revive REQUIRES sessionToken (current run's).
- rewardFromAd({adToken, context:'double_coins'|'revive'}) → {coins,gems,granted}. adToken MUST be unique per call (crypto.randomUUID) — replaces fixed 'reward' key at index.html:878. double_coins claimable ONCE per run (server guards via last_run_doubled).
- claimDaily() → {coins,gems,daily,reward}. claimMission({missionId}) → {coins,gems,missions}.
- submitScore now takes pickupCoins and returns {best,rank,coins,earned} — coins granted server-side every run.
Error codes (HttpsError): already-exists(ALREADY_OWNED/CLAIMED/DUPLICATE_CALLBACK/ALREADY_DOUBLED), failed-precondition(INSUFFICIENT_COINS/GEMS), resource-exhausted(RATE_LIMITED/limits), not-found(USER_NOT_FOUND/SESSION), invalid-argument(UNKNOWN_*).

Import gate (as implemented): MIGRATION_CUTOFF_MS = Date.parse("2026-07-11T00:00:00Z") — BUMP to real deploy time. Import only if createdAt < cutoff; capped min(client,cap) but floored at existing server balance (never lose IAP coins); non-eligible → preserve existing server balance (never 0-wipe). Fresh post-cutoff uid → 0 start (C2 closed).

CLIENT PASS TODO (P0c-client, index.html monolith):
1. applyServerBalance(resp) single reconcile: set state.coins/gems/owned/powerups from any handler resp → refreshHUD + persist(cache).
2. Boot: after whenAuthReady, call getEconomyStatus with current localStorage {coins,gems,owned_skins} as import payload; apply. localStorage becomes read-cache only (never truth after boot).
3. Spends → await spendCurrency (skins :1247, powerups :1252, gem-revive :3400-3403 pass sessionToken). Offline/auth-null → toast, NO local grant. Display + canAfford from config_public (FC7).
4. Earns → server + optimistic reconcile-UP-only (FC5): endRun via submitScore{score,pickupCoins:runCoins}; double-coins :3929 → rewardFromAd(double_coins, adToken); claimDaily :1099; claimMission :1084; cross-promo :1830 uses returned coins.
5. Offline earn queue (FC6): pendingEarns[] localStorage, flush after whenAuthReady, dequeue-on-DUPLICATE-as-success, reuse stored token.
6. Unique adToken (crypto.randomUUID) per rewarded call — kill fixed 'reward' key at :878.
