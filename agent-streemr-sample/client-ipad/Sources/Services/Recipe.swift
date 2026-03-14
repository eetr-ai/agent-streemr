import Foundation
import SwiftData

/// A recipe stored on the user's device.
///
/// This is the canonical SwiftData entity for all recipe data. It is used
/// directly by `RecipeRepository` implementations and surfaced to the UI
/// through `RecipeService`.
@Model
final class Recipe {
    var id: String
    var name: String
    var recipeDescription: String
    var ingredients: [String]
    var directions: [String]
    var servings: Int
    var tags: [String]
    /// Photos library asset local identifier. `nil` when no photo has been set.
    var photoAssetIdentifier: String?
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
        photoAssetIdentifier: String? = nil
    ) {
        self.id = id
        self.name = name
        self.recipeDescription = recipeDescription
        self.ingredients = ingredients
        self.directions = directions
        self.servings = servings
        self.tags = tags
        self.photoAssetIdentifier = photoAssetIdentifier
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}
