import SwiftUI
import Observation
import AgentStreemrSwift

@main
struct AgentStreemrApp: App {

    @State private var recipeService = RecipeService(
        repository: SwiftDataRecipeRepository()
    )

    /// Server URL and token. For Simulator use http://localhost:PORT.
    /// For a physical iPad use your Mac's IP (e.g. http://192.168.1.x:3000).
    /// If the server requires auth, set a non-empty token.
    @State private var stream = AgentStream(
        configuration: AgentStreamConfiguration(
            url: URL(string: "http://localhost:8080")!,
            token: ""
        )
    )

    @State private var toolApprovalService = ToolApprovalService()
    @State private var photoStagingService = PhotoStagingService()
    @State private var selectedRecipeState = SelectedRecipeState()
    @State private var recipeEditorViewModel = RecipeEditorViewModel()
    @State private var toolCallLogViewModel = ToolCallLogViewModel()
    @State private var protocolLogViewModel = ProtocolLogViewModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(\.recipeService, recipeService)
                .environment(stream)
                .environment(toolApprovalService)
                .environment(\.photoStagingService, photoStagingService)
                .environment(selectedRecipeState)
                .environment(recipeEditorViewModel)
                .environment(toolCallLogViewModel)
                .environment(protocolLogViewModel)
                .task {
                    protocolLogViewModel.observe(stream: stream)
                    await registerRecipeListTools(
                        on: stream,
                        recipeService: recipeService,
                        selectedRecipeState: selectedRecipeState,
                        recipeEditorViewModel: recipeEditorViewModel,
                        toolCallLog: toolCallLogViewModel
                    )
                    await registerRecipeEditorTools(
                        on: stream,
                        recipeService: recipeService,
                        photoStaging: photoStagingService,
                        selectedRecipeState: selectedRecipeState,
                        recipeEditorViewModel: recipeEditorViewModel,
                        toolCallLog: toolCallLogViewModel
                    )
                }
        }
    }
}

@Observable
@MainActor
final class ToolApprovalService {
    var pendingApprovals: [PendingToolApproval] = []
    var rememberedToolsList: [String] = []

    private var stream: AgentStream?
    private var observationTask: Task<Void, Never>?

    func observe(stream: AgentStream) {
        guard observationTask == nil else { return }
        self.stream = stream
        observationTask = Task { @MainActor [weak self] in
            guard let self else { return }
            for await payload in stream.localToolPublisher.values {
                self.pendingApprovals.append(
                    PendingToolApproval(
                        id: payload.requestId,
                        requestId: payload.requestId,
                        toolName: payload.toolName,
                        argumentsSummary: Self.stringify(payload.argsJson)
                    )
                )
            }
        }
    }

    func approve(_ approval: PendingToolApproval) {
        if !rememberedToolsList.contains(approval.toolName) {
            rememberedToolsList.append(approval.toolName)
        }
        stream?.respondToLocalTool(
            requestId: approval.requestId,
            toolName: approval.toolName,
            approved: true
        )
        remove(approval)
    }

    func deny(_ approval: PendingToolApproval) {
        stream?.respondToLocalTool(
            requestId: approval.requestId,
            toolName: approval.toolName,
            approved: false
        )
        remove(approval)
    }

    private func remove(_ approval: PendingToolApproval) {
        pendingApprovals.removeAll { $0.id == approval.id }
    }

    func forgetRemembered(toolName: String) {
        rememberedToolsList.removeAll { $0 == toolName }
    }

    private static func stringify(_ dictionary: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: dictionary, options: [.prettyPrinted, .sortedKeys]),
              let string = String(data: data, encoding: .utf8) else {
            return ""
        }
        return string
    }
}

struct PendingToolApproval: Identifiable {
    let id: String
    let requestId: String
    let toolName: String
    let argumentsSummary: String
}

final class PhotoStagingService {
    private var stagedPhoto: StagedPhoto?

    func stage(data: Data, mimeType: String) {
        stagedPhoto = StagedPhoto(data: data, mimeType: mimeType)
    }

    func consume() -> StagedPhoto? {
        let photo = stagedPhoto
        stagedPhoto = nil
        return photo
    }
}

struct StagedPhoto {
    let data: Data
    let mimeType: String
}

private struct PhotoStagingServiceKey: EnvironmentKey {
    static let defaultValue = PhotoStagingService()
}

extension EnvironmentValues {
    var photoStagingService: PhotoStagingService {
        get { self[PhotoStagingServiceKey.self] }
        set { self[PhotoStagingServiceKey.self] = newValue }
    }
}

@Observable
@MainActor
final class SelectedRecipeState {
    var selectedRecipeId: String?
}
