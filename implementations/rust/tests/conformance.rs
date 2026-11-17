use supercharge::*;

const NAMES: [&str; 4] = ["default", "all9-r400", "six-b2-r250", "twelve-b4-hubs"];
fn path(n: &str) -> String {
    format!("{}/../../fixtures/{}.txt", env!("CARGO_MANIFEST_DIR"), n)
}
fn num(v: &[String]) -> f64 {
    v[0].parse().unwrap()
}
fn join<T: ToString>(v: &[T]) -> String {
    v.iter()
        .map(|x| x.to_string())
        .collect::<Vec<_>>()
        .join(" ")
}

#[test]
fn rng_matches_fixture() {
    let t = std::fs::read_to_string(format!(
        "{}/../../fixtures/rng.txt",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();
    let v: Vec<&str> = t.split_whitespace().collect();
    let mut r = Mulberry32::new(v[1].parse().unwrap());
    for s in &v[2..] {
        assert_eq!(r.next_f64(), s.parse::<f64>().unwrap());
    }
}

#[test]
fn haversine_known() {
    assert!((haversine(0.0, 0.0, 0.0, 1.0) - 111195.08).abs() < 0.01);
}

#[test]
fn conformance() {
    for n in NAMES {
        let fx = load_fixture(&path(n)).unwrap();
        let p = &fx.problem;
        let e = &fx.expect;
        for (i, l) in &fx.cover {
            assert_eq!(&p.cover[*i], l, "{n} cover {i}");
        }
        let (st, w, ev) = p.brute_force();
        assert_eq!(w, num(&e["bf_weight"]), "{n}");
        assert_eq!(join(&st), e["bf_stations"].join(" "));
        assert_eq!(ev.to_string(), e["bf_evaluated"][0]);
        assert_eq!(p.evaluate(&st), w);
        let (gs, gw) = p.greedy();
        assert_eq!(gw, num(&e["greedy_weight"]));
        assert_eq!(join(&gs), e["greedy_stations"].join(" "));
        let q = p.build_qubo();
        assert_eq!(
            format!("{} {} {}", q.n, q.n_slack, q.aux.len()),
            e["qubo_n"].join(" "),
            "{n}"
        );
        assert_eq!(q.lambda, num(&e["qubo_lambda"]));
        assert_eq!(q.m, num(&e["qubo_M"]));
        assert!((q.offset - num(&e["qubo_offset"])).abs() < 1e-9);
        for (i, s) in e["qubo_linear"].iter().enumerate() {
            assert!((q.linear[i] - s.parse::<f64>().unwrap()).abs() < 1e-9);
        }
        let got: Vec<_> = q.quad.iter().map(|(&(u, v), &c)| (u, v, c)).collect();
        assert_eq!(got.len(), fx.quad.len(), "{n} quad");
        for (a, b) in got.iter().zip(&fx.quad) {
            assert_eq!((a.0, a.1), (b.0, b.1));
            assert!((a.2 - b.2).abs() < 1e-9);
        }
        assert_eq!(q.aux, fx.aux);
        let en = q.energies();
        let min = en.iter().cloned().fold(f64::INFINITY, f64::min);
        assert!((min + w).abs() < 1e-9, "{n}: QUBO min {min} vs -{w}");
        assert!((q.ising().2 - num(&e["ising_constant"])).abs() < 1e-8);
        let pr: Vec<f64> = e["qaoa_params"]
            .iter()
            .map(|s| s.parse().unwrap())
            .collect();
        let (exp, _) = q.qaoa_expectation(&pr[0..2], &pr[2..4]);
        assert!(
            (exp - num(&e["qaoa_expectation"])).abs() < 1e-9,
            "{n}: qaoa {exp}"
        );
    }
}
