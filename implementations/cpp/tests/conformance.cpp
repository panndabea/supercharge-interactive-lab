#include <format>
#include <iostream>

#include "supercharge.hpp"

using namespace supercharge;

static int failures = 0;
#define CHECK(cond, msg)                                         \
  do {                                                           \
    if (!(cond)) {                                               \
      ++failures;                                                \
      std::cerr << "FAIL " << __LINE__ << ": " << (msg) << '\n'; \
    }                                                            \
  } while (0)

static std::string join(const auto& v) {
  std::string s;
  for (const auto& x : v) s += (s.empty() ? "" : " ") + std::format("{}", x);
  return s;
}

int main(int argc, char** argv) {
  const std::string dir = argc > 1 ? argv[1] : "../../fixtures";
  {
    std::ifstream in(dir + "/rng.txt");
    std::string tag;
    std::uint32_t seed;
    in >> tag >> seed;
    Mulberry32 r(seed);
    for (std::string v; in >> v;) CHECK(r.next() == std::stod(v), "rng " + v);
  }
  CHECK(std::abs(haversine(0, 0, 0, 1) - 111195.08) < 0.01, "haversine");
  CHECK(slack_coefficients(3) == (std::vector<std::size_t>{1, 2}), "slack(3)");
  for (const char* n : {"default", "all9-r400", "six-b2-r250", "twelve-b4-hubs"}) {
    auto fx = load_fixture(dir + "/" + n + ".txt");
    const auto& p = fx.problem;
    auto& e = fx.expect;
    for (const auto& [i, l] : fx.cover) CHECK(p.cover[i] == l, std::format("{} cover {}", n, i));
    const auto bf = p.brute_force();
    CHECK(bf.weight == std::stod(e["bf_weight"][0]), n);
    CHECK(join(bf.stations) == join(e["bf_stations"]), n);
    CHECK(std::to_string(bf.evaluated) == e["bf_evaluated"][0], n);
    CHECK(p.evaluate(bf.stations) == bf.weight, n);
    const auto [gs, gw] = p.greedy();
    CHECK(gw == std::stod(e["greedy_weight"][0]) && join(gs) == join(e["greedy_stations"]), n);
    const auto q = p.build_qubo();
    CHECK(std::format("{} {} {}", q.n, q.n_slack, q.aux.size()) == join(e["qubo_n"]), std::format("{} qubo_n {}", n, q.n));
    CHECK(q.lambda == std::stod(e["qubo_lambda"][0]) && q.m == std::stod(e["qubo_M"][0]), n);
    CHECK(std::abs(q.offset - std::stod(e["qubo_offset"][0])) < 1e-9, n);
    for (std::size_t i = 0; i < q.n; ++i) CHECK(std::abs(q.linear[i] - std::stod(e["qubo_linear"][i])) < 1e-9, n);
    CHECK(q.quad.size() == fx.quad.size(), n);
    std::size_t k = 0;
    for (const auto& [uv, c] : q.quad) {
      if (k >= fx.quad.size()) break;
      const auto& [u, v, ec] = fx.quad[k++];
      CHECK(uv.first == u && uv.second == v && std::abs(c - ec) < 1e-9, n);
    }
    CHECK(q.aux == fx.aux, n);
    const auto en = q.energies();
    CHECK(std::abs(*std::ranges::min_element(en) + bf.weight) < 1e-9, n);
    CHECK(std::abs(std::get<2>(q.ising()) - std::stod(e["ising_constant"][0])) < 1e-8, n);
    auto& pr = e["qaoa_params"];
    const auto [exp, width] = q.qaoa_expectation({std::stod(pr[0]), std::stod(pr[1])}, {std::stod(pr[2]), std::stod(pr[3])});
    CHECK(std::abs(exp - std::stod(e["qaoa_expectation"][0])) < 1e-9, std::format("{} qaoa {}", n, exp));
  }
  std::cout << (failures ? "FAILED " : "OK ") << failures << " Fehler\n";
  return failures ? 1 : 0;
}
