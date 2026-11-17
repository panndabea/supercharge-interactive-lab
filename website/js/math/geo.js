// Geographic helpers. Coordinates are WGS 84 degrees; distances in metres.
export const EARTH_RADIUS_M = 6371008.8;

const rad = (d) => (d * Math.PI) / 180;

// Great-circle distance (haversine formula) between two [lat, lon] points.
export function haversine(lat1, lon1, lat2, lon2, R = EARTH_RADIUS_M) {
  const p1 = rad(lat1), p2 = rad(lat2);
  const dp = p2 - p1, dl = rad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Web-Mercator projection to "world pixels" at zoom 0 (256 px world).
export function project(lat, lon) {
  const x = ((lon + 180) / 360) * 256;
  const s = Math.sin(rad(Math.max(-85.0511, Math.min(85.0511, lat))));
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256;
  return [x, y];
}

export function unproject(x, y) {
  const lon = (x / 256) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / 256;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return [lat, lon];
}

// Metres per Mercator world-pixel (zoom 0) at a latitude.
export function metresPerWorldPixel(lat) {
  return (2 * Math.PI * EARTH_RADIUS_M * Math.cos(rad(lat))) / 256;
}

// Point on the great circle at distance d (m) and bearing (deg) from a point.
export function destination(lat, lon, bearingDeg, d, R = EARTH_RADIUS_M) {
  const dr = d / R, b = rad(bearingDeg), p1 = rad(lat), l1 = rad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(dr) + Math.cos(p1) * Math.sin(dr) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(dr) * Math.cos(p1), Math.cos(dr) - Math.sin(p1) * Math.sin(p2));
  return [(p2 * 180) / Math.PI, (l2 * 180) / Math.PI];
}

// Ray-casting point-in-polygon on a ring of [lon, lat] pairs.
export function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let k = 0, m = ring.length - 1; k < ring.length; m = k++) {
    const [x1, y1] = ring[k], [x2, y2] = ring[m];
    if ((y1 > lat) !== (y2 > lat) && lon < x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1)) inside = !inside;
  }
  return inside;
}
