import SwiftUI
import AgentStreemrSwift

/// Main chat interface. Displays the conversation history and a message input bar.
struct ChatView: View {

    @Environment(AgentStream.self) private var stream

    @State private var inputText: String = ""

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
                    }
                    .padding()
                }
                .onChange(of: stream.messages.count) { _, _ in
                    if let last = stream.messages.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
            }

            Divider()

            // Input bar
            HStack(spacing: 12) {
                TextField("Message…", text: $inputText, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...6)

                Button {
                    sendMessage()
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                }
                .disabled(!canSend)
            }
            .padding(.horizontal)
            .padding(.vertical, 10)
        }
        .navigationTitle("Chat")
        .overlay(alignment: .top) {
            StatusBanner(status: stream.status)
        }
    }

    private var canSend: Bool {
        stream.status.isConnected && !stream.isStreaming && !inputText.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        inputText = ""
        Task {
            try? await stream.sendMessage(text)
        }
    }
}

// MARK: - Message Bubble

private struct MessageBubble: View {
    let message: AgentMessage

    var body: some View {
        HStack {
            if message.role == .user { Spacer(minLength: 60) }
            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 2) {
                Text(message.content)
                    .padding(10)
                    .background(message.role == .user ? Color.accentColor : Color(.secondarySystemBackground))
                    .foregroundStyle(message.role == .user ? Color.white : Color.primary)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                if message.isStreaming {
                    ProgressView()
                        .scaleEffect(0.6)
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
