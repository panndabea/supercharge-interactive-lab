// Alternative classical methods: greedy (approximation), local search and simulated
// annealing (heuristics) and branch-and-bound (exact).
import { marginalGain } from './coverage.js';
import { mulberry32 } from './rng.js';

const EPS = 1e-9;

function orInto(acc, m) { for (let q = 0; q < acc.length; q++) acc[q] |= m[q]; }

function weightOf(problem, sel) {
  const acc = new Uint32Array(problem.words);
  for (const i of sel) orInto(acc, problem.masks[i]);
  let w = 0;
  for (let j = 0; j < problem.Z; j++) if ((acc[j >>> 5] >>> (j & 31)) & 1) w += problem.weights[j];
  return w;
}

// Greedy: repeatedly add the candidate with the largest marginal gain (lowest index on ties).
// For monotone submodular coverage under |S| <= B it reaches >= (1 - 1/e) of the optimum.
export function greedy(problem) {
  const t0 = performance.now();
  const acc = new Uint32Array(problem.words);
  const sel = [];
  let w = 0, evaluations = 0;
  const steps = [];
  while (sel.length < Math.min(problem.budget, problem.N)) {
    let bi = -1, bg = 0;
    for (let i = 0; i < problem.N; i++) {
      if (sel.includes(i)) continue;
      evaluations++;
      const g = marginalGain(problem, acc, i);
      if (g > bg + EPS) { bg = g; bi = i; }
    }
    if (bi < 0) break;
    sel.push(bi); orInto(acc, problem.masks[bi]); w += bg;
    steps.push({ add: bi, gain: bg, total: w });
  }
  return { method: 'greedy', exact: false, stations: sel.slice().sort((a, b) => a - b), coveredWeight: w, evaluated: evaluations, steps, timeMs: performance.now() - t0 };
}

// Local search: start from greedy, apply the best improving swap/add until none exists.
export function localSearch(problem, { maxRounds = 1000 } = {}) {
  const t0 = performance.now();
  let cur = greedy(problem).stations.slice();
  let w = weightOf(problem, cur), evaluations = 0, rounds = 0;
  while (rounds++ < maxRounds) {
    let best = null, bw = w;
    const inSet = new Set(cur);
    for (let a = 0; a < problem.N; a++) {
      if (inSet.has(a)) continue;
      if (cur.length < problem.budget) {
        const s = [...cur, a]; evaluations++;
        const v = weightOf(problem, s);
        if (v > bw + EPS) { bw = v; best = s; }
      }
      for (let r = 0; r < cur.length; r++) {
        const s = cur.slice(); s[r] = a; evaluations++;
        const v = weightOf(problem, s);
        if (v > bw + EPS) { bw = v; best = s; }
      }
    }
    if (!best) break;
    cur = best.sort((x, y) => x - y); w = bw;
  }
  return { method: 'local-search', exact: false, stations: cur, coveredWeight: w, evaluated: evaluations, rounds, timeMs: performance.now() - t0 };
}

// Simulated annealing over subsets of size <= B (moves: swap, add, remove).
export function simulatedAnnealing(problem, { iterations = 4000, seed = 7, t0: T0 = null } = {}) {
  const start = performance.now();
  const rnd = mulberry32(seed);
  const { N, budget: B } = problem;
  const maxW = Math.max(1, ...problem.weights);
  let T = T0 ?? maxW * 2;
  const cool = Math.pow(0.001, 1 / Math.max(1, iterations));
  let cur = [];
  for (let i = 0; i < N && cur.length < Math.min(B, N); i++) cur.push(i);
  let w = weightOf(problem, cur), best = cur.slice(), bw = w;
  const history = [];
  for (let it = 0; it < iterations && N > 0; it++) {
    const s = cur.slice();
    const out = [...Array(N).keys()].filter((i) => !s.includes(i));
    const r = rnd();
    if (s.length > 0 && out.length > 0 && (r < 0.7 || s.length === B)) s[Math.floor(rnd() * s.length)] = out[Math.floor(rnd() * out.length)];
    else if (s.length < B && out.length > 0) s.push(out[Math.floor(rnd() * out.length)]);
    else if (s.length > 0) s.splice(Math.floor(rnd() * s.length), 1);
    const v = weightOf(problem, s);
    if (v >= w || rnd() < Math.exp((v - w) / T)) { cur = s; w = v; }
    if (w > bw + EPS) { bw = w; best = cur.slice(); }
    if (it % Math.max(1, Math.floor(iterations / 100)) === 0) history.push({ it, T, w, bw });
    T *= cool;
  }
  return { method: 'simulated-annealing', exact: false, stations: best.sort((a, b) => a - b), coveredWeight: bw, evaluated: iterations, history, timeMs: performance.now() - start };
}

// Branch and bound (exact). Upper bound: current weight + the (B - k) largest marginal
// gains of remaining candidates; valid because coverage is submodular.
export function branchAndBound(problem) {
  const t0 = performance.now();
  const { N, budget: B, words } = problem;
  const K = Math.min(B, N);
  let bestW = -1, best = [], nodes = 0, pruned = 0;
  const stack = [];
  const rec = (start, acc, w) => {
    nodes++;
    if (w > bestW + EPS || (Math.abs(w - bestW) <= EPS && stack.length < best.length)) { bestW = w; best = stack.slice(); }
    if (stack.length === K) return;
    const gains = [];
    for (let i = start; i < N; i++) gains.push([marginalGain(problem, acc, i), i]);
    const sorted = gains.map((g) => g[0]).sort((a, b) => b - a);
    let ub = w;
    for (let k = 0; k < Math.min(K - stack.length, sorted.length); k++) ub += sorted[k];
    if (ub <= bestW + EPS) { pruned++; return; }
    for (const [g, i] of gains) {
      if (g <= EPS) continue; // adding a useless station never helps (and is not needed for the optimum)
      const nxt = new Uint32Array(words);
      for (let q = 0; q < words; q++) nxt[q] = acc[q] | problem.masks[i][q];
      stack.push(i);
      rec(i + 1, nxt, w + g);
      stack.pop();
    }
  };
  rec(0, new Uint32Array(words), 0);
  return { method: 'branch-and-bound', exact: true, stations: best, coveredWeight: bestW, evaluated: nodes, pruned, timeMs: performance.now() - t0 };
}
