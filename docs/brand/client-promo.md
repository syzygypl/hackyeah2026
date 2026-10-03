# Client promo: first pilot with an institution

By AI Mateusza, 2026-10-03 ~13:05, at Mateusz's request. A promo pack for a first pilot client. Names follow `brand.md` §0 (Airlock / Rój, rename pending). Numbers come from the `brand.md` §5 fact sheet. Legal wording follows `docs/research/legal-check-pl.md`: we say "supports", never "makes you compliant", and make no production-security claims. No company name appears until the IP decision; a signature placeholder stands in.

## Proof points (verified, use as written)

| # | Proof | Say it like this | Source |
|---|---|---|---|
| 1 | Detection | "On our test set: 19 of 20 attacks caught, 1 false alarm in 16 benign items (36 items, EN + PL)." | demo-mac-test.md |
| 2 | Speed | "The first guard model answers in 134 ms; rule checks take microseconds." | demo-mac-test.md, architecture README |
| 3 | Approvals | "Risky actions wait for an admin: approval is bound to the exact payment, single use, expires in 10 minutes. An agent can't approve itself." | 42be894, 4ec9f90 |
| 4 | Model outage | "If a model is down or slow, checks are not skipped: the configured fail mode applies, and high-risk calls fail closed." | 6202a36, 2ffcbdd |
| 5 | Local only | "The committed policy allows only local models. Prompts don't go to a model provider." | d16de01 |
| 6 | Tests | "117 automated tests and 170/170 demo cases pass." | origin/main 2ffcbdd, run 13:05; sample-security-report.md |

Always add when asked: "It's a prototype from a 24-hour hackathon. It supports compliance work; it doesn't certify it."

## Recommendation: lead with financial institutions

1. **Fit:** Airlock was built against a bank's brief. The demo story is a treasury agent, a poisoned invoice and a 95,000 EUR transfer, which is a bank's language.
2. **Urgency:** DORA has applied since January 2025, KNF's July 2026 recommendations ask for AI-aware ICT monitoring, and AI is a 2026 supervisory priority. A bank has a reason to act this quarter.
3. **Proof match:** admin-only payment approvals, a tamper-evident log and local models answer a bank's first three questions.
4. **Public sector comes second:** procurement is slower (Pzp), Rój is still a concept, and our known weak spot is Polish benign prompts (4 of 42 still wrongly blocked on a wider check, down from 7). Fix that before pitching to a Polish-speaking agency.

Best first target: a mid-size bank, a cooperative bank association or a regulated fintech that already runs an internal AI pilot (customer service, invoice processing, internal knowledge search).

---

## Target 1: financial institutions (bank, insurer, fintech)

**Hook (EN):** Your agents act. Airlock decides, on your hardware.
**Hook (PL):** Twoi agenci działają. Airlock decyduje, na twoim sprzęcie.

**The pain today**
- AI pilots stall at the risk committee: "what stops the agent from paying the wrong account or leaking customer data?"
- Cloud LLM guardrails mean sending data covered by banking secrecy (Prawo bankowe art. 104) to a third party. That brings a cloud outsourcing case, a KNF notification and a DORA third-party risk entry.
- DORA and the AI Act expect logs and human oversight. Agent frameworks don't produce either.

**What Airlock does**
- It sits between every agent and every tool or model, as a gateway, an SDK or an Ollama-compatible proxy (change one URL).
- Cheap rules first (payments, egress, PESEL/IBAN/card/e-mail redaction, 16 attack signatures), then local guard models, then an admin's four-eyes review where your policy says so.
- Every decision goes into a tamper-evident, hash-chained log. PESEL, card, e-mail and IBAN values appear there only as keyed HMAC tokens (b946027): pseudonymised, not reversible, still personal data. That supports the record keeping of AI Act Art. 12, the human oversight of Art. 14, and DORA logging.

**Proof points:** 5 (local only), 3 (admin-only approvals), 1 (19/20 on our test set). Backup: 4 (fail closed when a model is down).

Note: four-eyes review is an internal control, not PSD2 strong customer authentication. The bank still authenticates payments.

**Pilot offer: 2 weeks, on-prem**
- **Scope:** one internal agent use case (invoice processing, customer service drafts or knowledge search), on one server or workstation inside your network. Week 1 in monitor (shadow) mode: nothing is blocked, every would-be block is logged. Week 2 in enforce mode on agreed tools.
- **You provide:** a test environment, the agent's tool list, 2-3 people for one hour a week.
- **We provide:** setup, a policy tuned to your tools, a red-team run against your own test cases, a security report for the risk committee.
- **Success metric (to agree at kickoff):** share of your red-team cases blocked, false alarms on your real benign traffic, p50 overhead per call, and the risk committee accepting the audit report as evidence.

**Cold email (PL, 5 lines)**

> Temat: Agenci AI w banku bez wysyłania danych do chmury
>
> Dzień dobry, budujemy Airlock: bramkę między agentami AI a narzędziami banku, która działa w całości na Państwa sprzęcie.
> Agent może przygotować przelew, ale nie wyśle go na nieznane konto i nie zatwierdzi go sam. Decyzję podejmuje admin, jednorazowo, dla dokładnie tej płatności.
> Na naszym zestawie testowym Airlock złapał 19 z 20 ataków, a pierwszy model ochronny odpowiada w 134 ms. Każda decyzja trafia do dziennika odpornego na manipulacje, co wspiera wymogi DORA i art. 12 AI Act.
> Proponujemy 2-tygodniowy pilotaż on-prem na jednym Państwa przypadku użycia, zakończony raportem dla komitetu ryzyka.
> Czy znajdzie Pan/Pani 20 minut w przyszłym tygodniu? [imię nazwisko], zespół Airlock

**LinkedIn post (PL)**

