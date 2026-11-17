// Router, table of contents, chapter renderer, exercises and progress tracking.
import { buildProblem, defaultConfig } from './math/instance.js';
import { CHAPTERS, PARTS } from './curriculum/index.js';
import { mountWidget } from './ui/widgets.js';
import { renderStudio } from './ui/studio.js';
import { renderCodeExplorer } from './ui/code.js';

const $ = (s, r = document) => r.querySelector(s);
const content = $('#content');
const STORE = 'supercharge-lab-progress-v1';
const done = new Set(JSON.parse(localStorage.getItem(STORE) || '[]'));

export const ctx = { instance: null, area: null, problem: null, worker: null };

let seq = 0;
const pending = new Map();
export function runInWorker(task, config, options) {
  if (!ctx.worker) {
    ctx.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    ctx.worker.onmessage = (e) => { const p = pending.get(e.data.id); pending.delete(e.data.id); e.data.ok ? p.resolve(e.data.result) : p.reject(new Error(e.data.error)); };
  }
  const id = ++seq;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); ctx.worker.postMessage({ id, task, instance: ctx.instance, config, options }); });
}

function markDone(n) { done.add(n); localStorage.setItem(STORE, JSON.stringify([...done])); updateProgress(); }
function updateProgress() {
  $('#progress-bar').style.width = `${(100 * done.size) / CHAPTERS.length}%`;
  for (const a of document.querySelectorAll('.toc a[data-n]')) a.classList.toggle('done', done.has(+a.dataset.n));
}

function renderToc() {
  const toc = $('#toc');
  toc.innerHTML = PARTS.map((p) => `<h3>${p.title}</h3>` + CHAPTERS.filter((c) => c.part === p.id)
    .map((c) => `<a href="#/kapitel/${c.n}" data-n="${c.n}"><span class="n">${c.n}</span><span>${c.title}</span></a>`).join('')).join('')
    + '<h3>Werkzeuge</h3><a href="#/studio"><span class="n">⚗</span><span>Abschluss-Labor</span></a><a href="#/code"><span class="n">{}</span><span>Code-Explorer</span></a>';
  updateProgress();
}

function bindFormula(root) {
  for (const f of root.querySelectorAll('.formula')) {
    const out = document.createElement('div');
    out.className = 'sym-explain'; out.setAttribute('aria-live', 'polite');
    out.textContent = f.querySelector('.sym') ? 'Tipp: Fahre über ein Symbol oder fokussiere es mit Tab.' : '';
    f.appendChild(out);
    for (const s of f.querySelectorAll('.sym')) {
      s.tabIndex = 0; s.setAttribute('role', 'button');
      const show = () => { f.querySelectorAll('.sym.active').forEach((x) => x.classList.remove('active')); s.classList.add('active'); out.innerHTML = `<b>${s.innerHTML}</b>: ${s.dataset.e}`; };
      s.addEventListener('mouseenter', show); s.addEventListener('focus', show); s.addEventListener('click', show);
    }
  }
}

