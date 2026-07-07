import StoreKit

/// StoreKit 2 IAP for Snakeball. v1 is client-grant (no backend): a purchase is
/// verified locally, finished immediately, and the web layer grants the reward
/// on the success callback. SKUs must match the `STORE` catalog in index.html.
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

    /// Purchase, verify, and finish in one step (v1 client-grant model).
    /// Returns the verified transaction on success, nil on cancel/pending.
    func purchaseAndFinish(_ product: Product) async throws -> Transaction? {
        let result = try await product.purchase()
        switch result {
        case .success(let verification):
            let transaction = try checkVerified(verification)
            await transaction.finish()
            return transaction
        case .userCancelled, .pending:
            return nil
        @unknown default:
            return nil
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

    /// Finish any straggler transactions so consumables don't replay forever.
    private func listenForTransactions() -> Task<Void, Error> {
        Task.detached {
            for await result in Transaction.updates {
                if let t = try? self.checkVerified(result) {
                    await t.finish()
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
