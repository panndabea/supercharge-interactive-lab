"""Supercharge Docker app: FastAPI backend. Classical exact search and Qiskit QAOA run in
separate endpoints so the classical answer never waits for the quantum simulation."""
from __future__ import annotations

import json
import math
import os
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from supercharge.core import QuboTooLarge, brute_force, build_qubo, evaluate, greedy, haversine, problem_from_instance
from supercharge.qaoa import solve_qaoa

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get("SUPERCHARGE_DATA", ROOT / "website" / "data"))
FRONTEND = Path(os.environ.get("SUPERCHARGE_FRONTEND", ROOT / "app" / "frontend"))
MAX_SUBSETS = int(os.environ.get("SUPERCHARGE_MAX_SUBSETS", 300_000))
MAX_QUBITS = int(os.environ.get("SUPERCHARGE_MAX_QUBITS", 18))

INSTANCE = json.loads((DATA / "reference-instance.json").read_text(encoding="utf-8"))

app = FastAPI(title="Supercharge Interactive Lab", version="1.0.0")


class Config(BaseModel):
    candidateCount: int = Field(INSTANCE["defaults"]["candidateCount"], ge=1, le=len(INSTANCE["candidates"]))
    budget: int = Field(INSTANCE["defaults"]["budget"], ge=0, le=24)
    radiusM: float = Field(INSTANCE["defaults"]["radiusM"], ge=0, le=3000)
    weightPreset: str = Field("uniform", pattern="^(uniform|synthetic-hubs)$")
    respectInaccessible: bool = True


class QaoaRequest(Config):
    layers: int = Field(2, ge=1, le=6)
    shots: int = Field(1024, ge=16, le=20000)
    seed: int = Field(7, ge=0, le=2**31 - 1)
    restarts: int = Field(3, ge=1, le=8)
    maxiter: int = Field(150, ge=10, le=1000)


def make_problem(cfg: Config):
    p = problem_from_instance(INSTANCE, cfg.candidateCount, cfg.budget, cfg.radiusM, cfg.weightPreset,
                              cfg.respectInaccessible)
    active = [c for c in INSTANCE["candidates"][: cfg.candidateCount]
              if not (cfg.respectInaccessible and c["accessible"] is False)]
    zones = [z for z in INSTANCE["zones"] if not (cfg.respectInaccessible and z["accessible"] is False)]
    return p, active, zones


def zone_status(p, stations):
    hits = [0] * len(p.zones)
    for i in stations:
        for j in p.cover[i]:
            hits[j] += 1
    return hits


def summary(p, method, stations, extra=None):
    w = evaluate(p, stations)
    out = {"method": method, "stations": stations, "coveredWeight": w,
           "coveragePct": 100 * w / p.total_weight if p.total_weight else 0.0,
           "feasible": len(stations) <= p.budget, "zoneHits": zone_status(p, stations)}
    out.update(extra or {})
    return out


@app.get("/api/health")
def health():
    return {"status": "ok", "instance": INSTANCE["id"]}


@app.get("/api/instance")
def instance():
    return INSTANCE


@app.get("/api/area")
def area():
    return FileResponse(DATA / "reference-area.geojson", media_type="application/geo+json")


@app.post("/api/problem")
def problem(cfg: Config):
    p, active, zones = make_problem(cfg)
    n_feasible = sum(math.comb(p.N, k) for k in range(min(p.budget, p.N) + 1))
    q, qubo_error = None, None
    if p.N:
        try:
            q = build_qubo(p)
        except QuboTooLarge as e:
            qubo_error = str(e)
    return {
        "candidates": active, "zoneIds": [z["id"] for z in zones], "weights": p.weights,
        "cover": p.cover, "N": p.N, "Z": len(zones), "budget": p.budget, "radiusM": p.radius,
        "complexity": {"allSubsets": 2 ** p.N, "feasibleSubsets": n_feasible,
                       "quboVariables": q.n if q else None, "slack": q.n_slack if q else None,
                       "aux": len(q.aux) if q else None,
                       "statevectorBytes": 16 * 2 ** q.n if q else None, "quboError": qubo_error,
                       "maxQubits": MAX_QUBITS, "maxSubsets": MAX_SUBSETS},
        "penalties": {"lambda": q.lam, "M": q.M} if q else None,
    }


@app.post("/api/solve/classical")
def solve_classical(cfg: Config):
    p, _, _ = make_problem(cfg)
    n_feasible = sum(math.comb(p.N, k) for k in range(min(p.budget, p.N) + 1))
    t0 = time.perf_counter()
    gs, gw = greedy(p)
    greedy_ms = (time.perf_counter() - t0) * 1000
    res = {"greedy": summary(p, "greedy", gs, {"exact": False, "timeMs": greedy_ms})}
    if n_feasible > MAX_SUBSETS:
        res["exact"] = {"method": "brute-force", "skipped": True,
                        "reason": f"{n_feasible:,} zulässige Teilmengen > Limit {MAX_SUBSETS:,}".replace(",", ".")}
    else:
        t0 = time.perf_counter()
        st, w, ev = brute_force(p)
        res["exact"] = summary(p, "brute-force", st, {"exact": True, "evaluated": ev, "expected": n_feasible,
                                                      "timeMs": (time.perf_counter() - t0) * 1000})
    return res


@app.post("/api/solve/qaoa")
def solve_quantum(req: QaoaRequest):
    p, _, _ = make_problem(req)
    if p.N == 0:
        raise HTTPException(400, "Keine aktiven Kandidaten")
    try:
        q = build_qubo(p)
    except QuboTooLarge as e:
        return {"method": "qaoa", "exact": False, "skipped": True, "reason": str(e)}
    r = solve_qaoa(p, q, layers=req.layers, shots=req.shots, seed=req.seed, restarts=req.restarts,
                   maxiter=req.maxiter, max_qubits=MAX_QUBITS)
    if r["skipped"]:
        return r
    return {**summary(p, "qaoa", r["stations"]), **r, "zoneHits": zone_status(p, r["stations"])}


@app.get("/api/distance")
def distance(lat1: float, lon1: float, lat2: float, lon2: float):
    return {"metres": haversine(lat1, lon1, lat2, lon2)}


app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
