// Web Worker: expensive work (brute force, QUBO validation, QAOA) off the UI thread.
import { buildProblem } from './math/instance.js';
import { bruteForce } from './math/bruteforce.js';
import { greedy, localSearch, simulatedAnnealing, branchAndBound } from './math/heuristics.js';
import { buildQubo, validateQubo } from './math/qubo.js';
import { evaluate } from './math/coverage.js';
import { solveQaoa } from './math/qaoa.js';

const MAX_SUBSETS = 2_000_000;

self.onmessage = (ev) => {
  const { id, task, instance, config, options = {} } = ev.data;
  try {
    const p = buildProblem(instance, config);
    let result;
    if (task === 'classical') {
      result = { greedy: greedy(p), localSearch: localSearch(p), annealing: simulatedAnnealing(p, { seed: options.seed ?? 7 }), branchAndBound: branchAndBound(p) };
      try { result.exact = bruteForce(p, { maxSubsets: MAX_SUBSETS }); } catch (e) { result.exact = { skipped: true, reason: e.message }; }
    } else if (task === 'qaoa') {
      let q = null;
      try { q = buildQubo(p); } catch (e) { result = { method: 'qaoa', exact: false, skipped: true, reason: e.message }; }
      if (q) {
        result = solveQaoa(p, q, options);
        if (!result.skipped) delete result.runs;
      }
    } else if (task === 'validate') {
      const q = buildQubo(p, options);
      result = q.n <= 20 ? validateQubo(p, q, (s) => evaluate(p, s).coveredWeight) : { skipped: true, reason: `${q.n} Variablen > 20` };
    } else throw new Error('Unbekannte Aufgabe ' + task);
    self.postMessage({ id, ok: true, result });
  } catch (e) {
    self.postMessage({ id, ok: false, error: e.message });
  }
};
