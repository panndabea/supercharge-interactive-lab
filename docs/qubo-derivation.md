# Herleitung des exakten QUBO

## 1. Ausgangsproblem

Variablen x_i ∈ {0,1} für die N aktiven Kandidaten (Reihenfolge = Pool-Reihenfolge). Für jede Zone j sei S_j = { i : d(i, j) ≤ r }.

    max f(x) = Σ_j w_j · y_j(x),   y_j(x) = 1 − Π_{i∈S_j} (1 − x_i),   u. d. N. Σ_i x_i ≤ B

## 2. Inklusion–Exklusion

    1 − Π_{i∈S}(1 − x_i) = Σ_{∅≠T⊆S} (−1)^{|T|+1} Π_{i∈T} x_i

Zonen mit identischem S_j werden zusammengefasst (Gewichte addiert). Das Polynom P(x) = Σ_j w_j y_j(x) ist exakt, aber vom Grad max |S_j|.

## 3. Reduktion auf Grad 2 (Rosenberg)

Ein Produkt x_a x_b wird durch eine Hilfsvariable z ersetzt; die Strafe

    M · (x_a x_b − 2 x_a z − 2 x_b z + 3 z)

ist 0 genau dann, wenn z = x_a x_b, sonst ≥ M. Paare werden greedy so gewählt, dass sie in möglichst vielen Monomen vom Grad ≥ 3 vorkommen. M = 1 + Summe der Beträge aller Koeffizienten, in denen eine Hilfsvariable vorkommt (Default `penaltyScale = 1`).

## 4. Budget

Σ x ≤ B wird zu Σ x + Σ_k c_k s_k = B mit Schlupfkoeffizienten 1, 2, 4, …, gekappt, sodass Σ c_k = B (z. B. B = 3 → 1, 2; B = 5 → 1, 2, 2). Damit sind genau die Schlupfwerte 0…B darstellbar. Ist B ≥ N, entfällt der Term. Strafe:

    λ · (Σ_i x_i + Σ_k c_k s_k − B)²,   λ = 1 + max_i Σ_{j∈C_i} w_j

## 5. Energie

    E(x, s, z) = −P̃(x, z) + λ(…)² + M · Σ Rosenberg-Terme

Für jede zulässige Platzierung mit konsistentem Schlupf und konsistenten Hilfsvariablen gilt E = −f(x); jede Verletzung kostet mindestens so viel, wie sie gewinnen kann, plus 1. Die Tests enumerieren alle 2^n Zustände (n ≤ 20) und prüfen: Minimum zulässig, E = −f auf allen konsistenten Zuständen, min E = −max f. Ein Negativtest zeigt, dass zu kleine Strafen (`penaltyScale = 0.05`) die Formulierung brechen.

## 6. Ising

x_k = (1 − Z_k)/2. Lineare Terme a·x → a/2 − (a/2)Z; quadratische q·x_u x_v → q/4 (1 − Z_u − Z_v + Z_u Z_v). Ergebnis: H = c + Σ h_k Z_k + Σ J_uv Z_u Z_v, Energie identisch für jeden Basiszustand.

## 7. QAOA

Normierung: Spektralbreite W = max E − min E (über alle Basiszustände). Zustand

    |γ, β⟩ = Π_l e^{−iβ_l Σ X} e^{−iγ_l H/W} H^{⊗n} |0⟩

Kosten-Layer = RZ(2γ h_k / W) pro Qubit und RZZ(2γ J_uv / W) pro Kopplung (globale Phase der Konstante entfällt); Mixer = RX(2β) pro Qubit. Basisindex-Bit k = Qubit k = Variable k (little-endian wie Qiskit). Die Optimierung minimiert ⟨H⟩/W; Samples werden unabhängig decodiert und mit der Coverage-Funktion bewertet.
