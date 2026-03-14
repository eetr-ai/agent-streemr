import Foundation
import Observation

// MARK: - Errors

enum RecipeServiceError: LocalizedError {
    case notFound(id: String)
    case nameRequired
    case servingsOutOfRange(Int)
    case repositoryError(underlying: Error)

    var errorDescription: String? {
        switch self {
        case .notFound(let id):
            return "Recipe '\(id)' could not be found."
        case .nameRequired:
            return "A recipe must have a non-empty name before it can be saved."
        case .servingsOutOfRange(let n):
            return "Servings must be between 1 and 100 (got \(n))."
        case .repositoryError(let err):
            return err.localizedDescription
        }
    }
}

// MARK: - Service

/// Business-logic layer for recipe management.
///
/// `RecipeService` validates all inputs and enforces domain invariants before
/// delegating to the underlying `RecipeRepository`. Views and view models
/// receive it via the SwiftUI environment:
///
/// ```swift
/// @Environment(RecipeService.self) private var recipeService
/// ```
///
/// - Note: All methods are `@MainActor`-isolated because the repository is
///   required to be main-actor bound.
@Observable
@MainActor
final class RecipeService {

    private let repository: any RecipeRepository

    /// Incremented whenever recipes are created, saved, or deleted so views can refresh.
    private(set) var recipesModifiedVersion: Int = 0

    init(repository: any RecipeRepository) {
        self.repository = repository
    }

    // MARK: - Queries

    /// Returns all recipes, sorted newest-first.
    func allRecipes() throws -> [Recipe] {
        do { return try repository.allRecipes() }
        catch { throw RecipeServiceError.repositoryError(underlying: error) }
    }

    /// Returns the recipe with the given `id`, or `nil` if it does not exist.
    func recipe(id: String) throws -> Recipe? {
        do { return try repository.recipe(id: id) }
        catch { throw RecipeServiceError.repositoryError(underlying: error) }
    }

    // MARK: - Mutations

    /// Creates a new blank recipe in the repository and returns it.
    @discardableResult
    func create() throws -> Recipe {
        do {
            let recipe = try repository.create()
            recipesModifiedVersion += 1
            return recipe
        } catch {
            throw RecipeServiceError.repositoryError(underlying: error)
        }
    }

    /// Validates and persists changes to `recipe`.
    ///
    /// Business rules enforced:
    /// - `name` must not be blank.
    /// - `servings` must be in the range 1…100.
    /// - `ingredients` and `directions` are trimmed of surrounding whitespace.
    func save(_ recipe: Recipe) throws {
        let trimmedName = recipe.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else { throw RecipeServiceError.nameRequired }
        guard (1...100).contains(recipe.servings) else {
            throw RecipeServiceError.servingsOutOfRange(recipe.servings)
        }

        recipe.name = trimmedName
        recipe.ingredients = recipe.ingredients
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        recipe.directions = recipe.directions
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        do {
            try repository.save(recipe)
            recipesModifiedVersion += 1
        } catch {
            throw RecipeServiceError.repositoryError(underlying: error)
        }
    }

    /// Deletes the recipe with the given `id`.
    ///
    /// - Throws: `RecipeServiceError.notFound` when no recipe with that id exists.
    func delete(id: String) throws {
        guard let _ = try? repository.recipe(id: id) else {
            throw RecipeServiceError.notFound(id: id)
        }
        do {
            try repository.delete(id: id)
            recipesModifiedVersion += 1
        } catch {
            throw RecipeServiceError.repositoryError(underlying: error)
        }
    }
}
