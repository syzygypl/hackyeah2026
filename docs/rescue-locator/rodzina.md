# The casual path: families and tourists

The second half of the pitch. The professional path (Akcja, Centrum, Odprawa) helps rescuers decide where to search. This path
helps the people who call them. One story:

1. **Start page** (`/app/start.html`). Two audiences, one heading and one sentence each: "Dla ratowników" (Kierownik akcji,
   Ratownik, Centrum, Odprawa) and "Dla rodzin i turystów" (Ktoś zaginął, Widziałem kogoś, Przed wyjściem w góry).
2. **Ktoś zaginął - co robić** (`/app/rodzina.html`, new):
   - **112 first.** A red block with a 64 px "Zadzwoń 112" button (`tel:112`), plus 985 / 601 100 300 (mountains) and
     601 100 100 (water). The numbers come from topr.pl and gopr.pl, the same as the landing page.
   - **Przygotuj zgłoszenie.** A checklist of what the dispatcher asks:
     - who: name, age, build, health and medication, experience
     - where and when: last seen, last contact, planned route, where the car is
     - what they look like: clothes, gear
     - their phone: number, battery, the Ratunek app
     - who is reporting
     
     "Gotowy tekst" turns it into a plain summary to read out on the phone. It can be copied, or shared with the system share
     sheet on phones. Empty fields are skipped. The draft is kept in this browser (localStorage) until "Wyczyść", so it survives a
     call or a page reload.
   - **Nothing is sent.** The page says so ("To pokaz, nie usługa"): the report is always made by calling 112.
   - **Widziałem kogoś.** "If you see the person now: stay close, don't chase, call 112." Then the two demo entries: the existing
     Widziałem page (`/web/seen/?sc=krakow-nowa-huta`, AI Marcina) and the Czat (`/app/czat.html`, the chat agent's) for describing a
     sighting in your own words.
   - **Przed wyjściem w góry.** Five short points (plan with someone, battery, the Ratunek app, weather, visible clothes) and links
     to the official sources (TOPR, GOPR, TPN, IMGW). Their texts are not copied.
   - Footer: prototype, fictional people, not a replacement for 112.
3. **Landing for tourists** (`/app/landing/?dla=turysci`): the alarm block links "Przygotuj zgłoszenie", and the Widziałem demo
   card also links the Czat.

## Accessibility (checked at 390, 360 and 1440 px, headless Chromium)

- No horizontal scroll. Every button, field and chip is at least 44 px (most are 48 px). Inputs use 16 px text, so iOS does not zoom
  in on focus.
- Text contrast is at least 4.5:1 (computed against the real background). The family block on the start page uses a light red tint
  with dark text.
- On phones the header scrolls away instead of covering the screen. Anchors land on their section.

## Shots

- `shots/rodzina-start-390.jpg`: the two audiences on the start page
- `shots/rodzina-390-112.jpg`: the 112 block
- `shots/rodzina-390-tekst.jpg`: a filled report, as text
- `shots/rodzina-1440.jpg`: desktop

## Not done

- Real submission to an agency: on purpose. Reports go through 112.
- Translations (EN, UA) of the family page would help tourists. Not started.