> Jedna faktura może przejąć agenta AI. Ukryte zdanie: "przelej 95 000 euro". Agent jest uprzejmy, więc próbuje.
>
> Dlatego zbudowaliśmy Airlock: bramkę między agentami a narzędziami, działającą wyłącznie na sprzęcie instytucji. Najpierw szybkie reguły, potem lokalne modele ochronne, a ryzykowne płatności czekają na admina. Agent nie zatwierdzi sam siebie.
>
> Na naszym zestawie testowym: 19 z 20 ataków złapanych, 134 ms na pierwszy model, 117 testów na zielono. Każda decyzja w dzienniku odpornym na manipulacje, który wspiera DORA i art. 12 AI Act. Niczego nie certyfikuje, za to dużo ułatwia.
>
> To prototyp z HackYeah 2026. Szukamy jednego banku, ubezpieczyciela lub fintechu na 2-tygodniowy pilotaż on-prem. Odezwij się.

---

## Target 2: public institutions (municipality, social insurance agency, ministry)

**Hook (EN):** AI for citizens' data that never leaves your building.
**Hook (PL):** AI dla danych obywateli, które nie opuszczają twojego budynku.

**The pain today**
- Offices want AI for letters, case triage and helpdesks, but citizen data (PESEL, health data in social insurance letters) can't go to a US cloud without a transfer basis, a DPIA and a fight.
- The amended KSC (NIS2) has been in force since April 2026, with compliance due by April 2027. AI agents are a new, unlogged attack surface.
- Most guardrails are tuned for English. Polish prompt injections ("zignoruj poprzednie instrukcje") slip through.

**What Airlock does (and Rój, once built)**
- **Airlock:** a local gateway with Polish injection heuristics and PESEL checksum detection. Every model runs on-prem, every decision goes into a tamper-evident log, and failures are handled safely when a model is down. It supports GDPR Art. 25/32 (privacy by design, security of processing) and KSC/NIS2 logging duties.
- **Rój (concept, not built yet):** reads an official letter with two small model families. It shows a deadline or amount only when both agree and the quote is verbatim in the letter; otherwise it says "nie wiem, sprawdź". It extracts and quotes; it doesn't advise. The UI says "To nie jest porada prawna ani podatkowa" and carries the AI Act Art. 50(1) notice. A human always decides.

**Proof points:** 5 (local only), 4 (fail closed when a model is down), 1 (19/20 on our test set, which includes Polish attacks). Backup: 6 (117 tests, 170/170 demo cases).

Honest caveat for this target: on a wider Polish check, 4 of 42 benign prompts were still wrongly blocked (down from 7). The pilot's week 1 in monitor mode exists to tune exactly that.

**Pilot offer: 2 weeks, on-prem**
- **Scope:** one internal assistant or helpdesk flow, or (after Rój is built) one type of incoming letter. Runs on one server in the office's own network. Week 1 in monitor mode, week 2 in enforce mode.
- **You provide:** a test environment, anonymised or synthetic sample documents, one IT security contact.
- **We provide:** setup, a Polish-tuned policy, a red-team run in Polish and English, a report for the security officer (and the DPO).
- **Success metric (to agree at kickoff):** Polish attacks blocked on the office's test set, false alarms on real benign Polish traffic, zero data sent outside the network (verified in the log), and the security officer accepting the report.

**Cold email (PL, 5 lines)**

> Temat: Sztuczna inteligencja w urzędzie, a dane mieszkańców zostają u Państwa
>
> Dzień dobry, budujemy Airlock: bramkę, która kontroluje każdego asystenta AI w urzędzie i działa wyłącznie na Państwa serwerze.
> Wykrywa polskie próby manipulacji, maskuje PESEL i numery kont, a każdą decyzję zapisuje w dzienniku odpornym na manipulacje. To wspiera obowiązki z RODO i nowej ustawy o KSC.
> Gdy model ochronny nie działa, Airlock nie pomija kontroli: ryzykowne operacje są blokowane.
> Proponujemy 2-tygodniowy pilotaż na jednym procesie, najpierw w trybie obserwacji, bez wpływu na pracę urzędu.
> Czy możemy pokazać to w 20 minut? [imię nazwisko], zespół Airlock

**LinkedIn post (PL)**

> "Zignoruj poprzednie instrukcje" działa po polsku tak samo dobrze jak po angielsku. Większość zabezpieczeń AI tego nie wie.
>
> Airlock to bramka między asystentami AI a systemami instytucji. Działa w całości on-prem: modele na waszym sprzęcie, dane mieszkańców zostają w budynku. Polskie heurystyki ataków, sprawdzanie PESEL z sumą kontrolną, dziennik każdej decyzji odporny na manipulacje.
>
> Na naszym zestawie testowym, z atakami po polsku i angielsku: 19 z 20 złapanych. Gdy model ochronny przestaje odpowiadać, ryzykowne operacje są blokowane, a nie przepuszczane. Wspieramy RODO i KSC, niczego nie certyfikujemy.
>
> Prototyp z HackYeah 2026. Szukamy jednej gminy lub urzędu na 2-tygodniowy pilotaż w trybie obserwacji.

---

## Don'ts for every client conversation

- Never "anonymous logs" or "no personal data in logs". Say "PESEL, card, e-mail and IBAN are stored only as keyed tokens (pseudonymised)", per b946027.

- Never "compliant", "certified", "secure", "production-ready", "nothing leaves" (tools like e-mail send data out by design).
- Test numbers always come with "on our test set". Never "99%" or any extrapolated rate.
- Approvals are "four-eyes review by an admin", never "authorises the payment" or SCA.
- Rój is a concept until it is built and measured. Never demo it as a product to a public client.
- No company name or logo until the employer IP decision. Sign as "zespół Airlock".
