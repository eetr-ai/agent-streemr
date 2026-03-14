import Foundation
import Observation

@Observable
@MainActor
final class RecipeListViewModel {
    var recipes: [Recipe] = []
    var errorMessage: String?

    func load(using service: RecipeService) {
        do {
            recipes = try service.allRecipes()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func delete(id: String, using service: RecipeService) {
        do {
            try service.delete(id: id)
            recipes.removeAll { $0.id == id }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func dismissError() { errorMessage = nil }
}
