# CLAUDE.md — Snakeball Project Guide

## PROJECT OVERVIEW

Snakeball — a simple, addictive casual 3D endless runner. Roll a growing ball of
balls down a neon highway, smash numbered cubes (need ballCount > cube HP),
dodge walls/iron cubes, grab mega-balls, collect coins, chase combos.

Ships to **iOS, Android, and Apps in Toss** from one codebase (same pattern as
the sibling project `../MinefieldSweeper`).

### Tech Stack
- **Engine**: Three.js (r160 via CDN) — single-file `index.html`, no framework.
- **Economy/Bridge layer**: an inline `window.SB` ES module (top of `index.html`)
  that mirrors MinefieldSweeper's `BridgeManager` + `AdManager` + IAP managers.
- **Persistence**: **server-authoritative economy** — coins/gems/owned-skins/power-ups
  live in Firestore `users/{uid}` and are read/written via Cloud Functions
  (`getEconomyStatus`/`spendCurrency`/`rewardFromAd`/`claimDaily`/`claimMission`,
  IAP grants via `verifyAndFulfillPurchase`). `localStorage` is only a **read-through
  cache** (last-known balance, settings, mission progress) that boot reconciles down
  to the server value. Leaderboard identity (name/bestScore) + recovery codes also
  server-side. (Was localStorage-only pre-2026-07; migrated — see
  `docs/economy-migration-design.md`.)
- **Platforms**: Web, iOS (WKWebView), Android (WebView), Toss (granite/RN webview).
- **Toss build**: `@apps-in-toss/web-framework` + `granite` + `vite`.

### File layout
```
index.html            # the entire game + SB economy/bridge layer
  ├─ <script type=module> #1  → window.SB (economy, bridge, shop/missions/daily UI)
  └─ <script type=module> #2  → game (Three.js scene, loop, collisions, revive/result)
public/index.html     # deploy copy for Firebase Hosting (gitignored; `npm run sync:public`)
granite.config.ts     # Toss app config (appName, brand, dev host/port 5173)
vite.config.js        # used by the Toss/granite build to bundle the module scripts
firebase.json         # Hosting config + security headers + cache rules
package.json          # scripts: dev / build / sync:public / deploy:web / toss:*
```

> Both inline scripts are `type="module"` **on purpose**: it lets the granite/vite
> Toss build bundle the `@apps-in-toss` dynamic imports into a lazy chunk. Module
> scripts run in document order, so `window.SB` is defined before the game module.
> On raw web/iOS/Android the bare `import('@apps-in-toss/...')` calls **never run**
> (they live inside `if (platform === 'toss')` branches), so no bundler is needed
> there — the raw `index.html` runs directly in a modern WebView.

## ARCHITECTURE

### Game loop / states
`menu → playing → (revive) → result → menu/playing`. A single `requestAnimationFrame`
loop in script #2 gates simulation on `gameState === 'playing'`. Object pools for
cubes / walls / free-ball items / mega-balls / **coins** / particles. Road is a
deforming curved plane; obstacles bend with it via `applyRoadCurve()`.

### The SB layer (script #1) — public API used by the game
- `SB.platform` — `'ios' | 'android' | 'toss' | 'web'` (detected once at load).
- `SB.showRewardedAd()` → `Promise<bool rewarded>` (revive + double-coins).
- `SB.vibrate(type)` — haptics (`light|medium|heavy|success|error`).
- `SB.addCoins/addGems/spendCoins/spendGems`, `SB.activeSkin()`.
- `SB.armedPowerups()` / `SB.consumeArmed()` — head-start / magnet / shield.
- `SB.reportRun({score,coins,cubes,megas,revived,combo,balls})` — drives missions + stats.
- `SB.refreshHUD / updateBadges / toast / openShop`, `SB.hasRemoveAds / soundOn / hapticsOn`.

The game also exposes back to SB: `window.__applySkin`, `window.__setSound`.

## NATIVE BRIDGE CONTRACT (for iOS / Android wrappers)

Detection (in `SB`): iOS needs `window.webkit.messageHandlers.adHandler`; Android
needs `window.AndroidBridge`; Toss is `window.ReactNativeWebView`; else `web`.
Copy the wrapper shells from `../MinefieldSweeper/Mobile/{iOS,Android}` and
implement these handlers. **Same contract as MinefieldSweeper**, so the wrappers
are near drop-in:

### Web → Native (messages the game sends)
| Handler | action | payload | purpose |
|---|---|---|---|
| `adHandler` | `showRewardedAd` | `{ customData }` | show a rewarded ad |
| `hapticHandler` | `vibrate` | `{ type, pattern }` | haptic feedback |
| `iapHandler` | `purchase` | `{ productId }` | start a store purchase |
| `iapHandler` | `restorePurchases` | — | restore non-consumables |

- iOS: `window.webkit.messageHandlers[handler].postMessage({action, ...data})`.
- Android: `window.AndroidBridge[action](JSON.stringify(data))` (`@JavascriptInterface`).

