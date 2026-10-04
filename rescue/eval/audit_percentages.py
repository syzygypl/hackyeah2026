#!/usr/bin/env python3
"""Niezalezne przeliczenie procentow silnika z samej odpowiedzi API (audyt, czesc 4).

Uzycie:
  curl -4 -s 'https://rescue-locator.vercel.app/api/run/zawrat?live=0' > run.json
  curl -4 -s 'https://rescue-locator.vercel.app/api/run/zawrat?live=0&t=19:45' > t1945.json
  python3 rescue/eval/audit_percentages.py run.json t1945.json

Nie czyta kodu silnika. Wejscie: odpowiedz API (+ ewentualnie scenariusz z rescue/scenarios).
"""
import json
import math
import sys

run = json.load(open(sys.argv[1]))
frame = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else None
steps = run["steps"]
segOf = run["segOf"]
N = run["rows"] * run["cols"]
ids = sorted({s["id"] for s in steps[0]["segments"]}, key=lambda x: int(x[1:]))


def seg_poa(step):
    return {s["id"]: s["poa"] for s in step["segments"]}


def agg(grid):
    out = {i: 0.0 for i in ids}
    for c, v in enumerate(grid):
        out[ids[segOf[c]] if isinstance(segOf[c], int) else segOf[c]] += v
    return out


def top(d, n=5):
    return sorted(d.items(), key=lambda kv: -kv[1])[:n]


print("== 1. Suma POA i agregacja komorek na segmenty")
sums_seg, sums_grid, agg_err = [], [], 0.0
for k, st in enumerate(steps):
    p = seg_poa(st)
    sums_seg.append(sum(p.values()))
    sums_grid.append(sum(st["poaGrid"]))
    a = agg(st["poaGrid"])
    agg_err = max(agg_err, max(abs(a[i] - p[i]) for i in ids))
print(f"  sum segments[].poa: min {min(sums_seg):.5f} max {max(sums_seg):.5f}")
print(f"  sum poaGrid:        min {min(sums_grid):.5f} max {max(sums_grid):.5f}")
print(f"  max |sum POA komorek segmentu - segments[].poa| = {agg_err:.2e}")

print("== 2. areaPct = komorki segmentu / wszystkie")
cnt = {i: 0 for i in ids}
for c in range(N):
    cnt[ids[segOf[c]] if isinstance(segOf[c], int) else segOf[c]] += 1
api_area = {s["id"]: s["areaPct"] for s in steps[-2]["segments"]}
d_area = max(abs(100 * cnt[i] / N - api_area[i]) for i in ids)
print(f"  sum areaPct API {sum(api_area.values()):.3f}, przeliczone {sum(100*cnt[i]/N for i in ids):.3f}, max delta {d_area:.4f} pp")

print("== 3. Bayes po pustym przeszukaniu: POA*(1-POD)/(1-POD*sum POA_S), poza S: POA/(1-POD*sum POA_S)")
# POD i segmenty z segmentHistory (przyrost miedzy krokami); scenariusz podaje te same liczby
incs = []
for k in range(1, len(steps)):
    st, prev = steps[k], steps[k - 1]
    if st["kind"] != "searched":
        continue
    h0, h1 = prev["segmentHistory"], st["segmentHistory"]
    S = [i for i in h1 if i not in h0]
    pod = h1[S[0]]["cumPod"]
    pb, pa = seg_poa(prev), seg_poa(st)
    mass = sum(pb[i] for i in S)
    den = 1 - pod * mass
    pred = {i: (pb[i] * (1 - pod) if i in S else pb[i]) / den for i in ids}
    err = max(abs(pred[i] - pa[i]) for i in ids)
    errpp = max(abs(pred[i] - pa[i]) / max(pa[i], 1e-9) for i in ids)
    incs.append((st["t"], S, pod, mass, mass * pod))
    print(f"  {st['t']} {'+'.join(S)} POD {pod}: POA_S przed {mass:.4f}, mianownik {den:.4f}, "
          f"max |pred-API| {err:.1e} (wzgl. {errpp:.1e}); " +
          ", ".join(f"{i} {pb[i]:.4f}->{pa[i]:.4f} (pred {pred[i]:.4f})" for i in S))

print("== 4. 'Szansa znalezienia dotad': suma przyrostow vs 1 - prod(1 - POA_przed x POD)")
s_sum, s_prod = 0.0, 1.0
for t, S, pod, mass, inc in incs:
    s_sum += inc
    s_prod *= 1 - inc
    print(f"  {t} {'+'.join(S)}: przyrost {inc:.4f}, suma {100*s_sum:.1f}%, 1-prod {100*(1-s_prod):.1f}%")
# kontrola: bezwarunkowo, POA sprzed pierwszego przeszukania x POD segmentu
first = next(k for k, st in enumerate(steps) if st["kind"] == "searched")
prior = seg_poa(steps[first - 1])
hist = steps[-2]["segmentHistory"]
uncond = sum(prior[i] * hist[i]["cumPod"] for i in hist)
print(f"  kontrola sum_i POA_prior(i) x cumPOD(i) = {uncond:.4f}")

