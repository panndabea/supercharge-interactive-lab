// Widgets for binary encoding, QUBO, Ising, qubits, gates, measurement and QAOA.
import { buildProblem, defaultConfig } from '../math/instance.js';
import { evaluate } from '../math/coverage.js';
import { buildQubo, quadList, energy, decode, toIsing, allEnergies } from '../math/qubo.js';
import { State, sample } from '../math/statevector.js';
import { costSpectrum, qaoaState, qaoaCircuit } from '../math/qaoa.js';
import { mulberry32 } from '../math/rng.js';
import { frame, fmt, h, statsHtml, configControls, bytes } from './widgets.js';
import { SvgMap, el } from './svgmap.js';

const small = (ctx, w) => ({ ...defaultConfig(ctx.instance), candidateCount: 5, budget: 2, radiusM: 300, ...(w.config ?? {}) });

function bitButtons(qubo, bits, onToggle) {
  const wrap = h('<div class="bits" role="group" aria-label="Variablen"></div>');
  qubo.labels.forEach((l, k) => {
    const b = h(`<button type="button" class="bit ${l.kind === 'slack' ? 'slack' : l.kind === 'aux' ? 'aux' : ''} ${bits[k] ? 'on' : ''}" aria-pressed="${!!bits[k]}" title="${l.text}">${bits[k]}<small>${l.name}</small></button>`);
    b.onclick = () => onToggle(k);
    wrap.appendChild(b);
  });
  return wrap;
}

function binaryWidget(slot, w, ctx) {
  const box = frame(slot, 'Binärvektor ↔ Stationsauswahl', 'live');
  const p = buildProblem(ctx.instance, defaultConfig(ctx.instance));
  const bits = new Array(p.N).fill(0);
  const m = h('<div></div>'), ctl = h('<div></div>'), out = h('<div></div>');
  box.append(ctl, m, out);
  const map = new SvgMap(m, ctx.area, ctx.instance);
  const upd = () => {
    ctl.innerHTML = '';
    const wrap = h('<div class="bits"></div>');
    bits.forEach((b, i) => { const e = h(`<button type="button" class="bit ${b ? 'on' : ''}" aria-pressed="${!!b}" title="${p.candidates[i].name}">${b}<small>x${i}</small></button>`); e.onclick = () => { bits[i] ^= 1; upd(); }; wrap.appendChild(e); });
    ctl.appendChild(wrap);
    const sel = bits.flatMap((b, i) => (b ? [i] : []));
    map.render(p, ctx.instance, { selected: new Set(sel), onCandidate: (i) => { bits[i] ^= 1; upd(); } });
    const ev = evaluate(p, sel);
    const idx = bits.reduce((a, b, i) => a + b * 2 ** i, 0);
    out.innerHTML = statsHtml([[bits.slice().reverse().join(''), 'Bitstring (x₇…x₀)'], [idx, 'Ganzzahl Σ xᵢ·2ⁱ'], [`${sel.length} ≤ ${p.budget}?`, ev.feasible ? 'zulässig' : 'verletzt Budget'], [fmt(ev.coveredWeight), 'Abdeckung f(x)']]);
  };
  upd();
}

