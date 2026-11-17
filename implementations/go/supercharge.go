// Package supercharge: maximum coverage, exact QUBO and QAOA statevector simulation.
// Mirrors website/js/math/*.js (same orders, tie-breaking and quadratization).
package supercharge

import (
	"bufio"
	"fmt"
	"math"
	"math/cmplx"
	"os"
	"sort"
	"strconv"
	"strings"
)

const EarthRadiusM = 6371008.8
const eps = 1e-9

func rad(d float64) float64 { return d * math.Pi / 180 }

// Haversine distance in metres on a sphere of radius EarthRadiusM.
func Haversine(lat1, lon1, lat2, lon2 float64) float64 {
	p1, p2 := rad(lat1), rad(lat2)
	dp, dl := p2-p1, rad(lon2-lon1)
	a := math.Pow(math.Sin(dp/2), 2) + math.Cos(p1)*math.Cos(p2)*math.Pow(math.Sin(dl/2), 2)
	return 2 * EarthRadiusM * math.Asin(math.Min(1, math.Sqrt(a)))
}

// Mulberry32 returns a seeded uniform generator in [0, 1).
func Mulberry32(seed uint32) func() float64 {
	a := seed
	return func() float64 {
		a += 0x6d2b79f5
		t := a
		t = (t ^ (t >> 15)) * (t | 1)
		t ^= t + (t^(t>>7))*(t|61)
		return float64(t^(t>>14)) / 4294967296
	}
}

type Point struct{ Lat, Lon float64 }

type Problem struct {
	Candidates []Point
	Zones      []Point
	Weights    []float64
	Radius     float64
	Budget     int
	Cover      [][]int
	CoveredBy  [][]int
}

func NewProblem(c, z []Point, w []float64, radius float64, budget int) *Problem {
	p := &Problem{Candidates: c, Zones: z, Weights: w, Radius: radius, Budget: budget}
	p.Cover = make([][]int, len(c))
	p.CoveredBy = make([][]int, len(z))
	for i, ci := range c {
		p.Cover[i] = []int{}
		for j, zj := range z {
			if Haversine(ci.Lat, ci.Lon, zj.Lat, zj.Lon) <= radius {
				p.Cover[i] = append(p.Cover[i], j)
				p.CoveredBy[j] = append(p.CoveredBy[j], i)
			}
		}
	}
	return p
}

func (p *Problem) N() int { return len(p.Candidates) }

// Evaluate returns the covered weight; a zone counts once however often it is covered.
func (p *Problem) Evaluate(stations []int) float64 {
	seen := make([]bool, len(p.Zones))
	w := 0.0
	for _, i := range stations {
		for _, j := range p.Cover[i] {
			if !seen[j] {
				seen[j] = true
				w += p.Weights[j]
			}
		}
	}
	return w
}

// BruteForce enumerates every subset with |S| <= B depth-first in lexicographic order.
func (p *Problem) BruteForce() (best []int, bestW float64, evaluated int) {
	K := p.Budget
	if p.N() < K {
		K = p.N()
	}
	bestW, bestK := -1.0, math.MaxInt
	hits := make([]int, len(p.Zones))
	stack := []int{}
	w := 0.0
	var rec func(start int)
	rec = func(start int) {
		evaluated++
		if w > bestW+eps || (math.Abs(w-bestW) <= eps && len(stack) < bestK) {
			bestW, bestK = w, len(stack)
			best = append([]int{}, stack...)
		}
		if len(stack) == K {
			return
		}
		for i := start; i < p.N(); i++ {
			for _, j := range p.Cover[i] {
				if hits[j] == 0 {
					w += p.Weights[j]
				}
				hits[j]++
			}
			stack = append(stack, i)
			rec(i + 1)
			stack = stack[:len(stack)-1]
			for _, j := range p.Cover[i] {
				hits[j]--
				if hits[j] == 0 {
					w -= p.Weights[j]
				}
			}
		}
	}
	rec(0)
	return
}

