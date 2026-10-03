#!/usr/bin/env python3
"""Fictional unit inventory for the 'Zasoby' tab: crews, equipment, batteries / fuel, service history.

One entry per roster id (GET /api/teams = resources of all scenario files, deduped by id). Shared ids (heli, drone,
dog, gopr-a...) appear in several scenarios under different operators, so every unit also has `byHome`: the name and
operator variant for each scenario that defines it. Everything here is FICTIONAL (no real people, call signs or serial
numbers); crew members are roles, not names. Health parameters (fatigue, battery, fuel) live in params.json.

Output: rescue/scenarios/inventory/inventory.json (schema rescue-inventory/1). Deterministic.
Usage: python3 rescue/tools/inventory/make_inventory.py
"""
import json
import os
import random
import re

HERE = os.path.dirname(os.path.abspath(__file__))
RESCUE = os.path.dirname(os.path.dirname(HERE))
SCEN = os.path.join(RESCUE, "scenarios")
OUT = os.path.join(SCEN, "inventory")
HIDDEN = {"night-test"}
KIND = {"ground": "pieszy", "dog": "pies", "drone": "dron", "heli": "smiglowiec", "boat": "lodz", "diver": "nurkowie"}


def scenarios():
    for f in sorted(os.listdir(SCEN)):
        if not f.endswith(".json") or f.endswith("-terrain.json") or "blind" in f or f[:-5] in HIDDEN:
            continue
        try:
            d = json.load(open(os.path.join(SCEN, f)))
        except ValueError:
            continue
        if isinstance(d, dict) and "events" in d and "startClock" in d:
            yield f[:-5], d


def crew_for(uid, kind, name):
    n = name.lower()
    if kind == "pieszy":
        size = 4 if ("4 os" in n or "topr" in n or "gopr" in n) else (3 if "osp" in n else 2)
        roles = ["kierownik patrolu"] + ["ratownik"] * (size - 1)
        if "policj" in n:
            roles = ["dowódca patrolu (Policja)"] + ["policjant"] * (size - 1)
            if "osp" in n:
                roles[-1] = "strażak OSP"
        if "straż miejska" in n:
            roles = ["strażnik miejski"] * 2
    elif kind == "pies":
        roles = ["przewodnik psa"]
    elif kind == "dron":
        roles = ["operator drona", "obserwator"]
    elif kind == "smiglowiec":
        roles = ["pilot dowódca", "drugi pilot / operator wyciągarki", "ratownik"]
    elif kind == "lodz":
        roles = ["sternik", "ratownik"] + (["ratownik"] if "sar" in n or "psp" in n else [])
    elif kind == "nurkowie":
        roles = ["nurek kierujący", "nurek roboczy", "nurek asekuracyjny", "sygnalista", "sprzętowiec"]   # 5 functions (KG PSP)
    else:
        roles = ["członek zespołu"]
    # fictional labels, never names of real people
    return [{"name": f"{uid.upper()}-{i + 1} (fikcyjny)", "role": r} for i, r in enumerate(roles)]


