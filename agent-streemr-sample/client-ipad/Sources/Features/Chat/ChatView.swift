import SwiftUI
import PhotosUI
import AgentStreemrSwift

/// Main chat interface. Displays the conversation history and a message input bar.
struct ChatView: View {

    @Environment(AgentStream.self) private var stream
    @Environment(ChatViewModel.self) private var viewModel
    @Environment(RecipeEditorViewModel.self) private var recipeEditorViewModel
    @Environment(ToolApprovalService.self) private var toolApprovalService
    @Environment(\.photoStagingService) private var photoStagingService
    @Environment(\.attachmentReferenceStore) private var attachmentReferenceStore
    @State private var selectedPhotoItem: PhotosPickerItem?

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(stream.messages) { message in
                            MessageBubble(
                                message: message,
                                attachmentPreviewData: viewModel.attachmentPreviewData(for: message),
                                timestamp: viewModel.timestamp(for: message)
                            )
                                .id(message.id)
                                .transition(.asymmetric(
                                    insertion: .move(edge: .bottom).combined(with: .opacity).combined(with: .scale(scale: 0.96)),
                                    removal: .opacity
                                ))
                        }

                        if !stream.internalThought.isEmpty {
                            ThinkingPanel(thought: stream.internalThought)
                        }

                        if (stream.isWorking || stream.isStreaming) && stream.internalThought.isEmpty {
                            TypingIndicator()
                        }

                        ForEach(toolApprovalService.pendingApprovals) { approval in
                            ToolApprovalCard(approval: approval, service: toolApprovalService)
                                .id(approval.id)
                        }
                    }
                    .padding()
                    .animation(.spring(response: 0.34, dampingFraction: 0.82), value: stream.messages.count)
                }
                .onChange(of: stream.messages.count) { _, _ in
                    if let last = stream.messages.last {
                        withAnimation {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                }
                .onChange(of: toolApprovalService.pendingApprovals.count) { _, _ in
                    if let last = toolApprovalService.pendingApprovals.last {
                        withAnimation {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                }
            }

            Divider()

            VStack(alignment: .leading, spacing: 10) {
                if let attachment = viewModel.pendingAttachment {
                    PendingAttachmentRow(
                        attachment: attachment,
                        remove: { viewModel.pendingAttachment = nil }
                    )
                }

                HStack(spacing: 12) {
                    PhotosPicker(
                        selection: $selectedPhotoItem,
                        matching: .images,
                        photoLibrary: .shared()
                    ) {
                        Image(systemName: "photo.on.rectangle")
                            .font(.title3)
                    }
                    .buttonStyle(.bordered)
                    .help("Attach a photo")

                    TextField("Message…", text: Binding(
                        get: { viewModel.inputText },
                        set: { viewModel.inputText = $0 }
                    ), axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .lineLimit(1 ... 6)
                        .submitLabel(.send)
                        .onSubmit {
                            sendCurrentMessage()
                        }

                    Button {
                        sendCurrentMessage()
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.title2)
                    }
                    .buttonStyle(.plain)
                    .disabled(!viewModel.canSend(stream: stream))
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 10)
        }
        .navigationTitle("Chat")
        .overlay(alignment: .top) {
            StatusBanner(status: stream.status, inactiveCloseReason: stream.inactiveCloseReason)
        }
        .onChange(of: selectedPhotoItem) { _, newValue in
            guard let newValue else { return }
            Task {
                await loadAttachment(from: newValue)
            }
        }
    }

    private func loadAttachment(from item: PhotosPickerItem) async {
        defer { selectedPhotoItem = nil }
        guard let data = try? await item.loadTransferable(type: Data.self) else { return }
        let mimeType = item.supportedContentTypes.first?.preferredMIMEType ?? "image/jpeg"
        let ext = item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
        let name = item.itemIdentifier ?? "photo.\(ext)"
        photoStagingService.rememberLastAttachedPhoto(assetIdentifier: item.itemIdentifier)
        viewModel.pendingAttachment = ChatViewModel.PendingAttachment(
            data: data,
            mimeType: mimeType,
            name: name,
            assetIdentifier: item.itemIdentifier
        )
    }

    private func sendCurrentMessage() {
        guard viewModel.canSend(stream: stream) else { return }

        if let attachment = viewModel.pendingAttachment {
            attachmentReferenceStore.prepareOutgoingAttachments(
                assetIdentifiers: [attachment.assetIdentifier]
            )
            photoStagingService.stage(
                data: attachment.data,
                mimeType: attachment.mimeType,
                assetIdentifier: attachment.assetIdentifier
            )
        }

        viewModel.send(using: stream, context: currentChatContext)
    }

    private var currentChatContext: [String: Any]? {
        guard let recipe = recipeEditorViewModel.recipe else { return nil }
        return [
            "surface": "recipe_editor",
            "recipe": [
                "id": recipe.id,
                "name": recipe.name,
                "isNew": recipeEditorViewModel.isNewRecipe,
                "isUnsaved": recipeEditorViewModel.isNewRecipe,
                "isSaved": !recipeEditorViewModel.isNewRecipe
            ]
        ]
    }
}

private struct MessageBubble: View {
    let message: AgentMessage
    let attachmentPreviewData: Data?
    let timestamp: Date?

    var body: some View {
        HStack {
            if message.role == .user {
                Spacer(minLength: 60)
            }

            VStack(alignment: .leading, spacing: 8) {
                if let attachmentPreviewData,
                   let image = UIImage(data: attachmentPreviewData) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: 220, maxHeight: 220)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }

                if !message.content.isEmpty || message.isStreaming {
                    MarkdownMessageText(
                        markdown: message.content.isEmpty && message.isStreaming ? "…" : message.content
                    )
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                if let timestamp {
                    Text(timestamp, format: .dateTime.hour().minute())
                        .font(.caption2)
                        .foregroundStyle(timestampForegroundColor)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }
            .padding(10)
            .background(backgroundColor, in: RoundedRectangle(cornerRadius: 14))
            .foregroundStyle(foregroundColor)

            if message.role == .assistant {
                Spacer(minLength: 60)
            }
        }
    }

    private var backgroundColor: Color {
        message.role == .user ? .accentColor : Color(.secondarySystemBackground)
    }

    private var foregroundColor: Color {
        message.role == .user ? .white : .primary
    }

    private var timestampForegroundColor: Color {
        message.role == .user ? .white.opacity(0.72) : .secondary
    }
}

private struct MarkdownMessageText: View {
    let markdown: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(ChatMarkdownBlock.parse(markdown: markdown)) { block in
                switch block.content {
                case .markdown(let text):
                    ChatMarkdownTextBlock(markdown: text)
                case .table(let table):
                    ChatMarkdownTableView(table: table)
                }
            }
        }
    }
}