// Greedy adds the largest marginal gain (lowest index on ties) until B stations.
func (p *Problem) Greedy() ([]int, float64) {
	covered := make([]bool, len(p.Zones))
	in := make([]bool, p.N())
	sel := []int{}
	total := 0.0
	for len(sel) < p.Budget && len(sel) < p.N() {
		bi, bg := -1, 0.0
		for i := 0; i < p.N(); i++ {
			if in[i] {
				continue
			}
			g := 0.0
			for _, j := range p.Cover[i] {
				if !covered[j] {
					g += p.Weights[j]
				}
			}
			if g > bg+eps {
				bi, bg = i, g
			}
		}
		if bi < 0 {
			break
		}
		in[bi] = true
		sel = append(sel, bi)
		for _, j := range p.Cover[bi] {
			covered[j] = true
		}
		total += bg
	}
	sort.Ints(sel)
	return sel, total
}

type Aux struct{ Index, A, B int }

type Qubo struct {
	N, NSlack, NVars int
	Slack            []int
	Aux              []Aux
	Linear           []float64
	Quad             map[[2]int]float64
	Offset, Lambda   float64
	M                float64
}

func SlackCoefficients(B int) []int {
	if B <= 0 {
		return nil
	}
	m := int(math.Floor(math.Log2(float64(B)))) + 1
	c := []int{}
	for k := 0; k < m-1; k++ {
		c = append(c, 1<<k)
	}
	return append(c, B-((1<<(m-1))-1))
}

func key(v []int) string {
	s := make([]string, len(v))
	for i, x := range v {
		s[i] = strconv.Itoa(x)
	}
	return strings.Join(s, ",")
}

type mono struct {
	vars []int
	coef float64
}

