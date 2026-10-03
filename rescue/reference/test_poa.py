"""Core-math tests for the reference engine.  python3 -m unittest -v test_poa  (from rescue/reference)"""
import json
import math
import os
import unittest

import poa

HERE = os.path.dirname(os.path.abspath(__file__))
SCEN = json.load(open(os.path.join(HERE, "..", "scenarios", "zawrat.json")))
Q = [1100, 3000, 5800, 11500]


class Normalisation(unittest.TestCase):
    def test_sums_to_one(self):
        p = poa.normalise([3.0, 1.0, 0.5, 0.0])
        self.assertAlmostEqual(sum(p), 1.0, places=12)
        self.assertAlmostEqual(p[0], 3 / 4.5)

    def test_all_zero_rejected(self):
        with self.assertRaises(ValueError):
            poa.normalise([0.0, 0.0])

    def test_every_step_sums_to_one(self):
        for params in ("swift", "research"):
            for s in poa.run(SCEN, params)["steps"]:
                self.assertAlmostEqual(sum(s["poaGrid"]), 1.0, places=9)
                self.assertAlmostEqual(sum(x["poa"] for x in s["segments"]), 1.0, places=9)


class Koopman(unittest.TestCase):
    def test_closed_form(self):
        # segment mass m searched with POD q: posterior m' = m(1-q) / (1 - m q)
        poa0 = [0.1, 0.2, 0.3, 0.4]
        mask = [True, True, False, False]
        m, q = 0.3, 0.7
        post = poa.koopman_update(poa0, mask, q)
        self.assertAlmostEqual(sum(post[:2]), m * (1 - q) / (1 - m * q), places=12)
        self.assertAlmostEqual(sum(post), 1.0, places=12)
        self.assertAlmostEqual(post[2] / post[3], 0.3 / 0.4)  # unsearched cells keep their ratio

    def test_pod_one_zeroes_segment_pod_zero_is_noop(self):
        self.assertEqual(poa.koopman_update([0.5, 0.5], [True, False], 1.0), [0.0, 1.0])
        self.assertEqual(poa.koopman_update([0.25, 0.75], [True, False], 0.0), [0.25, 0.75])

    def test_repeated_searches_compose(self):
        a = poa.koopman_update(poa.koopman_update([0.5, 0.5], [True, False], 0.5), [True, False], 0.5)
        b = poa.koopman_update([0.5, 0.5], [True, False], 0.75)  # 1-(1-.5)(1-.5)
        for x, y in zip(a, b):
            self.assertAlmostEqual(x, y)


class Rings(unittest.TestCase):
    def test_cdf_hits_quantiles(self):
        for mode in ("area", "linear"):
            for q, p in zip(Q, [0.25, 0.50, 0.75, 0.95]):
                self.assertAlmostEqual(poa.ring_cdf(q - 1e-9, Q, mode), p, places=6, msg=(mode, q))

    def test_density_integrates_to_cdf(self):
        # integral of density over the disc of radius d == CDF(d), numerically, both modes
        for mode in ("area", "linear"):
            for d in (1100, 3000, 5800):
                n, tot = 20000, 0.0
                for k in range(n):
                    r = (k + 0.5) * d / n
                    tot += poa.ring_density(r, Q, mode) * 2 * math.pi * r * (d / n)
                self.assertAlmostEqual(tot, poa.ring_cdf(d - 1e-9, Q, mode), delta=0.01, msg=(mode, d))

    def test_area_mode_is_flat_within_a_band(self):
        self.assertEqual(poa.ring_density(200, Q, "area"), poa.ring_density(1000, Q, "area"))
        self.assertGreater(poa.ring_density(200, Q, "linear"), poa.ring_density(1000, Q, "linear"))


class Geometry(unittest.TestCase):
    def test_haversine_one_degree_lat(self):
        self.assertAlmostEqual(poa.haversine((49.0, 20.0), (50.0, 20.0)), 111195, delta=10)

    def test_point_to_polyline(self):
        line = [(49.22, 20.00), (49.22, 20.02)]
        self.assertAlmostEqual(poa.dist_to_polyline((49.221, 20.01), line), 111.2, delta=0.5)  # perpendicular
        self.assertAlmostEqual(poa.dist_to_polyline((49.22, 20.03), line),
                               poa.haversine((49.22, 20.03), (49.22, 20.02)), delta=0.5)  # beyond the end

    def test_grid_matches_contract(self):
        g = poa.Grid(SCEN, poa.PARAMS["swift"])
        self.assertEqual((g.rows, g.cols), (60, 60))
        b = SCEN["bbox"]
        self.assertAlmostEqual(g.centers[0][0], b["north"] - 0.5 * (b["north"] - b["south"]) / 60)  # row 0 = north
        self.assertAlmostEqual(g.centers[0][1], b["west"] + 0.5 * (b["east"] - b["west"]) / 60)    # col 0 = west

    def test_point_fix_cell_mass(self):
        # cell-integrated Gaussian: total mass over a large grid ~ 1, peak cell for sigma 25 m on 100 m cells ~ 0.95
        self.assertAlmostEqual(poa.gauss_cell_prob(0, 25, 100), 0.954 ** 2, delta=0.01)


class Regression(unittest.TestCase):
    def test_swift_params_reproduce_pitch_numbers(self):
        v = poa.run(SCEN, "swift")["value"]
        self.assertAlmostEqual(v["top3poa"], 0.464, delta=0.001)
        self.assertAlmostEqual(v["top3area"], 0.0617, delta=0.0005)
        self.assertEqual((v["rankFused"], v["rankRings"], v["truthSeg"], v["beforePing"]), (1, 19, "S7", 10))
        self.assertAlmostEqual(v["areaRings"], 0.364, delta=0.001)


if __name__ == "__main__":
    unittest.main(verbosity=2)