function quboWidget(slot, w, ctx) {
  const box = frame(slot, 'QUBO-Inspektor', 'exakte Formulierung');
  const cfg = small(ctx, w);
  configControls(box, cfg, () => upd(), ['cand', 'budget', 'radius']);
  const out = h('<div></div>'); box.appendChild(out);
  let bits = [];
  function upd() {
    const p = buildProblem(ctx.instance, cfg);
    let q;
    try { q = buildQubo(p); } catch (e) { out.innerHTML = `<div class="card warn">QUBO nicht aufgebaut: ${e.message}. Verkleinere Radius oder Kandidatenzahl.</div>`; return; }
    if (bits.length !== q.n) bits = new Array(q.n).fill(0);
    const E = energy(q, bits), d = decode(p, q, bits), cov = evaluate(p, d.stations).coveredWeight;
    const show = q.n <= 24;
    const Q = show ? Array.from({ length: q.n }, () => new Array(q.n).fill(0)) : [];
    let maxAbs = 1e-9;
    if (show) {
      q.linear.forEach((v, i) => { Q[i][i] = v; });
      for (const [a, b, v] of quadList(q)) Q[a][b] = v;
      for (const row of Q) for (const v of row) maxAbs = Math.max(maxAbs, Math.abs(v));
    }
    const heat = show ? `<div class="heat" style="grid-template-columns:repeat(${q.n + 1},34px)"><div class="h"></div>${q.labels.map((l) => `<div class="h">${l.name}</div>`).join('')}${Q.map((row, i) => `<div class="h">${q.labels[i].name}</div>` + row.map((v, j) => `<div title="Q[${q.labels[i].name},${q.labels[j].name}] = ${v}" style="background:${v === 0 ? 'var(--panel2)' : v < 0 ? `rgba(52,211,153,${0.15 + 0.85 * Math.abs(v) / maxAbs})` : `rgba(248,113,113,${0.15 + 0.85 * Math.abs(v) / maxAbs})`}">${v === 0 || j < i ? '' : fmt(v, 1)}</div>`).join('')).join('')}</div>` : '<p>Matrix zu groß für die Anzeige.</p>';
    out.innerHTML = statsHtml([[q.n, 'Variablen = Qubits'], [q.N, 'Stationen x'], [q.nSlack, `Schlupf (Koeff. ${q.slack.join(', ') || '–'})`], [q.nAux, 'Hilfsvariablen z'], [fmt(q.lambda, 2), 'λ Budget-Strafe'], [fmt(q.M, 2), 'M Rosenberg-Strafe'], [fmt(q.offset, 2), 'Konstante']])
      + '<h3>Variablen umschalten</h3>';
    out.appendChild(bitButtons(q, bits, (k) => { bits[k] ^= 1; upd(); }));
    out.insertAdjacentHTML('beforeend', statsHtml([[fmt(E, 3), 'Energie E(x, s, z)'], [fmt(-cov, 3), '−Abdeckung der Stationen'], [d.feasible ? 'ja' : 'nein', 'Budget eingehalten'], [d.slackConsistent ? 'ja' : 'nein', 'Schlupf konsistent'], [d.auxConsistent ? 'ja' : 'nein', 'Hilfsvariablen konsistent']])
      + `<p class="sym-explain">Gilt alles „ja“, ist E = −Abdeckung. Jede Inkonsistenz kostet mindestens eine Strafe, die größer als jeder mögliche Gewinn ist.</p><h3>Q-Matrix (obere Dreiecksform; grün negativ, rot positiv)</h3><div class="tablewrap">${heat}</div>
      <details><summary>Alle ${q.terms.length} Herleitungsterme</summary><div class="tablewrap"><table><tr><th>Monom</th><th>Koeffizient</th><th>Quelle</th></tr>${q.terms.map((t) => `<tr><td class="mono">${t.vars.map((v) => q.labels[v].name).join('·') || '1'}</td><td>${fmt(t.coef, 3)}</td><td>${t.note}</td></tr>`).join('')}</table></div></details>`);
  }
  upd();
}

function penaltyWidget(slot, w, ctx) {
  const box = frame(slot, 'Strafgewicht λ: zu klein macht die Formulierung falsch', 'vollständige Enumeration');
  const p = buildProblem(ctx.instance, small(ctx, w));
  const c = h('<div class="controls"><label>λ-Faktor <input type="range" min="0.05" max="2" step="0.05" value="1"><output>1</output></label></div>'); box.appendChild(c);
  const out = h('<div aria-live="polite"></div>'); box.appendChild(out);
  const i = c.querySelector('input');
  const upd = () => {
    c.querySelector('output').textContent = i.value;
    const q = buildQubo(p, { penaltyScale: +i.value });
    const E = allEnergies(q);
    let best = 0; for (let k = 1; k < E.length; k++) if (E[k] < E[best]) best = k;
    const bits = Array.from({ length: q.n }, (_, k) => Math.floor(best / 2 ** k) % 2);
    const d = decode(p, q, bits);
    const ok = d.feasible && d.slackConsistent && d.auxConsistent;
    out.innerHTML = statsHtml([[fmt(q.lambda, 2), 'λ'], [fmt(q.M, 2), 'M'], [fmt(E.length), 'enumerierte Zustände'], [`{${d.stations.map((s) => 'x' + s).join(', ')}}`, 'Stationen im Minimum'], [ok ? 'gültig ✓' : 'UNGÜLTIG ✗', ok ? 'Minimum ist zulässig' : 'Minimum verletzt Nebenbedingungen']]);
  };
  i.addEventListener('input', upd); upd();
}

