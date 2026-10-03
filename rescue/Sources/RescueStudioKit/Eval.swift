import Foundation

/// Read-only rescue/eval/ outputs for the app's Walidacja mode, served by rescue-server.
public enum EvalFiles {
    /// `/eval/<path>.json|.csv` -> (body, content type); nil when not an eval file or missing. No "..".
    public static func file(_ rawPath: String) -> (Data, String)? {
        let p = rawPath.removingPercentEncoding ?? rawPath
        guard p.hasPrefix("/eval/"), !p.contains(".."), p.hasSuffix(".json") || p.hasSuffix(".csv"),
              let d = FileManager.default.contents(atPath: pkgDir.appendingPathComponent(String(p.dropFirst())).path) else { return nil }
        return (d, p.hasSuffix(".csv") ? "text/csv; charset=utf-8" : "application/json; charset=utf-8")
    }
    /// `GET /eval/sim-runs`: simulator output folders that have a manifest.csv -> [{id, manifest, run}].
    public static func simRuns() -> Data {
        let dir = pkgDir.appendingPathComponent("eval/sim/out")
        let ids = ((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []).sorted()
            .filter { FileManager.default.fileExists(atPath: dir.appendingPathComponent("\($0)/manifest.csv").path) }
        return jsonData(ids.map { ["id": $0, "manifest": "/eval/sim/out/\($0)/manifest.csv", "run": "/eval/sim/out/\($0)/run.json"] })
    }
}