const norm = (s) => String(s).trim().toLowerCase().replace(/\s+/g, '').replace(',', '.');
function renderExercise(ex, k, chap) {
  const box = document.createElement('div');
  box.className = 'exercise';
  const id = `ex-${chap.n}-${k}`;
  const answer = typeof ex.answer === 'function' ? ex.answer(ctx) : ex.answer;
  let input;
  if (ex.kind === 'choice') {
    input = `<div class="choices" role="radiogroup">${ex.options.map((o, i) => `<label><input type="radio" name="${id}" value="${i}"> <span>${o}</span></label>`).join('')}</div>`;
  } else {
    input = `<div class="row"><label for="${id}" class="sr-only">Antwort</label><input id="${id}" type="${ex.kind === 'number' ? 'number' : 'text'}" step="any" inputmode="decimal" placeholder="Antwort">`;
  }
  box.innerHTML = `<div class="q">Übung ${k + 1}: ${ex.q}</div>${input}${ex.kind === 'choice' ? '<div class="row">' : ''}<button type="button" class="check">Prüfen</button></div>
    <div class="feedback" aria-live="polite"></div>
    ${ex.hint ? `<details><summary>Hinweis</summary><p>${ex.hint}</p></details>` : ''}
    <details class="sol"><summary>Lösung anzeigen</summary><p>${typeof ex.solution === 'function' ? ex.solution(ctx) : ex.solution}</p></details>`;
  box.querySelector('.check').addEventListener('click', () => {
    const fb = box.querySelector('.feedback');
    let ok;
    if (ex.kind === 'choice') { const r = box.querySelector('input:checked'); ok = r && +r.value === answer; }
    else if (ex.kind === 'number') { const v = parseFloat(norm(box.querySelector('input').value)); ok = Number.isFinite(v) && Math.abs(v - answer) <= (ex.tol ?? 1e-6) * Math.max(1, Math.abs(answer)); }
    else ok = [].concat(answer).map(norm).includes(norm(box.querySelector('input').value));
    fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
    fb.textContent = ok ? 'Richtig! ' + (ex.why ?? '') : (ex.wrong ?? 'Noch nicht. Schau dir den Hinweis an oder probiere es im Widget aus.');
    if (ok && [...box.parentElement.querySelectorAll('.feedback')].every((x) => x.classList.contains('ok'))) markDone(chap.n);
  });
  return box;
}

function renderChapter(n) {
  const chap = CHAPTERS.find((c) => c.n === n);
  if (!chap) return renderHome();
  const part = PARTS.find((p) => p.id === chap.part);
  const html = typeof chap.html === 'function' ? chap.html(ctx) : chap.html;
  content.innerHTML = `<div class="kicker">Kapitel ${chap.n} · ${part.title}</div><h1>${chap.title}</h1>
    <div class="card goal"><b>Lernziel:</b> ${chap.goal}</div>
    <div class="body">${html}</div><div class="widgets"></div>
    ${chap.takeaway ? `<div class="card key"><b>Merke:</b> ${chap.takeaway}</div>` : ''}
    <section class="exercises" aria-label="Übungen"></section>
    <nav class="chapnav" aria-label="Kapitelnavigation">${n > 0 ? `<a class="btn" href="#/kapitel/${n - 1}">← Kapitel ${n - 1}</a>` : '<span></span>'}
    ${n < CHAPTERS.length - 1 ? `<a class="btn primary" href="#/kapitel/${n + 1}">Kapitel ${n + 1} →</a>` : '<a class="btn primary" href="#/studio">Zum Abschluss-Labor →</a>'}</nav>`;
  bindFormula(content);
  const wbox = $('.widgets', content);
  for (const w of chap.widgets ?? []) {
    const slot = document.createElement('div');
    const target = w.after ? content.querySelector(`[data-slot="${w.after}"]`) : null;
    (target ?? wbox).appendChild(slot);
    mountWidget(slot, w, ctx);
  }
  const exBox = $('.exercises', content);
  if (chap.exercises?.length) { exBox.insertAdjacentHTML('beforeend', '<h2>Übungen</h2>'); chap.exercises.forEach((ex, k) => exBox.appendChild(renderExercise(ex, k, chap))); }
  else markDone(chap.n);
}

