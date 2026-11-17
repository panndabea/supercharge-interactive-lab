#include <chrono>
#include <format>
#include <iostream>

#include "supercharge.hpp"

template <class... A>
static void println(std::format_string<A...> f, A&&... a) {
  std::cout << std::format(f, std::forward<A>(a)...) << '\n';
}

static std::string list(const std::vector<std::size_t>& v) {
  std::string s = "[";
  for (std::size_t k = 0; k < v.size(); ++k) s += (k ? ", " : "") + std::to_string(v[k]);
  return s + "]";
}

int main(int argc, char** argv) {
  const std::string path = argc > 1 ? argv[1] : "../../fixtures/default.txt";
  const auto fx = supercharge::load_fixture(path);
  const auto& p = fx.problem;
  const auto t0 = std::chrono::steady_clock::now();
  const auto bf = p.brute_force();
  const auto us = std::chrono::duration<double, std::micro>(std::chrono::steady_clock::now() - t0).count();
  println("Fixture {}: N={} Zonen={} B={} r={} m", fx.name, p.n(), p.zones.size(), p.budget, p.radius);
  println("Brute Force: Stationen {}, Gewicht {}, {} Teilmengen, {:.1f} µs (gemessen)", list(bf.stations), bf.weight, bf.evaluated, us);
  const auto [gs, gw] = p.greedy();
  println("Greedy:      Stationen {}, Gewicht {}", list(gs), gw);
  const auto q = p.build_qubo();
  println("QUBO:        {} Variablen ({} Schlupf, {} Hilfs), λ={}, M={}", q.n, q.n_slack, q.aux.size(), q.lambda, q.m);
}
