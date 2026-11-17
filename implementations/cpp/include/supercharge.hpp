// Maximum coverage, exact QUBO and QAOA statevector simulation (C++23).
// Mirrors website/js/math/*.js (same orders, tie-breaking and quadratization).
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <functional>
#include <limits>
#include <numbers>
#include <map>
#include <numeric>
#include <sstream>
#include <stdexcept>
#include <string>
#include <tuple>
#include <utility>
#include <vector>

namespace supercharge {

inline constexpr double kEarthRadiusM = 6371008.8;
inline constexpr double kEps = 1e-9;

inline double haversine(double lat1, double lon1, double lat2, double lon2) {
  constexpr double r = std::numbers::pi / 180.0;
  const double p1 = lat1 * r, p2 = lat2 * r, dp = p2 - p1, dl = (lon2 - lon1) * r;
  const double a = std::pow(std::sin(dp / 2), 2) + std::cos(p1) * std::cos(p2) * std::pow(std::sin(dl / 2), 2);
  return 2 * kEarthRadiusM * std::asin(std::min(1.0, std::sqrt(a)));
}

class Mulberry32 {
 public:
  explicit Mulberry32(std::uint32_t seed) : a_(seed) {}
  double next() {
    a_ += 0x6d2b79f5u;
    std::uint32_t t = a_;
    t = (t ^ (t >> 15)) * (t | 1u);
    t ^= t + (t ^ (t >> 7)) * (t | 61u);
    return static_cast<double>(t ^ (t >> 14)) / 4294967296.0;
  }

 private:
  std::uint32_t a_;
};

struct Point {
  double lat, lon;
};

struct Aux {
  std::size_t index, a, b;
  bool operator==(const Aux&) const = default;
};

inline std::vector<std::size_t> slack_coefficients(std::size_t b) {
  if (b == 0) return {};
  const auto m = static_cast<std::size_t>(std::floor(std::log2(static_cast<double>(b)))) + 1;
  std::vector<std::size_t> c;
  for (std::size_t k = 0; k + 1 < m; ++k) c.push_back(std::size_t{1} << k);
  c.push_back(b - ((std::size_t{1} << (m - 1)) - 1));
  return c;
}

struct Qubo {
  std::size_t n = 0, n_cand = 0, n_slack = 0;
  std::vector<std::size_t> slack;
  std::vector<Aux> aux;
  std::vector<double> linear;
  std::map<std::pair<std::size_t, std::size_t>, double> quad;  // ordered by (u, v)
  double offset = 0, lambda = 0, m = 0;

  [[nodiscard]] std::vector<double> energies() const {
    std::vector<double> e(std::size_t{1} << n);
    for (std::size_t idx = 0; idx < e.size(); ++idx) {
      double v = offset;
      for (std::size_t k = 0; k < n; ++k)
        if ((idx >> k) & 1) v += linear[k];
      for (const auto& [uv, c] : quad)
        if (((idx >> uv.first) & 1) && ((idx >> uv.second) & 1)) v += c;
      e[idx] = v;
    }
    return e;
  }

  // x_i = (1 - Z_i) / 2
  [[nodiscard]] std::tuple<std::vector<double>, std::vector<std::tuple<std::size_t, std::size_t, double>>, double> ising() const {
    std::vector<double> h(n, 0.0);
    std::vector<std::tuple<std::size_t, std::size_t, double>> j;
    double c = offset;
    for (std::size_t i = 0; i < n; ++i) {
      c += linear[i] / 2;
      h[i] -= linear[i] / 2;
    }
    for (const auto& [uv, w] : quad) {
      c += w / 4;
      h[uv.first] -= w / 4;
      h[uv.second] -= w / 4;
      j.emplace_back(uv.first, uv.second, w / 4);
    }
    return {h, j, c};
  }

