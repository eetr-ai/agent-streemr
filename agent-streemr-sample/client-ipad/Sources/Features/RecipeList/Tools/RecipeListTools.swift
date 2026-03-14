import Foundation
import AgentStreemrSwift

/// Registers read-only recipe tool handlers on the given stream.
///
/// - `recipe_list` — returns a summary of every recipe.
/// - `recipe_get_state` — returns the full state of a single recipe by id.
/// - `recipe_load` — selects a recipe in the UI by id (agent can surface a recipe in the viewer).
@MainActor
func registerRecipeListTools(
    on stream: AgentStream,
    recipeService: RecipeService,
    selectedRecipeState: SelectedRecipeState,
    recipeEditorViewModel: RecipeEditorViewModel,
    toolCallLog: ToolCallLogViewModel
) async {

    // MARK: recipe_list

    await stream.registerTool("recipe_list", handler: toolCallLog.wrap("recipe_list") { [recipeService] _ in
        let summaries: [[String: Any]] = await MainActor.run {
            let recipes = (try? recipeService.allRecipes()) ?? []
            return recipes.map { r in
                ["id": r.id, "name": r.name, "tags": r.tags, "servings": r.servings]
            }
        }
        return .success(responseJSON: ["recipes": summaries])
    })

    // MARK: recipe_get_state

    await stream.registerTool("recipe_get_state", handler: toolCallLog.wrap("recipe_get_state") { [recipeService, recipeEditorViewModel] args in
        let requestedId = args["id"] as? String
        let result: LocalToolHandlerResult = await MainActor.run {
            let recipe: Recipe?
            if let requestedId, let current = recipeEditorViewModel.recipe, current.id == requestedId {
                recipe = current
            } else if requestedId == nil {
                recipe = recipeEditorViewModel.recipe
            } else {
                recipe = try? recipeService.recipe(id: requestedId ?? "")
            }

            guard let recipe else {
                if let requestedId {
                    return .success(responseJSON: ["error": "Recipe not found: \(requestedId)"])
                }
                return .success(responseJSON: ["error": "No recipe is currently open"])
            }
            var dict: [String: Any] = [
                "id": recipe.id,
                "name": recipe.name,
                "description": recipe.recipeDescription,
                "ingredients": recipe.ingredients,
                "directions": recipe.directions,
                "servings": recipe.servings,
                "tags": recipe.tags,
                "isNew": recipeEditorViewModel.isNewRecipe && recipeEditorViewModel.currentRecipeId == recipe.id
            ]
            if let photoAssetIdentifier = recipe.photoAssetIdentifier {
                dict["photoAssetIdentifier"] = photoAssetIdentifier
            }
            return .success(responseJSON: ["recipe": dict])
        }
        return result
    })

    // MARK: recipe_load

    await stream.registerTool("recipe_load", handler: toolCallLog.wrap("recipe_load") { [recipeService, selectedRecipeState, recipeEditorViewModel] args in
        guard let id = args["id"] as? String else {
            return .error(message: "Missing 'id'")
        }
        return await MainActor.run {
            if (try? recipeEditorViewModel.load(id: id, using: recipeService)) != nil {
                selectedRecipeState.selectedRecipeId = id
                return .success(responseJSON: ["id": id, "ok": true])
            }
            return .success(responseJSON: ["ok": false, "error": "Recipe not found: \(id)"])
        }
    })
}
