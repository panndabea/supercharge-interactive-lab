// Interactive widgets for chapters and the studio. Every widget recomputes from buildProblem(),
// so map, solvers, QUBO and QAOA always share one coverage matrix.
import { buildProblem, defaultConfig } from '../math/instance.js';
import { evaluate } from '../math/coverage.js';
import { bruteForceSteps } from '../math/bruteforce.js';
import { greedy } from '../math/heuristics.js';
import { binom, feasibleCount } from '../math/combinations.js';
import { statevectorBytes } from '../math/statevector.js';
import { haversine } from '../math/geo.js';
import { SvgMap } from './svgmap.js';
import { QUANTUM_WIDGETS } from './widgets-quantum.js';

export const fmt = (x, d = 0) => Number(x).toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d });
export const bytes = (b) => b < 1024 ? `${b} B` : b < 2 ** 20 ? `${fmt(b / 1024, 1)} KiB` : b < 2 ** 30 ? `${fmt(b / 2 ** 20, 1)} MiB` : b < 2 ** 40 ? `${fmt(b / 2 ** 30, 1)} GiB` : `${fmt(b / 2 ** 40, 1)} TiB`;
export const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

export function frame(slot, title, tag) {
  const w = h(`<div class="widget"><div class="wtitle"><span>${title}</span>${tag ? `<span class="tag">${tag}</span>` : ''}</div><div class="wbody"></div></div>`);
  slot.appendChild(w);
  return w.querySelector('.wbody');
}

export function configControls(box, cfg, onChange, show = ['cand', 'budget', 'radius', 'weights', 'access']) {
  const c = h('<div class="controls"></div>');
  const add = (html) => { const e = h(html); c.appendChild(e); return e; };
  const range = (key, label, min, max, step, unit = '') => {
    const e = add(`<label>${label} <input type="range" min="${min}" max="${max}" step="${step}" value="${cfg[key]}"><output>${cfg[key]}${unit}</output></label>`);
    const i = e.querySelector('input'), o = e.querySelector('output');
    i.addEventListener('input', () => { cfg[key] = +i.value; o.textContent = i.value + unit; onChange(); });
  };
  if (show.includes('cand')) range('candidateCount', 'Kandidaten', 2, 24, 1);
  if (show.includes('budget')) range('budget', 'Budget B', 1, 8, 1);
  if (show.includes('radius')) range('radiusM', 'Radius r', 100, 700, 25, ' m');
  if (show.includes('weights')) {
    const e = add(`<label>Gewichte <select><option value="uniform">uniform</option><option value="synthetic-hubs">synthetische Knoten ×3</option></select></label>`);
    const s = e.querySelector('select'); s.value = cfg.weightPreset; s.addEventListener('change', () => { cfg.weightPreset = s.value; onChange(); });
  }
  if (show.includes('access')) {
    const e = add(`<label><input type="checkbox" ${cfg.respectInaccessible ? 'checked' : ''}> Unzugängliches ausschließen</label>`);
    const i = e.querySelector('input'); i.addEventListener('change', () => { cfg.respectInaccessible = i.checked; onChange(); });
  }
  box.appendChild(c);
  return c;
}

export const LEGEND = `<div class="maplegend"><span><i style="background:rgba(79,140,255,.5)"></i>einfach abgedeckt</span><span><i style="background:rgba(167,139,250,.6)"></i>mehrfach abgedeckt (zählt einmal)</span><span><i style="background:rgba(248,113,113,.35)"></i>unzugänglich</span><span><i style="background:var(--accent)"></i>gewählte Station</span><span>Zahl = Gewicht &gt; 1</span></div>`;

export const statsHtml = (items) => `<div class="stats">${items.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('')}</div>`;

