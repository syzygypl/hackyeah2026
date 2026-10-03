# Deck outline (PDF, max 10 slides)

One idea per slide, a screenshot on most of them, little text. The deck is read by mentors in phase 1 without us in the room, so it must stand on its own. Language: see `checklist.md`.

## The 10 slides

| # | Slide | Content (fill in) | Visual |
|---|---|---|---|
| 1 | Title | Project name, one-line promise, team name/ID, task name | Logo / hero screenshot |
| 2 | Problem | `[one sentence problem]` + one hard fact or number about it | Photo / stat |
| 3 | User | `[who they are]`, `[their situation today]`, what it costs them | Persona card |
| 4 | Solution | `[what we built in one sentence]`, 3 key capabilities | Hero screenshot |
| 5 | Live demo | The 3-4 demo steps as a filmstrip. **Demo URL + QR code**, video link | 3-4 screenshots |
| 6 | How it works | Architecture diagram: inputs, core (the real part), outputs. Stack in one line | Diagram |
| 7 | Value / number | `[the value number]` (time saved, cost, accuracy...), how we measured it | One big number |
| 8 | Criteria coverage | Task's judging criteria, each with what we built for it (table below) | Table with ticks |
| 9 | Roadmap / implementation | What's real vs mocked today, next 3 steps to production, cost/scaling | Timeline |
| 10 | Team + ask | Members and roles, **repo link**, demo link, contact, what we'd like next (pilot, partner, data) | Photos / names |

Rule: if a slide has no screenshot or number, question whether it's needed.

## Criteria to slide mapping per candidate task

Fill the "What we show" column once the task is chosen; that column is also the checklist for the demo.

### AI Control Layer (Goldman Sachs) - EN or PL

| Criterion | Weight | Slides | What we show |
|---|---|---|---|
| Robustness of the solution and quality of guardrails | 30% | 4, 5, 6 | `[guardrails list, attack blocked live]` |
| Architecture and performance efficiency | 20% | 6, 7 | `[diagram, latency/overhead per call]` |
| Security reporting | 20% | 5, 7 | `[report/dashboard screenshot]` |
| Completeness of the self-testing suite | 20% | 7, 8 | `[N attack tests, pass rate, how to run]` |
| Practical implementability and scalability | 10% | 9 | `[how a company plugs it in, deployment]` |

### HubMI.pl (Województwo Małopolskie) - PL only

| Criterion | Weight | Slides | What we show |
|---|---|---|---|
| Realizacja wyzwania (key features + number of extra features) | 40% | 4, 5, 8 | `[key features + list of extras]` |
| Potencjał wdrożeniowy (scalability, flexibility, cost, maintenance) | 20% | 6, 9 | `[architecture, cost estimate]` |
| Dostępność i intuicyjność (WCAG 2.1 AA, all ages) | 20% | 5, 8 | `[WCAG checklist / Lighthouse score, contrast, keyboard, screen reader]` |
| Atrakcyjność UI (bonus) | 10% | 1, 4, 5 | `[best screens]` |
| Jakość materiałów i MVP (bonus) | 10% | whole deck + video | `[polish of deck and video]` |

### Cracow without barriers (Gmina Miejska Kraków) - PL only

| Criterion | Weight | Slides | What we show |
|---|---|---|---|
| Idea (creativity, how far the problem is solved) | 30% | 2, 3, 4 | `[user needs covered]` |
| Technical aspects (technologies, algorithms, code quality) | 30% | 6, 7 | `[algorithm, data sources, repo]` |
| Design (architecture, scalability, production readiness) | 20% | 6, 9 | `[architecture, deployment path]` |
| Relation to category | 10% | 4, 8 | `[barriers and facilities shown per user need]` |
| WOW factor (originality, extras) | 10% | 5, 7 | `[the wow moment]` |

### Open tasks (default criteria, section 5.5 of the general rules)

Applies to Defence, Sport & Healthcare, Smart City, Artificial Intelligence, ImpactHer.

| Criterion | Weight | Slides | What we show |
|---|---|---|---|
| Idea and innovation | 30% | 2, 4 | `[what's new vs existing solutions]` |
| Relation to category | 20% | 2, 8 | `[how it fits the category brief]` |
| Practical applicability / usability | 20% | 3, 5, 7 | `[real user, value number]` |
| Design | 20% | 4, 5 | `[UI screenshots]` |
| Completeness and implementation value | 10% | 5, 9 | `[what works end to end, next steps]` |

## Production tips

- Export to PDF and count pages: 10 max, title and team slides included.
- Links must be clickable in the PDF; add a QR code for the demo URL.
- Keep fonts large (min 24 pt body); judges may read it on a laptop at a distance.
- Same deck is the base for the live pitch; cut text, keep visuals.
