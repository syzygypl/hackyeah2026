import Foundation
import RescueKit

// Usage: swift run rescue-demo [scenario.json] [--fast]
let pkgDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
let args = CommandLine.arguments.dropFirst()
let scenarioPath = args.enumerated().first { i, a in !a.hasPrefix("--") && (i == 0 || args[args.index(args.startIndex, offsetBy: i - 1)] != "--features") }?.element ?? pkgDir.appendingPathComponent("scenarios/zawrat.json").path
var scenario = try Scenario.load(scenarioPath)
// Optional precomputed terrain (OSM + DEM) next to the scenario: <name>-terrain.json, same shape as scenario.terrain
let terrainPath = URL(fileURLWithPath: scenarioPath).deletingLastPathComponent()
    .appendingPathComponent(URL(fileURLWithPath: scenarioPath).deletingPathExtension().lastPathComponent + "-terrain.json").path
if FileManager.default.fileExists(atPath: terrainPath) {
    do {
        scenario.terrain = try JSONDecoder().decode(Scenario.Terrain.self, from: Data(contentsOf: URL(fileURLWithPath: terrainPath)))
        print("Terrain: \(terrainPath) (\(scenario.terrain.trails.count) trails, slope \(scenario.terrain.slopeDeg == nil ? "no" : "yes"))")
    } catch {
        print("WARNING: \(terrainPath) exists but does not decode (\(error)); using the scenario's own terrain")
    }
} else {
    print("Terrain: scenario's own terrain (\(scenario.terrain.trails.count) trails\(scenario.terrain.trails.isEmpty ? ", FLAT" : "")). For real terrain: python3 rescue/tools/terrain/osm_terrain.py --scenario \(scenarioPath)")
}
scenario.applyEpilogue(args.contains("--epilogue") ? true : nil)
// --features traceWindow,podModel | all  (engine flags after rescue-engine-v2.1; default = frozen v2.1)
if let i = CommandLine.arguments.firstIndex(of: "--features"), i + 1 < CommandLine.arguments.count { scenario.enable(CommandLine.arguments[i + 1]) }
if let f = scenario.features, f.values.contains(true) { print("Features: \(f.filter { $0.value }.keys.sorted().joined(separator: ", "))") }
// Evidence outside the grid gets 0 POA by construction: grow the grid to cover it (unless fixedBbox), and report.
let coverage = applyCoverage(&scenario)
for it in (coverage["items"] as? [[String: Any]]) ?? [] where ((it["outsidePctBefore"] as? Double) ?? 0) > 0 {
    print(String(format: "Coverage: %@ %@ was %.1f%% outside the map, now %.1f%%", it["clock"] as! String, it["source"] as! String,
                 it["outsidePctBefore"] as! Double, it["outsidePct"] as! Double))
}
if coverage["expanded"] as? Bool == true { print("Grid auto-expanded to \(scenario.rows)x\(scenario.cols) cells to cover the evidence (cells outside the terrain file are flat/unknown).") }
if ((coverage["worstOutsidePct"] as? Double) ?? 0) > 5 { print("WARNING: część dowodów poza mapą: \(coverage["worstOutsidePct"]!)%") }
let clock = ScenarioClock(msPerMinute: args.contains("--fast") ? 0 : 8)

let grid = ProbabilityGrid(scenario)
// Blind mode: a scenario without `truth` runs end to end, without the backtest (nobody knows the find spot).
let blind = scenario.truth == nil
let truthCell = scenario.truth.map { grid.cellIndex(Coord($0.at)) } ?? 0
let truthSeg = blind ? "" : scenario.segments[grid.segmentOf[truthCell]].id

