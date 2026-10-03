import Foundation

/// Event schema a module (provider) accepts, for the Story Studio palette and GET /modules.
/// Field keys map 1:1 to scenario event keys, except lat/lon -> point and `text` (parsed server-side).
public struct ModuleField: Sendable {
    public let key: String, label: String, type: String   // time | number | text | textarea | latlon | segments | select | bool
    public let def: String, options: [String]
    public init(_ key: String, _ label: String, _ type: String, _ def: String = "", options: [String] = []) {
        self.key = key; self.label = label; self.type = type; self.def = def; self.options = options
    }
    public var json: [String: Any] { ["key": key, "label": label, "type": type, "default": def, "options": options] }
}

public struct ModuleSchema: Sendable {
    public let name: String, label: String, help: String
    public let fields: [ModuleField]
    public var json: [String: Any] { ["name": name, "label": label, "help": help, "fields": fields.map(\.json)] }
}

/// Every studio-composable module declares its schema next to its provider.
public protocol StudioModule { static var schema: ModuleSchema { get } }

/// Koester-style distance quantiles (km, 25/50/75/95%) per subject category. ILLUSTRATIVE approximations,
/// not ISRID tables (those are copyrighted, dbS Productions).
public let koesterCategories: [String: [Double]] = [
    "hiker": [1.1, 3.0, 5.8, 11.5],
    "climber": [0.4, 1.0, 2.0, 5.0],
    "skier": [1.0, 2.4, 4.5, 9.0],
    "gatherer": [0.9, 1.6, 2.8, 6.0],
    "child-7-9": [0.5, 1.0, 2.0, 4.1],
    "dementia": [0.3, 0.8, 1.6, 3.2],
    "despondent": [0.5, 1.2, 2.5, 6.0],
]

/// FieldReport is another agent's provider: its schema lives here, not in its file.
let fieldReportSchema = ModuleSchema(name: "FieldReport", label: "Meldunek z terenu (tekst)",
    help: "Meldunek radiowy po polsku, parsowany lokalnie (qwen3 przez Ollama, fallback reguły).",
    fields: [ModuleField("at", "Godzina", "time"), ModuleField("text", "Treść meldunku", "textarea", "Zespół A, S6 przeszukany, nic, POD 70%")])

public func allModuleSchemas() -> [ModuleSchema] {
    [KoesterRingsProvider.schema, TripPlanProvider.schema, TrailheadCarProvider.schema, Cell112FixProvider.schema,
     WeatherProvider.schema, WeatherConditionsProvider.schema, SegmentSearchedProvider.schema,
     DronePassEmptyProvider.schema, ClueProvider.schema, RatunekPingProvider.schema, fieldReportSchema,
     TerrainProvider.schema, TerrainDifficultyProvider.schema]
}