function mapWidget(slot, w, ctx) {
  const box = frame(slot, w.title ?? 'Karte', 'OSM · live');
  const cfg = { ...defaultConfig(ctx.instance), ...(w.config ?? {}) };
  let sel = new Set(w.selected ?? []);
  if (w.controls) configControls(box, cfg, () => { sel = new Set([...sel].filter((i) => i < cfg.candidateCount)); upd(); }, w.controls);
  const m = h('<div></div>'); box.appendChild(m);
  box.insertAdjacentHTML('beforeend', LEGEND);
  const st = h('<div></div>'); box.appendChild(st);
  const map = new SvgMap(m, ctx.area, ctx.instance, { label: w.title });
  function upd() {
    const p = buildProblem(ctx.instance, cfg);
    sel = new Set([...sel].filter((i) => i < p.N));
    map.render(p, ctx.instance, { selected: sel, showLinks: w.links, onCandidate: w.interactive === false ? null : (i) => { sel.has(i) ? sel.delete(i) : sel.add(i); upd(); } });
    const ev = evaluate(p, [...sel]);
    st.innerHTML = statsHtml([[`${sel.size} / ${p.budget}`, 'Stationen / Budget'], [fmt(ev.coveredWeight, 1), `abgedecktes Gewicht von ${fmt(p.totalWeight, 1)}`], [`${fmt(ev.coveragePct, 1)} %`, 'Abdeckung'], [ev.multiCovered, 'mehrfach abgedeckte Zonen'], [ev.feasible ? 'zulässig' : 'über Budget', 'Status']])
      + `<p class="mono">x = (${p.candidates.map((_, i) => (sel.has(i) ? 1 : 0)).join(', ')})</p>`;
  }
  upd();
}

function overlapWidget(slot, w, ctx) {
  const box = frame(slot, 'Überlappung: warum Zonen nur einmal zählen', 'live');
  const cfg = defaultConfig(ctx.instance);
  const p = buildProblem(ctx.instance, cfg);
  const pairs = [];
  for (let a = 0; a < p.N; a++) for (let b = a + 1; b < p.N; b++) { const both = p.cover[a].filter((j) => p.cover[b].includes(j)).length; if (both) pairs.push([a, b, both]); }
  pairs.sort((x, y) => y[2] - x[2]);
  const [a, b] = pairs[0] ?? [0, 1];
  const m = h('<div></div>'); box.appendChild(m);
  const map = new SvgMap(m, ctx.area, ctx.instance);
  map.render(p, ctx.instance, { selected: new Set([a, b]) });
  const wa = evaluate(p, [a]).coveredWeight, wb = evaluate(p, [b]).coveredWeight, wab = evaluate(p, [a, b]).coveredWeight;
  box.insertAdjacentHTML('beforeend', statsHtml([[fmt(wa), `Gewicht x${a} allein`], [fmt(wb), `Gewicht x${b} allein`], [fmt(wa + wb), 'naive Summe (falsch)'], [fmt(wab), 'echte Abdeckung (Vereinigung)'], [fmt(wa + wb - wab), 'Überlappung, doppelt gezählt']]));
}

function radiusWidget(slot, w, ctx) {
  const box = frame(slot, 'Radius und Abdeckungsmatrix', 'live');
  const cfg = defaultConfig(ctx.instance);
  configControls(box, cfg, () => upd(), ['radius']);
  const m = h('<div></div>'); box.appendChild(m);
  const st = h('<div></div>'); box.appendChild(st);
  const map = new SvgMap(m, ctx.area, ctx.instance);
  function upd() {
    const p = buildProblem(ctx.instance, cfg);
    map.render(p, ctx.instance, { selected: new Set(p.candidates.map((_, i) => i)), showCircles: true });
    const ones = p.cover.reduce((s, l) => s + l.length, 0);
    st.innerHTML = statsHtml([[`${p.N} × ${p.Z}`, 'Matrixgröße a_ij'], [ones, 'Einträge a_ij = 1'], [`${fmt((100 * ones) / (p.N * p.Z), 1)} %`, 'Dichte'], [p.coveredBy.filter((l) => !l.length).length, 'Zonen ohne erreichbare Station']])
      + `<div class="tablewrap"><table><tr><th>i \\ j</th>${p.zones.slice(0, 16).map((z) => `<th>${z.id}</th>`).join('')}<th>…</th></tr>${p.candidates.map((c, i) => `<tr><th>x${i}</th>${p.zones.slice(0, 16).map((_, j) => `<td style="${p.distance[i][j] <= p.radiusM ? 'color:var(--accent);font-weight:700' : 'color:var(--muted)'}" title="${fmt(p.distance[i][j])} m">${p.distance[i][j] <= p.radiusM ? 1 : 0}</td>`).join('')}<td>…</td></tr>`).join('')}</table></div>`;
  }
  upd();
}

