# Rescue Locator (SMART CITY) - changelog zgłoszenia

## v4 - 2026-10-03 23:10 (main `f54c390`, Vercel `b00b3e1`)

- **Bez deklaracji pracy offline:** model w pokazie to OpenAI, z regułami jako zapasem. Lokalny model wymieniamy tylko jako możliwość w kodzie.
- **Nowe funkcje:**
  - ciągła oś czasu 1x-30x z grupami zdarzeń (`ef5f100`) i Kino za grupami (`f54c390`),
  - wagi wskazówek z ręczną korektą (`bd88de5`, `08f5029`),
  - Zasoby i karta zespołu (`54b0204`, `356458c`),
  - Doradca przy wielu akcjach, np. ćwiczenie awarii zapory z 7 akcjami (`35045fb`),
  - Ćwiczenia (`c043d18`, `285ee6a`),
  - analiza zdjęcia (`1250eb7`), opisana wprost jako **demo syntetyczne**,
  - scenariusz rodzina-dziecko-las (`2303503`),
  - `/landing` ze statusem funkcji (`e6a7d02`).
- Na produkcji jest 18 fikcyjnych scenariuszy (`/api/scenarios`).
- 3D FOV jest w przebudowie i go nie pokazujemy.
- Supervisorem tematu 2 jest AI Andrzeja.
- **Deck:** slajd 9 to teraz "Jedna usługa dla miasta i regionu" (wagi zgłoszeń, Doradca), bez deklaracji pracy offline. Slajd 10 linkuje `/landing`.

## v3 - 2026-10-03 20:50 (main `4e48798`, Vercel `4e48798`)

Pierwsza wersja wariantu Smart City (decyzja Mateusza: zgłaszamy do DEFENCE i do Smart City).

- **Na pierwszym planie Kraków, Nowa Huta:** senior z demencją w upale, mieszkańcy jako czujniki ("Widziałem" z GPS), MPK, Centrum.
- **Liczby:**
  - scenariusz krakowski: 4,8% vs 24,5% obszaru, segment #4 vs #9 (autorski, ilustracja),
  - kategoria demencja w symulacji: top 3 w 76%,
  - kalibracja 1000 + 600 przypadków, nazwana raz "symulacja, nie prawdziwe akcje",
  - POA tylko jako "waga mapy".
- **MP4 maks. 3 min:** w checkliście (AI Michała). Regulamin Smart City wymienia tylko PDF, więc trzeba sprawdzić formularz.
- **`start.sh`:** jak w wariancie DEFENCE v3.

Artefakt (kolejne wersje publikujemy pod tym samym URL-em): https://claude.ai/artifact/HTwbEYqcivNfNybhygotL3
