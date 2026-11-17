// QAOA on the exact QUBO.  |γ,β> = Π_l [ U_M(β_l) U_C(γ_l) ] H^{⊗n} |0…0>,
// U_C(γ) = exp(-i γ Ĥ_C), U_M(β) = exp(-i β Σ X_k) = Π RX_k(2β).
// Ĥ_C is the Ising cost Hamiltonian divided by ΔE = E_max - E_min (spectral width), so
// γ ∈ [0, 2π) has the same meaning for every instance. Objective: <Ĥ_C> (minimised).
// QAOA never sees the brute-force result: it only gets the QUBO and decodes samples itself.
import { State, sample, statevectorBytes } from './statevector.js';
import { allEnergies, toIsing, bitsOf, decode } from './qubo.js';
import { evaluate } from './coverage.js';
import { mulberry32 } from './rng.js';

export const BROWSER_MAX_QUBITS = 20; // 2^20 amplitudes = 16 MiB per statevector

export function costSpectrum(qubo) {
  const E = allEnergies(qubo);
  let lo = Infinity, hi = -Infinity;
  for (const e of E) { if (e < lo) lo = e; if (e > hi) hi = e; }
  const width = hi - lo || 1;
  const diag = new Float64Array(E.length);
  for (let k = 0; k < E.length; k++) diag[k] = E[k] / width;
  return { E, diag, min: lo, max: hi, width };
}

export function qaoaState(n, diag, gammas, betas) {
  const s = new State(n);
  for (let q = 0; q < n; q++) s.h(q);
  for (let l = 0; l < gammas.length; l++) {
    s.phaseDiagonal(diag, gammas[l]);
    for (let q = 0; q < n; q++) s.rx(q, 2 * betas[l]);
  }
  return s;
}

// Same state built from explicit gates (RZ / RZZ from the Ising form). Used by tests and the
// circuit view to show that the diagonal shortcut is the circuit.
export function qaoaCircuit(qubo, gammas, betas, width) {
  const ising = toIsing(qubo);
  const ops = [];
  for (let q = 0; q < qubo.n; q++) ops.push({ gate: 'h', q: [q] });
  for (let l = 0; l < gammas.length; l++) {
    const g = gammas[l] / width;
    for (let q = 0; q < qubo.n; q++) if (ising.h[q] !== 0) ops.push({ gate: 'rz', q: [q], theta: 2 * g * ising.h[q], layer: l });
    for (const [u, v, J] of ising.J) ops.push({ gate: 'rzz', q: [u, v], theta: 2 * g * J, layer: l });
    for (let q = 0; q < qubo.n; q++) ops.push({ gate: 'rx', q: [q], theta: 2 * betas[l], layer: l });
  }
  return { n: qubo.n, ops, ising };
}

export function runCircuit(circuit) {
  const s = new State(circuit.n);
  for (const op of circuit.ops) {
    if (op.gate === 'h') s.h(op.q[0]);
    else if (op.gate === 'rz') s.rz(op.q[0], op.theta);
    else if (op.gate === 'rx') s.rx(op.q[0], op.theta);
    else if (op.gate === 'rzz') s.rzz(op.q[0], op.q[1], op.theta);
  }
  return s;
}

// Nelder–Mead (deterministic given the start point).
export function nelderMead(f, x0, { step = 0.3, maxEval = 400, tol = 1e-7 } = {}) {
  const n = x0.length;
  let evals = 0;
  const F = (x) => { evals++; return f(x); };
  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step; simplex.push(x); }
  let vals = simplex.map(F);
  const trace = [];
  while (evals < maxEval) {
    const order = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
    simplex = order.map((i) => simplex[i]); vals = order.map((i) => vals[i]);
    trace.push(vals[0]);
    if (Math.abs(vals[n] - vals[0]) < tol) break;
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let d = 0; d < n; d++) c[d] += simplex[i][d] / n;
    const at = (t) => c.map((ci, d) => ci + t * (simplex[n][d] - ci));
    const xr = at(-1), fr = F(xr);
    if (fr < vals[0]) {
      const xe = at(-2), fe = F(xe);
      if (fe < fr) { simplex[n] = xe; vals[n] = fe; } else { simplex[n] = xr; vals[n] = fr; }
    } else if (fr < vals[n - 1]) { simplex[n] = xr; vals[n] = fr; }
    else {
      const xc = fr < vals[n] ? at(-0.5) : at(0.5), fc = F(xc);
      if (fc < Math.min(fr, vals[n])) { simplex[n] = xc; vals[n] = fc; }
      else {
        for (let i = 1; i <= n; i++) { simplex[i] = simplex[i].map((v, d) => simplex[0][d] + 0.5 * (v - simplex[0][d])); vals[i] = F(simplex[i]); }
      }
    }
  }
  let bi = 0; for (let i = 1; i <= n; i++) if (vals[i] < vals[bi]) bi = i;
  return { x: simplex[bi], f: vals[bi], evals, trace };
}

