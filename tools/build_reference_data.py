#!/usr/bin/env python3
"""Build the Supercharge reference area (GeoJSON) and reference instance (JSON)
from OpenStreetMap data.

Usage:
    python3 tools/build_reference_data.py --download   # fetch OSM tiles into .osm-cache/
    python3 tools/build_reference_data.py              # rebuild website/data/*

The OSM tiles are fetched from the public OSM editing API (map call, 25 tiles of
0.005 deg x 0.004 deg) and cached locally; the cache is not committed. The derived
files are committed so that a fresh clone never needs network access.

Data (c) OpenStreetMap contributors, ODbL 1.0.
"""
import argparse
import glob
import json
import math
import os
import time
import urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".osm-cache")
OUT = os.path.join(ROOT, "website", "data")

WEST, SOUTH, EAST, NORTH = -73.9960, 40.7480, -73.9710, 40.7680
TILE_W, TILE_H = 0.005, 0.004
EARTH_RADIUS_M = 6371008.8
GRID_ANGLE_DEG = 29.0  # Manhattan street grid is rotated ~29 deg clockwise from true north
ZONE_SPACING_M = 200.0

AVENUES = {
    "9th Avenue": "9th Ave", "8th Avenue": "8th Ave", "7th Avenue": "7th Ave",
    "6th Avenue": "6th Ave", "5th Avenue": "5th Ave", "Madison Avenue": "Madison Ave",
    "Park Avenue": "Park Ave", "Lexington Avenue": "Lexington Ave", "3rd Avenue": "3rd Ave",
    "Broadway": "Broadway",
}

# Candidate pool. The first entries form the reference instance; the remaining ones
# are used when the learner increases N beyond the reference instance.
POOL = [
    ("8th Avenue", 36), ("8th Avenue", 48), ("6th Avenue", 43),
    ("6th Avenue", 54), ("5th Avenue", 47), ("Park Avenue", 39),
    ("Lexington Avenue", 46), ("Madison Avenue", 55),
    ("PARK:Bryant Park", None),
    ("9th Avenue", 42), ("7th Avenue", 38), ("Madison Avenue", 51), ("Lexington Avenue", 40),
    ("8th Avenue", 56), ("5th Avenue", 40), ("3rd Avenue", 44), ("7th Avenue", 51),
    ("Park Avenue", 50), ("9th Avenue", 52), ("Madison Avenue", 43), ("7th Avenue", 34),
    ("6th Avenue", 36), ("3rd Avenue", 41), ("5th Avenue", 57),
]
REFERENCE_CANDIDATES = 9


def ordinal(n):
    suf = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suf}"


def download():
    os.makedirs(CACHE, exist_ok=True)
    nx = round((EAST - WEST) / TILE_W)
    ny = round((NORTH - SOUTH) / TILE_H)
    for i in range(nx):
        for j in range(ny):
            path = os.path.join(CACHE, f"tile_{i}_{j}.osm")
            if os.path.exists(path) and os.path.getsize(path) > 0:
                continue
            w, e = WEST + i * TILE_W, WEST + (i + 1) * TILE_W
            s, n = SOUTH + j * TILE_H, SOUTH + (j + 1) * TILE_H
            url = f"https://api.openstreetmap.org/api/0.6/map?bbox={w:.4f},{s:.4f},{e:.4f},{n:.4f}"
            req = urllib.request.Request(url, headers={"User-Agent": "supercharge-interactive-lab data builder"})
            with urllib.request.urlopen(req, timeout=180) as r, open(path, "wb") as f:
                f.write(r.read())
            print("fetched", path)
            time.sleep(1)


def load_osm():
    nodes, ways, relations = {}, {}, {}
    timestamps = []
    for f in sorted(glob.glob(os.path.join(CACHE, "tile_*.osm"))):
        for _, el in ET.iterparse(f):
            if el.tag == "node":
                nodes[el.get("id")] = (float(el.get("lon")), float(el.get("lat")))
                timestamps.append(el.get("timestamp", ""))
            elif el.tag == "way":
                ways[el.get("id")] = {
                    "nodes": [nd.get("ref") for nd in el.findall("nd")],
                    "tags": {t.get("k"): t.get("v") for t in el.findall("tag")},
                }
            elif el.tag == "relation":
                relations[el.get("id")] = {
                    "members": [(m.get("type"), m.get("ref"), m.get("role")) for m in el.findall("member")],
                    "tags": {t.get("k"): t.get("v") for t in el.findall("tag")},
                }
            if el.tag in ("node", "way", "relation"):
                el.clear()
    return nodes, ways, relations, max(timestamps) if timestamps else ""


