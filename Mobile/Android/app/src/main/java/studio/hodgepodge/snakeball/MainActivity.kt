package studio.hodgepodge.snakeball

import android.content.Context
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.view.View
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.RequestConfiguration
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback
import org.json.JSONObject

// Game background color — keep in sync with the web game (#0a0a1a) so there's no
// white flash before the WebView paints its first frame.
private const val GAME_BG = "#0a0a1a"

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private var rewardedAd: RewardedAd? = null
    private var pendingRewardEarned: Boolean = false
    private var rewardCallbackFired: Boolean = false
    lateinit var billingManager: BillingManager
    lateinit var playGamesManager: PlayGamesManager
    private final var TAG = "MainActivity"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Initialize the Mobile Ads SDK.
        // Defense-in-depth against AdMob "invalid activity" suspensions: register our own
        // devices as test devices so they ALWAYS get test ads — even on release/internal-test
        // builds where BuildConfig.DEBUG is false and the real ad unit would otherwise serve.
        // Paste the hash logged by the SDK ("Use RequestConfiguration.Builder.setTestDeviceIds
        // (Arrays.asList(\"<HASH>\")) to get test ads on this device.") into the list below.
        val testDeviceIds = listOf<String>(
            // "PASTE_HASH_FROM_LOGCAT_HERE",
        )
        if (testDeviceIds.isNotEmpty()) {
            MobileAds.setRequestConfiguration(
                RequestConfiguration.Builder().setTestDeviceIds(testDeviceIds).build()
            )
        }
        MobileAds.initialize(this) {}
        loadRewardedAd()

        // Initialize Billing Manager for IAP. All Snakeball products are consumables;
        // on a successful purchase notify the web layer, then consume immediately so the
        // item can be bought again.
        billingManager = BillingManager(this) { success, purchaseToken, productId, _ ->
            // Surface the purchaseToken + productId to the web layer so it can call the
            // verifyAndFulfillPurchase Cloud Function (server-side receipt verification).
            // We still consume immediately below — the server verifies token validity via
            // the Google Play Developer API, which works before/after consumption.
            val json = if (success) {
                val obj = JSONObject()
                obj.put("success", true)
                obj.put("purchaseToken", purchaseToken ?: "")
                obj.put("productId", productId ?: "")
                obj.toString()
            } else {
                "{ \"success\": false }"
            }
            if (::webView.isInitialized) {
                webView.post {
                    webView.evaluateJavascript("window.__bridgeCallbacks('iapPurchase', $json);", null)
                    if (success && purchaseToken != null && productId != null) {
                        billingManager.finishTransaction(purchaseToken, productId)
                    }
                }
            }
        }
        billingManager.startConnection()

        // Play Games Services: 초기화 + 런치 시 사인인 (iOS Game Center와 동일 역할).
        playGamesManager = PlayGamesManager(this)
        playGamesManager.initialize()
        playGamesManager.authenticate { success ->
            android.util.Log.d(TAG, "Play Games sign-in on launch: $success")
        }

        // Keep screen awake during gameplay
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Edge-to-edge: draw behind system bars
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT

        // Hide the status bar completely
        androidx.core.view.WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(androidx.core.view.WindowInsetsCompat.Type.statusBars())
        }

        // Only enable WebView debugging in debug builds
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        // Create WebView directly (no Compose wrapper)
        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor(GAME_BG))
            setLayerType(View.LAYER_TYPE_HARDWARE, null)

            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = true
            settings.allowContentAccess = true
            settings.databaseEnabled = true
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.cacheMode = WebSettings.LOAD_NO_CACHE
            settings.mediaPlaybackRequiresUserGesture = false
            // Disable pinch/zoom — this is a full-screen game, not a document.
            settings.setSupportZoom(false)
            settings.builtInZoomControls = false
            settings.displayZoomControls = false

            // Disable long-press text selection / context menu (game canvas).
            isLongClickable = false
            setOnLongClickListener { true }

            webViewClient = object : WebViewClient() {
                override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                    android.util.Log.i("SB_WebView", "🌐 Loading started: $url")
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    android.util.Log.i("SB_WebView", "✅ Loading finished: $url")
                }

                override fun onReceivedError(view: WebView?, request: android.webkit.WebResourceRequest?, error: android.webkit.WebResourceError?) {
                    super.onReceivedError(view, request, error)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        android.util.Log.e("SB_WebView", "❌ Resource Error [${request?.url}]: ${error?.description}")
                    }
                }

                override fun onReceivedHttpError(view: WebView?, request: android.webkit.WebResourceRequest?, errorResponse: android.webkit.WebResourceResponse?) {
                    super.onReceivedHttpError(view, request, errorResponse)
                    android.util.Log.e("SB_WebView", "❌ HTTP Error [${request?.url}]: ${errorResponse?.statusCode}")
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                    consoleMessage?.let {
                        android.util.Log.d("SB_Console", "${it.messageLevel()}: ${it.message()} [${it.sourceId()}:${it.lineNumber()}]")
                    }
                    return true
                }
            }

            addJavascriptInterface(AndroidBridge(this, this@MainActivity, this@MainActivity), "AndroidBridge")
            loadUrl("https://snakeball-game.web.app")
        }

        // Set as content view directly
        val container = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor(GAME_BG))
            addView(webView, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            ))
        }
        setContentView(container)

        // Hardware back: navigate WebView history if possible, otherwise send the task
        // to the background instead of killing the activity (avoids losing game state).
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (::webView.isInitialized && webView.canGoBack()) {
                    webView.goBack()
                } else {
                    moveTaskToBack(true)
                }
            }
        })
    }

    private fun loadRewardedAd() {
        val adRequest = AdRequest.Builder().build()
        // Debug builds serve Google's official TEST rewarded unit (impressions/clicks
        // never count toward the account → no "invalid activity" suspension risk during QA).
        // Release builds (Play Console internal/prod) hit the real revenue unit.
        // NOTE: signed internal-test tracks are release builds → real ads. Register your
        // device under AdMob console test devices before tapping ads on those builds.
        val testAdUnitId = "ca-app-pub-3940256099942544/5224354917" // Google test rewarded (Android)
        // TODO: replace with real AdMob ids before release
        val realAdUnitId = "ca-app-pub-3940256099942544/5224354917"
        val adUnitId = if (BuildConfig.DEBUG) testAdUnitId else realAdUnitId

        RewardedAd.load(this, adUnitId,
            adRequest, object : RewardedAdLoadCallback() {
                override fun onAdFailedToLoad(adError: LoadAdError) {
                    android.util.Log.d(TAG, "Failed to load: ${adError.message}")
                    rewardedAd = null

                    if (BuildConfig.DEBUG) {
                        showAdErrorAlert("Ad Load Failed: ${adError.message}")
                    }
                }

                override fun onAdLoaded(ad: RewardedAd) {
                    android.util.Log.d(TAG, "Ad was loaded.")
                    rewardedAd = ad
                }
            })
    }

    private fun showAdErrorAlert(message: String) {
        runOnUiThread {
            android.app.AlertDialog.Builder(this@MainActivity)
                .setTitle("AdMob Debug Error")
                .setMessage(message)
                .setPositiveButton("OK", null)
                .show()
        }
    }

    fun showRewardedAd() {
        if (rewardedAd != null) {
            pendingRewardEarned = false
            rewardCallbackFired = false

            rewardedAd?.fullScreenContentCallback = object: FullScreenContentCallback() {
                override fun onAdClicked() {
                    android.util.Log.d(TAG, "Ad was clicked.")
                }
                override fun onAdDismissedFullScreenContent() {
                    android.util.Log.d(TAG, "Ad dismissed fullscreen content.")
                    rewardedAd = null
                    loadRewardedAd() // Preload next ad

                    val rewarded = pendingRewardEarned
                    if (!rewardCallbackFired) {
                        rewardCallbackFired = true
                        val js = if (rewarded) {
                            "window.__bridgeCallbacks('adReward', { success: true, type: 'reward', amount: 1 });"
                        } else {
                            "window.__bridgeCallbacks('adReward', { success: false });"
                        }
                        webView.post { webView.evaluateJavascript(js, null) }
                    }
                }
                override fun onAdFailedToShowFullScreenContent(adError: AdError) {
                    android.util.Log.e(TAG, "Ad failed to show fullscreen content: ${adError.message}")
                    rewardedAd = null

                    if (BuildConfig.DEBUG) {
                        showAdErrorAlert("Ad Show Failed: ${adError.message}")
                    }

                    if (!rewardCallbackFired) {
                        rewardCallbackFired = true
                        val js = "window.__bridgeCallbacks('adReward', { success: false });"
                        webView.post { webView.evaluateJavascript(js, null) }
                    }
                }
                override fun onAdImpression() {
                    android.util.Log.d(TAG, "Ad recorded an impression.")
                }
                override fun onAdShowedFullScreenContent() {
                    android.util.Log.d(TAG, "Ad showed fullscreen content.")
                }
            }

            rewardedAd?.show(this) { _ ->
                // Reward earned — but don't signal JS yet. We wait until the ad is
                // fully dismissed (onAdDismissedFullScreenContent) to fire the callback.
                android.util.Log.d(TAG, "User earned the reward.")
                pendingRewardEarned = true
            }
        } else {
            android.util.Log.d(TAG, "The rewarded ad wasn't ready yet.")

            if (BuildConfig.DEBUG) {
                showAdErrorAlert("The rewarded ad wasn't ready yet.")
            }

            // Signal failure back to WebView
            val js = "window.__bridgeCallbacks('adReward', { success: false });"
            webView.post {
                webView.evaluateJavascript(js, null)
            }
        }
    }

    override fun onPause() {
        super.onPause()
        // Pause WebView JS timers + media (matches iOS app backgrounding behavior)
        if (::webView.isInitialized) {
            webView.onPause()
            webView.pauseTimers()
        }
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) {
            webView.onResume()
            webView.resumeTimers()
        }
    }

    override fun onDestroy() {
        billingManager.destroy()
        if (::webView.isInitialized) {
            webView.removeJavascriptInterface("AndroidBridge")
            (webView.parent as? android.view.ViewGroup)?.removeView(webView)
            webView.destroy()
        }
        super.onDestroy()
    }
}

