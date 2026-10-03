"""Tests for interview.py. Offline tests always run; live tests call the local model and skip without Ollama.

Run:  python3 -m unittest -v test_interview      (prints the field accuracy table at the end)
"""
import json
import os
import time
import unittest
import urllib.request

import interview as I

HERE = os.path.dirname(os.path.abspath(__file__))
SCN = json.load(open(I.SCENARIO))
TRIP = next(e for e in SCN["events"] if e["provider"] == "TripPlan")["points"]
SAMPLES = ["zawrat", "vague", "contradictory"]
FIELDS = ["points", "returnRoute", "startTime", "expectedBack", "lastSeen", "alone", "alternativeDestinations", "uncertain"]
RESULTS = {}


def account(**kw):
    a = {"source": "żona", "route": [], "route_sure": True, "options": [], "return_route": "unknown", "return_via": [],
         "start_time": "", "start_time_sure": True, "expected_back": "", "expected_back_sure": True, "alone": "tak",
         "last_contact_place": "", "last_contact_time": "", "route_quote": ""}
    a.update(kw)
    return a


def text(name):
    return open(os.path.join(HERE, "samples", name + ".txt")).read()


def observed(ev):
    i = ev["interview"]
    return {"points": ev["points"], "returnRoute": i["returnRoute"], "startTime": i["startTime"],
            "expectedBack": i["expectedBack"], "lastSeen": i["lastSeen"], "alone": i["alone"],
            "alternativeDestinations": sorted(a["via"][-1] for a in i["alternatives"]),
            "uncertain": sorted(u["field"] for u in i["uncertain"])}


def score(ev, exp):
    got = observed(ev)
    want = dict(exp, alternativeDestinations=sorted(exp["alternativeDestinations"]), uncertain=sorted(exp["uncertain"]))
    return {f: got[f] == want[f] for f in FIELDS}, got


class Offline(unittest.TestCase):
    """Deterministic part: gazetteer, routing, merge, validation. No model."""

    def test_zawrat_route_reproduces_scenario_points(self):
        raw = {"accounts": [account(route=["Palenica", "Roztoka", "Pięć Stawów", "Zawrat"], return_route="same_way")]}
        ev = I.build(raw, text("zawrat"), SCN)
        self.assertEqual(ev["points"], TRIP)
        self.assertFalse({"route", "return_route"} & {u["field"] for u in ev["interview"]["uncertain"]})
        self.assertEqual(ev["radiusM"], 300)

    def test_every_gazetteer_place_resolves_inside_or_flagged(self):
        g = I.gazetteer(SCN)
        self.assertEqual({n for n, _ in I.STEMS}, set(g))
        outside = [n for n, p in g.items() if not I.in_bbox(p["at"], SCN["bbox"])]
        self.assertEqual(outside, ["Palenica Białczańska"])

    def test_model_cannot_invent_places_or_coordinates(self):
        raw = {"accounts": [account(route=["Palenica", "Kasprowy Wierch", "Świnica"])]}
        ev = I.build(raw, text("zawrat"), SCN)  # Kasprowy: not in gazetteer; Świnica: not in this interview
        flags = ev["interview"]["flags"]
        self.assertIn("unknown_place:Kasprowy Wierch", flags)
        self.assertIn("not_in_text:Świnica", flags)
        self.assertNotIn("Świnica", ev["interview"]["waypoints"])
        self.assertTrue(all(I.in_bbox(p, SCN["bbox"]) for p in ev["points"]))

    def test_conflicting_accounts_keep_common_part_only(self):
        raw = {"accounts": [
            account(source="żona", route=["Palenica", "Roztoka", "Pięć Stawów", "Zawrat"], return_route="same_way"),
            account(source="syn", route=["Pięć Stawów", "Szpiglasowa Przełęcz", "Morskie Oko"], return_route="different")]}
        ev = I.build(raw, text("contradictory"), SCN)
        i = ev["interview"]
        self.assertEqual(i["waypoints"][-1], "Schronisko w Dolinie Pięciu Stawów")
        self.assertEqual(sorted(a["via"][-1] for a in i["alternatives"]), ["Morskie Oko", "Zawrat"])
        self.assertIn("route", [u["field"] for u in i["uncertain"]])
        self.assertEqual(i["returnRoute"], "unknown")
        self.assertEqual(ev["radiusM"], 500)

    def test_bad_or_hedged_times_are_not_guessed(self):
        raw = {"accounts": [account(start_time="może o siódmej", expected_back="18:00", expected_back_sure=False)]}
        i = I.build(raw, text("vague"), SCN)["interview"]
        self.assertEqual((i["startTime"], i["expectedBack"]), ("", ""))
        self.assertEqual({"start_time", "expected_back"} - {u["field"] for u in i["uncertain"]}, set())

    def test_conflicting_times_become_uncertain(self):
        raw = {"accounts": [account(source="żona", expected_back="16:00"), account(source="syn", expected_back="18:00")]}
        i = I.build(raw, text("contradictory"), SCN)["interview"]
        self.assertEqual(i["expectedBack"], "")
        self.assertTrue(any(u["field"] == "expected_back" and "16:00" in u["reason"] for u in i["uncertain"]))

    def test_quote_must_be_verbatim(self):
        raw = {"accounts": [account(route=["Zawrat"], route_quote="Poszedł na Zawrat przez Kasprowy.")]}
        ev = I.build(raw, text("zawrat"), SCN)
        self.assertIn("quote_not_verbatim:żona", ev["interview"]["flags"])
        self.assertNotIn("Kasprowy", ev["detail"])


