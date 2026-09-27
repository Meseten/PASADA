# Algorithm Evaluation — Why PASADA Clusters with KMeans

*Status: evaluation complete; KMeans retained. All 16 algorithms below were executed
and measured on the same production input (19 routes, density = fleet / (population ×
road_km) × 1000, standardized). Nothing was rejected on theory alone. Regenerate the
evidence any time: `python make_exhibitD.py` (repo root) →
`validation_exhibits/exhibitD_algorithm_comparison.png` + `exhibitD_justification.md`.*

## 1. The decision context

The ML engine (`backend/ml_engine.py`) turns one number per route — **density** — into
a 3-tier LGU decision: GREEN (accept franchises) / YELLOW (watch) / RED (freeze).
Any replacement algorithm must therefore satisfy five hard requirements:

1. **Exactly k = 3 groups** — k is a policy input (the LGU's 3-action menu), not a
   property the algorithm may choose.
2. **Full partition** — every route gets exactly one tier. A "noise" route is a route
   the LGU cannot rule on.
3. **Deterministic & reproducible** — the same DB state must always yield the same
   tiers (audits, LAN sync, re-runs).
4. **One interpretable feature** — density; a clerk can recompute it by hand.
5. **Small-n safe** — 19 routes; no big-data or graph assumptions.

## 2. Measured results

| Algorithm | Silhouette ↑ | ARI vs KMeans | k found | noise | RED trio | Verdict |
|---|---:|---:|---:|---:|---|---|
| **KMeans (k=3)** | **0.725** | 1.000 | 3 | 0 | ✓ | **retained** |
| Hierarchical — Ward | 0.725 | 1.000 | 3 | 0 | ✓ | identical |
| Hierarchical — average | 0.725 | 1.000 | 3 | 0 | ✓ | identical |
| Hierarchical — complete | 0.725 | 1.000 | 3 | 0 | ✓ | identical |
| K-Medoids (PAM) | 0.725 | 1.000 | 3 | 0 | ✓ | identical |
| K-Medians | 0.725 | 1.000 | 3 | 0 | ✓ | identical (with fair restarts) |
| BIRCH (k=3) | 0.725 | 1.000 | 3 | 0 | ✓ | identical |
| Spectral (k=3) | 0.725 | 1.000 | 3 | 0 | ✓ | identical |
| Mean-Shift | 0.668 | 0.976 | 4 | 0 | ✗ | chooses k=4 |
| GMM — full | 0.652 | 0.677 | 3 | 0 | ✓ | worse; blurs tiers |
| GMM — diagonal | 0.652 | 0.677 | 3 | 0 | ✓ | worse; blurs tiers |
| Affinity Propagation | 0.571 | 0.604 | 5 | 0 | ✗ | chooses k=5 |
| HDBSCAN | 0.522 | 0.240 | 3 | 5 | ✓ | 5 routes get NO tier |
| OPTICS | 0.206 | 0.164 | 3 | 9 | ✓ | 9 routes get NO tier |
| DBSCAN | n/a | 0.370 | 1 | 8 | ✗ | merges all; 8 noise |
| Bayesian GMM (auto-k) | 0.772 | 0.782 | 2 | 0 | ✗ | highest score, wrong k=2 |

(ARI = Adjusted Rand Index: 1.000 = identical partition to KMeans. RED trio =
HMTODA, BBSTODA, BATODA under every qualifying algorithm.)

**Eight algorithms produce the identical partition.** The production choice is
therefore not "which algorithm finds different groups" — none that qualify do — but
"which qualifying algorithm is simplest, fastest, most explainable." That is KMeans.

## 3. Why the highest-scoring algorithm is NOT used

Bayesian GMM's 0.772 silhouette is the best number on the board — and it is unusable:
it reached that score by choosing **k=2**, merging YELLOW into GREEN and leaving the
policy with two actions. Quality scores are only comparable at the same k; the
requirement set selects the candidate pool, and quality ranks within it. This is the
prepared answer for "did you find anything with a higher score?"

## 4. The restart lesson (engineering note)

During evaluation, a naive single-start K-Medians implementation found a **worse local
optimum** (silhouette 0.370, wrong membership). Given the same courtesy KMeans enjoys
— multiple restarts — it reproduces the identical partition. Consequences already
baked into the production pipeline:

- `ml_engine.py` pins `KMeans(n_init=10)` — ten restarts, best inertia kept.
- The validation suite ran a **100-seed stability sweep**: 100/100 identical
  partitions (`validation_exhibits/exhibitB_seed_stability.png`).

Any future algorithm work must budget restarts the same way; single-run comparisons
are unreliable at n=19.

## 5. Supporting evidence (same validation suite)

- **Elbow + silhouette (Exhibit A):** elbow at k=3; silhouette k=2 → 0.772 vs k=3 →
  0.725 — k=3 retained per policy at negligible quality cost.
- **Seed stability (Exhibit B):** 100 seeds → 100 identical partitions.
- **Sensitivity (Exhibit C):** tiers invariant under 2024-growth scaling,
  public-roads-only km, leave-one-route-out, and winsorization (ARI 1.000 each).
- **Descriptive profile clustering (Exhibit E, `cluster_profiles.py`):** a second
  clustering on four NEW data points (trikes/km, trikes/1k-residents, road km, areas
  served) separates COMPACT vs SPREAD route shapes; all RED/YELLOW routes are COMPACT,
  13/14 GREEN are SPREAD. Corroboration, not a decision input.
- **Route Atlas (Exhibit F, `make_atlasF.py`):** six annotated views of all routes,
  including fleet-vs-density (r = −0.34 — fullness is a market property, not a fleet
  property) and iso-density contours that visualize the formula itself.

## 6. What would change this decision

Honest triggers for re-evaluation (documented in the roadmap):

1. Route count grows by an order of magnitude (re-run the bake-off; k may merit
   re-validation against policy).
2. Additional genuine features become available (planning-office demand data) —
   re-test whether multi-feature clustering adds decision value at acceptable
   explainability cost.
3. The LGU policy moves away from exactly 3 actions — then self-counting-k algorithms
   (or k≠3) enter the qualifying pool and the scoreboard must be re-run.

Until then: **KMeans stays.** Eight algorithms agree with it; none qualifies better.

---
*Full plain-language explanations, jargon glossary, and Q&As: `CLUSTERING_USES_AND_GLOSSARY.md`
(repo root) and `DEFENSE_BIBLE_500.md` §3. Figure: `validation_exhibits/exhibitD_algorithm_comparison.png`.*
