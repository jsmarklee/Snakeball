package studio.hodgepodge.snakeball

import android.app.Activity
import android.content.Intent
import android.util.Log
import com.google.android.gms.games.GamesSignInClient
import com.google.android.gms.games.LeaderboardsClient
import com.google.android.gms.games.PlayGames
import com.google.android.gms.games.PlayGamesSdk
import com.google.android.gms.games.leaderboard.LeaderboardVariant

/**
 * PlayGamesManager — Google Play Games Services 리더보드 매니저.
 * iOS GameCenterManager 와 동일한 역할 (MinefieldSweeper에서 포팅).
 *
 * - 앱 시작 시 SDK 초기화(PlayGamesSdk.initialize)
 * - isAuthenticated() 로 silent 사인인, 실패 시 signIn() 인터랙티브
 * - 단일 글로벌 리더보드에 점수 제출
 * - 네이티브 리더보드 UI 표시
 *
 * 논리적 리더보드 ID는 res/values/strings.xml 의 leaderboard_global 에 매핑.
 * Play Console에서 생성한 실제 ID로 placeholder를 교체할 것.
 */
class PlayGamesManager(private val activity: Activity) {

    companion object {
        private const val TAG = "PlayGamesManager"
        const val RC_LEADERBOARD_UI = 9004
    }

    var isAuthenticated: Boolean = false
        private set

    private val leaderboardId: String by lazy {
        activity.getString(R.string.leaderboard_global)
    }

    fun initialize() {
        PlayGamesSdk.initialize(activity)
    }

    /**
     * Silent 사인인 시도. iOS Game Center authenticate()와 동일하게 최초 실행 시
     * 시스템 UI가 뜰 수 있으나 이후 실행은 조용히 처리된다.
     */
    fun authenticate(callback: (Boolean) -> Unit) {
        val client: GamesSignInClient = PlayGames.getGamesSignInClient(activity)
        client.isAuthenticated.addOnCompleteListener { task ->
            val authed = task.isSuccessful && task.result?.isAuthenticated == true
            if (authed) {
                isAuthenticated = true
                Log.d(TAG, "Already authenticated with Play Games")
                callback(true)
            } else {
                // 인터랙티브 사인인 트리거
                client.signIn().addOnCompleteListener { signInTask ->
                    val success = signInTask.isSuccessful &&
                        signInTask.result?.isAuthenticated == true
                    isAuthenticated = success
                    Log.d(TAG, "Play Games sign-in result: $success")
                    callback(success)
                }
            }
        }
    }

    /**
     * 글로벌 리더보드에 점수 제출. score > 0 (iOS 동작과 일치).
     */
    fun submitScore(score: Long, leaderboardId: String = this.leaderboardId, callback: (Boolean) -> Unit) {
        if (!isAuthenticated) {
            Log.w(TAG, "Cannot submit score — not authenticated")
            callback(false)
            return
        }
        if (score <= 0L) {
            Log.w(TAG, "Skipping score submission — score is 0")
            callback(false)
            return
        }
        try {
            val client: LeaderboardsClient = PlayGames.getLeaderboardsClient(activity)
            client.submitScoreImmediate(leaderboardId, score)
                .addOnCompleteListener { task ->
                    val ok = task.isSuccessful
                    Log.d(TAG, "Score $score submitted to $leaderboardId: $ok")
                    callback(ok)
                }
        } catch (e: Exception) {
            Log.e(TAG, "submitScore failed: ${e.message}")
            callback(false)
        }
    }

    /**
     * 네이티브 리더보드 UI 표시 (단일 글로벌 리더보드).
     */
    fun showLeaderboard(leaderboardId: String = this.leaderboardId) {
        if (!isAuthenticated) {
            Log.w(TAG, "Cannot show leaderboard — not authenticated")
            return
        }
        val client: LeaderboardsClient = PlayGames.getLeaderboardsClient(activity)
        client.getLeaderboardIntent(
            leaderboardId,
            LeaderboardVariant.TIME_SPAN_ALL_TIME,
            LeaderboardVariant.COLLECTION_PUBLIC
        ).addOnSuccessListener { intent: Intent ->
            activity.startActivityForResult(intent, RC_LEADERBOARD_UI)
        }.addOnFailureListener { e ->
            Log.e(TAG, "Failed to get leaderboard intent: ${e.message}")
        }
    }
}
