"""Pure-Python core. Mirrors website/js/math/*.js exactly (same orders, same tie-breaking)."""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from itertools import combinations
from pathlib import Path

EARTH_RADIUS_M = 6371008.8
EPS = 1e-9

WEIGHT_HUBS = [(40.758, -73.9855), (40.7527, -73.9772), (40.757, -73.9905)]
HUB_RADIUS_M, HUB_WEIGHT = 350.0, 3.0


def haversine(lat1, lon1, lat2, lon2, r=EARTH_RADIUS_M):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def mulberry32(seed: int):
    a = seed & 0xFFFFFFFF

    def imul(x, y):
        return (x * y) & 0xFFFFFFFF

    def nxt():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = a
        t = imul(t ^ (t >> 15), t | 1)
        t ^= (t + imul(t ^ (t >> 7), t | 61)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return nxt


@dataclass
class Problem:
    candidates: list  # [(lat, lon)]
    zones: list  # [(lat, lon)]
    weights: list
    radius: float
    budget: int
    names: list = field(default_factory=list)
    cover: list = field(init=False)
    covered_by: list = field(init=False)

    def __post_init__(self):
        self.cover = [
            [j for j, (zl, zo) in enumerate(self.zones) if haversine(cl, co, zl, zo) <= self.radius]
            for cl, co in self.candidates
        ]
        self.covered_by = [[] for _ in self.zones]
        for i, lst in enumerate(self.cover):
            for j in lst:
                self.covered_by[j].append(i)

    @property
    def N(self):
        return len(self.candidates)

    @property
    def total_weight(self):
        return sum(self.weights)


def problem_from_instance(inst: dict, candidate_count=None, budget=None, radius=None,
                          weights="uniform", respect_inaccessible=True) -> Problem:
    d = inst["defaults"]
    cc = candidate_count or d["candidateCount"]
    b = d["budget"] if budget is None else budget
    r = d["radiusM"] if radius is None else radius
    cands = [c for c in inst["candidates"][:cc] if not (respect_inaccessible and c["accessible"] is False)]
    zones = [z for z in inst["zones"] if not (respect_inaccessible and z["accessible"] is False)]

    def w(z):
        if weights == "synthetic-hubs":
            for hl, ho in WEIGHT_HUBS:
                if haversine(z["lat"], z["lon"], hl, ho) <= HUB_RADIUS_M:
                    return HUB_WEIGHT
        return float(z.get("weight", 1))

    return Problem([(c["lat"], c["lon"]) for c in cands], [(z["lat"], z["lon"]) for z in zones],
                   [w(z) for z in zones], float(r), int(b), [c["name"] for c in cands])


def load_instance(path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_fixture(path) -> tuple[Problem, dict]:
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    it = iter(lines)
    exp: dict = {"cover": {}, "qubo_quad": [], "qubo_aux": []}
    name = next(it).split()[1]
    radius = float(next(it).split()[1])
    budget = int(next(it).split()[1])
    nc = int(next(it).split()[1])
    cands = [tuple(map(float, next(it).split())) for _ in range(nc)]
    nz = int(next(it).split()[1])
    zones, weights = [], []
    for _ in range(nz):
        la, lo, w = map(float, next(it).split())
        zones.append((la, lo))
        weights.append(w)
    for line in it:
        if line == "end":
            break
        k, *v = line.split()
        if k == "cover":
            exp["cover"][int(v[0])] = [int(x) for x in v[1:]]
        elif k == "qubo_quad":
            exp["qubo_quad"].append((int(v[0]), int(v[1]), float(v[2])))
        elif k == "qubo_aux":
            exp["qubo_aux"].append(tuple(int(x) for x in v))
        else:
            exp[k] = v
    exp["name"] = name
    return Problem(cands, zones, weights, radius, budget), exp


def evaluate(p: Problem, stations) -> float:
    cov = set()
    for i in stations:
        cov.update(p.cover[i])
    return sum(p.weights[j] for j in cov)


def brute_force(p: Problem):
    """Depth-first lexicographic enumeration of all |S| <= B. Same tie-breaking as JS."""
    K = min(p.budget, p.N)
    best_w, best_k, best, evaluated = -1.0, math.inf, [], 0
    stack: list[int] = []
    hits = [0] * len(p.zones)
    w = 0.0

    def rec(start):
        nonlocal best_w, best_k, best, evaluated, w
        evaluated += 1
        if w > best_w + EPS or (abs(w - best_w) <= EPS and len(stack) < best_k):
            best_w, best_k, best = w, len(stack), stack.copy()
        if len(stack) == K:
            return
        for i in range(start, p.N):
            for j in p.cover[i]:
                if hits[j] == 0:
                    w += p.weights[j]
                hits[j] += 1
            stack.append(i)
            rec(i + 1)
            stack.pop()
            for j in p.cover[i]:
                hits[j] -= 1
                if hits[j] == 0:
                    w -= p.weights[j]

    rec(0)
    return best, best_w, evaluated


def greedy(p: Problem):
    sel, cov, w = [], set(), 0.0
    while len(sel) < min(p.budget, p.N):
        bi, bg = -1, 0.0
        for i in range(p.N):
            if i in sel:
                continue
            g = sum(p.weights[j] for j in p.cover[i] if j not in cov)
            if g > bg + EPS:
                bi, bg = i, g
        if bi < 0:
            break
        sel.append(bi)
        cov.update(p.cover[bi])
        w += bg
    return sorted(sel), w


def slack_coefficients(B: int):
    if B <= 0:
        return []
    m = int(math.floor(math.log2(B))) + 1
    return [2 ** k for k in range(m - 1)] + [B - (2 ** (m - 1) - 1)]


@dataclass
class Qubo:
    n: int
    N: int
    n_slack: int
    slack: list
    aux: list  # (index, a, b)
    linear: list
    quad: dict  # (u, v) u<v -> c
    offset: float
    lam: float
    M: float


def _add(poly, key, c):
    v = poly.get(key, 0.0) + c
    if abs(v) < 1e-12:
        poly.pop(key, None)
    else:
        poly[key] = v


def build_qubo(p: Problem, penalty_scale=1.0, budget_penalty=None, aux_penalty=None) -> Qubo:
    N, B = p.N, p.budget
    groups: dict = {}
    for j, C in enumerate(p.covered_by):
        if not C or p.weights[j] == 0:
            continue
        groups[tuple(C)] = groups.get(tuple(C), 0.0) + p.weights[j]
    poly: dict = {}
    for C, wt in groups.items():
        for r in range(1, len(C) + 1):
            for sub in combinations(C, r):
                _add(poly, sub, -wt if r % 2 else wt)
    high = sum(abs(c) for k, c in poly.items() if len(k) >= 3)
    mono = [[list(k), c] for k, c in poly.items()]
    tmp = []
    while True:
        counts: dict = {}
        for vars_, _ in mono:
            if len(vars_) < 3:
                continue
            for a, b in combinations(vars_, 2):
                counts[(a, b)] = counts.get((a, b), 0) + 1
        if not counts:
            break
        best = min(counts, key=lambda k: (-counts[k], k))
        a, b = best
        z = 1000 + len(tmp)
        tmp.append((z, a, b))
        for m in mono:
            if len(m[0]) >= 3 and a in m[0] and b in m[0]:
                m[0] = sorted([v for v in m[0] if v not in (a, b)] + [z])
    slack = slack_coefficients(B)
    need = B < N
    ns = len(slack) if need else 0
    remap = {i: i for i in range(N)}
    for k, (z, _, _) in enumerate(tmp):
        remap[z] = N + ns + k
    n = N + ns + len(tmp)
    aux = [(remap[z], remap[a], remap[b]) for z, a, b in tmp]
    linear = [0.0] * n
    quad: dict = {}
    offset = 0.0

    def add(vars_, c):
        nonlocal offset
        if c == 0:
            return
        v = sorted(remap.get(x, x) for x in vars_)
        if not v:
            offset += c
        elif len(v) == 1 or v[0] == v[1]:
            linear[v[0]] += c
        else:
            quad[(v[0], v[1])] = quad.get((v[0], v[1]), 0.0) + c

    for vars_, c in mono:
        add(vars_, c)
    max_w = max([0.0] + [sum(p.weights[j] for j in lst) for lst in p.cover])
    lam = budget_penalty if budget_penalty is not None else penalty_scale * (1 + max_w)
    if need:
        terms = [(i, 1) for i in range(N)] + [(N + k, slack[k]) for k in range(ns)]
        for v, a in terms:
            add([v], lam * (a * a - 2 * B * a))
        for x in range(len(terms)):
            for y in range(x + 1, len(terms)):
                add([terms[x][0], terms[y][0]], lam * 2 * terms[x][1] * terms[y][1])
        add([], lam * B * B)
    M = aux_penalty if aux_penalty is not None else penalty_scale * (1 + high)
    for idx, a, b in aux:
        add([a, b], M)
        add([a, idx], -2 * M)
        add([b, idx], -2 * M)
        add([idx], 3 * M)
    quad = {k: v for k, v in quad.items() if abs(v) >= 1e-12}
    return Qubo(n, N, ns, slack if need else [], aux, linear, quad, offset, lam, M)


def qubo_energy(q: Qubo, bits) -> float:
    e = q.offset + sum(q.linear[i] for i in range(q.n) if bits[i])
    return e + sum(c for (u, v), c in q.quad.items() if bits[u] and bits[v])


def all_energies(q: Qubo):
    """Vectorised energies of all 2^n basis states (bit k of the index = variable k)."""
    import numpy as np

    idx = np.arange(2 ** q.n, dtype=np.int64)
    bits = [((idx >> k) & 1).astype(np.float64) for k in range(q.n)]
    E = np.full(2 ** q.n, q.offset, dtype=np.float64)
    for k in range(q.n):
        E += q.linear[k] * bits[k]
    for (u, v), c in q.quad.items():
        E += c * bits[u] * bits[v]
    return E


def to_ising(q: Qubo):
    h = [0.0] * q.n
    J = []
    c = q.offset
    for i in range(q.n):
        c += q.linear[i] / 2
        h[i] -= q.linear[i] / 2
    for (u, v), w in sorted(q.quad.items()):
        c += w / 4
        h[u] -= w / 4
        h[v] -= w / 4
        J.append((u, v, w / 4))
    return h, J, c


def decode(p: Problem, q: Qubo, index: int):
    bits = [(index >> k) & 1 for k in range(q.n)]
    stations = [i for i in range(q.N) if bits[i]]
    slack_value = sum(q.slack[k] for k in range(q.n_slack) if bits[q.N + k])
    return {
        "stations": stations,
        "feasible": len(stations) <= p.budget,
        "slackValue": slack_value,
        "auxConsistent": all(bits[z] == (bits[a] & bits[b]) for z, a, b in q.aux),
    }
