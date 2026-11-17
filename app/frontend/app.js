// Docker app frontend: Leaflet maps, both solvers via the FastAPI backend.
const $ = (id) => document.getElementById(id);
const fmt = (x, d = 0) => Number(x).toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d });
const COLORS = { both: '#2f81f7', onlyA: '#3fb950', onlyB: '#a371f7', none: '#6e7681', blocked: '#f85149' };

let instance, area, maps = [], layers = [];

async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

function config() {
  return {
    candidateCount: +$('cand').value, budget: +$('budget').value, radiusM: +$('radius').value,
    weightPreset: $('weights').value, respectInaccessible: $('access').checked,
  };
}

function makeMap(id) {
  const [w, s, e, n] = instance.area.bbox;
  const m = L.map(id, { zoomSnap: 0.25, attributionControl: true }).fitBounds([[s, w], [n, e]]);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(m);
  // offline fallback / context: the committed OSM extract
  L.geoJSON(area, {
    style: (f) => {
      const k = f.properties.layer;
      if (k === 'building') return { color: '#8b949e', weight: 0.3, fillOpacity: 0.12 };
      if (k === 'park') return { color: '#3fb950', weight: 0.6, fillOpacity: 0.15 };
      if (k === 'water') return { color: '#2f81f7', weight: 0.6, fillOpacity: 0.2 };
      return { color: '#c9d1d9', weight: 0.6, opacity: 0.35 };
    },
    interactive: false,
  }).addTo(m);
  return m;
}

function draw(k, prob, mine, other) {
  const m = maps[k];
  if (layers[k]) layers[k].remove();
  const g = L.layerGroup().addTo(m);
  layers[k] = g;
  const cfg = config();
  const activeZones = new Set(prob.zoneIds);
  instance.zones.forEach((z) => {
    const ring = z.cell.map(([lo, la]) => [la, lo]);
    if (!activeZones.has(z.id)) {
      L.polygon(ring, { color: COLORS.blocked, weight: 1, fillOpacity: 0.35, dashArray: '3 3' })
        .bindTooltip(`${z.id}: unzugänglich – ${z.inaccessibleReason ?? ''}`).addTo(g);
      return;
    }
    const j = prob.zoneIds.indexOf(z.id);
    const a = mine?.zoneHits?.[j] > 0, b = other?.zoneHits?.[j] > 0;
    const s = a && b ? 'both' : a ? (k === 0 ? 'onlyA' : 'onlyB') : b ? 'none' : 'none';
    L.polygon(ring, { color: COLORS[s], weight: 0.6, fillOpacity: a ? 0.45 : 0.12 })
      .bindTooltip(`${z.id} · Gewicht ${fmt(prob.weights[j], 1)} · ${mine?.zoneHits?.[j] ?? 0}× abgedeckt`).addTo(g);
  });
  const chosen = new Set(mine?.stations ?? []);
  prob.candidates.forEach((c, i) => {
    const on = chosen.has(i);
    if (on) L.circle([c.lat, c.lon], { radius: cfg.radiusM, color: k ? '#a371f7' : '#3fb950', weight: 1.5, fillOpacity: 0.06 }).addTo(g);
    L.circleMarker([c.lat, c.lon], { radius: on ? 8 : 5, color: '#0d1117', weight: 2, fillColor: on ? (k ? '#a371f7' : '#3fb950') : '#f0b72f', fillOpacity: 1 })
      .bindTooltip(`x${i} = ${on ? 1 : 0} · ${c.name}`).addTo(g);
  });
}

function renderComplexity(p) {
  const c = p.complexity;
  const mib = c.statevectorBytes / 2 ** 20;
  $('complexity').innerHTML = `
    <div>Aktive Kandidaten N = <b>${p.N}</b>, Zonen = <b>${p.Z}</b></div>
    <div>Alle Teilmengen 2<sup>N</sup> = <b>${fmt(c.allSubsets)}</b></div>
    <div>Zulässig Σ C(N,k), k ≤ B: <b>${fmt(c.feasibleSubsets)}</b> (Limit ${fmt(c.maxSubsets)})</div>
    <div>QUBO-Variablen = Qubits: <b>${c.quboVariables}</b> (${p.N} x + ${c.slack} Schlupf + ${c.aux} Hilfs)</div>
    <div>Statevector: <b>${mib < 1 ? fmt(c.statevectorBytes / 1024, 1) + ' KiB' : fmt(mib, 1) + ' MiB'}</b> (Limit ${c.maxQubits} Qubits)</div>
    <div>Strafgewichte: λ = <b>${fmt(p.penalties?.lambda ?? 0, 1)}</b>, M = <b>${fmt(p.penalties?.M ?? 0, 1)}</b></div>`;
}

