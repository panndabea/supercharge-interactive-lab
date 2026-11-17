// Command supercharge solves a fixture file: brute force, greedy, QUBO size.
package main

import (
	"fmt"
	"os"
	"time"

	sc "github.com/panndabea/supercharge-interactive-lab/implementations/go"
)

func main() {
	path := "../../fixtures/default.txt"
	if len(os.Args) > 1 {
		path = os.Args[1]
	}
	f, err := sc.LoadFixture(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	p := f.Problem
	t0 := time.Now()
	st, w, ev := p.BruteForce()
	fmt.Printf("Fixture %s: N=%d Zonen=%d B=%d r=%.0f m\n", f.Name, p.N(), len(p.Zones), p.Budget, p.Radius)
	fmt.Printf("Brute Force: Stationen %v, Gewicht %.0f, %d Teilmengen, %v (gemessen)\n", st, w, ev, time.Since(t0))
	gs, gw := p.Greedy()
	fmt.Printf("Greedy:      Stationen %v, Gewicht %.0f\n", gs, gw)
	q := p.BuildQubo()
	fmt.Printf("QUBO:        %d Variablen (%d Schlupf, %d Hilfs), λ=%.0f, M=%.0f\n", q.NVars, q.NSlack, len(q.Aux), q.Lambda, q.M)
}
