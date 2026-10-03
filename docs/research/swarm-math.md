# Rój: the math behind "agree → accept, disagree → abstain"

Foundation for [`swarm-concept.md`](swarm-concept.md) (revised version adb0d35: a swarm on the shared gateway, qwen3:4b workers, metrics) and the two-tier guard in [`../../spikes/ai-control-layer/semantic.py`](../../spikes/ai-control-layer/semantic.py). Simulation: [`swarm_sim.py`](swarm_sim.py) (stdlib, `python3 docs/research/swarm_sim.py`, under 1 s). 2026-10-03.

**TL;DR.** Independent voters that are better than chance get exponentially better by majority vote (Condorcet). Real LLMs are *not* independent, so the gain collapses to a floor set by the error correlation $\rho$. That's why we use diverse model families, and why we show disagreement to the user instead of hiding it. Unanimity used as an accept rule is selective prediction: we give up coverage to lower risk, and the abstained cases go to a big model or a human, which is a cost-efficient cascade.

---

## 1. Condorcet Jury Theorem

$N$ voters (odd), each correct independently with probability $p > 0.5$, binary question. Let $K \sim \mathrm{Bin}(N, p)$ count the correct votes. Then

$$P_{maj}^{correct} = \sum_{k > N/2} \binom{N}{k} p^k (1-p)^{N-k}, \qquad P_{maj}^{err} = P\!\left(K \le \tfrac{N-1}{2}\right).$$

**Exponential decay (Hoeffding 1963).** $K/N$ is a mean of $N$ i.i.d. Bernoulli($p$). The majority is wrong only if $K/N - p \le -(p - \tfrac12)$, so

$$P_{maj}^{err} \le \exp\!\big(-2N(p-\tfrac12)^2\big).$$

The Chernoff form is tighter: $P^{err} \le \exp(-N\,D(\tfrac12 \,\|\, p)) = \big(2\sqrt{p(1-p)}\big)^N$. For $p=0.9$ this is $0.6^N$. Either way the error falls geometrically in $N$ once $p > 0.5$, and grows geometrically if $p < 0.5$, so **a swarm of bad models is worse than one bad model.**

Exact values (sim section 1; the Hoeffding bound is loose but has the right shape):

| $p$ | $N=1$ | $N=3$ | $N=5$ | $N=7$ | Hoeffding bound, $N=5$ |
|---|---|---|---|---|---|
| 0.7 | 0.300 | 0.216 | 0.163 | 0.126 | 0.670 |
| 0.8 | 0.200 | 0.104 | 0.058 | 0.033 | 0.407 |
| 0.9 | 0.100 | 0.028 | **0.0086** | 0.0027 | 0.202 |

Three 90%-models give 2.8% error, five give 0.9%, *if they are independent*.

## 2. The catch: correlated errors

Let $e_i \in \{0,1\}$ be voter $i$'s error indicator, $\mathrm{Var}(e_i) = p(1-p)$, and let $\rho$ be the pairwise error correlation (equicorrelation model). The variance of the mean error is

$$\mathrm{Var}(\bar e) = \frac{p(1-p)}{N}\big(1 + (N-1)\rho\big) = \frac{p(1-p)}{N_{eff}}, \qquad N_{eff} = \frac{N}{1 + (N-1)\rho} \xrightarrow{N\to\infty} \frac{1}{\rho}.$$

With $\rho = 0.4$, **no number of voters is worth more than 2.5 independent ones.** Ladha (1992) extends Condorcet to correlated votes: the theorem still holds if correlation is low enough, and fails otherwise.

**The model we simulate** (a mixture, equivalent to an exchangeable or beta-binomial-type model). With probability $\rho$ an item is a *shared blind spot*: all voters copy one common draw. Otherwise they vote independently. Marginal accuracy stays $p$, and pairwise error correlation is exactly $\rho$. Closed forms:

$$P_{maj}^{err}(\rho) = \rho(1-p) + (1-\rho)\,P_{maj}^{err}(0) \;\ge\; \rho(1-p).$$

