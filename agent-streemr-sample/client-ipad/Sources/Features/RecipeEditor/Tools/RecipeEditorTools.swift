import Foundation
import AgentStreemrSwift

/// Registers all recipe-mutation local tool handlers on the stream.
///
/// Tools mirror the web client's recipe_* local-tool contract so the same
/// agent prompt works with both clients.
@MainActor
func registerRecipeEditorTools(
    on stream: AgentStream,
    recipeService: RecipeService,
    photoStaging: PhotoStagingService,
    selectedRecipeState: SelectedRecipeState,
    recipeEditorViewModel: RecipeEditorViewModel,
    toolCallLog: ToolCallLogViewModel
) async {
    func currentRecipeResponse(_ recipe: Recipe, isNew: Bool) -> LocalToolHandlerResult {
        .success(responseJSON: [
            "id": recipe.id,
            "name": recipe.name,
            "ok": true,
            "isNew": isNew
        ])
    }

    func register(_ toolName: String, handler: @escaping LocalToolHandler) async {
        await stream.registerTool(toolName, handler: toolCallLog.wrap(toolName, handler))
    }

    // MARK: recipe_create / create_recipe

    let createHandler: LocalToolHandler = { [selectedRecipeState, recipeEditorViewModel] args in
        await MainActor.run {
            let name = args["name"] as? String
            let tags = args["tags"] as? [String] ?? []
            let servings = parseServings(args["servings"] as Any)
            let recipe = recipeEditorViewModel.startNewRecipe(name: name, tags: tags, servings: servings)
            selectedRecipeState.selectedRecipeId = nil
            return currentRecipeResponse(recipe, isNew: true)
        }
    }
    await register("recipe_create", handler: createHandler)
    await register("create_recipe", handler: createHandler)

    // MARK: recipe_set_title

    await register("recipe_set_title") { [recipeService, recipeEditorViewModel] args in
        guard let name = args["name"] as? String else {
            return .error(message: "Missing 'name'")
        }
        let id = args["id"] as? String
        let result: LocalToolHandlerResult = await MainActor.run {
            guard let recipe = try? recipeEditorViewModel.recipeForEditing(id: id, using: recipeService) else {
                return .success(responseJSON: ["ok": false, "error": "Recipe not found"])
            }
            recipe.name = name
            return currentRecipeResponse(recipe, isNew: recipeEditorViewModel.isNewRecipe)
        }
        return result
    }

    // MARK: recipe_set_description

    await register("recipe_set_description") { [recipeService, recipeEditorViewModel] args in
        guard let description = args["description"] as? String else {
            return .error(message: "Missing 'description'")
        }
        let id = args["id"] as? String
        let result: LocalToolHandlerResult = await MainActor.run {
            guard let recipe = try? recipeEditorViewModel.recipeForEditing(id: id, using: recipeService) else {
                return .success(responseJSON: ["ok": false, "error": "Recipe not found"])
            }
            recipe.recipeDescription = description
            return currentRecipeResponse(recipe, isNew: recipeEditorViewModel.isNewRecipe)
        }
        return result
    }

    // MARK: recipe_set_ingredients

    await register("recipe_set_ingredients") { [recipeService, recipeEditorViewModel] args in
        let id = args["id"] as? String
        let result: LocalToolHandlerResult = await MainActor.run {
            guard let recipe = try? recipeEditorViewModel.recipeForEditing(id: id, using: recipeService) else {
                return .success(responseJSON: ["ok": false, "error": "Recipe not found"])
            }
            let op = args["op"] as? String ?? "set"
            switch op {
            case "set":
                let list = (args["ingredients"] as? [String]) ?? []
                recipe.ingredients = list
            case "add":
                let items: [String]
                if let arr = args["items"] as? [String] { items = arr }
                else if let s = args["item"] as? String { items = [s] }
                else { items = [] }
                if let idx = args["index"] as? Int {
                    let safeIdx = max(0, min(idx, recipe.ingredients.count))
                    recipe.ingredients.insert(contentsOf: items, at: safeIdx)
                } else {
                    recipe.ingredients.append(contentsOf: items)
                }
            case "remove":
                if let idx = args["index"] as? Int,
                   recipe.ingredients.indices.contains(idx) {
                    recipe.ingredients.remove(at: idx)
                } else if let value = args["value"] as? String {
                    recipe.ingredients.removeAll { $0 == value }
                }
            case "update":
                if let idx = args["index"] as? Int,
                   recipe.ingredients.indices.contains(idx),
                   let item = args["item"] as? String {
                    recipe.ingredients[idx] = item
                }
            default:
                break
            }
            return .success(responseJSON: [
                "ok": true,
                "id": recipe.id,
                "count": recipe.ingredients.count,
                "isNew": recipeEditorViewModel.isNewRecipe
            ])
        }
        return result
    }

    // MARK: recipe_set_directions

    await register("recipe_set_directions") { [recipeService, recipeEditorViewModel] args in
        let id = args["id"] as? String
        let result: LocalToolHandlerResult = await MainActor.run {
            guard let recipe = try? recipeEditorViewModel.recipeForEditing(id: id, using: recipeService) else {
                return .success(responseJSON: ["ok": false, "error": "Recipe not found"])
            }
            let op = args["op"] as? String ?? "set"
            switch op {
            case "set":
                // The agent sends a numbered markdown string; parse into individual steps.
                if let instructions = args["instructions"] as? String {
                    recipe.directions = parseNumberedMarkdown(instructions)
                }
            case "add":
                if let step = args["step"] as? String {
                    if let rawIdx = args["index"] as? Int {
                        // 1-based index from agent → 0-based
                        let safeIdx = max(0, min(rawIdx - 1, recipe.directions.count))
                        recipe.directions.insert(step, at: safeIdx)
                    } else {
                        recipe.directions.append(step)
                    }
                }
            case "remove":
                if let rawIdx = args["index"] as? Int {
                    let idx = rawIdx - 1
                    if recipe.directions.indices.contains(idx) {
                        recipe.directions.remove(at: idx)
                    }
                }
            case "update":
                if let rawIdx = args["index"] as? Int,
                   let step = args["step"] as? String {
                    let idx = rawIdx - 1
                    if recipe.directions.indices.contains(idx) {
                        recipe.directions[idx] = step
                    }
                }
            default:
                break
            }
            return .success(responseJSON: [
                "ok": true,
                "id": recipe.id,
                "steps": recipe.directions.count,
                "isNew": recipeEditorViewModel.isNewRecipe
            ])
        }
        return result
    }

    // MARK: recipe_save / save_recipe

    let saveHandler: LocalToolHandler = { [recipeService, selectedRecipeState, recipeEditorViewModel] args in
        let id = args["id"] as? String
        let result: LocalToolHandlerResult = await MainActor.run {
            do {
                _ = try recipeEditorViewModel.recipeForEditing(id: id, using: recipeService)
                let recipe = try recipeEditorViewModel.save(using: recipeService)
                selectedRecipeState.selectedRecipeId = recipe.id
                return .success(responseJSON: [
                    "ok": true,
                    "id": recipe.id,
                    "name": recipe.name,
                    "isNew": false
                ])
            } catch {
                return .success(responseJSON: ["ok": false, "error": error.localizedDescription])
            }
        }
        return result
    }
    await register("recipe_save", handler: saveHandler)
    await register("save_recipe", handler: saveHandler)

    // MARK: recipe_delete

    await register("recipe_delete") { [recipeService, selectedRecipeState, recipeEditorViewModel] args in
        let id = args["id"] as? String
        let result: LocalToolHandlerResult = await MainActor.run {
            do {
                if recipeEditorViewModel.isNewRecipe,
                   let current = recipeEditorViewModel.recipe,
                   id == nil || id == current.id {
                    recipeEditorViewModel.close()
                    selectedRecipeState.selectedRecipeId = nil
                    return .success(responseJSON: ["ok": true, "id": current.id, "deletedDraft": true])
                }

                guard let recipe = try? recipeEditorViewModel.recipeForEditing(id: id, using: recipeService) else {
                    return .success(responseJSON: ["ok": false, "error": "Recipe not found"])
                }
                try recipeService.delete(id: recipe.id)
                if selectedRecipeState.selectedRecipeId == recipe.id {
                    selectedRecipeState.selectedRecipeId = nil
                }
                recipeEditorViewModel.close()
                return .success(responseJSON: ["ok": true, "id": recipe.id])
            } catch {
                return .success(responseJSON: ["ok": false, "error": error.localizedDescription])
            }
        }
        return result
    }

    // MARK: recipe_set_photo

    await register("recipe_set_photo") { [recipeService, photoStaging, recipeEditorViewModel] args in
        let id = args["id"] as? String
        let result: LocalToolHandlerResult = await MainActor.run {
            guard let staged = photoStaging.consume() else {
                return .success(responseJSON: [
                    "ok": false,
                    "error": "No photo staged. The user must attach an image first."
                ])
            }
            guard let recipe = try? recipeEditorViewModel.recipeForEditing(id: id, using: recipeService) else {
                return .success(responseJSON: ["ok": false, "error": "Recipe not found"])
            }
            recipe.photoBase64 = staged.data.base64EncodedString()
            return .success(responseJSON: [
                "ok": true,
                "id": recipe.id,
                "isNew": recipeEditorViewModel.isNewRecipe
            ])
        }
        return result
    }
}

// MARK: - Helpers

/// Converts a numeric servings value (Int or String like "4 servings") to an Int.
private func parseServings(_ value: Any) -> Int? {
    if let n = value as? Int { return n }
    if let s = value as? String {
        // Extract leading digits from strings like "4 servings"
        let digits = s.prefix(while: { $0.isNumber })
        return Int(digits)
    }
    return nil
}

/// Parses a numbered markdown list like "1. Step one\n2. Step two" into ["Step one", "Step two"].
/// Falls back to splitting on newlines if no numbered pattern is found.
private func parseNumberedMarkdown(_ text: String) -> [String] {
    let lines = text.components(separatedBy: "\n")
    var steps: [String] = []
    for line in lines {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { continue }
        // Match "1. " or "1) " prefixes
        if let range = trimmed.range(of: #"^\d+[.)]\s+"#, options: .regularExpression) {
            steps.append(String(trimmed[range.upperBound...]))
        } else {
            steps.append(trimmed)
        }
    }
    return steps
}