function distanceWidget(slot, w, ctx) {
  const box = frame(slot, 'Haversine-Distanz zwischen zwei Kandidaten', 'WGS 84');
  const cs = ctx.instance.candidates;
  const c = h(`<div class="controls"><label>A <select>${cs.map((x, i) => `<option value="${i}">${x.name}</option>`).join('')}</select></label><label>B <select>${cs.map((x, i) => `<option value="${i}" ${i === 1 ? 'selected' : ''}>${x.name}</option>`).join('')}</select></label></div>`);
  box.appendChild(c);
  const out = h('<div></div>'); box.appendChild(out);
  const [sa, sb] = c.querySelectorAll('select');
  const upd = () => {
    const A = cs[+sa.value], B = cs[+sb.value];
    const d = haversine(A.lat, A.lon, B.lat, B.lon, ctx.instance.conventions.earthRadiusM);
    out.innerHTML = statsHtml([[`${fmt(d, 1)} m`, 'Großkreisdistanz'], [`${fmt(A.lat, 5)}, ${fmt(A.lon, 5)}`, 'A (lat, lon)'], [`${fmt(B.lat, 5)}, ${fmt(B.lon, 5)}`, 'B (lat, lon)'], [`${fmt(d / 80, 1)} min`, 'Fußweg bei 80 m/min (Luftlinie)']]);
  };
  sa.addEventListener('change', upd); sb.addEventListener('change', upd); upd();
}

function combinationsWidget(slot, w, ctx) {
  const box = frame(slot, 'Wie viele Möglichkeiten gibt es?', 'exakt');
  const st = { N: 8, B: 3 };
  const c = h(`<div class="controls"><label>N <input type="range" min="1" max="60" value="8"><output>8</output></label><label>B <input type="range" min="0" max="60" value="3"><output>3</output></label></div>`);
  box.appendChild(c);
  const out = h('<div></div>'); box.appendChild(out);
  const [iN, iB] = c.querySelectorAll('input');
  const upd = () => {
    st.N = +iN.value; st.B = Math.min(+iB.value, st.N); iB.value = st.B;
    c.querySelectorAll('output')[0].textContent = st.N; c.querySelectorAll('output')[1].textContent = st.B;
    const f = feasibleCount(st.N, st.B);
    const rows = Array.from({ length: st.B + 1 }, (_, k) => `<tr><td>k = ${k}</td><td>C(${st.N}, ${k}) = ${fmt(binom(st.N, k))}</td></tr>`).join('');
    out.innerHTML = statsHtml([[fmt(2 ** st.N), '2^N alle Teilmengen'], [fmt(binom(st.N, st.B)), `genau B = ${st.B}`], [fmt(f), 'zulässig (≤ B)'], [`${fmt(f / 1e8, 3)} s`, 'bei 10⁸ Teilmengen/s (Annahme)']]) + `<div class="tablewrap"><table>${rows}</table></div>`;
  };
  iN.addEventListener('input', upd); iB.addEventListener('input', upd); upd();
}

