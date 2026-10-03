import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// "Ocena sytuacji": a Polish operational assessment of one step of a run (rescue-run/1), written by the LOCAL model
/// (Ollama, temperature 0, JSON-schema output) and grounded: the model may only reference segment ids, evidence ids (E1..)
/// and team ids that exist in the run; anything else is dropped. When Ollama is unreachable or returns nothing usable,
/// a deterministic template assessment from the same data is returned, labelled "reguły".
/// Reads the run only; it never changes the probability map or the planner.
public enum Assessment {
    public static var model: String { LLM.model }
    nonisolated(unsafe) static var lastFailure = ""
    public static var ollamaURL: String { LLM.endpoint }

    // MARK: facts extracted from the run

    struct Facts {
        var t = "", step = 0, nSteps = 0, incident = ""
        var segments: [(id: String, name: String, poa: Double, area: Double)] = []
        var segIds: Set<String> = []
        var evidence: [(id: String, t: String, source: String, kind: String, label: String)] = []
        var searched: [String: Double] = [:]           // segment -> combined POD
        var assignments: [[String: Any]] = []
        var resources: [[String: Any]] = []
        var weather: [String: Any] = [:]
        var coverage: [[String: Any]] = []
        var found: String? = nil
    }

    static func facts(_ run: [String: Any], step req: Int?) -> Facts? {
        guard let steps = run["steps"] as? [[String: Any]], !steps.isEmpty else { return nil }
        var f = Facts()
        let k = min(max(0, (req ?? steps.count) - 1), steps.count - 1)   // step is 1-based like the slider
        let st = steps[k]
        f.step = k + 1; f.nSteps = steps.count; f.t = st["t"] as? String ?? ""; f.incident = run["incident"] as? String ?? ""
        for s in (st["segments"] as? [[String: Any]]) ?? [] {
            let id = s["id"] as? String ?? ""
            f.segments.append((id, s["name"] as? String ?? "", s["poa"] as? Double ?? 0, s["areaPct"] as? Double ?? 0))
            f.segIds.insert(id)
        }
        // evidence = hints up to this step (study-only layers like terrain are context, not evidence)
        let extras = (run["hints"] as? [[String: Any]]) ?? []
        for (i, s) in steps.prefix(k + 1).enumerated() {
            let kind = s["kind"] as? String ?? ""
            if ["terrain", "cost", "difficulty"].contains(kind) { continue }
            f.evidence.append(("E\(f.evidence.count + 1)", s["t"] as? String ?? "", s["source"] as? String ?? "", kind, s["label"] as? String ?? ""))
            if kind == "searched" {
                let segs = (i < extras.count ? extras[i]["segments"] as? [String] : nil) ?? idsIn(s["label"] as? String ?? "", f.segIds)
                let pod = (i < extras.count ? extras[i]["pod"] as? Double : nil) ?? 0.6
                for g in segs { f.searched[g] = 1 - (1 - (f.searched[g] ?? 0)) * (1 - pod) }
            }
            if kind == "found" { f.found = s["label"] as? String }
        }
        if let h = st["segmentHistory"] as? [String: [String: Any]] { for (g, v) in h { f.searched[g] = v["cumPod"] as? Double ?? f.searched[g] } }
        f.assignments = (st["assignments"] as? [[String: Any]]) ?? []
        f.resources = (st["resources"] as? [[String: Any]]) ?? []
        f.weather = (st["weather"] as? [String: Any]) ?? [:]
        f.coverage = (((run["value"] as? [String: Any])?["coverage"] as? [String: Any])?["items"] as? [[String: Any]]) ?? []
        return f
    }

    static func idsIn(_ text: String, _ ids: Set<String>) -> [String] {
        ids.filter { id in text.range(of: "\\b\(NSRegularExpression.escapedPattern(for: id))\\b", options: .regularExpression) != nil }.sorted()
    }
    static func pct(_ x: Double) -> String { String(format: "%.0f%%", x * 100) }

    // MARK: public entry

