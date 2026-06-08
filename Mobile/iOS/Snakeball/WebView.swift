import SwiftUI
import WebKit
import StoreKit
import GoogleMobileAds

/// WKUserContentController.add() retains the handler strongly, creating a retain
/// cycle. This weak wrapper avoids a crash when the web content process dies.
class WeakScriptMessageDelegate: NSObject, WKScriptMessageHandler {
    weak var delegate: WKScriptMessageHandler?
    init(delegate: WKScriptMessageHandler) { self.delegate = delegate }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        delegate?.userContentController(controller, didReceive: message)
    }
}

/// Hosts the Snakeball web game (loaded from the production hosting URL) and
/// bridges it to native haptics, AdMob (rewarded + interstitial), StoreKit IAP,
/// and a vendor device id. Mirrors the bridge contract documented in CLAUDE.md.
struct WebView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let ucc = WKUserContentController()

        let weakDelegate = WeakScriptMessageDelegate(delegate: context.coordinator)
        ucc.add(weakDelegate, name: "hapticHandler")
        ucc.add(weakDelegate, name: "adHandler")
        ucc.add(weakDelegate, name: "authHandler")
        ucc.add(weakDelegate, name: "iapHandler")

        config.userContentController = ucc
        config.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.04, green: 0.04, blue: 0.10, alpha: 1)
        webView.scrollView.backgroundColor = UIColor(red: 0.04, green: 0.04, blue: 0.10, alpha: 1)

        // Game feel: no bounce, no scrolling, no swipe-back.
        webView.scrollView.bounces = false
        webView.scrollView.isScrollEnabled = false
        webView.allowsBackForwardNavigationGestures = false

        context.coordinator.webView = webView

        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        webView.load(request)

        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        // Loaded once in makeUIView; don't reload on SwiftUI re-render.
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    /// Break the message-handler retain cycle on teardown.
    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        let c = uiView.configuration.userContentController
        c.removeScriptMessageHandler(forName: "hapticHandler")
        c.removeScriptMessageHandler(forName: "adHandler")
        c.removeScriptMessageHandler(forName: "authHandler")
        c.removeScriptMessageHandler(forName: "iapHandler")
        coordinator.webView = nil
    }

    class Coordinator: NSObject, WKScriptMessageHandler, WKUIDelegate {
        var parent: WebView
        weak var webView: WKWebView?
        private var rewardedAdManager: RewardedAdManager?
        private var interstitialAdManager: InterstitialAdManager?

        init(_ parent: WebView) {
            self.parent = parent
            super.init()
            self.rewardedAdManager = RewardedAdManager(coordinator: self)
            self.interstitialAdManager = InterstitialAdManager()
        }

        private func safeEvaluateJavaScript(_ js: String) {
            webView?.evaluateJavaScript(js, completionHandler: nil)
        }

        func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any],
                  let action = body["action"] as? String else { return }
            switch message.name {
            case "hapticHandler": handleHaptic(body: body)
            case "adHandler": handleAd(action: action, body: body)
            case "authHandler": handleAuth(action: action)
            case "iapHandler": handleIAP(action: action, body: body)
            default: break
            }
        }

        // MARK: - WKUIDelegate (the game uses custom modals; these are safety nets)

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            completionHandler()
        }
        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            completionHandler(true)
        }

        // MARK: - Haptics

        private func handleHaptic(body: [String: Any]) {
            let type = body["type"] as? String ?? "medium"
            switch type {
            case "light":   UIImpactFeedbackGenerator(style: .light).impactOccurred()
            case "medium":  UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            case "heavy":   UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
            case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
            case "error":   UINotificationFeedbackGenerator().notificationOccurred(.error)
            default:        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            }
        }

        // MARK: - Ads

        private func handleAd(action: String, body: [String: Any]) {
            DispatchQueue.main.async {
                guard let rootVC = self.getRootViewController() else {
                    if action == "showRewardedAd" { self.triggerRewardCallback(success: false) }
                    else { self.triggerInterstitialClosed() }
                    return
                }
                switch action {
                case "showRewardedAd":
                    let customData = (body["customData"] as? String) ?? "reward"
                    self.rewardedAdManager?.showAd(from: rootVC, customData: customData)
                case "showInterstitial":
                    self.interstitialAdManager?.showAd(from: rootVC) { [weak self] in
                        self?.triggerInterstitialClosed()
                    }
                default:
                    break
                }
            }
        }

        private func getRootViewController() -> UIViewController? {
            let scenes = UIApplication.shared.connectedScenes
            let ws = scenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene
                ?? scenes.first as? UIWindowScene
            guard let window = ws?.windows.first(where: { $0.isKeyWindow }) ?? ws?.windows.first,
                  let root = window.rootViewController else { return nil }
            var top = root
            while let presented = top.presentedViewController { top = presented }
            return top
        }

        func triggerRewardCallback(success: Bool, type: String = "reward", amount: Int = 1) {
            let js = success
                ? "window.__bridgeCallbacks('adReward', { success: true, type: '\(type)', amount: \(amount) });"
                : "window.__bridgeCallbacks('adReward', { success: false });"
            DispatchQueue.main.async { self.safeEvaluateJavaScript(js) }
        }

        func triggerInterstitialClosed() {
            DispatchQueue.main.async {
                self.safeEvaluateJavaScript("window.__bridgeCallbacks('interstitialClosed', {});")
            }
        }

        // MARK: - Auth (vendor device id — used for future cloud sync)

        private func handleAuth(action: String) {
            guard action == "getDeviceId" else { return }
            let deviceId = UIDevice.current.identifierForVendor?.uuidString ?? "unknown_ios_device"
            let safeId = deviceId.replacingOccurrences(of: "'", with: "\\'")
            DispatchQueue.main.async {
                self.safeEvaluateJavaScript("window.__bridgeCallbacks('deviceId', { id: '\(safeId)' });")
            }
        }

        // MARK: - IAP

        private func handleIAP(action: String, body: [String: Any]) {
            Task { @MainActor in
                switch action {
                case "purchase":
                    await handlePurchase(productId: body["productId"] as? String ?? "")
                case "restorePurchases":
                    await handleRestore()
                default:
                    break
                }
            }
        }

        @MainActor
        private func handlePurchase(productId: String) async {
            do {
                let product = try await StoreKitManager.shared.product(for: productId)
                if let transaction = try await StoreKitManager.shared.purchaseAndFinish(product) {
                    triggerIAP(name: "iapPurchase", data: """
                        { "success": true, "transactionId": "\(transaction.id)", "productId": "\(transaction.productID)" }
                    """)
                } else {
                    triggerIAP(name: "iapPurchase", data: #"{ "success": false, "error": "cancelled", "productId": "\#(productId)" }"#)
                }
            } catch {
                triggerIAP(name: "iapPurchase", data: #"{ "success": false, "error": "failed", "productId": "\#(productId)" }"#)
            }
        }

        @MainActor
        private func handleRestore() async {
            let restored = await StoreKitManager.shared.restoreNonConsumables()
            let ids = restored.map { "\"\($0)\"" }.joined(separator: ", ")
            triggerIAP(name: "iapRestore", data: "{ \"success\": true, \"productIds\": [\(ids)] }")
        }

        private func triggerIAP(name: String, data: String) {
            DispatchQueue.main.async {
                self.safeEvaluateJavaScript("window.__bridgeCallbacks('\(name)', \(data));")
            }
        }
    }
}

