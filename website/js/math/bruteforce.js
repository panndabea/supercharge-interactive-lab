// Exact brute force over every subset with at most B stations.
// Order: depth-first lexicographic ([], [0], [0,1], ...). Tie-breaking (deterministic):
// 1) larger covered weight, 2) fewer stations, 3) lexicographically smaller index list.
import { feasibleCount } from './combinations.js';

const EPS = 1e-9;

export class WorkLimitError extends Error {}

function better(w, k, bestW, bestK) {
  if (w > bestW + EPS) return true;
  if (Math.abs(w - bestW) <= EPS && k < bestK) return true;
  return false; // equal weight + equal size: the earlier (lexicographically smaller) set wins
}

export function bruteForce(problem, { maxSubsets = Infinity, collectOptimal = false, onProgress } = {}) {
  const { N, budget: B, words, masks, weights } = problem;
  const total = feasibleCount(N, B);
  if (total > maxSubsets) {
    throw new WorkLimitError(`Brute Force müsste ${total.toLocaleString('de-DE')} Teilmengen prüfen (Limit ${maxSubsets.toLocaleString('de-DE')}).`);
  }
  const t0 = performance.now();
  const K = Math.min(B, N);
  const acc = Array.from({ length: K + 1 }, () => new Uint32Array(words));
  const accW = new Float64Array(K + 1);
  const stack = [];
  let evaluated = 0, bestW = -1, bestK = Infinity, best = [];
  let optimal = [];
  const visit = (depth) => {
    evaluated++;
    const w = accW[depth];
    if (better(w, depth, bestW, bestK)) {
      bestW = w; bestK = depth; best = stack.slice();
    }
    if (collectOptimal) {
      if (w > (optimal.w ?? -1) + EPS) { optimal = [stack.slice()]; optimal.w = w; }
      else if (Math.abs(w - optimal.w) <= EPS) optimal.push(stack.slice());
    }
    if (onProgress && (evaluated & 0xffff) === 0) onProgress(evaluated, total);
    if (depth === K) return;
    const start = depth === 0 ? 0 : stack[depth - 1] + 1;
    const cur = acc[depth], nxt = acc[depth + 1];
    for (let i = start; i < N; i++) {
      const m = masks[i];
      let gain = 0;
      for (let q = 0; q < words; q++) {
        let fresh = m[q] & ~cur[q];
        nxt[q] = cur[q] | m[q];
        while (fresh) {
          const b = 31 - Math.clz32(fresh & -fresh);
          gain += weights[(q << 5) + b];
          fresh &= fresh - 1;
        }
      }
      accW[depth + 1] = accW[depth] + gain;
      stack.push(i);
      visit(depth + 1);
      stack.pop();
    }
  };
  visit(0);
  const res = {
    method: 'brute-force', exact: true, stations: best, coveredWeight: bestW, evaluated,
    expected: total, timeMs: performance.now() - t0,
  };
  if (collectOptimal) res.allOptimal = optimal;
  return res;
}

// Step-by-step version for the "brute-force microscope": yields every evaluated subset.
export function* bruteForceSteps(problem) {
  const { N, budget: B } = problem;
  const K = Math.min(B, N);
  const stack = [];
  let evaluated = 0, bestW = -1, bestK = Infinity, best = [];
  const covered = new Uint16Array(problem.Z);
  let w = 0;
  function* rec(start) {
    evaluated++;
    const improved = better(w, stack.length, bestW, bestK);
    if (improved) { bestW = w; bestK = stack.length; best = stack.slice(); }
    yield { subset: stack.slice(), weight: w, evaluated, best: best.slice(), bestWeight: bestW, improved };
    if (stack.length === K) return;
    for (let i = start; i < N; i++) {
      for (const j of problem.cover[i]) if (covered[j]++ === 0) w += problem.weights[j];
      stack.push(i);
      yield* rec(i + 1);
      stack.pop();
      for (const j of problem.cover[i]) if (--covered[j] === 0) w -= problem.weights[j];
    }
  }
  yield* rec(0);
}