func pct(_ x: Double) -> String { String(format: "%.0f%%", x * 100) }
func top3Line(_ segs: [ProbabilityGrid.SegmentScore]) -> String {
    segs.prefix(3).map { "\(Scenario.segLabel($0.id, $0.name)) \(pct($0.poa))" }.joined(separator: " | ")
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
var plans: [SearchPlanner.Plan] = []
var conditions = LocationHint.Conditions()
var closedCase = false
var teamState: [String: SearchPlanner.TeamState] = [:]
var segHistory: [String: SearchPlanner.SegHistory] = [:]
for h in arrived {
    grid.add(h)
    if case let .conditions(c) = h.evidence { conditions = c }
    if h.kind == "found" { closedCase = true }
    let poa = grid.poa()
    let segs = grid.segments(poa)
    snaps.append(Snap(segs: segs, poa: poa))
    let plan = SearchPlanner.step(h, grid: grid, poa: poa, conditions: conditions, closed: closedCase, state: &teamState, history: &segHistory)
    plans.append(plan)
    print("[\(h.clock)] \(h.source.padding(toLength: 17, withPad: " ", startingAt: 0)) \(h.title)")
    print("        top3: \(top3Line(segs))")
    let grounded = plan.resources.filter { !$0.available }.map { "\($0.id): \($0.reason)" }
    let assigned = plan.assignments.map { "\($0.resourceId)->\($0.segmentId) \(Int($0.travelMin))min \(pct($0.expectedFind))" }
    print("        plan: \(assigned.joined(separator: ", "))\(grounded.isEmpty ? "" : " | niedostępne: " + grounded.joined(separator: "; "))")
}

// Value numbers, measured just BEFORE the Ratunek ping (what the search leader had on the paper map)
// state just before the decisive hint (search find or Ratunek ping): what the search leader had
let beforePing = max(0, (StoryPipeline.decisiveIndex(arrived) ?? arrived.count) - 1)
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

print("\n== VALUE (state at \(arrived[beforePing].clock), before \(StoryPipeline.decisiveIndex(arrived).map { arrived[$0].kind == "found" ? "the find" : "the Ratunek ping" } ?? "the end")) ==")
print("Top 3 segments hold \(pct(top3poa)) of probability in \(pct(top3area)) of the area (\(String(format: "%.0f", Double(grid.count) * scenario.cellM * scenario.cellM / 1e6)) km2 grid).")
print("  1. \(Scenario.segLabel(fused[0].id, fused[0].name)): \(pct(fused[0].poa)) in \(pct(fused[0].areaFrac)) area")
print("  2. \(Scenario.segLabel(fused[1].id, fused[1].name)): \(pct(fused[1].poa)) in \(pct(fused[1].areaFrac)) area")
print("  3. \(Scenario.segLabel(fused[2].id, fused[2].name)): \(pct(fused[2].poa)) in \(pct(fused[2].areaFrac)) area")
if blind {
    print("BLIND MODE: the scenario has no find spot (truth), backtest skipped.")
} else {
    print("Backtest (fictional find spot in \(truthSeg)): segment rank \(rankFused) fused vs \(rankRings) with plain Koester rings.")
    print("Area swept in POA order before reaching the find spot: \(String(format: "%.2f", areaFused * 100))% fused vs \(String(format: "%.1f", areaRings * 100))% rings only.")
}
// Search allocation value: terrain+weather-aware plan vs naive "biggest POA first", same teams, same physics
let planC = plans[beforePing].conditions
let smartCurve = SearchPlanner.simulate(grid: grid, poa: snaps[beforePing].poa, conditions: planC, minute: arrived[beforePing].minute, smart: true,
                                        state: plans[beforePing].stateBefore, history: plans[beforePing].history)
let naiveCurve = SearchPlanner.simulate(grid: grid, poa: snaps[beforePing].poa, conditions: planC, minute: arrived[beforePing].minute, smart: false,
                                        state: plans[beforePing].stateBefore, history: plans[beforePing].history)
let t50s = SearchPlanner.timeTo(0.5, smartCurve), t50n = SearchPlanner.timeTo(0.5, naiveCurve)
let pos2s = SearchPlanner.posAt(120, smartCurve), pos2n = SearchPlanner.posAt(120, naiveCurve)
func hm(_ m: Double?) -> String { m.map { String(format: "%d h %02d min", Int($0) / 60, Int($0) % 60) } ?? "> 6 h" }
print("Allocation (from \(arrived[beforePing].clock), \(plans[beforePing].survival.text)):")
print("  time to 50% chance of find: \(hm(t50s)) planned vs \(hm(t50n)) naive (biggest POA first)")
print("  chance of find after 2 h: \(pct(pos2s)) planned vs \(pct(pos2n)) naive")
for target in [0.2, 0.3, 0.4] { print("  time to \(pct(target)): \(hm(SearchPlanner.timeTo(target, smartCurve))) planned vs \(hm(SearchPlanner.timeTo(target, naiveCurve))) naive") }
print("  after 1 h / 3 h: \(pct(SearchPlanner.posAt(60, smartCurve)))/\(pct(SearchPlanner.posAt(180, smartCurve))) planned vs \(pct(SearchPlanner.posAt(60, naiveCurve)))/\(pct(SearchPlanner.posAt(180, naiveCurve))) naive")
let find = StoryPipeline.findInfo(grid: grid, hints: arrived, plans: plans, poas: snaps.map(\.poa))
if let seg = find["findSeg"] as? String {
    let a = find["findAssigned"] as? [String: Any]
    print("Find: \(find["findClock"]!) \(find["findSource"]!) in \(seg) \(find["findSegName"]!); #1 on the map since \(find["findRank1Since"] ?? "-")" +
          (a.map { ", plan sent \($0["resourceName"]!) there at \($0["clock"]!) (ETA \($0["etaMin"]!) min)" } ?? ", no team was assigned there before"))
    if let p = find["pingClock"] { print("Epilogue: Ratunek ping at \(p) - the map had \(seg) as #1 since \(find["findRank1Since"] ?? "-")") }
}
let finalTop = snaps.last!.segs[0]
print("Final state: \(Scenario.segLabel(finalTop.id, finalTop.name)) \(pct(finalTop.poa)).")

// HTML
let out = pkgDir.appendingPathComponent("out")
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
var summary: [String: Any] = [
    "top3poa": top3poa, "top3area": top3area, "beforePing": beforePing, "blind": blind,
    "epilogue": scenario.events.contains { $0.epilogue == true },
    "t40Planned": SearchPlanner.timeTo(0.4, smartCurve) ?? -1, "t40Naive": SearchPlanner.timeTo(0.4, naiveCurve) ?? -1,
    "t50Planned": t50s ?? -1, "t50Naive": t50n ?? -1, "pos2hPlanned": pos2s, "pos2hNaive": pos2n,
    "curvePlanned": smartCurve.map { [$0.0, $0.1] }, "curveNaive": naiveCurve.map { [$0.0, $0.1] },
]
summary.merge(find) { $1 }
summary["coverage"] = coverage
if !blind {
    // plan backtest from the moment all clues are in (before the first search report) and from the value moment
    let firstSearch = max(0, (arrived.firstIndex { $0.kind == "searched" } ?? arrived.count) - 1)
    for (key, k) in [("Clues", firstSearch), ("", beforePing)] {
        let c = plans[k].conditions, m = arrived[k].minute
        let st = plans[k].stateBefore, hi = plans[k].history
        summary["truthPlanned" + key] = SearchPlanner.truthDetection(SearchPlanner.simulateJobs(grid: grid, poa: snaps[k].poa, conditions: c, minute: m, smart: true, state: st, history: hi), truthCell: truthCell)
        summary["truthNaive" + key] = SearchPlanner.truthDetection(SearchPlanner.simulateJobs(grid: grid, poa: snaps[k].poa, conditions: c, minute: m, smart: false, state: st, history: hi), truthCell: truthCell)
    }
    let tp = summary["truthPlannedClues"] as! [String: Any], tn = summary["truthNaiveClues"] as! [String: Any]
    print("Plan backtest from \(arrived[firstSearch].clock): true cell detected with p=\(tp["p2h"]!) after 2 h, \(tp["p4h"]!) after 4 h (naive \(tn["p2h"]!) / \(tn["p4h"]!)); first sweep at +\(tp["firstSweepMin"] ?? "-") min (naive +\(tn["firstSweepMin"] ?? "-"))")
    summary["rankFused"] = rankFused; summary["rankRings"] = rankRings
    summary["areaFused"] = areaFused; summary["areaRings"] = areaRings; summary["truthSeg"] = truthSeg
}
// default scenario -> out/index.html + out/run.json; others -> out/<name>.html + out/<name>.run.json
let scenName = URL(fileURLWithPath: scenarioPath).deletingPathExtension().lastPathComponent
let isDefault = scenName == "zawrat"
let file = out.appendingPathComponent(isDefault ? "index.html" : "\(scenName).html")
let runFile = out.appendingPathComponent(isDefault ? "run.json" : "\(scenName).run.json")
try writeRunJSON(to: runFile, scenario: scenario, grid: grid, hints: arrived, plans: plans, summary: summary)
htmlScenarioName = URL(fileURLWithPath: scenarioPath).deletingPathExtension().lastPathComponent
let html = renderHTML(scenario: scenario, grid: grid, hints: arrived, plans: plans, summary: summary)
try html.write(to: file, atomically: true, encoding: .utf8)
print("\nWrote \(file.path)  (open it in a browser)")
print("Wrote \(runFile.path)  (machine-readable contract)")
