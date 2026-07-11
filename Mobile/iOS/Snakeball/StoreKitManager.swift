import StoreKit

/// StoreKit 2 IAP for Snakeball. A purchase is verified locally, then held
/// UNFINISHED until the web layer confirms the server granted the reward
/// (`finishTransaction(id:)`). Finishing before the grant would let a failed
/// server verify (cold-start/network/kill) take the money without delivering:
/// a finished consumable is never redelivered. SKUs must match `STORE` in
/// index.html.
@MainActor
class StoreKitManager: ObservableObject {
    static let shared = StoreKitManager()

    /// Must match index.html STORE ids.
    private let productIds: Set<String> = [
        "coins_small", "coins_big",
        "gems_small", "gems_big",
        "remove_ads", "starter_pack",
    ]
    /// Non-consumables that must be restorable (App Store requirement).
    private let nonConsumables: Set<String> = ["remove_ads", "starter_pack"]

    @Published private(set) var products: [Product] = []
    private var listener: Task<Void, Error>?

    /// Verified transactions not yet finished — held until the web layer confirms
    /// the server grant. Keyed by transactionId.
    private var pendingTransactions: [String: Transaction] = [:]

    /// Invoked for transactions delivered OUT OF BAND (Ask-to-Buy approvals,
    /// interrupted purchases replayed at launch) so the web layer can verify +
    /// grant + finish them. Args: (transactionId, productId). Set by WebView.
    var onDeferredTransaction: ((String, String) -> Void)?

    private init() { listener = listenForTransactions() }
    deinit { listener?.cancel() }

    func loadProducts() async throws -> [Product] {
        let loaded = try await Product.products(for: productIds).sorted { $0.id < $1.id }
        products = loaded
        return loaded
    }

    /// Resolve a product from cache, loading on demand.
    func product(for id: String) async throws -> Product {
        if let p = products.first(where: { $0.id == id }) { return p }
        let loaded = try await loadProducts()
        guard let p = loaded.first(where: { $0.id == id }) else {
            throw StoreKitError.productNotFound(id)
        }
        return p
    }

    /// Purchase + verify locally, but do NOT finish — hold the transaction until
    /// `finishTransaction(id:)` is called after the server grant succeeds.
    /// Returns the verified transaction on success, nil on cancel/pending.
    func purchase(_ product: Product) async throws -> Transaction? {
        let result = try await product.purchase()
        switch result {
        case .success(let verification):
            let transaction = try checkVerified(verification)
            pendingTransactions[String(transaction.id)] = transaction
            return transaction
        case .userCancelled, .pending:
            return nil
        @unknown default:
            return nil
        }
    }

    /// Finish a held transaction once the web layer confirms the server granted
    /// its reward. Until this is called the transaction stays unfinished, so
    /// StoreKit redelivers it (via Transaction.updates) on the next launch and
    /// the grant is retried — money is never taken without delivery.
    func finishTransaction(id: String) async {
        if let t = pendingTransactions[id] {
            await t.finish()
            pendingTransactions[id] = nil
        }
    }

    /// Restore: sync, then return the product ids of currently-entitled
    /// non-consumables so the web layer can re-grant them.
    /// NOTE: Currently dormant — every live SKU is a consumable (coins/gems);
    /// `nonConsumables` lists only retired SKUs that were never sold, so this
    /// returns [] in practice. Cross-device recovery of consumables goes through
    /// the web layer's recovery code instead. Kept so it activates if a
    /// non-consumable SKU is ever (re)added.
    func restoreNonConsumables() async -> [String] {
        try? await AppStore.sync()
        var owned: [String] = []
        for await result in Transaction.currentEntitlements {
            if let t = try? checkVerified(result), nonConsumables.contains(t.productID) {
                owned.append(t.productID)
            }
        }
        return owned
    }

    /// Out-of-band transactions: Ask-to-Buy approvals and interrupted purchases
    /// replayed at launch. Hold them as pending and hand them to the web layer to
    /// verify + grant + finish — NEVER finish blindly (that dropped Ask-to-Buy
    /// grants: the buyer paid and got nothing).
    private func listenForTransactions() -> Task<Void, Error> {
        Task.detached {
            for await result in Transaction.updates {
                if let t = try? self.checkVerified(result) {
                    await MainActor.run {
                        self.pendingTransactions[String(t.id)] = t
                        self.onDeferredTransaction?(String(t.id), t.productID)
                    }
                }
            }
        }
    }

    nonisolated private func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified(_, let error): throw StoreKitError.failedVerification(error)
        case .verified(let safe): return safe
        }
    }
}

enum StoreKitError: LocalizedError {
    case failedVerification(Error)
    case productNotFound(String)
    var errorDescription: String? {
        switch self {
        case .failedVerification(let e): return "Verification failed: \(e.localizedDescription)"
        case .productNotFound(let id): return "Product not found: \(id)"
        }
    }
}
