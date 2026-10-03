"""Compare each scenario's hand-placed terrain and story points with its real OSM + DEM terrain.
Writes terrain_check.md (one section per scenario that has a <name>-terrain.json).

  python3 rescue/tools/terrain/check_terrain.py

Hand-written findings per scenario live in findings.json ({"<name>": ["- line", ...]}) and are appended.
"""
import glob
import json
import os
import statistics as st

from osm_terrain import HERE, RESCUE, dist_m, seg_dist_m, slope_deg

FINDINGS_FILE = os.path.join(HERE, "findings.json")


def to_line(p, line):
    return min(seg_dist_m(p, a, b) for a, b in zip(line, line[1:])) if len(line) > 1 else dist_m(p, line[0])


def nearest(p, feats):
    if not feats:
        return None, "-"
    d, f = min(((to_line(p, f["points"]), f) for f in feats), key=lambda x: x[0])
    return round(d), f["name"]


def norm(s):
    s = "".join(ch for ch in s.lower() if ch.isalnum() or ch == " ")
    return " ".join(w for w in s.split() if w not in ("schronisko", "pttk", "w", "przy", "na"))


def match(name, real, at, key):
    """Name match (nearest if several), else the nearest feature within 600 m by position."""
    n = norm(name)
    named = [r for r in real if n and norm(r["name"]) and (norm(r["name"]).startswith(n) or n.startswith(norm(r["name"]))
                                                           or n in norm(r["name"]))]
    pool = named or [r for r in real if dist_m(at, r[key]) < 600]
    return min(pool, key=lambda r: dist_m(at, r[key])) if pool else None


def stats(xs):
    xs = sorted(xs)
    return f"median **{st.median(xs):.0f} m**, p90 {xs[int(len(xs) * .9)]:.0f} m, max {xs[-1]:.0f} m"


def section(path, findings):
    name = os.path.splitext(os.path.basename(path))[0]
    sc = json.load(open(path))
    ter = json.load(open(path.replace(".json", "-terrain.json")))
    dem = json.load(open(os.path.join(HERE, "data", f"{name}-dem.json")))
    sl = slope_deg(dem)
    sy = dem.get("stepLat", dem["step"])

    def z_s(p):
        r, c = int((dem["lat0"] - p[0]) / sy), int((p[1] - dem["lon0"]) / dem["step"])
        if 0 <= r < dem["rows"] and 0 <= c < dem["cols"]:
            return round(dem["z"][r][c]), round(sl[r][c])
        return "-", "-"

    def in_lake(p):
        return next((l["name"] for l in ter["lakes"] if dist_m(p, l["center"]) < l["radiusM"]), "")

    trails, streams = ter["trails"], ter["streams"]
    steep = [f for f in ter["ridges"] if "DEM" in f["name"]]
    L = [f"## {name}", "", f"*{sc.get('incident', '')}* Subject: {sc.get('subject', {}).get('category', '?')}, "
         f"age {sc.get('subject', {}).get('age', '?')}.", ""]

    hand = sc.get("terrain")
    if hand:
        L += ["**Hand-placed terrain vs real:**", ""]
        pts = [p for t in hand.get("trails", []) for p in t["points"]]
        if pts:
            L.append(f"- Trail vertices ({len(pts)}) to the nearest real trail: "
                     f"{stats([min(to_line(p, r['points']) for r in trails) for p in pts])}.")
        sp = [p for t in hand.get("streams", []) for p in t["points"]]
        if sp and streams:
            L.append(f"- Stream vertices ({len(sp)}) to the nearest real stream: "
                     f"{stats([min(to_line(p, r['points']) for r in streams) for p in sp])}.")
        for kind, key, real in (("Lake", "center", ter["lakes"]), ("Hut", "at", ter["huts"])):
            for f in hand.get(kind.lower() + "s", []):
                r = match(f["name"], real, f[key], key)
                L.append(f"- {kind} {f['name']}: " + (f"{dist_m(f[key], r[key]):.0f} m from OSM '{r['name']}'"
                                                       + (f", radius {f['radiusM']} / {r['radiusM']} m" if kind == "Lake" else "")
                                                       if r else "no OSM match by name"))
        L.append("")

    L += ["| What | Point | Elev | Slope | Nearest real trail | Nearest real stream | In lake | Steep off-trail cell |",
          "|---|---|---|---|---|---|---|---|"]

    def row(what, p):
        z, s = z_s(p)
        dt, nt = nearest(p, trails)
        ds, ns = nearest(p, streams)
        stp = "yes" if any(to_line(p, f["points"]) < 71 for f in steep) else ""
        L.append(f"| {what} | {p[0]:.4f}, {p[1]:.4f} | {z} | {s} | {dt} m ({nt}) | {ds} m ({ns}) | {in_lake(p)} | {stp} |")

    if sc.get("ipp"):
        row("IPP", sc["ipp"]["at"])
    if sc.get("truth"):
        row("**Truth (find spot)**", sc["truth"]["at"])
    for e in sc.get("events", []):
        if e.get("point"):
            row(f"{e['provider']} {e.get('at', '')}", e["point"])
    for s in sc.get("segments", []):
        row(f"Seed {s['id']} {s['name']}", s["seed"])
    for e in sc.get("events", []):
        if e.get("points") and len(e["points"]) > 1:
            d = [min(to_line(p, r["points"]) for r in trails) for p in e["points"]]
            L += ["", f"- {e['provider']} {e.get('at', '')} route ({len(d)} points) to the nearest real trail: {stats(d)}."]
    if findings.get(name):
        L += ["", "**Findings (hand-written):**", ""] + findings[name]
    return L + [""]


def main():
    findings = json.load(open(FINDINGS_FILE)) if os.path.exists(FINDINGS_FILE) else {}
    L = ["# Terrain check: scenarios vs real OSM + DEM terrain", "",
         "Generated by `python3 rescue/tools/terrain/check_terrain.py` from `scenarios/<name>.json` (never edited here) "
         "and `scenarios/<name>-terrain.json`. Distances in metres; elevation and slope (degrees) from Copernicus "
         "DEM GLO-30 (30 m pixel at the point). 'Steep off-trail cell' = within ~70 m of a 100 m cell the terrain tool "
         "marked as > 38° and > 120 m from a trail. Hand-written findings come from `findings.json`.", ""]
    for p in sorted(glob.glob(os.path.join(RESCUE, "scenarios", "*.json"))):
        if not p.endswith("-terrain.json") and os.path.exists(p.replace(".json", "-terrain.json")):
            L += section(p, findings)
    open(os.path.join(HERE, "terrain_check.md"), "w").write("\n".join(L) + "\n")
    print("\n".join(L))


if __name__ == "__main__":
    main()
