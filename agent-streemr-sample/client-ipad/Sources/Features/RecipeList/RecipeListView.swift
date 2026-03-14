import SwiftUI

/// Displays a scrollable list of all saved recipes.
/// Tapping a row navigates to `RecipeEditorView` for that recipe.
struct RecipeListView: View {

    @State private var recipes: [Recipe] = []
    @State private var errorMessage: String? = nil

    var body: some View {
        Group {
            if recipes.isEmpty {
                ContentUnavailableView(
                    "No Recipes Yet",
                    systemImage: "fork.knife",
                    description: Text("Ask the agent to create one for you.")
                )
            } else {
                List(recipes) { recipe in
                    NavigationLink(value: recipe.id) {
                        RecipeRowView(recipe: recipe)
                    }
                }
                .listStyle(.insetGrouped)
            }
        }
        .navigationTitle("Recipes")
        .task { reload() }
        .alert("Error", isPresented: Binding(get: { errorMessage != nil }, set: { _ in errorMessage = nil })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private func reload() {
        do {
            recipes = try RecipeService.shared.allRecipes()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Row

private struct RecipeRowView: View {
    let recipe: Recipe

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(recipe.name.isEmpty ? "Untitled Recipe" : recipe.name)
                .font(.headline)
            if !recipe.tags.isEmpty {
                Text(recipe.tags.joined(separator: ", "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}