### Native → Web (callbacks native must invoke)
- Rewarded ad result: `window.__adRewardCallback(success: bool, type, amount)`.
- Generic: `window.__bridgeCallbacks(name, data)` where `name === 'iapPurchase'`
  returns `{ success }` for a purchase.

If a platform has no rewarded ads yet, just never call `__adRewardCallback` with
success — the game treats it as "not rewarded" and continues gracefully.

## MONETIZATION (already wired)

- **Rewarded ads** (the big earner): **Revive** after death (also payable with gems,
  cost escalates 5→10→15), and **Double coins** on the result screen. Capped at
  `MAX_REVIVES` per run.
- **IAP** (`STORE` in script #1; SKUs must match the native store + any server
  verification): `coins.5000/coins.30000`, `gems.small/gems.big`, `remove.ads`
  (non-consumable), `starter.pack` (best value, non-consumable bundle).
- **Coin sinks**: 8 ball **skins** (coins + premium gem skins incl. animated
  Rainbow) and consumable **power-ups** (Head Start +8 balls, Coin Magnet, Shield).
- **Retention**: 7-day **daily reward** streak (auto-pops for returning players) and
  3 rotating **daily missions** with coin/gem payouts + home-screen badges.
- **Addiction loop**: combo multiplier on cube-break streaks (decays after 3s),
  in-world coin trails, escalating speed/FOV, juicy particles + camera shake.

### Toss specifics (from MinefieldSweeper, apply when wiring Toss live)
- Set `TOSS_AD_GROUP_ID` (and optional `TOSS_CONTACTS_VIRAL_MODULE_ID`) in script #1
  from the Toss developer console.
- Ads do **not** run in the Toss sandbox — verify with `ait build && ait deploy`
  then the console QR on a real Toss app.
- IAP shows only console-registered + ON products in sandbox; SKUs must match `STORE`.
- Port **5173** is mandatory for the dev sandbox; `web.host` must be the LAN IP.

## BUILD & DEPLOY

```bash
# Web / iOS / Android (raw single-file, no bundler needed)
python3 -m http.server 8799         # local dev (open http://localhost:8799/index.html)
npm run deploy:web                  # sync public/ + firebase deploy --only hosting
                                    # iOS/Android WebViews load this hosted URL

# Toss (Apps in Toss)
npm install                         # installs @apps-in-toss/web-framework + vite
npm run dev                         # granite dev → vite on :5173 (Toss sandbox)
npm run toss:build                  # ait build (bundles SDK into lazy chunk)
npm run toss:deploy                 # ait deploy (needs `ait token add` first)
```

### iOS app (built — `Mobile/iOS/`)
A SwiftUI + WKWebView wrapper, generated from `Mobile/iOS/project.yml` via XcodeGen.
Implements the full bridge contract: haptics, AdMob rewarded **and** interstitial,
StoreKit 2 IAP (SKUs match `STORE`), restore, and `getDeviceId`. Loads the hosting
URL, so deploying the web build updates the game without an App Store review.
Verified: `xcodebuild` BUILD SUCCEEDED and the app boots in the simulator (the
WebView loads the URL over HTTPS). See `Mobile/iOS/README.md` for build/run and the
pre-launch checklist (deploy web, real AdMob ids, App Store Connect IAP, signing, icon).

```bash
brew install xcodegen && cd Mobile/iOS && xcodegen generate && open Snakeball.xcodeproj
```

### Android app (built — `Mobile/Android/`)
A Kotlin + WebView wrapper (package `studio.hodgepodge.snakeball`), ported from
MinefieldSweeper's shell and trimmed for Snakeball (no Play Games / Firebase /
PostHog SDK embedded in the **native shell** — the web layer talks to Firebase/Cloud
Functions directly for the server economy + leaderboard). Loads the hosting URL; portrait-only, dark
bg, edge-to-edge. Implements the bridge as `window.AndroidBridge` with exactly
four `@JavascriptInterface` methods: `vibrate`, `showRewardedAd` (AdMob rewarded),
`purchase` (Play Billing, consumables only), `getDeviceId` (ANDROID_ID). No
interstitial/restore (the game dropped them). SKUs match `STORE` (coins/gems).
AdMob ids are Google **test** ids (placeholders). See `Mobile/Android/README.md`
for the pre-launch checklist (real AdMob ids, Play Console IAP, signing keystore,
**replace placeholder launcher icon** — currently MinefieldSweeper's).

```bash
cd Mobile/Android && ./gradlew assembleDebug   # needs Android SDK
```

## WORKFLOW RULES
- After changing `index.html`, run `npm run sync:public` (or `deploy:web`) so the
  hosted copy that iOS/Android load stays in sync.
- Keep all `@apps-in-toss` calls inside `if (platform === 'toss')` + dynamic
  `import()` so the raw web/iOS/Android path never touches the SDK.
- Korean comments/docs OK; code in English.
- Touch the native bridge? Re-test all 4 platforms (Web/iOS/Android/Toss).