private struct ChatMarkdownTextBlock: View {
    let markdown: String

    var body: some View {
        if let attributed = try? AttributedString(
            markdown: markdown,
            options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .full)
        ) {
            Text(attributed)
        } else {
            Text(markdown)
        }
    }
}

private struct ChatMarkdownTableView: View {
    let table: ChatMarkdownTable

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
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Color(.separator), lineWidth: 1)
            )
        }
    }

    private func tableCell(_ text: String, isHeader: Bool, alignment: TextAlignment) -> some View {
        let backgroundColor = isHeader ? Color.accentColor.opacity(0.12) : Color.clear
        return Text(text)
            .font(isHeader ? .caption.weight(.semibold) : .caption)
            .multilineTextAlignment(alignment)
            .frame(minWidth: 96, maxWidth: .infinity, alignment: frameAlignment(for: alignment))
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
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

private struct ChatMarkdownBlock: Identifiable {
    enum Content {
        case markdown(String)
        case table(ChatMarkdownTable)
    }

    let id = UUID()
    let content: Content

    static func parse(markdown: String) -> [ChatMarkdownBlock] {
        let lines = markdown.components(separatedBy: .newlines)
        var blocks: [ChatMarkdownBlock] = []
        var currentMarkdown: [String] = []
        var index = 0

        func flushMarkdown() {
            let text = currentMarkdown.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty {
                blocks.append(ChatMarkdownBlock(content: .markdown(text)))
            }
            currentMarkdown.removeAll()
        }

        while index < lines.count {
            if let table = ChatMarkdownTable.consume(from: lines, startingAt: index) {
                flushMarkdown()
                blocks.append(ChatMarkdownBlock(content: .table(table.table)))
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

private struct ChatMarkdownTable {
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

    static func consume(from lines: [String], startingAt startIndex: Int) -> (table: ChatMarkdownTable, nextIndex: Int)? {
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

        return (ChatMarkdownTable(headers: headers, rows: rows, alignments: alignments), index)
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

private struct PendingAttachmentRow: View {
    let attachment: ChatViewModel.PendingAttachment
    let remove: () -> Void

    var body: some View {
        HStack {
            Text(attachment.name)
                .font(.caption)
                .lineLimit(1)
                .truncationMode(.middle)

            Spacer()

            Button("Remove", action: remove)
                .buttonStyle(.bordered)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct ThinkingPanel: View {
    let thought: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Thinking")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            Text(thought)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .lineLimit(6)
        }
        .padding(10)
        .background(Color(.systemGray6), in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct TypingIndicator: View {
    var body: some View {
        TimelineView(.animation) { context in
            let time = context.date.timeIntervalSinceReferenceDate

            HStack(spacing: 6) {
                ForEach(0 ..< 3, id: \.self) { index in
                    let phase = (time * 2.2) - (Double(index) * 0.22)
                    let wave = (sin(phase * .pi) + 1) / 2

                    Circle()
                        .fill(Color.secondary)
                        .frame(width: 8, height: 8)
                        .scaleEffect(0.58 + (wave * 0.42))
                        .opacity(0.3 + (wave * 0.7))
                        .offset(y: -wave * 3)
                        .transaction { transaction in
                            transaction.animation = .linear(duration: 0.12)
                        }
                }
            }
            .padding(10)
            .background(Color(.systemGray6), in: RoundedRectangle(cornerRadius: 10))
        }
    }
}

private struct ToolApprovalCard: View {
    let approval: PendingToolApproval
    let service: ToolApprovalService

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(approval.toolName)
                .font(.headline)

            if !approval.argumentsSummary.isEmpty {
                Text(approval.argumentsSummary)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }

            HStack {
                Button("Deny") {
                    service.deny(approval)
                }
                .buttonStyle(.bordered)

                Button("Allow") {
                    service.approve(approval)
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(12)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
    }
}

private struct StatusBanner: View {
    let status: ConnectionStatus
    let inactiveCloseReason: String?

    @ViewBuilder
    var body: some View {
        switch status {
        case .connecting:
            banner("Connecting…", color: .orange)
        case .error(let message):
            banner("Error: \(message)", color: .red)
        case .disconnected:
            if let inactiveCloseReason, !inactiveCloseReason.isEmpty {
                banner("Disconnected: \(inactiveCloseReason)", color: .gray)
            } else {
                banner("Disconnected", color: .gray)
            }
        case .connected:
            EmptyView()
        }
    }

    private func banner(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(color.opacity(0.9), in: Capsule())
            .padding(.top, 8)
    }
}
