import SwiftUI
import AgentStreemrSwift

/// Root view — recipe editor as primary, with floating chat and tabs for tools/protocol.
struct ContentView: View {
    var body: some View {
        TabView {
            Tab("Recipes", systemImage: "fork.knife") {
                RecipeTabView()
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
    @Environment(AgentStream.self) private var stream
    @Environment(ChatViewModel.self) private var chatViewModel
    @Environment(ToolApprovalService.self) private var toolApprovalService
    @State private var isExpanded = false
    @State private var showingToolCalls = false
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
                            VStack(alignment: .leading, spacing: 4) {
                                RoundedRectangle(cornerRadius: 2)
                                    .fill(Color.secondary.opacity(0.5))
                                    .frame(width: 36, height: 4)
                                ConnectionBadge(
                                    status: stream.status,
                                    inactiveCloseReason: stream.inactiveCloseReason
                                )
                            }
                            Spacer()
                            Button {
                                withAnimation(.easeInOut(duration: 0.22)) {
                                    showingToolCalls.toggle()
                                }
                            } label: {
                                Image(systemName: showingToolCalls ? "bubble.left.and.bubble.right" : "wrench.and.screwdriver")
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .help(showingToolCalls ? "Show chat" : "Show tool calls")

                            if shouldShowReconnect {
                                Button("Reconnect") {
                                    chatViewModel.reconnect(stream: stream)
                                }
                                .buttonStyle(.borderedProminent)
                                .controlSize(.small)
                            } else if stream.status.isConnected {
                                Button("Disconnect") {
                                    chatViewModel.disconnect(stream: stream)
                                }
                                .buttonStyle(.bordered)
                                .controlSize(.small)

                                Button {
                                    stream.clearContext()
                                } label: {
                                    Image(systemName: "trash")
                                }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                                .help("Clear chat")
                            }
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

                        ZStack {
                            if showingToolCalls {
                                NavigationStack {
                                    ToolCallLogView()
                                }
                                .transition(.move(edge: .trailing).combined(with: .opacity))
                            } else {
                                ChatView()
                                    .transition(.move(edge: .leading).combined(with: .opacity))
                            }
                        }
                        .clipped()
                    }
                    .frame(width: width, height: height)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .shadow(color: .black.opacity(0.2), radius: 20, x: 0, y: 10)
                    .transition(.scale(scale: 0.92).combined(with: .opacity))
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
                    HStack(spacing: 10) {
                        Image(systemName: "bubble.left.and.bubble.right.fill")
                            .font(.headline)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Chat")
                                .font(.headline)
                            ConnectionBadge(
                                status: stream.status,
                                inactiveCloseReason: stream.inactiveCloseReason,
                                style: .compact
                            )
                        }
                        if toolApprovalService.pendingApprovals.isEmpty == false {
                            Text("\(toolApprovalService.pendingApprovals.count)")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.white)
                                .padding(6)
                                .background(Color.accentColor, in: Circle())
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(.regularMaterial, in: Capsule())
                    .shadow(color: .black.opacity(0.15), radius: 8, x: 0, y: 4)
                }
                .transition(.move(edge: .trailing).combined(with: .opacity))
                .buttonStyle(.plain)
                .padding(20)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
            }
        }
        .allowsHitTesting(true)
        .animation(.spring(response: 0.32, dampingFraction: 0.84), value: isExpanded)
        .animation(.easeInOut(duration: 0.22), value: showingToolCalls)
        .task {
            chatViewModel.start(using: stream)
            toolApprovalService.observe(stream: stream)
        }
    }

    private var shouldShowReconnect: Bool {
        switch stream.status {
        case .disconnected, .error:
            return true
        case .connecting, .connected:
            return false
        }
    }
}

private struct ConnectionBadge: View {
    enum Style {
        case full
        case compact
    }

    let status: ConnectionStatus
    let inactiveCloseReason: String?
    var style: Style = .full

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(statusColor)
                .frame(width: 8, height: 8)
            Text(statusText)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }

    private var statusColor: Color {
        switch status {
        case .connected:
            return .green
        case .connecting:
            return .orange
        case .disconnected:
            if let inactiveCloseReason, !inactiveCloseReason.isEmpty {
                return .yellow
            }
            return .gray
        case .error:
            return .red
        }
    }

    private var statusText: String {
        if style == .compact {
            switch status {
            case .connected:
                return "Connected"
            case .connecting:
                return "Connecting"
            case .error:
                return "Disconnected"
            case .disconnected:
                if let inactiveCloseReason, !inactiveCloseReason.isEmpty {
                    return "Inactive"
                }
                return "Disconnected"
            }
        }

        switch status {
        case .connected:
            return "Connected"
        case .connecting:
            return "Connecting"
        case .error(let message):
            return message
        case .disconnected:
            if let inactiveCloseReason, !inactiveCloseReason.isEmpty {
                return "Disconnected: \(inactiveCloseReason)"
            }
            return "Disconnected"
        }
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
            ), createRecipe: createRecipe)
        } detail: {
            if recipeEditorViewModel.hasOpenRecipe {
                NavigationStack {
                    RecipeEditorView()
                }
            } else {
                VStack(spacing: 18) {
                    ContentUnavailableView(
                        "Select a Recipe",
                        systemImage: "fork.knife",
                        description: Text("Choose a recipe from the list to view or edit it.")
                    )

                    Button("New Recipe", action: createRecipe)
                        .buttonStyle(.borderedProminent)
                }
            }
        }
        .onAppear {
            recipeEditorViewModel.syncSelection(id: selectedRecipeState.selectedRecipeId, using: recipeService)
        }
        .onChange(of: selectedRecipeState.selectedRecipeId) { _, newId in
            recipeEditorViewModel.syncSelection(id: newId, using: recipeService)
        }
    }

    private func createRecipe() {
        _ = recipeEditorViewModel.startNewRecipe()
        selectedRecipeState.selectedRecipeId = nil
    }
}
