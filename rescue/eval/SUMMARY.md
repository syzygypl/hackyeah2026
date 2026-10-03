# Validation summary card (Walidacja mode)

One card for the Walidacja mode, which says in three seconds whether the engine helps.

```sh
python3 rescue/eval/summary.py      # -> rescue/eval/summary.json
cd rescue && python3 -m http.server 8000   # then open http://localhost:8000/eval/summary-test.html (local test page)
```

## Data (`summary.py` -> `summary.json`, schema `rescue-eval-summary/1`)

Reads whatever exists, and missing files are skipped:
- `calibration/results.json`: land simulator cases (not on main yet; the footnote says so);
- `calibration/results-water.json`: water;
- `ablation.json`: blind rounds, N = 2. These are in `blind[]` and not in the headline.

| Key | Content |
|---|---|
| `headline` | share of cases with the true segment in the engine's top 3 vs the baseline (nearest cell to the LKP/IPP first), for `land`, `water` and `all`, each with `n`; plus Polish `label`, `baselineLabel`, `text` and `breakdown` |
| `chart` | `x` = 0..20% of the area searched (1% steps; about 97% of cases are found within 20%, and beyond it the lines are flat); `series` = engine and baseline, cumulative share of cases found by x |
| `loss` | the largest subgroup with at least 20 cases (category, category + behaviour, region + category, or region + category + behaviour) where the engine loses head-to-head to the baseline on area-to-find; Polish `text` plus `group` details |
| `blind` | per blind round: engine vs naive segment rank and area |
| `footnote` | "Symulacja (N=…), nie prawdziwe akcje; częściowy cykl: ten sam model dryfu w symulatorze i silniku." |

All texts are Polish with a decimal comma. Rounding is half-up, so the card's JS and the JSON texts agree.

**Current numbers** (water only, `results-water.json`, engine `rescue-engine-v2.1` default):
- **91%** of cases have the true segment in the top 3, vs **81%** for searching from the last known point (N = 600).
- Where it doesn't help: **swimmers** (N = 224). The engine loses head-to-head in 114 of 224 (median area 0.8% vs 0.6%), because for a swimmer heading to shore, "nearest to the LKP" is already almost optimal.

## Card (`rescue/app/validation-summary.js`)

- `renderSummary(el, url = "/eval/summary.json")` fills `el` with the card: big number, baseline next to it, a breakdown line, an inline SVG chart with 2 lines and a legend (baseline dashed), the loss line and the footnote.
- `renderCard(data)` returns the HTML string, for tests.
- Colours only via `--rl-*` tokens (`--rl-accent`, `--rl-mute`, `--rl-line`, `--rl-panel`, `--rl-warn`, ...). No global CSS: styles are inline on the card's own nodes. No layout changes.
- A missing file gives a one-line Polish note instead of the card.

**Hook for the shell** (for AI Mateusza; `validation.js` was not edited). Add these 2 lines to `rescue/app/validation.js`:

```js
import { renderSummary } from "./validation-summary.js";                                   // top of the file
renderSummary(el.insertAdjacentElement("afterbegin", document.createElement("div")));      // in showValidation(), after the ablation block
```

The shell already serves `/eval/...` json (CONTRACT.md "eval"), so `summary.json` is reachable at `/eval/summary.json` with no new route.

**Test:** `eval/summary-test.html` links the real `app/tokens.css`, renders the card from `summary.json` and checks the big number, the 2 chart lines, the legend, the loss line, the footnote, the decimal comma and that no global `<style>` exists. It sets `body[data-state=ready]` if all pass: `python3 rescue/web/tools/smoke.py http://localhost:8000/eval/summary-test.html /tmp/out 640x720`.
