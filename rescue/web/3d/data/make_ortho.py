#!/usr/bin/env python3
"""Build the 3D view's aerial photo layer for a DEM cut: Sentinel-2 cloudless 2016 by EOX (CC BY 4.0),
fetched as WebMercator tiles, mosaicked and resampled onto the DEM's lat/lon grid, saved as one JPEG.

  python3 rescue/web/3d/data/make_ortho.py rescue/web/3d/data/zawrat-dem-wide.json rescue/web/3d/data/zawrat-ortho-wide.jpg

Attribution (shown in the page): EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH
(Contains modified Copernicus Sentinel data 2016), CC BY 4.0. Needs Pillow.
"""
import io, json, math, sys, urllib.request
from PIL import Image

URL = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg"
Z, WIDTH = 14, 2048

dem = json.load(open(sys.argv[1]))
lat_n, lon_w = dem["lat0"], dem["lon0"]
lat_s, lon_e = lat_n - dem["rows"] * dem.get("stepLat", dem["step"]), lon_w + dem["cols"] * dem["step"]

def merc(lat, lon):  # global pixel coordinates at zoom Z
    n = 256 * 2 ** Z
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y

x0, y0 = merc(lat_n, lon_w); x1, y1 = merc(lat_s, lon_e)
tx0, ty0, tx1, ty1 = int(x0 // 256), int(y0 // 256), int(x1 // 256), int(y1 // 256)
mosaic = Image.new("RGB", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
for ty in range(ty0, ty1 + 1):
    for tx in range(tx0, tx1 + 1):
        req = urllib.request.Request(URL.format(z=Z, x=tx, y=ty), headers={"User-Agent": "hackyeah2026-rescue-3d"})
        mosaic.paste(Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=30).read())).convert("RGB"), ((tx - tx0) * 256, (ty - ty0) * 256))
    print(f"row {ty - ty0 + 1}/{ty1 - ty0 + 1}", file=sys.stderr)

# resample onto the DEM's equirectangular grid (north row first, same extent as the DEM)
kx = math.cos(math.radians((lat_n + lat_s) / 2))
height = round(WIDTH * (lat_n - lat_s) / ((lon_e - lon_w) * kx))
out = Image.new("RGB", (WIDTH, height)); src = mosaic.load(); dst = out.load()
for j in range(height):
    lat = lat_n - (j + 0.5) / height * (lat_n - lat_s)
    for i in range(WIDTH):
        x, y = merc(lat, lon_w + (i + 0.5) / WIDTH * (lon_e - lon_w))
        dst[i, j] = src[min(int(x - tx0 * 256), mosaic.width - 1), min(int(y - ty0 * 256), mosaic.height - 1)]
out.save(sys.argv[2], quality=84, optimize=True, progressive=True)
print(f"{sys.argv[2]}: {WIDTH}x{height}", file=sys.stderr)