export function solveQaoa(problem, qubo, opts = {}) {
  const p = opts.layers ?? 2;
  const shots = opts.shots ?? 1024;
  const seed = opts.seed ?? 7;
  const restarts = opts.restarts ?? 3;
  const maxEval = opts.maxEval ?? 300;
  const maxQubits = opts.maxQubits ?? BROWSER_MAX_QUBITS;
  if (qubo.n > maxQubits) {
    return { method: 'qaoa', skipped: true, reason: `QUBO braucht ${qubo.n} Qubits; Limit ${maxQubits} (Statevector ${(statevectorBytes(qubo.n) / 2 ** 20).toFixed(0)} MiB).`, qubits: qubo.n };
  }
  const t0 = performance.now();
  const spec = costSpectrum(qubo);
  const rnd = mulberry32(seed);
  const f = (x) => qaoaState(qubo.n, spec.diag, x.slice(0, p), x.slice(p)).expectationDiagonal(spec.diag);
  const starts = [];
  // linear ramp (annealing-inspired) + seeded random starts
  starts.push([...Array.from({ length: p }, (_, l) => (0.8 * (l + 1)) / p), ...Array.from({ length: p }, (_, l) => 0.8 * (1 - l / p) * 0.5)]);
  for (let r = 1; r < restarts; r++) starts.push([...Array.from({ length: p }, () => rnd() * Math.PI), ...Array.from({ length: p }, () => rnd() * Math.PI / 2)]);
  let best = null, evals = 0;
  const runs = [];
  for (const x0 of starts) {
    const r = nelderMead(f, x0, { maxEval });
    evals += r.evals;
    runs.push({ start: x0, f: r.f, evals: r.evals, trace: r.trace });
    if (!best || r.f < best.f) best = r;
  }
  const gammas = best.x.slice(0, p), betas = best.x.slice(p);
  const state = qaoaState(qubo.n, spec.diag, gammas, betas);
  const probs = state.probabilities();
  const counts = sample(probs, shots, rnd);
  const samples = [...counts].map(([k, c]) => {
    const bits = bitsOf(k, qubo.n);
    const d = decode(problem, qubo, bits);
    const ev = evaluate(problem, d.stations);
    return { index: k, count: c, probability: probs[k], energy: spec.E[k], ...d, coveredWeight: ev.coveredWeight };
  }).sort((a, b) => b.count - a.count || a.index - b.index);
  const feasible = samples.filter((s) => s.feasible);
  let chosen = null;
  for (const s of feasible) {
    if (!chosen || s.coveredWeight > chosen.coveredWeight + 1e-9 || (Math.abs(s.coveredWeight - chosen.coveredWeight) <= 1e-9 && (s.stations.length < chosen.stations.length || (s.stations.length === chosen.stations.length && s.count > chosen.count)))) chosen = s;
  }
  const feasibleShots = feasible.reduce((a, s) => a + s.count, 0);
  let pFeasible = 0, pGround = 0, ground = [];
  for (let k = 0; k < probs.length; k++) {
    const x = k % 2 ** qubo.N;
    let cnt = 0; for (let i = 0; i < qubo.N; i++) if (Math.floor(x / 2 ** i) % 2) cnt++;
    if (cnt <= problem.budget) pFeasible += probs[k];
    if (spec.E[k] <= spec.min + 1e-9) { pGround += probs[k]; ground.push(k); }
  }
  return {
    method: 'qaoa', exact: false, skipped: false, layers: p, shots, seed, restarts,
    qubits: qubo.n, stateBytes: statevectorBytes(qubo.n),
    gammas, betas, expectation: best.f, expectationEnergy: best.f * spec.width,
    spectrum: { min: spec.min, max: spec.max, width: spec.width },
    evaluations: evals, runs,
    stations: chosen ? chosen.stations : [], coveredWeight: chosen ? chosen.coveredWeight : 0,
    foundFeasible: Boolean(chosen),
    samples: samples.slice(0, 64), distinctSamples: samples.length,
    feasibleShots, pFeasible, pGround, groundIndices: ground,
    timeMs: performance.now() - t0,
  };
}
