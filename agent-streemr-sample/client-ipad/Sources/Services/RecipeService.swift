import Foundation
import SwiftData

// MARK: - Model

@Model
final class Recipe {
    var id: String
    var name: String
    var recipeDescription: String
    var ingredients: [String]
    var directions: [String]
    var servings: Int
    var tags: [String]
    /// Base-64 encoded JPEG, nil when no photo has been set.
    var photoBase64: String?
    var createdAt: Date
    var updatedAt: Date

    init(
        id: String = UUID().uuidString,
        name: String = "",
        recipeDescription: String = "",
        ingredients: [String] = [],
        directions: [String] = [],
        servings: Int = 2,
        tags: [String] = [],
        photoBase64: String? = nil
    ) {
        self.id = id
        self.name = name
        self.recipeDescription = recipeDescription
        self.ingredients = ingredients
        self.directions = directions
        self.servings = servings
        self.tags = tags
        self.photoBase64 = photoBase64
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}

// MARK: - Service

/// Wraps SwiftData CRUD operations for `Recipe` objects.
/// All methods are `@MainActor` because they operate on a `ModelContext`
/// that must be used on the main thread.
@MainActor
final class RecipeService: ObservableObject {

    static let shared = RecipeService()

    private let container: ModelContainer

    init() {
        let schema = Schema([Recipe.self])
        let config = ModelConfiguration(schema: schema, isStoredInMemoryOnly: false)
        do {
            container = try ModelContainer(for: schema, configurations: [config])
        } catch {
            fatalError("Failed to create SwiftData container: \(error)")
        }
    }

    var context: ModelContext { container.mainContext }

    // MARK: - Queries

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

    // MARK: - Mutations

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
