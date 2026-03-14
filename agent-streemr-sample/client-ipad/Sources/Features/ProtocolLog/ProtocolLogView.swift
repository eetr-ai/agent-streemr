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
                        .onTapGesture { viewModel.toggle(id: entry.id) }
                        .listRowInsets(EdgeInsets(top: 4, leading: 12, bottom: 4, trailing: 12))
                }
                .listStyle(.plain)
                .font(.system(.caption, design: .monospaced))
            }
        }
        .navigationTitle("Protocol Log")
        .task { viewModel.observe(stream: stream) }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Text("\(viewModel.totalEventCount) events")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
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

    private var isIncoming: Bool { entry.direction == .incoming }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            // Header line
            HStack(spacing: 6) {
                Text(entry.direction.rawValue)
                    .fontWeight(.bold)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(isIncoming ? Color.green : Color.blue)

                Text(entry.eventName)
                    .fontWeight(.semibold)
                    .foregroundStyle(entry.accentColor)

                Text(entry.label)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)

                Spacer(minLength: 0)

                if entry.count > 1 {
                    Text("×\(entry.count)")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.secondary.opacity(0.25), in: Capsule())
                        .foregroundStyle(.secondary)
                }

                Text(entry.formattedTime)
                    .foregroundStyle(.secondary)
                    .font(.system(.caption2, design: .monospaced))

                Image(systemName: entry.isExpanded ? "chevron.down" : "chevron.right")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            // Collapsed: summary line
            if !entry.isExpanded {
                Text(summarise(eventName: entry.eventName, payloadJSON: entry.latestPayload))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
            } else {
                // Expanded: all merged payloads
                ScrollView {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array(entry.payloads.enumerated()), id: \.offset) { idx, payload in
                            VStack(alignment: .leading, spacing: 2) {
                                if entry.count > 1 {
                                    Text("#\(idx + 1)")
                                        .font(.system(size: 10, weight: .regular, design: .monospaced))
                                        .foregroundStyle(.tertiary)
                                }
                                Text(payload.isEmpty ? "—" : payload)
                                    .font(.system(.caption2, design: .monospaced))
                                    .foregroundStyle(.primary)
                                    .textSelection(.enabled)
                            }
                            if idx < entry.payloads.count - 1 {
                                Divider()
                            }
                        }
                    }
                    .padding(8)
                }
                .frame(maxHeight: 200)
                .background(Color.gray.opacity(0.12), in: RoundedRectangle(cornerRadius: 6))
            }
        }
        .padding(.vertical, 4)
    }
}
