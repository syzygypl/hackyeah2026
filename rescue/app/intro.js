// Intro layer of the operator app (docs/rescue-locator/intro.md): the guided Zawrat story (?tour=1, ~90 s) and the "?" manual.
// Own block, drives the shell only through window.rescueApp / window.rescueStore and existing buttons; never blocks the user:
// the spotlight does not catch clicks, every stop re-establishes its own context (Historia, Akcja, zawrat, step), Esc closes.
// Respects "Czego NIE pokazywać" (najmocniejsze-funkcje.md): no POA % as a chance, no planner that "finds on its own", no LLM assessment.
const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const app = () => window.rescueApp, st = () => window.rescueStore;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = () => { const s = st(), a = app(); return !!(a && a.setTime && s && s.run && s.run.steps && s.role && s.scenList); };
const cur = () => { const s = st(); return s && s.run && s.run.steps ? s.run.steps[s.step - 1] : null; };
const fmt1 = (x) => (Math.round(x * 10) / 10).toFixed(1).replace(".", ",").replace(",0", "");
const isPhone = () => innerWidth <= 900;
const vis = (el) => !!(el && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");   // fixed panels have no offsetParent

// ---------- the story: stops follow the live demo order (najmocniejsze-funkcje.md #1 and #2, the rest on the end card)
const STOPS = [
  { step: 5, target: "map", title: "17:40 · zgłoszenie",
    text: () => "Żona dzwoni: mąż nie wrócił z Zawratu, mgła, zaraz zmrok. Bez wskazówek mapa to tylko prawdziwy teren i statystyka, jak daleko odchodzą zaginieni turyści (pierścienie Koestera). Obszar jest ogromny." },
  { step: 9, target: "dock", signals: true, title: "18:05 · wskazówki",
    text: () => "Plan od żony, auto wciąż na parkingu, ostatnie logowanie telefonu z 112. Każda wskazówka to osobna warstwa i mapa przelicza się sama. Odznacz jedną na liście, a zobaczysz, co wnosiła." },
  { step: 11, target: "top3", title: "18:30 · gdzie szukać najpierw",
    text: () => { const S = cur(); const a = S ? S.segments.slice(0, 3).reduce((x, s) => x + (+s.areaPct || 0), 0) : 0;
      return `Trzy pierwsze sektory to ${a ? fmt1(a) + "%" : "mała część"} obszaru. Liczy się kolejność przeszukiwania (waga mapy), a nie procent czytany jako szansa.`; } },
  { step: 14, target: "teams", details: true, title: "19:20 · zespoły",
    text: () => "Kto, dokąd i za ile minut dojścia. Na oblodzone płyty pod Zawratem tylko zespół linowy z asekuracją. Plan podpowiada, decyduje kierownik akcji." },
  { step: 15, target: "map", seg: "S7", title: "19:35 · puste przeszukania",
    text: () => "Sektory przy stawach wróciły z „nic”, dron termowizyjny też nic nie widział. To też informacja: waga mapy spływa do Żlebu pod Zawratem (S7). Na samej statystyce był #20, teraz jest #1." },
  { step: 16, target: "top3", seg: "S7", title: "19:45 · wiatr",
    text: () => "Wiatr 14 m/s uziemia drona. W planie do żlebu idzie śmigłowiec TOPR z kamerą termowizyjną." },
  { step: 17, target: "map", seg: "S7", title: "20:03 · ZNALEZIONO",
    text: () => "Śmigłowiec znajduje turystę w żlebie pod Zawratem, w sektorze, który mapa wskazała jako pierwszy. To scenariusz napisany przez nas: ilustracja działania, nie dowód skuteczności." },
  { end: true, title: "Teraz Ty",
    text: () => "To była nagrana historia. Teraz Ty prowadzisz akcję od zgłoszenia o 17:40: pisz w czacie, co meldują świadkowie i zespoły, a mapa przeliczy się po każdym meldunku (symulacja tylko u Ciebie)." },
];

// ---------- DOM: spotlight (does not catch clicks) + card
const spot = document.createElement("div"); spot.id = "tourSpot"; spot.hidden = true;
const card = document.createElement("section"); card.id = "tourCard"; card.hidden = true; card.setAttribute("role", "dialog"); card.setAttribute("aria-label", "Przewodnik: akcja na Zawracie");
document.body.append(spot, card);

const tour = { on: false, i: 0, busy: 0, opened: { signals: false, details: false }, tick: null };

function rectOf(t) {
  const r = (el) => (vis(el) ? el.getBoundingClientRect() : null);
  if (t === "map") {
    const c = r($("center")); if (!c || !c.width) return null;
    // in the floating layout the scene is full-screen: spotlight only the free area between the panels
    const h = r(document.querySelector("header")), rt = r($("right")), b = r($("bottom"));
    const x = { left: c.left, top: c.top, right: c.right, bottom: c.bottom };
    if (!isPhone()) {
      if (h && h.bottom > x.top && h.bottom < x.bottom) x.top = h.bottom + 6;
      if (rt && rt.width && rt.left > x.left + 200) x.right = Math.min(x.right, rt.left - 6);
      if (b && b.top < x.bottom && b.top > x.top + 100) x.bottom = b.top - 6;
      x.left += 6;
    }
    return x;
  }
  if (t === "top3") {
    const a = r(document.querySelector("#right .hero")), s = r($("segs"));
    if (!a && !s) return null; const L = [a, s].filter((v) => v && v.height);
    return L.length ? { left: Math.min(...L.map((v) => v.left)), top: Math.min(...L.map((v) => v.top)), right: Math.max(...L.map((v) => v.right)), bottom: Math.max(...L.map((v) => v.bottom)) } : null;
  }
  if (t === "teams") return r($("teams"));
  if (t === "dock") return r($("bottom"));
  return null;
}
function place() {
  if (!tour.on) return;
  const S = STOPS[tour.i], R = S.target ? rectOf(S.target) : null;
  if (R && R.right - R.left > 4 && R.bottom - R.top > 4) {
    const p = 6;
    Object.assign(spot.style, { left: R.left - p + "px", top: R.top - p + "px", width: R.right - R.left + 2 * p + "px", height: R.bottom - R.top + 2 * p + "px" });
    spot.hidden = false; spot.classList.remove("nofocus");
  } else { spot.hidden = false; spot.classList.add("nofocus"); }
  // card: phone = bottom sheet (CSS); desktop = over the map, bottom-left above the dock, or centred for the end card
  if (isPhone()) { card.style.left = card.style.top = card.style.bottom = ""; return; }
  const b = vis($("bottom")) ? $("bottom").getBoundingClientRect() : null;
  if (S.end) { card.style.left = Math.max(16, (innerWidth - card.offsetWidth) / 2) + "px"; card.style.top = Math.max(80, (innerHeight - card.offsetHeight) / 2) + "px"; card.style.bottom = ""; return; }
  let bottom = b ? innerHeight - b.top + 14 : 24;
  if (S.target === "dock" && R) bottom = innerHeight - R.top + 18;
  card.style.left = "28px"; card.style.top = ""; card.style.bottom = Math.max(16, bottom) + "px";
}

function drawCard() {
  const S = STOPS[tour.i], n = STOPS.length;
  const dots = STOPS.map((_, k) => `<i class="${k === tour.i ? "on" : k < tour.i ? "done" : ""}"></i>`).join("");
  const endLinks = S.end ? `<div class="tc-end">
      <button type="button" data-a="begin" class="primary">Zacznij od zgłoszenia (17:40)</button>
      <button type="button" data-a="share">Telefon ratownika (QR)</button>
      <a href="centrum.html">Centrum - wiele akcji</a>
      <a href="./?role=operator&sc=sniardwy">Woda: Śniardwy</a>
      <a href="./?role=operator&sc=krakow-nowa-huta">Miasto: Kraków</a>
      <button type="button" data-a="help">Instrukcja</button>
    </div>` : "";
  card.innerHTML = `<div class="tc-head"><span class="tc-n">${tour.i + 1}/${n}</span><span class="tc-dots">${dots}</span><button type="button" class="tc-x" data-a="close" title="Zakończ przewodnik (Esc)" aria-label="Zakończ">×</button></div>
    <h3>${S.title}</h3><p>${S.text()}</p>${endLinks}
    <div class="tc-nav"><button type="button" data-a="back" ${tour.i ? "" : "disabled"}>Wstecz</button><span style="flex:1"></span><button type="button" data-a="close">Zakończ</button>${S.end ? "" : `<button type="button" data-a="next" class="primary">Dalej</button>`}</div>`;
}

// put the app in the state of stop i; every call re-establishes it, so user clicks between stops do no harm
async function apply(i) {
  const a = app(), s = st(), S = STOPS[i], my = ++tour.busy;
  card.classList.add("busy");
  try {
    if (s.role !== "operator") return;
    if (!["akcja"].includes(s.mode)) a.setMode("akcja");
    if (document.body.classList.contains("cinema")) document.body.classList.remove("cinema");
    if (!S.end) {
      if (s.scenario !== "zawrat") { $("scen").value = "zawrat"; await a.loadScenario("zawrat"); }
      if (s.time !== "hist") await a.setTime("hist");
      if (my !== tour.busy) return;
      a.setStep(S.step);
      if (S.seg && s.selSeg !== S.seg) a.selectSeg(S.seg);
    }
    // the evidence list sits behind "Sygnały" in the dock; open it for that stop only (and close it again if we opened it)
    const sig = document.body.classList.contains("signals"), sb = $("sigBtn");
    if (S.signals && !sig && sb) { sb.click(); tour.opened.signals = true; }
    if (!S.signals && tour.opened.signals && sig && sb) { sb.click(); tour.opened.signals = false; }
    const d = $("moreInfo");
    if (d) { if (S.details && !d.open) { d.open = true; tour.opened.details = true; } if (!S.details && tour.opened.details) { d.open = false; tour.opened.details = false; } }
    if (S.target === "teams" && $("teams")) $("teams").scrollIntoView({ block: "nearest" });
    else if (!isPhone() && $("right")) $("right").scrollTop = 0;   // top 3 back in view after the team stop scrolled the panel
    if (isPhone()) { const el = S.target === "map" ? $("center") : S.target === "top3" ? $("right") : S.target === "teams" ? $("teams") : S.target === "dock" ? $("bottom") : null; if (el) el.scrollIntoView({ block: "start", behavior: "smooth" }); }
  } catch (e) { console.warn("tour", e); }
  finally { if (my === tour.busy) card.classList.remove("busy"); }
}
async function go(i) {
  tour.i = Math.max(0, Math.min(STOPS.length - 1, i));
  drawCard(); place();
  await apply(tour.i);
  drawCard(); place(); setTimeout(place, 400); setTimeout(place, 1200);
}
async function start() {
  if (!ready()) { for (let k = 0; k < 120 && !ready(); k++) await wait(250); if (!ready()) return; }
  if (st().role !== "operator") return;   // the phone stays one-glance: no tour for Ratownik
  closeHelp();
  const fr = $("firstRun"); if (fr) fr.hidden = true;
  tour.on = true; tour.opened = { signals: false, details: false };
  document.body.classList.add("touring"); card.hidden = false;
  clearInterval(tour.tick); tour.tick = setInterval(place, 500);
  go(0);
}
function stop() {
  if (!tour.on) return;
  tour.on = false; tour.busy++;
  clearInterval(tour.tick); spot.hidden = true; card.hidden = true; document.body.classList.remove("touring");
  if (tour.opened.signals && document.body.classList.contains("signals") && $("sigBtn")) $("sigBtn").click();
  if (tour.opened.details && $("moreInfo")) $("moreInfo").open = false;
  try { localStorage.setItem("rescue-tour-done", "1"); } catch (e) {}
  if (Q.has("tour")) { const u = new URL(location.href); u.searchParams.delete("tour"); history.replaceState(null, "", u); }
}
// "Teraz Ty": the recording back at the call (step 5, 17:40, the first full picture), chat open; what the user adds is a private
// what-if (chat.js Historia). Not Na żywo: the shared live action is already past ZNALEZIONO.
async function begin() {
  stop();
  const a = app(), s = st();
  try {
    if (s.scenario !== "zawrat") { $("scen").value = "zawrat"; await a.loadScenario("zawrat"); }
    if (s.time !== "hist") await a.setTime("hist", true);
    if (s.mode !== "akcja") a.setMode("akcja");
    a.setStep(STOPS[0].step);
  } catch (e) { console.warn("tour begin", e); }
  for (let k = 0; k < 40 && !window.rescueChat; k++) await wait(100);
  const c = window.rescueChat; if (!c) return;
  c.open(true);
  c.chat.say("Jest 17:40, żona właśnie zgłosiła zaginięcie. Co meldują świadkowie i zespoły? Napisz albo stuknij przykład poniżej, np. „Turystka widziała go o 14:20 przy Czarnym Stawie”.");
}
card.addEventListener("click", (e) => {
  const b = e.target.closest("[data-a]"); if (!b) return;
  const k = b.dataset.a;
  if (k === "next") go(tour.i + 1);
  else if (k === "back") go(tour.i - 1);
  else if (k === "close") stop();
  else if (k === "begin") begin();
  else if (k === "share") { stop(); $("shareBtn") && $("shareBtn").click(); }
  else if (k === "help") { stop(); openHelp(); }
});
addEventListener("keydown", (e) => {
  if (e.target.closest && e.target.closest("input,textarea,select")) return;
  if (tour.on) {
    if (e.key === "Escape") stop();
    else if (e.key === "ArrowRight" && !STOPS[tour.i].end) go(tour.i + 1);
    else if (e.key === "ArrowLeft" && tour.i) go(tour.i - 1);
  } else if (e.key === "Escape" && !help.hidden) closeHelp();
});
addEventListener("resize", () => place());

// ---------- "?" manual: short, plain Polish, same words as slownik.md (waga mapy, sektor, wskazówka, Na żywo / Historia)
const help = document.createElement("aside"); help.id = "helpPanel"; help.hidden = true; help.setAttribute("aria-label", "Instrukcja");
help.innerHTML = `<div class="hp-head"><h2>Instrukcja</h2><span style="flex:1"></span><button type="button" class="hp-x" title="Zamknij (Esc)" aria-label="Zamknij">×</button></div>
<div class="hp-body">
  <p class="hp-lead">Rescue Locator łączy niepewne wskazówki w jedną mapę i podpowiada, które sektory przeszukać najpierw. Nie śledzi ludzi i nie decyduje za kierownika akcji.</p>
  <button type="button" class="primary hp-tour">Pokaż w 90 sekund ▶</button>
  <h3>Co widzisz na ekranie</h3>
  <ul>
    <li><b>Mapa</b> (2D lub 3D): mapa ciepła na prawdziwym terenie, podzielona na sektory.</li>
    <li><b>Gdzie szukać najpierw</b> (prawy panel): trzy pierwsze sektory, jaka to część obszaru i który zespół tam idzie. Pod „Szczegóły”: plan zespołów i postęp akcji.</li>
    <li><b>Oś czasu</b> (na dole): godzina i kolejne zdarzenia. „Sygnały” otwiera listę wskazówek.</li>
    <li><b>Góra</b>: Na żywo / Historia, scenariusz, tryby Akcja, Plan, Więcej, „Udostępnij” i „Centrum”.</li>
  </ul>
  <h3>Jak czytać wagę mapy</h3>
  <p>Cieplejszy kolor to większa waga. Legenda mówi, ile razy dane miejsce waży więcej niż średnia komórka (od 0,5x do 25x i więcej). Waga mapy służy do ustalenia kolejności przeszukiwania; nie czytaj jej jako szansy znalezienia. Patrz na kolejność sektorów i na to, jaką część obszaru zajmują.</p>
  <p>Przeszukany sektor bez wyniku traci wagę, a reszta mapy zyskuje. „Nic nie znaleźliśmy” to też informacja.</p>
  <h3>Jak dodać wskazówkę</h3>
  <ul>
    <li><b>Na żywo</b>: w panelu „Na żywo” kliknij „+ Ślad”, potem miejsce na mapie; wybierz rodzaj (odzież, ślad, świadek, sygnał telefonu, znalezisko) i dopisz opis. Mapa przelicza się dla wszystkich.</li>
    <li><b>Z terenu</b>: ratownik wysyła meldunek z telefonu zwykłym zdaniem, np. „S6 pusto, widoczność 50 m”. Pojawia się w panelu „Na żywo”, potwierdzasz go ✓.</li>
    <li><b>Plan</b>: przeciągnij wskazówkę z lewej listy na mapę, a zespół na sektor.</li>
    <li><b>Co wnosi jedna wskazówka</b>: otwórz „Sygnały” i odznacz ją; mapa przeliczy się bez niej.</li>
  </ul>
  <h3>Na żywo czy Historia</h3>
  <ul>
    <li><b>Na żywo</b> (czerwona ramka): akcja teraz. Ślady, wysyłanie zespołów, potwierdzanie meldunków, nowe akcje. „Następne zdarzenie” przesuwa akcję dla wszystkich podłączonych.</li>
    <li><b>Historia</b> (granatowa ramka): nagrany przebieg. Przesuwasz oś czasu albo naciskasz ▶; niczego nie zmieniasz na serwerze.</li>
  </ul>
  <h3>Role</h3>
  <ul>
    <li><b>Kierownik akcji</b>: ten ekran.</li>
    <li><b>Ratownik</b>: telefon dołącza przez „Udostępnij” (kod QR). Widzi swoje zadanie, kierunek i odległość, wysyła meldunki.</li>
    <li><b>Centrum</b>: wszystkie akcje na jednej mapie i wspólna pula zespołów.</li>
  </ul>
  <h3>Uczciwie</h3>
  <p>Scenariusze są fikcyjne. Liczby z Walidacji pochodzą z symulacji, nie z prawdziwych akcji. Plan zespołów to podpowiedź (czas dojścia, bezpieczeństwo); decyzja zawsze należy do człowieka.</p>
  <p class="hp-foot"><a href="start.html">Strona startowa</a> · <a href="cwiczenia.html">Ćwiczenia: przejmij fikcyjną akcję i dostań ocenę decyzji</a></p>
</div>`;
document.body.append(help);
function openHelp() { if (tour.on) stop(); help.hidden = false; help.querySelector(".hp-x").focus(); }
function closeHelp() { help.hidden = true; }
help.querySelector(".hp-x").onclick = closeHelp;
help.querySelector(".hp-tour").onclick = () => { closeHelp(); start(); };

// "?" in the operator header (index.html #helpBtn); the logo leads back to the start page
if ($("helpBtn")) $("helpBtn").onclick = () => (help.hidden ? openHelp() : closeHelp());
const logo = document.querySelector("header h1");
if (logo) { logo.title = "Strona startowa"; logo.addEventListener("click", () => { location.href = "start.html"; }); }

window.rescueIntro = { start, stop, openHelp, closeHelp, go };   // tests
if (Q.get("tour") === "1") start();
else if (Q.get("help") === "1") { (async () => { for (let k = 0; k < 40 && !(st() && st().role); k++) await wait(250); openHelp(); })(); }