function isingWidget(slot, w, ctx) {
  const box = frame(slot, 'QUBO → Ising: x = (1 − z)/2', 'Energieerhaltung');
  const p = buildProblem(ctx.instance, small(ctx, w));
  const q = buildQubo(p), is = toIsing(q);
  let bits = new Array(q.n).fill(0);
  const out = h('<div></div>'); box.appendChild(out);
  const upd = () => {
    const z = bits.map((b) => 1 - 2 * b);
    let Ei = is.constant; is.h.forEach((v, k) => { Ei += v * z[k]; }); for (const [a, b, J] of is.J) Ei += J * z[a] * z[b];
    out.innerHTML = '';
    out.appendChild(bitButtons(q, bits, (k) => { bits[k] ^= 1; upd(); }));
    out.insertAdjacentHTML('beforeend', `<p class="mono">z = (${z.map((v) => (v > 0 ? '+1' : '−1')).join(', ')})</p>` + statsHtml([[fmt(energy(q, bits), 6), 'E_QUBO(x)'], [fmt(Ei, 6), 'E_Ising(z)'], [fmt(Math.abs(Ei - energy(q, bits)), 12), '|Differenz|'], [is.J.length, 'Kopplungen J'], [fmt(is.constant, 3), 'Konstante c']])
      + `<details><summary>Felder h und Kopplungen J</summary><p class="mono">${Array.from(is.h, (v, k) => `h(${q.labels[k].name}) = ${fmt(v, 3)}`).join(' · ')}</p><p class="mono">${is.J.map(([a, b, J]) => `J(${q.labels[a].name},${q.labels[b].name}) = ${fmt(J, 3)}`).join(' · ')}</p></details>`);
  };
  upd();
}

function ampBars(state, labelBits) {
  const pr = state.probabilities();
  return `<div class="tablewrap"><table><tr><th>|Basis⟩</th><th>Amplitude</th><th>Wahrscheinlichkeit</th></tr>${[...pr].map((v, k) => `<tr><td class="mono">|${k.toString(2).padStart(labelBits, '0')}⟩</td><td class="mono">${fmt(state.re[k], 3)} ${state.im[k] < 0 ? '−' : '+'} ${fmt(Math.abs(state.im[k]), 3)}i</td><td><span style="display:inline-block;height:.7rem;width:${200 * v}px;background:var(--blue);border-radius:3px;vertical-align:middle"></span> ${fmt(100 * v, 1)} %</td></tr>`).join('')}</table></div>`;
}