# ---------- geometry helpers (local equirectangular metres around the area centre) ----------
LAT0 = (SOUTH + NORTH) / 2
LON0 = (WEST + EAST) / 2
KX = math.cos(math.radians(LAT0)) * math.pi / 180 * EARTH_RADIUS_M
KY = math.pi / 180 * EARTH_RADIUS_M


def to_xy(lon, lat):
    return ((lon - LON0) * KX, (lat - LAT0) * KY)


def to_lonlat(x, y):
    return (LON0 + x / KX, LAT0 + y / KY)


def haversine(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def dp_simplify(pts, tol):
    if len(pts) < 3:
        return pts
    if pts[0] == pts[-1] and len(pts) > 4:
        mid = len(pts) // 2
        return dp_simplify(pts[: mid + 1], tol)[:-1] + dp_simplify(pts[mid:], tol)
    xy = [to_xy(*p) for p in pts]

    def rec(a, b):
        ax, ay = xy[a]
        bx, by = xy[b]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy) or 1e-9
        best, idx = -1, -1
        for k in range(a + 1, b):
            px, py = xy[k]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / L
            if d > best:
                best, idx = d, k
        if best > tol:
            return rec(a, idx)[:-1] + rec(idx, b)
        return [a, b]

    keep = rec(0, len(pts) - 1)
    return [pts[k] for k in keep]


