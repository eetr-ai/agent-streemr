import SwiftUI

/// Displays the full details of a single recipe and allows editing.
struct RecipeEditorView: View {

    let recipeId: String

    @State private var recipe: Recipe? = nil
    @State private var errorMessage: String? = nil

    var body: some View {
        Group {
            if let recipe {
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
        .navigationTitle(recipe?.name.isEmpty == false ? recipe!.name : "Recipe")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { saveRecipe() }
                    .disabled(recipe == nil)
            }
        }
        .task { loadRecipe() }
        .alert("Error", isPresented: Binding(get: { errorMessage != nil }, set: { _ in errorMessage = nil })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private func loadRecipe() {
        do {
            recipe = try RecipeService.shared.recipe(id: recipeId)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func saveRecipe() {
        guard let recipe else { return }
        do {
            try RecipeService.shared.save(recipe)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
