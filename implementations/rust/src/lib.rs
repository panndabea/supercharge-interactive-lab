//! Maximum coverage, exact QUBO and QAOA statevector simulation.
//! Mirrors `website/js/math/*.js` (same orders, tie-breaking and quadratization).
#![allow(clippy::needless_range_loop, clippy::type_complexity)]
use std::collections::{BTreeMap, HashMap};

pub const EARTH_RADIUS_M: f64 = 6371008.8;
const EPS: f64 = 1e-9;

pub fn haversine(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let (dp, dl) = (p2 - p1, (lon2 - lon1).to_radians());
    let a = (dp / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dl / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_M * a.sqrt().min(1.0).asin()
}

/// Mulberry32 seeded generator in [0, 1).
pub struct Mulberry32(u32);
impl Mulberry32 {
    pub fn new(seed: u32) -> Self {
        Self(seed)
    }
    pub fn next_f64(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        (t ^ (t >> 14)) as f64 / 4294967296.0
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Point {
    pub lat: f64,
    pub lon: f64,
}

pub struct Problem {
    pub candidates: Vec<Point>,
    pub zones: Vec<Point>,
    pub weights: Vec<f64>,
    pub radius: f64,
    pub budget: usize,
    pub cover: Vec<Vec<usize>>,
    pub covered_by: Vec<Vec<usize>>,
}

impl Problem {
    pub fn new(
        candidates: Vec<Point>,
        zones: Vec<Point>,
        weights: Vec<f64>,
        radius: f64,
        budget: usize,
    ) -> Self {
        let mut cover = vec![Vec::new(); candidates.len()];
        let mut covered_by = vec![Vec::new(); zones.len()];
        for (i, c) in candidates.iter().enumerate() {
            for (j, z) in zones.iter().enumerate() {
                if haversine(c.lat, c.lon, z.lat, z.lon) <= radius {
                    cover[i].push(j);
                    covered_by[j].push(i);
                }
            }
        }
        Self {
            candidates,
            zones,
            weights,
            radius,
            budget,
            cover,
            covered_by,
        }
    }
    pub fn n(&self) -> usize {
        self.candidates.len()
    }

    /// Covered weight; each zone counts once.
    pub fn evaluate(&self, stations: &[usize]) -> f64 {
        let mut seen = vec![false; self.zones.len()];
        let mut w = 0.0;
        for &i in stations {
            for &j in &self.cover[i] {
                if !seen[j] {
                    seen[j] = true;
                    w += self.weights[j];
                }
            }
        }
        w
    }

    /// Exhaustive depth-first lexicographic search over |S| <= B.
    pub fn brute_force(&self) -> (Vec<usize>, f64, u64) {
        struct S<'a> {
            p: &'a Problem,
            k: usize,
            hits: Vec<u32>,
            stack: Vec<usize>,
            w: f64,
            best: Vec<usize>,
            best_w: f64,
            best_k: usize,
            evaluated: u64,
        }
        fn rec(s: &mut S, start: usize) {
            s.evaluated += 1;
            if s.w > s.best_w + EPS || ((s.w - s.best_w).abs() <= EPS && s.stack.len() < s.best_k) {
                s.best_w = s.w;
                s.best_k = s.stack.len();
                s.best = s.stack.clone();
            }
            if s.stack.len() == s.k {
                return;
            }
            for i in start..s.p.n() {
                for &j in &s.p.cover[i] {
                    if s.hits[j] == 0 {
                        s.w += s.p.weights[j];
                    }
                    s.hits[j] += 1;
                }
                s.stack.push(i);
                rec(s, i + 1);
                s.stack.pop();
                for &j in &s.p.cover[i] {
                    s.hits[j] -= 1;
                    if s.hits[j] == 0 {
                        s.w -= s.p.weights[j];
                    }
                }
            }
        }
        let mut s = S {
            p: self,
            k: self.budget.min(self.n()),
            hits: vec![0; self.zones.len()],
            stack: vec![],
            w: 0.0,
            best: vec![],
            best_w: -1.0,
            best_k: usize::MAX,
            evaluated: 0,
        };
        rec(&mut s, 0);
        (s.best, s.best_w, s.evaluated)
    }

    pub fn greedy(&self) -> (Vec<usize>, f64) {
        let mut covered = vec![false; self.zones.len()];
        let mut sel: Vec<usize> = vec![];
        let mut total = 0.0;
        while sel.len() < self.budget.min(self.n()) {
            let (mut bi, mut bg) = (usize::MAX, 0.0);
            for i in 0..self.n() {
                if sel.contains(&i) {
                    continue;
                }
                let g: f64 = self.cover[i]
                    .iter()
                    .filter(|&&j| !covered[j])
                    .map(|&j| self.weights[j])
                    .sum();
                if g > bg + EPS {
                    bi = i;
                    bg = g;
                }
            }
            if bi == usize::MAX {
                break;
            }
            sel.push(bi);
            for &j in &self.cover[bi] {
                covered[j] = true;
            }
            total += bg;
        }
        sel.sort();
        (sel, total)
    }

    /// Exact QUBO: inclusion-exclusion coverage, Rosenberg quadratization, budget slack.
    pub fn build_qubo(&self) -> Qubo {
        let (n_c, b) = (self.n(), self.budget);
        let mut groups: Vec<(Vec<usize>, f64)> = vec![];
        let mut gidx: HashMap<Vec<usize>, usize> = HashMap::new();
        for (j, c) in self.covered_by.iter().enumerate() {
            if c.is_empty() || self.weights[j] == 0.0 {
                continue;
            }
            let k = *gidx.entry(c.clone()).or_insert_with(|| {
                groups.push((c.clone(), 0.0));
                groups.len() - 1
            });
            groups[k].1 += self.weights[j];
        }
        let mut poly: Vec<(Vec<usize>, f64)> = vec![];
        let mut pidx: HashMap<Vec<usize>, usize> = HashMap::new();
        for (c, wt) in &groups {
            for mask in 1usize..(1 << c.len()) {
                let vars: Vec<usize> = (0..c.len())
                    .filter(|b| mask >> b & 1 == 1)
                    .map(|b| c[b])
                    .collect();
                let coef = if vars.len() % 2 == 1 { -wt } else { *wt };
                let k = *pidx.entry(vars.clone()).or_insert_with(|| {
                    poly.push((vars, 0.0));
                    poly.len() - 1
                });
                poly[k].1 += coef;
            }
        }
        let mut monos: Vec<(Vec<usize>, f64)> =
            poly.into_iter().filter(|(_, c)| c.abs() >= 1e-12).collect();
        let high: f64 = monos
            .iter()
            .filter(|(v, _)| v.len() >= 3)
            .map(|(_, c)| c.abs())
            .sum();
        let mut tmp: Vec<(usize, usize, usize)> = vec![];
        loop {
            let mut counts: BTreeMap<(usize, usize), usize> = BTreeMap::new();
            for (v, _) in &monos {
                if v.len() < 3 {
                    continue;
                }
                for a in 0..v.len() {
                    for c in a + 1..v.len() {
                        *counts.entry((v[a], v[c])).or_default() += 1;
                    }
                }
            }
            if counts.is_empty() {
                break;
            }
            // BTreeMap iterates pairs in ascending order -> first maximum = smallest pair
            let mut best = (0, 0);
            let mut bc = 0;
            for (&k, &c) in &counts {
                if c > bc {
                    bc = c;
                    best = k;
                }
            }
            let z = 1000 + tmp.len();
            tmp.push((z, best.0, best.1));
            for (v, _) in monos.iter_mut() {
                if v.len() < 3 || !v.contains(&best.0) || !v.contains(&best.1) {
                    continue;
                }
                let mut nv: Vec<usize> = v
                    .iter()
                    .copied()
                    .filter(|&x| x != best.0 && x != best.1)
                    .collect();
                nv.push(z);
                nv.sort();
                *v = nv;
            }
        }
        let need = b < n_c;
        let slack = if need { slack_coefficients(b) } else { vec![] };
        let ns = slack.len();
        let mut remap: HashMap<usize, usize> = (0..n_c).map(|i| (i, i)).collect();
        for (k, &(z, _, _)) in tmp.iter().enumerate() {
            remap.insert(z, n_c + ns + k);
        }
        let n = n_c + ns + tmp.len();
        let aux: Vec<(usize, usize, usize)> = tmp
            .iter()
            .map(|&(z, a, c)| (remap[&z], remap[&a], remap[&c]))
            .collect();
        let mut q = Qubo {
            n,
            n_cand: n_c,
            n_slack: ns,
            slack: slack.clone(),
            aux: aux.clone(),
            linear: vec![0.0; n],
            quad: BTreeMap::new(),
            offset: 0.0,
            lambda: 0.0,
            m: 0.0,
        };
        let add = |q: &mut Qubo, vars: &[usize], c: f64| {
            if c == 0.0 {
                return;
            }
            let mut v: Vec<usize> = vars.iter().map(|x| *remap.get(x).unwrap_or(x)).collect();
            v.sort();
            match v.len() {
                0 => q.offset += c,
                1 => q.linear[v[0]] += c,
                _ if v[0] == v[1] => q.linear[v[0]] += c,
                _ => *q.quad.entry((v[0], v[1])).or_insert(0.0) += c,
            }
        };
        for (v, c) in &monos {
            add(&mut q, v, *c);
        }
        let max_w = self
            .cover
            .iter()
            .map(|l| l.iter().map(|&j| self.weights[j]).sum::<f64>())
            .fold(0.0, f64::max);
        q.lambda = 1.0 + max_w;
        let lam = q.lambda;
        if need {
            let mut terms: Vec<(usize, f64)> = (0..n_c).map(|i| (i, 1.0)).collect();
            for (k, &s) in slack.iter().enumerate() {
                terms.push((n_c + k, s as f64));
            }
            for &(v, a) in &terms {
                add(&mut q, &[v], lam * (a * a - 2.0 * b as f64 * a));
            }
            for x in 0..terms.len() {
                for y in x + 1..terms.len() {
                    add(
                        &mut q,
                        &[terms[x].0, terms[y].0],
                        lam * 2.0 * terms[x].1 * terms[y].1,
                    );
                }
            }
            add(&mut q, &[], lam * (b * b) as f64);
        }
        q.m = 1.0 + high;
        let m = q.m;
        for &(z, a, c) in &aux {
            add(&mut q, &[a, c], m);
            add(&mut q, &[a, z], -2.0 * m);
            add(&mut q, &[c, z], -2.0 * m);
            add(&mut q, &[z], 3.0 * m);
        }
        q.quad.retain(|_, v| v.abs() >= 1e-12);
        q
    }
}

pub fn slack_coefficients(b: usize) -> Vec<usize> {
    if b == 0 {
        return vec![];
    }
    let m = (b as f64).log2().floor() as usize + 1;
    let mut c: Vec<usize> = (0..m - 1).map(|k| 1 << k).collect();
    c.push(b - ((1 << (m - 1)) - 1));
    c
}

pub struct Qubo {
    pub n: usize,
    pub n_cand: usize,
    pub n_slack: usize,
    pub slack: Vec<usize>,
    pub aux: Vec<(usize, usize, usize)>,
    pub linear: Vec<f64>,
    pub quad: BTreeMap<(usize, usize), f64>,
    pub offset: f64,
    pub lambda: f64,
    pub m: f64,
}

impl Qubo {
    pub fn energies(&self) -> Vec<f64> {
        (0..1usize << self.n)
            .map(|idx| {
                let mut e = self.offset;
                for k in 0..self.n {
                    if idx >> k & 1 == 1 {
                        e += self.linear[k];
                    }
                }
                for (&(u, v), &c) in &self.quad {
                    if idx >> u & 1 == 1 && idx >> v & 1 == 1 {
                        e += c;
                    }
                }
                e
            })
            .collect()
    }
    pub fn ising(&self) -> (Vec<f64>, Vec<(usize, usize, f64)>, f64) {
        let mut h = vec![0.0; self.n];
        let mut c = self.offset;
        for i in 0..self.n {
            c += self.linear[i] / 2.0;
            h[i] -= self.linear[i] / 2.0;
        }
        let mut j = vec![];
        for (&(u, v), &w) in &self.quad {
            c += w / 4.0;
            h[u] -= w / 4.0;
            h[v] -= w / 4.0;
            j.push((u, v, w / 4.0));
        }
        (h, j, c)
    }
    /// Exact QAOA state; returns (<H_C>, width) with H_C = E / (Emax - Emin).
    pub fn qaoa_expectation(&self, gammas: &[f64], betas: &[f64]) -> (f64, f64) {
        let e = self.energies();
        let lo = e.iter().cloned().fold(f64::INFINITY, f64::min);
        let hi = e.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let width = if hi > lo { hi - lo } else { 1.0 };
        let size = e.len();
        let a0 = 1.0 / (size as f64).sqrt();
        let (mut re, mut im) = (vec![a0; size], vec![0.0; size]);
        for l in 0..gammas.len() {
            for k in 0..size {
                let ph = -gammas[l] * e[k] / width;
                let (s, c) = ph.sin_cos();
                let (r, i) = (re[k], im[k]);
                re[k] = r * c - i * s;
                im[k] = r * s + i * c;
            }
            let (c, s) = (betas[l].cos(), betas[l].sin());
            for qb in 0..self.n {
                let bit = 1 << qb;
                for k in 0..size {
                    if k & bit != 0 {
                        continue;
                    }
                    let (r0, i0, r1, i1) = (re[k], im[k], re[k | bit], im[k | bit]);
                    // [[c, -is], [-is, c]]
                    re[k] = c * r0 + s * i1;
                    im[k] = c * i0 - s * r1;
                    re[k | bit] = s * i0 + c * r1;
                    im[k | bit] = -s * r0 + c * i1;
                }
            }
        }
        let exp = (0..size)
            .map(|k| (re[k] * re[k] + im[k] * im[k]) * e[k] / width)
            .sum();
        (exp, width)
    }
}

/// Parsed `fixtures/*.txt`.
pub struct Fixture {
    pub name: String,
    pub problem: Problem,
    pub expect: HashMap<String, Vec<String>>,
    pub cover: HashMap<usize, Vec<usize>>,
    pub quad: Vec<(usize, usize, f64)>,
    pub aux: Vec<(usize, usize, usize)>,
}

pub fn load_fixture(path: &str) -> std::io::Result<Fixture> {
    let text = std::fs::read_to_string(path)?;
    let mut it = text
        .lines()
        .map(|l| l.split_whitespace().collect::<Vec<_>>());
    let mut next = || it.next().unwrap_or_default();
    let f = |s: &str| s.parse::<f64>().unwrap();
    let u = |s: &str| s.parse::<usize>().unwrap();
    let name = next()[1].to_string();
    let radius = f(next()[1]);
    let budget = u(next()[1]);
    let nc = u(next()[1]);
    let cands: Vec<Point> = (0..nc)
        .map(|_| {
            let v = next();
            Point {
                lat: f(v[0]),
                lon: f(v[1]),
            }
        })
        .collect();
    let nz = u(next()[1]);
    let mut zones = vec![];
    let mut w = vec![];
    for _ in 0..nz {
        let v = next();
        zones.push(Point {
            lat: f(v[0]),
            lon: f(v[1]),
        });
        w.push(f(v[2]));
    }
    let (mut expect, mut cover, mut quad, mut aux) =
        (HashMap::new(), HashMap::new(), vec![], vec![]);
    loop {
        let v = next();
        if v.is_empty() || v[0] == "end" {
            break;
        }
        match v[0] {
            "cover" => {
                cover.insert(u(v[1]), v[2..].iter().map(|x| u(x)).collect());
            }
            "qubo_quad" => quad.push((u(v[1]), u(v[2]), f(v[3]))),
            "qubo_aux" => aux.push((u(v[1]), u(v[2]), u(v[3]))),
            k => {
                expect.insert(
                    k.to_string(),
                    v[1..].iter().map(|s| s.to_string()).collect(),
                );
            }
        }
    }
    Ok(Fixture {
        name,
        problem: Problem::new(cands, zones, w, radius, budget),
        expect,
        cover,
        quad,
        aux,
    })
}