  // Exact QAOA state, returns {<H_C>, width}, H_C = E / (Emax - Emin).
  [[nodiscard]] std::pair<double, double> qaoa_expectation(const std::vector<double>& gammas, const std::vector<double>& betas) const {
    const auto e = energies();
    const auto [lo, hi] = std::minmax_element(e.begin(), e.end());
    const double width = *hi > *lo ? *hi - *lo : 1.0;
    const std::size_t size = e.size();
    std::vector<double> re(size, 1.0 / std::sqrt(static_cast<double>(size))), im(size, 0.0);
    for (std::size_t l = 0; l < gammas.size(); ++l) {
      for (std::size_t k = 0; k < size; ++k) {
        const double ph = -gammas[l] * e[k] / width, c = std::cos(ph), s = std::sin(ph), r = re[k], i = im[k];
        re[k] = r * c - i * s;
        im[k] = r * s + i * c;
      }
      const double c = std::cos(betas[l]), s = std::sin(betas[l]);
      for (std::size_t q = 0; q < n; ++q) {
        const std::size_t bit = std::size_t{1} << q;
        for (std::size_t k = 0; k < size; ++k) {
          if (k & bit) continue;
          const double r0 = re[k], i0 = im[k], r1 = re[k | bit], i1 = im[k | bit];
          re[k] = c * r0 + s * i1;
          im[k] = c * i0 - s * r1;
          re[k | bit] = s * i0 + c * r1;
          im[k | bit] = -s * r0 + c * i1;
        }
      }
    }
    double exp = 0;
    for (std::size_t k = 0; k < size; ++k) exp += (re[k] * re[k] + im[k] * im[k]) * e[k] / width;
    return {exp, width};
  }
};

class Problem {
 public:
  std::vector<Point> candidates, zones;
  std::vector<double> weights;
  double radius;
  std::size_t budget;
  std::vector<std::vector<std::size_t>> cover, covered_by;

  Problem(std::vector<Point> c, std::vector<Point> z, std::vector<double> w, double r, std::size_t b)
      : candidates(std::move(c)), zones(std::move(z)), weights(std::move(w)), radius(r), budget(b),
        cover(candidates.size()), covered_by(zones.size()) {
    for (std::size_t i = 0; i < candidates.size(); ++i)
      for (std::size_t j = 0; j < zones.size(); ++j)
        if (haversine(candidates[i].lat, candidates[i].lon, zones[j].lat, zones[j].lon) <= radius) {
          cover[i].push_back(j);
          covered_by[j].push_back(i);
        }
  }
  [[nodiscard]] std::size_t n() const { return candidates.size(); }

  [[nodiscard]] double evaluate(const std::vector<std::size_t>& st) const {
    std::vector<bool> seen(zones.size());
    double w = 0;
    for (auto i : st)
      for (auto j : cover[i])
        if (!seen[j]) {
          seen[j] = true;
          w += weights[j];
        }
    return w;
  }

  struct BruteForceResult {
    std::vector<std::size_t> stations;
    double weight;
    std::uint64_t evaluated;
  };

  // Depth-first lexicographic enumeration of every |S| <= B.
  [[nodiscard]] BruteForceResult brute_force() const {
    const std::size_t k_max = std::min(budget, n());
    std::vector<std::uint32_t> hits(zones.size(), 0);
    std::vector<std::size_t> stack, best;
    double w = 0, best_w = -1;
    std::size_t best_k = std::numeric_limits<std::size_t>::max();
    std::uint64_t evaluated = 0;
    std::function<void(std::size_t)> rec = [&](std::size_t start) {
      ++evaluated;
      if (w > best_w + kEps || (std::abs(w - best_w) <= kEps && stack.size() < best_k)) {
        best_w = w;
        best_k = stack.size();
        best = stack;
      }
      if (stack.size() == k_max) return;
      for (std::size_t i = start; i < n(); ++i) {
        for (auto j : cover[i])
          if (hits[j]++ == 0) w += weights[j];
        stack.push_back(i);
        rec(i + 1);
        stack.pop_back();
        for (auto j : cover[i])
          if (--hits[j] == 0) w -= weights[j];
      }
    };
    rec(0);
    return {best, best_w, evaluated};
  }

