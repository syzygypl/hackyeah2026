#!/usr/bin/env python3
"""Rój (swarm) Monte Carlo: N voters with accuracy p and pairwise error correlation rho.

Correlation model (simple, exact pairwise correlation rho, marginal accuracy p):
  with probability rho the item is a "shared blind spot": all voters copy ONE common draw
  (correct w.p. p); otherwise every voter draws independently (correct w.p. p).
  => P(voter correct) = p, corr(error_i, error_j) = rho.
Binary task (e.g. "is this an injection?" / "is this the right value?"), so wrong voters agree with each other.
That is the worst case for "agreement = truth"; with many possible wrong answers, wrong voters split.

Also simulates the AI Control Layer two-tier guard with illustrative (assumed) rates.
Stdlib only. Run:  python3 docs/research/swarm_sim.py
"""
import math
import random

TRIALS = 200_000
SEED = 2026


def draw(n, p, rho, rng):
    """One item: list of n booleans (True = voter correct)."""
    if rng.random() < rho:
        c = rng.random() < p
        return [c] * n
    return [rng.random() < p for _ in range(n)]


def simulate(n, p, rho, trials=TRIALS, seed=SEED):
    rng = random.Random(seed)
    maj_err = unan = unan_wrong = 0
    for _ in range(trials):
        v = draw(n, p, rho, rng)
        k = sum(v)
        if k <= n // 2:  # n odd: strict majority wrong
            maj_err += 1
        if k == n or k == 0:
            unan += 1
            if k == 0:
                unan_wrong += 1
    cov = unan / trials
    return {
        "maj_err": maj_err / trials,
        "coverage": cov,
        "abstain": 1 - cov,
        "risk_given_accept": unan_wrong / unan if unan else float("nan"),
    }


def analytic(n, p, rho):
    """Closed forms for the same mixture model."""
    ind_maj_err = sum(math.comb(n, k) * p**k * (1 - p) ** (n - k) for k in range(0, n // 2 + 1))
    maj_err = rho * (1 - p) + (1 - rho) * ind_maj_err
    p_all_wrong = rho * (1 - p) + (1 - rho) * (1 - p) ** n
    p_agree = rho + (1 - rho) * (p**n + (1 - p) ** n)
    return maj_err, p_agree, p_all_wrong / p_agree


def hoeffding(n, p):
    return math.exp(-2 * n * (p - 0.5) ** 2)


def table_condorcet():
    print("## 1. Independent voters (rho = 0): majority-vote error, exact vs Hoeffding bound")
    print("| p | N=1 | N=3 | N=5 | N=7 | Hoeffding N=5 |")
    print("|---|---|---|---|---|---|")
    for p in (0.7, 0.8, 0.9):
        cells = [f"{analytic(n, p, 0)[0]:.4f}" for n in (1, 3, 5, 7)]
        print(f"| {p} | " + " | ".join(cells) + f" | {hoeffding(5, p):.3f} |")
    print()


def table_correlated():
    print("## 2. Correlated voters: Monte Carlo (analytic in brackets), N = 3 and 5")
    print("| p | rho | N | N_eff | majority error | unanimity coverage | abstain rate | error when unanimous |")
    print("|---|---|---|---|---|---|---|---|")
    for p in (0.8, 0.9):
        for rho in (0.0, 0.2, 0.4, 0.6):
            for n in (3, 5):
                s = simulate(n, p, rho)
                a_err, a_cov, a_risk = analytic(n, p, rho)
                n_eff = n / (1 + (n - 1) * rho)
                print(f"| {p} | {rho} | {n} | {n_eff:.2f} | {s['maj_err']:.4f} ({a_err:.4f}) | "
                      f"{s['coverage']:.3f} ({a_cov:.3f}) | {s['abstain']:.3f} | "
                      f"{s['risk_given_accept']:.4f} ({a_risk:.4f}) |")
    print()


def guard_sim(trials=TRIALS, seed=SEED):
    """Two-tier guard. ALL rates below are ASSUMPTIONS for illustration, not measurements,
    except t1 (Qwen3Guard warm ~0.15 s, measured on the demo Mac) and the cold Granite load (10-20 s, measured)."""
    A = dict(
        base_rate=0.05,      # share of calls carrying an injection (agentic workload with untrusted tool output)
        high_risk=0.10,      # share of calls to high_risk_tools -> judge always runs
        r1=0.85, f1=0.03,    # prefilter recall / false-positive rate (Unsafe or Controversial)
        c1=0.40,             # share of prefilter positives that are "Controversial" (-> judge) rather than "Unsafe"
        r2=0.95, f2=0.04,    # judge recall / FPR (warm)
        rho=0.5,             # P(tiers share item difficulty); drives correlation of misses between tiers (HTML-comment-style evasions fool both)
        t1=0.15, t2=1.3,     # warm latency s: both MEASURED on the demo Macs (t2 = one Granite criterion, unethical_behavior)
    )
    rng = random.Random(seed)
    miss = attacks = fp = benign = esc = 0
    hr_att = hr_miss = 0
    lat = 0.0
    for _ in range(trials):
        attack = rng.random() < A["base_rate"]
        hr = rng.random() < A["high_risk"]
        if attack:
            attacks += 1
            if rng.random() < A["rho"]:      # shared blind spot: both tiers see the same item difficulty u
                u = rng.random()
                d1, d2 = u < A["r1"], u < A["r2"]
            else:
                d1 = rng.random() < A["r1"]
                d2 = rng.random() < A["r2"]
        else:
            benign += 1
            d1 = rng.random() < A["f1"]
            d2 = rng.random() < A["f2"]
        controversial = d1 and rng.random() < A["c1"]
        judge = hr or controversial
        lat += A["t1"] + (A["t2"] if judge else 0)
        esc += judge
        flagged = d1 or (judge and d2)       # score = max(heuristic, tiers) -> OR rule
        if attack and not flagged:
            miss += 1
        if attack and hr:
            hr_att += 1
            hr_miss += not flagged
        if not attack and flagged:
            fp += 1
    print("## 3. Two-tier guard (Qwen3Guard 0.6B -> Granite Guardian 8B), illustrative")
    print("| quantity | value |")
    print("|---|---|")
    print(f"| escalation rate to judge | {esc / trials:.3f} |")
    print(f"| miss rate on attacks (prefilter alone) | {1 - A['r1']:.3f} |")
    print(f"| miss rate on attacks (two-tier, rho={A['rho']}) | {miss / attacks:.3f} |")
    print(f"| miss rate on attacks against high-risk tools (judge always runs) | {hr_miss / hr_att:.3f} |")
    print(f"| false-positive rate on benign calls | {fp / benign:.3f} |")
    print(f"| expected latency per call (warm) | {lat / trials:.3f} s |")
    print(f"| latency if judge on every call | {A['t1'] + A['t2']:.2f} s |")
    print()


if __name__ == "__main__":
    print(f"trials per cell = {TRIALS}, seed = {SEED}\n")
    table_condorcet()
    table_correlated()
    guard_sim()
