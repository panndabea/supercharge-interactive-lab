// Generates fixtures/*.txt: language-neutral conformance fixtures (plain text, one record
// per line) consumed by the Go, Rust, C++ and Python test suites.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProblem, defaultConfig } from '../website/js/math/instance.js';
import { bruteForce } from '../website/js/math/bruteforce.js';
import { greedy } from '../website/js/math/heuristics.js';
import { buildQubo, quadList, toIsing, allEnergies } from '../website/js/math/qubo.js';
import { costSpectrum, qaoaState } from '../website/js/math/qaoa.js';
import { mulberry32 } from '../website/js/math/rng.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const inst = JSON.parse(fs.readFileSync(path.join(root, 'website/data/reference-instance.json'), 'utf8'));

export const FIXTURES = [
  { name: 'default', cfg: {} },
  { name: 'all9-r400', cfg: { respectInaccessible: false, radiusM: 400 } },
  { name: 'six-b2-r250', cfg: { candidateCount: 6, budget: 2, radiusM: 250 } },
  { name: 'twelve-b4-hubs', cfg: { candidateCount: 12, budget: 4, weightPreset: 'synthetic-hubs' } },
];
const GAMMAS = [0.7, 1.3], BETAS = [0.4, 0.2];
const num = (x) => String(x);

export function fixtureText(f) {
  const p = buildProblem(inst, { ...defaultConfig(inst), ...f.cfg });
  const L = [];
  L.push(`fixture ${f.name}`);
  L.push(`radius ${num(p.radiusM)}`);
  L.push(`budget ${p.budget}`);
  L.push(`candidates ${p.N}`);
  for (const c of p.candidates) L.push(`${num(c.lat)} ${num(c.lon)}`);
  L.push(`zones ${p.Z}`);
  p.zones.forEach((z, j) => L.push(`${num(z.lat)} ${num(z.lon)} ${num(p.weights[j])}`));
  p.cover.forEach((list, i) => L.push(`cover ${i} ${list.join(' ')}`.trim()));
  const bf = bruteForce(p);
  L.push(`bf_weight ${num(bf.coveredWeight)}`);
  L.push(`bf_stations ${bf.stations.join(' ')}`.trim());
  L.push(`bf_evaluated ${bf.evaluated}`);
  const g = greedy(p);
  L.push(`greedy_weight ${num(g.coveredWeight)}`);
  L.push(`greedy_stations ${g.stations.join(' ')}`.trim());
  const q = buildQubo(p);
  L.push(`qubo_n ${q.n} ${q.nSlack} ${q.nAux}`);
  L.push(`qubo_lambda ${num(q.lambda)}`);
  L.push(`qubo_M ${num(q.M)}`);
  L.push(`qubo_offset ${num(q.offset)}`);
  L.push(`qubo_linear ${[...q.linear].map(num).join(' ')}`);
  for (const [u, v, c] of quadList(q)) L.push(`qubo_quad ${u} ${v} ${num(c)}`);
  for (const t of q.aux) L.push(`qubo_aux ${t.index} ${t.a} ${t.b}`);
  const E = allEnergies(q);
  let minE = Infinity; for (const e of E) minE = Math.min(minE, e);
  L.push(`qubo_min ${num(minE)}`);
  const is = toIsing(q);
  L.push(`ising_constant ${num(is.constant)}`);
  L.push(`ising_h ${[...is.h].map(num).join(' ')}`);
  if (q.n <= 20) {
    const spec = costSpectrum(q);
    const s = qaoaState(q.n, spec.diag, GAMMAS, BETAS);
    L.push(`qaoa_width ${num(spec.width)}`);
    L.push(`qaoa_params ${GAMMAS.join(' ')} ${BETAS.join(' ')}`);
    L.push(`qaoa_expectation ${num(s.expectationDiagonal(spec.diag))}`);
  }
  L.push('end');
  return L.join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const f of FIXTURES) fs.writeFileSync(path.join(root, 'fixtures', `${f.name}.txt`), fixtureText(f));
  const r = mulberry32(7);
  fs.writeFileSync(path.join(root, 'fixtures', 'rng.txt'), `mulberry32 7 ${Array.from({ length: 8 }, () => num(r())).join(' ')}\n`);
  console.log(`wrote ${FIXTURES.length + 1} fixtures`);
}
