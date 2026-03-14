import SwiftUI

/// Root view — recipe editor as primary, with floating chat and tabs for tools/protocol.
struct ContentView: View {
    var body: some View {
        TabView {
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
        .overlay(alignment: .bottomTrailing) {
            FloatingChatWindow()
        }
    }
}

#Preview {
    ContentView()
}

// MARK: - Floating Chat Window

private struct FloatingChatWindow: View {
    @State private var isExpanded = false
    @State private var dragOffset: CGSize = .zero
    @State private var accumulatedOffset: CGSize = .zero

    private let expandedWidth: CGFloat = 460
    private let expandedHeightFraction: CGFloat = 0.82
    private let trailingMargin: CGFloat = 20

    var body: some View {
        GeometryReader { geo in
            let width = min(expandedWidth, geo.size.width - 32)
            let height = geo.size.height * expandedHeightFraction
            let halfW = width / 2
            let halfH = height / 2
            let defaultCenterX = geo.size.width - halfW - trailingMargin
            let defaultCenterY = geo.size.height / 2

            if isExpanded {
                ZStack {
                    // Dimmed backdrop — tap to collapse
                    Color.black.opacity(0.2)
                        .ignoresSafeArea()
                        .onTapGesture {
                            withAnimation(.easeInOut(duration: 0.2)) { isExpanded = false }
                        }

                    // Draggable chat card
                    VStack(spacing: 0) {
                        // Header with drag handle and close
                        HStack {
                            RoundedRectangle(cornerRadius: 2)
                                .fill(Color.secondary.opacity(0.5))
                                .frame(width: 36, height: 4)
                            Spacer()
                            Button {
                                withAnimation(.easeInOut(duration: 0.2)) { isExpanded = false }
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .font(.title2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Color(.secondarySystemBackground))

                        ChatView()
                    }
                    .frame(width: width, height: height)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .shadow(color: .black.opacity(0.2), radius: 20, x: 0, y: 10)
                    .position(
                        x: defaultCenterX + accumulatedOffset.width + dragOffset.width,
                        y: defaultCenterY + accumulatedOffset.height + dragOffset.height
                    )
                    .gesture(
                        DragGesture()
                            .onChanged { value in
                                dragOffset = value.translation
                            }
                            .onEnded { value in
                                accumulatedOffset.width += value.translation.width
                                accumulatedOffset.height += value.translation.height
                                // Clamp so window stays on screen
                                accumulatedOffset.width = min(max(accumulatedOffset.width, halfW - defaultCenterX), geo.size.width - defaultCenterX - halfW)
                                accumulatedOffset.height = min(max(accumulatedOffset.height, halfH - defaultCenterY), geo.size.height - defaultCenterY - halfH)
                                dragOffset = .zero
                            }
                    )
                }
            } else {
                // Collapsed: floating chat button
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { isExpanded = true }
                } label: {
                    Label("Chat", systemImage: "bubble.left.and.bubble.right.fill")
                        .font(.headline)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .background(.regularMaterial, in: Capsule())
                        .shadow(color: .black.opacity(0.15), radius: 8, x: 0, y: 4)
                }
                .buttonStyle(.plain)
                .padding(20)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
            }
        }
        .allowsHitTesting(true)
    }
}

private struct RecipeTabView: View {
    @Environment(SelectedRecipeState.self) private var selectedRecipeState
    @Environment(RecipeEditorViewModel.self) private var recipeEditorViewModel
    @Environment(\.recipeService) private var recipeService

    var body: some View {
        NavigationSplitView {
            RecipeListView(selection: Binding(
                get: { selectedRecipeState.selectedRecipeId },
                set: { selectedRecipeState.selectedRecipeId = $0 }
            ))
        } detail: {
            if recipeEditorViewModel.hasOpenRecipe {
                NavigationStack {
                    RecipeEditorView()
                }
            } else {
                ContentUnavailableView(
                    "Select a Recipe",
                    systemImage: "fork.knife",
                    description: Text("Choose a recipe from the list to view or edit it.")
                )
            }
        }
        .onAppear {
            recipeEditorViewModel.syncSelection(id: selectedRecipeState.selectedRecipeId, using: recipeService)
        }
        .onChange(of: selectedRecipeState.selectedRecipeId) { _, newId in
            recipeEditorViewModel.syncSelection(id: newId, using: recipeService)
        }
    }
}