    /// Assessment JSON for step `step` (1-based; nil = last step) of a run document.
    public static func assess(run: Data, step: Int? = nil, useLLM: Bool = true) async -> Data {
        guard let doc = (try? JSONSerialization.jsonObject(with: run)) as? [String: Any], let f = facts(doc, step: step) else {
            return json(["error": "run bez kroków"])
        }
        let t0 = Date()
        var source = "reguły", note: String? = nil, dropped: [String] = []
        var body: [String: Any]
        if useLLM && ProcessInfo.processInfo.environment["RESCUE_LLM_OFF"] != "1", let (b, d) = await llm(f) {
            body = b; dropped = d; source = "\(LLM.tag):\(model)"
        } else {
            body = rules(f)
            note = useLLM ? "ocena z reguł: \(ProcessInfo.processInfo.environment["RESCUE_LLM_OFF"] == "1" ? "RESCUE_LLM_OFF=1" : lastFailure)" : "ocena z reguł (llm=0)"
        }
        var out: [String: Any] = [
            "source": source, "latencyMs": Int(Date().timeIntervalSince(t0) * 1000), "step": f.step, "steps": f.nSteps, "t": f.t,
            "assessment": body, "dropped": dropped,
            "evidenceIndex": Dictionary(uniqueKeysWithValues: f.evidence.map { ($0.id, "\($0.t) \($0.source): \($0.label)") }),
        ]
        if let note { out["note"] = note }
        return json(out)
    }

