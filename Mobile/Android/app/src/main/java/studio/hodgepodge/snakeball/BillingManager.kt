package studio.hodgepodge.snakeball

import android.app.Activity
import android.util.Log
import com.android.billingclient.api.*

/**
 * BillingManager — Google Play Billing Library wrapper.
 *
 * Snakeball only sells consumables (coins / gems), so every successful purchase is
 * consumed (which also acknowledges it) so the player can buy it again.
 */
class BillingManager(
    private val activity: Activity,
    private val onPurchaseResult: (success: Boolean, purchaseToken: String?, productId: String?, error: String?) -> Unit
) : PurchasesUpdatedListener {

    companion object {
        private const val TAG = "BillingManager"
        // SKUs must match the web layer's STORE and the Play Console product ids.
        val PRODUCT_IDS = listOf(
            "coins_small", "coins_big",
            "gems_small", "gems_big"
        )
    }

    private var billingClient: BillingClient = BillingClient.newBuilder(activity)
        .setListener(this)
        .enablePendingPurchases()
        .build()

    private var productDetailsList: List<ProductDetails> = emptyList()
    private var isConnected = false

    // ─── Connection ──────────────────────────────────────

    fun startConnection(onReady: () -> Unit = {}) {
        billingClient.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(billingResult: BillingResult) {
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    isConnected = true
                    Log.d(TAG, "Billing client connected")
                    onReady()
                } else {
                    Log.e(TAG, "Billing setup failed: ${billingResult.debugMessage}")
                }
            }

            override fun onBillingServiceDisconnected() {
                isConnected = false
                Log.w(TAG, "Billing service disconnected")
            }
        })
    }

    private fun ensureConnected(action: () -> Unit) {
        if (isConnected) {
            action()
        } else {
            startConnection { action() }
        }
    }

    // ─── Load Products ───────────────────────────────────

    private fun loadProductDetails(onLoaded: () -> Unit) {
        ensureConnected {
            val productList = PRODUCT_IDS.map { id ->
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(id)
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build()
            }
            val params = QueryProductDetailsParams.newBuilder()
                .setProductList(productList)
                .build()

            billingClient.queryProductDetailsAsync(params) { billingResult, details ->
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    productDetailsList = details
                } else {
                    Log.e(TAG, "Failed to load products: ${billingResult.debugMessage}")
                }
                onLoaded()
            }
        }
    }

    // ─── Purchase ─────────────────────────────────────────

    fun purchase(productId: String) {
        ensureConnected {
            val launch = {
                val productDetails = productDetailsList.find { it.productId == productId }
                if (productDetails == null) {
                    Log.e(TAG, "Product not found: $productId")
                    onPurchaseResult(false, null, productId, "product_not_found")
                } else {
                    val billingFlowParams = BillingFlowParams.newBuilder()
                        .setProductDetailsParamsList(
                            listOf(
                                BillingFlowParams.ProductDetailsParams.newBuilder()
                                    .setProductDetails(productDetails)
                                    .build()
                            )
                        )
                        .build()

                    val result = billingClient.launchBillingFlow(activity, billingFlowParams)
                    if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                        Log.e(TAG, "Launch billing flow failed: ${result.debugMessage}")
                        onPurchaseResult(false, null, productId, "launch_failed")
                    }
                }
            }
            // Make sure we have product details before launching the flow.
            if (productDetailsList.isEmpty()) loadProductDetails { launch() } else launch()
        }
    }

    // ─── PurchasesUpdatedListener ─────────────────────────

    override fun onPurchasesUpdated(billingResult: BillingResult, purchases: MutableList<Purchase>?) {
        when (billingResult.responseCode) {
            BillingClient.BillingResponseCode.OK -> {
                purchases?.forEach { purchase ->
                    if (purchase.purchaseState == Purchase.PurchaseState.PURCHASED) {
                        val productId = purchase.products.firstOrNull() ?: ""
                        onPurchaseResult(true, purchase.purchaseToken, productId, null)
                    }
                }
            }
            BillingClient.BillingResponseCode.USER_CANCELED -> {
                onPurchaseResult(false, null, null, "cancelled")
            }
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> {
                // A previously-purchased consumable wasn't consumed — consume it so it
                // grants again, and report success.
                purchases?.forEach { purchase ->
                    val productId = purchase.products.firstOrNull() ?: ""
                    onPurchaseResult(true, purchase.purchaseToken, productId, null)
                }
            }
            else -> {
                Log.e(TAG, "Purchase error: ${billingResult.responseCode} - ${billingResult.debugMessage}")
                onPurchaseResult(false, null, null, "failed")
            }
        }
    }

    // ─── Consume (consumables → consume also acknowledges) ─

    fun finishTransaction(purchaseToken: String, productId: String) {
        ensureConnected {
            val params = ConsumeParams.newBuilder()
                .setPurchaseToken(purchaseToken)
                .build()
            billingClient.consumeAsync(params) { result, _ ->
                Log.d(TAG, "Consume result for $productId: ${result.responseCode}")
            }
        }
    }

    fun destroy() {
        billingClient.endConnection()
    }
}
