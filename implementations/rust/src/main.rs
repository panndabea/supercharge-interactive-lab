use std::time::Instant;
use supercharge::load_fixture;

fn main() {
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "../../fixtures/default.txt".into());
    let fx = load_fixture(&path).expect("Fixture lesen");
    let p = &fx.problem;
    let t0 = Instant::now();
    let (st, w, ev) = p.brute_force();
    println!(
        "Fixture {}: N={} Zonen={} B={} r={} m",
        fx.name,
        p.n(),
        p.zones.len(),
        p.budget,
        p.radius
    );
    println!(
        "Brute Force: Stationen {:?}, Gewicht {}, {} Teilmengen, {:?} (gemessen)",
        st,
        w,
        ev,
        t0.elapsed()
    );
    let (gs, gw) = p.greedy();
    println!("Greedy:      Stationen {:?}, Gewicht {}", gs, gw);
    let q = p.build_qubo();
    println!(
        "QUBO:        {} Variablen ({} Schlupf, {} Hilfs), λ={}, M={}",
        q.n,
        q.n_slack,
        q.aux.len(),
        q.lambda,
        q.m
    );
}
