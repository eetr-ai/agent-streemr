import SwiftUI
import AgentStreemrSwift
import Observation

struct ToolApprovalCard: View {
    let approval: ToolApprovalService.PendingApproval
    @ObservedObject var service: ToolApprovalService
    @Environment(AgentStream.self) private var stream
    @State private var remember = false

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Circle()
                        .fill(Color.orange)
                        .frame(width: 12, height: 12)
                        .shadow(radius: 1)
                    Text("TOOL REQUEST")
                        .font(.caption2)
                        .foregroundStyle(Color.orange)
                        .bold()
                        .textCase(.uppercase)
                }
                Text(formatToolName(approval.toolName))
                    .font(.headline)
                ArgsList(args: approval.args)
                Toggle("Remember for this tool", isOn: $remember)
                    .font(.caption2)
                HStack(spacing: 12) {
                    Button("Allow") {
                        service.approve(id: approval.id, remember: remember, stream: stream)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                    Button("Deny") {
                        service.deny(id: approval.id, stream: stream)
                    }
                    .buttonStyle(.bordered)
                    .tint(.red)
                }
            }
            Spacer()
        }
        .padding(12)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(14)
        .shadow(radius: 2)
    }

    private func formatToolName(_ name: String) -> String {
        name.split(separator: "_").map { $0.capitalized }.joined(separator: " ")
    }
}

private struct ArgsList: View {
    let args: [String: Any]
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(args.keys.sorted(), id: \ .self) { key in
                HStack(spacing: 4) {
                    Text("\(key):")
                        .font(.caption2)
                        .foregroundStyle(.gray)
                    Text(String(describing: args[key] ?? ""))
                        .font(.caption2)
                        .foregroundStyle(.primary)
                        .lineLimit(2)
                }
            }
        }
    }
}
