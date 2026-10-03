//! Port of Sources/RescueKit/ModuleRegistry.swift
use crate::kit::*;
use once_cell::sync::Lazy;
use serde_json::{json, Value};
use std::collections::BTreeMap;

/// Event schema a module (provider) accepts, for the Story Studio palette and GET /modules.
#[derive(Clone, Debug)]
pub struct ModuleField {
    pub key: String,
    pub label: String,
    pub type_: String, // time | number | text | textarea | latlon | segments | select | bool
    pub def: String,
    pub options: Vec<String>,
}
impl ModuleField {
    pub fn new(key: &str, label: &str, type_: &str, def: &str, options: Vec<String>) -> ModuleField {
        ModuleField { key: key.into(), label: label.into(), type_: type_.into(), def: def.into(), options }
    }
    /// Swift `ModuleField(key, label, type)` with default "" and no options.
    pub fn f(key: &str, label: &str, type_: &str) -> ModuleField {
        Self::new(key, label, type_, "", vec![])
    }
    /// Swift `ModuleField(key, label, type, def)`.
    pub fn d(key: &str, label: &str, type_: &str, def: &str) -> ModuleField {
        Self::new(key, label, type_, def, vec![])
    }
    pub fn json(&self) -> Value {
        json!({"key": self.key, "label": self.label, "type": self.type_, "default": self.def, "options": self.options})
    }
}

#[derive(Clone, Debug)]
pub struct ModuleSchema {
    pub name: String,
    pub label: String,
    pub help: String,
    pub fields: Vec<ModuleField>,
}
impl ModuleSchema {
    pub fn new(name: &str, label: &str, help: &str, fields: Vec<ModuleField>) -> ModuleSchema {
        ModuleSchema { name: name.into(), label: label.into(), help: help.into(), fields }
    }
    pub fn json(&self) -> Value {
        json!({"name": self.name, "label": self.label, "help": self.help,
               "fields": self.fields.iter().map(|f| f.json()).collect::<Vec<_>>()})
    }
}

/// Every studio-composable module declares its schema next to its provider.
pub trait StudioModule {
    fn schema() -> ModuleSchema;
}

/// Koester-style distance quantiles (km, 25/50/75/95%) per subject category. ILLUSTRATIVE approximations.
pub static KOESTER_CATEGORIES: Lazy<BTreeMap<String, Vec<f64>>> = Lazy::new(|| {
    let mut m = BTreeMap::new();
    m.insert("hiker".to_string(), vec![1.1, 3.0, 5.8, 11.5]);
    m.insert("climber".to_string(), vec![0.4, 1.0, 2.0, 5.0]);
    m.insert("skier".to_string(), vec![1.0, 2.4, 4.5, 9.0]);
    m.insert("gatherer".to_string(), vec![0.9, 1.6, 2.8, 6.0]);
    m.insert("child-7-9".to_string(), vec![0.5, 1.0, 2.0, 4.1]);
    m.insert("dementia".to_string(), vec![0.3, 0.8, 1.6, 3.2]);
    m.insert("despondent".to_string(), vec![0.5, 1.2, 2.5, 6.0]);
    m
});
pub fn koester_categories() -> &'static BTreeMap<String, Vec<f64>> {
    &KOESTER_CATEGORIES
}

/// FieldReport is another agent's provider: its schema lives here, not in its file.
pub fn field_report_schema() -> ModuleSchema {
    ModuleSchema::new(
        "FieldReport",
        "Meldunek z terenu (tekst)",
        "Meldunek radiowy po polsku, parsowany lokalnie (qwen3 przez Ollama, fallback reguły).",
        vec![ModuleField::f("at", "Godzina", "time"), ModuleField::d("text", "Treść meldunku", "textarea", "Zespół A, S6 przeszukany, nic, POD 70%")],
    )
}

pub fn all_module_schemas() -> Vec<ModuleSchema> {
    vec![
        KoesterRingsProvider::schema(),
        TripPlanProvider::schema(),
        TrailheadCarProvider::schema(),
        Cell112FixProvider::schema(),
        WeatherProvider::schema(),
        WeatherConditionsProvider::schema(),
        SegmentSearchedProvider::schema(),
        DronePassEmptyProvider::schema(),
        ClueProvider::schema(),
        RatunekPingProvider::schema(),
        FoundProvider::schema(),
        field_report_schema(),
        TerrainProvider::schema(),
        TerrainDifficultyProvider::schema(),
    ]
}
