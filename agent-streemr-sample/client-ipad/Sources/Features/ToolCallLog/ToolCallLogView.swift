import SwiftUI

/// Displays a history of local-tool calls and their results.
/// Helps users understand what actions the agent took on their device.
struct ToolCallLogView: View {

    @Environment(ToolCallLogViewModel.self) private var viewModel
    @Environment(ToolApprovalService.self) private var toolApprovalService

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
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .destructiveAction) {
                Button("Clear", role: .destructive) { viewModel.clear() }
                    .disabled(viewModel.entries.isEmpty)
            }
        }
        .safeAreaInset(edge: .bottom) {
            if !toolApprovalService.rememberedToolsList.isEmpty {
                RememberedToolsSection(service: toolApprovalService)
            }
        }
    }
}

// MARK: - Remembered Tools (allowlist management)

private struct RememberedToolsSection: View {
    let service: ToolApprovalService

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Remembered tools")
                .font(.caption.bold())
                .foregroundStyle(.secondary)
            FlowLayout(spacing: 8) {
                ForEach(service.rememberedToolsList.sorted(), id: \.self) { toolName in
                    HStack(spacing: 4) {
                        Text(toolName)
                            .font(.caption)
                        Button {
                            service.forgetRemembered(toolName: toolName)
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color(.tertiarySystemFill), in: Capsule())
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground))
    }
}

// Simple horizontal flow for chips
private struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrange(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(proposal: proposal, subviews: subviews)
        for (index, subview) in subviews.enumerated() {
            subview.place(at: CGPoint(x: bounds.minX + result.positions[index].x, y: bounds.minY + result.positions[index].y), proposal: .unspecified)
        }
    }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth && x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }
        return (CGSize(width: maxWidth, height: y + rowHeight), positions)
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
