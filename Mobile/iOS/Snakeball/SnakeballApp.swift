import SwiftUI
import GoogleMobileAds

// Test-device hashes printed by the AdMob SDK in the Xcode console. Only honored
// in Debug / TestFlight builds so App Store installs always count as real users.
private let testDeviceIdentifiers: [String] = [
    // "PASTE_HASH_FROM_XCODE_CONSOLE_HERE",
]

private var isInternalBuild: Bool {
    #if DEBUG
    return true
    #else
    return Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt"
    #endif
}

@main
struct SnakeballApp: App {
    init() {
        if isInternalBuild && !testDeviceIdentifiers.isEmpty {
            MobileAds.shared.requestConfiguration.testDeviceIdentifiers = testDeviceIdentifiers
        }
        MobileAds.shared.start(completionHandler: nil)
    }

    var body: some Scene {
        WindowGroup { ContentView() }
    }
}