// BuildQubo builds the exact QUBO (inclusion-exclusion, Rosenberg reduction, budget slack).
func (p *Problem) BuildQubo() *Qubo {
	N, B := p.N(), p.Budget
	groupW := map[string]float64{}
	groupV := map[string][]int{}
	order := []string{}
	for j, C := range p.CoveredBy {
		if len(C) == 0 || p.Weights[j] == 0 {
			continue
		}
		k := key(C)
		if _, ok := groupW[k]; !ok {
			order = append(order, k)
			groupV[k] = C
		}
		groupW[k] += p.Weights[j]
	}
	poly := map[string]*mono{}
	porder := []string{}
	for _, k := range order {
		C, wt := groupV[k], groupW[k]
		for mask := 1; mask < 1<<len(C); mask++ {
			vars := []int{}
			for b := range C {
				if mask>>b&1 == 1 {
					vars = append(vars, C[b])
				}
			}
			c := wt
			if len(vars)%2 == 1 {
				c = -wt
			}
			kk := key(vars)
			if m, ok := poly[kk]; ok {
				m.coef += c
			} else {
				poly[kk] = &mono{vars, c}
				porder = append(porder, kk)
			}
		}
	}
	monos := []*mono{}
	high := 0.0
	for _, k := range porder {
		m := poly[k]
		if math.Abs(m.coef) < 1e-12 {
			continue
		}
		monos = append(monos, m)
		if len(m.vars) >= 3 {
			high += math.Abs(m.coef)
		}
	}
	type tmpAux struct{ z, a, b int }
	tmp := []tmpAux{}
	for {
		counts := map[[2]int]int{}
		for _, m := range monos {
			if len(m.vars) < 3 {
				continue
			}
			for a := 0; a < len(m.vars); a++ {
				for b := a + 1; b < len(m.vars); b++ {
					counts[[2]int{m.vars[a], m.vars[b]}]++
				}
			}
		}
		if len(counts) == 0 {
			break
		}
		var best [2]int
		bc := -1
		for k, c := range counts {
			if c > bc || (c == bc && (k[0] < best[0] || (k[0] == best[0] && k[1] < best[1]))) {
				best, bc = k, c
			}
		}
		z := 1000 + len(tmp)
		tmp = append(tmp, tmpAux{z, best[0], best[1]})
		for _, m := range monos {
			if len(m.vars) < 3 || !contains(m.vars, best[0]) || !contains(m.vars, best[1]) {
				continue
			}
			nv := []int{}
			for _, v := range m.vars {
				if v != best[0] && v != best[1] {
					nv = append(nv, v)
				}
			}
			nv = append(nv, z)
			sort.Ints(nv)
			m.vars = nv
		}
	}
	slack := SlackCoefficients(B)
	need := B < N
	ns := 0
	if need {
		ns = len(slack)
	} else {
		slack = nil
	}
	remap := map[int]int{}
	for i := 0; i < N; i++ {
		remap[i] = i
	}
	for k, t := range tmp {
		remap[t.z] = N + ns + k
	}
	n := N + ns + len(tmp)
	q := &Qubo{N: N, NSlack: ns, NVars: n, Slack: slack, Linear: make([]float64, n), Quad: map[[2]int]float64{}}
	for _, t := range tmp {
		q.Aux = append(q.Aux, Aux{remap[t.z], remap[t.a], remap[t.b]})
	}
	add := func(vars []int, c float64) {
		if c == 0 {
			return
		}
		v := []int{}
		for _, x := range vars {
			if r, ok := remap[x]; ok {
				v = append(v, r)
			} else {
				v = append(v, x)
			}
		}
		sort.Ints(v)
		switch {
		case len(v) == 0:
			q.Offset += c
		case len(v) == 1 || v[0] == v[1]:
			q.Linear[v[0]] += c
		default:
			q.Quad[[2]int{v[0], v[1]}] += c
		}
	}
	for _, m := range monos {
		add(m.vars, m.coef)
	}
	maxW := 0.0
	for _, l := range p.Cover {
		s := 0.0
		for _, j := range l {
			s += p.Weights[j]
		}
		maxW = math.Max(maxW, s)
	}
	q.Lambda = 1 + maxW
	if need {
		type ta struct{ v, a int }
		terms := []ta{}
		for i := 0; i < N; i++ {
			terms = append(terms, ta{i, 1})
		}
		for k := 0; k < ns; k++ {
			terms = append(terms, ta{N + k, slack[k]})
		}
		for _, t := range terms {
			add([]int{t.v}, q.Lambda*float64(t.a*t.a-2*B*t.a))
		}
		for x := 0; x < len(terms); x++ {
			for y := x + 1; y < len(terms); y++ {
				add([]int{terms[x].v, terms[y].v}, q.Lambda*2*float64(terms[x].a*terms[y].a))
			}
		}
		add(nil, q.Lambda*float64(B*B))
	}
	q.M = 1 + high
	for _, t := range q.Aux {
		add([]int{t.A, t.B}, q.M)
		add([]int{t.A, t.Index}, -2*q.M)
		add([]int{t.B, t.Index}, -2*q.M)
		add([]int{t.Index}, 3*q.M)
	}
	for k, v := range q.Quad {
		if math.Abs(v) < 1e-12 {
			delete(q.Quad, k)
		}
	}
	return q
}

func contains(s []int, x int) bool {
	for _, v := range s {
		if v == x {
			return true
		}
	}
	return false
}

// SortedQuad returns quadratic terms ordered by (u, v).
func (q *Qubo) SortedQuad() [][3]float64 {
	out := [][3]float64{}
	for k, c := range q.Quad {
		out = append(out, [3]float64{float64(k[0]), float64(k[1]), c})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i][0] != out[j][0] {
			return out[i][0] < out[j][0]
		}
		return out[i][1] < out[j][1]
	})
	return out
}

// Energies of every basis state; bit k of the index is variable k.
func (q *Qubo) Energies() []float64 {
	E := make([]float64, 1<<q.NVars)
	quad := q.SortedQuad()
	for idx := range E {
		e := q.Offset
		for k := 0; k < q.NVars; k++ {
			if idx>>k&1 == 1 {
				e += q.Linear[k]
			}
		}
		for _, t := range quad {
			if idx>>int(t[0])&1 == 1 && idx>>int(t[1])&1 == 1 {
				e += t[2]
			}
		}
		E[idx] = e
	}
	return E
}

