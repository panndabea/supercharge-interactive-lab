// Evaluate a placement exactly: a zone counts once, no matter how many stations cover it.

export function toIndexList(problem, sel) {
  if (Array.isArray(sel)) return [...sel].sort((a, b) => a - b);
  if (sel instanceof Uint8Array) return [...sel.keys()].filter((i) => sel[i]);
  if (typeof sel === 'number') {
    const out = [];
    for (let i = 0; i < problem.N; i++) if ((sel >>> i) & 1) out.push(i);
    return out;
  }
  throw new Error('Unbekanntes Auswahlformat');
}

export function evaluate(problem, sel) {
  const stations = toIndexList(problem, sel);
  const hits = new Uint16Array(problem.Z);
  for (const i of stations) for (const j of problem.cover[i]) hits[j]++;
  let covered = 0, coveredZones = 0, uncoveredWeight = 0;
  const uncovered = [];
  for (let j = 0; j < problem.Z; j++) {
    if (hits[j] > 0) { covered += problem.weights[j]; coveredZones++; }
    else { uncovered.push(j); uncoveredWeight += problem.weights[j]; }
  }
  const multiCovered = [...hits].filter((h) => h > 1).length;
  return {
    stations,
    count: stations.length,
    feasible: stations.length <= problem.budget,
    coveredWeight: covered,
    coveragePct: problem.totalWeight > 0 ? (100 * covered) / problem.totalWeight : 0,
    coveredZones,
    uncoveredZones: uncovered.length,
    uncovered,
    uncoveredWeight,
    multiCovered,
    hits,
  };
}

// Weight newly covered when adding candidate i to an accumulated coverage mask.
export function marginalGain(problem, acc, i) {
  const m = problem.masks[i];
  let g = 0;
  for (let w = 0; w < problem.words; w++) {
    let fresh = m[w] & ~acc[w];
    while (fresh) {
      const b = 31 - Math.clz32(fresh & -fresh);
      g += problem.weights[(w << 5) + b];
      fresh &= fresh - 1;
    }
  }
  return g;
}

// Per-zone comparison of two placements (for the side-by-side maps).
export function compareCoverage(problem, a, b) {
  const ea = evaluate(problem, a), eb = evaluate(problem, b);
  const zones = [];
  for (let j = 0; j < problem.Z; j++) {
    const ca = ea.hits[j] > 0, cb = eb.hits[j] > 0;
    zones.push(ca && cb ? 'both' : ca ? 'onlyA' : cb ? 'onlyB' : 'neither');
  }
  const sa = new Set(ea.stations), sb = new Set(eb.stations);
  const stations = [];
  for (let i = 0; i < problem.N; i++) {
    const x = sa.has(i), y = sb.has(i);
    if (x || y) stations.push({ i, status: x && y ? 'both' : x ? 'onlyA' : 'onlyB' });
  }
  const count = (s) => zones.filter((z) => z === s).length;
  return { a: ea, b: eb, zones, stations, counts: { both: count('both'), onlyA: count('onlyA'), onlyB: count('onlyB'), neither: count('neither') } };
}
