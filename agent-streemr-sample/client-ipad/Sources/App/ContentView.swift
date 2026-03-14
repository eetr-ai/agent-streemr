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
                NavigationStack {
                    RecipeListView()
                        .navigationDestination(for: String.self) { recipeId in
                            RecipeEditorView(recipeId: recipeId)
                        }
                }
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
