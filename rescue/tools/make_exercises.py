"""Training exercises (tryb ćwiczeń) from simulator cases - fictional, truth consistent with the real terrain.

  python3 rescue/tools/make_exercises.py

For each exercise below it takes one case from rescue/eval/sim/out/<run>/ (simulated on the real DEM/OSM terrain, see
eval/sim/README.md), cuts it at a "pickup" moment and writes:
  rescue/scenarios/exercises/<id>.json      what the trainee knows at pickup (events up to then, earlier searches,
                                            a team already in the field) + the "exercise" block (briefing, budget)
  rescue/exercises/<id>.truth.json          hidden: find point, scripted future events (revealed as time advances).
                                            Not under any served directory; only rescue-server's exercise routes read it.
The exercise scenarios live in a subdirectory on purpose: they are not incidents (not listed by /api/scenarios,
/api/incidents or the team roster).
"""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
RESCUE = os.path.dirname(HERE)
SIM = os.path.join(RESCUE, "eval", "sim", "out")
OUT_SC = os.path.join(RESCUE, "scenarios", "exercises")
OUT_TR = os.path.join(RESCUE, "exercises")

EXERCISES = [
    {"id": "cwiczenie-bieszczady", "run": "v2-bieszczady-wetlinska", "case": "case-0001", "region": "bieszczady-wetlinska",
     "kind": "góry", "title": "Ćwiczenie: turysta w Bieszczadach, zmrok i oblodzenie (scenariusz fikcyjny)",
     "place": "Połonina Wetlińska", "pickupAfter": 62, "budgetMin": 240,
     "who": "Mężczyzna, 19 lat, turysta pieszy. Wyszedł rano na Połoninę Wetlińską, ostatni kontakt telefoniczny 10:52. Zgłoszenie od rodziny o 17:13.",
     "clue": {"after": 30, "frac": 0.92, "title": "Znalezisko: rękawiczka przy potoku (zgłosił leśniczy)", "clueKind": "trace", "radiusM": 300},
     "inProgress": "gopr-a"},
    {"id": "cwiczenie-sniardwy", "run": "v3-sniardwy", "case": "case-0001", "region": "sniardwy",
     "kind": "woda", "title": "Ćwiczenie: kajakarz po wywrotce na Śniardwach (scenariusz fikcyjny)",
     "place": "Jezioro Śniardwy", "pickupAfter": 90, "budgetMin": 240,
     "who": "Mężczyzna, 52 lata, kajakarz, w kamizelce. Wypłynął rano, ostatni kontakt 11:57. Zgłoszenie o 15:50.",
     "clue": {"after": 50, "frac": 0.9, "title": "Ślad: wiosło wyrzucone na brzeg (zgłosił wędkarz)", "clueKind": "trace", "radiusM": 400},
     "inProgress": "wopr-boat"},
    {"id": "cwiczenie-morskie-oko", "run": "v2-morskie-oko", "case": "case-0061", "region": "morskie-oko",
     "kind": "góry, senior", "title": "Ćwiczenie: senior z demencją nad Morskim Okiem (scenariusz fikcyjny)",
     "place": "Morskie Oko / Dolina Rybiego Potoku", "pickupAfter": 50, "budgetMin": 240,
     "who": "Mężczyzna, 85 lat, demencja. Rano wyszedł ze schroniska na spacer, ostatni kontakt 9:13. Zgłoszenie o 17:41. Deszcz, 1°C.",
     "clue": {"after": 40, "frac": 0.85, "title": "Świadek: turystka widziała starszego mężczyznę bez kurtki", "clueKind": "sighting", "radiusM": 350},
     # difficulty: the early sighting is uncertain and two later sightings point the other way (road down the valley, M8),
     # so at pickup M4 ~54% vs M8 ~43% and the helicopter (only before dusk at 19:01) has to be bet on one of them.
     # All radii stay > 500 m on purpose: a sighting <= 500 m moves the Koester rings (ClueProvider) and flips the map.
     # Truth and future events unchanged.
     "knownEdits": {("Clue", "18:01"): {"radiusM": 650, "title": "Świadek: widziany/a około 09:25 (turysta niepewny miejsca)"}},
     "extraKnown": [{"provider": "Clue", "at": "18:16", "title": "Świadek: kierowca busa widział starszego mężczyznę na drodze do Palenicy około 11:40",
                     "detail": "Zgłoszenie telefoniczne po komunikacie w radiu; opis ubrania się zgadza.", "point": [49.2135, 20.0815],
                     "radiusM": 530, "clueKind": "sighting", "seenAt": "11:40"},
                    {"provider": "Clue", "at": "18:26", "title": "Świadek: rowerzysta minął starszego mężczyznę schodzącego drogą w dół doliny, około 12:05",
                     "detail": "Nie pamięta ubrania, widział go z daleka.", "point": [49.2165, 20.0855],
                     "radiusM": 600, "clueKind": "sighting", "seenAt": "12:05"}],
     "inProgress": "gopr-a"},
]


def hm(s):
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def clock(m):
    m %= 1440
    return f"{m // 60:02d}:{m % 60:02d}"