def clip_polygon(ring):
    def clip(points, inside, inter):
        out = []
        for k in range(len(points)):
            cur, prev = points[k], points[k - 1]
            if inside(cur):
                if not inside(prev):
                    out.append(inter(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(inter(prev, cur))
        return out

    def ix(x0):
        return lambda p, q: (x0, p[1] + (q[1] - p[1]) * (x0 - p[0]) / (q[0] - p[0]))

    def iy(y0):
        return lambda p, q: (p[0] + (q[0] - p[0]) * (y0 - p[1]) / (q[1] - p[1]), y0)

    pts = ring[:-1] if ring[0] == ring[-1] else ring[:]
    for inside, inter in (
        (lambda p: p[0] >= WEST, ix(WEST)), (lambda p: p[0] <= EAST, ix(EAST)),
        (lambda p: p[1] >= SOUTH, iy(SOUTH)), (lambda p: p[1] <= NORTH, iy(NORTH)),
    ):
        if not pts:
            break
        pts = clip(pts, inside, inter)
    if len(pts) < 3:
        return None
    return pts + [pts[0]]


def point_in_ring(lon, lat, ring):
    inside = False
    n = len(ring)
    for k in range(n - 1):
        x1, y1 = ring[k]
        x2, y2 = ring[k + 1]
        if (y1 > lat) != (y2 > lat):
            xin = x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
            if lon < xin:
                inside = not inside
    return inside


def in_bbox(lon, lat):
    return WEST <= lon <= EAST and SOUTH <= lat <= NORTH


def rnd(p):
    return [round(p[0], 6), round(p[1], 6)]


def ring_area_m2(ring):
    xy = [to_xy(*p) for p in ring]
    return abs(sum(xy[k][0] * xy[k + 1][1] - xy[k + 1][0] * xy[k][1] for k in range(len(xy) - 1))) / 2


STREET_CLASSES = {"motorway", "trunk", "primary", "secondary", "tertiary", "residential",
                  "unclassified", "living_street", "pedestrian", "service", "motorway_link",
                  "primary_link", "tertiary_link"}


def build():
    nodes, ways, relations, ts = load_osm()
    features = []
    parks = []  # (name, ring) used for accessibility
    buildings = []

    def way_coords(w):
        return [nodes[r] for r in w["nodes"] if r in nodes]

    for wid, w in ways.items():
        t = w["tags"]
        coords = way_coords(w)
        if len(coords) < 2:
            continue
        closed = w["nodes"][0] == w["nodes"][-1] and len(coords) >= 4
        if closed and ("building" in t or t.get("building:part") is None and "building" in t):
            ring = clip_polygon(dp_simplify(coords, 1.0))
            if ring and ring_area_m2(ring) > 15:
                buildings.append(ring)
                features.append({"type": "Feature", "properties": {"layer": "building"},
                                 "geometry": {"type": "Polygon", "coordinates": [[rnd(p) for p in ring]]}})
        elif closed and (t.get("leisure") in ("park", "garden", "playground", "dog_park") or t.get("landuse") in ("grass",)):
            ring = clip_polygon(dp_simplify(coords, 1.0))
            if ring:
                big = ring_area_m2(ring)
                features.append({"type": "Feature",
                                 "properties": {"layer": "park", "name": t.get("name"), "areaM2": round(big)},
                                 "geometry": {"type": "Polygon", "coordinates": [[rnd(p) for p in ring]]}})
                parks.append((t.get("name") or "Grünfläche", ring))
        elif closed and (t.get("natural") == "water" or t.get("water")):
            ring = clip_polygon(dp_simplify(coords, 1.0))
            if ring:
                features.append({"type": "Feature", "properties": {"layer": "water", "name": t.get("name")},
                                 "geometry": {"type": "Polygon", "coordinates": [[rnd(p) for p in ring]]}})
                parks.append((t.get("name") or "Wasser", ring))
        elif t.get("highway") in STREET_CLASSES and not (t.get("highway") == "pedestrian" and t.get("area") == "yes"):
            if not any(in_bbox(*p) for p in coords):
                continue
            coords = dp_simplify(coords, 0.8)
            features.append({"type": "Feature",
                             "properties": {"layer": "street", "highway": t["highway"], "name": t.get("name")},
                             "geometry": {"type": "LineString", "coordinates": [rnd(p) for p in coords]}})

    # Accessibility polygons: parks, gardens, water (buildings handled separately)
    def inaccessible_reason(lon, lat):
        for name, ring in parks:
            if point_in_ring(lon, lat, ring):
                return f"liegt in {name}"
        return None

    def in_building(lon, lat):
        return any(point_in_ring(lon, lat, ring) for ring in buildings)

    # ---------- candidate pool from real street intersections ----------
    name_to_ways = {}
    for wid, w in ways.items():
        n = w["tags"].get("name")
        if n and w["tags"].get("highway"):
            name_to_ways.setdefault(n, []).append(w)

    def nodes_of(name):
        s = set()
        for w in name_to_ways.get(name, []):
            s.update(w["nodes"])
        return s

    candidates = []
    for k, (avenue, street) in enumerate(POOL):
        if avenue.startswith("PARK:"):
            pname = avenue[5:]
            ring = next(r for n, r in parks if n == pname)
            xs = [to_xy(*p) for p in ring[:-1]]
            cx = sum(p[0] for p in xs) / len(xs)
            cy = sum(p[1] for p in xs) / len(xs)
            lon, lat = to_lonlat(cx, cy)
            label = f"{pname} (Rasenfläche)"
            osm_ref = None
        else:
            hits = None
            for prefix in ("West", "East"):
                sname = f"{prefix} {ordinal(street)} Street"
                common = nodes_of(avenue) & nodes_of(sname)
                if common:
                    hits = sorted(common)
                    break
            if not hits:
                raise SystemExit(f"no intersection for {avenue} x {street}")
            nid = hits[0]
            lon, lat = nodes[nid]
            label = f"{AVENUES[avenue]} / {prefix[0]}. {ordinal(street)} St"
            osm_ref = f"node/{nid}"
        reason = inaccessible_reason(lon, lat)
        candidates.append({
            "id": f"c{k}", "name": label, "lat": round(lat, 6), "lon": round(lon, 6),
            "accessible": reason is None, "inaccessibleReason": reason, "osm": osm_ref,
        })

    # ---------- demand zones: grid aligned with the Manhattan street grid ----------
    a = math.radians(GRID_ANGLE_DEG)
    ux, uy = math.sin(a), math.cos(a)        # along avenues (north-north-east)
    vx, vy = math.cos(a), -math.sin(a)       # along streets (east-south-east)
    bx0, by0 = to_xy(WEST, SOUTH)
    bx1, by1 = to_xy(EAST, NORTH)
    margin = 60.0
    zones = []
    h = ZONE_SPACING_M / 2
    rng = range(-12, 13)
    for iu in rng:
        for iv in rng:
            x = iu * ZONE_SPACING_M * ux + iv * ZONE_SPACING_M * vx
            y = iu * ZONE_SPACING_M * uy + iv * ZONE_SPACING_M * vy
            if not (bx0 + margin + h <= x <= bx1 - margin - h and by0 + margin + h <= y <= by1 - margin - h):
                continue
            corners = []
            for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1), (-1, -1)):
                cx = x + su * h * ux + sv * h * vx
                cy = y + su * h * uy + sv * h * vy
                corners.append(rnd(to_lonlat(cx, cy)))
            lon, lat = to_lonlat(x, y)
            reason = inaccessible_reason(lon, lat)
            zones.append({"lat": round(lat, 6), "lon": round(lon, 6), "row": iu, "col": iv,
                          "weight": 1, "accessible": reason is None, "inaccessibleReason": reason,
                          "cell": corners})
    zones.sort(key=lambda z: (-z["row"], z["col"]))
    for k, z in enumerate(zones):
        z["id"] = f"z{k}"
        z.pop("row"), z.pop("col")
        zones[k] = {"id": z["id"], **{k2: v for k2, v in z.items() if k2 != "id"}}

    area = {"type": "FeatureCollection",
            "properties": {"name": "Midtown Manhattan", "bbox": [WEST, SOUTH, EAST, NORTH],
                           "source": "OpenStreetMap", "license": "ODbL 1.0",
                           "attribution": "© OpenStreetMap contributors", "osmTimestamp": ts},
            "features": features}
    with open(os.path.join(OUT, "reference-area.geojson"), "w") as f:
        json.dump(area, f, separators=(",", ":"))

    instance = {
        "format": "supercharge-instance",
        "version": "1.0.0",
        "id": "midtown-manhattan-v1",
        "title": "Midtown Manhattan – Referenzinstanz",
        "area": {"name": "Midtown Manhattan, New York City", "bbox": [WEST, SOUTH, EAST, NORTH],
                 "center": [round((SOUTH + NORTH) / 2, 6), round((WEST + EAST) / 2, 6)],
                 "geometry": "reference-area.geojson"},
        "conventions": {
            "crs": "EPSG:4326 (WGS 84), Koordinaten als [lat, lon] in Grad",
            "distance": "haversine", "earthRadiusM": EARTH_RADIUS_M,
            "coverageRule": "Zone j ist abgedeckt, wenn haversine(Station, Zonenmittelpunkt) <= r",
            "candidateOrder": "Variable x_i gehört zum i-ten aktiven Kandidaten in Pool-Reihenfolge",
            "qubitOrder": "Qubit k = QUBO-Variable k; Basisindex-Bit k (little-endian, wie Qiskit)",
        },
        "defaults": {"candidateCount": REFERENCE_CANDIDATES, "budget": 3, "radiusM": 300,
                     "weights": "uniform", "respectInaccessible": True},
        "solverDefaults": {
            "qaoa": {"layers": 2, "maxIterations": 120, "shots": 1024, "seed": 42,
                     "penaltyScale": 1.0, "init": "ramp", "optimizer": "nelder-mead", "decode": "best-energy"},
            "limits": {"browserMaxQubits": 18, "serverMaxQubits": 22, "bruteForceMaxSubsets": 5000000},
        },
        "candidates": candidates,
        "zones": zones,
        "sources": {
            "map": "OpenStreetMap (api.openstreetmap.org, map call), © OpenStreetMap contributors, ODbL 1.0",
            "osmTimestamp": ts,
            "candidates": "Reale Straßenkreuzungen (OSM-Knoten) bzw. Parkmittelpunkt; hypothetische Standorte, keine Planungsdaten",
            "zones": f"Synthetisches {int(ZONE_SPACING_M)}-m-Raster, am Straßenraster ({GRID_ANGLE_DEG}°) ausgerichtet; uniforme Gewichte, KEINE Bevölkerungsdaten",
        },
    }
    with open(os.path.join(OUT, "reference-instance.json"), "w") as f:
        json.dump(instance, f, ensure_ascii=False, indent=1)
    print(len(features), "features;", len(candidates), "candidates;", len(zones), "zones;",
          sum(not z["accessible"] for z in zones), "inaccessible zones")
    for c in candidates:
        print(c["id"], c["name"], c["lat"], c["lon"], c["accessible"], c["inaccessibleReason"])


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--download", action="store_true")
    args = ap.parse_args()
    if args.download:
        download()
    build()
