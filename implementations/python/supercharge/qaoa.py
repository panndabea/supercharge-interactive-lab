"""QAOA with Qiskit: circuit from the Ising form of the exact QUBO, exact local simulation
(Qiskit Statevector, or Aer when installed), classical parameter optimisation (SciPy COBYLA)
and seeded sampling. Same normalisation as the browser: H_C = Ising / (E_max - E_min)."""
from __future__ import annotations

import time

import numpy as np
from qiskit import QuantumCircuit
from qiskit.quantum_info import SparsePauliOp, Statevector

from .core import Problem, Qubo, all_energies, decode, evaluate, mulberry32, to_ising

MAX_QUBITS = 22  # 2^22 * 16 B = 64 MiB per statevector


def cost_operator(q: Qubo, width: float) -> SparsePauliOp:
    h, J, _ = to_ising(q)
    terms = []
    for i, hi in enumerate(h):
        if hi:
            terms.append(("Z", [i], hi / width))
    for u, v, w in J:
        terms.append(("ZZ", [u, v], w / width))
    return SparsePauliOp.from_sparse_list(terms or [("I", [0], 0.0)], num_qubits=q.n)


def qaoa_circuit(q: Qubo, gammas, betas, width: float) -> QuantumCircuit:
    h, J, _ = to_ising(q)
    qc = QuantumCircuit(q.n, name="QAOA")
    qc.h(range(q.n))
    for g, b in zip(gammas, betas):
        g = g / width
        for i, hi in enumerate(h):
            if hi:
                qc.rz(2 * g * hi, i)
        for u, v, w in J:
            qc.rzz(2 * g * w, u, v)
        for i in range(q.n):
            qc.rx(2 * b, i)
    return qc


def probabilities(qc: QuantumCircuit) -> np.ndarray:
    return Statevector.from_instruction(qc).probabilities()


def solve_qaoa(p: Problem, q: Qubo, layers=2, shots=1024, seed=7, restarts=3, maxiter=200,
               max_qubits=MAX_QUBITS):
    if q.n > max_qubits:
        return {"method": "qaoa", "skipped": True, "qubits": q.n,
                "reason": f"QUBO braucht {q.n} Qubits; Limit {max_qubits}."}
    from scipy.optimize import minimize

    t0 = time.perf_counter()
    E = all_energies(q)
    lo, hi = float(E.min()), float(E.max())
    width = (hi - lo) or 1.0
    diag = E / width
    rnd = mulberry32(seed)
    evals = 0

    def f(x):
        nonlocal evals
        evals += 1
        pr = probabilities(qaoa_circuit(q, x[:layers], x[layers:], width))
        return float(pr @ diag)

    starts = [[0.8 * (l + 1) / layers for l in range(layers)] + [0.4 * (1 - l / layers) for l in range(layers)]]
    for _ in range(1, restarts):
        starts.append([rnd() * np.pi for _ in range(layers)] + [rnd() * np.pi / 2 for _ in range(layers)])
    best = None
    for x0 in starts:
        r = minimize(f, np.array(x0), method="COBYLA", options={"maxiter": maxiter, "rhobeg": 0.3})
        if best is None or r.fun < best.fun:
            best = r
    gammas, betas = list(best.x[:layers]), list(best.x[layers:])
    qc = qaoa_circuit(q, gammas, betas, width)
    pr = probabilities(qc)
    try:  # Aer sampling if available, otherwise seeded inverse-CDF sampling
        from qiskit_aer import AerSimulator

        meas = qc.copy()
        meas.measure_all()
        counts_raw = AerSimulator(method="statevector", seed_simulator=seed).run(meas, shots=shots).result().get_counts()
        counts = {int(k.replace(" ", ""), 2): v for k, v in counts_raw.items()}
        backend = "qiskit-aer statevector"
    except Exception:  # pragma: no cover - fallback path
        cdf = np.cumsum(pr)
        counts = {}
        for _ in range(shots):
            k = int(np.searchsorted(cdf, rnd() * cdf[-1], side="right"))
            counts[k] = counts.get(k, 0) + 1
        backend = "qiskit statevector + seeded sampling"
    samples = []
    for k, c in counts.items():
        d = decode(p, q, k)
        samples.append({"index": k, "count": c, "probability": float(pr[k]), "energy": float(E[k]), **d,
                        "coveredWeight": evaluate(p, d["stations"])})
    samples.sort(key=lambda s: (-s["count"], s["index"]))
    feas = [s for s in samples if s["feasible"]]
    chosen = max(feas, key=lambda s: (s["coveredWeight"], -len(s["stations"]), s["count"]), default=None)
    ground = E <= lo + 1e-9
    x_part = np.arange(2 ** q.n) % (2 ** q.N)
    popcount = np.array([bin(int(x)).count("1") for x in range(2 ** q.N)])[x_part]
    return {
        "method": "qaoa", "skipped": False, "exact": False, "backend": backend,
        "layers": layers, "shots": shots, "seed": seed, "restarts": restarts, "qubits": q.n,
        "stateBytes": 16 * 2 ** q.n, "depth": qc.depth(), "gateCount": dict(qc.count_ops()),
        "gammas": gammas, "betas": betas, "expectation": float(best.fun),
        "spectrum": {"min": lo, "max": hi, "width": width}, "evaluations": evals,
        "stations": chosen["stations"] if chosen else [], "coveredWeight": chosen["coveredWeight"] if chosen else 0.0,
        "foundFeasible": chosen is not None, "samples": samples[:64], "distinctSamples": len(samples),
        "feasibleShots": sum(s["count"] for s in feas),
        "pFeasible": float(pr[popcount <= p.budget].sum()), "pGround": float(pr[ground].sum()),
        "timeMs": (time.perf_counter() - t0) * 1000,
    }