function qubitWidget(slot, w, ctx) {
  const box = frame(slot, 'Ein Qubit: |ψ⟩ = cos(θ/2)|0⟩ + e^{iφ} sin(θ/2)|1⟩', 'exakt');
  const c = h('<div class="controls"><label>θ <input type="range" min="0" max="3.1416" step="0.01" value="1.0472"><output></output></label><label>φ <input type="range" min="0" max="6.2832" step="0.01" value="0"><output></output></label></div>'); box.appendChild(c);
  const svgBox = h('<div style="max-width:260px"></div>'), out = h('<div></div>'); box.append(svgBox, out);
  const [iT, iP] = c.querySelectorAll('input');
  const upd = () => {
    const t = +iT.value, f = +iP.value;
    c.querySelectorAll('output')[0].textContent = fmt(t, 2); c.querySelectorAll('output')[1].textContent = fmt(f, 2);
    const s = new State(1); s.re[0] = Math.cos(t / 2); s.re[1] = Math.sin(t / 2) * Math.cos(f); s.im[1] = Math.sin(t / 2) * Math.sin(f);
    const x = Math.sin(t) * Math.cos(f), y = Math.sin(t) * Math.sin(f), z = Math.cos(t);
    const px = 130 + 100 * (x * 0.9 - y * 0.35), py = 130 - 100 * (z * 0.95 + y * 0.2);
    svgBox.innerHTML = `<svg viewBox="0 0 260 260" role="img" aria-label="Bloch-Kugel"><circle cx="130" cy="130" r="100" fill="none" stroke="var(--line)"/><ellipse cx="130" cy="130" rx="100" ry="28" fill="none" stroke="var(--line)" stroke-dasharray="3 3"/><line x1="130" y1="30" x2="130" y2="230" stroke="var(--line)"/><text x="136" y="26" fill="var(--muted)" font-size="12">|0⟩</text><text x="136" y="246" fill="var(--muted)" font-size="12">|1⟩</text><line x1="130" y1="130" x2="${px}" y2="${py}" stroke="var(--accent)" stroke-width="3"/><circle cx="${px}" cy="${py}" r="6" fill="var(--accent)"/></svg>`;
    out.innerHTML = ampBars(s, 1) + statsHtml([[fmt(Math.cos(t / 2) ** 2, 3), 'P(0)'], [fmt(Math.sin(t / 2) ** 2, 3), 'P(1)'], [fmt(1, 3), 'Summe (Normierung)']]);
  };
  iT.addEventListener('input', upd); iP.addEventListener('input', upd); upd();
}

function gatesWidget(slot, w, ctx) {
  const n = w.qubits ?? 2;
  const box = frame(slot, `Gatter-Sandbox (${n} Qubits)`, 'Statevector');
  const ops = [];
  const c = h(`<div class="controls">${['H', 'X', 'Z', 'RX(π/2)', 'RZ(π/2)'].map((g) => [...Array(n).keys()].map((q) => `<button type="button" data-g="${g}" data-q="${q}">${g} q${q}</button>`).join('')).join('')}${n > 1 ? '<button type="button" data-g="CNOT">CNOT q0→q1</button><button type="button" data-g="RZZ">RZZ(π/2) q0,q1</button>' : ''}<button type="button" data-g="reset">Zurücksetzen</button></div>`);
  box.appendChild(c);
  const out = h('<div aria-live="polite"></div>'); box.appendChild(out);
  const upd = () => {
    const s = new State(n);
    for (const [g, q] of ops) ({ H: () => s.h(q), X: () => s.x(q), Z: () => s.z(q), 'RX(π/2)': () => s.rx(q, Math.PI / 2), 'RZ(π/2)': () => s.rz(q, Math.PI / 2), CNOT: () => s.cnot(0, 1), RZZ: () => s.rzz(0, 1, Math.PI / 2) })[g]();
    out.innerHTML = `<p class="mono">Schaltung: |${'0'.repeat(n)}⟩ ${ops.map(([g, q]) => (g === 'CNOT' || g === 'RZZ' ? g : `${g}(q${q})`)).join(' → ') || '(leer)'}</p>` + ampBars(s, n) + '<p class="sym-explain">Basis |q₁q₀⟩: Bit k gehört zu Qubit k (little-endian wie Qiskit).</p>';
  };
  c.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.g === 'reset') ops.length = 0; else ops.push([b.dataset.g, +b.dataset.q]); upd(); };
  upd();
}

