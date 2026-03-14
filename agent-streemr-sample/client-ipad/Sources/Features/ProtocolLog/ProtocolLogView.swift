import SwiftUI
import AgentStreemrSwift

/// Shows a low-level log of raw protocol events received from the server.
/// Useful for debugging.
struct ProtocolLogView: View {

    @Environment(AgentStream.self) private var stream
    @State private var viewModel = ProtocolLogViewModel()

    var body: some View {
        Group {
            if viewModel.entries.isEmpty {
                ContentUnavailableView(
                    "No Events Yet",
                    systemImage: "antenna.radiowaves.left.and.right",
                    description: Text("Protocol events will appear here once connected.")
                )
            } else {
                List(viewModel.entries) { entry in
                    ProtocolLogRow(entry: entry)
                }
                .listStyle(.plain)
                .font(.system(.caption, design: .monospaced))
            }
        }
        .navigationTitle("Protocol Log")
        .task { viewModel.observe(stream: stream) }
        .toolbar {
            ToolbarItem(placement: .destructiveAction) {
                Button("Clear", role: .destructive) { viewModel.clear() }
                    .disabled(viewModel.entries.isEmpty)
            }
        }
    }
}

// MARK: - Row

private struct ProtocolLogRow: View {
    let entry: ProtocolLogEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(entry.direction.rawValue)
                    .fontWeight(.semibold)
                    .foregroundStyle(entry.direction == .incoming ? Color.green : Color.blue)
                Text(entry.eventName)
                    .fontWeight(.semibold)
                    .foregroundStyle(.accent)
                Spacer()
                Text(entry.formattedTime)
                    .foregroundStyle(.secondary)
            }
            if !entry.payload.isEmpty {
                Text(entry.payload)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }
        }
        .padding(.vertical, 2)
    }
}
