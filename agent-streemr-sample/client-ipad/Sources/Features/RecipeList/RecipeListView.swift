import SwiftUI

/// Displays a scrollable list of all saved recipes.
/// Tapping a row navigates to `RecipeEditorView` for that recipe.
struct RecipeListView: View {

    @Environment(\.recipeService) private var recipeService
    @State private var viewModel = RecipeListViewModel()

    var body: some View {
        Group {
            if viewModel.recipes.isEmpty {
                ContentUnavailableView(
                    "No Recipes Yet",
                    systemImage: "fork.knife",
                    description: Text("Ask the agent to create one for you.")
                )
            } else {
                List(viewModel.recipes) { recipe in
                    NavigationLink(value: recipe.id) {
                        RecipeRowView(recipe: recipe)
                    }
                }
                .listStyle(.insetGrouped)
            }
        }
        .navigationTitle("Recipes")
        .task { viewModel.load(using: recipeService) }
        .alert("Error", isPresented: Binding(
            get: { viewModel.errorMessage != nil },
            set: { _ in viewModel.dismissError() }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(viewModel.errorMessage ?? "")
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