def unit_for(uid, kind, name, rng):
    serial = lambda p: f"{p}-{rng.randint(100, 999)}"  # noqa: E731 - fictional
    u = {"model": "", "callsign": serial(uid.split("-")[0].upper()), "equipment": {}, "spares": [], "maintenanceLog": []}
    day = lambda: f"2026-09-{rng.randint(1, 28):02d}"  # noqa: E731
    if kind == "pieszy":
        u["model"] = "patrol pieszy (fikcyjny)"
        u["spares"] = [{"item": "akumulator radiotelefonu", "qty": 2}, {"item": "baterie do czołówek (kpl.)", "qty": 4}]
        if "termowizja" in name.lower():
            u["spares"].append({"item": "akumulator kamery termowizyjnej", "qty": 1})
    elif kind == "pies":
        u["model"] = "zespół z psem ratowniczym (fikcyjny)"
        u["dog"] = {"name": rng.choice(["Bor", "Kira", "Nuka", "Saba", "Aron"]) + " (fikcyjny)",
                    "breed": rng.choice(["owczarek belgijski", "owczarek niemiecki", "border collie"]), "certified": "2025-05"}
        u["spares"] = [{"item": "woda dla psa (l)", "qty": 3}, {"item": "kamizelka chłodząca", "qty": 1}]
    elif kind == "dron":
        hours = round(rng.uniform(120, 260), 1)
        u["model"] = "quadrokopter klasy Matrice 30T z kamerą termowizyjną (fikcyjny egz.)"
        u["equipment"] = {"spareBatteries": 4, "flightMinPerBattery": 35, "hoursTotal": hours, "maintenanceEveryH": 50,
                          "hoursAtLastMaintenance": round(hours - rng.uniform(10, 40), 1), "lastMaintenance": day()}
        u["spares"] = [{"item": "akumulator TB30", "qty": 4}, {"item": "śmigła (kpl.)", "qty": 2}, {"item": "stacja ładowania BS30", "qty": 1}]
    elif kind == "smiglowiec":
        hours = round(rng.uniform(2500, 6000), 1)
        u["model"] = "śmigłowiec ratowniczy (fikcyjny egz.)"
        u["equipment"] = {"enduranceMin": 150, "hoursTotal": hours, "maintenanceEveryH": 100,
                          "hoursAtLastMaintenance": round(hours - rng.uniform(20, 80), 1), "lastMaintenance": day()}
        u["spares"] = [{"item": "nosze / kosz ratowniczy", "qty": 1}, {"item": "lina wyciągarki (zapas)", "qty": 1}]
    elif kind == "lodz":
        jet = "skuter" in name.lower()
        hours = round(rng.uniform(150, 900), 1)
        u["model"] = ("skuter wodny ratowniczy" if jet else "łódź ratownicza z silnikiem zaburtowym") + " (fikcyjny egz.)"
        u["equipment"] = {"enduranceMin": 120 if jet else 240, "hoursTotal": hours, "maintenanceEveryH": 100,
                          "hoursAtLastMaintenance": round(hours - rng.uniform(5, 60), 1), "lastMaintenance": day()}
        u["spares"] = [{"item": "kanister paliwa 20 l", "qty": 1 if jet else 2}, {"item": "kamizelki ratunkowe", "qty": 1 if jet else 4}]
    elif kind == "nurkowie":
        u["model"] = "grupa ratownictwa wodnego, nurkowie (fikcyjna)"
        u["spares"] = [{"item": "butla 12 l (pełna)", "qty": 6}, {"item": "skafander suchy", "qty": 4}]
    u["maintenanceLog"] = [{"date": day(), "type": "przegląd", "note": "przegląd okresowy (fikcyjny)"}]
    if kind == "dron":
        u["maintenanceLog"].append({"date": day(), "type": "baterie", "note": "wymiana 2 akumulatorów po 150 cyklach"})
    if kind == "pies":
        u["maintenanceLog"] = [{"date": day(), "type": "weterynarz", "note": "badanie okresowe psa"}]
    return u


def main():
    units = {}
    for sc, d in scenarios():
        for r in d.get("resources", []):
            u = units.setdefault(r["id"], {"id": r["id"], "kind": KIND.get(r.get("type"), r.get("type")), "byHome": {}})
            u["byHome"][sc] = {"name": r.get("name", r["id"]), "base": r.get("base"), "readyAt": r.get("readyAt")}
    out = []
    for uid in sorted(units):
        u = units[uid]
        rng = random.Random(f"inventory|{uid}")
        homes = u.pop("byHome")
        first = next(iter(homes.values()))
        par = re.search(r"\(([^)]*)\)", first["name"])
        base = par.group(1) if par and not re.search(r"\d+ ?os|fikcyj|termowizj", par.group(1)) else "baza wg scenariusza"
        entry = {"id": uid, "kind": u["kind"], "name": first["name"], "base": base}
        entry.update(unit_for(uid, u["kind"], first["name"], rng))
        entry["crew"] = crew_for(uid, u["kind"], first["name"])
        entry["byHome"] = {sc: {"name": h["name"], "readyAt": h.get("readyAt")} for sc, h in homes.items()}  # extra, informational
        entry["fictional"] = True
        out.append(entry)
    doc = {"schema": "rescue-inventory/1", "note": "Dane fikcyjne (hackathon): bez prawdziwych osób, znaków wywoławczych i numerów seryjnych.",
           "generated": "rescue/tools/inventory/make_inventory.py",
           "_doc": "One unit per roster id (rescue/app/CONTRACT.md 'Zasoby i dziennik' section 5). Crew = role + fictional "
                   "label. byHome = the name of a shared id in each scenario that defines it (informational). Health "
                   "parameters per kind: params.json (sources in docs/rescue-locator/zasoby.md).",
           "units": out}
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "inventory.json"), "w") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    print(f"{len(out)} units -> {os.path.relpath(os.path.join(OUT, 'inventory.json'), RESCUE)}")


if __name__ == "__main__":
    main()