function bruteforceWidget(slot, w, ctx) {
  const box = frame(slot, 'Brute-Force-Mikroskop: jede zulässige Teilmenge', 'exakt');
  const cfg = { ...defaultConfig(ctx.instance), ...(w.config ?? {}) };
  const p = buildProblem(ctx.instance, cfg);
  const m = h('<div></div>'); box.appendChild(m);
  const map = new SvgMap(m, ctx.area, ctx.instance);
  const c = h('<div class="controls"><button type="button" class="primary">Schritt</button><button type="button">Abspielen</button><button type="button">Bis zum Ende</button><button type="button">Zurücksetzen</button></div>');
  box.appendChild(c);
  const out = h('<div aria-live="polite"></div>'); box.appendChild(out);
  const log = h('<div class="tablewrap" style="max-height:220px;overflow:auto"><table><thead><tr><th>#</th><th>Teilmenge</th><th>Gewicht</th><th>bestes bisher</th></tr></thead><tbody></tbody></table></div>'); box.appendChild(log);
  let it, last, timer;
  const reset = () => { it = bruteForceSteps(p); last = null; log.querySelector('tbody').innerHTML = ''; clearInterval(timer); timer = null; show(); };
  const show = () => {
    map.render(p, ctx.instance, { selected: new Set(last?.subset ?? []) });
    out.innerHTML = last ? statsHtml([[`${last.evaluated} / ${feasibleCount(p.N, p.budget)}`, 'geprüft'], [`{${last.subset.map((i) => 'x' + i).join(', ')}}`, 'aktuelle Teilmenge'], [fmt(last.weight), 'Gewicht'], [`{${last.best.map((i) => 'x' + i).join(', ')}} = ${fmt(last.bestWeight)}`, 'bestes bisher']]) : '<p>Drücke „Schritt“.</p>';
  };
  const step = () => {
    const r = it.next();
    if (r.done) { clearInterval(timer); timer = null; return false; }
    last = r.value;
    const tb = log.querySelector('tbody');
    tb.insertAdjacentHTML('afterbegin', `<tr style="${last.improved ? 'color:var(--green)' : ''}"><td>${last.evaluated}</td><td>{${last.subset.map((i) => 'x' + i).join(', ')}}</td><td>${fmt(last.weight)}</td><td>${fmt(last.bestWeight)}${last.improved ? ' ★' : ''}</td></tr>`);
    if (tb.children.length > 200) tb.lastChild.remove();
    return true;
  };
  const [bS, bP, bE, bR] = c.querySelectorAll('button');
  bS.onclick = () => { step(); show(); };
  bP.onclick = () => { if (timer) { clearInterval(timer); timer = null; bP.textContent = 'Abspielen'; return; } bP.textContent = 'Pause'; timer = setInterval(() => { if (!step()) bP.textContent = 'Abspielen'; show(); }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 400 : 120); };
  bE.onclick = () => { while (step()); show(); };
  bR.onclick = reset;
  reset();
}

function greedyWidget(slot, w, ctx) {
  const box = frame(slot, 'Greedy: immer den größten Zugewinn nehmen', 'heuristisch');
  const cfg = { ...defaultConfig(ctx.instance), ...(w.config ?? {}) };
  configControls(box, cfg, () => { k = 0; upd(); }, ['cand', 'budget', 'radius']);
  const m = h('<div></div>'); box.appendChild(m);
  const c = h('<div class="controls"><button type="button" class="primary">Nächster Schritt</button><button type="button">Zurücksetzen</button></div>'); box.appendChild(c);
  const out = h('<div aria-live="polite"></div>'); box.appendChild(out);
  const map = new SvgMap(m, ctx.area, ctx.instance);
  let k = 0;
  function upd() {
    const p = buildProblem(ctx.instance, cfg);
    const g = greedy(p);
    k = Math.min(k, g.steps.length);
    const chosen = g.steps.slice(0, k).map((s) => s.add);
    map.render(p, ctx.instance, { selected: new Set(chosen) });
    out.innerHTML = `<div class="tablewrap"><table><tr><th>Schritt</th><th>gewählt</th><th>Zugewinn</th><th>Summe</th></tr>${g.steps.slice(0, k).map((s, t) => `<tr><td>${t + 1}</td><td>x${s.add} – ${p.candidates[s.add].name}</td><td>+${fmt(s.gain, 1)}</td><td>${fmt(s.total, 1)}</td></tr>`).join('')}</table></div>${k === g.steps.length ? `<p>Greedy fertig: Gewicht <b>${fmt(g.coveredWeight, 1)}</b> <span class="badge approx">nicht garantiert optimal</span></p>` : ''}`;
  }
  const [bN, bR] = c.querySelectorAll('button');
  bN.onclick = () => { k++; upd(); }; bR.onclick = () => { k = 0; upd(); };
  upd();
}

