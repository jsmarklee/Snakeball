import SwiftUI

/// 운영 URL. Release 빌드는 항상 여기만 연다.
private let productionGameURL = URL(string: "https://snakeball-game.web.app?v=1")!

/// Debug 빌드 전용 — 배포 전 게임을 실기기에서 해 보기 위한 개발 서버 주소.
/// `devicectl device process launch ... -SB_DEV_URL http://<맥 IP>:8800/` 처럼 한 번 실행하면
/// 저장되어 아이콘으로 다시 열어도 그 주소를 쓴다. `-SB_DEV_URL ""` 로 실행하면 운영 URL 로 복귀.
/// Release 에는 컴파일되지 않는다(#if DEBUG).
private var gameURL: URL {
    #if DEBUG
    let key = "SB_DEV_URL_SAVED"
    if let arg = UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)["SB_DEV_URL"] as? String {
        UserDefaults.standard.set(arg, forKey: key)
    }
    if let saved = UserDefaults.standard.string(forKey: key), !saved.isEmpty, let url = URL(string: saved) {
        return url
    }
    #endif
    return productionGameURL
}

struct ContentView: View {
    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            // Loads the production web build. Deploy with `npm run deploy:web`,
            // then game updates ship without an App Store review.
            WebView(url: gameURL)
                .ignoresSafeArea()
        }
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
    }
}

#Preview { ContentView() }
