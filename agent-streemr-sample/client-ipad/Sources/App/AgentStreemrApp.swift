import SwiftUI

@main
struct AgentStreemrApp: App {

    @State private var recipeService = RecipeService(
        repository: SwiftDataRecipeRepository()
    )

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(\.recipeService, recipeService)
        }
    }
}
