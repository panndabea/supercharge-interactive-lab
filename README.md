# Supercharge Interactive Lab

Interaktive, mathematisch exakte Lernumgebung für das Supercharge-Problem: Wo baut man **B** Schnellladestationen, damit möglichst viel Nachfrage in Reichweite **r** liegt? Von echter Stadtgeografie (Midtown Manhattan, OpenStreetMap) über Maximum Coverage, Brute Force und Heuristiken bis zu QUBO, Ising-Modell und einer echten, lokal simulierten QAOA-Implementierung.

| Produkt | Start | Technik |
| --- | --- | --- |
| Lernseite (54 Kapitel, Labor, Code-Explorer) | GitHub Pages bzw. `npm run serve` | Vanilla JS (ES-Module), SVG, Web Worker, eigener Statevector |
| Docker-App | `docker compose up` → http://localhost:8000 | FastAPI, Qiskit 2.6 + Aer, Leaflet |

Beide nutzen dieselbe Referenzinstanz (`website/data/reference-instance.json`) und dieselbe Semantik.

## Schnellstart

```bash
docker compose up            # Docker-App auf Port 8000, keine Credentials nötig
npm run serve                # Lernseite lokal auf http://localhost:8080/
```

Falls Docker Hub drosselt, kann ein Mirror als Basisimage gesetzt werden: `BASE_IMAGE=mirror.gcr.io/library/python:3.12-slim docker compose up --build`.

## Referenzinstanz `midtown-manhattan-v1`

- Fläche: Bounding Box `[-73.9960, 40.7480, -73.9710, 40.7680]` (WGS 84).
- Geometrie: © OpenStreetMap-Mitwirkende, ODbL 1.0 (erzeugt mit `tools/build_reference_data.py`).
- 24 Kandidaten an realen Kreuzungen – **hypothetische** Standorte. Standard: die ersten 9, davon 8 zugänglich.
- 83 Nachfragezonen, synthetisches 200-m-Raster; Gewichte **synthetisch**, keine Bevölkerungsdaten.
- Standard: B = 3, r = 300 m, uniforme Gewichte → exaktes Optimum {x1, x3, x4} mit Gewicht 21 (93 geprüfte Teilmengen); QUBO mit 10 Variablen (2 Schlupf, 0 Hilfsvariablen).

## Mathematik in einem Absatz

Zone j ist abgedeckt, wenn `haversine(Station, Zone) ≤ r`. Ziel: max Σ w_j [1 − Π_{i∈S_j}(1 − x_i)] mit Σ x_i ≤ B; jede Zone zählt einmal. Das QUBO entwickelt jede Zone exakt per Inklusion–Exklusion, reduziert Monome vom Grad ≥ 3 mit Rosenberg-Hilfsvariablen und kodiert das Budget mit gekappten binären Schlupfbits. Für kleine n wird das QUBO vollständig enumeriert und gegen Brute Force validiert. Ising per x = (1 − z)/2. QAOA: H^⊗n, Kosten-Layer aus der normierten Ising-Energie (RZ/RZZ), X-Mixer RX(2β), seedbare Optimierung (Nelder–Mead im Browser, COBYLA in Qiskit), Sampling, unabhängige Zulässigkeitsprüfung. Details: [docs/qubo-derivation.md](docs/qubo-derivation.md).

## Implementierungen und Conformance

| Sprache | Pfad | Test |
| --- | --- | --- |
| JavaScript | `website/js/math/` | `npm test` |
| Python / Qiskit | `implementations/python/` | `pytest implementations/python/tests` |
| Go | `implementations/go/` | `go test ./...` |
| Rust | `implementations/rust/` | `cargo test` |
| C++23 | `implementations/cpp/` | `make test` |

Alle laufen gegen die gemeinsamen Fixtures in `fixtures/` (Distanz, Abdeckung, Brute Force, Greedy, QUBO-Koeffizienten, QUBO-Minimum, Ising-Konstanten, QAOA-Erwartungswert). Absolute Toleranz 1e-9 (QUBO-Koeffizienten, Energien, QAOA-Erwartungswert): alle Werte sind kurze Summen doppelt genauer Terme; Indizes, Mengen und Zählwerte werden exakt verglichen. `npm run check` stellt sicher, dass die Fixtures zum JS-Kern passen.

## Grenzen

- Browser-QAOA: höchstens 20 Qubits (16 MiB Statevector), Docker: `SUPERCHARGE_MAX_QUBITS` (Standard 18). Darüber wird QAOA sauber übersprungen; die klassischen Solver laufen weiter.
- Brute Force: Browser bis 2 000 000, Docker `SUPERCHARGE_MAX_SUBSETS` (Standard 300 000) zulässige Teilmengen.
- Laufzeiten sind gemessen und geräteabhängig. Es wird kein Quantenvorteil behauptet.

## Tests

```bash
npm test && npm run check                       # JS-Kern + Fixtures
python -m pytest implementations/python/tests app/tests
npx playwright test                              # Browser-Smoke-Tests (Desktop + Mobile)
```

CI: `.github/workflows/test.yml` (JS, Python, Go, Rust, C++, Browser, Docker), Deployment: `.github/workflows/pages.yml`.

## Lizenz der Daten

Kartendaten © OpenStreetMap-Mitwirkende, verfügbar unter der Open Database License (ODbL) 1.0. Leaflet 1.9.4 (BSD-2-Clause) liegt lokal unter `app/frontend/vendor/leaflet`.
