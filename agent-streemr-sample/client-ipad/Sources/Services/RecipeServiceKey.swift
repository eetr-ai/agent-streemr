import SwiftUI

// MARK: - Environment Key

private struct RecipeServiceKey: EnvironmentKey {
    /// A safe default so views that read the key in previews never crash.
    /// It uses an in-memory SwiftData store so no real data is touched.
    static let defaultValue: RecipeService = MainActor.assumeIsolated {
        RecipeService(repository: SwiftDataRecipeRepository(inMemory: true))
    }
}

// MARK: - EnvironmentValues extension

extension EnvironmentValues {
    /// The application-wide `RecipeService`.
    ///
    /// Inject it at the root scene and read it in views or view models:
    /// ```swift
    /// // App entry point
    /// .environment(\.recipeService, RecipeService(repository: SwiftDataRecipeRepository()))
    ///
    /// // View
    /// @Environment(\.recipeService) private var recipeService
    /// ```
    var recipeService: RecipeService {
        get { self[RecipeServiceKey.self] }
        set { self[RecipeServiceKey.self] = newValue }
    }
}
