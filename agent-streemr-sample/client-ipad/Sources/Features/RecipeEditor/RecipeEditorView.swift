import SwiftUI

/// Displays the full details of a single recipe and allows editing.
struct RecipeEditorView: View {

    let recipeId: String

    @Environment(\.recipeService) private var recipeService
    @State private var viewModel = RecipeEditorViewModel()

    var body: some View {
        Group {
            if let recipe = viewModel.recipe {
                Form {
                    Section("Title") {
                        TextField("Name", text: Binding(
                            get: { recipe.name },
                            set: { recipe.name = $0 }
                        ))
                    }

                    Section("Description") {
                        TextEditor(text: Binding(
                            get: { recipe.recipeDescription },
                            set: { recipe.recipeDescription = $0 }
                        ))
                        .frame(minHeight: 80)
                    }

                    Section("Servings") {
                        Stepper("\(recipe.servings)", value: Binding(
                            get: { recipe.servings },
                            set: { recipe.servings = $0 }
                        ), in: 1...100)
                    }

                    Section("Ingredients") {
                        if recipe.ingredients.isEmpty {
                            Text("No ingredients yet")
                                .foregroundStyle(.secondary)
                                .italic()
                        } else {
                            ForEach(recipe.ingredients, id: \.self) { ingredient in
                                Text(ingredient)
                            }
                        }
                    }

                    Section("Directions") {
                        if recipe.directions.isEmpty {
                            Text("No directions yet")
                                .foregroundStyle(.secondary)
                                .italic()
                        } else {
                            ForEach(Array(recipe.directions.enumerated()), id: \.offset) { index, step in
                                Label(step, systemImage: "\(index + 1).circle")
                            }
                        }
                    }
                }
            } else {
                ProgressView("Loading…")
            }
        }
        .navigationTitle(viewModel.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { viewModel.save(using: recipeService) }
                    .disabled(!viewModel.canSave)
            }
        }
        .task { viewModel.load(id: recipeId, using: recipeService) }
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
