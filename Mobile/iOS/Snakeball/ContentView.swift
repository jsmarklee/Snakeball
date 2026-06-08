import SwiftUI

struct ContentView: View {
    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            // Loads the production web build. Deploy with `npm run deploy:web`,
            // then game updates ship without an App Store review.
            WebView(url: URL(string: "https://snakeball-game.web.app?v=1")!)
                .ignoresSafeArea()
        }
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
    }
}

#Preview { ContentView() }
