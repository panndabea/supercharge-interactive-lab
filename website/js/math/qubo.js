// Exact QUBO for maximum coverage with |S| <= B.
//
// Minimise  E(x, s, z) = -sum_j w_j OR_j(x)                (coverage, multilinear)
//                        + lambda * (sum_i x_i + sum_k c_k s_k - B)^2   (budget, slack bits s)
//                        + M * sum_aux (a b - 2 a z - 2 b z + 3 z)      (Rosenberg, z = a b)
//
// OR_j(x) = 1 - prod_{i in C_j} (1 - x_i) is expanded by inclusion-exclusion. Zones with
// identical coverage sets are merged. Monomials of degree >= 3 are reduced to quadratic
// ones by substituting z = a b for the most frequent pair (exact quadratization).
// lambda = scale * (1 + max_i W_i), W_i = weight coverable by candidate i alone.
// M = scale * (1 + sum of |coefficients| of all original monomials with degree >= 3).
// Both bounds make every ground state decode to an optimal feasible placement
// (see docs/qubo-derivation.md); scale < 1 is allowed for the penalty experiments.

export const MAX_SIGNATURE = 14; // |C_j| above this: inclusion-exclusion has > 16k terms

const key = (vars) => vars.join(',');

function addTerm(poly, vars, c) {
  if (c === 0) return;
  const k = key(vars);
  const v = (poly.get(k) ?? 0) + c;
  if (Math.abs(v) < 1e-12) poly.delete(k); else poly.set(k, v);
}

export function slackCoefficients(B) {
  if (B <= 0) return [];
  const m = Math.floor(Math.log2(B)) + 1;
  const c = [];
  for (let k = 0; k < m - 1; k++) c.push(2 ** k);
  c.push(B - (2 ** (m - 1) - 1));
  return c;
}

export function coveragePolynomial(problem) {
  const groups = new Map();
  problem.coveredBy.forEach((C, j) => {
    if (C.length === 0 || problem.weights[j] === 0) return;
    const k = key(C);
    const g = groups.get(k) ?? { vars: C.slice(), weight: 0, zones: [] };
    g.weight += problem.weights[j]; g.zones.push(j);
    groups.set(k, g);
  });
  const poly = new Map();
  for (const g of groups.values()) {
    if (g.vars.length > MAX_SIGNATURE) throw new Error(`Zone von ${g.vars.length} Kandidaten abgedeckt – Inklusion-Exklusion zu groß`);
    const n = g.vars.length;
    for (let mask = 1; mask < 1 << n; mask++) {
      const vars = [];
      for (let b = 0; b < n; b++) if ((mask >>> b) & 1) vars.push(g.vars[b]);
      addTerm(poly, vars, vars.length % 2 === 1 ? -g.weight : g.weight);
    }
  }
  return { poly, groups: [...groups.values()] };
}

