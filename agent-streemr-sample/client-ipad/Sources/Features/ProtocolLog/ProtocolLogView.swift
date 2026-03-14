import SwiftUI
import AgentStreemrSwift

/// Shows a low-level log of raw protocol events received from the server.
/// Useful for debugging.
struct ProtocolLogView: View {

    @Environment(AgentStream.self) private var stream

    // Protocol events are appended here as they arrive.
    // TODO: subscribe to a ProtocolLogStore (to be implemented).
    @State private var entries: [ProtocolLogEntry] = []

    var body: some View {
        Group {
            if entries.isEmpty {
                ContentUnavailableView(
                    "No Events Yet",
                    systemImage: "antenna.radiowaves.left.and.right",
                    description: Text("Protocol events will appear here once connected.")
                )
            } else {
                List(entries) { entry in
                    ProtocolLogRow(entry: entry)
                }
                .listStyle(.plain)
                .font(.system(.caption, design: .monospaced))
            }
        }
        .navigationTitle("Protocol Log")
        .toolbar {
            ToolbarItem(placement: .destructiveAction) {
                Button("Clear", role: .destructive) { entries.removeAll() }
                    .disabled(entries.isEmpty)
            }
        }
    }
}

// MARK: - Model

struct ProtocolLogEntry: Identifiable {
    let id = UUID()
    let timestamp: Date
    let eventName: String
    let payload: String

    var formattedTime: String {
        timestamp.formatted(.dateTime.hour().minute().second())
    }
}

// MARK: - Row

private struct ProtocolLogRow: View {
    let entry: ProtocolLogEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
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
