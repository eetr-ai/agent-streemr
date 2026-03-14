import SwiftUI

/// Sidebar list of all saved recipes. Selecting a row updates `selection`
/// so that `RecipeBrowserView` can display the appropriate detail panel.
struct RecipeListView: View {

    @Binding var selection: String?
    let createRecipe: () -> Void

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
                List(selection: $selection) {
                    ForEach(viewModel.recipes) { recipe in
                        RecipeRowView(recipe: recipe)
                            .tag(recipe.id)
                    }
                    .onDelete(perform: deleteRecipes)
                }
                .listStyle(.sidebar)
            }
        }
        .navigationTitle("Recipes")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    createRecipe()
                } label: {
                    Label("New Recipe", systemImage: "plus")
                }
            }

            ToolbarItem(placement: .primaryAction) {
                Button {
                    viewModel.load(using: recipeService)
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .help("Refresh recipe list")
            }
        }
        .task(id: recipeService.recipesModifiedVersion) { viewModel.load(using: recipeService) }
        .alert("Error", isPresented: Binding(
            get: { viewModel.errorMessage != nil },
            set: { _ in viewModel.dismissError() }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
    }

    private func deleteRecipes(at offsets: IndexSet) {
        let idsToDelete = offsets.compactMap { viewModel.recipes.indices.contains($0) ? viewModel.recipes[$0].id : nil }
        for id in idsToDelete {
            viewModel.delete(id: id, using: recipeService)
        }
    }
}

// MARK: - Row

private struct RecipeRowView: View {
    let recipe: Recipe

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(recipe.name.isEmpty ? "Untitled Recipe" : recipe.name)
                .font(.headline)
            if !recipe.tags.isEmpty {
                TagChipRow(tags: recipe.tags)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Tag Chips

private struct TagChipRow: View {
    let tags: [String]

    var body: some View {
        HStack(spacing: 4) {
            ForEach(tags.prefix(4), id: \.self) { tag in
                Text(tag)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(Color.accentColor)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color.accentColor.opacity(0.12), in: Capsule())
            }
            if tags.count > 4 {
                Text("+\(tags.count - 4)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
