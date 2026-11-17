// Canonical instance -> concrete optimisation problem.
// The map, every solver and every metric use the problem built here, so they share
// exactly the same coverage matrix.
import { haversine, EARTH_RADIUS_M } from './geo.js';

export const WEIGHT_PRESETS = {
  uniform: { label: 'Uniform (alle Zonen = 1)', synthetic: false },
  'synthetic-hubs': {
    label: 'Synthetisch: Verkehrsknoten priorisiert',
    synthetic: true,
    // Illustrative only: zones within 350 m of these real landmarks get weight 3.
    hubs: [
      { name: 'Times Square', lat: 40.758, lon: -73.9855 },
      { name: 'Grand Central Terminal', lat: 40.7527, lon: -73.9772 },
      { name: 'Port Authority Bus Terminal', lat: 40.757, lon: -73.9905 },
    ],
    radiusM: 350,
    weight: 3,
  },
};

export function defaultConfig(instance) {
  const d = instance.defaults;
  return {
    candidateCount: d.candidateCount,
    budget: d.budget,
    radiusM: d.radiusM,
    weightPreset: d.weights,
    weights: {},
    respectInaccessible: d.respectInaccessible,
  };
}

export function normalizeConfig(instance, cfg = {}) {
  const base = defaultConfig(instance);
  const c = { ...base, ...cfg, weights: { ...(cfg.weights || {}) } };
  c.candidateCount = Math.max(1, Math.min(instance.candidates.length, Math.round(Number(c.candidateCount))));
  c.budget = Math.max(0, Math.round(Number(c.budget)));
  c.radiusM = Math.max(0, Number(c.radiusM));
  if (!WEIGHT_PRESETS[c.weightPreset]) c.weightPreset = 'uniform';
  c.respectInaccessible = Boolean(c.respectInaccessible);
  for (const [k, v] of Object.entries(c.weights)) {
    const w = Number(v);
    if (!Number.isFinite(w) || w < 0) throw new Error(`Ungültiges Gewicht für ${k}: ${v}`);
    c.weights[k] = w;
  }
  return c;
}

export function zoneWeight(instance, zone, cfg) {
  if (Object.prototype.hasOwnProperty.call(cfg.weights, zone.id)) return cfg.weights[zone.id];
  const preset = WEIGHT_PRESETS[cfg.weightPreset];
  if (preset && preset.hubs) {
    const R = instance.conventions?.earthRadiusM ?? EARTH_RADIUS_M;
    for (const h of preset.hubs) if (haversine(zone.lat, zone.lon, h.lat, h.lon, R) <= preset.radiusM) return preset.weight;
  }
  return zone.weight ?? 1;
}

// Build the problem: active candidates (index i), active zones (index j), weights w_j,
// coverage sets C_j and per-candidate zone lists.
export function buildProblem(instance, cfgIn) {
  const cfg = normalizeConfig(instance, cfgIn);
  const R = instance.conventions?.earthRadiusM ?? EARTH_RADIUS_M;
  const pool = instance.candidates.slice(0, cfg.candidateCount);
  const candidates = [];
  const excludedCandidates = [];
  for (const c of pool) {
    if (cfg.respectInaccessible && c.accessible === false) excludedCandidates.push(c);
    else candidates.push(c);
  }
  const zones = [];
  const excludedZones = [];
  for (const z of instance.zones) {
    if (cfg.respectInaccessible && z.accessible === false) excludedZones.push(z);
    else zones.push(z);
  }
  const N = candidates.length, Z = zones.length;
  const weights = zones.map((z) => zoneWeight(instance, z, cfg));
  const distance = candidates.map((c) => zones.map((z) => haversine(c.lat, c.lon, z.lat, z.lon, R)));
  const cover = candidates.map((_, i) => {
    const out = [];
    for (let j = 0; j < Z; j++) if (distance[i][j] <= cfg.radiusM) out.push(j);
    return out;
  });
  const coveredBy = zones.map(() => []);
  cover.forEach((list, i) => list.forEach((j) => coveredBy[j].push(i)));
  const words = Math.max(1, Math.ceil(Z / 32));
  const masks = cover.map((list) => {
    const m = new Uint32Array(words);
    for (const j of list) m[j >>> 5] |= 1 << (j & 31);
    return m;
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  return {
    instanceId: instance.id, config: cfg, N, Z, budget: cfg.budget, radiusM: cfg.radiusM,
    candidates, zones, excludedCandidates, excludedZones, weights, totalWeight,
    distance, cover, coveredBy, masks, words,
  };
}
