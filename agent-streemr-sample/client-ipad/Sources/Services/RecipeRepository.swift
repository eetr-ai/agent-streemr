import Foundation
import SwiftData

// MARK: - Protocol

/// Defines the raw data-access contract for recipe storage.
///
/// Implementations are responsible only for persistence mechanics — no
/// business-rule validation is performed here. `RecipeService` sits on
/// top of this protocol and applies all domain logic before delegating
/// to the repository.
///
/// Conforming to this protocol allows unit tests to supply an in-memory
/// implementation without touching the real SwiftData store.
@MainActor
protocol RecipeRepository {
    /// Returns all persisted recipes, newest first.
    func allRecipes() throws -> [Recipe]

    /// Returns the recipe with the given `id`, or `nil` if it does not exist.
    func recipe(id: String) throws -> Recipe?

    /// Creates and persists a fresh recipe with all fields at their defaults.
    /// - Returns: The newly-created recipe.
    @discardableResult
    func create() throws -> Recipe

    /// Persists any changes made to `recipe`.
    func save(_ recipe: Recipe) throws

    /// Deletes the recipe with the given `id`. A no-op if the id is unknown.
    func delete(id: String) throws
}

// MARK: - SwiftData Implementation

/// Production `RecipeRepository` backed by SwiftData.
@MainActor
final class SwiftDataRecipeRepository: RecipeRepository {

    private let container: ModelContainer

    /// - Parameter inMemory: Pass `true` to create a transient store (useful for
    ///   previews or when `SwiftDataRecipeRepository` is used in tests directly).
    init(inMemory: Bool = false) {
        let schema = Schema([Recipe.self])
        let config = ModelConfiguration(schema: schema, isStoredInMemoryOnly: inMemory)
        do {
            container = try ModelContainer(for: schema, configurations: [config])
        } catch {
            fatalError("SwiftDataRecipeRepository: failed to create container — \(error)")
        }
    }

    private var context: ModelContext { container.mainContext }

    // MARK: RecipeRepository

    func allRecipes() throws -> [Recipe] {
        let descriptor = FetchDescriptor<Recipe>(
            sortBy: [SortDescriptor(\.updatedAt, order: .reverse)]
        )
        return try context.fetch(descriptor)
    }

    func recipe(id: String) throws -> Recipe? {
        var descriptor = FetchDescriptor<Recipe>(
            predicate: #Predicate { $0.id == id }
        )
        descriptor.fetchLimit = 1
        return try context.fetch(descriptor).first
    }

    @discardableResult
    func create() throws -> Recipe {
        let recipe = Recipe()
        context.insert(recipe)
        try context.save()
        return recipe
    }

    func save(_ recipe: Recipe) throws {
        recipe.updatedAt = Date()
        try context.save()
    }

    func delete(id: String) throws {
        guard let recipe = try recipe(id: id) else { return }
        context.delete(recipe)
        try context.save()
    }
}
