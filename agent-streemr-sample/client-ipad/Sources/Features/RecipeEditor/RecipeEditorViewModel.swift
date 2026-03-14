import Foundation
import Observation

@Observable
@MainActor
final class RecipeEditorViewModel {
    var recipe: Recipe?
    var errorMessage: String?

    var title: String {
        guard let recipe, !recipe.name.isEmpty else { return "Recipe" }
        return recipe.name
    }

    var canSave: Bool { recipe != nil }

    func load(id: String, using service: RecipeService) {
        do {
            recipe = try service.recipe(id: id)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func save(using service: RecipeService) {
        guard let recipe else { return }
        do {
            try service.save(recipe)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func dismissError() { errorMessage = nil }
}
