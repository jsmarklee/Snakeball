# Snakeball — Android app

A Kotlin + WebView wrapper that hosts the Snakeball web game and bridges it to
native **haptics**, **AdMob** (rewarded), **Google Play Billing** (consumable IAP),
and a stable **device id**. Single `MainActivity` — no Compose, no Firebase, no
Play Games. Loads the hosted web build, so deploying the web game updates the app
without a Play Store review.

## Layout
```
Mobile/Android/
  settings.gradle.kts                  # rootProject.name = "Snakeball", :app
  build.gradle.kts                     # top-level: android-application plugin only
  gradle/libs.versions.toml            # version catalog (core-ktx, activity, webkit, billing, ads)
  keystore.properties.example          # copy → keystore.properties (gitignored) for release signing
  app/
    build.gradle.kts                   # namespace/appId studio.hodgepodge.snakeball, v1.0.0 (code 1)
    proguard-rules.pro                 # keeps the AndroidBridge JS interface
    src/main/
      AndroidManifest.xml              # portrait, INTERNET, AdMob app-id, https-only
      java/studio/hodgepodge/snakeball/
        MainActivity.kt                # WebView + AndroidBridge + rewarded ad flow
        BillingManager.kt              # Play Billing wrapper (consumables only)
      res/                             # icons, strings (app_name=Snakeball), dark theme, ad-services xml
```

## Open & build
```bash
# Android Studio: File → Open → Mobile/Android, let Gradle sync, pick a device, Run.
# CLI debug build:
cd Mobile/Android
./gradlew assembleDebug                 # APK → app/build/outputs/apk/debug/
# Release bundle (needs keystore.properties — see below):
./gradlew bundleRelease                 # AAB → app/build/outputs/bundle/release/
```
Requires a local Android SDK (set `sdk.dir` in `local.properties`, or open in
Android Studio which writes it for you). The Gradle wrapper (`gradlew`) pins the
Gradle version, so no system Gradle install is needed.

## Bridge contract (what the web `window.SB` layer calls)
The web side calls `window.AndroidBridge[action](JSON.stringify(data))`; native
replies via `window.__bridgeCallbacks(name, data)` on the UI thread.

| JS call | payload | native → web callback |
|---|---|---|
| `AndroidBridge.vibrate` | `{type, pattern}` (type ∈ light/medium/heavy/success/error) | — |
| `AndroidBridge.showRewardedAd` | `{customData}` | `__bridgeCallbacks('adReward', {success, type:'reward', amount:1})` / `{success:false}` |
| `AndroidBridge.purchase` | `{productId}` | `__bridgeCallbacks('iapPurchase', {success})` |
| `AndroidBridge.getDeviceId` | — | `__bridgeCallbacks('deviceId', {id})` (`Settings.Secure.ANDROID_ID`) |

`showInterstitial` and `restorePurchases` are intentionally **not** implemented —
the Snakeball web layer no longer calls them.

## Before shipping to Google Play — pre-launch checklist
1. **Deploy the web game** so the WebView has something to load. The app points at
   `https://snakeball-game.web.app` (`MainActivity.loadUrl`). From the repo root run
   `npm run deploy:web`. If your hosting domain differs, update the URL in
   `MainActivity.kt`.
2. **AdMob real IDs** (currently Google TEST ids, marked with `// TODO: replace with
   real AdMob ids before release`):
   - App id → `app/build.gradle.kts` release `manifestPlaceholders["admobAppId"]`
   - Rewarded unit id → `MainActivity.loadRewardedAd()` `realAdUnitId`
3. **Google Play Console IAP**: create these **consumable** products; ids must match
   exactly (also in `BillingManager.PRODUCT_IDS` and the web `STORE`):
   `coins.5000`, `coins.30000`, `gems.small`, `gems.big`.
4. **Signing**: create an upload keystore (`keytool -genkey ...`), then
   `cp keystore.properties.example keystore.properties` and fill in the 4 values.
   `keystore.properties` and `*.jks` are gitignored — back them up separately.
5. **App icon**: replace the placeholder adaptive icon under
   `res/mipmap-*/ic_launcher*` and `res/drawable/ic_launcher_background.xml`.
6. **Package name** is `studio.hodgepodge.snakeball` (applicationId) — must match the
   Play Console app and the AdMob/IAP product setup.
7. (Recommended) Add server-side purchase verification before granting large IAPs.
   v1 grants client-side on Billing success, then consumes the purchase.

## Notes
- Portrait-only, full screen, status bar hidden, edge-to-edge, hardware accelerated.
- WebView background is `#0a0a1a` (matches the game) to avoid a white flash on launch.
- `usesCleartextTraffic=false` — HTTPS only. Zoom and long-press selection disabled.
- Hardware back navigates WebView history if possible, else sends the task to the
  background (does not kill the activity / lose game state).
- WebView JS timers + media pause/resume on `onPause`/`onResume`.
- Debug builds serve Google's TEST ad unit; release builds use the real unit. Register
  your device under AdMob test devices (`testDeviceIds` in `MainActivity`) before
  tapping ads on signed internal-test tracks.