print("== 5. Top 3 o 19:45: krok vs klatka osi czasu")
k1945 = max(k for k, st in enumerate(steps) if st["t"] <= "19:45")
ps = seg_poa(steps[k1945])
print(f"  krok {k1945} ({steps[k1945]['t']}): " + ", ".join(f"{i} {v:.4f}" for i, v in top(ps)))
t3 = top(ps, 3)
print(f"  top 3 krok: suma areaPct {sum(100*cnt[i]/N for i, _ in t3):.2f}%, suma POA {sum(v for _, v in t3):.4f}")
tl = next(f for f in run["timeline"]["frames"] if f["t"] == "19:45")
if frame:
    same = frame["poaGrid"] == tl["poaGrid"] and frame["segments"] == tl["segments"]
    print(f"  ?t=19:45 == timeline.frames[19:45]: {same}")
    fr = frame
else:
    fr = tl
pf = {s["id"]: s["poa"] for s in fr["segments"]}
print(f"  klatka API: " + ", ".join(f"{i} {v:.4f}" for i, v in top(pf)) + f"; pos {fr['pos']}")
pod_cell = [0.0] * N
for c, p in fr["cov"]:
    pod_cell[c] = p
# niezaleznie: klatka = baza x (1 - POD komorki), normalizacja; baza 'replace' = krok sprzed przeszukan
for name, base in (("replace (baza = krok sprzed 1. przeszukania)", steps[first - 1]["poaGrid"]),
                   ("keep (baza = krok 19:45 z meldunkami)", steps[k1945]["poaGrid"])):
    w = [b * (1 - p) for b, p in zip(base, pod_cell)]
    z = sum(w)
    a = agg([x / z for x in w])
    pos = sum(b * p for b, p in zip(base, pod_cell)) / sum(base)
    line = ", ".join(f"{i} {v:.4f}" for i, v in top(a))
    if name.startswith("replace"):
        d = max(abs(a[i] - pf[i]) for i in ids)
        print(f"  przeliczone {name}: {line}; pos {pos:.4f}; max |delta| vs API {d:.4f}")
    else:
        print(f"  wariant {name}: {line}; pos ze sladow {pos:.4f}")
cum = {s["id"]: s["cumPod"] for s in fr["segments"]}
print("  cumPod klatki >0: " + ", ".join(f"{i} {v}" for i, v in cum.items() if v))

print("== 6. 'Przeszukany obszar' o 19:45")
hs = steps[k1945]["segmentHistory"]
print(f"  sum areaPct segmentow z meldunkiem ({len(hs)}): {sum(100*cnt[i]/N for i in hs):.1f}%")
n01 = sum(1 for p in pod_cell if p >= 0.1)
print(f"  komorki z POD >= 0.1: {n01} = {100*n01/N:.2f}%; coverageFinal {run['timeline']['coverageFinal']}")

print("== 7. Przydzialy 19:45: POD rdzenia vs POD segmentu (D, G)")
for a in steps[k1945]["assignments"]:
    sp = ps[a["segmentId"]]
    print(f"  {a['resourceId']} -> {a['segmentId']}: POA rdzenia {a['poa']}, POA segmentu {sp:.4f}, POD rdzenia {a['pod']}, "
          f"expectedFind {a['expectedFind']} -> POD segmentu {a['expectedFind']/sp:.3f}; powod: {a['reason']}")

print("== 8. Klatki: pos i cumPod w czasie (J)")
prev_pos = None
for f in run["timeline"]["frames"]:
    if f["t"] in ("19:45", "20:00", "20:05"):
        c = {s["id"]: s["cumPod"] for s in f["segments"]}
        print(f"  {f['t']}: pos {f['pos']}, cumPod S3 {c['S3']} S4 {c['S4']} S6 {c['S6']} S7 {c['S7']}")

print("== 9. Masa pierscieni Koestera w prostokacie (H; kwantyle 1.1/3/5.8/11.5 km, masy .25/.25/.25/.20 + ogon .05 na pi*3*r95^2)")
q = [0, 1100, 3000, 5800, 11500]
m = [0.25, 0.25, 0.25, 0.20]
lat0, lon0 = run["ipp"]["lat"], run["ipp"]["lon"]
bb = run["bbox"]
ky = 111320.0
kx = 111320.0 * math.cos(math.radians((bb["north"] + bb["south"]) / 2))
nn = 600
dy = (bb["north"] - bb["south"]) / nn
dx = (bb["east"] - bb["west"]) / nn
mass = 0.0
for r_ in range(nn):
    la = bb["south"] + (r_ + 0.5) * dy
    for c_ in range(nn):
        lo = bb["west"] + (c_ + 0.5) * dx
        d = math.hypot((la - lat0) * ky, (lo - lon0) * kx)
        dens = 0.05 / (math.pi * 3 * q[4] ** 2)
        for j in range(4):
            if q[j] <= d < q[j + 1]:
                dens += m[j] / (math.pi * (q[j + 1] ** 2 - q[j] ** 2))
        mass += dens * (dy * ky) * (dx * kx)
print(f"  masa pierscieni w bbox: {mass:.3f}")
