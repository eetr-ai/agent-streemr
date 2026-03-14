import SwiftUI
import AgentStreemrSwift

@main
struct AgentStreemrApp: App {

    @State private var recipeService = RecipeService(
        repository: SwiftDataRecipeRepository()
    )

    /// Placeholder configuration — replace URL and token before connecting.
    @State private var stream = AgentStream(
        configuration: AgentStreamConfiguration(
            url: URL(string: "http://localhost:3000")!,
            token: ""
        )
    )

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(\.recipeService, recipeService)
                .environment(stream)
        }
    }
}
