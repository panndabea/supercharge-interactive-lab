from pathlib import Path

import numpy as np
import pytest

from supercharge.core import build_qubo, load_fixture, evaluate, brute_force

qiskit = pytest.importorskip("qiskit")
from supercharge.qaoa import cost_operator, probabilities, qaoa_circuit, solve_qaoa  # noqa: E402

FIX = Path(__file__).resolve().parents[3] / "fixtures"


@pytest.mark.parametrize("name", ["default", "all9-r400", "six-b2-r250", "twelve-b4-hubs"])
def test_qiskit_state_matches_js_fixture(name):
    p, e = load_fixture(FIX / f"{name}.txt")
    q = build_qubo(p)
    width = float(e["qaoa_width"][0])
    g1, g2, b1, b2 = map(float, e["qaoa_params"])
    qc = qaoa_circuit(q, [g1, g2], [b1, b2], width)
    pr = probabilities(qc)
    assert abs(pr.sum() - 1) < 1e-12
    from qiskit.quantum_info import Statevector
    exp_op = Statevector.from_instruction(qc).expectation_value(cost_operator(q, width)).real
    # <H_C> via SparsePauliOp drops the constant term; add it back for the comparison
    from supercharge.core import to_ising
    const = to_ising(q)[2] / width
    assert abs(exp_op + const - float(e["qaoa_expectation"][0])) < 1e-9


def test_solve_qaoa_default():
    p, _ = load_fixture(FIX / "default.txt")
    q = build_qubo(p)
    r = solve_qaoa(p, q, layers=1, shots=512, seed=3, restarts=2, maxiter=60)
    assert not r["skipped"] and r["foundFeasible"]
    assert len(r["stations"]) <= p.budget
    assert r["coveredWeight"] == evaluate(p, r["stations"])
    assert r["coveredWeight"] <= brute_force(p)[1]
    assert sum(s["count"] for s in r["samples"]) <= 512
    assert solve_qaoa(p, q, max_qubits=4)["skipped"]