function histogram(counts, n, mark = () => '') {
  const top = counts.slice(0, 16); const max = Math.max(1, ...top.map((s) => s.count));
  const W = 760, H = 200, bw = W / Math.max(1, top.length);
  return `<svg viewBox="0 0 ${W} ${H}" class="hist" role="img" aria-label="Messhistogramm">${top.map((s, k) => { const hh = (s.count / max) * (H - 60); return `<rect x="${k * bw + 3}" y="${H - 40 - hh}" width="${bw - 6}" height="${hh}" rx="3" fill="${mark(s) || 'var(--blue)'}"><title>${s.index.toString(2).padStart(n, '0')}: ${s.count}</title></rect><text x="${k * bw + bw / 2}" y="${H - 26}" font-size="9" fill="var(--muted)" text-anchor="middle" font-family="monospace">${s.index.toString(2).padStart(n, '0').slice(-14)}</text><text x="${k * bw + bw / 2}" y="${H - 44 - hh}" font-size="10" fill="var(--ink)" text-anchor="middle">${s.count}</text>`; }).join('')}</svg>`;
}

function measureWidget(slot, w, ctx) {
  const box = frame(slot, 'Messen: Wahrscheinlichkeiten → Stichproben', 'seedbar');
  const c = h('<div class="controls"><label>θ <input type="range" min="0" max="3.1416" step="0.01" value="1.2"><output></output></label><label>Shots <input type="number" min="1" max="100000" value="100"></label><label>Seed <input type="number" value="1"></label><button type="button" class="primary">Messen</button></div>');
  box.appendChild(c);
  const out = h('<div aria-live="polite"></div>'); box.appendChild(out);
  const [iT, iS, iSeed] = c.querySelectorAll('input');
  const run = () => {
    c.querySelector('output').textContent = fmt(+iT.value, 2);
    const s = new State(2); s.rx(0, +iT.value); s.h(1);
    const pr = s.probabilities();
    const cnt = sample(pr, +iS.value, mulberry32(+iSeed.value));
    const counts = [...cnt.entries()].map(([index, count]) => ({ index, count })).sort((a, b) => b.count - a.count);
    out.innerHTML = histogram(counts, 2) + `<div class="tablewrap"><table><tr><th>Zustand</th><th>P exakt</th><th>Häufigkeit</th></tr>${[...pr].map((p, k) => `<tr><td class="mono">|${k.toString(2).padStart(2, '0')}⟩</td><td>${fmt(p, 4)}</td><td>${fmt((cnt.get(k) ?? 0) / +iS.value, 4)}</td></tr>`).join('')}</table></div>`;
  };
  c.querySelector('button').onclick = run; iT.addEventListener('input', run); run();
}

function landscapeWidget(slot, w, ctx) {
  const box = frame(slot, 'QAOA-Landschaft für p = 1: ⟨H_C⟩(γ, β)', 'Statevector, exakt');
  const p = buildProblem(ctx.instance, small(ctx, w));
  const q = buildQubo(p), spec = costSpectrum(q);
  const G = 36, cv = h(`<canvas width="${G * 10}" height="${G * 10}" style="width:100%;max-width:420px;image-rendering:pixelated;border-radius:8px" role="img" aria-label="Heatmap des Erwartungswerts"></canvas>`);
  const out = h('<div aria-live="polite"></div>');
  box.append(cv, out);
  const vals = [];
  let lo = Infinity, hi = -Infinity, best = null;
  for (let a = 0; a < G; a++) for (let b = 0; b < G; b++) {
    const gamma = (a / G) * 2 * Math.PI, beta = (b / G) * Math.PI;
    const v = qaoaState(q.n, spec.diag, [gamma], [beta]).expectationDiagonal(spec.diag);
    vals.push([a, b, v, gamma, beta]); lo = Math.min(lo, v); hi = Math.max(hi, v); if (!best || v < best[2]) best = [a, b, v, gamma, beta];
  }
  const g = cv.getContext('2d');
  for (const [a, b, v] of vals) { const t = (v - lo) / (hi - lo || 1); g.fillStyle = `hsl(${250 - 200 * (1 - t)}, 80%, ${25 + 40 * (1 - t)}%)`; g.fillRect(a * 10, (G - 1 - b) * 10, 10, 10); }
  g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(best[0] * 10, (G - 1 - best[1]) * 10, 10, 10);
  out.innerHTML = statsHtml([[q.n, 'Qubits'], [fmt(G * G), 'Gitterpunkte (je eine Simulation)'], [`γ=${fmt(best[3], 2)}, β=${fmt(best[4], 2)}`, 'bester Gitterpunkt'], [fmt(best[2], 4), 'min ⟨H_C⟩ (normiert)'], [fmt(spec.min / spec.width, 4), 'Grundzustandsenergie (normiert)']]) + '<p class="sym-explain">x-Achse γ ∈ [0, 2π), y-Achse β ∈ [0, π). Hell = niedrige Energie. Die Lücke zwischen min⟨H_C⟩ und der Grundzustandsenergie zeigt: p = 1 reicht hier nicht für den exakten Grundzustand.</p>';
}