// MARK: - Rewarded Ads

@MainActor
class RewardedAdManager: NSObject, FullScreenContentDelegate {
    private var rewardedAd: RewardedAd?
    private weak var coordinator: WebView.Coordinator?
    private var hasEarnedReward = false
    private var callbackFired = false
    private var isLoading = false
    private var rewardType = "reward"

    // TODO: replace with your AdMob rewarded unit id. This is Google's TEST id.
    private let adUnitId = "ca-app-pub-3940256099942544/1712485313"

    init(coordinator: WebView.Coordinator) {
        self.coordinator = coordinator
        super.init()
        load()
    }

    func load() {
        if isLoading { return }
        isLoading = true
        RewardedAd.load(with: adUnitId, request: Request()) { [weak self] ad, error in
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                self.isLoading = false
                if let error = error {
                    print("Rewarded load failed: \(error.localizedDescription)")
                    return
                }
                self.rewardedAd = ad
                self.rewardedAd?.fullScreenContentDelegate = self
            }
        }
    }

    func showAd(from rootVC: UIViewController, customData: String) {
        guard let ad = rewardedAd else {
            coordinator?.triggerRewardCallback(success: false)
            load()
            return
        }
        hasEarnedReward = false
        callbackFired = false
        rewardType = customData
        ad.present(from: rootVC) { [weak self] in
            self?.hasEarnedReward = true
            // Fire on dismiss (below) so it only fires once.
        }
    }

    func ad(_ ad: FullScreenPresentingAd, didFailToPresentFullScreenContentWithError error: Error) {
        if !callbackFired { callbackFired = true; coordinator?.triggerRewardCallback(success: false) }
        rewardedAd = nil
        load()
    }

    func adDidDismissFullScreenContent(_ ad: FullScreenPresentingAd) {
        if !callbackFired {
            callbackFired = true
            coordinator?.triggerRewardCallback(success: hasEarnedReward, type: rewardType)
        }
        rewardedAd = nil
        load()
    }
}

// MARK: - Interstitial Ads (shown on game over; disabled by the Remove Ads IAP)

@MainActor
class InterstitialAdManager: NSObject, FullScreenContentDelegate {
    private var interstitial: InterstitialAd?
    private var isLoading = false
    private var onClose: (() -> Void)?

    // TODO: replace with your AdMob interstitial unit id. This is Google's TEST id.
    private let adUnitId = "ca-app-pub-3940256099942544/4411468910"

    override init() { super.init(); load() }

    func load() {
        if isLoading { return }
        isLoading = true
        InterstitialAd.load(with: adUnitId, request: Request()) { [weak self] ad, error in
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                self.isLoading = false
                if let error = error {
                    print("Interstitial load failed: \(error.localizedDescription)")
                    return
                }
                self.interstitial = ad
                self.interstitial?.fullScreenContentDelegate = self
            }
        }
    }

    func showAd(from rootVC: UIViewController, onClose: @escaping () -> Void) {
        guard let ad = interstitial else { onClose(); load(); return }
        self.onClose = onClose
        ad.present(from: rootVC)
    }

    func ad(_ ad: FullScreenPresentingAd, didFailToPresentFullScreenContentWithError error: Error) {
        onClose?(); onClose = nil; interstitial = nil; load()
    }

    func adDidDismissFullScreenContent(_ ad: FullScreenPresentingAd) {
        onClose?(); onClose = nil; interstitial = nil; load()
    }
}