export function buildQubo(problem, opts = {}) {
  const scale = opts.penaltyScale ?? 1;
  const { N, budget: B } = problem;
  const { poly, groups } = coveragePolynomial(problem);
  const terms = []; // provenance: { vars, coef, source, note }
  let highSum = 0;
  for (const [k, c] of poly) if (k.split(',').length >= 3) highSum += Math.abs(c);

  // --- quadratization -------------------------------------------------------------
  const mono = [...poly].map(([k, c]) => ({ vars: k.split(',').map(Number), coef: c }));
  const aux = [];
  let nextVar = N;
  const auxStart = () => nextVar; // aux vars are numbered after slack (renumbered below)
  void auxStart;
  const tmpAux = [];
  while (true) {
    const counts = new Map();
    for (const m of mono) {
      if (m.vars.length < 3) continue;
      for (let a = 0; a < m.vars.length; a++) for (let b = a + 1; b < m.vars.length; b++) {
        const k = m.vars[a] + ',' + m.vars[b];
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
    if (counts.size === 0) break;
    let bestK = null, bestC = -1;
    for (const [k, c] of counts) {
      if (c > bestC || (c === bestC && cmpPair(k, bestK) < 0)) { bestC = c; bestK = k; }
    }
    const [a, b] = bestK.split(',').map(Number);
    const z = 1000 + tmpAux.length; // temporary id, > any candidate index
    tmpAux.push({ tmp: z, a, b });
    for (const m of mono) {
      if (m.vars.length < 3 || !m.vars.includes(a) || !m.vars.includes(b)) continue;
      m.vars = [...m.vars.filter((v) => v !== a && v !== b), z].sort((p, q) => p - q);
    }
  }
  const slack = slackCoefficients(B);
  const needBudget = B < N;
  const nSlack = needBudget ? slack.length : 0;
  // final numbering: x_0..x_{N-1}, s_0..s_{m-1}, z_0..z_{A-1}
  const remap = new Map();
  for (let i = 0; i < N; i++) remap.set(i, i);
  tmpAux.forEach((t, k) => remap.set(t.tmp, N + nSlack + k));
  const n = N + nSlack + tmpAux.length;
  for (const t of tmpAux) aux.push({ index: remap.get(t.tmp), a: remap.get(t.a), b: remap.get(t.b) });

  const linear = new Float64Array(n);
  const quad = new Map(); // "u,v" (u<v) -> coef
  let offset = 0;
  const add = (vars, c, source, note) => {
    if (c === 0) return;
    const v = vars.map((x) => remap.has(x) ? remap.get(x) : x).sort((p, q) => p - q);
    terms.push({ vars: v, coef: c, source, note });
    if (v.length === 0) offset += c;
    else if (v.length === 1) linear[v[0]] += c;
    else if (v[0] === v[1]) linear[v[0]] += c;
    else { const k = v[0] + ',' + v[1]; quad.set(k, (quad.get(k) ?? 0) + c); }
  };
  for (const m of mono) add(m.vars, m.coef, 'coverage', 'Abdeckung (Inklusion-Exklusion)');

  // --- budget penalty ----------------------------------------------------------------
  const maxW = Math.max(0, ...problem.cover.map((l) => l.reduce((s, j) => s + problem.weights[j], 0)));
  const lambda = opts.budgetPenalty ?? scale * (1 + maxW);
  if (needBudget) {
    const vars = [];
    for (let i = 0; i < N; i++) vars.push([i, 1]);
    for (let k = 0; k < nSlack; k++) vars.push([N + k, slack[k]]);
    for (const [v, a] of vars) add([v], lambda * (a * a - 2 * B * a), 'budget', 'Budget: λ(a² − 2Ba)');
    for (let p = 0; p < vars.length; p++) for (let q = p + 1; q < vars.length; q++) {
      add([vars[p][0], vars[q][0]], lambda * 2 * vars[p][1] * vars[q][1], 'budget', 'Budget: 2λ·a·b');
    }
    add([], lambda * B * B, 'budget', 'Budget: λB²');
  }

  // --- Rosenberg penalties ---------------------------------------------------------------
  const M = opts.auxPenalty ?? scale * (1 + highSum);
  for (const t of aux) {
    add([t.a, t.b], M, 'aux', `Hilfsvariable z=${t.a}·${t.b}: M·ab`);
    add([t.a, t.index], -2 * M, 'aux', 'Hilfsvariable: −2M·az');
    add([t.b, t.index], -2 * M, 'aux', 'Hilfsvariable: −2M·bz');
    add([t.index], 3 * M, 'aux', 'Hilfsvariable: 3M·z');
  }
  for (const [k, v] of quad) if (Math.abs(v) < 1e-12) quad.delete(k);

  const labels = [];
  for (let i = 0; i < N; i++) labels.push({ name: `x${i}`, kind: 'station', candidate: problem.candidates[i].id, text: problem.candidates[i].name });
  for (let k = 0; k < nSlack; k++) labels.push({ name: `s${k}`, kind: 'slack', coef: slack[k], text: `Schlupfbit (Wert ${slack[k]})` });
  aux.forEach((t, k) => labels.push({ name: `z${k}`, kind: 'aux', a: t.a, b: t.b, text: `z${k} = ${labelName(labels, t.a)}·${labelName(labels, t.b)}` }));

  return {
    n, N, nSlack, nAux: aux.length, budget: B, slack: needBudget ? slack : [], aux, labels,
    linear, quad, offset, lambda, M, penaltyScale: scale, groups, terms,
  };
}

function labelName(labels, v) { return labels[v]?.name ?? `v${v}`; }

function cmpPair(k1, k2) {
  if (k2 === null) return -1;
  const [a1, b1] = k1.split(',').map(Number), [a2, b2] = k2.split(',').map(Number);
  return a1 - a2 || b1 - b2;
}

export function quadList(qubo) {
  return [...qubo.quad].map(([k, c]) => { const [u, v] = k.split(',').map(Number); return [u, v, c]; })
    .sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}

// Upper-triangular matrix Q with E(x) = x^T Q x + offset.
export function quboMatrix(qubo) {
  const Q = Array.from({ length: qubo.n }, () => new Float64Array(qubo.n));
  for (let i = 0; i < qubo.n; i++) Q[i][i] = qubo.linear[i];
  for (const [u, v, c] of quadList(qubo)) Q[u][v] = c;
  return Q;
}

export function energy(qubo, bits) {
  let e = qubo.offset;
  for (let i = 0; i < qubo.n; i++) if (bits[i]) e += qubo.linear[i];
  for (const [k, c] of qubo.quad) { const [u, v] = k.split(',').map(Number); if (bits[u] && bits[v]) e += c; }
  return e;
}

export function bitsOf(index, n) {
  const b = new Uint8Array(n);
  for (let k = 0; k < n; k++) b[k] = Math.floor(index / 2 ** k) % 2;
  return b;
}

// Energies of all 2^n basis states (index bit k = variable k), Gray-code incremental.
export function allEnergies(qubo) {
  const n = qubo.n;
  if (n > 26) throw new Error('Zu viele Variablen für vollständige Aufzählung');
  const size = 2 ** n;
  const E = new Float64Array(size);
  const nb = Array.from({ length: n }, () => []);
  for (const [u, v, c] of quadList(qubo)) { nb[u].push([v, c]); nb[v].push([u, c]); }
  const bits = new Uint8Array(n);
  let idx = 0, e = qubo.offset;
  E[0] = e;
  for (let g = 1; g < size; g++) {
    const k = 31 - Math.clz32(g & -g); // bit flipped in Gray code step
    let d = qubo.linear[k];
    for (const [v, c] of nb[k]) if (bits[v]) d += c;
    if (bits[k]) { e -= d; bits[k] = 0; idx -= 2 ** k; } else { e += d; bits[k] = 1; idx += 2 ** k; }
    E[idx] = e;
  }
  return E;
}

export function decode(problem, qubo, bits) {
  const stations = [];
  for (let i = 0; i < qubo.N; i++) if (bits[i]) stations.push(i);
  let slackValue = 0;
  for (let k = 0; k < qubo.nSlack; k++) if (bits[qubo.N + k]) slackValue += qubo.slack[k];
  const auxConsistent = qubo.aux.every((t) => bits[t.index] === (bits[t.a] & bits[t.b]));
  const slackConsistent = qubo.nSlack === 0 || stations.length + slackValue === qubo.budget;
  return { stations, feasible: stations.length <= problem.budget, slackValue, auxConsistent, slackConsistent };
}

// Exhaustive validation for small n: are the QUBO ground states exactly the optimal
// feasible placements, and does min over (s, z) reproduce -coverage for every feasible x?
export function validateQubo(problem, qubo, coverageOf) {
  const E = allEnergies(qubo);
  const n = qubo.n, N = qubo.N;
  let minE = Infinity;
  for (let k = 0; k < E.length; k++) if (E[k] < minE) minE = E[k];
  const ground = new Set();
  const projected = new Map(); // x mask -> min energy over slack/aux
  for (let k = 0; k < E.length; k++) {
    const xm = k % 2 ** N;
    const cur = projected.get(xm);
    if (cur === undefined || E[k] < cur) projected.set(xm, E[k]);
    if (E[k] <= minE + 1e-7) ground.add(xm);
  }
  let worstFeasibleError = 0, infeasibleViolations = 0, opt = -Infinity;
  const covOf = new Map();
  for (const [xm] of projected) {
    const sel = []; for (let i = 0; i < N; i++) if (Math.floor(xm / 2 ** i) % 2) sel.push(i);
    const c = coverageOf(sel);
    covOf.set(xm, { c, k: sel.length });
    if (sel.length <= problem.budget) opt = Math.max(opt, c);
  }
  const optimalSet = new Set();
  for (const [xm, e] of projected) {
    const { c, k } = covOf.get(xm);
    if (k <= problem.budget) {
      worstFeasibleError = Math.max(worstFeasibleError, Math.abs(e - -c));
      if (Math.abs(c - opt) <= 1e-9) optimalSet.add(xm);
    } else if (e <= -opt + 1e-9) infeasibleViolations++;
  }
  const groundOk = ground.size === optimalSet.size && [...ground].every((x) => optimalSet.has(x));
  return {
    n, states: E.length, minEnergy: minE, optimum: opt, groundStates: [...ground].sort((a, b) => a - b),
    optimalPlacements: [...optimalSet].sort((a, b) => a - b), worstFeasibleError, infeasibleViolations,
    valid: groundOk && worstFeasibleError < 1e-7 && infeasibleViolations === 0,
  };
}

// QUBO -> Ising with x_i = (1 - Z_i)/2:  E = const + sum h_i Z_i + sum J_ij Z_i Z_j
export function toIsing(qubo) {
  const h = new Float64Array(qubo.n);
  const J = [];
  let c = qubo.offset;
  for (let i = 0; i < qubo.n; i++) { c += qubo.linear[i] / 2; h[i] -= qubo.linear[i] / 2; }
  for (const [u, v, q] of quadList(qubo)) {
    c += q / 4; h[u] -= q / 4; h[v] -= q / 4; J.push([u, v, q / 4]);
  }
  return { n: qubo.n, h, J, constant: c };
}