// Ising returns h, J and the constant with x_i = (1 - Z_i)/2.
func (q *Qubo) Ising() (h []float64, J [][3]float64, c float64) {
	h = make([]float64, q.NVars)
	c = q.Offset
	for i := 0; i < q.NVars; i++ {
		c += q.Linear[i] / 2
		h[i] -= q.Linear[i] / 2
	}
	for _, t := range q.SortedQuad() {
		c += t[2] / 4
		h[int(t[0])] -= t[2] / 4
		h[int(t[1])] -= t[2] / 4
		J = append(J, [3]float64{t[0], t[1], t[2] / 4})
	}
	return
}

// QaoaExpectation simulates |γ,β> exactly and returns <H_C> with H_C = E / (Emax - Emin).
func (q *Qubo) QaoaExpectation(gammas, betas []float64) (exp, width float64) {
	E := q.Energies()
	lo, hi := math.Inf(1), math.Inf(-1)
	for _, e := range E {
		lo, hi = math.Min(lo, e), math.Max(hi, e)
	}
	width = hi - lo
	if width == 0 {
		width = 1
	}
	size := len(E)
	psi := make([]complex128, size)
	amp := complex(1/math.Sqrt(float64(size)), 0)
	for k := range psi {
		psi[k] = amp
	}
	for l := range gammas {
		for k := range psi {
			psi[k] *= cmplx.Exp(complex(0, -gammas[l]*E[k]/width))
		}
		c, s := complex(math.Cos(betas[l]), 0), complex(0, -math.Sin(betas[l]))
		for qb := 0; qb < q.NVars; qb++ {
			bit := 1 << qb
			for k := 0; k < size; k++ {
				if k&bit != 0 {
					continue
				}
				a, b := psi[k], psi[k|bit]
				psi[k], psi[k|bit] = c*a+s*b, s*a+c*b
			}
		}
	}
	for k := range psi {
		exp += (real(psi[k])*real(psi[k]) + imag(psi[k])*imag(psi[k])) * E[k] / width
	}
	return
}

// Fixture is a parsed fixtures/*.txt file.
type Fixture struct {
	Name    string
	Problem *Problem
	Expect  map[string][]string
	Cover   map[int][]int
	Quad    [][3]float64
	Aux     []Aux
}

func LoadFixture(path string) (*Fixture, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<24)
	lines := []string{}
	for sc.Scan() {
		lines = append(lines, sc.Text())
	}
	pos := 0
	next := func() []string { pos++; return strings.Fields(lines[pos-1]) }
	atof := func(s string) float64 { v, _ := strconv.ParseFloat(s, 64); return v }
	atoi := func(s string) int { v, _ := strconv.Atoi(s); return v }
	fx := &Fixture{Expect: map[string][]string{}, Cover: map[int][]int{}}
	fx.Name = next()[1]
	radius := atof(next()[1])
	budget := atoi(next()[1])
	nc := atoi(next()[1])
	cands := make([]Point, nc)
	for i := range cands {
		v := next()
		cands[i] = Point{atof(v[0]), atof(v[1])}
	}
	nz := atoi(next()[1])
	zones := make([]Point, nz)
	w := make([]float64, nz)
	for j := range zones {
		v := next()
		zones[j], w[j] = Point{atof(v[0]), atof(v[1])}, atof(v[2])
	}
	for pos < len(lines) {
		v := next()
		if len(v) == 0 || v[0] == "end" {
			break
		}
		switch v[0] {
		case "cover":
			l := []int{}
			for _, x := range v[2:] {
				l = append(l, atoi(x))
			}
			fx.Cover[atoi(v[1])] = l
		case "qubo_quad":
			fx.Quad = append(fx.Quad, [3]float64{atof(v[1]), atof(v[2]), atof(v[3])})
		case "qubo_aux":
			fx.Aux = append(fx.Aux, Aux{atoi(v[1]), atoi(v[2]), atoi(v[3])})
		default:
			fx.Expect[v[0]] = v[1:]
		}
	}
	if len(cands) == 0 {
		return nil, fmt.Errorf("leere Fixture %s", path)
	}
	fx.Problem = NewProblem(cands, zones, w, radius, budget)
	return fx, nil
}