function renderHome() {
  const p = ctx.problem;
  content.innerHTML = `<section class="hero"><div class="kicker">Von null bis QAOA</div>
    <h1>Wo bauen wir ${p.budget} Schnellladestationen,<br>damit möglichst viele Menschen eine erreichen?</h1>
    <p class="lead">Ein interaktiver Kurs in 54 Kapiteln: von echter Stadtgeografie in Midtown Manhattan über Abdeckung, Budgets und Kombinatorik bis zu QUBO, Ising-Modell, Qubits, Gattern und dem Quantum Approximate Optimization Algorithm – jede Zahl auf dieser Seite wird live in deinem Browser berechnet.</p>
    <div class="cta"><a class="btn primary" href="#/kapitel/0">Kurs starten</a><a class="btn" href="#/studio">Direkt ins Labor</a><a class="btn" href="#/code">Code ansehen</a></div></section>
    <div data-slot="hero"></div>
    <div class="stats"><div class="stat"><b>${p.N}</b><span>Kandidaten (Standard)</span></div><div class="stat"><b>${p.Z}</b><span>aktive Nachfragezonen</span></div>
    <div class="stat"><b>${p.radiusM} m</b><span>Abdeckungsradius</span></div><div class="stat"><b>B = ${p.budget}</b><span>Budget</span></div></div>
    <h2>Kursübersicht</h2>${PARTS.map((pt) => `<h3>${pt.title}</h3><div class="chapters-grid">${CHAPTERS.filter((c) => c.part === pt.id).map((c) => `<a href="#/kapitel/${c.n}"><small>Kapitel ${c.n}</small>${c.title}</a>`).join('')}</div>`).join('')}`;
  mountWidget($('[data-slot="hero"]', content), { type: 'map', title: 'Die Referenzinstanz: klicke Kandidaten an', interactive: true }, ctx);
}

function renderAbout() {
  const i = ctx.instance;
  content.innerHTML = `<h1>Über dieses Labor</h1>
    <div class="card"><h2>Daten</h2><p>Geometrie: ${i.sources.map}, Stand ${i.sources.osmTimestamp}. Bounding Box ${i.area.bbox.join(', ')}.</p>
    <p>Die ${i.candidates.length} Kandidaten sind reale Kreuzungen bzw. Plätze, aber <b>hypothetische</b> Ladestandorte. Die ${i.zones.length} Nachfragezonen sind ein synthetisches 200-m-Raster; Gewichte sind synthetisch und keine Bevölkerungsdaten.</p></div>
    <div class="card"><h2>Mathematische Konventionen</h2><ul>${Object.entries(i.conventions).map(([k, v]) => `<li><b>${k}</b>: ${v}</li>`).join('')}</ul></div>
    <div class="card warn"><h2>Ehrliche Einordnung</h2><p>Diese Seite simuliert QAOA klassisch per Statevector. Für Instanzen dieser Größe ist die exakte klassische Suche schneller und garantiert optimal. Es wird kein Quantenvorteil behauptet.</p></div>
    <p>Eine Docker-Version mit FastAPI-Backend und Qiskit/Aer startest du mit <code>docker compose up</code> (siehe README).</p>`;
}

function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  document.querySelectorAll('.toc a, .top-links a').forEach((x) => x.removeAttribute('aria-current'));
  const cur = document.querySelector(`.toc a[href="#/${h}"]`); if (cur) { cur.setAttribute('aria-current', 'page'); cur.scrollIntoView({ block: 'nearest' }); }
  $('#toc').classList.remove('open'); $('#nav-toggle').setAttribute('aria-expanded', 'false');
  if (a === 'kapitel') renderChapter(+b);
  else if (a === 'studio') renderStudio(content, ctx);
  else if (a === 'code') renderCodeExplorer(content, ctx);
  else if (a === 'ueber') renderAbout();
  else renderHome();
  window.scrollTo(0, 0);
  content.focus({ preventScroll: true });
}

async function init() {
  const [instance, area] = await Promise.all(['data/reference-instance.json', 'data/reference-area.geojson'].map((u) => fetch(u).then((r) => r.json())));
  Object.assign(ctx, { instance, area, problem: buildProblem(instance, defaultConfig(instance)) });
  renderToc();
  $('#nav-toggle').addEventListener('click', () => { const t = $('#toc'); t.classList.toggle('open'); $('#nav-toggle').setAttribute('aria-expanded', String(t.classList.contains('open'))); });
  window.addEventListener('hashchange', route);
  route();
}
init().catch((e) => { content.innerHTML = `<div class="card warn">Fehler beim Laden: ${e.message}</div>`; });