function renderMetrics(cls, q) {
  const row = (label, r) => {
    if (!r) return `<tr><td>${label}</td><td colspan="6">läuft …</td></tr>`;
    if (r.skipped) return `<tr><td>${label}</td><td colspan="6">übersprungen: ${r.reason}</td></tr>`;
    return `<tr><td>${label}</td><td>${r.stations.map((i) => 'x' + i).join(', ') || '–'}</td><td>${fmt(r.coveredWeight, 1)}</td><td>${fmt(r.coveragePct, 1)} %</td><td>${r.feasible ? 'ja' : 'nein'}</td><td>${r.exact ? 'exakt' : 'heuristisch'}</td><td>${fmt(r.timeMs, 1)} ms</td></tr>`;
  };
  let extra = '';
  if (q && !q.skipped) {
    extra = `<tr><td colspan="7" class="note">QAOA: ${q.qubits} Qubits, p = ${q.layers}, ${q.evaluations} Zielfunktions-Auswertungen, ${q.shots} Shots (${q.backend}), Tiefe ${q.depth}, P(zulässig) = ${fmt(100 * q.pFeasible, 1)} %, P(Grundzustand) = ${fmt(100 * q.pGround, 2)} %, γ = [${q.gammas.map((x) => fmt(x, 3)).join(', ')}], β = [${q.betas.map((x) => fmt(x, 3)).join(', ')}]</td></tr>`;
  }
  $('metrics').innerHTML = `<caption class="sr">Solver-Metriken</caption><thead><tr><th>Methode</th><th>Stationen</th><th>Abgedecktes Gewicht</th><th>Abdeckung</th><th>Zulässig</th><th>Art</th><th>Zeit (gemessen)</th></tr></thead>
    <tbody>${row('Brute Force', cls?.exact)}${row('Greedy', cls?.greedy)}${row('QAOA', q)}${extra}</tbody>`;
}

function renderHist(q) {
  if (!q || q.skipped) { $('hist').textContent = q ? q.reason : ''; return; }
  const top = q.samples.slice(0, 16), max = Math.max(...top.map((s) => s.count));
  const W = 900, H = 220, bw = W / top.length;
  const bars = top.map((s, k) => {
    const h = (s.count / max) * (H - 60);
    const bits = s.index.toString(2).padStart(q.qubits, '0');
    const col = !s.feasible ? '#f85149' : s.coveredWeight === q.coveredWeight ? '#a371f7' : '#2f81f7';
    return `<g><rect x="${k * bw + 4}" y="${H - 40 - h}" width="${bw - 8}" height="${h}" fill="${col}"><title>${bits}: ${s.count} Shots, x=${s.stations.join(',')} Gewicht ${s.coveredWeight}${s.feasible ? '' : ' (unzulässig)'}</title></rect>
      <text x="${k * bw + bw / 2}" y="${H - 24}" font-size="10" fill="#9da7b3" text-anchor="middle">${bits.slice(-q.qubits).slice(0, 12)}</text>
      <text x="${k * bw + bw / 2}" y="${H - 44 - h}" font-size="11" fill="#e6edf3" text-anchor="middle">${s.count}</text></g>`;
  }).join('');
  $('hist').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Histogramm der häufigsten Messergebnisse">${bars}<text x="0" y="${H - 4}" font-size="11" fill="#9da7b3">Bitstring (Qubit n−1 … 0); violett = bestes Sample, rot = unzulässig</text></svg>`;
}

async function run() {
  const btn = $('run');
  btn.disabled = true;
  const cfg = config();
  try {
    $('status').textContent = 'Berechne Coverage-Matrix …';
    const prob = await api('/api/problem', cfg);
    renderComplexity(prob);
    $('status').textContent = 'Klassische Suche …';
    const cls = await api('/api/solve/classical', cfg);
    renderMetrics(cls, null);
    draw(0, prob, cls.exact.skipped ? cls.greedy : cls.exact, null);
    draw(1, prob, null, cls.exact.skipped ? cls.greedy : cls.exact);
    $('status').textContent = 'QAOA (Qiskit) läuft …';
    const q = await api('/api/solve/qaoa', { ...cfg, layers: +$('layers').value, shots: +$('shots').value, seed: +$('seed').value, restarts: +$('restarts').value });
    renderMetrics(cls, q);
    renderHist(q);
    const a = cls.exact.skipped ? cls.greedy : cls.exact;
    draw(0, prob, a, q.skipped ? null : q);
    draw(1, prob, q.skipped ? null : q, a);
    $('status').textContent = q.skipped ? 'Fertig (QAOA übersprungen)' : 'Fertig';
  } catch (e) {
    $('status').textContent = 'Fehler: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

function bindOutputs() {
  const upd = () => {
    $('o-cand').textContent = $('cand').value;
    $('o-budget').textContent = $('budget').value;
    $('o-radius').textContent = $('radius').value + ' m';
    $('o-layers').textContent = $('layers').value;
  };
  ['cand', 'budget', 'radius', 'layers'].forEach((id) => $(id).addEventListener('input', upd));
  upd();
}

async function init() {
  [instance, area] = await Promise.all([api('/api/instance'), api('/api/area')]);
  const d = instance.defaults;
  $('cand').max = instance.candidates.length;
  $('cand').value = d.candidateCount; $('budget').value = d.budget; $('radius').value = d.radiusM;
  bindOutputs();
  maps = [makeMap('map-a'), makeMap('map-b')];
  maps[0].sync = maps[1];
  maps[0].on('moveend', () => { const b = maps[1]; if (!b._syncing) { maps[0]._syncing = true; b.setView(maps[0].getCenter(), maps[0].getZoom(), { animate: false }); maps[0]._syncing = false; } });
  $('run').addEventListener('click', run);
  run();
}

init().catch((e) => { $('status').textContent = 'Fehler beim Laden: ' + e.message; });
