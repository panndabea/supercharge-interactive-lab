package supercharge

import (
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

var names = []string{"default", "all9-r400", "six-b2-r250", "twelve-b4-hubs"}

func fixtures(t *testing.T) []*Fixture {
	out := []*Fixture{}
	for _, n := range names {
		f, err := LoadFixture(filepath.Join("..", "..", "fixtures", n+".txt"))
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, f)
	}
	return out
}

func num(t *testing.T, s string) float64 {
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func ints(v []string) string { return strings.Join(v, " ") }
func fmtInts(v []int) string {
	s := []string{}
	for _, x := range v {
		s = append(s, strconv.Itoa(x))
	}
	return strings.Join(s, " ")
}

func TestRng(t *testing.T) {
	b, _ := os.ReadFile(filepath.Join("..", "..", "fixtures", "rng.txt"))
	v := strings.Fields(string(b))
	seed, _ := strconv.Atoi(v[1])
	r := Mulberry32(uint32(seed))
	for _, s := range v[2:] {
		if got := r(); got != num(t, s) {
			t.Fatalf("rng %v != %s", got, s)
		}
	}
}

func TestHaversine(t *testing.T) {
	if d := Haversine(0, 0, 0, 1); math.Abs(d-111195.08) > 0.01 {
		t.Fatal(d)
	}
}

func TestConformance(t *testing.T) {
	for _, f := range fixtures(t) {
		p := f.Problem
		for i, l := range f.Cover {
			if fmtInts(p.Cover[i]) != fmtInts(l) {
				t.Fatalf("%s cover %d", f.Name, i)
			}
		}
		st, w, ev := p.BruteForce()
		if w != num(t, f.Expect["bf_weight"][0]) || fmtInts(st) != ints(f.Expect["bf_stations"]) || strconv.Itoa(ev) != f.Expect["bf_evaluated"][0] {
			t.Fatalf("%s brute force %v %v %v", f.Name, st, w, ev)
		}
		if p.Evaluate(st) != w {
			t.Fatal("evaluate mismatch")
		}
		gs, gw := p.Greedy()
		if gw != num(t, f.Expect["greedy_weight"][0]) || fmtInts(gs) != ints(f.Expect["greedy_stations"]) {
			t.Fatalf("%s greedy", f.Name)
		}
		q := p.BuildQubo()
		if strconv.Itoa(q.NVars)+" "+strconv.Itoa(q.NSlack)+" "+strconv.Itoa(len(q.Aux)) != ints(f.Expect["qubo_n"]) {
			t.Fatalf("%s qubo size %d", f.Name, q.NVars)
		}
		if q.Lambda != num(t, f.Expect["qubo_lambda"][0]) || q.M != num(t, f.Expect["qubo_M"][0]) || math.Abs(q.Offset-num(t, f.Expect["qubo_offset"][0])) > 1e-9 {
			t.Fatalf("%s penalties", f.Name)
		}
		for i, s := range f.Expect["qubo_linear"] {
			if math.Abs(q.Linear[i]-num(t, s)) > 1e-9 {
				t.Fatalf("%s linear %d", f.Name, i)
			}
		}
		sq := q.SortedQuad()
		if len(sq) != len(f.Quad) {
			t.Fatalf("%s quad count %d vs %d", f.Name, len(sq), len(f.Quad))
		}
		for k := range sq {
			if sq[k][0] != f.Quad[k][0] || sq[k][1] != f.Quad[k][1] || math.Abs(sq[k][2]-f.Quad[k][2]) > 1e-9 {
				t.Fatalf("%s quad %d", f.Name, k)
			}
		}
		for k, a := range q.Aux {
			if a != f.Aux[k] {
				t.Fatalf("%s aux", f.Name)
			}
		}
		E := q.Energies()
		minE := math.Inf(1)
		for _, e := range E {
			minE = math.Min(minE, e)
		}
		if math.Abs(minE+w) > 1e-9 {
			t.Fatalf("%s QUBO min %v != -%v", f.Name, minE, w)
		}
		_, _, c := q.Ising()
		if math.Abs(c-num(t, f.Expect["ising_constant"][0])) > 1e-8 {
			t.Fatalf("%s ising", f.Name)
		}
		pr := f.Expect["qaoa_params"]
		exp, _ := q.QaoaExpectation([]float64{num(t, pr[0]), num(t, pr[1])}, []float64{num(t, pr[2]), num(t, pr[3])})
		if math.Abs(exp-num(t, f.Expect["qaoa_expectation"][0])) > 1e-9 {
			t.Fatalf("%s qaoa %v", f.Name, exp)
		}
	}
}