function circuitWidget(slot, w, ctx) {
  const box = frame(slot, 'QAOA-Schaltung (p = 1)', 'aus der echten Ising-Form');
  const p = buildProblem(ctx.instance, small(ctx, w));
  const q = buildQubo(p), spec = costSpectrum(q);
  const circ = qaoaCircuit(q, [0.8], [0.4], spec.width);
  const n = circ.n, colW = 46, rowH = 34, cols = [];
  for (const op of circ.ops) { let c = 0; for (const qq of op.q) c = Math.max(c, ...(cols.filter((x) => x.q.includes(qq)).map((x) => x.col + 1)), 0); if (op.q.length === 2) { const [a, b] = op.q.sort((x, y) => x - y); for (const x of cols) if (x.q.some((qq) => qq > a && qq < b) || (x.q.length === 2 && !(x.q[1] < a || x.q[0] > b))) c = Math.max(c, x.col + 1); } cols.push({ ...op, col: c }); }
  const depth = Math.max(...cols.map((x) => x.col)) + 1;
  const W = 60 + depth * colW, H = 20 + n * rowH;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, role: 'img', 'aria-label': 'QAOA-Schaltkreis' });
  for (let k = 0; k < n; k++) { el('line', { x1: 40, y1: 20 + k * rowH, x2: W, y2: 20 + k * rowH, stroke: 'var(--line)' }, svg); const t = el('text', { x: 4, y: 24 + k * rowH, fill: 'var(--muted)', 'font-size': 11, 'font-family': 'monospace' }, svg); t.textContent = q.labels[k].name; }
  const colors = { h: 'var(--blue)', rz: 'var(--green)', rzz: 'var(--violet)', rx: 'var(--orange)' };
  for (const op of cols) {
    const x = 50 + op.col * colW;
    if (op.q.length === 2) { const [a, b] = op.q; el('line', { x1: x + 16, y1: 20 + a * rowH, x2: x + 16, y2: 20 + b * rowH, stroke: colors.rzz, 'stroke-width': 2 }, svg); for (const qq of op.q) el('circle', { cx: x + 16, cy: 20 + qq * rowH, r: 5, fill: colors.rzz }, svg); }
    else { el('rect', { x, y: 8 + op.q[0] * rowH, width: 32, height: 24, rx: 5, fill: colors[op.gate] }, svg); const t = el('text', { x: x + 16, y: 24 + op.q[0] * rowH, 'font-size': 10, 'text-anchor': 'middle', fill: '#0b0f17', 'font-weight': 700 }, svg); t.textContent = op.gate.toUpperCase(); }
    const tt = el('title', {}, svg.lastChild); tt.textContent = `${op.gate.toUpperCase()}(${op.q.map((x) => q.labels[x].name).join(',')})${op.theta !== undefined ? ` θ=${fmt(op.theta, 4)}` : ''}`;
  }
  const wrap = h('<div class="circuit"></div>'); wrap.appendChild(svg); box.appendChild(wrap);
  const cnt = (g) => circ.ops.filter((o) => o.gate === g).length;
  box.insertAdjacentHTML('beforeend', statsHtml([[n, 'Qubits'], [cnt('h'), 'H'], [cnt('rz'), 'RZ (Felder h)'], [cnt('rzz'), 'RZZ (Kopplungen J)'], [cnt('rx'), 'RX (Mixer)'], [depth, 'Tiefe (diese Anordnung)']]));
}

