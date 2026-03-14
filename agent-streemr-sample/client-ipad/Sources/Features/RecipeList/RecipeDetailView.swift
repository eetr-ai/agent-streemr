import SwiftUI
import MarkdownUI

/// Read-only detail panel for a single recipe, mirroring the layout of the
/// React web app's RecipeViewer component.
struct RecipeDetailView: View {

    let recipeId: String

    @Environment(\.recipeService) private var recipeService
    @State private var recipe: Recipe?
    @State private var isLoading = true

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let recipe {
                RecipeContentView(recipe: recipe)
            } else {
                ContentUnavailableView(
                    "Recipe Not Found",
                    systemImage: "exclamationmark.triangle",
                    description: Text("This recipe may have been deleted.")
                )
            }
        }
        .task(id: recipeId) { load() }
    }

    private func load() {
        isLoading = true
        recipe = try? recipeService.recipe(id: recipeId)
        isLoading = false
    }
}

// MARK: - Content

private struct RecipeContentView: View {
    let recipe: Recipe

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {

                // Hero photo
                if let photo = decodedPhoto {
                    Image(uiImage: photo)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(maxWidth: .infinity)
                        .frame(height: 280)
                        .clipped()
                }

                VStack(alignment: .leading, spacing: 20) {

                    // Header: name, servings, tags
                    VStack(alignment: .leading, spacing: 8) {
                        Text(recipe.name.isEmpty ? "Untitled Recipe" : recipe.name)
                            .font(.largeTitle.bold())

                        HStack(spacing: 12) {
                            Label("\(recipe.servings) servings", systemImage: "person.2")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)

                            if !recipe.tags.isEmpty {
                                TagChipRow(tags: recipe.tags)
                            }
                        }
                    }

                    // Description
                    if !recipe.recipeDescription.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            SectionHeader("Description")
                            MarkdownUI.Markdown(recipe.recipeDescription)
                        }
                    }

                    // Ingredients
                    if !recipe.ingredients.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            SectionHeader("Ingredients")
                            ForEach(recipe.ingredients, id: \.self) { ingredient in
                                HStack(alignment: .top, spacing: 10) {
                                    Circle()
                                        .fill(Color.accentColor)
                                        .frame(width: 6, height: 6)
                                        .padding(.top, 7)
                                    Text(ingredient)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }
                    }

                    // Directions
                    if !recipe.directions.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            SectionHeader("Directions")
                            ForEach(Array(recipe.directions.enumerated()), id: \.offset) { index, step in
                                HStack(alignment: .top, spacing: 10) {
                                    Text("\(index + 1).")
                                        .font(.subheadline.monospacedDigit().bold())
                                        .foregroundStyle(.secondary)
                                        .frame(minWidth: 24, alignment: .trailing)
                                    Text(step)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }
                    }

                    // Footer timestamp
                    Text("Updated \(recipe.updatedAt.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                .padding(20)
            }
        }
        .navigationTitle(recipe.name.isEmpty ? "Recipe" : recipe.name)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var decodedPhoto: UIImage? {
        guard let base64 = recipe.photoBase64,
              let data = Data(base64Encoded: base64) else { return nil }
        return UIImage(data: data)
    }
}

// MARK: - Supporting Views

private struct SectionHeader: View {
    let title: String
    init(_ title: String) { self.title = title }

    var body: some View {
        Text(title)
            .font(.title3.bold())
            .padding(.top, 4)
    }
}

private struct TagChipRow: View {
    let tags: [String]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(tags, id: \.self) { tag in
                    Text(tag)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.accent)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Color.accentColor.opacity(0.12), in: Capsule())
                }
            }
        }
    }
}
