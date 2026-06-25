import GameKit

/// Game Center 인증 및 리더보드 관리 (MinefieldSweeper의 GameCenterManager 포팅)
/// - 앱 시작 시 자동 인증
/// - 게임 오버 시 스코어 제출
/// - 네이티브 리더보드 UI 표시
///
/// Snakeball은 단일 글로벌 리더보드만 사용한다.
@MainActor
class GameCenterManager {
    static let shared = GameCenterManager()

    /// 인증 완료 여부
    private(set) var isAuthenticated = false

    /// 글로벌 리더보드 ID.
    /// USER: App Store Connect에서 동일한 ID로 리더보드를 생성해야 함.
    static let globalLeaderboardID = "snakeball.leaderboard.global"

    private init() {}

    /// authenticateHandler가 이미 등록되었는지 여부.
    /// authenticateHandler는 foreground 복귀 시마다 재호출되는 "프로퍼티 세터"이므로
    /// 한 번만 등록하고 이후에는 상태만 갱신한다 (재호출을 one-shot으로 다루면 안 됨).
    private var handlerInstalled = false

    // MARK: - Authentication

    /// Game Center 인증 (앱 시작 시 호출)
    func authenticate() async -> Bool {
        // 이미 등록된 경우 현재 상태만 반환
        if handlerInstalled {
            return GKLocalPlayer.local.isAuthenticated
        }

        return await withCheckedContinuation { continuation in
            var resumed = false
            self.handlerInstalled = true

            GKLocalPlayer.local.authenticateHandler = { [weak self] viewController, error in
                Task { @MainActor in
                    guard let self = self else { return }

                    if let error = error {
                        print("🎮 GameCenter: Auth failed — \(error.localizedDescription)")
                        self.isAuthenticated = false
                        if !resumed { resumed = true; continuation.resume(returning: false) }
                        return
                    }

                    // 시스템이 로그인 VC를 넘겨주면 present (최초 실행 시)
                    if let vc = viewController {
                        if let rootVC = self.getRootViewController() {
                            rootVC.present(vc, animated: true)
                        }
                        self.isAuthenticated = false
                        if !resumed { resumed = true; continuation.resume(returning: false) }
                        return
                    }

                    let authenticated = GKLocalPlayer.local.isAuthenticated
                    self.isAuthenticated = authenticated
                    if authenticated {
                        print("🎮 GameCenter: Authenticated as \(GKLocalPlayer.local.displayName)")
                    } else {
                        print("🎮 GameCenter: Not authenticated")
                    }
                    if !resumed { resumed = true; continuation.resume(returning: authenticated) }
                }
            }
        }
    }

    // MARK: - Submit Score

    /// 스코어 제출 (글로벌 리더보드)
    func submit(score: Int, leaderboardID: String = GameCenterManager.globalLeaderboardID) async -> Bool {
        guard isAuthenticated else {
            print("🎮 GameCenter: Cannot submit score — not authenticated")
            return false
        }
        guard score > 0 else {
            print("🎮 GameCenter: Skipping score submission — score is 0")
            return false
        }

        do {
            try await GKLeaderboard.submitScore(
                score,
                context: 0,
                player: GKLocalPlayer.local,
                leaderboardIDs: [leaderboardID]
            )
            print("🎮 GameCenter: Score \(score) submitted to \(leaderboardID)")
            return true
        } catch {
            print("🎮 GameCenter: Score submission failed — \(error.localizedDescription)")
            return false
        }
    }

    // MARK: - Show Leaderboard

    /// 네이티브 Game Center 리더보드 UI 표시
    func presentLeaderboard(from rootVC: UIViewController? = nil,
                            leaderboardID: String = GameCenterManager.globalLeaderboardID) {
        guard isAuthenticated else {
            print("🎮 GameCenter: Cannot show leaderboard — not authenticated")
            return
        }
        let gcVC = GKGameCenterViewController(
            leaderboardID: leaderboardID,
            playerScope: .global,
            timeScope: .allTime
        )
        gcVC.gameCenterDelegate = GameCenterDismissHandler.shared

        guard let presenter = rootVC ?? getRootViewController() else {
            print("🎮 GameCenter: No root view controller to present leaderboard")
            return
        }
        presenter.present(gcVC, animated: true)
    }

    // MARK: - Helpers

    private func getRootViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes
        let windowScene = scenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene
            ?? scenes.first as? UIWindowScene
        guard let window = windowScene?.windows.first(where: { $0.isKeyWindow }) ?? windowScene?.windows.first,
              let rootVC = window.rootViewController else {
            return nil
        }
        var topVC = rootVC
        while let presentedVC = topVC.presentedViewController { topVC = presentedVC }
        return topVC
    }
}

/// GKGameCenterControllerDelegate — dismiss 처리용 싱글턴
class GameCenterDismissHandler: NSObject, GKGameCenterControllerDelegate {
    static let shared = GameCenterDismissHandler()
    func gameCenterViewControllerDidFinish(_ gameCenterViewController: GKGameCenterViewController) {
        gameCenterViewController.dismiss(animated: true)
    }
}
