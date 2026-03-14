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
    photoStaging: PhotoStagingService
) async {

    // MARK: recipe_create

    await stream.registerTool("recipe_create") { [recipeService] args in
        let result: LocalToolHandlerResult = await MainActor.run {
            do {
                let recipe = try recipeService.create()
                if let name = args["name"] as? String, !name.isEmpty {
                    recipe.name = name
                }
                if let tags = args["tags"] as? [String] { recipe.tags = tags }
                if let servings = args["servings"] {
                    recipe.servings = parseServings(servings) ?? recipe.servings
                }
                return .success(responseJSON: ["id": recipe.id, "name": recipe.name])
            } catch {
                return .error(message: error.localizedDescription)
            }
        }
        return result
    }

    // MARK: recipe_set_title

    await stream.registerTool("recipe_set_title") { [recipeService] args in
        guard let id = args["id"] as? String,
              let name = args["name"] as? String else {
            return .error(message: "Missing 'id' or 'name'")
        }
        let result: LocalToolHandlerResult = await MainActor.run {
            guard let recipe = try? recipeService.recipe(id: id) else {
                return .success(responseJSON: ["ok": false, "error": "Not found"])
            }
            recipe.name = name
            return .success(responseJSON: ["ok": true, "id": recipe.id, "name": recipe.name])
        }
        return result
    }

    // MARK: recipe_set_description

    await stream.registerTool("recipe_set_description") { [recipeService] args in
        guard let id = args["id"] as? String,
              let description = args["description"] as? String else {
            return .error(message: "Missing 'id' or 'description'")
        }
        let result: LocalToolHandlerResult = await MainActor.run {
            guard let recipe = try? recipeService.recipe(id: id) else {
                return .success(responseJSON: ["ok": false, "error": "Not found"])
            }
            recipe.recipeDescription = description
            return .success(responseJSON: ["ok": true, "id": recipe.id])
        }
        return result
    }

    // MARK: recipe_set_ingredients

    await stream.registerTool("recipe_set_ingredients") { [recipeService] args in
        guard let id = args["id"] as? String else {
            return .error(message: "Missing 'id'")
        }
        let result: LocalToolHandlerResult = await MainActor.run {
            guard let recipe = try? recipeService.recipe(id: id) else {
                return .success(responseJSON: ["ok": false, "error": "Not found"])
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
            return .success(responseJSON: ["ok": true, "id": recipe.id, "count": recipe.ingredients.count])
        }
        return result
    }

    // MARK: recipe_set_directions

    await stream.registerTool("recipe_set_directions") { [recipeService] args in
        guard let id = args["id"] as? String else {
            return .error(message: "Missing 'id'")
        }
        let result: LocalToolHandlerResult = await MainActor.run {
            guard let recipe = try? recipeService.recipe(id: id) else {
                return .success(responseJSON: ["ok": false, "error": "Not found"])
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
            return .success(responseJSON: ["ok": true, "id": recipe.id, "steps": recipe.directions.count])
        }
        return result
    }

    // MARK: recipe_save

    // In SwiftData, mutations are persisted automatically. This tool acts as
    // a validation checkpoint that also runs the service's trimming/validation.
    await stream.registerTool("recipe_save") { [recipeService] args in
        guard let id = args["id"] as? String else {
            return .error(message: "Missing 'id'")
        }
        let result: LocalToolHandlerResult = await MainActor.run {
            guard let recipe = try? recipeService.recipe(id: id) else {
                return .success(responseJSON: ["ok": false, "error": "Not found"])
            }
            do {
                try recipeService.save(recipe)
                return .success(responseJSON: ["ok": true, "id": recipe.id, "name": recipe.name])
            } catch {
                return .success(responseJSON: ["ok": false, "error": error.localizedDescription])
            }
        }
        return result
    }

    // MARK: recipe_delete

    await stream.registerTool("recipe_delete") { [recipeService] args in
        guard let id = args["id"] as? String else {
            return .error(message: "Missing 'id'")
        }
        let result: LocalToolHandlerResult = await MainActor.run {
            do {
                try recipeService.delete(id: id)
                return .success(responseJSON: ["ok": true, "id": id])
            } catch {
                return .success(responseJSON: ["ok": false, "error": error.localizedDescription])
            }
        }
        return result
    }

    // MARK: recipe_set_photo

    await stream.registerTool("recipe_set_photo") { [recipeService, photoStaging] args in
        guard let id = args["id"] as? String else {
            return .error(message: "Missing 'id'")
        }
        let result: LocalToolHandlerResult = await MainActor.run {
            guard let staged = photoStaging.consume() else {
                return .success(responseJSON: [
                    "ok": false,
                    "error": "No photo staged. The user must attach an image first."
                ])
            }
            guard let recipe = try? recipeService.recipe(id: id) else {
                return .success(responseJSON: ["ok": false, "error": "Not found"])
            }
            recipe.photoBase64 = staged.data.base64EncodedString()
            return .success(responseJSON: ["ok": true, "id": recipe.id])
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