function qaoaWidget(slot, w, ctx) {
  const box = frame(slot, 'QAOA ausführen (lokale Statevector-Simulation im Web Worker)', 'approximativ');
  const cfg = { ...defaultConfig(ctx.instance), ...(w.config ?? {}) };
  configControls(box, cfg, () => {}, ['cand', 'budget', 'radius', 'weights', 'access']);
  const c = h('<div class="controls"><label>p <input type="number" min="1" max="6" value="2"></label><label>Shots <input type="number" min="16" max="20000" value="1024"></label><label>Seed <input type="number" value="42"></label><label>Neustarts <input type="number" min="1" max="8" value="3"></label><button type="button" class="primary">QAOA starten</button></div>');
  box.appendChild(c);
  const out = h('<div aria-live="polite"></div>'); box.appendChild(out);
  c.querySelector('button').onclick = async () => {
    const [iP, iS, iSeed, iR] = c.querySelectorAll('input');
    const btn = c.querySelector('button'); btn.disabled = true; out.textContent = 'Optimiere Parameter γ, β …';
    try {
      const { runInWorker } = await import('../app.js');
      const [r, cl] = await Promise.all([runInWorker('qaoa', cfg, { layers: +iP.value, shots: +iS.value, seed: +iSeed.value, restarts: +iR.value }), runInWorker('classical', cfg)]);
      if (r.skipped) { out.innerHTML = `<div class="card warn">QAOA übersprungen: ${r.reason}. Die klassische Lösung ist davon unabhängig: {${cl.exact.stations?.map((i) => 'x' + i).join(', ')}} mit Gewicht ${fmt(cl.exact.coveredWeight ?? 0)}.</div>`; return; }
      const opt = cl.exact.skipped ? null : cl.exact.coveredWeight;
      out.innerHTML = statsHtml([[r.qubits, 'Qubits'], [bytes(r.stateBytes), 'Statevector'], [r.evaluations, 'Zielfunktionsauswertungen (gezählt)'], [`${fmt(r.timeMs, 0)} ms`, 'Laufzeit (gemessen)'], [`{${r.stations.map((i) => 'x' + i).join(', ')}}`, 'bestes zulässiges Sample'], [fmt(r.coveredWeight, 1), 'Abdeckung (unabhängig geprüft)'], [opt === null ? '–' : fmt(opt, 1), 'exaktes Optimum (Brute Force, separat)'], [`${fmt(100 * r.pFeasible, 1)} %`, 'P(zulässig)'], [`${fmt(100 * r.pGround, 2)} %`, 'P(Grundzustand)']])
        + `<p><span class="badge approx">approximativ</span> ${opt !== null && Math.abs(r.coveredWeight - opt) < 1e-9 ? 'QAOA hat hier ein optimales Sample gefunden.' : 'QAOA lag hier unter dem Optimum.'} γ = [${r.gammas.map((x) => fmt(x, 3)).join(', ')}], β = [${r.betas.map((x) => fmt(x, 3)).join(', ')}]</p>`
        + histogram(r.samples, r.qubits, (s) => (!s.feasible ? 'var(--red)' : s.coveredWeight === r.coveredWeight ? 'var(--violet)' : 'var(--blue)')) + '<p class="sym-explain">Violett = bestes Sample, rot = unzulässig. Bitstrings: Qubit n−1 links … Qubit 0 rechts.</p>';
    } catch (e) { out.innerHTML = `<div class="card warn">Fehler: ${e.message}</div>`; } finally { btn.disabled = false; }
  };
}

export const QUANTUM_WIDGETS = { binary: binaryWidget, qubo: quboWidget, penalty: penaltyWidget, ising: isingWidget, qubit: qubitWidget, gates: gatesWidget, measure: measureWidget, landscape: landscapeWidget, circuit: circuitWidget, qaoa: qaoaWidget };
