import SwiftUI

/// Root view — uses a tab bar to surface all features.
struct ContentView: View {
    var body: some View {
        TabView {
            Tab("Chat", systemImage: "bubble.left.and.bubble.right") {
                NavigationStack {
                    ChatView()
                }
            }
            Tab("Recipes", systemImage: "fork.knife") {
                RecipeTabView()
            }
            Tab("Tool Calls", systemImage: "wrench.and.screwdriver") {
                NavigationStack {
                    ToolCallLogView()
                }
            }
            Tab("Protocol Log", systemImage: "antenna.radiowaves.left.and.right") {
                NavigationStack {
                    ProtocolLogView()
                }
            }
        }
    }
}

#Preview {
    ContentView()
}

private struct RecipeTabView: View {
    @Environment(SelectedRecipeState.self) private var selectedRecipeState

    var body: some View {
        NavigationSplitView {
            RecipeListView(selection: Binding(
                get: { selectedRecipeState.selectedRecipeId },
                set: { selectedRecipeState.selectedRecipeId = $0 }
            ))
        } detail: {
            if let selectedRecipeId = selectedRecipeState.selectedRecipeId {
                NavigationStack {
                    RecipeEditorView(recipeId: selectedRecipeId)
                }
            } else {
                ContentUnavailableView(
                    "Select a Recipe",
                    systemImage: "fork.knife",
                    description: Text("Choose a recipe from the list to view or edit it.")
                )
            }
        }
    }
}
