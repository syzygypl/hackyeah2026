//! Port of Providers/ClueProvider.swift
use crate::kit::*;

/// A clue found in the field (glove, footprint, witness): soft sector around it, tighter when strong.
pub struct ClueProvider<'a> {
    pub scenario: &'a Scenario,
}
impl<'a> ClueProvider<'a> {
    pub fn new(s: &'a Scenario) -> Self {
        ClueProvider { scenario: s }
    }

    /// Sighting vs trace (an item or track found later, dropped at an unknown time).
    pub fn is_trace(e: &ScenarioEvent) -> bool {
        if let Some(k) = &e.clue_kind {
            return k == "trace";
        }
        let t = e.title.to_lowercase();
        let seen = ["świad", "swiad", "widzia", "widzian", "spotka", "rozmawia", "wpis", "książ", "ksiaz", "obsługa", "obsluga"];
        let item = ["rękawicz", "rekawicz", "plecak", "czapk", "kij", "but ", "buty", "kurtk", "butelk", "opakow", "telefon znalez", "ślad", "slad", "odcisk"];
        if seen.iter().any(|w| t.contains(w)) {
            return false;
        }
        item.iter().any(|w| t.contains(w))
    }

    /// A clue that reports the person found ("found": true, or "ZNALEZIONO" in the title) closes the case.
    pub fn is_find(e: &ScenarioEvent) -> bool {
        if e.found == Some(true) {
            return true;
        }
        let t = e.title.to_lowercase();
        (t.contains("znaleziono") || t.contains("odnaleziono")) && !t.contains("nie znaleziono") && !t.contains("nic nie")
    }

    /// Trace with a time window [last sighting, found time]: soft circle widening with the window + direction corridor.
    pub fn trace_hints(&self, s: &Scenario) -> Vec<LocationHint> {
        let trails: Vec<Vec<Coord>> = s.terrain.trails.iter().map(|t| t.points.iter().map(|p| Coord::from_slice(p)).collect()).collect();
        let graph = if trails.is_empty() { None } else { Some(TrailGraph::new(&trails)) };
        let ipp = Coord::from_slice(s.events_for("KoesterRings").first().and_then(|e| e.point.as_ref()).unwrap_or(&s.ipp.at));
        let mut out = Vec::new();
        let evs = s.events_for("Clue");
        for (i, e) in evs.iter().enumerate() {
            if !(Self::is_trace(e) && !Self::is_find(e) && e.point.is_some()) {
                continue;
            }
            let p = Coord::from_slice(e.point.as_ref().unwrap());
            let found = s.minute(&e.at);
            let sightings: Vec<&ScenarioEvent> = evs
                .iter()
                .copied()
                .filter(|c| !Self::is_trace(c) && !Self::is_find(c) && c.point.is_some() && s.observed_minute(c) <= found)
                .collect();
            let last = argmax_first(&sightings, |c| s.observed_minute(c)).map(|k| sightings[k]);
            let window_start = last
                .map(|l| s.observed_minute(l))
                .or_else(|| s.subject.last_contact.as_ref().map(|lc| s.minute_past(lc)))
                .unwrap_or(0);
            let hours = (((found - window_start) as f64).max(0.0)) / 60.0;
            let sigma = (300.0 + 400.0 * hours).min(1500.0);
            out.push(LocationHint::new(
                format!("Clue-{}-trace", i),
                "Clue",
                found,
                s.clock(found),
                format!("Ślad (okno {}-{}): umiarkowanie, promień {:.0} m", s.clock(window_start), s.clock(found), sigma),
                "Przedmiot/ślad upuszczony w nieznanym czasie: osoba tu była, ale mogła pójść dalej.",
                LocationHintEvidence::Corridor { points: vec![p], sigma_m: sigma, floor: 0.4 },
                Some(p),
            ));
            let from = last.map(|l| Coord::from_slice(l.point.as_ref().unwrap())).unwrap_or(ipp);
            if let Some(g) = &graph {
                if let Some(path) = g.route(from, p) {
                    if TrailGraph::length(&path) > 300.0 {
                        let lbl = last.map(|l| format!("obserwacja {}", s.clock(s.observed_minute(l)))).unwrap_or_else(|| "IPP".to_string());
                        let km = TrailGraph::length(&path) / 1000.0;
                        out.push(LocationHint::new(
                            format!("Clue-{}-direction", i),
                            "Clue",
                            found,
                            s.clock(found),
                            format!("Kierunek: {} -> ślad ({:.1} km po szlakach)", lbl, km),
                            "Droga szlakami od ostatniej obserwacji do śladu: kierunek ruchu.",
                            LocationHintEvidence::Corridor { points: path, sigma_m: 250.0, floor: 0.6 },
                            None,
                        ));
                    }
                }
            }
        }
        out
    }