class AndroidBridge(private val webView: WebView, private val context: Context, private val activity: MainActivity) {

    @JavascriptInterface
    fun vibrate(json: String) {
        try {
            val obj = JSONObject(json)
            val type = obj.optString("type", "medium")

            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                vibratorManager.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }

            val duration = when (type) {
                "light" -> 10L
                "medium" -> 30L
                "heavy" -> 60L
                "success" -> 40L
                "error" -> 50L
                else -> 30L
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(duration)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    @JavascriptInterface
    fun showRewardedAd(json: String? = null) {
        // json may carry { customData } but Snakeball's rewarded flow is uniform,
        // so we just show the ad and report success/failure.
        activity.runOnUiThread {
            activity.showRewardedAd()
        }
    }

    // ─── IAP (consumables only) ───────────────────────────

    @JavascriptInterface
    fun purchase(json: String? = null) {
        try {
            val obj = JSONObject(json ?: "{}")
            val productId = obj.optString("productId", "")
            if (productId.isNotEmpty()) {
                activity.runOnUiThread {
                    activity.billingManager.purchase(productId)
                }
            } else {
                val js = "window.__bridgeCallbacks('iapPurchase', { success: false });"
                webView.post { webView.evaluateJavascript(js, null) }
            }
        } catch (e: Exception) {
            val js = "window.__bridgeCallbacks('iapPurchase', { success: false });"
            webView.post { webView.evaluateJavascript(js, null) }
        }
    }

    // ─── Device ID ──────────────────────────────────────

    @JavascriptInterface
    fun getDeviceId(json: String? = null) {
        val androidId = try {
            Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: ""
        } catch (e: Exception) {
            ""
        }
        // Escape for JS safety
        val safeId = androidId.replace("'", "\\'")
        val js = "window.__bridgeCallbacks('deviceId', { id: '$safeId' });"
        webView.post {
            webView.evaluateJavascript(js, null)
        }
    }

    // ─── Play Games Services (leaderboards) ───────────────

    @JavascriptInterface
    fun submitScore(json: String? = null) {
        try {
            val obj = JSONObject(json ?: "{}")
            val score = obj.optLong("score", 0L)
            activity.runOnUiThread {
                activity.playGamesManager.submitScore(score) { success ->
                    val js = "window.__bridgeCallbacks('gameCenterScore', { success: $success });"
                    webView.post { webView.evaluateJavascript(js, null) }
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("AndroidBridge", "submitScore error: ${e.message}")
        }
    }

    @JavascriptInterface
    fun showLeaderboard(json: String? = null) {
        activity.runOnUiThread {
            activity.playGamesManager.showLeaderboard()
        }
    }
}
