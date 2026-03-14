import Foundation
import Observation

/// Shared app-level state for which recipe is selected in the browser.
/// Updated by user selection and by the `recipe_load` tool.
@Observable
@MainActor
final class SelectedRecipeState {
    var selectedRecipeId: String?
}