    /// Last known point: each precise sighting observed later than the current last known point moves the Koester rings.
    pub fn last_known_points(&self, s: &Scenario) -> Vec<LocationHint> {
        let ring = match s.events_for("KoesterRings").first() {
            Some(r) => *r,
            None => return vec![],
        };
        let ipp = Coord::from_slice(ring.point.as_ref().unwrap_or(&s.ipp.at));
        let q = ring.quantiles_km.clone().unwrap_or_else(|| vec![1.1, 3.0, 5.8, 11.5]);
        let mut current: Option<(Coord, i64)> = None;
        let mut out = Vec::new();
        let ipp_seen = s.ipp.seen_at.as_ref().map(|x| s.minute_past(x)).unwrap_or(i64::MIN);
        let mut sightings: Vec<(usize, &ScenarioEvent)> = s
            .events_for("Clue")
            .into_iter()
            .enumerate()
            .filter(|(_, e)| !Self::is_find(e) && e.radius_m.unwrap_or(500.0) <= 500.0 && e.point.is_some())
            .filter(|(_, e)| !(s.has("traceWindow") && Self::is_trace(e)))
            .collect();
        sightings.sort_by_key(|(_, e)| s.minute(&e.at));
        for (i, e) in sightings {
            let seen = s.observed_minute(e);
            if !(seen > ipp_seen.max(current.map(|c| c.1).unwrap_or(i64::MIN))) {
                continue;
            }
            let lkp = Coord::from_slice(e.point.as_ref().unwrap());
            if current.is_none() && Geo::meters(lkp, ipp) < 200.0 {
                continue;
            }
            let base = hint(
                s,
                e,
                i,
                LocationHintEvidence::LastKnownPoint { ipp, lkp, previous: current.map(|c| c.0), quantiles_km: q.clone(), weight: 0.7 },
                Some(lkp),
            );
            out.push(LocationHint::new(
                format!("Clue-{}-lkp", i),
                "Clue",
                base.minute,
                base.clock.clone(),
                format!("Ostatni znany punkt: pierścienie przesunięte na obserwację z {}", s.clock(seen)),
                "70% pierścieni Koestera od ostatniej pewnej obserwacji, 30% od IPP.",
                base.evidence,
                Some(lkp),
            ));
            current = Some((lkp, seen));
        }
        out
    }
}
impl<'a> HintProvider for ClueProvider<'a> {
    fn name(&self) -> &str {
        "Clue"
    }
    fn hints(&self, clock: ScenarioClock) -> Vec<LocationHint> {
        let s = self.scenario;
        let trace_mode = s.has("traceWindow");
        let mut items: Vec<LocationHint> = s
            .events_for("Clue")
            .into_iter()
            .enumerate()
            .filter_map(|(i, e)| {
                let p = Coord::from_slice(e.point.as_ref()?);
                if Self::is_find(e) {
                    return Some(hint(s, e, i, LocationHintEvidence::Found { at: p, accuracy_m: e.radius_m.unwrap_or(30.0) }, Some(p)));
                }
                if trace_mode && Self::is_trace(e) {
                    return None;
                }
                Some(hint(s, e, i, LocationHintEvidence::Sector { center: p, radius_m: e.radius_m.unwrap_or(500.0) }, Some(p)))
            })
            .collect();
        items.extend(self.last_known_points(s));
        if trace_mode {
            items.extend(self.trace_hints(s));
        }
        scripted(items, clock)
    }
}

impl<'a> StudioModule for ClueProvider<'a> {
    fn schema() -> ModuleSchema {
        ModuleSchema::new("Clue", "Ślad w terenie", "Rękawiczka, ślad, świadek: miękki obszar wokół śladu.",
            vec![ModuleField::f("at", "Godzina", "time"), ModuleField::f("latlon", "Miejsce śladu (kliknij mapę)", "latlon"),
                 ModuleField::d("radiusM", "Promień [m] (300 mocny, 800 słaby)", "number", "500"), ModuleField::d("title", "Opis", "text", "Rękawiczka przy szlaku")])
    }
}
