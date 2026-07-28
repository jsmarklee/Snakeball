# Snakeball — iOS app

A SwiftUI + WKWebView wrapper that hosts the Snakeball web game and bridges it to
native **haptics**, **AdMob** (rewarded + interstitial), and **StoreKit 2 IAP**.
Generated from `project.yml` with [XcodeGen](https://github.com/yonaskolb/XcodeGen).

## Layout
```
Mobile/iOS/
  project.yml                     # XcodeGen source of truth (bundle id, SPM deps, settings)
  Snakeball.xcodeproj             # generated — run `xcodegen generate` to recreate
  Snakeball/
    SnakeballApp.swift            # @main, AdMob init
    ContentView.swift             # WebView(url: https://snakeball-game.web.app)
    WebView.swift                 # JS↔native bridge + RewardedAdManager + InterstitialAdManager
    StoreKitManager.swift         # StoreKit 2 (SKUs match index.html STORE)
    Info.plist                    # GADApplicationIdentifier, SKAdNetwork, ATS, portrait
    PrivacyInfo.xcprivacy         # privacy manifest (DeviceID + ads)
    Snakeball.storekit            # local IAP testing config
    Assets.xcassets               # AppIcon (placeholder) + colors
```

## Build & run
```bash
brew install xcodegen          # one-time
cd Mobile/iOS
xcodegen generate              # (re)create Snakeball.xcodeproj from project.yml
open Snakeball.xcodeproj        # then pick a simulator and Run
```
CLI build (what CI uses):
```bash
xcodebuild build -project Snakeball.xcodeproj -scheme Snakeball \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO
```

## Bridge contract (what the web `window.SB` layer calls)
- `hapticHandler.vibrate {type}` → UIKit haptics
- `adHandler.showRewardedAd {customData}` → AdMob rewarded → `window.__bridgeCallbacks('adReward', {success})`
- `adHandler.showInterstitial` → AdMob interstitial → `window.__bridgeCallbacks('interstitialClosed', {})`
- `iapHandler.purchase {productId}` → StoreKit → `window.__bridgeCallbacks('iapPurchase', {success, productId})`
- `iapHandler.restorePurchases` → `window.__bridgeCallbacks('iapRestore', {success, productIds:[...]})`
- `authHandler.getDeviceId` → `window.__bridgeCallbacks('deviceId', {id})` (for future cloud sync)

## Before shipping to the App Store — required edits
1. **Deploy the web game** so the WebView has something to load. The app points at
   `https://snakeball-game.web.app` (`ContentView.swift`). From the repo root run
   `npm run deploy:web`. Confirmed working: the WebView already loads that URL over
   HTTPS — it currently shows Firebase "Site Not Found" only because hosting isn't
   deployed yet. If your hosting domain differs, update the URL in `ContentView.swift`
   (and the icon URL in `../../granite.config.ts`).
2. **AdMob real IDs** (currently Google TEST ids):
   - `Info.plist` → `GADApplicationIdentifier`
   - `WebView.swift` → `RewardedAdManager.adUnitId` and `InterstitialAdManager.adUnitId`
3. **App Store Connect IAP**: create exactly these four, all **Consumable** (ids must
   match character for character): `coins.5000`, `coins.30000`, `gems.small`,
   `gems.big`. Do **not** create `remove.ads` or `starter.pack` — they exist in
   neither the client STORE nor the server PRODUCTS map, so a purchase of one could
   never be fulfilled. For local simulator testing, attach `Snakeball.storekit` in the
   scheme: Edit Scheme → Run → Options → StoreKit Configuration.
4. **Signing**: open the project, select your Team (Automatic signing). Bundle id is
   `studio.hodgepodge.snakeball`.
5. **App icon**: done — `Assets.xcassets/AppIcon.appiconset/icon-1024.png`
   (generated from `docs/icon-src.png`).
6. **Server-side receipt verification: already shipped — do not "add" it.**
   StoreKit success does NOT grant. The token goes to the web layer, which calls
   `verifyAndFulfillPurchase`; only after the server verifies the receipt and writes
   the grant does the client call `finishTransaction`. Anything that grants on
   StoreKit success alone would be a regression.

## Notes
- Portrait-only, full screen, status bar hidden, scroll/bounce disabled.
- The store sells 4 consumables only: `coins.5000`, `coins.30000`, `gems.small`,
  `gems.big`. There is no `remove.ads` or Starter Pack, and no interstitial —
  rewarded ads (revive, double coins) are the only ad placements.
- StoreKit 2 + `persistentSystemOverlays` require iOS 16+ (deployment target).
