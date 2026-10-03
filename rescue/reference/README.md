# Reference POA engine (cross-check of RescueKit)

An independent Python implementation (stdlib only) of the Rescue Locator fusion model. It is written from the spec (`rescue/README.md` contract, `docs/rescue-locator/research.md` section 4), not transliterated from Swift:
- **Geometry:** haversine distances and a local tangent plane for point-to-line distance.
- **Own code:** the ring model, segment aggregation, ranking and pitch-number code are all its own.

```sh
cd rescue/reference
python3 poa.py --params swift      # same parameter values as Swift  -> out/ref-run-swift.json
python3 poa.py                     # research-derived parameters      -> out/ref-run.json
python3 compare.py out/ref-run-swift.json      # vs ../out/run.json (Swift)
python3 compare.py out/ref-run.json
python3 -m unittest -v test_poa    # core math: normalisation, Koopman update, ring quantiles, geometry, regression
```

`rescue/out/run.json` was regenerated with `swift run rescue-demo --fast`: same `value` block as the committed file.

## Result 1: the Swift engine is implemented correctly

With the same parameter values, the independent engine reproduces Swift at **every step**:

| | |
|---|---|
| Grid | 60 x 60, identical `segOf` (0 cells assigned differently) |
| Top-3 segments | identical at all 12 steps |
| Kendall tau over all 19 segments | 1.0 at 11 steps, 0.988 at one (two near-tied tail segments swap) |
| max \|dPOA\| per segment | <= 0.0002 |
| L1 distance of POA grids | <= 0.0015 (rounding in run.json + haversine vs equirectangular) |
| Pitch numbers | all 8 equal: top3poa 0.464, top3area 0.0617, rankFused 1, rankRings 19, areaFused 0.0017, areaRings 0.364, truthSeg S7, beforePing 10 |

Hint ordering, the Koopman update (POA x (1-POD), renormalised), segment aggregation, rings-only baseline and area-to-find are all consistent. **No bug found in the Swift engine.**

## Result 2: which pitch numbers depend on modelling choices

Research-derived parameters (`--params research`):

| Choice | Swift | Research-derived (why) |
|---|---|---|
| Ring interpolation | probability per band spread evenly over the band's area | CDF linear in distance between the ISRID quantiles ("interpolated from the quantiles") |
| Linear-feature boost | 1 + 2.5 e^(-d/120) trails + 1.5 e^(-d/120) streams + huts | Jacobs: 50% within ~100 m, 95% within ~424 m -> exponential track offset, scale 100/ln2 = 144 m (95% point 432 m), floor 0.15 |
| Cell fix | sigma = 0.6 r, floor 0.1 | radius read as 67% containment of a 2D Gaussian: sigma = r/1.49, floor 0.05 |
| Point fix | Gaussian at cell centre, sigma >= 60 m | Gaussian mass integrated over the 100 m cell, sigma = 25 m |
| Route floor | 0.25 | 0.3 |

At 19:35, just before the Ratunek ping:

| Number | Swift | Research params |
|---|---|---|
| Top-3 POA / area | 46.4% in 6.2% | 53.0% in 8.2% |
| S7 (find spot) rank fused | **1** (S7 16.6%, S5 15.0%, S4 14.7%) | **2** (S3 19.9%, S7 18.6%) |
| Area swept before reaching the find spot | 0.17% | 0.19% |
| Same, rings only | 36.4% | 37.7% |
| S7 rank, rings only | 19 | 19 |

One-at-a-time sensitivity (Swift parameters plus one research choice):
- Only the **ring interpolation** flips S7 from #1 to #2. A linear CDF in distance gives density ~1/d, a spike at the IPP: the density ratio at 100 m vs 2 km is 34.6, against 6.4 for Swift's area-uniform bands. The IPP is the hut, inside S3, so S3 wins.
- The terrain model raises top-3 to 50%, the cell-fix model raises area-to-find to 0.28%, and the point model changes nothing before the ping.
- S7 stays #1 under every choice except the ring interpolation.

**Which is right per the research?** Swift's area-uniform bands are the standard ring method: assign 25/25/25/20% to the rings and spread each over its area, as LPB ring-based POA and CalTopo rings do. The 1/d spike is an artifact of linear interpolation and over-weights the point last seen, which the subject left hours earlier. **Keep Swift's choice**, and note it as a modelling assumption.

## Discrepancies and caveats for the pitch

1. **"#1 fused vs #19 with plain rings" overstates the gain.**
   - Ranking segments by total POA under a radially symmetric ring model penalises small segments, and S7 is the smallest (1.5% of the area).
   - Ranked by POA density (probability per area), S7 is **#9** under rings, not #19.
   - The fair, robust number is the cell-level **area to sweep: 0.17% fused vs 36.4% rings**. It holds under both parameter sets (0.19% vs 37.7%). Suggest leading with it.
2. **"S7 is #1 before the ping" is fragile.** The margin is 1.6 points (16.6% vs 15.0%), and a defensible alternative ring interpolation makes S7 #2 behind the IPP segment. Say "top 2" or show the margin.
3. **"Top 3 hold 46% in 6% of the area"** is robust in direction: 46-53% of POA in 6-8% of the area across the models.
4. **Cosmetic:** the Swift ring tail beyond the 95% quantile uses `0.05 / (pi * 3 * q95^2)`, a disc rather than an annulus. That is irrelevant here, since 11.5 km lies outside the 6 x 6 km box.

## Files

- `poa.py` - engine (`--params swift|research`), writes `out/ref-run*.json` in the `rescue-run/1` shape, plus `ringsOnlySegments`
- `compare.py` - per-step comparison with `rescue/out/run.json`
- `test_poa.py` - 14 tests (normalisation, Koopman closed form and composition, ring CDF at quantiles and density integral, geometry, contract grid, pitch-number regression)