  [[nodiscard]] std::pair<std::vector<std::size_t>, double> greedy() const {
    std::vector<bool> covered(zones.size()), in(n());
    std::vector<std::size_t> sel;
    double total = 0;
    while (sel.size() < std::min(budget, n())) {
      std::size_t bi = n();
      double bg = 0;
      for (std::size_t i = 0; i < n(); ++i) {
        if (in[i]) continue;
        double g = 0;
        for (auto j : cover[i])
          if (!covered[j]) g += weights[j];
        if (g > bg + kEps) {
          bi = i;
          bg = g;
        }
      }
      if (bi == n()) break;
      in[bi] = true;
      sel.push_back(bi);
      for (auto j : cover[bi]) covered[j] = true;
      total += bg;
    }
    std::ranges::sort(sel);
    return {sel, total};
  }

  // Exact QUBO: inclusion-exclusion coverage, Rosenberg quadratization, budget slack.
  [[nodiscard]] Qubo build_qubo() const {
    using Vars = std::vector<std::size_t>;
    const std::size_t nc = n(), b = budget;
    std::vector<std::pair<Vars, double>> groups;
    std::map<Vars, std::size_t> gidx;
    for (std::size_t j = 0; j < zones.size(); ++j) {
      if (covered_by[j].empty() || weights[j] == 0) continue;
      auto [it, fresh] = gidx.try_emplace(covered_by[j], groups.size());
      if (fresh) groups.emplace_back(covered_by[j], 0.0);
      groups[it->second].second += weights[j];
    }
    std::vector<std::pair<Vars, double>> poly;
    std::map<Vars, std::size_t> pidx;
    for (const auto& [c, wt] : groups)
      for (std::size_t mask = 1; mask < (std::size_t{1} << c.size()); ++mask) {
        Vars v;
        for (std::size_t q = 0; q < c.size(); ++q)
          if ((mask >> q) & 1) v.push_back(c[q]);
        const double coef = v.size() % 2 ? -wt : wt;
        auto [it, fresh] = pidx.try_emplace(v, poly.size());
        if (fresh) poly.emplace_back(v, 0.0);
        poly[it->second].second += coef;
      }
    std::vector<std::pair<Vars, double>> monos;
    double high = 0;
    for (auto& m : poly)
      if (std::abs(m.second) >= 1e-12) {
        if (m.first.size() >= 3) high += std::abs(m.second);
        monos.push_back(m);
      }
    std::vector<std::tuple<std::size_t, std::size_t, std::size_t>> tmp;
    for (;;) {
      std::map<std::pair<std::size_t, std::size_t>, std::size_t> counts;
      for (const auto& [v, c] : monos) {
        if (v.size() < 3) continue;
        for (std::size_t x = 0; x < v.size(); ++x)
          for (std::size_t y = x + 1; y < v.size(); ++y) ++counts[{v[x], v[y]}];
      }
      if (counts.empty()) break;
      std::pair<std::size_t, std::size_t> best{};
      std::size_t bc = 0;
      for (const auto& [k, c] : counts)  // ascending keys -> first maximum is the smallest pair
        if (c > bc) {
          bc = c;
          best = k;
        }
      const std::size_t z = 1000 + tmp.size();
      tmp.emplace_back(z, best.first, best.second);
      for (auto& [v, c] : monos) {
        if (v.size() < 3 || std::ranges::find(v, best.first) == v.end() || std::ranges::find(v, best.second) == v.end()) continue;
        Vars nv;
        for (auto x : v)
          if (x != best.first && x != best.second) nv.push_back(x);
        nv.push_back(z);
        std::ranges::sort(nv);
        v = nv;
      }
    }
    Qubo q;
    const bool need = b < nc;
    q.slack = need ? slack_coefficients(b) : std::vector<std::size_t>{};
    q.n_cand = nc;
    q.n_slack = q.slack.size();
    std::map<std::size_t, std::size_t> remap;
    for (std::size_t i = 0; i < nc; ++i) remap[i] = i;
    for (std::size_t k = 0; k < tmp.size(); ++k) remap[std::get<0>(tmp[k])] = nc + q.n_slack + k;
    q.n = nc + q.n_slack + tmp.size();
    q.linear.assign(q.n, 0.0);
    for (auto& [z, a, c] : tmp) q.aux.push_back({remap[z], remap[a], remap[c]});
    auto add = [&](Vars vars, double c) {
      if (c == 0) return;
      for (auto& x : vars)
        if (auto it = remap.find(x); it != remap.end()) x = it->second;
      std::ranges::sort(vars);
      if (vars.empty()) q.offset += c;
      else if (vars.size() == 1 || vars[0] == vars[1]) q.linear[vars[0]] += c;
      else q.quad[{vars[0], vars[1]}] += c;
    };
    for (const auto& [v, c] : monos) add(v, c);
    double max_w = 0;
    for (const auto& l : cover) {
      double s = 0;
      for (auto j : l) s += weights[j];
      max_w = std::max(max_w, s);
    }
    q.lambda = 1 + max_w;
    if (need) {
      std::vector<std::pair<std::size_t, double>> terms;
      for (std::size_t i = 0; i < nc; ++i) terms.emplace_back(i, 1.0);
      for (std::size_t k = 0; k < q.n_slack; ++k) terms.emplace_back(nc + k, static_cast<double>(q.slack[k]));
      const double bd = static_cast<double>(b);
      for (auto [v, a] : terms) add({v}, q.lambda * (a * a - 2 * bd * a));
      for (std::size_t x = 0; x < terms.size(); ++x)
        for (std::size_t y = x + 1; y < terms.size(); ++y) add({terms[x].first, terms[y].first}, q.lambda * 2 * terms[x].second * terms[y].second);
      add({}, q.lambda * bd * bd);
    }
    q.m = 1 + high;
    for (const auto& t : q.aux) {
      add({t.a, t.b}, q.m);
      add({t.a, t.index}, -2 * q.m);
      add({t.b, t.index}, -2 * q.m);
      add({t.index}, 3 * q.m);
    }
    std::erase_if(q.quad, [](const auto& kv) { return std::abs(kv.second) < 1e-12; });
    return q;
  }
};

struct Fixture {
  std::string name;
  Problem problem;
  std::map<std::string, std::vector<std::string>> expect;
  std::map<std::size_t, std::vector<std::size_t>> cover;
  std::vector<std::tuple<std::size_t, std::size_t, double>> quad;
  std::vector<Aux> aux;
};

inline Fixture load_fixture(const std::string& path) {
  std::ifstream in(path);
  if (!in) throw std::runtime_error("Fixture nicht lesbar: " + path);
  auto words = [&]() {
    std::string line;
    std::getline(in, line);
    std::istringstream ss(line);
    std::vector<std::string> v;
    for (std::string w; ss >> w;) v.push_back(w);
    return v;
  };
  const auto name = words()[1];
  const double radius = std::stod(words()[1]);
  const std::size_t budget = std::stoul(words()[1]);
  std::vector<Point> c, z;
  std::vector<double> w;
  for (std::size_t i = 0, nc = std::stoul(words()[1]); i < nc; ++i) {
    auto v = words();
    c.push_back({std::stod(v[0]), std::stod(v[1])});
  }
  for (std::size_t j = 0, nz = std::stoul(words()[1]); j < nz; ++j) {
    auto v = words();
    z.push_back({std::stod(v[0]), std::stod(v[1])});
    w.push_back(std::stod(v[2]));
  }
  Fixture fx{name, Problem(c, z, w, radius, budget), {}, {}, {}, {}};
  for (;;) {
    auto v = words();
    if (v.empty() || v[0] == "end") break;
    if (v[0] == "cover") {
      auto& l = fx.cover[std::stoul(v[1])];
      for (std::size_t k = 2; k < v.size(); ++k) l.push_back(std::stoul(v[k]));
    } else if (v[0] == "qubo_quad") {
      fx.quad.emplace_back(std::stoul(v[1]), std::stoul(v[2]), std::stod(v[3]));
    } else if (v[0] == "qubo_aux") {
      fx.aux.push_back({std::stoul(v[1]), std::stoul(v[2]), std::stoul(v[3])});
    } else {
      fx.expect[v[0]] = {v.begin() + 1, v.end()};
    }
  }
  return fx;
}

}  // namespace supercharge