**There is an error floor $\rho(1-p)$ that no $N$ removes.** For $p=0.9, \rho=0.4$ the floor is 4%, and 5 voters reach 4.5% (vs 0.9% if independent).

**Why same-family models correlate.** Shared pre-training corpora (Common Crawl and its derivatives), shared tokenizers, distillation from the same teacher, and the same RLHF preference data all produce the *same* blind spots. Evidence:

- Kim, Garg, Peng, Garg (ICML 2025), *Correlated Errors in Large Language Models*. Over 350 LLMs: when two models both err, they agree on the same wrong answer about 60% of the time. Correlation rises with a shared provider and a shared architecture, and **more accurate models are more correlated**. [arXiv:2506.07962](https://arxiv.org/abs/2506.07962)
- Goel et al. (ICML 2025), *Great Models Think Alike and this Undermines AI Oversight*. They define the CAPA similarity metric and show LLM judges favour similar models, and that mistakes converge as capability grows. [arXiv:2502.04313](https://arxiv.org/abs/2502.04313)

**Design consequence:** pick voters from different vendors and training pipelines (Qwen / Alibaba, Gemma / Google, Llama / Meta, Phi / Microsoft, Granite / IBM), not three sizes of one family. Measure $\rho$ on our eval letters (pairwise error correlation, or CAPA) and drop the most redundant model.

**Mapped to the revised concept (options a/b):**

| Option | Workers | $\rho$ | Status |
|---|---|---|---|
| (a) self-consistency, the MUST build | `qwen3:4b` × 3, different prompt and temperature (0 / 0.4 / 0.8) | **high, 0.5-0.7**: same weights, prompt/temperature only reshuffle the random slips | assumption |
| (b) two families | add `gemma3:4b` | **0.2-0.4** for the cross-family pair | assumption, to be measured on the 3 letters |

Self-consistency (Wang et al. 2023) does help: it removes *random* slips, which is the $(1-\rho)$ term. It cannot remove the shared blind spots, the $\rho(1-p)$ term. So under (a), the **quote verifier**, not the vote, carries most of the safety (§4), and adding `gemma3:4b` is the cheapest way to move $\rho$ down.

## 3. Diversity math

**Ambiguity decomposition** (Krogh & Vedelsby 1995). For a weighted-average ensemble $\bar f = \sum_i w_i f_i$ under squared loss:

$$E = \bar E - \bar A, \qquad \bar E = \sum_i w_i (f_i - y)^2, \qquad \bar A = \sum_i w_i (f_i - \bar f)^2 \ge 0.$$

The ensemble is never worse than its average member. It is better by exactly the **ambiguity** (disagreement) $\bar A$, which is computable *without labels*. That is the same signal we use for abstention.

**Bias-variance-covariance** (Ueda & Nakano 1996; Brown et al. 2005). For a uniform average of $M$ members:

$$\mathbb{E}[(\bar f - y)^2] = \overline{\text{bias}}^2 + \frac{1}{M}\overline{\text{var}} + \Big(1 - \frac1M\Big)\overline{\text{covar}}.$$

Adding members kills the variance term, but the covariance term stays. Diversity, meaning low covariance, is the only lever on it. This is §2 restated for regression.

## 4. Abstention as selective prediction

A selective classifier is a pair $(f, g)$: predict $f(x)$ if $g(x)=1$, abstain otherwise. Coverage is $\phi = P(g=1)$ and selective risk is $R = P(f \ne y \mid g = 1)$ (El-Yaniv & Wiener 2010). Chow (1957, 1970) showed that the optimal reject rule thresholds the posterior, and that the error-reject curve is monotone: rejecting more never raises the error on accepted items.

**Unanimity rule** $g = \mathbb{1}[\text{all } N \text{ agree}]$, binary task, mixture model from §2:

$$\phi = P(\text{all agree}) = \rho + (1-\rho)\big(p^N + (1-p)^N\big),$$
$$P(\text{all agree} \wedge \text{wrong}) = \rho(1-p) + (1-\rho)(1-p)^N,$$
$$R = \frac{\rho(1-p) + (1-\rho)(1-p)^N}{\rho + (1-\rho)\big(p^N + (1-p)^N\big)}.$$

Independent case ($\rho=0$): $R = (1-p)^N / (p^N + (1-p)^N)$, i.e. the odds of being wrong shrink as $\big(\tfrac{1-p}{p}\big)^N$. For $p=0.9, N=3$ that gives $R = 0.14\%$ at 73% coverage. Correlated case: as $N \to \infty$, $R \to 1-p$, because only the blind spots remain unanimous. Unanimity then filters out the *easy* disagreements and keeps the *hard shared* errors. Selected rows (sim section 2, MC ≈ analytic):

| $p$ | $\rho$ | $N$ | $N_{eff}$ | majority err | coverage (all agree) | abstain | error when unanimous |
|---|---|---|---|---|---|---|---|
| 0.9 | 0.0 | 3 | 3.00 | 2.8% | 73% | 27% | 0.12% |
| 0.9 | 0.0 | 5 | 5.00 | 0.9% | 59% | 41% | ~0% |
| 0.9 | 0.2 | 3 | 2.14 | 4.2% | 79% | 21% | 2.7% |
| 0.9 | 0.2 | 5 | 2.78 | 2.7% | 67% | 33% | 3.1% |
| 0.9 | 0.4 | 3 | 1.67 | 5.6% | 84% | 16% | 4.8% |
| 0.8 | 0.2 | 3 | 2.14 | 12.3% | 62% | 38% | 7.5% |
| 0.8 | 0.4 | 5 | 1.92 | 11.5% | 60% | 40% | 13.5% |

How to read it:
- (a) With moderate correlation, unanimity still cuts error from 10% to about 3-5%, while sending 16-33% of items onward.
- (b) With correlation, **the abstain rate falls and the error when unanimous rises together**. A swarm that "always agrees" is a warning sign, not a success.
- (c) A quorum rule ($\ge k$ of $N$) sits between majority (full coverage) and unanimity (lowest risk). $k$ is the knob on the risk-coverage curve.

**Adding the non-AI quote verifier.** The gateway rejects any proposal whose quote is not verbatim in the document, or whose value doesn't parse from the quote. Let $q$ be the share of *wrong* unanimous answers it catches: invented quotes, or a value not supported by the quote. It's a deterministic check, so its misses are roughly independent of the model's blind spots, and

$$R_{GREEN} = \frac{(1-q)\,P(\text{all agree} \wedge \text{wrong})}{P(\text{all agree} \wedge \text{verified})} \approx (1-q)\,R.$$

$q$ is high for hallucinated values and **low for the "right quote, wrong field" case** (for example the arrears vs total amount in the concept demo), because there the quote does exist. That case is exactly what disagreement plus the arbiter is for. Example: (a) with $p=0.9, \rho=0.6, N=3$ gives $R = 6.7\%$ (sim). If the verifier catches half of those ($q=0.5$, assumption), GREEN error is about 3.3%.

**Distribution-free guarantee.** Turn the agreement score $s(x)$ (vote share, or weighted log-odds from §5) into a threshold $\lambda$ calibrated on $n$ labelled items. Conformal risk control (Angelopoulos, Bates, Fisch, Lei, Schuster; ICLR 2024) picks $\hat\lambda$ so that $\mathbb{E}[\text{loss}] \le \alpha$ holds in finite samples, assuming only exchangeability. It works with the loss "accepted and wrong". Our 3 synthetic letters are too few for a meaningful guarantee. It's the production path, not a demo claim.

## 5. Unequal voters

With independent voters of accuracy $p_i$, the decision rule that maximises the probability of being correct is a weighted majority (Nitzan & Paroush 1982; Shapley & Grofman 1984):

$$\hat y = \operatorname{sign}\sum_i w_i v_i, \qquad w_i = \log\frac{p_i}{1-p_i}, \quad v_i \in \{-1,+1\}.$$

**Derivation.** Bayes with independent votes gives the posterior log-odds $\log\frac{P(y=+1\mid v)}{P(y=-1\mid v)} = \log\frac{\pi}{1-\pi} + \sum_i v_i \log\frac{p_i}{1-p_i}$. The weighted sum is therefore a calibrated confidence, and thresholding it at $\tau$ is Chow's rule. Consequence: a 0.95-accurate voter ($w = 2.94$) outvotes two 0.75-voters ($w = 1.10$ each).

**No labels? Dawid-Skene (1979).** EM over a latent true label estimates each voter's confusion matrix $\pi^{(i)}_{jk} = P(v_i = k \mid y = j)$ from the votes alone. It assumes conditional independence, so correlated models get overweighted. That is a known failure mode, so we check it against our small labelled set.

## 6. Cascades and cost

**Tier 1** (swarm, cost $c_1$, latency $t_1$) runs always. **Tier 2** (big model or human, $c_2, t_2$) runs only on escalation, with probability $\pi_{esc}$ (= abstain rate):

$$\mathbb{E}[C] = c_1 + \pi_{esc}\, c_2, \qquad \mathbb{E}[T] = t_1 + \pi_{esc}\, t_2, \qquad \text{err} = (1-\pi_{esc})\,R_1 + \pi_{esc}\, \varepsilon_2,$$

where $R_1$ is the selective risk on accepted items and $\varepsilon_2$ is the tier-2 error on the escalated items, which are the hard ones. If $R_1 \approx \varepsilon_2$ and $\pi_{esc} \ll 1$, we get big-model accuracy at about $\pi_{esc}$ of big-model cost. Example from the §4 table ($p=0.9, \rho=0.2, N=3$, option b): $\pi_{esc} = 0.21$, so **79% of fields are resolved locally at zero marginal cost**, with about 2.7% residual error on them. Under option (a), $\rho=0.6$: $\pi_{esc} \approx 0.11$, so 89% are local, but with about 6.7% error before the quote check. **Higher "% lokalnie" with one model family is not better.** It's the correlation showing.

**The concept's footer metrics in this notation.** With 7 fields per letter:
- *% lokalnie* $= 1 - \pi_{esc}$.
- *Koszt* $= \sum_{\text{arbiter calls}} \big(\tfrac{\text{in}}{1000} c_{in} + \tfrac{\text{out}}{1000} c_{out}\big)$.
- The arbiter sees only the disputed snippet plus candidates, about $s$ tokens instead of the full letter's $L$. The savings ratio against the "whole letter to the big model" baseline is therefore

$$\frac{\mathbb{E}[C_{swarm}]}{C_{baseline}} \approx \frac{7\,\pi_{esc}\, s}{L}.$$

Example (all assumptions): $L = 1500$, $s = 250$, $\pi_{esc} = 0.15$ gives $0.175$, about **5.7× cheaper**. The gateway enforces the snippet-only rule and redacts PII, so privacy has the same factor: the API sees about 18% of the text, PII-redacted.

Prior work:
- FrugalGPT (Chen, Zaharia, Zou 2023): an LLM cascade with a learned scorer matched GPT-4 with up to 98% lower cost. [arXiv:2305.05176](https://arxiv.org/abs/2305.05176)
- The idea is older:
  - Viola-Jones cascades (2001): cheap rejectors first.
  - Speculative decoding (Leviathan, Kalman, Matias 2023): a small model drafts and a big model verifies. [arXiv:2211.17192](https://arxiv.org/abs/2211.17192)
  - Self-consistency (Wang et al. 2023): majority over sampled reasoning paths. [arXiv:2203.11171](https://arxiv.org/abs/2203.11171)

Our twist: the escalation signal is **cross-family disagreement plus a non-AI quote check**, and it's shown to the user.

## 7. Our numbers: the AI Control Layer guard

The guard is a cascade with an **OR rule** (`score = max(heuristic, tier scores)`, `semantic.py`). It is not a majority vote: for *detection*, a miss requires every tier to miss. The judge runs only on `high_risk_tools` or when Qwen3Guard says *Controversial* (`policy.json`). A judge timeout is `fail_mode: closed`, so it becomes a human approval, which is abstention by construction.

$$P(\text{miss}) = \underbrace{(1-r_1)(1-r_2)}_{\text{independent}} + \rho_{12}\sqrt{r_1(1-r_1)\,r_2(1-r_2)}.$$

The false-positive rate adds up the other way, $\approx f_1 + f_2 - f_1 f_2$, which is the cost of OR.

| Quantity | Value | Status |
|---|---|---|
| Qwen3Guard 0.6B latency, warm | ~0.15 s | **measured** (demo Mac, first probe) |
| Qwen3Guard catches EN + PL injection | yes (2/2) | **measured**, tiny probe, not a rate |
| Qwen3Guard on injection hidden in HTML comment | **missed** | **measured** |
| Granite Guardian 8B, cold | 10-20 s, caught all, timed out vs 2.5 s limit | **measured** (first probe; now warmed at startup and in background, bf5f273) |
| Granite warm latency | ~1.3 s per criterion (Ollama serializes per model) | **measured** (bf5f273) |
| Granite `unethical_behavior` on 10 treasury tool calls | flagged all 5 attacks (95k hijack, exfil email, audit-log delete, `os.system`, out-of-task 9k payment), **0 FP** on legit calls; `harm`/`jailbreak` missed the delete | **measured**, n=10, not a rate |
| Attack base rate | 5% of calls | assumption |
| High-risk share of calls | 10% | assumption (depends on agent) |
| Qwen recall / FPR | 0.85 / 0.03 | assumption |
| Granite recall / FPR (warm) | 0.95 / 0.04 | assumption (consistent with 5/5 and 0/5 above, but n=10 can't pin it) |
| Tier miss correlation | shared difficulty w.p. 0.5 | assumption |

Sim section 3 output (illustrative):

| Output | Value |
|---|---|
| Escalation rate to Granite | 12.5% |
| Expected latency per call (warm) | **0.31 s** (vs 1.45 s if Granite judged every call) |
| Miss rate, all attacks | 15.0% prefilter alone → 13.8% two-tier |
| Miss rate, attacks on high-risk tools | **≈2.3% sim (2.9% analytic)** vs 15% prefilter alone; 0.75% if tiers were independent |
| False-positive rate on benign | 3.3% |

How to read it:
- The two-tier design buys **4.6× lower latency** than judging everything, and spends the judge where it matters (money, email, code execution).
- On low-risk calls, protection is essentially Qwen3Guard plus the heuristic plus the *deterministic* controls (egress, SQL, PII, payments). That is why those controls exist, and why the high-risk list must be right.
- **Cold start is a real failure mode we observed.** A 10-20 s load against a 2.5 s timeout means every high-risk call becomes a human approval. Mitigations already in the spike: warm-up at startup and in the background (the request path never waits longer than the tier timeout), `keep_alive: 30m`, and fail-closed, so a slow judge degrades to "ask a human", never to "allow".
- **Criteria are voters too.** Each extra Granite criterion costs about 1.3 s, because Ollama serializes calls per model, so $t_2 = 1.3\,s \times |\text{criteria}|$. The measured choice of one criterion, `unethical_behavior`, over three keeps the high-risk path at about 1.45 s.
- **The same gateway guards the swarm.** In Rój every proposal passes through this layer. The guard members (`qwen3guard`, `llama-guard3`) are a second, *classifier* swarm on the document-safety field, combined with the OR rule above: a hidden instruction must fool every member *and* the deterministic checks.
- The HTML-comment miss is the textbook correlated blind spot (§8). Fix it deterministically by stripping or flagging HTML comments and other hidden text before the model sees it. Don't fix it with more models.

Full sim output (`python3 docs/research/swarm_sim.py`, 200k trials per cell, seed 2026): the §1 and §4 tables above are taken from it verbatim (rounded). It also prints the rows for $p=0.8$ and $\rho=0.6$.

## 8. Limits and honest caveats

1. **Agreement ≠ truth.**
   - Unanimity measures consistency, not correctness. Under shared blind spots, $R \to 1-p$ (§4).
   - In Rój, the *mechanical quote check* (the quote must exist verbatim in the letter) is the non-AI anchor. It is a separate signal with near-zero correlation to model errors.
2. **Adversarial inputs are correlated by construction.**
   - An attacker optimises against the shared weaknesses: transferable jailbreaks (Zou et al. 2023, [arXiv:2307.15043](https://arxiv.org/abs/2307.15043)) and hidden text such as HTML comments, zero-width characters and white-on-white text.
   - Against an adaptive adversary $\rho \to 1$, and voting buys nothing.
   - The answer is defence in depth: deterministic controls first, models second, a human on high-risk calls.
3. **Calibration matters.**
   - The log-odds weights and Chow thresholds assume calibrated $p_i$. Small models are often overconfident.
   - Estimate $p_i$ and $\rho$ on held-out labelled items and report them, rather than asserting them.
   - The demo eval has 3 letters, so every rate above is **illustrative**, not a benchmark.
4. **Binary vs open answers.**
   - The math above is the worst case for false consensus, because wrong voters can only pick the one wrong answer.
   - For free-form fields (a date, an amount), wrong answers usually split, so unanimity on a *wrong* value is rarer. The 60% "same wrong answer" figure from Kim et al. warns that this is less rare than one might hope.
5. **Escalated items are the hard ones.** $\varepsilon_2$ on escalated items is higher than the big model's average error. Don't plug in its leaderboard accuracy.

## 9. Pitch box

**PL**
1. Jeden mały model myli się często, ale kilka niezależnych modeli, które się zgadzają, myli się wykładniczo rzadziej. To twierdzenie Condorceta o ławie przysięgłych z 1785 roku.
2. Haczyk: modele z tej samej rodziny mają te same ślepe plamki, więc bierzemy modele od różnych dostawców i mierzymy, jak bardzo ich błędy są skorelowane.
3. Gdy modele się zgadzają, a cytat istnieje dosłownie w dokumencie, pokazujemy odpowiedź ze źródłem. Gdy się nie zgadzają, system mówi „nie wiem, sprawdź” i pyta większy model albo człowieka.
4. Dzięki temu większość pól (w naszym modelu 80-90%) rozstrzygamy lokalnie i za darmo, a drogi model dostaje tylko sporne przypadki. To ta sama ekonomia kaskady, którą opisał FrugalGPT.
5. Nie twierdzimy, że zgoda to prawda. Pokazujemy, gdzie modele się nie zgadzają, i przy ważnych decyzjach zostawiamy ostatnie słowo człowiekowi.

**EN**
1. One small model is often wrong, but several independent models that agree are wrong exponentially less often. That's Condorcet's jury theorem from 1785.
2. The catch is that models from the same family share blind spots, so we pick models from different vendors and measure how correlated their errors are.
3. When the models agree and the quote exists verbatim in the document, we show the answer with its source. When they disagree, the system says "don't know, check" and escalates to a bigger model or a human.
4. So most fields (80-90% in our model) are resolved locally at zero cost, and the expensive model only sees the disputed ones. That's the same cascade economics as FrugalGPT.
5. We don't claim that agreement is truth. We show where the models disagree, and on high-stakes actions a human has the final word.

## References

- Condorcet, M. de (1785). *Essai sur l'application de l'analyse à la probabilité des décisions rendues à la pluralité des voix.* [Gallica](https://gallica.bnf.fr/ark:/12148/bpt6k417181)
- Hoeffding, W. (1963). Probability inequalities for sums of bounded random variables. *JASA* 58(301). [doi:10.1080/01621459.1963.10500830](https://doi.org/10.1080/01621459.1963.10500830)
- Ladha, K. K. (1992). The Condorcet jury theorem, free speech, and correlated votes. *AJPS* 36(3). [doi:10.2307/2111584](https://doi.org/10.2307/2111584)
- Kim, E., Garg, A., Peng, K., Garg, N. (2025). Correlated Errors in Large Language Models. ICML 2025. [arXiv:2506.07962](https://arxiv.org/abs/2506.07962)
- Goel, S. et al. (2025). Great Models Think Alike and this Undermines AI Oversight. ICML 2025. [arXiv:2502.04313](https://arxiv.org/abs/2502.04313)
- Krogh, A., Vedelsby, J. (1995). Neural network ensembles, cross validation, and active learning. NIPS 7. [proceedings](https://papers.nips.cc/paper/1001-neural-network-ensembles-cross-validation-and-active-learning)
- Ueda, N., Nakano, R. (1996). Generalization error of ensemble estimators. ICNN 1996. [doi:10.1109/ICNN.1996.548872](https://doi.org/10.1109/ICNN.1996.548872)
- Brown, G., Wyatt, J., Harris, R., Yao, X. (2005). Diversity creation methods: a survey and categorisation. *Information Fusion* 6(1). [doi:10.1016/j.inffus.2004.04.004](https://doi.org/10.1016/j.inffus.2004.04.004)
- Chow, C. K. (1957). An optimum character recognition system using decision functions. *IRE Trans. Electronic Computers*; Chow (1970). On optimum recognition error and reject tradeoff. *IEEE Trans. Inf. Theory* 16(1). [doi:10.1109/TIT.1970.1054406](https://doi.org/10.1109/TIT.1970.1054406)
- El-Yaniv, R., Wiener, Y. (2010). On the Foundations of Noise-free Selective Classification. *JMLR* 11. [jmlr.org](https://jmlr.org/papers/v11/el-yaniv10a.html)
- Angelopoulos, A. N., Bates, S., Fisch, A., Lei, L., Schuster, T. (2022/2024). Conformal Risk Control. ICLR 2024. [arXiv:2208.02814](https://arxiv.org/abs/2208.02814)
- Nitzan, S., Paroush, J. (1982). Optimal decision rules in uncertain dichotomous choice situations. *Int. Economic Review* 23(2). [doi:10.2307/2526382](https://doi.org/10.2307/2526382)
- Shapley, L., Grofman, B. (1984). Optimizing group judgmental accuracy in the presence of interdependencies. *Public Choice* 43. [doi:10.1007/BF00118940](https://doi.org/10.1007/BF00118940)
- Dawid, A. P., Skene, A. M. (1979). Maximum likelihood estimation of observer error-rates using the EM algorithm. *JRSS C* 28(1). [doi:10.2307/2346806](https://doi.org/10.2307/2346806)
- Chen, L., Zaharia, M., Zou, J. (2023). FrugalGPT. [arXiv:2305.05176](https://arxiv.org/abs/2305.05176)
- Viola, P., Jones, M. (2001). Rapid object detection using a boosted cascade of simple features. CVPR 2001. [doi:10.1109/CVPR.2001.990517](https://doi.org/10.1109/CVPR.2001.990517)
- Leviathan, Y., Kalman, M., Matias, Y. (2023). Fast Inference from Transformers via Speculative Decoding. ICML 2023. [arXiv:2211.17192](https://arxiv.org/abs/2211.17192)
- Wang, X. et al. (2023). Self-Consistency Improves Chain of Thought Reasoning in Language Models. ICLR 2023. [arXiv:2203.11171](https://arxiv.org/abs/2203.11171)
- Zou, A. et al. (2023). Universal and Transferable Adversarial Attacks on Aligned Language Models. [arXiv:2307.15043](https://arxiv.org/abs/2307.15043)
