import SwiftUI
import AgentStreemrSwift

/// Top-level container for the Recipes tab.
///
/// Manages the selected recipe ID and renders a NavigationSplitView so that
/// the list (sidebar) and the detail panel are visible side-by-side on iPad.
struct RecipeBrowserView: View {

    @Environment(SelectedRecipeState.self) private var selectedRecipeState
    @Environment(AgentStream.self) private var stream

    var body: some View {
        NavigationSplitView {
            RecipeListView(selection: Binding(
                get: { selectedRecipeState.selectedRecipeId },
                set: { selectedRecipeState.selectedRecipeId = $0 }
            ))
        } detail: {
            if let id = selectedRecipeState.selectedRecipeId {
                RecipeDetailView(recipeId: id)
            } else {
                ContentUnavailableView(
                    "Select a Recipe",
                    systemImage: "fork.knife.circle",
                    description: Text("Choose a recipe from the list to view its details.")
                )
            }
        }
        .onChange(of: selectedRecipeState.selectedRecipeId) { _, newId in
            let contextValue: Any = newId ?? NSNull()
            stream.setContext(["selectedRecipeId": contextValue])
        }
        .onAppear {
            let contextValue: Any = selectedRecipeState.selectedRecipeId ?? NSNull()
            stream.setContext(["selectedRecipeId": contextValue])
        }
    }
}

#Preview {
    RecipeBrowserView()
}
