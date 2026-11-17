import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { haversine, destination, pointInRing, project, unproject } from '../../website/js/math/geo.js';
import { binom, binomBig, feasibleCount, feasibleCountBig, kSubsets, subsetsUpTo } from '../../website/js/math/combinations.js';
import { mulberry32 } from '../../website/js/math/rng.js';
import { buildProblem, defaultConfig } from '../../website/js/math/instance.js';
import { evaluate, compareCoverage } from '../../website/js/math/coverage.js';
import { bruteForce, bruteForceSteps, WorkLimitError } from '../../website/js/math/bruteforce.js';
import { greedy, localSearch, simulatedAnnealing, branchAndBound } from '../../website/js/math/heuristics.js';
import { buildQubo, energy, allEnergies, bitsOf, validateQubo, toIsing, slackCoefficients, quboMatrix, decode } from '../../website/js/math/qubo.js';
import { State, sample, statevectorBytes } from '../../website/js/math/statevector.js';
import { costSpectrum, qaoaState, qaoaCircuit, runCircuit, solveQaoa, nelderMead } from '../../website/js/math/qaoa.js';
import { fixtureText, FIXTURES } from '../../tools/gen-fixtures.mjs';

const inst = JSON.parse(fs.readFileSync(new URL('../../website/data/reference-instance.json', import.meta.url)));
const P = (cfg = {}) => buildProblem(inst, { ...defaultConfig(inst), ...cfg });
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (tol ${tol})`);

// Toy instance with hand-computable answers: 3 candidates, 4 zones on a line.
function toy({ budget = 2, weights = [1, 1, 1, 1] } = {}) {
  const lat = 40.75, lon = -73.98;
  const at = (m) => destination(lat, lon, 90, m);
  const cand = [0, 300, 600].map((m, i) => ({ id: `t${i}`, name: `T${i}`, lat: at(m)[0], lon: at(m)[1], accessible: true }));
  const zones = [-100, 150, 450, 700].map((m, j) => ({ id: `y${j}`, lat: at(m)[0], lon: at(m)[1], weight: weights[j], accessible: true }));
  const ti = { ...inst, candidates: cand, zones, defaults: { ...inst.defaults, candidateCount: 3 } };
  return buildProblem(ti, { candidateCount: 3, budget, radiusM: 160, weightPreset: 'uniform', respectInaccessible: true });
}

test('haversine: known distances', () => {
  close(haversine(0, 0, 0, 1), 111195.08, 0.01); // one degree of longitude on the equator
  close(haversine(40.75, -73.98, 40.75, -73.98), 0);
  const [la, lo] = destination(40.75, -73.98, 37, 1234.5);
  close(haversine(40.75, -73.98, la, lo), 1234.5, 1e-6);
  close(haversine(1, 2, 3, 4), haversine(3, 4, 1, 2), 1e-9);
});

test('projection round trip and point-in-polygon', () => {
  const [x, y] = project(40.7549, -73.984);
  const [la, lo] = unproject(x, y);
  close(la, 40.7549, 1e-9); close(lo, -73.984, 1e-9);
  const sq = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  assert.equal(pointInRing(0.5, 0.5, sq), true);
  assert.equal(pointInRing(1.5, 0.5, sq), false);
});

test('combinatorics: binomials, feasible counts, enumeration order', () => {
  assert.equal(binom(8, 3), 56);
  assert.equal(binomBig(60, 30), 118264581564861424n);
  assert.equal(feasibleCount(8, 3), 1 + 8 + 28 + 56);
  assert.equal(feasibleCountBig(40, 40), 2n ** 40n);
  assert.deepEqual([...kSubsets(4, 2)], [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]);
  const all = [...subsetsUpTo(5, 2)];
  assert.equal(all.length, feasibleCount(5, 2));
  assert.deepEqual(all.slice(0, 4), [[], [0], [0, 1], [0, 2]]);
});

test('rng: mulberry32 is deterministic and matches the fixture', () => {
  const line = fs.readFileSync(new URL('../../fixtures/rng.txt', import.meta.url), 'utf8').trim().split(' ');
  const r = mulberry32(Number(line[1]));
  for (const v of line.slice(2)) assert.equal(r(), Number(v));
});

test('coverage: toy instance counts overlap once', () => {
  const p = toy();
  assert.deepEqual(p.cover, [[0, 1], [1, 2], [2, 3]]);
  const e = evaluate(p, [0, 1]);
  assert.equal(e.coveredWeight, 3); // zone 1 covered twice, counted once
  assert.equal(e.multiCovered, 1);
  assert.equal(evaluate(p, [0, 2]).coveredWeight, 4);
  assert.equal(evaluate(p, [0, 1, 2]).feasible, false);
});

test('coverage matrix follows the radius and accessibility toggle', () => {
  const a = P({ radiusM: 200 }), b = P({ radiusM: 400 });
  for (let i = 0; i < a.N; i++) {
    assert.ok(b.cover[i].length >= a.cover[i].length);
    for (const j of a.cover[i]) assert.ok(a.distance[i][j] <= 200);
  }
  const on = P({ respectInaccessible: true }), off = P({ respectInaccessible: false });
  assert.equal(off.N, 9); assert.equal(on.N, 8);
  assert.equal(off.Z - on.Z, inst.zones.filter((z) => !z.accessible).length);
});

test('brute force: optimum, tie-breaking, work count', () => {
  const p = toy();
  const r = bruteForce(p);
  assert.deepEqual(r.stations, [0, 2]);
  assert.equal(r.coveredWeight, 4);
  assert.equal(r.evaluated, feasibleCount(3, 2));
  // ties: {0} and {2} both cover weight 1 -> lexicographically smaller wins
  const t = toy({ budget: 1, weights: [1, 0, 0, 1] });
  assert.deepEqual(bruteForce(t).stations, [0]);
  assert.throws(() => bruteForce(P({ candidateCount: 24, budget: 12 }), { maxSubsets: 1000 }), WorkLimitError);
  const steps = [...bruteForceSteps(p)];
  assert.equal(steps.length, r.evaluated);
  assert.deepEqual(steps.at(-1).best, r.stations);
});

test('brute force agrees with direct evaluation of every subset', () => {
  const p = P();
  let best = -1;
  for (const s of subsetsUpTo(p.N, p.budget)) best = Math.max(best, evaluate(p, s).coveredWeight);
  const r = bruteForce(p);
  assert.equal(r.coveredWeight, best);
  assert.equal(evaluate(p, r.stations).coveredWeight, r.coveredWeight);
});

test('classical alternatives: exact methods match, heuristics are feasible and bounded', () => {
  for (const cfg of [{}, { radiusM: 450 }, { candidateCount: 16, budget: 4 }, { candidateCount: 24, budget: 3, weightPreset: 'synthetic-hubs' }]) {
    const p = P(cfg);
    const opt = bruteForce(p).coveredWeight;
    assert.equal(branchAndBound(p).coveredWeight, opt);
    for (const r of [greedy(p), localSearch(p), simulatedAnnealing(p, { seed: 3 })]) {
      assert.ok(r.stations.length <= p.budget);
      close(evaluate(p, r.stations).coveredWeight, r.coveredWeight);
      assert.ok(r.coveredWeight <= opt + 1e-9);
    }
    assert.ok(greedy(p).coveredWeight >= (1 - 1 / Math.E) * opt - 1e-9);
  }
});

test('QUBO: slack encoding covers exactly 0..B', () => {
  for (let B = 1; B <= 20; B++) {
    const c = slackCoefficients(B);
    const reach = new Set();
    for (let m = 0; m < 2 ** c.length; m++) reach.add(c.reduce((s, v, k) => s + ((m >> k) & 1) * v, 0));
    assert.deepEqual([...reach].sort((a, b) => a - b), Array.from({ length: B + 1 }, (_, k) => k));
  }
});

test('QUBO: toy coefficients by hand', () => {
  const p = toy();
  const q = buildQubo(p);
  // -cov = -(x0) - (x0+x1-x0x1) - (x1+x2-x1x2) - x2 ; B=2 < N=3 -> slack 1,1 ; lambda = 1 + 2 = 3
  assert.equal(q.n, 5); assert.equal(q.nAux, 0); assert.equal(q.lambda, 3);
  const E = (x) => energy(q, x);
  assert.equal(E([1, 0, 1, 0, 0]), -4);
  assert.equal(E([1, 1, 0, 0, 0]), -3);
  assert.equal(E([1, 1, 1, 0, 0]), -4 + 3); // infeasible, penalised
  const Q = quboMatrix(q);
  for (let k = 0; k < 32; k++) {
    const x = bitsOf(k, 5);
    let e = q.offset;
    for (let i = 0; i < 5; i++) for (let j = i; j < 5; j++) e += Q[i][j] * x[i] * x[j];
    close(e, E(x));
  }
});

test('QUBO: exhaustive validation of ground states on reference configurations', () => {
  for (const cfg of [{}, { respectInaccessible: false, radiusM: 400 }, { candidateCount: 6, budget: 2 }, { candidateCount: 12, budget: 4, weightPreset: 'synthetic-hubs' }, { radiusM: 520 }]) {
    const p = P(cfg);
    const q = buildQubo(p);
    assert.ok(q.n <= 22, `n=${q.n}`);
    const v = validateQubo(p, q, (s) => evaluate(p, s).coveredWeight);
    assert.ok(v.valid, JSON.stringify({ cfg, ...v, groundStates: undefined }));
    close(v.minEnergy, -bruteForce(p).coveredWeight, 1e-7);
  }
});

test('QUBO: aux variables are consistent in every ground state', () => {
  const p = P({ radiusM: 520 });
  const q = buildQubo(p);
  assert.ok(q.nAux > 0);
  const E = allEnergies(q);
  let m = Infinity; for (const e of E) m = Math.min(m, e);
  for (let k = 0; k < E.length; k++) if (E[k] <= m + 1e-9) {
    const d = decode(p, q, bitsOf(k, q.n));
    assert.ok(d.auxConsistent && d.slackConsistent && d.feasible);
  }
});

test('QUBO: too small penalties break the formulation (penalty experiment)', () => {
  const p = P();
  const q = buildQubo(p, { budgetPenalty: 0.1 });
  const v = validateQubo(p, q, (s) => evaluate(p, s).coveredWeight);
  assert.equal(v.valid, false);
  assert.ok(v.infeasibleViolations > 0);
});

test('Ising transform preserves every energy', () => {
  const p = P({ radiusM: 400 });
  const q = buildQubo(p);
  const is = toIsing(q);
  const E = allEnergies(q);
  for (let k = 0; k < E.length; k += 7) {
    const b = bitsOf(k, q.n);
    const z = [...b].map((x) => 1 - 2 * x);
    let e = is.constant;
    for (let i = 0; i < q.n; i++) e += is.h[i] * z[i];
    for (const [u, v, J] of is.J) e += J * z[u] * z[v];
    close(e, E[k], 1e-8);
  }
});

test('statevector: gates, normalisation and sampling', () => {
  const s = new State(2).h(0).cnot(0, 1);
  const pr = s.probabilities();
  close(pr[0], 0.5); close(pr[3], 0.5); close(pr[1] + pr[2], 0);
  const r = new State(1).rx(0, Math.PI);
  close(r.probabilities()[1], 1);
  const z = new State(1).h(0).rz(0, Math.PI).h(0);
  close(z.probabilities()[1], 1);
  const zz = new State(2).h(0).h(1).rzz(0, 1, 0.8);
  close(zz.norm2(), 1);
  assert.equal(statevectorBytes(10), 16384);
  const counts = sample(Float64Array.from([0.25, 0.75]), 4000, mulberry32(1));
  close(counts.get(1) / 4000, 0.75, 0.03);
});

test('QAOA: diagonal evolution equals explicit gate circuit', () => {
  const p = P({ radiusM: 400 });
  const q = buildQubo(p);
  const spec = costSpectrum(q);
  const g = [0.7, 1.3], b = [0.4, 0.2];
  const a = qaoaState(q.n, spec.diag, g, b), c = runCircuit(qaoaCircuit(q, g, b, spec.width));
  close(a.norm2(), 1, 1e-12);
  const pa = a.probabilities(), pc = c.probabilities();
  for (let k = 0; k < pa.length; k++) close(pa[k], pc[k], 1e-12);
  // p=0 / beta=0: uniform superposition, expectation = mean energy
  const u = qaoaState(q.n, spec.diag, [0], [0]);
  close(u.expectationDiagonal(spec.diag), spec.diag.reduce((s, v) => s + v, 0) / spec.diag.length, 1e-12);
});

test('QAOA: optimiser, reproducibility, independent decoding', () => {
  const nm = nelderMead(([x, y]) => (x - 1) ** 2 + (y + 2) ** 2, [0, 0], { maxEval: 500, tol: 1e-14 });
  close(nm.x[0], 1, 1e-5); close(nm.x[1], -2, 1e-5);
  const p = P();
  const q = buildQubo(p);
  const r1 = solveQaoa(p, q, { layers: 1, seed: 11, shots: 512 });
  const r2 = solveQaoa(p, q, { layers: 1, seed: 11, shots: 512 });
  assert.deepEqual(r1.stations, r2.stations);
  assert.deepEqual(r1.gammas, r2.gammas);
  assert.equal(r1.samples.reduce((s, x) => s + x.count, 0) <= 512, true);
  assert.ok(r1.stations.length <= p.budget);
  close(evaluate(p, r1.stations).coveredWeight, r1.coveredWeight);
  const uniform = qaoaState(q.n, costSpectrum(q).diag, [0], [0]).expectationDiagonal(costSpectrum(q).diag);
  assert.ok(r1.expectation < uniform, 'optimised expectation must beat the uniform state');
  const skip = solveQaoa(p, q, { maxQubits: 4 });
  assert.equal(skip.skipped, true);
});

test('fixtures on disk are up to date', () => {
  for (const f of FIXTURES) {
    const disk = fs.readFileSync(new URL(`../../fixtures/${f.name}.txt`, import.meta.url), 'utf8');
    assert.equal(disk, fixtureText(f), `fixture ${f.name} stale: run npm run fixtures`);
  }
});

test('compareCoverage classifies every zone', () => {
  const p = P();
  const c = compareCoverage(p, [1, 3, 4], [0, 2, 5]);
  assert.equal(c.counts.both + c.counts.onlyA + c.counts.onlyB + c.counts.neither, p.Z);
});
