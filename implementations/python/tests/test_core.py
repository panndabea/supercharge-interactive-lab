import math
from pathlib import Path

import pytest

from supercharge.core import (all_energies, brute_force, build_qubo, greedy, load_fixture, mulberry32,
                              qubo_energy, to_ising)

FIX = Path(__file__).resolve().parents[3] / "fixtures"
NAMES = ["default", "all9-r400", "six-b2-r250", "twelve-b4-hubs"]
TOL = 1e-9  # coefficients are sums of small integers -> exact; float noise only from haversine/QAOA


@pytest.fixture(params=NAMES)
def fx(request):
    return load_fixture(FIX / f"{request.param}.txt")


def test_rng():
    v = (FIX / "rng.txt").read_text().split()
    r = mulberry32(int(v[1]))
    assert [r() for _ in v[2:]] == [float(x) for x in v[2:]]


def test_coverage(fx):
    p, e = fx
    for i, lst in e["cover"].items():
        assert p.cover[i] == lst


def test_brute_force_and_greedy(fx):
    p, e = fx
    st, w, ev = brute_force(p)
    assert w == float(e["bf_weight"][0])
    assert st == [int(x) for x in e.get("bf_stations", [])]
    assert ev == int(e["bf_evaluated"][0]) == sum(math.comb(p.N, k) for k in range(min(p.budget, p.N) + 1))
    gs, gw = greedy(p)
    assert gw == float(e["greedy_weight"][0])
    assert gs == [int(x) for x in e.get("greedy_stations", [])]


def test_qubo(fx):
    p, e = fx
    q = build_qubo(p)
    n, ns, na = map(int, e["qubo_n"])
    assert (q.n, q.n_slack, len(q.aux)) == (n, ns, na)
    assert q.lam == float(e["qubo_lambda"][0]) and q.M == float(e["qubo_M"][0])
    assert abs(q.offset - float(e["qubo_offset"][0])) <= TOL
    assert all(abs(a - float(b)) <= TOL for a, b in zip(q.linear, e["qubo_linear"]))
    assert sorted(q.quad) == [(u, v) for u, v, _ in e["qubo_quad"]]
    for u, v, c in e["qubo_quad"]:
        assert abs(q.quad[(u, v)] - c) <= TOL
    assert q.aux == e["qubo_aux"]
    E = all_energies(q)
    assert abs(E.min() - float(e["qubo_min"][0])) <= TOL
    assert abs(E.min() + float(e["bf_weight"][0])) <= TOL
    k = int(E.argmin())
    assert abs(qubo_energy(q, [(k >> b) & 1 for b in range(q.n)]) - E[k]) <= TOL
    h, J, c = to_ising(q)
    assert abs(c - float(e["ising_constant"][0])) <= 1e-8
    assert all(abs(a - float(b)) <= 1e-9 for a, b in zip(h, e["ising_h"]))
