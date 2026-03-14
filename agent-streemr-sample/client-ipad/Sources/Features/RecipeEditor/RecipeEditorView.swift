import SwiftUI
import Photos

/// Displays the current recipe as a read-only document driven by local tools.
struct RecipeEditorView: View {
    @Environment(\.recipeService) private var recipeService
    @Environment(RecipeEditorViewModel.self) private var viewModel
    @State private var newIngredient: String = ""

    var body: some View {
        Group {
            if let recipe = viewModel.recipe {
                RecipeDocumentView(
                    recipe: recipe,
                    isNewRecipe: viewModel.isNewRecipe,
                    newIngredient: $newIngredient
                )
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
        .toolbar {
            if viewModel.canSave {
                ToolbarItem(placement: .primaryAction) {
                    Button(viewModel.isNewRecipe ? "Save Recipe" : "Save Changes") {
                        _ = try? viewModel.save(using: recipeService)
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
        }
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

private struct RecipeDocumentView: View {
    let recipe: Recipe
    let isNewRecipe: Bool
    @Binding var newIngredient: String

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if isNewRecipe {
                    UnsavedRecipeBanner()
                }

                RecipePhotoSection(assetIdentifier: recipe.photoAssetIdentifier)
                RecipeHeaderEditor(recipe: recipe)

                if hasDescription {
                    RecipeSectionCard(title: "Description") {
                        MarkdownDescriptionView(markdown: recipe.recipeDescription)
                    }
                }

                RecipeIngredientsEditor(recipe: recipe, newIngredient: $newIngredient)
                RecipeDirectionsSection(directions: recipe.directions)
            }
            .padding(20)
        }
    }

    private var hasDescription: Bool {
        !recipe.recipeDescription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

private struct UnsavedRecipeBanner: View {
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "square.and.arrow.down")
                .foregroundStyle(Color.accentColor)
            Text("This recipe is unsaved. Save it when you’re ready to keep it in your collection.")
                .font(.subheadline)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.accentColor.opacity(0.1), in: RoundedRectangle(cornerRadius: 16))
    }
}

private struct RecipeHeaderEditor: View {
    let recipe: Recipe

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField("Recipe Title", text: Binding(
                get: { recipe.name },
                set: { recipe.name = $0 }
            ))
            .font(.largeTitle.weight(.bold))
            .textFieldStyle(.plain)

            HStack(spacing: 10) {
                DetailPill(title: "Servings", value: "\(recipe.servings)")
                if !recipe.tags.isEmpty {
                    RecipeTagRow(tags: recipe.tags)
                }
            }
        }
    }
}

private struct RecipeIngredientsEditor: View {
    let recipe: Recipe
    @Binding var newIngredient: String

    var body: some View {
        RecipeSectionCard(title: "Ingredients") {
            if recipe.ingredients.isEmpty {
                EmptyRecipeSectionText(text: "No ingredients yet")
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(Array(recipe.ingredients.enumerated()), id: \.offset) { index, ingredient in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: "circle.fill")
                                .font(.system(size: 7))
                                .foregroundStyle(Color.accentColor)
                                .padding(.top, 6)
                            Text(ingredient)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Button(role: .destructive) {
                                recipe.ingredients.remove(at: index)
                            } label: {
                                Image(systemName: "minus.circle.fill")
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            HStack(spacing: 10) {
                TextField("Add ingredient", text: $newIngredient)
                    .textFieldStyle(.roundedBorder)

                Button("Add") {
                    let trimmed = newIngredient.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !trimmed.isEmpty else { return }
                    recipe.ingredients.append(trimmed)
                    newIngredient = ""
                }
                .buttonStyle(.borderedProminent)
            }
        }
    }
}

private struct RecipeDirectionsSection: View {
    let directions: [String]

    var body: some View {
        RecipeSectionCard(title: "Directions") {
            if directions.isEmpty {
                EmptyRecipeSectionText(text: "No directions yet")
            } else {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(Array(directions.enumerated()), id: \.offset) { index, step in
                        HStack(alignment: .top, spacing: 12) {
                            Text("\(index + 1)")
                                .font(.headline.weight(.semibold))
                                .foregroundStyle(Color.accentColor)
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

private struct RecipeTagRow: View {
    let tags: [String]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(tags, id: \.self) { tag in
                    Text(tag)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Color.accentColor)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Color.accentColor.opacity(0.12), in: Capsule())
                }
            }
        }
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
        VStack(alignment: .leading, spacing: 16) {
            ForEach(MarkdownBlock.parse(markdown: markdown)) { block in
                switch block.content {
                case .markdown(let text):
                    MarkdownTextBlock(markdown: text)
                case .table(let table):
                    MarkdownTableView(table: table)
                }
            }
        }
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct MarkdownTextBlock: View {
    let markdown: String

    var body: some View {
        if let attributed = try? AttributedString(
            markdown: markdown,
            options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .full)
        ) {
            Text(attributed)
                .font(.body)
                .frame(maxWidth: .infinity, alignment: .leading)
                .tint(.accentColor)
        } else {
            Text(markdown)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct MarkdownTableView: View {
    let table: MarkdownTable

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(Array(table.headers.enumerated()), id: \.offset) { index, header in
                        tableCell(
                            header,
                            isHeader: true,
                            alignment: table.alignment(at: index)
                        )
                    }
                }

                ForEach(Array(table.rows.enumerated()), id: \.offset) { _, row in
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { index, cell in
                            tableCell(
                                cell,
                                isHeader: false,
                                alignment: table.alignment(at: index)
                            )
                        }
                    }
                }
            }
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color(.separator), lineWidth: 1)
            )
        }
    }

