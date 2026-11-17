import { A } from './a.js';
import { B } from './b.js';
import { C } from './c.js';

export const PARTS = [
  { id: 'A', title: 'I · Stadt und Daten' },
  { id: 'B', title: 'II · Abdeckung' },
  { id: 'C', title: 'III · Kombinatorik und klassische Solver' },
  { id: 'D', title: 'IV · QUBO' },
  { id: 'E', title: 'V · Ising' },
  { id: 'F', title: 'VI · Quantengrundlagen' },
  { id: 'G', title: 'VII · QAOA' },
  { id: 'H', title: 'VIII · Bewertung' },
];
export const CHAPTERS = [...A, ...B, ...C];
