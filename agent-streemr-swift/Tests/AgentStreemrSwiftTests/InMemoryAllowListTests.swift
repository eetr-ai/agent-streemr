import XCTest
@testable import AgentStreemrSwift

final class InMemoryAllowListTests: XCTestCase {

    func testUnknownToolReturnsUnknown() async {
        let list = InMemoryAllowList()
        let decision = await list.check(toolName: "read_file", args: [:])
        XCTAssertEqual(decision, .unknown)
    }

    func testAllowedToolReturnsAllowed() async {
        let list = InMemoryAllowList()
        await list.allow("read_file")
        let decision = await list.check(toolName: "read_file", args: [:])
        XCTAssertEqual(decision, .allowed)
    }

    func testDeniedToolReturnsDenied() async {
        let list = InMemoryAllowList()
        await list.deny("read_file")
        let decision = await list.check(toolName: "read_file", args: [:])
        XCTAssertEqual(decision, .denied)
    }

    func testOverrideAllowWithDeny() async {
        let list = InMemoryAllowList()
        await list.allow("read_file")
        await list.deny("read_file")
        let decision = await list.check(toolName: "read_file", args: [:])
        XCTAssertEqual(decision, .denied)
    }

    func testRemoveRevertsToUnknown() async {
        let list = InMemoryAllowList()
        await list.allow("read_file")
        await list.remove("read_file")
        let decision = await list.check(toolName: "read_file", args: [:])
        XCTAssertEqual(decision, .unknown)
    }

    func testClearWipesAllEntries() async {
        let list = InMemoryAllowList()
        await list.allow("tool_a")
        await list.deny("tool_b")
        await list.clear()
        let a = await list.check(toolName: "tool_a", args: [:])
        let b = await list.check(toolName: "tool_b", args: [:])
        XCTAssertEqual(a, .unknown)
        XCTAssertEqual(b, .unknown)
    }

    func testSnapshotReflectsMixedState() async {
        let list = InMemoryAllowList()
        await list.allow("tool_a")
        await list.deny("tool_b")
        let snapshot = await list.snapshot()
        XCTAssertEqual(snapshot["tool_a"], true)
        XCTAssertEqual(snapshot["tool_b"], false)
        XCTAssertNil(snapshot["tool_c"])
    }
}
