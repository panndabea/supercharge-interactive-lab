// Code explorer: shows the real, tested source files of all five implementations.
const LANGS = [
  { id: 'js', name: 'JavaScript', files: ['js/math/geo.js', 'js/math/coverage.js', 'js/math/bruteforce.js', 'js/math/qubo.js', 'js/math/statevector.js', 'js/math/qaoa.js'] },
  { id: 'py', name: 'Python / Qiskit', files: ['src/implementations/python/supercharge/core.py', 'src/implementations/python/supercharge/qaoa.py'] },
  { id: 'go', name: 'Go', files: ['src/implementations/go/supercharge.go'] },
  { id: 'rs', name: 'Rust', files: ['src/implementations/rust/src/lib.rs'] },
  { id: 'cpp', name: 'C++23', files: ['src/implementations/cpp/include/supercharge.hpp'] },
];
const TOPICS = [
  ['Haversine', /haversine/i], ['Abdeckung', /evaluate|coverage/i], ['Brute Force', /brute_?force/i], ['Greedy', /greedy/i],
  ['Schlupf', /slack/i], ['QUBO', /build_?qubo/i], ['Ising', /ising/i], ['QAOA', /qaoa/i],
];
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

async function load(path) {
  for (const p of [path]) {
    try { const r = await fetch(p); if (r.ok) return await r.text(); } catch { /* try next */ }
  }
  throw new Error(`${path} nicht gefunden`);
}

export function renderCodeExplorer(root) {
  root.innerHTML = `<div class="kicker">Werkzeug</div><h1>Code-Explorer</h1>
    <p class="lead">Dieselbe Mathematik in fünf Sprachen. Alle Implementierungen werden in CI gegen gemeinsame Fixtures geprüft (Distanz, Abdeckung, Brute Force, QUBO-Koeffizienten, QUBO-Minimum, Ising-Konstanten, QAOA-Erwartungswert).</p>
    <div class="controls" role="tablist" id="langs">${LANGS.map((l, k) => `<button type="button" role="tab" data-l="${l.id}" aria-selected="${k === 0}" class="${k === 0 ? 'primary' : ''}">${l.name}</button>`).join('')}</div>
    <div class="controls"><label>Datei <select id="file"></select></label><span>Springe zu:</span>${TOPICS.map(([t], k) => `<button type="button" data-t="${k}">${t}</button>`).join('')}</div>
    <pre id="src" tabindex="0" aria-label="Quelltext"></pre>`;
  const sel = root.querySelector('#file'), pre = root.querySelector('#src');
  let lang = LANGS[0];
  const show = async () => {
    pre.textContent = 'Lade …';
    try {
      const txt = await load(sel.value);
      pre.innerHTML = txt.split('\n').map((l, k) => `<span id="L${k + 1}" style="display:block"><span style="color:var(--muted);user-select:none;display:inline-block;width:3.5em">${k + 1}</span>${esc(l)}</span>`).join('');
    } catch (e) { pre.textContent = e.message; }
  };
  const setLang = (id) => {
    lang = LANGS.find((l) => l.id === id);
    root.querySelectorAll('#langs button').forEach((b) => { const on = b.dataset.l === id; b.className = on ? 'primary' : ''; b.setAttribute('aria-selected', on); });
    sel.innerHTML = lang.files.map((f) => `<option value="${f}">${f.replace(/^src\//, '')}</option>`).join('');
    show();
  };
  root.querySelector('#langs').onclick = (e) => { const b = e.target.closest('button'); if (b) setLang(b.dataset.l); };
  sel.onchange = show;
  root.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => {
    const re = TOPICS[+b.dataset.t][1];
    const line = [...pre.children].find((s) => /(function|fn |func |def |auto |struct |class |inline |std::)/.test(s.textContent) && re.test(s.textContent)) ?? [...pre.children].find((s) => re.test(s.textContent));
    pre.querySelectorAll('.hlline').forEach((x) => { x.classList.remove('hlline'); x.style.background = ''; });
    if (line) { line.classList.add('hlline'); line.style.background = 'color-mix(in srgb, var(--accent) 22%, transparent)'; pre.scrollTop = line.offsetTop - pre.offsetTop - 40; }
  });
  setLang('js');
}