    static func json(_ o: Any) -> Data { (try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys])) ?? Data("{}".utf8) }

    // MARK: deterministic template ("reguły")

    static func rules(_ f: Facts) -> [String: Any] {
        let top = f.segments.prefix(3)
        let w = f.weather, surv = (w["survival"] as? [String: Any]) ?? [:]
        var sit = f.found.map { "Akcja zamknięta o \(f.t): \($0)." } ?? ""
        if f.found == nil, let a = top.first {
            sit = "Stan o \(f.t): najwyższe prawdopodobieństwo \(Scenario.segLabel(a.id, a.name)) (\(pct(a.poa))); top 3 segmenty mają \(pct(top.map(\.poa).reduce(0, +))) w \(String(format: "%.0f", top.map(\.area).reduce(0, +)))% obszaru."
            let n = f.searched.count
            sit += n > 0 ? " Przeszukano bez wyniku \(n) segment(y)." : " Nic jeszcze nie przeszukano."
            if let txt = surv["text"] as? String { sit += " \(txt)." }
        }
        // hypotheses: top segments with the evidence that mentions them (or the strongest recent evidence)
        let hyps: [[String: Any]] = top.map { s in
            // evidence that raised this segment (planner why-layers) or that names it
            let layers = ((f.assignments.first { ($0["segmentId"] as? String) == s.id }?["whyLayers"] as? [[String: Any]]) ?? [])
                .filter { ($0["deltaPP"] as? Double ?? 0) > 0 }.compactMap { $0["title"] as? String }
            let ev = f.evidence.filter { e in layers.contains(e.label) || e.label.contains(s.id) || e.label.lowercased().contains(s.name.lowercased().prefix(8)) }.map(\.id)
            let why = f.assignments.first { ($0["segmentId"] as? String) == s.id }?["why"] as? String
            return ["segment": s.id, "nazwa": s.name, "opis": "\(s.name): \(pct(s.poa)) prawdopodobieństwa" + (why.map { ". \($0.components(separatedBy: " | ").first ?? "")" } ?? ""),
                    "dowody": Array(ev.prefix(3))]
        }
        let recs: [[String: Any]] = f.assignments.map { a in
            ["zespol": a["resourceId"] as? String ?? "", "segment": a["segmentId"] as? String ?? "", "zgodnie_z_planem": true,
             "dzialanie": "\(a["resourceId"] as? String ?? "") -> \(Scenario.segLabel(a["segmentId"] as? String ?? "", a["segmentName"] as? String ?? "")), ETA \(Int((a["travelMin"] as? Double ?? 0).rounded())) min",
             "uzasadnienie": a["reason"] as? String ?? ""]
        }
        var risks: [[String: Any]] = []
        if let lvl = surv["level"] as? String, ["wysoki", "krytyczny"].contains(lvl) { risks.append(["typ": "hipotermia", "opis": surv["text"] as? String ?? lvl]) }
        if w["dark"] as? Bool == true { risks.append(["typ": "ciemność", "opis": "Noc: niższe POD zespołów naziemnych, wolniejsze przejście."]) }
        for r in f.resources where r["available"] as? Bool == false {
            let why = r["reason"] as? String ?? ""
            if why.contains("uziem") || why.contains("nie leci") { risks.append(["typ": "pogoda", "opis": "\(r["name"] as? String ?? ""): \(why)"]) }
        }
        for a in f.assignments { for s in (a["safety"] as? [String]) ?? [] { risks.append(["typ": "bezpieczeństwo", "opis": "\(a["segmentId"] as? String ?? ""): \(s)"]) } }
        var missing: [[String: Any]] = []
        if !f.evidence.contains(where: { $0.source == "Cell112Fix" }) { missing.append(["informacja": "Lokalizacja z sieci (CPR 112 / operator)", "dlaczego": "Zawęziłaby obszar do sektora BTS."]) }
        if !f.evidence.contains(where: { $0.source == "Clue" }) { missing.append(["informacja": "Świadkowie na szlaku (schroniska, książki wejść)", "dlaczego": "Ostatni znany punkt przesuwa pierścienie Koestera."]) }
        if f.evidence.contains(where: { $0.source == "Clue" }) { missing.append(["informacja": "Potwierdzenie godziny i kierunku od świadka", "dlaczego": "Godzina obserwacji decyduje, czy to ostatni znany punkt."]) }
        if let a = top.first, (f.searched[a.id] ?? 0) < 0.5 { missing.append(["informacja": "Wynik przeszukania \(a.id)", "dlaczego": "Negatywny wynik o wysokim POD przesunie mapę najmocniej."]) }
        for c in f.coverage where (c["outsidePct"] as? Double ?? 0) > 5 && c["statistic"] as? Bool != true {
            missing.append(["informacja": "Mapa poza obszarem dowodu \(c["source"] as? String ?? "")", "dlaczego": "\(c["outsidePct"] ?? 0)% dowodu poza siatką."])
        }
        return ["sytuacja": sit, "hipotezy": hyps, "rekomendacje": recs, "ryzyka": risks, "brakuje": missing]
    }

    // MARK: local LLM with grounding

    static func llm(_ f: Facts) async -> ([String: Any], [String])? {
        let segList = f.segments.prefix(8).map { "\(Scenario.segLabel($0.id, $0.name)): \(pct($0.poa)), \(String(format: "%.1f", $0.area))% obszaru, przeszukany POD \(pct(f.searched[$0.id] ?? 0))" }
        let ev = f.evidence.map { "\($0.id) [\($0.t) \($0.source)] \($0.label)" }
        let plan = f.assignments.map { a in
            "\(a["resourceId"] ?? "") -> \(a["segmentId"] ?? "") (ETA \(Int((a["travelMin"] as? Double ?? 0).rounded())) min, szansa \(pct(a["expectedFind"] as? Double ?? 0)))" +
            ((a["why"] as? String).map { "; \($0)" } ?? "") + (((a["safety"] as? [String]) ?? []).isEmpty ? "" : "; UWAGA: \(((a["safety"] as? [String]) ?? []).joined(separator: ", "))")
        }
        let res = f.resources.map { "\($0["id"] ?? "") \($0["name"] ?? ""): \(($0["available"] as? Bool) == true ? "dostępny" : "niedostępny") (\($0["reason"] ?? ""))" }
        let w = f.weather, surv = (w["survival"] as? [String: Any]) ?? [:]
        let user = """
        Akcja: \(f.incident). Stan o \(f.t) (krok \(f.step)/\(f.nSteps)).\(f.found.map { " ZNALEZIONO: \($0)." } ?? "")
        Segmenty (POA):
        \(segList.joined(separator: "\n"))
        Dowody:
        \(ev.joined(separator: "\n"))
        Plan zespołów (planer):
        \(plan.isEmpty ? "brak przydziałów" : plan.joined(separator: "\n"))
        Zespoły:
        \(res.joined(separator: "\n"))
        Pogoda: widzialność \(w["visibilityM"] ?? "?") m, wiatr \(w["windMs"] ?? "?") m/s, \(w["tempC"] ?? "?") °C, opad \(w["precip"] ?? "?"), noc \(w["dark"] ?? false), lód \(w["ice"] ?? false).
        Hipotermia: \(surv["text"] ?? "?").
        """
        let sys = """
        Jesteś asystentem kierownika akcji ratunkowej GOPR/TOPR. Piszesz krótką ocenę sytuacji po polsku na podstawie WYŁĄCZNIE podanych danych.
        Zasady: używaj tylko identyfikatorów segmentów, dowodów (E1, E2, ...) i zespołów, które są w danych. Nie wymyślaj miejsc, godzin ani liczb. Nazwy segmentów podawaj dokładnie jak w danych. Pisz zwięźle.
        sytuacja: 2-3 zdania. hipotezy: 1-4, od najbardziej prawdopodobnej, każda z segmentem i listą dowodów (E..).
        rekomendacje: na następną godzinę, po jednej na zespół; jeśli zgodnie z planerem, zgodnie_z_planem=true i ten sam segment co planer; jeśli inaczej, zgodnie_z_planem=false i podaj powód.
        ryzyka: hipotermia, ciemność, pogoda (uziemiony sprzęt), bezpieczeństwo (teren). brakuje: informacje, które najbardziej zmieniłyby mapę.
        """
        let str: [String: Any] = ["type": "string"]
        let schema: [String: Any] = ["type": "object", "required": ["sytuacja", "hipotezy", "rekomendacje", "ryzyka", "brakuje"], "properties": [
            "sytuacja": str,
            "hipotezy": ["type": "array", "items": ["type": "object", "required": ["segment", "opis", "dowody"],
                         "properties": ["segment": str, "opis": str, "dowody": ["type": "array", "items": str]]]],
            "rekomendacje": ["type": "array", "items": ["type": "object", "required": ["zespol", "segment", "dzialanie", "zgodnie_z_planem", "uzasadnienie"],
                             "properties": ["zespol": str, "segment": str, "dzialanie": str, "zgodnie_z_planem": ["type": "boolean"], "uzasadnienie": str]]],
            "ryzyka": ["type": "array", "items": ["type": "object", "required": ["typ", "opis"], "properties": ["typ": str, "opis": str]]],
            "brakuje": ["type": "array", "items": ["type": "object", "required": ["informacja", "dlaczego"], "properties": ["informacja": str, "dlaczego": str]]],
        ]]
        let msg: String
        do {
            msg = try await LLM.chat([["role": "system", "content": sys], ["role": "user", "content": user]], schema: schema, name: "assessment",
                                     timeout: Double(ProcessInfo.processInfo.environment["RESCUE_LLM_TIMEOUT"] ?? "") ?? 120)
        } catch { lastFailure = (error as? LLM.Failure)?.description ?? "model nieosiągalny"; return nil }
        guard let a = try? JSONSerialization.jsonObject(with: Data(msg.utf8)) as? [String: Any] else { lastFailure = "model zwrócił niepoprawny JSON"; return nil }
        guard let g = ground(a, f) else { lastFailure = "nic z odpowiedzi modelu nie przeszło weryfikacji (nieistniejące segmenty/zespoły)"; return nil }
        return g
    }

    /// Keeps only what exists in the run: segment ids, evidence ids, team ids. Fixes plan-consistency flags.
    static func ground(_ a: [String: Any], _ f: Facts) -> ([String: Any], [String])? {
        var dropped: [String] = []
        let evIds = Set(f.evidence.map(\.id))
        let teamIds = Set(f.resources.compactMap { $0["id"] as? String })
        let planFor = Dictionary(f.assignments.compactMap { a -> (String, String)? in
            guard let r = a["resourceId"] as? String, let s = a["segmentId"] as? String else { return nil }
            return (r, s)
        }, uniquingKeysWith: { a, _ in a })
        // any segment-like token in free text must exist (ids look like S12, A3, D13)
        let tokenRe = try! NSRegularExpression(pattern: "\\b[A-Z]{1,2}\\d{1,2}\\b")
        func clean(_ s: String, _ what: String) -> String? {
            let ns = s as NSString
            let bad = tokenRe.matches(in: s, range: NSRange(location: 0, length: ns.length)).map { ns.substring(with: $0.range) }
                .filter { !f.segIds.contains($0) && !evIds.contains($0) }
            if !bad.isEmpty { dropped.append("\(what): nieznane id \(bad.joined(separator: ", "))"); return nil }
            return s
        }
        // models write "S2 Siklawa / Roztoka górna" or "topr-a Patrol TOPR A" in id fields: take the id it starts with
        func resolve(_ v: Any?, _ ids: Set<String>) -> String? {
            guard let raw = (v as? String)?.trimmingCharacters(in: .whitespaces), !raw.isEmpty else { return nil }
            if ids.contains(raw) { return raw }
            let first = String(raw.split(whereSeparator: { $0 == " " || $0 == "," || $0 == "(" || $0 == ":" }).first ?? "")
            return ids.contains(first) ? first : nil
        }
        var sit = a["sytuacja"] as? String ?? ""
        // drop sentences with unknown ids instead of the whole situation
        sit = sit.components(separatedBy: ". ").compactMap { clean($0, "sytuacja") }.joined(separator: ". ")
        var hyps: [[String: Any]] = []
        for h in (a["hipotezy"] as? [[String: Any]]) ?? [] {
            guard let s = resolve(h["segment"], f.segIds) else { dropped.append("hipoteza: segment \(h["segment"] ?? "?") nie istnieje"); continue }
            guard let opis = clean(h["opis"] as? String ?? "", "hipoteza \(s)") else { continue }
            let all = ((h["dowody"] as? [String]) ?? []).filter { evIds.contains($0) }
            if all.count < ((h["dowody"] as? [String]) ?? []).count { dropped.append("hipoteza \(s): usunięto nieistniejące dowody") }
            // a hypothesis citing everything says nothing: keep the 4 most recent cited evidence ids
            let ev = Array(all.sorted { Int($0.dropFirst()) ?? 0 > Int($1.dropFirst()) ?? 0 }.prefix(4)).sorted { Int($0.dropFirst()) ?? 0 < Int($1.dropFirst()) ?? 0 }
            if all.count > 4 { dropped.append("hipoteza \(s): \(all.count) dowodów, zostawiono 4 najnowsze") }
            let name = f.segments.first { $0.id == s }?.name ?? ""
            hyps.append(["segment": s, "nazwa": name, "opis": opis, "dowody": ev])
        }
        var recs: [[String: Any]] = []
        for r in (a["rekomendacje"] as? [[String: Any]]) ?? [] {
            guard let team = resolve(r["zespol"], teamIds) else { dropped.append("rekomendacja: zespół \(r["zespol"] ?? "?") nie istnieje"); continue }
            guard let seg = resolve(r["segment"], f.segIds) else { dropped.append("rekomendacja \(team): segment \(r["segment"] ?? "?") nie istnieje"); continue }
            var x = r
            x["zespol"] = team; x["segment"] = seg
            let planned = planFor[team]
            let agrees = planned == seg
            if (r["zgodnie_z_planem"] as? Bool) == true && !agrees {
                x["zgodnie_z_planem"] = false
                dropped.append("rekomendacja \(team): model twierdził 'zgodnie z planem', planer daje \(planned ?? "brak przydziału") - oznaczono jako odstępstwo")
            }
            if !agrees && ((x["uzasadnienie"] as? String) ?? "").count < 10 {
                dropped.append("rekomendacja \(team) -> \(seg): odstępstwo od planu bez uzasadnienia"); continue
            }
            x["planer"] = planned ?? "brak przydziału"
            if let st = f.resources.first(where: { ($0["id"] as? String) == team }), st["available"] as? Bool == false {
                x["uwaga"] = "zespół niedostępny o \(f.t): \(st["reason"] as? String ?? "")"
                dropped.append("rekomendacja \(team): zespół niedostępny o tej godzinie - oznaczono")
            }
            guard clean(x["dzialanie"] as? String ?? "", "rekomendacja \(team)") != nil else { continue }
            recs.append(x)
        }
        let kinds = ["hipotermia", "ciemność", "pogoda", "bezpieczeństwo"]
        let risks = ((a["ryzyka"] as? [[String: Any]]) ?? []).map { r -> [String: Any] in
            // small models sometimes swap the fields ("typ": "wysokie", "opis": "hipotermia")
            let t = r["typ"] as? String ?? "", o = r["opis"] as? String ?? ""
            return !kinds.contains(t) && kinds.contains(o) ? ["typ": o, "opis": t] : r
        }.filter { clean($0["opis"] as? String ?? "", "ryzyko") != nil }
        let miss = ((a["brakuje"] as? [[String: Any]]) ?? []).filter { clean(($0["informacja"] as? String ?? "") + " " + ($0["dlaczego"] as? String ?? ""), "brakuje") != nil }
        if sit.isEmpty && hyps.isEmpty && recs.isEmpty { return nil }   // nothing grounded survived -> rules
        return (["sytuacja": sit, "hipotezy": hyps, "rekomendacje": recs, "ryzyka": risks, "brakuje": miss], dropped)
    }
}
