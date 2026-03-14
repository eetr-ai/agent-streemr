import SwiftUI

/// Displays a history of local-tool calls and their results.
/// Helps users understand what actions the agent took on their device.
struct ToolCallLogView: View {

    // TODO: subscribe to a ToolCallLogStore (to be implemented).
    @State private var entries: [ToolCallEntry] = []

    var body: some View {
        Group {
            if entries.isEmpty {
                ContentUnavailableView(
                    "No Tool Calls Yet",
                    systemImage: "wrench.and.screwdriver",
                    description: Text("Local tool calls will appear here as the agent uses them.")
                )
            } else {
                List(entries) { entry in
                    ToolCallRow(entry: entry)
                }
                .listStyle(.insetGrouped)
            }
        }
        .navigationTitle("Tool Calls")
        .toolbar {
            ToolbarItem(placement: .destructiveAction) {
                Button("Clear", role: .destructive) { entries.removeAll() }
                    .disabled(entries.isEmpty)
            }
        }
    }
}

// MARK: - Model

enum ToolCallStatus {
    case pending
    case success
    case failure(String)

    var label: String {
        switch self {
        case .pending:  return "Pending"
        case .success:  return "Success"
        case .failure:  return "Failed"
        }
    }

    var color: Color {
        switch self {
        case .pending:  return .orange
        case .success:  return .green
        case .failure:  return .red
        }
    }
}

struct ToolCallEntry: Identifiable {
    let id: String          // request_id
    let toolName: String
    let arguments: String   // JSON string
    var status: ToolCallStatus
    let startedAt: Date
    var endedAt: Date?

    var duration: String? {
        guard let end = endedAt else { return nil }
        let ms = Int(end.timeIntervalSince(startedAt) * 1000)
        return "\(ms) ms"
    }
}

// MARK: - Row

private struct ToolCallRow: View {
    let entry: ToolCallEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(entry.toolName)
                    .font(.headline)
                Spacer()
                Label(entry.status.label, systemImage: statusIcon)
                    .font(.caption)
                    .foregroundStyle(entry.status.color)
            }
            Text(entry.arguments)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            if let duration = entry.duration {
                Text(duration)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 2)
    }

    private var statusIcon: String {
        switch entry.status {
        case .pending:          return "clock"
        case .success:          return "checkmark.circle"
        case .failure:          return "xmark.circle"
        }
    }
}
