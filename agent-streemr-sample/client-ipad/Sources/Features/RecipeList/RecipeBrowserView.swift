import SwiftUI

/// Top-level container for the Recipes tab.
///
/// Manages the selected recipe ID and renders a NavigationSplitView so that
/// the list (sidebar) and the detail panel are visible side-by-side on iPad.
struct RecipeBrowserView: View {

    @State private var selectedRecipeId: String?

    var body: some View {
        NavigationSplitView {
            RecipeListView(selection: $selectedRecipeId)
        } detail: {
            if let id = selectedRecipeId {
                RecipeDetailView(recipeId: id)
            } else {
                ContentUnavailableView(
                    "Select a Recipe",
                    systemImage: "fork.knife.circle",
                    description: Text("Choose a recipe from the list to view its details.")
                )
            }
        }
    }
}

#Preview {
    RecipeBrowserView()
}
