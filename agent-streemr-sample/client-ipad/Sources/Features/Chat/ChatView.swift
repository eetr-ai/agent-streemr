import SwiftUI
import PhotosUI
import AgentStreemrSwift

/// Main chat interface. Displays the conversation history and a message input bar.
struct ChatView: View {

    @Environment(AgentStream.self) private var stream
    @Environment(ChatViewModel.self) private var viewModel
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

                    Button {
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
                        viewModel.send(using: stream)
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
                    Text(message.content.isEmpty && message.isStreaming ? "…" : message.content)
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
    @State private var isAnimating = false

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0 ..< 3, id: \.self) { index in
                Circle()
                    .fill(Color.secondary)
                    .frame(width: 8, height: 8)
                    .scaleEffect(isAnimating ? 1 : 0.55)
                    .opacity(isAnimating ? 1 : 0.35)
                    .animation(
                        .easeInOut(duration: 0.55)
                            .repeatForever()
                            .delay(Double(index) * 0.14),
                        value: isAnimating
                    )
            }
        }
        .padding(10)
        .background(Color(.systemGray6), in: RoundedRectangle(cornerRadius: 10))
        .onAppear { isAnimating = true }
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
