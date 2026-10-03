import Foundation
import RescueKit

// Usage: swift run rescue-demo [scenario.json] [--fast]
let pkgDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
let args = CommandLine.arguments.dropFirst()
let scenarioPath = args.first { !$0.hasPrefix("--") } ?? pkgDir.appendingPathComponent("scenarios/zawrat.json").path
let scenario = try Scenario.load(scenarioPath)
let clock = ScenarioClock(msPerMinute: args.contains("--fast") ? 0 : 8)

let grid = ProbabilityGrid(scenario)
let truthCell = grid.cellIndex(Coord(scenario.truth.at))
let truthSeg = scenario.segments[grid.segmentOf[truthCell]].id

func pct(_ x: Double) -> String { String(format: "%.0f%%", x * 100) }
func top3Line(_ segs: [ProbabilityGrid.SegmentScore]) -> String {
    segs.prefix(3).map { "\($0.id) \($0.name) \(pct($0.poa))" }.joined(separator: " | ")
}

print("== RESCUE LOCATOR == \(scenario.incident)")
print("Subject: \(scenario.subject.name), \(scenario.subject.age), category: \(scenario.subject.category)")
print("Grid: \(grid.rows)x\(grid.cols) cells of \(Int(scenario.cellM)) m, \(scenario.segments.count) segments")
print("Streaming hints from \(allProviders(scenario).count) providers...\n")

// Live stream: providers -> merged -> grid
var arrived: [LocationHint] = []
for await h in HintStream.merge(allProviders(scenario), clock: clock) {
    arrived.append(h)
}
// Same-minute hints can race; replay order = scenario time, then provider order.
let order = allProviders(scenario).map(\.name)
arrived.sort { ($0.minute, order.firstIndex(of: $0.source) ?? 0, $0.id) < ($1.minute, order.firstIndex(of: $1.source) ?? 0, $1.id) }

struct Snap { let segs: [ProbabilityGrid.SegmentScore]; let poa: [Double] }
var snaps: [Snap] = []
for h in arrived {
    grid.add(h)
    let poa = grid.poa()
    let segs = grid.segments(poa)
    snaps.append(Snap(segs: segs, poa: poa))
    print("[\(h.clock)] \(h.source.padding(toLength: 16, withPad: " ", startingAt: 0)) \(h.title)")
    print("        top3: \(top3Line(segs))")
}

// Value numbers, measured just BEFORE the Ratunek ping (what the search leader had on the paper map)
let beforePing = (arrived.firstIndex { $0.source == "RatunekPing" } ?? arrived.count) - 1
let fused = snaps[beforePing].segs
let top3poa = fused.prefix(3).map(\.poa).reduce(0, +)
let top3area = fused.prefix(3).map(\.areaFrac).reduce(0, +)
let ringsOnlyIdx = arrived.firstIndex { $0.source == "KoesterRings" }!
let ringsOnly = grid.segments(grid.poa(upTo: ringsOnlyIdx + 1, disabled: Set(arrived.filter { $0.source != "KoesterRings" }.map(\.id))))
let rankFused = (fused.firstIndex { $0.id == truthSeg } ?? 99) + 1
let rankRings = (ringsOnly.firstIndex { $0.id == truthSeg } ?? 99) + 1
// Area to sweep (cells in POA order) until the true location is covered
func areaToFind(_ poa: [Double]) -> Double {
    let sorted = poa.indices.sorted { poa[$0] > poa[$1] }
    return Double(sorted.firstIndex(of: truthCell)! + 1) / Double(poa.count)
}
let ringsPoa = grid.poa(upTo: ringsOnlyIdx + 1, disabled: Set(arrived.filter { $0.source != "KoesterRings" }.map(\.id)))
let areaFused = areaToFind(snaps[beforePing].poa), areaRings = areaToFind(ringsPoa)

print("\n== VALUE (state at \(arrived[beforePing].clock), before the Ratunek ping) ==")
print("Top 3 segments hold \(pct(top3poa)) of probability in \(pct(top3area)) of the area (36 km2 box).")
print("  1. \(fused[0].id) \(fused[0].name): \(pct(fused[0].poa)) in \(pct(fused[0].areaFrac)) area")
print("  2. \(fused[1].id) \(fused[1].name): \(pct(fused[1].poa)) in \(pct(fused[1].areaFrac)) area")
print("  3. \(fused[2].id) \(fused[2].name): \(pct(fused[2].poa)) in \(pct(fused[2].areaFrac)) area")
print("Backtest (fictional find spot in \(truthSeg)): segment rank \(rankFused) fused vs \(rankRings) with plain Koester rings.")
print("Area swept in POA order before reaching the find spot: \(String(format: "%.1f", areaFused * 100))% fused vs \(String(format: "%.1f", areaRings * 100))% rings only.")
let finalTop = snaps.last!.segs[0]
print("After Ratunek ping: \(finalTop.id) \(finalTop.name) \(pct(finalTop.poa)).")

// HTML
let out = pkgDir.appendingPathComponent("out")
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
let summary: [String: Any] = [
    "top3poa": top3poa, "top3area": top3area, "rankFused": rankFused, "rankRings": rankRings,
    "areaFused": areaFused, "areaRings": areaRings, "truthSeg": truthSeg, "beforePing": beforePing,
]
let html = renderHTML(scenario: scenario, grid: grid, hints: arrived, summary: summary)
let file = out.appendingPathComponent("index.html")
try html.write(to: file, atomically: true, encoding: .utf8)
print("\nWrote \(file.path)  (open it in a browser)")