function solversWidget(slot, w, ctx) {
  const box = frame(slot, 'Solver-Vergleich (Web Worker)', 'gemessen');
  const cfg = { ...defaultConfig(ctx.instance), ...(w.config ?? {}) };
  configControls(box, cfg, () => {}, ['cand', 'budget', 'radius', 'weights', 'access']);
  const b = h('<div class="controls"><button type="button" class="primary">Alle klassischen Solver ausführen</button></div>'); box.appendChild(b);
  const out = h('<div aria-live="polite"></div>'); box.appendChild(out);
  b.querySelector('button').onclick = async () => {
    out.textContent = 'Rechne im Hintergrund …';
    const { runInWorker } = await import('../app.js');
    const r = await runInWorker('classical', cfg);
    const rows = [['Brute Force', r.exact], ['Branch & Bound', r.branchAndBound], ['Greedy', r.greedy], ['Local Search', r.localSearch], ['Simulated Annealing', r.annealing]];
    out.innerHTML = `<div class="tablewrap"><table><tr><th>Methode</th><th>Stationen</th><th>Gewicht</th><th>Arbeit</th><th>Art</th><th>Zeit (gemessen)</th></tr>${rows.map(([n, x]) => x.skipped ? `<tr><td>${n}</td><td colspan="5">übersprungen: ${x.reason}</td></tr>` : `<tr><td>${n}</td><td>${x.stations.map((i) => 'x' + i).join(', ')}</td><td>${fmt(x.coveredWeight, 1)}</td><td>${fmt(x.evaluated)}</td><td><span class="badge ${x.exact ? 'exact' : 'approx'}">${x.exact ? 'exakt' : 'heuristisch'}</span></td><td>${fmt(x.timeMs, 2)} ms</td></tr>`).join('')}</table></div>`;
  };
}

function complexityWidget(slot, w, ctx) {
  const box = frame(slot, 'Complexity Explorer', 'exakt berechnet');
  const c = h('<div class="controls"><label>Kandidaten N <input type="range" min="2" max="60" value="8"><output>8</output></label><label>Budget B <input type="range" min="1" max="20" value="3"><output>3</output></label></div>');
  box.appendChild(c);
  const out = h('<div></div>'); box.appendChild(out);
  const [iN, iB] = c.querySelectorAll('input');
  const upd = () => {
    const N = +iN.value, B = Math.min(+iB.value, N);
    c.querySelectorAll('output')[0].textContent = N; c.querySelectorAll('output')[1].textContent = B;
    const slack = B >= N ? 0 : Math.floor(Math.log2(B)) + 1;
    const n = N + slack;
    out.innerHTML = statsHtml([[fmt(2 ** N), '2^N Teilmengen'], [fmt(feasibleCount(N, B)), 'zulässige Teilmengen (Brute-Force-Arbeit)'], [`≥ ${n}`, 'Qubits (x + Schlupf, ohne Hilfsvariablen)'], [bytes(statevectorBytes(n)), 'Statevector-Speicher (16 B/Amplitude)'], [fmt(2 ** n), 'Amplituden']])
      + '<p class="sym-explain">Hilfsvariablen für Zonen mit ≥ 3 erreichbaren Stationen erhöhen die Qubit-Zahl zusätzlich – der exakte Wert hängt von der Instanz ab (siehe QUBO-Inspektor). Alle Zahlen sind gezählt bzw. berechnet, nicht geschätzt; nur die Durchsatzannahme ist eine Annahme.</p>';
  };
  iN.addEventListener('input', upd); iB.addEventListener('input', upd); upd();
}

const WIDGETS = { map: mapWidget, overlap: overlapWidget, radius: radiusWidget, distance: distanceWidget, combinations: combinationsWidget, bruteforce: bruteforceWidget, greedy: greedyWidget, solvers: solversWidget, complexity: complexityWidget, ...QUANTUM_WIDGETS };

export function mountWidget(slot, w, ctx) {
  const f = WIDGETS[w.type];
  if (!f) { slot.textContent = `Unbekanntes Widget ${w.type}`; return; }
  try { f(slot, w, ctx); } catch (e) { slot.innerHTML = `<div class="card warn">Widget-Fehler: ${e.message}</div>`; console.error(e); }
}