def meters(a, b):
    kx = 111320 * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot((a[1] - b[1]) * kx, (a[0] - b[0]) * 111320)


def nearest_seg(p, segs):
    return min(segs, key=lambda s: meters(p, s["seed"]))["id"]


def main():
    os.makedirs(OUT_SC, exist_ok=True)
    os.makedirs(OUT_TR, exist_ok=True)
    for x in EXERCISES:
        d = os.path.join(SIM, x["run"])
        case = json.load(open(os.path.join(d, "cases", x["case"] + ".json"), encoding="utf-8"))
        truth = json.load(open(os.path.join(d, "truth", x["case"] + ".truth.json"), encoding="utf-8"))
        start = hm(case["startClock"])
        pickup = start + x["pickupAfter"]
        segs = case["segments"]
        truth_seg = nearest_seg(truth["find"], segs)   # approximate (engine: nearest seed per cell); only to keep pre-searched segments honest
        known = [e for e in case["events"] if (hm(e["at"]) - start) % 1440 <= x["pickupAfter"]]
        # optional per-exercise tuning of what the trainee knows at pickup (difficulty), truth and future untouched
        for (prov, at), upd in x.get("knownEdits", {}).items():
            for e in known:
                if e["provider"] == prov and e["at"] == at:
                    e.update(upd)
        known += [dict(e) for e in x.get("extraKnown", [])]
        future = [e for e in case["events"] if (hm(e["at"]) - start) % 1440 > x["pickupAfter"]]
        # mid-way: two hasty searches near the IPP already came back empty, one team is still out
        ipp = case["ipp"]["at"]
        near = [s["id"] for s in sorted(segs, key=lambda s: meters(ipp, s["seed"])) if s["id"] != truth_seg]
        known.append({"provider": "SegmentSearched", "at": clock(pickup - 25), "title": f"Patrol rozpoznawczy: {near[0]} przeszukany, nic",
                      "detail": "Szybkie przejście na początku akcji (przed przejęciem).", "segments": [near[0]], "pod": 0.5})
        known.append({"provider": "SegmentSearched", "at": clock(pickup - 10), "title": f"Patrol rozpoznawczy: {near[1]} przeszukany, nic",
                      "detail": "Szybkie przejście na początku akcji (przed przejęciem).", "segments": [near[1]], "pod": 0.5})
        in_prog = {"team": x["inProgress"], "segmentId": near[2], "since": clock(pickup - 20), "until": clock(pickup + 40)}
        # one truthful scripted clue from the true path (revealed when the clock passes it)
        path = truth["path"]
        p = path[min(len(path) - 1, int(len(path) * x["clue"]["frac"]))]
        c = {"provider": "Clue", "at": clock(pickup + x["clue"]["after"]), "title": x["clue"]["title"],
             "detail": "Zgłoszenie z zewnątrz w trakcie akcji.", "point": [p[0], p[1]], "radiusM": x["clue"]["radiusM"], "clueKind": x["clue"]["clueKind"]}
        if x["clue"]["clueKind"] == "sighting":
            c["seenAt"] = p[2]
        future.append(c)
        # night: the planner's safety rules (headlamps, rope teams, no heli at night) switch on with dark = true
        wc = [e for e in case["events"] if e["provider"] == "WeatherConditions"]
        if wc and not wc[-1].get("dark"):
            night = dict(wc[-1]); night.update({"at": clock(max(pickup + 30, hm("19:00"))), "title": "Zapadł zmrok", "detail": "Ciemno, czołówki.", "dark": True})
            future.append(night)
        future.sort(key=lambda e: (hm(e["at"]) - start) % 1440)
        sc = dict(case)
        sc.pop("terrain", None)   # the server attaches scenarios/<region>-terrain.json (real OSM/DEM)
        sc["incident"] = x["title"]
        sc["subject"] = dict(case["subject"], name="Osoba fikcyjna (ćwiczenie)")
        sc["events"] = known
        sc["exercise"] = {"id": x["id"], "title": x["title"].replace(" (scenariusz fikcyjny)", ""), "place": x["place"], "kind": x["kind"],
                          "region": x["region"], "pickupClock": clock(pickup), "budgetMin": x["budgetMin"], "stepMin": 30,
                          "who": x["who"], "inProgress": [in_prog], "fictional": True,
                          "source": "symulator zaginięć na prawdziwym terenie (rescue/eval/sim), osoba i zdarzenia fikcyjne"}
        tr = {"id": x["id"], "find": truth["find"], "truthSegApprox": truth_seg, "category": truth["category"], "behaviour": truth["behaviour"],
              "stopReason": truth["stopReason"], "future": future, "source": f"{x['run']}/{x['case']}"}
        json.dump(sc, open(os.path.join(OUT_SC, x["id"] + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        json.dump(tr, open(os.path.join(OUT_TR, x["id"] + ".truth.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"{x['id']}: pickup {clock(pickup)}, {len(known)} known, {len(future)} future, truth ~{truth_seg}, in progress {in_prog}")


if __name__ == "__main__":
    main()
