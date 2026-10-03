#!/usr/bin/env python3
"""python3 rescue/tools/fov/test_viewshed.py"""
import math, os, sys, time, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import viewshed as v

LAT0, LON0 = 49.20, 20.00
KX = v.M_PER_DEG_LAT * math.cos(math.radians(LAT0 + 0.027))
BBOX = {"south": LAT0, "north": LAT0 + 6000 / v.M_PER_DEG_LAT, "west": LON0, "east": LON0 + 6000 / KX}
RIDGE_LON = LON0 + 3000 / KX  # north-south ridge in the middle of the grid


def make_ctx(zfun, forest=None):
    step = 1 / 3600.0
    m = 0.01
    lat0, lon0 = BBOX["north"] + m, BBOX["west"] - m
    rows = int((BBOX["north"] - BBOX["south"] + 2 * m) / step) + 1
    cols = int((BBOX["east"] - BBOX["west"] + 2 * m) / step) + 1
    z = [[zfun(lat0 - (r + 0.5) * step, lon0 + (c + 0.5) * step) for c in range(cols)] for r in range(rows)]
    dem = {"lat0": lat0, "lon0": lon0, "step": step, "stepLat": step, "rows": rows, "cols": cols, "z": z}
    return v.Ctx(BBOX, 100, dem, forest)


def ridge(lat, lon):
    dx = abs(lon - RIDGE_LON) * KX
    return 1000.0 + max(0.0, 150.0 - dx * 1.5)  # 150 m high, 200 m wide


def latlon(dx_m, dy_m):
    """point dx east, dy north of the grid centre"""
    return (BBOX["south"] + BBOX["north"]) / 2 + dy_m / v.M_PER_DEG_LAT, RIDGE_LON + dx_m / KX


class T(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.flat = make_ctx(lambda la, lo: 500.0)
        cls.ridge = make_ctx(ridge)

    def in_range(self, g, lat, lon, rng):
        return [i for i, (la, lo) in enumerate(g.centres)
                if math.hypot((lo - lon) * g.kx, (la - lat) * v.M_PER_DEG_LAT) <= rng]

    def test_grid_60x60(self):
        self.assertEqual((self.flat.rows, self.flat.cols), (60, 60))

    def test_flat_all_visible_and_fast(self):
        lat, lon = latlon(0, 0)
        t = time.perf_counter()
        vis = v.visible_cells(self.flat, lat, lon, 1.7, 1500)
        dt = time.perf_counter() - t
        self.assertEqual(sorted(vis), self.in_range(self.flat, lat, lon, 1500))
        self.assertGreater(len(vis), 650)
        self.assertLess(dt, 0.5, f"viewshed took {dt:.3f}s")
        print(f"\nflat 60x60, 1.5 km: {len(vis)} cells visible in {dt * 1000:.0f} ms")

    def test_ridge_hides_target(self):
        lat, lon = latlon(-800, 0)
        vis = set(v.visible_cells(self.ridge, lat, lon, 1.7, 2500))
        own_side = self.ridge.cell_of(*latlon(-400, 0))
        far_side = self.ridge.cell_of(*latlon(+600, 0))
        self.assertIn(own_side, vis)
        self.assertNotIn(far_side, vis)
        self.assertNotIn(self.ridge.cell_of(*latlon(+1500, 0)), vis)

    def test_on_ridge_sees_both_sides(self):
        lat, lon = latlon(0, 0)
        vis = set(v.visible_cells(self.ridge, lat, lon, 1.7, 2500))
        for dx in (-1200, -600, 600, 1200):
            self.assertIn(self.ridge.cell_of(*latlon(dx, 0)), vis, dx)

    def test_forest_blocks_beyond_30m(self):
        g = self.flat
        forest = [0] * (g.rows * g.cols)
        for r in range(g.rows):
            forest[r * g.cols + 32] = 1  # a forest strip 1 cell wide east of the centre
        gf = make_ctx(lambda la, lo: 500.0, forest)
        lat, lon = latlon(-50, 0)
        vis = set(v.visible_cells(gf, lat, lon, 1.7, 1500))
        self.assertIn(gf.cell_of(*latlon(-500, 0)), vis)
        self.assertNotIn(gf.cell_of(*latlon(+600, 0)), vis)

    def test_drone_footprint_size(self):
        g = self.flat
        lat, lon = latlon(0, 0)
        agl, hfov, vfov = 120.0, 82.0, 66.0
        cells = v.footprint_cells(g, lat, lon, agl, hfov, vfov, 0)
        rows = {i // g.cols for i in cells}
        cols = {i % g.cols for i in cells}
        w = 2 * agl * math.tan(math.radians(hfov / 2)) / g.cell_m
        h = 2 * agl * math.tan(math.radians(vfov / 2)) / g.cell_m
        self.assertLessEqual(abs(len(cols) - w), 1.0, (len(cols), w))
        self.assertLessEqual(abs(len(rows) - h), 1.0, (len(rows), h))
        # heading 90: width along north-south
        cells90 = v.footprint_cells(g, lat, lon, agl, hfov, vfov, 90)
        self.assertLessEqual(abs(len({i // g.cols for i in cells90}) - w), 1.0)
        # big footprint is clipped by the grid
        big = v.footprint_cells(g, BBOX["north"], BBOX["west"], 2000, 90, 90)
        self.assertTrue(0 < len(big) <= g.rows * g.cols)

    def test_dog_cone_downwind(self):
        g = self.flat
        lat, lon = latlon(0, 0)
        cells = v.cone_cells(g, lat, lon, wind_from_deg=0, half_angle_deg=30, range_m=800)
        orow = g.cell_of(lat, lon) // g.cols
        rows = [i // g.cols for i in cells]
        self.assertGreater(len(cells), 10)
        self.assertTrue(all(r >= orow for r in rows))       # nothing north of the source
        self.assertGreaterEqual(max(rows) - orow, 7)        # reaches ~800 m south
        up = v.cone_cells(g, lat, lon, 0, 30, 800, upwind=True)
        self.assertTrue(all(i // g.cols <= orow for i in up))


if __name__ == "__main__":
    unittest.main(verbosity=2)
