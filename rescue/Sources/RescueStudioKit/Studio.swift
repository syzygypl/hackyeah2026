import Foundation
import RescueKit

let zawratBase = scenariosDir.appendingPathComponent("zawrat.json")
let zawratTerrain = scenariosDir.appendingPathComponent("zawrat-terrain.json")

func jsonData(_ o: Any) -> Data { (try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys])) ?? Data("{}".utf8) }
func jsonObj(_ d: Data) -> [String: Any] { (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] ?? [:] }

public actor Studio {
    public init() {}
    var base: [String: Any] = [:]          // scenario without events
    var items: [[String: Any]] = []        // {id, input, events, parsedBy?, note?}
    var terrainInfo: [String: Any] = [:]
    var lastRun: Data = Data("{}".utf8)
    var nextId = 1
    var undoStack: [([String: Any], [[String: Any]])] = []   // (base, items) before each change, for "Cofnij"
    func snapshot() { undoStack.append((base, items)); if undoStack.count > 30 { undoStack.removeFirst() } }

    // MARK: bases

    nonisolated func zawratTemplate() -> [String: Any] {
        var b = jsonObj((try? Data(contentsOf: zawratBase)) ?? Data())
        b["events"] = nil
        b["truth"] = nil
        b["terrainRef"] = "zawrat-terrain.json"
        return b
    }

    /// 6 x 6 km box around the IPP, 5 x 5 grid segments, flat terrain, generic teams.
    nonisolated func autoTemplate(ipp: [Double], startClock: String) -> [String: Any] {
        let dLat = 3000 / 111_320.0, dLon = 3000 / (111_320.0 * cos(ipp[0] * .pi / 180))
        let bbox: [String: Double] = ["south": ipp[0] - dLat, "north": ipp[0] + dLat, "west": ipp[1] - dLon, "east": ipp[1] + dLon]
        var segs: [[String: Any]] = []
        let rows = ["A", "B", "C", "D", "E"]
        for (r, row) in rows.enumerated() {
            for c in 0..<5 {
                let lat = bbox["north"]! - (Double(r) + 0.5) * 2 * dLat / 5, lon = bbox["west"]! + (Double(c) + 0.5) * 2 * dLon / 5
                segs.append(["id": "\(row)\(c + 1)", "name": "Kwadrat \(row)\(c + 1)", "seed": [lat, lon]])
            }
        }
        let heliBase = [ipp[0] + 0.08, ipp[1] - 0.08]
        return [
            "incident": "Nowa historia (Story Studio)", "date": "2026-10-03", "startClock": startClock,
            "subject": ["name": "Osoba fikcyjna", "age": 40, "category": "hiker", "note": "Historia złożona w Story Studio.", "lastContact": startClock],
            "bbox": bbox, "cellM": 100,
            "ipp": ["name": "IPP (Story Studio)", "at": ipp],
            "terrain": ["trails": [], "streams": [], "ridges": [], "lakes": [], "huts": []],
            "segments": segs,
            "resources": [
                ["id": "patrol", "name": "Patrol GOPR/TOPR", "type": "ground", "base": ipp, "readyAt": clockAdd(startClock, 60)],
                ["id": "dog", "name": "Zespół z psem", "type": "dog", "base": ipp, "readyAt": clockAdd(startClock, 90)],
                ["id": "drone", "name": "Dron termowizyjny", "type": "drone", "base": ipp, "readyAt": clockAdd(startClock, 60)],
                ["id": "heli", "name": "Śmigłowiec", "type": "heli", "base": heliBase, "readyAt": clockAdd(startClock, 20)],
            ],
        ]
    }

    nonisolated func inside(_ p: [Double], _ bb: [String: Any]) -> Bool {
        guard let s = num(bb["south"]), let n = num(bb["north"]), let w = num(bb["west"]), let e = num(bb["east"]) else { return false }
        return p[0] > s && p[0] < n && p[1] > w && p[1] < e
    }

    public func newStory(_ body: Data) async -> Data {
        if !base.isEmpty { snapshot() }
        let o = jsonObj(body)
        let start = o["startClock"] as? String ?? "17:40"
        let cat = o["category"] as? String ?? "hiker"
        let ipp = (o["ipp"] as? [Any])?.compactMap(num) ?? []
        let zbox = zawratTemplate()["bbox"] as? [String: Any] ?? [:]
        let inZawrat = ipp.count == 2 && inside(ipp, zbox)
        let wantZawrat = (o["template"] as? String) == "zawrat" || ipp.count != 2 || inZawrat
        if wantZawrat {
            base = zawratTemplate()
            if ipp.count == 2 { base["ipp"] = ["name": "IPP (Story Studio)", "at": ipp] }
            base["startClock"] = start
            if var subj = base["subject"] as? [String: Any] { subj["category"] = cat; subj["lastContact"] = start; subj["name"] = "Osoba fikcyjna"; base["subject"] = subj }
            base["incident"] = o["incident"] as? String ?? "Nowa historia - Tatry, rejon Zawratu (fikcyjna)"
        } else {
            base = autoTemplate(ipp: ipp, startClock: start)
            if var subj = base["subject"] as? [String: Any] { subj["category"] = cat; base["subject"] = subj }
        }
        items = []
        let ippAt = (base["ipp"] as? [String: Any])?["at"] as? [Double] ?? ipp
        // modules every story starts with
        for inp: [String: Any] in [["provider": "Terrain", "at": start], ["provider": "TerrainDifficulty", "at": start],
                                   ["provider": "KoesterRings", "at": start, "category": cat, "lat": ippAt[0], "lon": ippAt[1]]] {
            await add(inp)
        }
        return await rerun()
    }

    // MARK: input -> scenario events

    func lastClock() -> String {
        let all = items.flatMap { ($0["events"] as? [[String: Any]]) ?? [] }.compactMap { $0["at"] as? String }
        let start = base["startClock"] as? String ?? "17:40"
        return all.max { relMin($0, start) < relMin($1, start) } ?? start
    }

    var segments: [[String: Any]] { base["segments"] as? [[String: Any]] ?? [] }
    var ippAt: [Double] { (base["ipp"] as? [String: Any])?["at"] as? [Double] ?? [0, 0] }

    func latlon(_ i: [String: Any]) -> [Double]? {
        if let ll = (i["latlon"] as? [Any])?.compactMap(num), ll.count == 2 { return ll }
        if let la = num(i["lat"]), let lo = num(i["lon"]) { return [la, lo] }
        if let p = (i["point"] as? [Any])?.compactMap(num), p.count == 2 { return p }
        return nil
    }
    func segList(_ v: Any?) -> [String] {
        if let a = v as? [String] { return a }
        if let s = v as? String { return s.split { $0 == "," || $0 == " " }.map(String.init).filter { !$0.isEmpty } }
        return []
    }

    func convert(_ i: [String: Any]) async -> (events: [[String: Any]], parsedBy: String?, note: String?) {
        let prov = i["provider"] as? String ?? ""
        let at = (i["at"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? clockAdd(lastClock(), 5)
        // times are relative to startClock with the engine's midnight rule (00:55 after an evening start = next day)
        var e: [String: Any] = ["provider": prov, "at": at, "title": i["title"] as? String ?? "", "detail": i["detail"] as? String ?? ""]
        func title(_ t: String) { if (e["title"] as? String ?? "").isEmpty { e["title"] = t } }
        let ll = latlon(i)
        if let r = num(i["radiusM"]) { e["radiusM"] = r }
        switch prov {
        case "Terrain":
            return ([["provider": "Terrain", "at": at, "title": "Teren: szlaki, potoki, schroniska", "detail": "Turyści najczęściej przy szlakach i ciekach.", "factor": 1],
                     ["provider": "Terrain", "at": at, "title": "Teren: koszt (strome ściany poza szlakiem)", "detail": "Ściany poza szlakiem mało prawdopodobne.", "factor": 0]], nil, nil)
        case "TerrainDifficulty":
            title("Trudność terenu: szlak / hala / kosodrzewina / piarg / płyty / ściana")
        case "KoesterRings":
            let cat = i["category"] as? String ?? "hiker"
            let p = ll ?? ippAt
            e["point"] = p; e["quantilesKm"] = koesterCategories[cat] ?? koesterCategories["hiker"]!
            title("Koester: \(cat)")
            if (e["detail"] as? String ?? "").isEmpty { e["detail"] = "Pierścienie od IPP (kwantyle ilustracyjne): \((koesterCategories[cat] ?? []).map { "\($0)" }.joined(separator: " / ")) km" }
            base["ipp"] = ["name": "IPP (Story Studio)", "at": p]
            if var subj = base["subject"] as? [String: Any] { subj["category"] = cat; base["subject"] = subj }
        case "TripPlan":
            let text = i["text"] as? String ?? ""
            e["radiusM"] = num(i["radiusM"]) ?? 300
            var pts = (i["points"] as? [[Double]]) ?? []
            var by = "punkty"
            if pts.count < 2, !text.isEmpty {
                if base["terrainRef"] != nil, let p = await interviewTripPlan(text, at: at) { pts = p; by = "interview.py (qwen3 lokalnie + routing po szlakach)" }
                if pts.count < 2 {
                    pts = placesIn(text, segments: segments).map { $0.1.at }.filter { inside($0, base["bbox"] as? [String: Any] ?? [:]) }
                    // a plan told from the last-seen point: start the line at the IPP
                    if let f = pts.first, abs(f[0] - ippAt[0]) + abs(f[1] - ippAt[1]) > 0.002 { pts.insert(ippAt, at: 0) }
                    by = "gazetteer (linie proste między miejscami)"
                }
            }
            guard pts.count >= 2 else { return ([], nil, "TripPlan: nie rozpoznano trasy w tekście") }
            e["points"] = pts
            title("Plan trasy (\(by.split(separator: " ").first ?? ""))")
            if (e["detail"] as? String ?? "").isEmpty { e["detail"] = text.isEmpty ? "Trasa z mapy" : "\"\(text)\"" }
            return ([e], by, nil)
        case "TrailheadCar":
            guard let p = ll else { return ([], nil, "TrailheadCar: brak pozycji") }
            e["point"] = p; e["points"] = (i["points"] as? [[Double]]) ?? [p]; e["factor"] = num(i["factor"]) ?? 0.35
            if e["radiusM"] == nil { e["radiusM"] = 450 }
            title("Auto nadal na parkingu")
        case "Cell112Fix":
            guard let p = ll else { return ([], nil, "Cell112Fix: brak pozycji") }
            e["point"] = p; if e["radiusM"] == nil { e["radiusM"] = 1500 }
            title("CPR 112: sektor BTS, promień \(Int(num(e["radiusM"]) ?? 1500)) m")
        case "Found":
            guard let p = ll else { return ([], nil, "Found: brak pozycji") }
            e["point"] = p; if e["radiusM"] == nil { e["radiusM"] = 30 }
            title("ZNALEZIONO")
        case "RatunekPing":
            guard let p = ll else { return ([], nil, "RatunekPing: brak pozycji") }
            e["point"] = p; if e["radiusM"] == nil { e["radiusM"] = 25 }
            title("Ratunek: ping GPS, dokładność \(Int(num(e["radiusM"]) ?? 25)) m")
        case "Clue":
            guard let p = ll else { return ([], nil, "Clue: brak pozycji") }
            e["point"] = p; if e["radiusM"] == nil { e["radiusM"] = 500 }
            title("Ślad w terenie")
        case "Weather":
            e["factor"] = num(i["factor"]) ?? 1.2
            title("Mgła: osoba zatrzymuje się przy szlaku / cieku")
        case "WeatherConditions":
            for k in ["visibilityM", "windMs", "tempC"] { if let v = num(i[k]) { e[k] = v } }
            if let p = i["precip"] as? String, !p.isEmpty { e["precip"] = p }
            if let b = bool(i["dark"]) { e["dark"] = b }
            if let b = bool(i["ice"]) { e["ice"] = b }
            var parts: [String] = []
            if let v = num(e["visibilityM"]) { parts.append("widz. \(Int(v)) m") }
            if let v = num(e["windMs"]) { parts.append("wiatr \(Int(v)) m/s") }
            if let v = num(e["tempC"]) { parts.append("\(Int(v))°C") }
            if bool(e["dark"]) == true { parts.append("ciemno") }
            if bool(e["ice"]) == true { parts.append("lód") }
            if let p = e["precip"] as? String, p != "none" { parts.append(p == "rain" ? "deszcz" : "śnieg") }
            title("Warunki: " + (parts.isEmpty ? "bez zmian" : parts.joined(separator: ", ")))
        case "SegmentSearched", "DronePassEmpty":
            let segs = segList(i["segments"]).filter { s in segments.contains { ($0["id"] as? String) == s } }
            guard !segs.isEmpty else { return ([], nil, "\(prov): brak znanych segmentów") }
            e["segments"] = segs; e["pod"] = num(i["pod"]) ?? (prov == "DronePassEmpty" ? 0.6 : 0.7)
            title("\(prov == "DronePassEmpty" ? "Dron" : "Zespół"): \(segs.joined(separator: ", ")) bez wyniku, POD \(Int((num(e["pod"]) ?? 0.7) * 100))%")
        case "FieldReport":
            return await fieldReport(i["text"] as? String ?? "", at: at)
        default:
            return ([], nil, "nieznany moduł \(prov)")
        }
        return ([e], nil, nil)
    }

    /// Field report text -> events, via the FieldReports parser (local qwen3, rules fallback).
    func fieldReport(_ text: String, at: String) async -> ([[String: Any]], String?, String?) {
        let segs = (try? JSONDecoder().decode([Scenario.Segment].self, from: jsonData(segments))) ?? []
        let r = await FieldReportParser(segments: segs).parse(text, at: at)
        var out: [[String: Any]] = []
        for h in r.hints {
            switch h.type {
            case "segmentSearched":
                if let s = h.segmentId { out.append(["provider": "SegmentSearched", "at": at, "title": "\(h.resource.map { "\($0): " } ?? "")\(s) przeszukany, nic", "detail": "Meldunek: \(text)", "segments": [s], "pod": h.pod ?? 0.6]) }
            case "clue":
                let p: [Double]? = (h.lat != nil && h.lon != nil) ? [h.lat!, h.lon!] : segments.first { ($0["id"] as? String) == h.segmentId }?["seed"] as? [Double]
                if let p { out.append(["provider": "Clue", "at": at, "title": "Ślad: \(h.description ?? "?")", "detail": "Meldunek: \(text)", "point": p,
                                       "radiusM": h.strength == "strong" ? 300 : h.strength == "medium" ? 500 : 800]) }
            case "weatherObs":
                var w: [String: Any] = ["provider": "WeatherConditions", "at": at, "title": "Meldunek pogodowy", "detail": "Meldunek: \(text)"]
                if let v = h.visibilityM { w["visibilityM"] = v }
                if let v = h.windMs { w["windMs"] = v }
                if let v = h.precip { w["precip"] = v }
                out.append(w)
                if let v = h.visibilityM, v < 300 { out.append(["provider": "Weather", "at": at, "title": "Mgła z meldunku", "detail": "Meldunek: \(text)", "factor": v < 100 ? 1.2 : 0.6]) }
            default: break
            }
        }
        return (out, r.parsedBy, out.isEmpty ? "meldunek bez zdarzeń przestrzennych" : r.note)
    }

    @discardableResult
    func add(_ input: [String: Any]) async -> [String: Any] {
        let (evs, by, note) = await convert(input)
        var item: [String: Any] = ["id": "e\(nextId)", "input": input, "events": evs]
        nextId += 1
        if let by { item["parsedBy"] = by }
        if let note { item["note"] = note }
        if !evs.isEmpty { items.append(item); Metrics.shared.inc("story_events_total", ["module": Metrics.clean(input["provider"] as? String, "unknown")]) }
        return item
    }

    // MARK: narrative

    public func narrate(_ body: Data) async -> Data {
        let text = jsonObj(body)["text"] as? String ?? ""
        snapshot()
        let segPairs: [[String]] = segments.map { [$0["id"] as? String ?? "", $0["name"] as? String ?? ""] }
        var (narr, note) = await parseNarrativeLLM(text, segs: segPairs)
        var by = "llm-local"
        let rules = parseNarrativeRules(text)
        if narr.isEmpty { narr = rules; by = "rules"; note = note ?? "LLM nic nie zwrócił" }
        else {
            // hybrid: LLM decides what happened; rules fill numbers the small model dropped and add items it missed
            by = "llm-local+rules"
            var used = Set<Int>()
            for k in narr.indices {
                guard let j = rules.indices.first(where: { !used.contains($0) && rules[$0].type == narr[k].type && (rules[$0].at == narr[k].at || narr[k].at == nil) }) else { continue }
                used.insert(j)
                let r = rules[j]
                narr[k].sentence = narr[k].sentence ?? r.sentence
                narr[k].at = narr[k].at ?? r.at
                if r.pod != nil { narr[k].pod = r.pod }
                if r.radiusM != nil { narr[k].radiusM = r.radiusM }
                narr[k].visibilityM = narr[k].visibilityM.flatMap { $0 > 0 ? $0 : nil } ?? r.visibilityM
                narr[k].windMs = narr[k].windMs.flatMap { $0 > 0 ? $0 : nil } ?? r.windMs
                narr[k].tempC = r.tempC ?? narr[k].tempC
                narr[k].dark = narr[k].dark ?? r.dark
                narr[k].ice = narr[k].ice ?? r.ice
                narr[k].precip = narr[k].precip ?? r.precip
                if (narr[k].segments ?? []).isEmpty { narr[k].segments = nil }
            }
            for j in rules.indices where !used.contains(j) && !narr.contains(where: { $0.type == rules[j].type && $0.at == rules[j].at }) {
                narr.append(rules[j])
            }
            let st = base["startClock"] as? String ?? "17:40"
            narr.sort { relMin($0.at ?? clockAdd(st, 1439), st) < relMin($1.at ?? clockAdd(st, 1439), st) }
        }
        // subject category from the narrative re-targets the Koester module
        if let cat = categoryFrom(text), let idx = items.firstIndex(where: { ($0["input"] as? [String: Any])?["provider"] as? String == "KoesterRings" }) {
            var inp = items[idx]["input"] as! [String: Any]
            inp["category"] = cat
            let (evs, _, _) = await convert(inp)
            items[idx]["input"] = inp; items[idx]["events"] = evs
        }
        var added: [[String: Any]] = []
        var clock = lastClock()
        for n in narr {
            // family statements (plan, last seen) without a time come with the report itself
            let at = n.at ?? (["tripPlan", "lastSeen"].contains(n.type) ? clockAdd(base["startClock"] as? String ?? clock, 6) : clockAdd(clock, 5))
            if !["lastSeen", "tripPlan"].contains(n.type) { clock = at }
            let places = (n.places ?? []).compactMap { name in tatraPlaces.first { $0.name == name } }
            let sentPlaces = placesIn(n.sentence ?? (n.places ?? []).joined(separator: " "), segments: segments).map { $0.1 }
            let ps = places.isEmpty ? sentPlaces : places
            let p = ps.first?.at
            var inp: [String: Any] = ["at": at]
            switch n.type {
            case "lastSeen":
                guard let p else { continue }
                inp["provider"] = "KoesterRings"; inp["lat"] = p[0]; inp["lon"] = p[1]
                inp["at"] = base["startClock"] as? String ?? at
                inp["title"] = "IPP: ostatnio widziany \(at)" + (ps.first.map { ", \($0.name)" } ?? "")
                inp["category"] = categoryFrom(text) ?? ((base["subject"] as? [String: Any])?["category"] as? String ?? "hiker")
                if let idx = items.firstIndex(where: { ($0["input"] as? [String: Any])?["provider"] as? String == "KoesterRings" }) { items.remove(at: idx) }
                // the subject was alive at last-seen time: hypothermia clock starts there
                if var subj = base["subject"] as? [String: Any] { subj["lastContact"] = at; base["subject"] = subj }
            case "tripPlan":
                inp["provider"] = "TripPlan"; inp["text"] = n.sentence ?? ps.map(\.name).joined(separator: ", ")
                if n.sentence == nil { inp["points"] = ps.map(\.at) }
            case "car":
                let carP = p ?? tatraPlaces[0].at
                inp["provider"] = "TrailheadCar"; inp["lat"] = carP[0]; inp["lon"] = carP[1]
                if base["terrainRef"] != nil && normPL(n.sentence ?? "").contains("palenic") {
                    inp["points"] = [[49.23383, 20.08747], [49.2290, 20.0790], [49.2250, 20.0700]]   // lower Roztoka exit corridor
                }
                inp["title"] = "Auto na parkingu" + (ps.first.map { ": \($0.name)" } ?? "")
            case "cell112":
                let c = p ?? ippAt
                inp["provider"] = "Cell112Fix"; inp["lat"] = c[0]; inp["lon"] = c[1]; inp["radiusM"] = n.radiusM ?? 1500
            case "ratunek":
                guard let p else { continue }
                inp["provider"] = "RatunekPing"; inp["lat"] = p[0]; inp["lon"] = p[1]; inp["radiusM"] = n.radiusM ?? 25
            case "searched", "drone":
                let segs = (n.segments?.isEmpty == false ? n.segments! : segmentsIn(n.sentence ?? "", segments: segments))
                inp["provider"] = n.type == "drone" ? "DronePassEmpty" : "SegmentSearched"; inp["segments"] = segs
                if let pod = n.pod { inp["pod"] = pod }
            case "weather":
                inp["provider"] = "WeatherConditions"
                for (k, v) in [("visibilityM", n.visibilityM), ("windMs", n.windMs), ("tempC", n.tempC)] { if let v { inp[k] = v } }
                if let v = n.dark { inp["dark"] = v }
                if let v = n.ice { inp["ice"] = v }
                if let v = n.precip { inp["precip"] = v }
                if let v = n.visibilityM, v < 300 { added.append(await add(["provider": "Weather", "at": at, "factor": 1.2])) }
            case "found":
                guard let p else { continue }
                inp["provider"] = "Found"; inp["lat"] = p[0]; inp["lon"] = p[1]; inp["radiusM"] = n.radiusM ?? 50
                inp["title"] = "ZNALEZIONO" + (ps.first.map { ": \($0.name)" } ?? "")
            case "clue":
                guard let p else { continue }
                inp["provider"] = "Clue"; inp["lat"] = p[0]; inp["lon"] = p[1]; inp["radiusM"] = n.radiusM ?? 400
                inp["title"] = "Ślad: " + (n.description ?? n.sentence ?? "")
            default: continue
            }
            added.append(await add(inp))
        }
        let run = await rerun()
        var o = jsonObj(run)
        o["narrative"] = ["parsedBy": by, "note": note as Any, "items": added.map { ["id": $0["id"] ?? "", "events": $0["events"] ?? [], "note": $0["note"] ?? ""] }]
        lastRun = jsonData(o)
        return lastRun
    }

    // MARK: run / state

    func scenarioDict() -> [String: Any] {
        var d = base
        d["events"] = items.flatMap { ($0["events"] as? [[String: Any]]) ?? [] }
        if d["truth"] == nil { d["truth"] = nil }
        if let ref = d["terrainRef"] as? String, let t = try? Data(contentsOf: scenariosDir.appendingPathComponent(ref)),
           let to = try? JSONSerialization.jsonObject(with: t) { d["terrain"] = to }
        d["terrainRef"] = nil
        return d
    }

    func terrainStatus() -> [String: Any] {
        if base["terrainRef"] != nil { return ["source": "zawrat-terrain.json (OSM + DEM)", "flat": false] }
        let name = "studio-story"
        return ["source": "płaski teren (brak danych OSM/DEM dla tego obszaru)", "flat": true,
                "command": "zapisz historię (np. \(name)), potem: python3 rescue/tools/terrain/osm_terrain.py --scenario rescue/scenarios/\(name).json   # pobiera OSM + DEM z sieci, uruchom ręcznie"]
    }

    func rerun() async -> Data {
        let d = scenarioDict()
        guard let s = try? JSONDecoder().decode(Scenario.self, from: jsonData(d)) else {
            lastRun = jsonData(["error": "scenario decode failed", "story": storyJSON()])
            return lastRun
        }
        var o = jsonObj(await StoryPipeline.runData(s))
        o["story"] = storyJSON()
        o["terrain"] = terrainStatus()
        lastRun = jsonData(o)
        return lastRun
    }

    func storyJSON() -> [String: Any] {
        var b = base
        b["terrain"] = nil
        return ["base": b, "items": items]
    }

    public func setStory(_ body: Data) async -> Data {
        if !base.isEmpty { snapshot() }
        let o = jsonObj(body)
        if let b = o["base"] as? [String: Any] {
            base = b.isEmpty ? zawratTemplate() : b
            if base["segments"] == nil, let ipp = ((b["ipp"] as? [String: Any])?["at"] as? [Any])?.compactMap(num), ipp.count == 2 {
                base = autoTemplate(ipp: ipp, startClock: b["startClock"] as? String ?? "17:40")
            }
        } else if base.isEmpty { base = zawratTemplate() }
        items = []
        for e in (o["events"] as? [[String: Any]]) ?? [] { await add(e) }
        return await rerun()
    }

    public func addEvent(_ body: Data) async -> Data {
        if base.isEmpty { _ = await newStory(jsonData(["template": "zawrat"])) }
        snapshot()
        let o = jsonObj(body)
        let inp = (o["event"] as? [String: Any]) ?? o
        let item = await add(inp)
        var r = jsonObj(await rerun())
        r["added"] = item
        if let steps = r["steps"] as? [[String: Any]] { r["step"] = steps.last }
        lastRun = jsonData(r)
        return lastRun
    }

    public func edit(_ body: Data) async -> Data {
        let o = jsonObj(body)
        if (o["op"] as? String) == "undo" {
            if let (b, it) = undoStack.popLast() { base = b; items = it }
            return await rerun()
        }
        guard let id = o["id"] as? String, let idx = items.firstIndex(where: { ($0["id"] as? String) == id }) else { return await rerun() }
        snapshot()
        switch o["op"] as? String ?? "" {
        case "delete": items.remove(at: idx)
        case "update":
            // drag-and-drop: patch the module input (new lat/lon after a pin drag, new "at" after a timeline drag) and re-convert
            var inp = items[idx]["input"] as? [String: Any] ?? [:]
            let patch = o["input"] as? [String: Any] ?? [:]
            if patch["lat"] != nil || patch["lon"] != nil { inp["latlon"] = nil; inp["point"] = nil }
            for (k, v) in patch { inp[k] = v }
            let c = await convert(inp)
            guard !c.events.isEmpty else { undoStack.removeLast(); break }
            items[idx]["input"] = inp; items[idx]["events"] = c.events
            // keep the list in scenario-time order
            let start = base["startClock"] as? String ?? "17:40"
            func t(_ it: [String: Any]) -> Int { relMin(((it["events"] as? [[String: Any]])?.first?["at"] as? String) ?? start, start) }
            let moved = items.remove(at: idx)
            let pos = items.firstIndex { t($0) > t(moved) } ?? items.count
            items.insert(moved, at: pos)
        case "up", "down":
            // reorder = swap times with the neighbour (the stream is ordered by scenario time)
            let j = (o["op"] as? String) == "up" ? idx - 1 : idx + 1
            guard j >= 0, j < items.count else { break }
            var a = items[idx]["input"] as! [String: Any], b = items[j]["input"] as! [String: Any]
            let ta = (items[idx]["events"] as? [[String: Any]])?.first?["at"] as? String ?? "", tb = (items[j]["events"] as? [[String: Any]])?.first?["at"] as? String ?? ""
            a["at"] = tb; b["at"] = ta
            let ea = await convert(a), eb = await convert(b)
            items[idx]["input"] = a; items[idx]["events"] = ea.events
            items[j]["input"] = b; items[j]["events"] = eb.events
            items.swapAt(idx, j)
        default: break
        }
        return await rerun()
    }

    public func get() async -> Data {
        if base.isEmpty { return await newStory(jsonData(["template": "zawrat"])) }
        return lastRun
    }

    public func save(_ body: Data) async -> Data {
        let raw = jsonObj(body)["name"] as? String ?? "studio-story"
        let name = String(String(normPL(raw).prefix(60)).map { $0.isLetter || $0.isNumber ? $0 : "-" }).trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        guard !name.isEmpty, name != "zawrat", name != "zawrat-terrain" else { return jsonData(["error": "zła nazwa (zawrat jest zarezerwowany)"]) }
        guard !name.hasSuffix("-terrain") else { return jsonData(["error": "nazwa nie może kończyć się na -terrain"]) }
        let target = scenariosDir.appendingPathComponent("\(name).json")
        if let old = try? Data(contentsOf: target), jsonObj(old)["studio"] as? Bool != true {
            return jsonData(["error": "\(name).json już istnieje i nie pochodzi ze Studio - wybierz inną nazwę"])
        }
        var d = scenarioDict()
        d["studio"] = true
        if base["terrainRef"] == nil { d["terrain"] = base["terrain"] }  // flat
        let url = scenariosDir.appendingPathComponent("\(name).json")
        do {
            try JSONSerialization.data(withJSONObject: d, options: [.prettyPrinted, .sortedKeys]).write(to: url)
        } catch { return jsonData(["error": "zapis nieudany: \(error.localizedDescription)"]) }
        var o: [String: Any] = ["saved": "rescue/scenarios/\(name).json", "run": "cd rescue && swift run rescue-demo scenarios/\(name).json   # -> out/\(name).html"]
        if base["terrainRef"] == nil {
            o["terrainCommand"] = "python3 rescue/tools/terrain/osm_terrain.py --scenario rescue/scenarios/\(name).json   # sieć: OSM + DEM, uruchom ręcznie"
        }
        return jsonData(o)
    }
}
