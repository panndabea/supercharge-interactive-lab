from fastapi.testclient import TestClient

from main import app, INSTANCE

client = TestClient(app)


def test_health_and_instance():
    assert client.get("/api/health").json()["status"] == "ok"
    assert client.get("/api/instance").json()["id"] == INSTANCE["id"]
    assert client.get("/api/area").status_code == 200
    assert "Leaflet" in client.get("/vendor/leaflet/leaflet.js").text[:300] or client.get("/").status_code == 200


def test_classical_default_matches_fixture():
    r = client.post("/api/solve/classical", json={}).json()
    assert r["exact"]["stations"] == [1, 3, 4]
    assert r["exact"]["coveredWeight"] == 21
    assert r["exact"]["evaluated"] == 93
    assert r["greedy"]["coveredWeight"] <= 21


def test_radius_changes_coverage():
    a = client.post("/api/problem", json={"radiusM": 200}).json()
    b = client.post("/api/problem", json={"radiusM": 400}).json()
    assert sum(map(len, a["cover"])) < sum(map(len, b["cover"]))


def test_limits():
    r = client.post("/api/solve/classical", json={"candidateCount": 24, "budget": 12}).json()
    assert r["exact"]["skipped"]
    q = client.post("/api/solve/qaoa", json={"candidateCount": 24}).json()
    assert q["skipped"]


def test_qaoa_default():
    r = client.post("/api/solve/qaoa", json={"layers": 1, "shots": 256, "restarts": 1, "maxiter": 40}).json()
    assert not r["skipped"] and r["qubits"] == 10
    assert len(r["stations"]) <= 3 and r["coveredWeight"] <= 21
    assert len(r["zoneHits"]) == 80


def test_oversized_qubo_is_skipped_not_expanded():
    cfg = {"candidateCount": 24, "radiusM": 3000, "budget": 3}
    prob = client.post("/api/problem", json=cfg).json()
    assert prob["complexity"]["quboVariables"] is None and "zu groß" in prob["complexity"]["quboError"]
    r = client.post("/api/solve/qaoa", json=cfg).json()
    assert r["skipped"] is True and "zu groß" in r["reason"]
    assert client.post("/api/solve/classical", json=cfg).json()["greedy"]["stations"]
