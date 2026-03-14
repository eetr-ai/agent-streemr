import Foundation
import AgentStreemrSwift

/// Registers read-only recipe tool handlers on the given stream.
///
/// - `recipe_list` — returns a summary of every recipe.
/// - `recipe_get_state` — returns the full state of a single recipe by id.
@MainActor
func registerRecipeListTools(on stream: AgentStream, recipeService: RecipeService) async {

    // MARK: recipe_list

    await stream.registerTool("recipe_list") { [recipeService] _ in
        let summaries: [[String: Any]] = await MainActor.run {
            let recipes = (try? recipeService.allRecipes()) ?? []
            return recipes.map { r in
                ["id": r.id, "name": r.name, "tags": r.tags, "servings": r.servings]
            }
        }
        return .success(responseJSON: ["recipes": summaries])
    }

    // MARK: recipe_get_state

    await stream.registerTool("recipe_get_state") { [recipeService] args in
        guard let id = args["id"] as? String else {
            return .error(message: "Missing 'id'")
        }
        let result: LocalToolHandlerResult = await MainActor.run {
            guard let recipe = try? recipeService.recipe(id: id) else {
                return .success(responseJSON: ["error": "Recipe not found: \(id)"])
            }
            var dict: [String: Any] = [
                "id": recipe.id,
                "name": recipe.name,
                "description": recipe.recipeDescription,
                "ingredients": recipe.ingredients,
                "directions": recipe.directions,
                "servings": recipe.servings,
                "tags": recipe.tags
            ]
            if let photo = recipe.photoBase64 { dict["photoBase64"] = photo }
            return .success(responseJSON: ["recipe": dict])
        }
        return result
    }
}
