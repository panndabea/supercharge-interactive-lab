// Final lab: one configuration drives map, all solvers, QUBO, circuit, QAOA and complexity.
import { mountWidget } from './widgets.js';

export function renderStudio(root, ctx) {
  root.innerHTML = `<div class="kicker">Abschluss-Labor</div><h1>Supercharge Studio</h1>
    <p class="lead">Konfiguriere die Instanz, vergleiche exakte und heuristische Solver mit QAOA und inspiziere jede Zwischenstufe. Alles läuft lokal; teure Rechnungen im Web Worker.</p>
    <div class="card warn">Ehrliche Einordnung: Für diese Größen ist Brute Force schneller und garantiert optimal. QAOA wird hier klassisch simuliert, um den Algorithmus nachvollziehbar zu machen – nicht, um einen Vorteil zu behaupten.</div>
    <div id="s-map"></div><div id="s-solvers"></div><div id="s-qaoa"></div><div class="grid2"><div id="s-qubo"></div><div id="s-circ"></div></div><div id="s-land"></div><div id="s-cx"></div>`;
  const m = (id, w) => mountWidget(root.querySelector(id), w, ctx);
  m('#s-map', { type: 'map', title: 'Manuelle Auswahl', controls: ['cand', 'budget', 'radius', 'weights', 'access'], interactive: true });
  m('#s-solvers', { type: 'solvers' });
  m('#s-qaoa', { type: 'qaoa' });
  m('#s-qubo', { type: 'qubo' });
  m('#s-circ', { type: 'circuit' });
  m('#s-land', { type: 'landscape' });
  m('#s-cx', { type: 'complexity' });
}
