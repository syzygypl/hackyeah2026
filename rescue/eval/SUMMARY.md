# Validation summary card (Walidacja mode)

One card for the Walidacja mode, which says in three seconds whether the engine helps.

```sh
python3 rescue/eval/summary.py      # -> rescue/eval/summary.json
cd rescue && python3 -m http.server 8000   # then open http://localhost:8000/eval/summary-test.html (local test page)
```

## Data (`summary.py` -> `summary.json`, schema `rescue-eval-summary/2`)

Mountains and water side by side. Reads whatever exists:
- `calibration/results.json`: land; engine, expert and naive = nearest to the IPP;
- `calibration/results-water.json`: water; naive = nearest to the last known point, which is the IPP there;
- `ablation.json`: blind rounds, kept in `blind[]` and not in the headline.

| Key | Content |
|---|---|
| `envs.land`, `envs.water` | `label`, `n`, `baselineLabel`; `top3[method] = {share, ci95}` (95% Wilson interval) for engine, naive and expert; `cdf.engine` / `cdf.naive` (cumulative share of cases found by x% of area); `areaMedian`; `loss` |
| `envs.*.loss` | the largest subgroup with at least 20 cases (category / region / region + category / category + behaviour) where the engine loses to a baseline, head-to-head on area-to-find or on the median area. Land compares against both expert and naive, water against naive. Polish `text` plus `group` |
| `chart.x` | 0..40% of the area in 2% steps (land p90 is about 29%) |
| `footnotes` | simulation / partial cycle; the map's POA percentages being overconfident, computed from the land calibration bins (segment "45%" -> 19%, "85%" -> 61%); missing sources |

**Current numbers** (default engine `rescue-engine-v2.1`):

| | Engine top 3 | Baseline top 3 | Expert top 3 | Median area engine / baseline / expert |
|---|---|---|---|---|
| Mountains (N = 1000) | **66%** (63-69%) | 43% (40-46%) nearest IPP | 56% (53-59%) | 5.5 / 22.6 / 6.4% |
| Water (N = 600) | **91%** (88-93%) | 81% (78-84%) nearest LKP | 65% (61-69%) | 1.0 / 1.1 / 4.1% |

Where it doesn't help:
- Mountains: Bieszczady (N = 200). The expert wins 99 of 200 head-to-head (engine 100), with a median area of 4.7% vs 5.7%.
- Water: swimmers (N = 224). The last known point wins 114 of 224, with a median area of 0.6% vs 0.8%.

## Card (`rescue/app/validation-summary.js`)

- `renderSummary(el, url = "/eval/summary.json")` fills `el` with the card: big number, baseline next to it, a breakdown line, an inline SVG chart with 2 lines and a legend (baseline dashed), the loss line and the footnote.
- `renderCard(data)` returns the HTML string, for tests.
- Colours only via `--rl-*` tokens (`--rl-accent`, `--rl-mute`, `--rl-line`, `--rl-panel`, `--rl-warn`, ...). No global CSS: styles are inline on the card's own nodes. No layout changes.
- A missing file gives a one-line Polish note instead of the card.

**Wired into the shell** (approved by the supervisor; JS and markup only, no CSS):
- `index.html` gets `<div id="validation-summary"></div>` before `<div id="val">` in `#paneVal`. It's a separate container because `showMain()` replaces the content of `#val`.
- `validation.js` imports `renderSummary` and calls `renderSummary(document.getElementById("validation-summary"))` in `showValidation()`.
- The card styles only its own nodes, and the container is left for the shell's redesign.

The shell already serves `/eval/...` json (CONTRACT.md "eval"), so `summary.json` is reachable at `/eval/summary.json` with no new route.

**Test:** `eval/summary-test.html` links the real `app/tokens.css`, renders the card from `summary.json` and checks the big number, the legend, the loss line, the footnote, the decimal comma and that no global `<style>` exists. It also checks for 4 chart lines, both environments, Wilson intervals, the expert on land, a loss line per environment and the overconfidence note. It sets `body[data-state=ready]` if all pass: `python3 rescue/web/tools/smoke.py http://localhost:8000/eval/summary-test.html /tmp/out 640x720`.
