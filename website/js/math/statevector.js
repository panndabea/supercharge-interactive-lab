// Minimal exact statevector simulator. Basis index bit k = qubit k (little-endian, as in Qiskit).
// Memory: 2^n complex amplitudes = 2^n * 16 bytes (two float64 per amplitude).

export const BYTES_PER_AMPLITUDE = 16;
export const statevectorBytes = (n) => 2 ** n * BYTES_PER_AMPLITUDE;

export class State {
  constructor(n) {
    this.n = n;
    this.size = 2 ** n;
    this.re = new Float64Array(this.size);
    this.im = new Float64Array(this.size);
    this.re[0] = 1;
  }
  clone() { const s = new State(this.n); s.re.set(this.re); s.im.set(this.im); return s; }
  norm2() { let s = 0; for (let k = 0; k < this.size; k++) s += this.re[k] ** 2 + this.im[k] ** 2; return s; }
  probabilities() { const p = new Float64Array(this.size); for (let k = 0; k < this.size; k++) p[k] = this.re[k] ** 2 + this.im[k] ** 2; return p; }

  // generic single-qubit gate [[a, b], [c, d]] with complex entries given as [re, im]
  apply1(q, a, b, c, d) {
    const bit = 1 << q;
    for (let k = 0; k < this.size; k++) {
      if (k & bit) continue;
      const l = k | bit;
      const r0 = this.re[k], i0 = this.im[k], r1 = this.re[l], i1 = this.im[l];
      this.re[k] = a[0] * r0 - a[1] * i0 + b[0] * r1 - b[1] * i1;
      this.im[k] = a[0] * i0 + a[1] * r0 + b[0] * i1 + b[1] * r1;
      this.re[l] = c[0] * r0 - c[1] * i0 + d[0] * r1 - d[1] * i1;
      this.im[l] = c[0] * i0 + c[1] * r0 + d[0] * i1 + d[1] * r1;
    }
    return this;
  }
  h(q) { const s = Math.SQRT1_2; return this.apply1(q, [s, 0], [s, 0], [s, 0], [-s, 0]); }
  x(q) { return this.apply1(q, [0, 0], [1, 0], [1, 0], [0, 0]); }
  z(q) { return this.apply1(q, [1, 0], [0, 0], [0, 0], [-1, 0]); }
  // RX(θ) = exp(-i θ X / 2)
  rx(q, t) { const c = Math.cos(t / 2), s = Math.sin(t / 2); return this.apply1(q, [c, 0], [0, -s], [0, -s], [c, 0]); }
  // RZ(θ) = exp(-i θ Z / 2)
  rz(q, t) { const c = Math.cos(t / 2), s = Math.sin(t / 2); return this.apply1(q, [c, -s], [0, 0], [0, 0], [c, s]); }
  cnot(ctrl, tgt) {
    const cb = 1 << ctrl, tb = 1 << tgt;
    for (let k = 0; k < this.size; k++) {
      if (!(k & cb) || (k & tb)) continue;
      const l = k | tb;
      [this.re[k], this.re[l]] = [this.re[l], this.re[k]];
      [this.im[k], this.im[l]] = [this.im[l], this.im[k]];
    }
    return this;
  }
  // RZZ(θ) = exp(-i θ Z⊗Z / 2)
  rzz(a, b, t) {
    const ab = 1 << a, bb = 1 << b;
    for (let k = 0; k < this.size; k++) {
      const parity = ((k & ab) ? 1 : 0) ^ ((k & bb) ? 1 : 0);
      const ph = parity ? t / 2 : -t / 2;
      const c = Math.cos(ph), s = Math.sin(ph), r = this.re[k], i = this.im[k];
      this.re[k] = r * c - i * s; this.im[k] = r * s + i * c;
    }
    return this;
  }
  // multiply amplitude k by exp(-i * angle * diag[k])
  phaseDiagonal(diag, angle) {
    for (let k = 0; k < this.size; k++) {
      const ph = -angle * diag[k], c = Math.cos(ph), s = Math.sin(ph), r = this.re[k], i = this.im[k];
      this.re[k] = r * c - i * s; this.im[k] = r * s + i * c;
    }
    return this;
  }
  expectationDiagonal(diag) { let e = 0; for (let k = 0; k < this.size; k++) e += (this.re[k] ** 2 + this.im[k] ** 2) * diag[k]; return e; }
}

// Inverse-CDF sampling with a seeded uniform generator.
export function sample(probs, shots, rnd) {
  const cdf = new Float64Array(probs.length);
  let acc = 0;
  for (let k = 0; k < probs.length; k++) { acc += probs[k]; cdf[k] = acc; }
  const counts = new Map();
  for (let s = 0; s < shots; s++) {
    const u = rnd() * acc;
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] > u) hi = mid; else lo = mid + 1; }
    counts.set(lo, (counts.get(lo) ?? 0) + 1);
  }
  return counts;
}
