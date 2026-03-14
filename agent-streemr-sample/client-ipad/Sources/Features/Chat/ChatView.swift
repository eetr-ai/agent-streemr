import SwiftUI
import AgentStreemrSwift

/// Main chat interface. Displays the conversation history and a message input bar.
struct ChatView: View {

    @Environment(AgentStream.self) private var stream
    @Environment(ToolApprovalService.self) private var toolApprovalService
    @Environment(\.photoStagingService) private var photoStagingService
    @State private var viewModel = ChatViewModel()

    var body: some View {
        VStack(spacing: 0) {
            // Message list
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(stream.messages) { message in
                            MessageBubble(message: message)
                                .id(message.id)
                        }
                        ForEach(toolApprovalService.pendingApprovals) { approval in
                            ToolApprovalCard(approval: approval, service: toolApprovalService)
                                .id(approval.id)
                        }
                        // ...ThinkingPanel, typing indicator, attachment preview, etc. to be added...
                    }
                    .padding()
                }
                .onChange(of: stream.messages.count) { _, _ in
                    if let last = stream.messages.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                                                ThinkingPanel(thought: stream.internalThought)
                                                if (stream.isWorking || stream.isStreaming) && stream.internalThought.isEmpty {
                                                    TypingIndicator()
                                                }
                    }
                }
            }

            Divider()

            // Input bar
            HStack(spacing: 12) {
                TextField("Message…", text: $viewModel.inputText, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...6)

                                    // Attachment preview
                                    if let att = viewModel.pendingAttachment {
                                        HStack(spacing: 12) {
                                            if let uiImage = UIImage(data: att.data) {
                                                Image(uiImage: uiImage)
                                                    .resizable()
                                                    .frame(width: 48, height: 48)
                                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                                                    .border(Color.gray, width: 1)
                                            }
                                            Text(att.name)
                                                .font(.caption)
                                                .lineLimit(1)
                                                .truncationMode(.middle)
                                            Button("Remove") {
                                                viewModel.pendingAttachment = nil
                                            }
                                            .buttonStyle(.bordered)
                                            .tint(.red)
                                        }
                                        .padding(.horizontal)
                                        .padding(.vertical, 6)
                                        .background(Color(.secondarySystemBackground))
                                    }
                Button {
                    // Stage the attachment so recipe_set_photo can consume it.
                    if let att = viewModel.pendingAttachment {
                        photoStagingService.stage(data: att.data, mimeType: att.mimeType)
                    }
                    viewModel.send(using: stream)
                } label: {
                                        PhotosPicker(selection: Binding(
                                            get: { nil },
                                            set: { item in
                                                if let item = item {
                                                    Task { await viewModel.stagePhoto(item: item) }
                                                }
                                            }
                                        ), matching: .images) {
                                            Image(systemName: "paperclip")
                                                .font(.title3)
                                                .padding(6)
                                                .background(Color(.secondarySystemBackground))
                                                .clipShape(Circle())
                                        }
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                }
                .disabled(!viewModel.canSend(stream: stream))
            }
            .padding(.horizontal)
            .padding(.vertical, 10)
        }
        .navigationTitle("Chat")
        .task {
            viewModel.connect(to: stream)
            toolApprovalService.observe(stream: stream)
        }
        .overlay(alignment: .top) {
            StatusBanner(status: stream.status)
        }
    }
}

// MARK: - Message Bubble

private struct MessageBubble: View {
    let message: AgentMessage
    @State private var cursorOpacity: Double = 1.0

                        // MARK: - Thinking Panel
                        private struct ThinkingPanel: View {
                            let thought: String
                            var body: some View {
                                if thought.isEmpty { EmptyView() }
                                else {
                                    HStack(alignment: .top, spacing: 10) {
                                        Image(systemName: "brain.head.profile")
                                            .font(.title2)
                                            .foregroundStyle(Color.purple)
                                            .rotationEffect(.degrees(10))
                                            .animation(.easeInOut(duration: 1).repeatForever(), value: thought)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text("THINKING")
                                                .font(.caption2)
                                                .foregroundStyle(Color.purple)
                                                .bold()
                                                .textCase(.uppercase)
                                            ScrollView(.vertical) {
                                                Text(thought.suffix(300))
                                                    .font(.system(.caption, design: .monospaced))
                                                    .lineLimit(6)
                                                    .padding(4)
                                            }
                                        }
                                    }
                                    .padding(10)
                                    .background(Color(.systemGray6))
                                    .cornerRadius(12)
                                    .shadow(radius: 1)
                                }
                            }
                        }

                        // MARK: - Typing Indicator
                        private struct TypingIndicator: View {
                            var body: some View {
                                HStack(spacing: 4) {
                                    ForEach(0..<3) { i in
                                        Circle()
                                            .fill(Color.gray)
                                            .frame(width: 8, height: 8)
                                            .opacity(Double(i + 1) / 3.0)
                                            .animation(.easeInOut(duration: 0.6).repeatForever(), value: i)
                                    }
                                }
                                .padding(10)
                                .background(Color(.systemGray5))
                                .cornerRadius(10)
                            }
                        }

    var body: some View {
        HStack {
            if message.role == .user { Spacer(minLength: 60) }
            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 2) {
                if message.role == .user {
                    Text(message.content)
                        .padding(10)
                        .background(Color.accentColor)
                        .foregroundStyle(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                } else {
                    Group {
                        if message.content.isEmpty && message.isStreaming {
                            HStack(spacing: 4) {
                                ForEach(0..<3) { i in
                                    Circle()
                                        .fill(Color.gray)
                                        .frame(width: 8, height: 8)
                                        .opacity(Double(i + 1) / 3.0)
                                        .animation(.easeInOut(duration: 0.6).repeatForever(), value: message.isStreaming)
                                }
                            }
                        } else {
                            VStack(alignment: .leading, spacing: 0) {
                                MarkdownUI.Markdown(message.content)
                                    .padding(10)
                                    .background(Color(.secondarySystemBackground))
                                    .clipShape(RoundedRectangle(cornerRadius: 14))
                                if message.isStreaming && !message.content.isEmpty {
                                    Text("|")
                                        .foregroundStyle(Color.blue)
                                        .opacity(cursorOpacity)
                                        .onAppear {
                                            withAnimation(.easeInOut(duration: 0.5).repeatForever()) {
                                                cursorOpacity = 0.0
                                            }
                                        }
                                }
                            }
                        }
                    }
                }
            }
            if message.role == .assistant { Spacer(minLength: 60) }
        }
    }
}

// MARK: - Status Banner

private struct StatusBanner: View {
    let status: ConnectionStatus

    @ViewBuilder
    var body: some View {
        switch status {
        case .connecting:
            banner("Connecting…", color: .orange)
        case .error(let msg):
            banner("Error: \(msg)", color: .red)
        case .disconnected:
            banner("Disconnected", color: .gray)
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
            .background(color.opacity(0.9))
            .clipShape(Capsule())
            .padding(.top, 8)
    }
}