def ollama_ready():
    try:
        with urllib.request.urlopen(f"{I.OLLAMA}/api/tags", timeout=2) as r:
            return I.MODEL in [m["name"] for m in json.load(r)["models"]]
    except Exception:
        return False


@unittest.skipUnless(ollama_ready(), f"Ollama or {I.MODEL} not available")
class Live(unittest.TestCase):
    """Real local model on the 3 fictional interviews, field accuracy against samples/*.expected.json."""

    @classmethod
    def setUpClass(cls):
        for name in SAMPLES:
            t0 = time.time()
            ev = I.build(I.ask_model(text(name)), text(name), SCN)
            exp = json.load(open(os.path.join(HERE, "samples", name + ".expected.json")))
            ok, got = score(ev, exp)
            RESULTS[name] = {"ok": ok, "got": got, "exp": exp, "s": round(time.time() - t0, 1), "ev": ev}

    @classmethod
    def tearDownClass(cls):
        if not RESULTS:
            return
        print(f"\n\nField accuracy, model {I.MODEL}, temperature 0\n")
        print(f"| field | {' | '.join(SAMPLES)} |\n|---|{'---|' * len(SAMPLES)}")
        for f in FIELDS:
            print(f"| {f} | " + " | ".join("ok" if RESULTS[s]["ok"][f] else "MISS" for s in SAMPLES) + " |")
        n = sum(sum(r["ok"].values()) for r in RESULTS.values())
        tot = len(FIELDS) * len(RESULTS)
        print(f"\nTotal {n}/{tot} = {100 * n / tot:.0f}%  " + ", ".join(
            f"{s} {sum(r['ok'].values())}/{len(FIELDS)} in {r['s']} s" for s, r in RESULTS.items()))
        for s, r in RESULTS.items():
            for f in FIELDS:
                if not r["ok"][f]:
                    print(f"  {s}.{f}: got {json.dumps(r['got'][f], ensure_ascii=False)[:120]}, "
                          f"expected {json.dumps(r['exp'][f], ensure_ascii=False)[:120]}")

    def test_points_always_inside_bbox(self):
        for r in RESULTS.values():
            ev = r["ev"]
            pts = ev["points"] + [p for a in ev["interview"]["alternatives"] for p in a["points"]]
            self.assertTrue(all(I.in_bbox(p, SCN["bbox"]) for p in pts))

    def test_scenario_interview_reproduces_scenario_route(self):
        self.assertEqual(RESULTS["zawrat"]["got"]["points"], TRIP)

    def test_ambiguity_is_flagged_not_guessed(self):
        for s in ("vague", "contradictory"):
            self.assertIn("route", RESULTS[s]["got"]["uncertain"], s)

    def test_field_accuracy_at_least_75_percent(self):
        n = sum(sum(r["ok"].values()) for r in RESULTS.values())
        self.assertGreaterEqual(n / (len(FIELDS) * len(RESULTS)), 0.75)


if __name__ == "__main__":
    unittest.main(verbosity=2)
