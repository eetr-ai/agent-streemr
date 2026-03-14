import SwiftUI
import Photos

/// Displays the current recipe as a read-only document driven by local tools.
struct RecipeEditorView: View {
    @Environment(RecipeEditorViewModel.self) private var viewModel

    var body: some View {
        Group {
            if let recipe = viewModel.recipe {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        RecipePhotoSection(assetIdentifier: recipe.photoAssetIdentifier)

                        VStack(alignment: .leading, spacing: 12) {
                            Text(recipe.name.isEmpty ? "Untitled Recipe" : recipe.name)
                                .font(.largeTitle.weight(.bold))
                                .frame(maxWidth: .infinity, alignment: .leading)

                            HStack(spacing: 10) {
                                DetailPill(
                                    title: "Servings",
                                    value: "\(recipe.servings)"
                                )
                                if !recipe.tags.isEmpty {
                                    TagChipRow(tags: recipe.tags)
                                }
                            }
                        }

                        if !recipe.recipeDescription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            RecipeSectionCard(title: "Description") {
                                MarkdownDescriptionView(markdown: recipe.recipeDescription)
                            }
                        }

                        RecipeSectionCard(title: "Ingredients") {
                            if recipe.ingredients.isEmpty {
                                EmptyRecipeSectionText(text: "No ingredients yet")
                            } else {
                                VStack(alignment: .leading, spacing: 10) {
                                    ForEach(recipe.ingredients, id: \.self) { ingredient in
                                        HStack(alignment: .top, spacing: 10) {
                                            Image(systemName: "circle.fill")
                                                .font(.system(size: 7))
                                                .foregroundStyle(.accent)
                                                .padding(.top, 6)
                                            Text(ingredient)
                                                .frame(maxWidth: .infinity, alignment: .leading)
                                        }
                                    }
                                }
                            }
                        }

                        RecipeSectionCard(title: "Directions") {
                            if recipe.directions.isEmpty {
                                EmptyRecipeSectionText(text: "No directions yet")
                            } else {
                                VStack(alignment: .leading, spacing: 14) {
                                    ForEach(Array(recipe.directions.enumerated()), id: \.offset) { index, step in
                                        HStack(alignment: .top, spacing: 12) {
                                            Text("\(index + 1)")
                                                .font(.headline.weight(.semibold))
                                                .foregroundStyle(.accent)
                                                .frame(width: 28, height: 28)
                                                .background(Color.accentColor.opacity(0.12), in: Circle())

                                            Text(step)
                                                .frame(maxWidth: .infinity, alignment: .leading)
                                        }
                                    }
                                }
                            }
                        }
                    }
                    .padding(20)
                }
            } else {
                ContentUnavailableView(
                    "No Recipe Open",
                    systemImage: "book.closed",
                    description: Text("Ask the agent to create or open a recipe.")
                )
            }
        }
        .navigationTitle(viewModel.title)
        .navigationBarTitleDisplayMode(.inline)
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

private struct RecipeSectionCard<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title)
                .font(.headline)

            content
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18))
    }
}

private struct DetailPill: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.headline)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color(.secondarySystemBackground), in: Capsule())
    }
}

private struct EmptyRecipeSectionText: View {
    let text: String

    var body: some View {
        Text(text)
            .foregroundStyle(.secondary)
            .italic()
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct MarkdownDescriptionView: View {
    let markdown: String

    var body: some View {
        if let attributed = try? AttributedString(
            markdown: markdown,
            options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .full)
        ) {
            Text(attributed)
                .font(.body)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .tint(.accentColor)
        } else {
            Text(markdown)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct RecipePhotoSection: View {
    let assetIdentifier: String?

    var body: some View {
        if let assetIdentifier {
            RecipeAssetImageView(assetIdentifier: assetIdentifier)
                .frame(maxWidth: .infinity)
        } else {
            ContentUnavailableView(
                "No Photo",
                systemImage: "photo",
                description: Text("Attach a photo in chat, then let the agent set it on the recipe.")
            )
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18))
        }
    }
}

private struct RecipeAssetImageView: View {
    let assetIdentifier: String
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .clipShape(RoundedRectangle(cornerRadius: 18))
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, minHeight: 220)
            }
        }
        .task(id: assetIdentifier) {
            image = await loadImage(assetIdentifier: assetIdentifier)
        }
    }

    private func loadImage(assetIdentifier: String) async -> UIImage? {
        await withCheckedContinuation { continuation in
            let assets = PHAsset.fetchAssets(withLocalIdentifiers: [assetIdentifier], options: nil)
            guard let asset = assets.firstObject else {
                continuation.resume(returning: nil)
                return
            }

            let options = PHImageRequestOptions()
            options.deliveryMode = .highQualityFormat
            options.resizeMode = .fast
            options.isNetworkAccessAllowed = true

            var resumed = false
            PHImageManager.default().requestImage(
                for: asset,
                targetSize: CGSize(width: 1200, height: 1200),
                contentMode: .aspectFit,
                options: options
            ) { image, info in
                let isDegraded = (info?[PHImageResultIsDegradedKey] as? Bool) ?? false
                guard !resumed, !isDegraded else { return }
                resumed = true
                continuation.resume(returning: image)
            }
        }
    }
}