    private func tableCell(_ text: String, isHeader: Bool, alignment: TextAlignment) -> some View {
        let backgroundColor = isHeader ? Color.accentColor.opacity(0.12) : Color.clear
        return Text(text)
            .font(isHeader ? .subheadline.weight(.semibold) : .body)
            .multilineTextAlignment(alignment)
            .frame(minWidth: 120, maxWidth: .infinity, alignment: frameAlignment(for: alignment))
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(backgroundColor)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(Color(.separator))
                    .frame(height: 1)
            }
            .overlay(alignment: .trailing) {
                Rectangle()
                    .fill(Color(.separator))
                    .frame(width: 1)
            }
    }

    private func frameAlignment(for alignment: TextAlignment) -> Alignment {
        switch alignment {
        case .center:
            return .center
        case .trailing:
            return .trailing
        default:
            return .leading
        }
    }
}

private struct MarkdownBlock: Identifiable {
    enum Content {
        case markdown(String)
        case table(MarkdownTable)
    }

    let id = UUID()
    let content: Content

    static func parse(markdown: String) -> [MarkdownBlock] {
        let lines = markdown.components(separatedBy: .newlines)
        var blocks: [MarkdownBlock] = []
        var currentMarkdown: [String] = []
        var index = 0

        func flushMarkdown() {
            let text = currentMarkdown.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty {
                blocks.append(MarkdownBlock(content: .markdown(text)))
            }
            currentMarkdown.removeAll()
        }

        while index < lines.count {
            if let table = MarkdownTable.consume(from: lines, startingAt: index) {
                flushMarkdown()
                blocks.append(MarkdownBlock(content: .table(table.table)))
                index = table.nextIndex
            } else {
                currentMarkdown.append(lines[index])
                index += 1
            }
        }

        flushMarkdown()
        return blocks
    }
}

private struct MarkdownTable {
    enum ColumnAlignment {
        case leading
        case center
        case trailing
    }

    let headers: [String]
    let rows: [[String]]
    let alignments: [ColumnAlignment]

    func alignment(at index: Int) -> TextAlignment {
        guard alignments.indices.contains(index) else { return .leading }
        switch alignments[index] {
        case .leading:
            return .leading
        case .center:
            return .center
        case .trailing:
            return .trailing
        }
    }

    static func consume(from lines: [String], startingAt startIndex: Int) -> (table: MarkdownTable, nextIndex: Int)? {
        guard startIndex + 1 < lines.count else { return nil }
        let headerLine = lines[startIndex]
        let separatorLine = lines[startIndex + 1]
        guard isTableRow(headerLine), isSeparatorRow(separatorLine) else { return nil }

        let headers = splitRow(headerLine)
        let alignments = splitRow(separatorLine).map(parseAlignment)
        guard !headers.isEmpty, headers.count == alignments.count else { return nil }

        var rows: [[String]] = []
        var index = startIndex + 2
        while index < lines.count, isTableRow(lines[index]) {
            let row = splitRow(lines[index])
            if row.count == headers.count {
                rows.append(row)
                index += 1
            } else {
                break
            }
        }

        return (MarkdownTable(headers: headers, rows: rows, alignments: alignments), index)
    }

    private static func isTableRow(_ line: String) -> Bool {
        line.contains("|") && !line.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private static func isSeparatorRow(_ line: String) -> Bool {
        let cells = splitRow(line)
        guard !cells.isEmpty else { return false }
        return cells.allSatisfy { cell in
            let trimmed = cell.trimmingCharacters(in: .whitespaces)
            guard trimmed.contains("-") else { return false }
            return trimmed.allSatisfy { $0 == "-" || $0 == ":" }
        }
    }

    private static func splitRow(_ line: String) -> [String] {
        line
            .trimmingCharacters(in: .whitespaces)
            .trimmingCharacters(in: CharacterSet(charactersIn: "|"))
            .split(separator: "|", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
    }

    private static func parseAlignment(_ token: String) -> ColumnAlignment {
        let trimmed = token.trimmingCharacters(in: .whitespaces)
        let hasLeading = trimmed.hasPrefix(":")
        let hasTrailing = trimmed.hasSuffix(":")

        switch (hasLeading, hasTrailing) {
        case (true, true):
            return .center
        case (false, true):
            return .trailing
        default:
            return .leading
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
