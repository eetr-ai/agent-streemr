import SwiftUI

/// Displays a history of local-tool calls and their results.
/// Helps users understand what actions the agent took on their device.
struct ToolCallLogView: View {

    @State private var viewModel = ToolCallLogViewModel()

    var body: some View {
        Group {
            if viewModel.entries.isEmpty {
                ContentUnavailableView(
                    "No Tool Calls Yet",
                    systemImage: "wrench.and.screwdriver",
                    description: Text("Local tool calls will appear here as the agent uses them.")
                )
            } else {
                List(viewModel.entries) { entry in
                    ToolCallRow(entry: entry)
                }
                .listStyle(.insetGrouped)
            }
        }
        .navigationTitle("Tool Calls")
        .toolbar {
            ToolbarItem(placement: .destructiveAction) {
                Button("Clear", role: .destructive) { viewModel.clear() }
                    .disabled(viewModel.entries.isEmpty)
            }
        }
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
