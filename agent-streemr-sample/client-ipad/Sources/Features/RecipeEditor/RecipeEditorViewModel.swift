import Foundation
import Observation

@Observable
@MainActor
final class RecipeEditorViewModel {
    var recipe: Recipe?
    var errorMessage: String?
    private(set) var isNewRecipe = false

    var title: String {
        guard let recipe, !recipe.name.isEmpty else { return "Recipe" }
        return recipe.name
    }

    var canSave: Bool { recipe != nil }
    var hasOpenRecipe: Bool { recipe != nil }
    var currentRecipeId: String? { recipe?.id }

    @discardableResult
    func startNewRecipe(name: String? = nil, tags: [String] = [], servings: Int? = nil) -> Recipe {
        let recipe = Recipe()
        if let name, !name.isEmpty {
            recipe.name = name
        }
        recipe.tags = tags
        if let servings {
            recipe.servings = servings
        }
        self.recipe = recipe
        isNewRecipe = true
        errorMessage = nil
        return recipe
    }

    @discardableResult
    func load(id: String, using service: RecipeService) throws -> Recipe {
        do {
            guard let recipe = try service.recipe(id: id) else {
                throw RecipeServiceError.notFound(id: id)
            }
            self.recipe = recipe
            isNewRecipe = false
            errorMessage = nil
            return recipe
        } catch {
            errorMessage = error.localizedDescription
            throw error
        }
    }

    func syncSelection(id: String?, using service: RecipeService) {
        guard let id else {
            if !isNewRecipe {
                close()
            }
            return
        }
        _ = try? load(id: id, using: service)
    }

    @discardableResult
    func recipeForEditing(id: String?, using service: RecipeService) throws -> Recipe {
        if let id {
            if let recipe, recipe.id == id {
                return recipe
            }
            return try load(id: id, using: service)
        }
        guard let recipe else {
            let error = RecipeServiceError.notFound(id: "current")
            errorMessage = error.localizedDescription
            throw error
        }
        return recipe
    }

    @discardableResult
    func save(using service: RecipeService) throws -> Recipe {
        guard let recipe else {
            throw RecipeServiceError.notFound(id: "current")
        }
        do {
            if isNewRecipe {
                let persisted = try service.create()
                copyEditableFields(from: recipe, to: persisted)
                persisted.id = recipe.id
                try service.save(persisted)
                self.recipe = persisted
                isNewRecipe = false
                return persisted
            }

            try service.save(recipe)
            return recipe
        } catch {
            errorMessage = error.localizedDescription
            throw error
        }
    }

    func close() {
        recipe = nil
        isNewRecipe = false
        errorMessage = nil
    }

    private func copyEditableFields(from source: Recipe, to target: Recipe) {
        target.name = source.name
        target.recipeDescription = source.recipeDescription
        target.ingredients = source.ingredients
        target.directions = source.directions
        target.servings = source.servings
        target.tags = source.tags
        target.photoAssetIdentifier = source.photoAssetIdentifier
    }

    func dismissError() { errorMessage = nil }
}
