import SwiftUI
import UIKit
import WebKit
import StoreKit
import GoogleMobileAds
import SafariServices
import MessageUI

/// Debug + TestFlight (sandboxReceipt) serve Google TEST ad units; only real App
/// Store installs request live units → no self-click "invalid activity" risk during
/// QA, and never a dead live-ad request from a flagged build. (30 §5, 21 §9-5)
var isInternalAdBuild: Bool {
    #if DEBUG
    return true
    #else
    return Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt"
    #endif
}

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
        ucc.add(weakDelegate, name: "gameHandler")
        ucc.add(weakDelegate, name: "linkHandler")
        ucc.add(weakDelegate, name: "installHandler")

        config.userContentController = ucc
        config.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = context.coordinator
        webView.navigationDelegate = context.coordinator
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
        c.removeScriptMessageHandler(forName: "gameHandler")
        c.removeScriptMessageHandler(forName: "linkHandler")
        c.removeScriptMessageHandler(forName: "installHandler")
        coordinator.webView = nil
    }

    class Coordinator: NSObject, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate, MFMailComposeViewControllerDelegate {
        var parent: WebView
        weak var webView: WKWebView?
        private var retryOverlay: UIView?
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
            case "gameHandler": handleGame(action: action, body: body)
            case "linkHandler": handleLink(action: action, body: body)
            case "installHandler": handleIsInstalled(body: body)
            default: break
            }
        }

        // MARK: - Cross-promo install detection (canOpenURL)
        // 형제 게임이 설치돼 있는지 보고한다(크로스프로모 설치 보상). 질의하는 scheme은
        // Info.plist의 LSApplicationQueriesSchemes에 선언돼 있어야 canOpenURL이 동작한다
        // (없으면 항상 false). 결과는 callId로 키된 JS 콜백 레지스트리로 회신해 여러 게임
        // 동시 질의가 안 섞인다. callId는 JS에서 "installCheck:<n>"로 생성 — JS 문자열
        // 인터폴레이션 전에 영숫자 + ':'만 허용해 인젝션을 막는다.
        private func handleIsInstalled(body: [String: Any]) {
            let scheme = body["scheme"] as? String ?? ""
            let callId = body["callId"] as? String ?? ""
            guard !callId.isEmpty,
                  callId.allSatisfy({ $0.isLetter || $0.isNumber || $0 == ":" }) else { return }
            var s = scheme
            if !s.contains("://") { s += "://" }
            DispatchQueue.main.async { [weak self] in
                var installed = false
                if let url = URL(string: s) {
                    installed = UIApplication.shared.canOpenURL(url)
                }
                self?.safeEvaluateJavaScript("window.__bridgeCallbacks('\(callId)', { installed: \(installed) });")
            }
        }

        // MARK: - In-app links & email (About section)
        // Privacy/Terms open in an SFSafariViewController sheet; Support opens an
        // MFMailComposeViewController sheet — both stay inside the app, never the
        // system browser/Mail. (in-app-windows-no-external memory)

        private func handleLink(action: String, body: [String: Any]) {
            DispatchQueue.main.async {
                guard let rootVC = self.getRootViewController() else { return }
                switch action {
                case "openUrl":
                    guard let urlStr = body["url"] as? String, let url = URL(string: urlStr) else { return }
                    if url.scheme == "http" || url.scheme == "https" {
                        let safari = SFSafariViewController(url: url)
                        rootVC.present(safari, animated: true)
                    } else {
                        UIApplication.shared.open(url)
                    }
                case "composeEmail":
                    let to = body["to"] as? String ?? ""
                    if MFMailComposeViewController.canSendMail() {
                        let mail = MFMailComposeViewController()
                        mail.mailComposeDelegate = self
                        mail.setToRecipients([to])
                        mail.setSubject("Snakeball Support")
                        rootVC.present(mail, animated: true)
                    } else if let url = URL(string: "mailto:\(to)") {
                        UIApplication.shared.open(url)
                    }
                default:
                    break
                }
            }
        }

        func mailComposeController(_ controller: MFMailComposeViewController,
                                   didFinishWith result: MFMailComposeResult, error: Error?) {
            controller.dismiss(animated: true)
        }

        // MARK: - WKNavigationDelegate (offline retry overlay + content-process recovery)
        // A remote-URL WebView shows a black screen with no network — App Store
        // reviewers test in airplane mode → near-certain 2.1 rejection. (30 §1-5)

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            hideRetryOverlay()
        }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            showRetryOverlay()
        }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            showRetryOverlay()
        }
        // Content process killed by the OS (memory pressure / long background) →
        // reload to recover rather than leaving a blank view. (30 §1-2)
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            var request = URLRequest(url: parent.url)
            request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
            webView.load(request)
        }

        @objc private func retryTapped() {
            guard let webView = webView else { return }
            hideRetryOverlay()
            var request = URLRequest(url: parent.url)
            request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
            webView.load(request)
        }

        private func showRetryOverlay() {
            guard let webView = webView, retryOverlay == nil else { return }
            let overlay = UIView(frame: webView.bounds)
            overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            overlay.backgroundColor = UIColor(red: 0.04, green: 0.04, blue: 0.10, alpha: 1)

            let label = UILabel()
            label.text = "연결할 수 없어요"
            label.textColor = .white
            label.font = .boldSystemFont(ofSize: 20)
            label.textAlignment = .center
            label.translatesAutoresizingMaskIntoConstraints = false

            var config = UIButton.Configuration.filled()
            config.title = "다시 시도"
            config.baseBackgroundColor = UIColor(red: 0.39, green: 0.97, blue: 0.81, alpha: 1)
            config.baseForegroundColor = UIColor(red: 0.04, green: 0.04, blue: 0.10, alpha: 1)
            config.background.cornerRadius = 12
            config.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 28, bottom: 12, trailing: 28)
            config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attrs in
                var attrs = attrs
                attrs.font = .boldSystemFont(ofSize: 18)
                return attrs
            }
            let button = UIButton(configuration: config)
            button.translatesAutoresizingMaskIntoConstraints = false
            button.addTarget(self, action: #selector(retryTapped), for: .touchUpInside)

            overlay.addSubview(label)
            overlay.addSubview(button)
            NSLayoutConstraint.activate([
                label.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
                label.centerYAnchor.constraint(equalTo: overlay.centerYAnchor, constant: -30),
                button.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
                button.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 20),
            ])
            webView.addSubview(overlay)
            retryOverlay = overlay
        }

        private func hideRetryOverlay() {
            retryOverlay?.removeFromSuperview()
            retryOverlay = nil
        }

        // MARK: - WKUIDelegate (the game uses custom modals; these are safety nets)

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            completionHandler()
        }
        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            guard let rootVC = getRootViewController() else { completionHandler(true); return }
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "취소", style: .cancel) { _ in completionHandler(false) })
            alert.addAction(UIAlertAction(title: "확인", style: .default) { _ in completionHandler(true) })
            rootVC.present(alert, animated: true)
        }

        // WKWebView ignores window.prompt unless this is implemented — the nickname
        // and recovery-code flows use prompt and would silently no-op without it. (30 §1-8)
        func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
            guard let rootVC = getRootViewController() else { completionHandler(defaultText); return }
            let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
            alert.addTextField { tf in tf.text = defaultText }
            alert.addAction(UIAlertAction(title: "취소", style: .cancel) { _ in completionHandler(nil) })
            alert.addAction(UIAlertAction(title: "확인", style: .default) { _ in
                completionHandler(alert.textFields?.first?.text)
            })
            rootVC.present(alert, animated: true)
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

        // MARK: - Game Center (leaderboards)

        private func handleGame(action: String, body: [String: Any]) {
            Task { @MainActor in
                switch action {
                case "authenticate":
                    _ = await GameCenterManager.shared.authenticate()
                case "submitScore":
                    // score may arrive as Int or Double from JS.
                    let score: Int = {
                        if let i = body["score"] as? Int { return i }
                        if let d = body["score"] as? Double { return Int(d) }
                        if let s = body["score"] as? String { return Int(s) ?? 0 }
                        return 0
                    }()
                    _ = await GameCenterManager.shared.submit(score: score)
                case "showLeaderboard":
                    if let rootVC = self.getRootViewController() {
                        GameCenterManager.shared.presentLeaderboard(from: rootVC)
                    } else {
                        GameCenterManager.shared.presentLeaderboard()
                    }
                default:
                    break
                }
            }
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

    private let testAdUnitId = "ca-app-pub-3940256099942544/1712485313" // Google test rewarded
    // TODO: replace with your real AdMob rewarded unit id before App Store release.
    private let realAdUnitId = "ca-app-pub-3940256099942544/1712485313"
    private var adUnitId: String { isInternalAdBuild ? testAdUnitId : realAdUnitId }

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

    private let testAdUnitId = "ca-app-pub-3940256099942544/4411468910" // Google test interstitial
    // TODO: replace with your real AdMob interstitial unit id before App Store release.
    private let realAdUnitId = "ca-app-pub-3940256099942544/4411468910"
    private var adUnitId: String { isInternalAdBuild ? testAdUnitId : realAdUnitId }

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
