// Counting and enumerating subsets.

// Binomial coefficient C(n, k) as a float (exact up to 2^53).
export function binom(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r < 2 ** 53 ? Math.round(r) : r;
}

// Exact binomial coefficient as BigInt.
export function binomBig(n, k) {
  if (k < 0 || k > n) return 0n;
  k = Math.min(k, n - k);
  let r = 1n;
  for (let i = 1n; i <= BigInt(k); i++) r = (r * (BigInt(n) - BigInt(k) + i)) / i;
  return r;
}

// Number of subsets with at most B elements: sum_{k=0}^{min(B,N)} C(N, k).
export function feasibleCount(N, B) {
  let s = 0;
  for (let k = 0; k <= Math.min(B, N); k++) s += binom(N, k);
  return s;
}

export function feasibleCountBig(N, B) {
  let s = 0n;
  for (let k = 0; k <= Math.min(B, N); k++) s += binomBig(N, k);
  return s;
}

// All k-subsets of {0..n-1} in lexicographic order.
export function* kSubsets(n, k) {
  if (k > n) return;
  const c = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield c.slice();
    let i = k - 1;
    while (i >= 0 && c[i] === n - k + i) i--;
    if (i < 0) return;
    c[i]++;
    for (let j = i + 1; j < k; j++) c[j] = c[j - 1] + 1;
  }
}

// All subsets with at most B elements in depth-first lexicographic order:
// [], [0], [0,1], [0,1,2], [0,1,3], ..., the order used by the brute-force solver.
export function* subsetsUpTo(n, B) {
  const stack = [];
  function* rec(start) {
    yield stack.slice();
    if (stack.length === B) return;
    for (let i = start; i < n; i++) {
      stack.push(i);
      yield* rec(i + 1);
      stack.pop();
    }
  }
  yield* rec(0);
}
