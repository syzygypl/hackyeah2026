// Czat (AI Mateusza #2): add events by chatting in plain Polish. Rules first (time, scenario gazetteer, sector ids, roster,
// keywords), then a confirmation card (what was understood + mini map + editable fields), then the EXISTING API:
//   Na żywo: POST /api/clue (sightings, items, traces, find), POST /report (searched-empty, weather, team status: the
//            server's rules + optional LLM read it), POST /story/assign (dispatch); "Cofnij" = POST /api/clue/weight 0.
//   Historia: a private what-if - the scenario file + the chat events -> POST /api/run (stateless, nobody else sees it);
//            the shell shows that run until "Wróć do nagrania" / "Cofnij". Studio: POST /story/event, undo /story/edit.
// Reply: new top 3 (rank + sector + "% obszaru", never POA %), moves vs before, "pokaż na mapie" (2D select = zoom).
// Two hosts: the /app shell (drawer, mountAppChat) and czat.html (full screen, mountStandalone). Docs: docs/rescue-locator/czat.md

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fold = (s) => String(s || "").toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[̀-ͯ]/g, "");
const pl1 = (x) => (Math.round(x * 10) / 10).toFixed(1).replace(".", ",");
const LOOPBACK = typeof location !== "undefined" && ["127.0.0.1", "localhost", "[::1]", "::1"].includes(location.hostname);
const pin = () => { try { return (localStorage.getItem("rescue-pin") || "").replace(/^"(.*)"$/, "$1"); } catch (e) { return ""; } };
const hasKey = () => LOOPBACK || !!pin();
async function api(path, body) {
  const h = { "Content-Type": "application/json" }; if (!LOOPBACK && pin()) h["X-Rescue-Pin"] = pin();
  const r = await fetch(path, body === undefined ? { headers: h, cache: "no-cache" } : { method: "POST", headers: h, body: JSON.stringify(body) });
  if (r.status === 401) { const e = new Error("Do zmian na żywo potrzebny jest klucz akcji (link „Udostępnij” od kierownika akcji)."); e.code = 401; throw e; }
  if (!r.ok) throw new Error("Serwer odrzucił żądanie (" + r.status + ").");
  return r.json();
}
const hm = (m) => { m = ((Math.round(m) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
const minOf = (t) => { const [a, b] = String(t || "").split(":").map(Number); return a * 60 + b; };
// minutes since the scenario start (an evening scenario: 00:30 counts as after 23:00)
const rel = (t, start) => { let x = minOf(t) - minOf(start); if (x < -720) x += 1440; if (x > 720) x -= 1440; return x; };
const dist = (a, b) => { const k = 111320, dy = (a[0] - b[0]) * k, dx = (a[1] - b[1]) * k * Math.cos(a[0] * Math.PI / 180); return Math.hypot(dx, dy); };
const offset = (p, m, deg) => { const r = deg * Math.PI / 180; return [p[0] + m * Math.cos(r) / 111320, p[1] + m * Math.sin(r) / (111320 * Math.cos(p[0] * Math.PI / 180))]; };
function inPoly(lat, lon, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c; } return c; }

// ---------------------------------------------------------------- gazetteer (from the scenario file + the run's segments)
const STOP = new Set(["i", "w", "z", "pod", "nad", "na", "do", "od", "ipp", "pttk", "przy", "oraz", "the"]);
const stem = (w) => /^\d/.test(w) ? w : w.length <= 2 ? w : w.length === 3 ? w.slice(0, 2) : w.length <= 5 ? w.slice(0, w.length - 1) : w.slice(0, Math.max(5, w.length - 2));
const GENERIC = new Set(["gran", "staw", "dolina", "szlak", "potok", "las", "droga", "dolna", "gorna", "zleb", "hala", "przelecz"]);
const SPLIT = /\s*(?:\/|,|\s-\s|\si\s)\s*/;
const words = (s) => fold(s).match(/[a-z0-9]+/g) || [];
export function gazetteer(scn, run) {
  const G = [], T = (scn && scn.terrain) || {}, segs = segList(run, scn);
  const add = (name, p, kind, r, prio) => { if (!name || !p || !isFinite(p[0])) return; const st = words(name).filter((w) => !STOP.has(w)).map(stem); if (!st.length) return; G.push({ name: name.trim(), p, kind, r, prio, st }); };
  for (const l of T.lakes || []) add(l.name, l.center, "staw", (l.radiusM || 200) + 100, 3);
  for (const h of T.huts || []) add(h.name, h.at, "schronisko", 200, 3);
  for (const s of T.streams || []) if (s.points && s.points.length) add(s.name, s.points[Math.floor(s.points.length / 2)], "potok / żleb", 350, 2);
  for (const s of T.ridges || []) if (s.points && s.points.length) add(s.name, s.points[Math.floor(s.points.length / 2)], "grań", 600, 2);
  for (const t of T.trails || []) {   // "Niebieski: Pięć Stawów - Zawrat": the named ends are places
    const parts = String(t.name || "").split(":").pop().split(/\s+-\s+/).map((x) => x.trim()).filter(Boolean), P = t.points || [];
    if (P.length < 2 || parts.length < 2) continue;
    parts.forEach((n, i) => add(n, P[Math.round(i * (P.length - 1) / (parts.length - 1))], "szlak", 250, 3));
    const col = String(t.name || "").split(":")[0]; if (/^(niebieski|zielony|czerwony|zolty|zółty|żółty|czarny)/i.test(col)) add("szlak " + col.split("/")[0], P[Math.floor(P.length / 2)], "szlak", 700, 2);   // "na szlaku niebieskim"
  }
  for (const s of segs) {   // each part of a sector name ("Zmarzły Staw / Kozia Dolinka") points at the sector
    add(s.name, s.c, "sektor", 500, 1);
    for (const part of s.name.split(SPLIT)) if (part && part !== s.name && !words(part).every((w) => GENERIC.has(w) || STOP.has(w))) add(part, s.c, "sektor", 500, 1);
  }
  if (scn && scn.ipp && scn.ipp.at) add("IPP", scn.ipp.at, "IPP", 200, 2);
  // lakes, streams and ridges in the scenario terrain are schematic; when a sector carries the same name ("Czarny Staw" ->
  // S5 Czarny Staw Polski, "Grań Orlej Perci" -> S10 Kozi Wierch - Orla Perć) the sector's seed is the place (nearest such sector)
  const sw = (a, b) => a.every((x) => b.some((w) => w.startsWith(x)));
  for (const g of G) {
    if (!["staw", "potok / żleb", "grań"].includes(g.kind)) continue;
    const gw = words(g.name).filter((w) => !STOP.has(w));
    let best = null, bd = 1e9;
    for (const sg of G) if (sg.kind === "sektor" && sg.st.length && (sw(sg.st, gw) || sw(g.st, words(sg.name)))) { const s = segs.find((x) => x.name === sg.name || x.name.split(SPLIT).includes(sg.name)); if (s && s.c) { const d = dist(g.p, s.c); if (d < bd) { bd = d; best = s; } } }
    if (best) { g.p = best.c.slice(); g.r = Math.max(g.r, 400); }
  }
  return { G, segs };
}
function segList(run, scn) {
  const S = run && run.steps && run.steps[run.steps.length - 1], seeds = {};
  for (const s of (scn && scn.segments) || []) seeds[s.id] = s.seed;
  return ((S && S.segments) || (scn && scn.segments) || []).map((s) => {
    let c = seeds[s.id];
    if (!c && s.polygon && s.polygon.length) { let a = 0, b = 0; for (const [x, y] of s.polygon) { a += y; b += x; } c = [a / s.polygon.length, b / s.polygon.length]; }
    return { id: s.id, name: s.name, poly: s.polygon || null, c };
  });
}
export function segAt(segs, p) { const s = segs.find((x) => x.poly && inPoly(p[0], p[1], x.poly)); if (s) return s; let best = null, bd = 1e9; for (const x of segs) if (x.c) { const d = dist(p, x.c); if (d < bd) { bd = d; best = x; } } return bd < 800 ? best : null; }
// all place mentions in the text: [{g, i (word index), n (words used)}], longest / most specific first, no overlaps
function findPlaces(W, G) {
  const hits = [];
  for (const g of G) {
    for (let i = 0; i < W.length; i++) {
      if (!W[i].startsWith(g.st[0])) continue;
      let j = i, ok = true;
      for (let k = 1; k < g.st.length; k++) { let f = -1; for (let q = j + 1; q <= Math.min(W.length - 1, j + 2); q++) if (W[q].startsWith(g.st[k])) { f = q; break; } if (f < 0) { ok = false; break; } j = f; }
      if (ok) hits.push({ g, i, end: j, score: g.st.length * 10 + g.prio });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.i - b.i);
  const used = new Set(), out = [];
  for (const h of hits) { let free = true; for (let k = h.i; k <= h.end; k++) if (used.has(k)) free = false; if (!free) continue; for (let k = h.i; k <= h.end; k++) used.add(k); out.push(h); }
  return out.sort((a, b) => a.i - b.i);
}

// ---------------------------------------------------------------- the parser (rules only; deterministic)
const RX = {
  found: /\b(znalezion[aoy]?|znalez(li|lismy|l|la)\s+(go|ja|osob|zaginion|turyst)|odnalez|zywy|zywa|przytomn|nieprzytomn)/,
  person: /\b(go|ja|jego|osob\w*|zaginion\w*|poszukiwan\w*|turyst\w*|mezczyzn\w*|kobiet\w*|zywy|zywa|przytomn\w*|nieprzytomn\w*|ranny|ranna|cial\w*)\b/,
  search: /(przeszuk|sprawdz|przeczesa|przelecial|przelecie|przelot|spenetrow|obszedl|obeszl|przeszli|przeszedl przez)/,
  nothing: /(\bnic\b|pusto|bez (sladu|sladow|rezultatu|wyniku|efektu)|brak (sladow|sladu|wynik)|negatyw|nie znalez|nikogo|czysto)/,
  sight: /(widzia|widzie|widziano|spotka|zauwaz|rozmawia|minal|minela|mijal|mijala|swiade|swiadk|widzial|wypatrz|slysza|slyszal|machal|wolal o pomoc)/,
  item: /(plecak|kurtk|czapk|rekawic|rekawiczk|\bbut\b|\bbuty\b|\bbuta\b|kijek|kijki|\bkij\b|latark|butelk|portfel|okular|\bmap[aeęy]\b|polar|szalik|chust|kask|czolowk|ubrani|odziez|sweter|bluz|termos|kurtke|telefon\w* (lezal|znalez)|dokument)/,
  cloth: /(kurtk|czapk|rekawic|\bbut\b|\bbuty\b|\bbuta\b|polar|szalik|chust|ubrani|odziez|sweter|bluz)/,
  trace: /(slad|odcisk|trop|krzyk|wolani|wolal|glos|gwizd|swiatl|swiecil|swiecila|blysk|zapach)/,
  phone: /(telefon|komork|bts|logowal|sygnal|112|gps z telefonu)/,
  weather: /(mgl|deszcz|snieg|wiatr|burz|widocznos|zmrok|ciemn|mroz|oblodz|temperatur|°|stopni|zadymk|whiteout|pada|leje|mzawk|grad|wichur|lod\b|oblodzenie|noc\b|zapada)/,
  status: /(uziemion|nie poleci|nie leci|nie moze|wraca|zawraca|wycofa|awari|bateri|rozladowa|gotow|dostepn|startuje|w drodze|wylecial|zmeczon|kontuzj|odpoczyn|przerw|niedostep|wystartowal|laduje|wymiana)/,
  dispatch: /(wyslij|skieruj|przydziel|niech\s+\w+\s+(idzie|sprawdzi|przeszuka)|posl[ij]|wysylam|kieruje)/,
  unsure: /(chyba|moze\b|mozliwe|prawdopodob|wydaje|nie jestem pew|z daleka|niepewn|podobn|jakby|raczej|nie wiem)/,
  sure: /(na pewno|dokladnie|pewn[aey]\b|gps|rozpoznal|na sto procent|wyraznie)/,
  move: /\b(szedl|szla\b|idzie|szli\b|schodzil|schodzila|wchodzil|wchodzila|zmierzal|zmierzala|kierowal|kierowala|wracal|wracala|poszedl|poszla|ruszyl|ruszyla|zszedl|zeszla|podchodzil|uciekal|biegl|wychodzil|wychodzila|wyszedl|wyszla|wyruszyl|wyruszyla|kierujac|idac)/,
  dirCue: /^(strone|kierunku|kierunek|ku)$/,
};
const BEAR = [["polnocny wschod", 45], ["polnocno wschod", 45], ["polnocny zachod", 315], ["polnocno zachod", 315], ["poludniowy wschod", 135], ["poludniowo wschod", 135], ["poludniowy zachod", 225], ["poludniowo zachod", 225], ["polnoc", 0], ["poludni", 180], ["wschod", 90], ["zachod", 270]];
export const KINDS = {
  sighting: { label: "Obserwacja osoby", ico: "👁", api: "swiadek" },
  clue: { label: "Ślad / przedmiot", ico: "🎒", api: "znalezisko" },
  search: { label: "Przeszukane, nic", ico: "✓", api: null },
  found: { label: "ZNALEZIONO", ico: "!", api: "znaleziono" },
  weather: { label: "Pogoda", ico: "☁", api: null },
  status: { label: "Status zespołu", ico: "⚑", api: null },
  dispatch: { label: "Wyślij zespół", ico: "→", api: null },
};
const CLUE_TYPES = [["odziez", "Odzież"], ["znalezisko", "Przedmiot"], ["slad", "Ślad / głos / światło"], ["telefon", "Sygnał telefonu"], ["swiadek", "Świadek"]];

// ctx: { G, segs, resources, clock (HH:MM now), start (HH:MM), lastWeather }
export function parse(text, ctx) {
  const f = fold(text), W = [], C = [];   // words and their clause (split at , . ; ! ?)
  { let c = 0; for (const m of f.matchAll(/[a-z0-9]+|[,.;!?]/g)) { if (/[a-z0-9]/.test(m[0])) { W.push(m[0]); C.push(c); } else c++; } }
  const ev = { text, kind: null, conf: "średnia", why: [] };
  // time: "o 14:20", "od 16:00", "ok. 18.40"; relative "20 min temu", "godzinę temu", "przed chwilą"
  const tm = [...f.matchAll(/(?:^|[^\d.,:])(od|o|okolo|ok\.?|godz\.?|przed|po)?\s*([01]?\d|2[0-3])[:.]([0-5]\d)(?![\d])/g)];
  if (tm.length) { const m = tm[0]; ev.t = String(+m[2]).padStart(2, "0") + ":" + m[3]; ev.tFrom = m[1] === "od"; ev.why.push("godzina z tekstu"); }
  else {
    const now = minOf(ctx.clock || "12:00"); let d = null;
    const mm = f.match(/(\d+)\s*(min|minut\w*)\s*temu/), hh = f.match(/(\d+)\s*(h|godz\w*)\s*temu/);
    if (mm) d = +mm[1]; else if (hh) d = +hh[1] * 60; else if (/pol godziny temu/.test(f)) d = 30; else if (/godzin[eay]? temu/.test(f)) d = 60; else if (/(przed chwila|wlasnie|teraz|w tej chwili)/.test(f)) d = 0;
    if (d != null) { ev.t = hm(now - d); ev.why.push(d ? `${d} min temu` : "teraz"); }
  }
  // kind
  const isItem = RX.item.test(f), isTrace = RX.trace.test(f), isSight = RX.sight.test(f), isNothing = RX.nothing.test(f), isSearch = RX.search.test(f);
  const res = findResource(f, ctx.resources || []);
  if (RX.found.test(f) && !isItem && !/nie (znalez|odnalez)/.test(f) && (RX.person.test(f) || /znalezion[oa]\b/.test(f) && !isTrace)) ev.kind = "found";
  else if (RX.dispatch.test(f) && res) ev.kind = "dispatch";
  else if ((isSearch || isNothing) && !isSight && !(isItem && !isNothing) && !(isTrace && !isNothing)) ev.kind = "search";
  else if (isSight && (!isItem || /\b(go|ja|jego|kogos|ktos|osob\w*|mezczyzn\w*|kobiet\w*|turyst\w*|czlowiek\w*|chlopak\w*|starsz\w*)\b/.test(f))) ev.kind = "sighting";
  else if (isItem || isTrace || (RX.phone.test(f) && !RX.status.test(f))) ev.kind = "clue";
  else if (res && RX.status.test(f)) ev.kind = "status";
  else if (RX.weather.test(f)) ev.kind = "weather";
  else if (/(kogos|ktos|osob|turyst|mezczyzn|kobiet|\bgo\b|\bja\b|\bbyl\b|\bbyla\b)/.test(f) && (RX.move.test(f) || /\b(byl|byla|stal|stala|siedzial|siedziala|lezal|lezala|odpoczywal|czekal)\b/.test(f))) ev.kind = "sighting";
  if (ev.kind === "clue") {
    ev.clueType = /(swiecil|swiecila|blysk|swiatl)/.test(f) ? "slad" : RX.cloth.test(f) ? "odziez" : isItem ? "znalezisko" : RX.phone.test(f) && !isTrace ? "telefon" : "slad";
    const it = f.match(/(plecak|kurtk\w*|czapk\w*|rekawiczk\w*|rekawic\w*|\bbut\w*|kij\w*|latark\w*|butelk\w*|portfel|okular\w*|map[aey]|polar|szalik|chust\w*|kask|czolowk\w*|termos|telefon|sweter|bluz\w*|slad\w*|trop|krzyk|wolanie|glos|gwizd\w*|swiatl\w*|odcisk\w*)/);
    ev.item = it ? text.slice(f.indexOf(it[0]), f.indexOf(it[0]) + it[0].length) : null;
  }
  if (ev.kind === "status" || ev.kind === "dispatch" || ev.kind === "search") ev.team = res;
  if (ev.kind === "search") { ev.drone = /dron|przelot|przelecial|przelecie|termowiz/.test(f); ev.pod = ev.drone ? 0.6 : /(pies|psem|psa\b)/.test(f) ? 0.8 : /(pobiezn|szybko|mgl|ciemn)/.test(f) ? 0.4 : /(dokladn|szczegol|tyralier)/.test(f) ? 0.8 : 0.6; const p = f.match(/pod\s*(\d{2})\s*%/); if (p) ev.pod = +p[1] / 100; }
  // confidence
  if (RX.unsure.test(f)) { ev.conf = "niska"; ev.why.push("„chyba / może” - większy promień"); }
  else if (RX.sure.test(f)) { ev.conf = "wysoka"; ev.why.push("pewna obserwacja - mniejszy promień"); }
  // sectors by id ("S3", "s 12")
  const ids = [...f.matchAll(/\bs\s?(\d{1,2})\b/g)].map((m) => "S" + +m[1]).filter((id) => ctx.segs.some((s) => s.id === id));
  // places: the ones after a direction cue are the direction, the rest are where
  // "w stronę X", "w kierunku X" = direction; "na X" / "do X" = direction only right after a motion verb in the same clause
  // ("szedł na Zawrat", "schodził do Doliny"), else a place ("na Zawracie był"); "od X" (szedł od X) = where he was
  const P = findPlaces(W, ctx.G), moving = RX.move.test(f);
  let place = null, dir = null;
  const verbBefore = (i) => { for (let k = i - 1; k >= Math.max(0, i - 4) && C[k] === C[i]; k--) if (RX.move.test(W[k])) return true; return false; };
  for (const h of P) {
    const gen = /^(dolin|przelecz|szlak|schronisk|hal[aiey]|stron|kierunk|grani?|potok|zleb|jezior|wierch|szczyt)/;
    const j = gen.test(W[h.i - 1] || "") && !RX.dirCue.test(W[h.i - 1]) ? h.i - 1 : h.i;   // "do Doliny Pięciu Stawów": the cue sits before the generic noun
    const b1 = W[j - 1] || "", b2 = W[j - 2] || "";
    const isDir = RX.dirCue.test(b1) || RX.dirCue.test(b2) && /^(w|na)$/.test(b1) || (/^(do|ku)$/.test(b1) && verbBefore(j - 1)) || (/^(na|pod)$/.test(b1) && verbBefore(j - 1) && !/(ie|ach|ym|im)$/.test(W[j]));
    if (isDir && !dir) dir = h.g; else if (!place && !isDir) place = h.g;
  }
  if (!place && dir && !moving) { place = dir; dir = null; }
  // coordinates "49.2165, 20.0300" win over names
  const c = text.match(/(4[89]|5[0-5])[.,](\d{3,6})[,;\s]+(1[4-9]|2[0-4])[.,](\d{3,6})/);
  if (c) { ev.place = { name: "punkt GPS z tekstu", p: [+(c[1] + "." + c[2]), +(c[3] + "." + c[4])], r: 100, how: "gps" }; ev.conf = "wysoka"; }
  else if (place) ev.place = { name: place.name, p: place.p.slice(), r: place.r, kind: place.kind, how: "nazwa" };
  else if (ids.length && ev.kind !== "search") { const s = ctx.segs.find((x) => x.id === ids[0]); if (s && s.c) ev.place = { name: `${s.id} ${s.name}`, p: s.c.slice(), r: 500, how: "sektor" }; }
  // "200 m na północ od schroniska", "1 km na wschód od X"
  const om = f.match(/(\d+(?:[.,]\d+)?)\s*(km|m|metr\w*)\s+(?:na\s+|w\s+strone\s+)?((?:polnocn\w*|poludniow\w*)?[\s-]*(?:polnoc|poludni|wschod|zachod)\w*)/);
  if (om && ev.place) {
    const m = +om[1].replace(",", ".") * (om[2] === "km" ? 1000 : 1), b = BEAR.find(([k]) => fold(om[3]).replace(/[\s-]+/g, " ").includes(k));
    if (b && m > 0 && m < 20000) { ev.place.p = offset(ev.place.p, m, b[1]); ev.place.name = `${Math.round(m)} m na ${["północ", "pn-wsch", "wschód", "pd-wsch", "południe", "pd-zach", "zachód", "pn-zach"][Math.round(b[1] / 45) % 8]} od: ${ev.place.name}`; ev.place.r = Math.max(150, m * 0.35); ev.place.how = "odległość od nazwy"; }
  }
  if (dir) ev.dir = { name: dir.name, p: dir.p.slice() };
  if (!ev.kind && (place || dir) && (moving || /\b(byl|byla|stal|stala|siedzial|siedziala|lezal|lezala|odpoczywal|czekal)\b/.test(f))) ev.kind = "sighting";   // "szedł na Zawrat o 12:30"
  // radius by kind and confidence
  if (ev.place) {
    let r = ev.place.r;
    if (ev.kind === "sighting") r = Math.max(r, 400); if (ev.kind === "found") r = 30;
    if (ev.kind === "clue" && ev.place.how === "nazwa") r = Math.max(200, Math.min(r, 400));
    if (ev.conf === "niska" && ev.kind !== "found") r *= 1.6; if (ev.conf === "wysoka" && ev.kind !== "found" && ev.place.how !== "gps") r *= 0.7;
    ev.place.r = Math.round(r / 10) * 10;
    const s = segAt(ctx.segs, ev.place.p); if (s) ev.place.seg = s.id;
  }
  // sectors for "przeszukane, nic": ids, else the sectors of the named places
  if (ev.kind === "search" && !ids.length && !P.length && !res) ev.kind = null;   // "nic nie wiem"
  if (ev.kind === "search") {
    const set = new Set(ids);
    for (const h of P) { const s = h.g.kind === "sektor" ? ctx.segs.find((x) => x.name === h.g.name || x.name.includes(h.g.name)) || segAt(ctx.segs, h.g.p) : segAt(ctx.segs, h.g.p); if (s) set.add(s.id); }
    ev.segs = [...set];
  }
  if (ev.kind === "dispatch") ev.segs = ids.length ? ids : ev.place && ev.place.seg ? [ev.place.seg] : [];
  // weather numbers
  if (ev.kind === "weather" || ev.kind === "status") {
    const L = ctx.lastWeather || {}, w = {};
    const vis = f.match(/widocznos\w*\s*(?:do|ok\.?|okolo)?\s*(\d+)\s*(m|km)?/) || f.match(/(\d+)\s*m\s*widocznos/);
    if (vis) w.visibilityM = +vis[1] * (vis[2] === "km" ? 1000 : 1); else if (/(mgl|zadymk|whiteout)/.test(f)) w.visibilityM = /gest|bardzo/.test(f) ? 30 : 80;
    const wind = f.match(/(\d+)\s*m\/s/) || f.match(/wiatr\w*\s*(?:do|ok\.?)?\s*(\d+)\s*km\/h/); if (wind) w.windMs = /km\/h/.test(wind[0]) ? Math.round(+wind[1] / 3.6) : +wind[1]; else if (/(wichur|silny wiatr|halny)/.test(f)) w.windMs = 15;
    const tc = f.match(/(minus\s*|-|\+)?\s*(\d{1,2})\s*(°|stopn|st\.?\s?c)/); if (tc) w.tempC = (tc[1] && /minus|-/.test(tc[1]) ? -1 : 1) * +tc[2]; else if (/mroz/.test(f)) w.tempC = -3;
    if (/(snieg|zadymk|sypie)/.test(f)) w.precip = "snow"; else if (/(deszcz|pada|leje|mzawk|ulew)/.test(f)) w.precip = "rain";
    if (/(zmrok|ciemn|noc\b|zapada)/.test(f)) w.dark = true; if (/(oblodz|lod\b|slisko|szadz)/.test(f)) w.ice = true;
    if (Object.keys(w).length) ev.weather = { visibilityM: L.visibilityM ?? 1000, windMs: L.windMs ?? 5, tempC: L.tempC ?? 5, precip: L.precip || "none", dark: !!L.dark, ice: !!L.ice, ...w, given: Object.keys(w) };
    if (ev.kind === "status") ev.available = /(gotow|dostepn|startuje|w drodze|wylecial|wystartowal)/.test(f) && !/(nie |niedostep)/.test(f);
  }
  if (ev.kind === "sighting" || ev.kind === "clue") ev.seenAt = ev.t || null;
  ev.missing = [];
  if (["sighting", "clue", "found"].includes(ev.kind) && !ev.place) ev.missing.push("place");
  if (ev.kind === "sighting" && !ev.t) ev.missing.push("time");
  if (ev.kind === "search" && !(ev.segs && ev.segs.length)) ev.missing.push("segs");
  if (ev.kind === "dispatch" && !(ev.segs && ev.segs.length)) ev.missing.push("segs");
  return ev;
}
function findResource(f, R) {
  const m = f.match(/\b(zespol\w*|patrol\w*|topr|gopr|wopr|ekip\w*|grup\w*|druzyn\w*)\s+(?:nr\.?\s*)?([a-z]|\d{1,2})\b/);
  if (m) { const k = m[2]; const r = R.find((x) => new RegExp(`[\\s-]${k}(\\b|$)`).test(fold(x.id)) || new RegExp(`\\b${k}\\b`).test(fold((x.name || "").split("(")[0]).replace(/^(patrol|zespol)\s+(topr|gopr|wopr)?\s*/, ""))); if (r) return { id: r.id, name: r.name }; }
  const byType = [[/(smiglow|heli\b|helikop|sokol)/, "heli"], [/\bdron\w*/, "drone"], [/(\bpies|\bpsem|\bpsa\b|przewodnik\w* z psem|k9)/, "dog"]];
  for (const [rx, ty] of byType) if (rx.test(f)) { const r = R.find((x) => x.type === ty); if (r) return { id: r.id, name: r.name }; }
  return null;
}

// ---------------------------------------------------------------- what the card says, what gets posted
const short = (n) => String(n || "").split(" (")[0];
export function summary(ev) {
  const P = ev.place, at = ev.t ? ` o ${ev.t}` : "";
  switch (ev.kind) {
    case "sighting": return `Na mapie zaznaczę: osoba widziana${at}${P ? ` - ${P.name}` : ""}${P ? ` (±${P.r} m)` : ""}${ev.dir ? `, kierunek: ${ev.dir.name}` : ""}.`;
    case "clue": return `Na mapie zaznaczę: ${CLUE_TYPES.find((c) => c[0] === ev.clueType)?.[1].toLowerCase() || "ślad"}${ev.item ? ` (${ev.item})` : ""}${P ? ` - ${P.name} (±${P.r} m)` : ""}${at}.`;
    case "found": return `ZNALEZIONO${P ? ` - ${P.name}` : ""}${at}. To zamyka akcję: mapa skupi się w tym miejscu.`;
    case "search": return `Oznaczę jako przeszukane bez wyniku: ${(ev.segs || []).join(", ") || "?"}${ev.team ? ` (${short(ev.team.name)})` : ""}, skuteczność ok. ${Math.round((ev.pod || 0.6) * 100)}%${at}.`;
    case "weather": { const w = ev.weather || {}, g = new Set(w.given || []); const b = []; if (g.has("visibilityM")) b.push(`widoczność ${w.visibilityM} m`); if (g.has("windMs")) b.push(`wiatr ${w.windMs} m/s`); if (g.has("tempC")) b.push(`${w.tempC > 0 ? "+" : ""}${w.tempC}°C`); if (g.has("precip")) b.push(w.precip === "snow" ? "śnieg" : "deszcz"); if (g.has("dark")) b.push("zmrok"); if (g.has("ice")) b.push("oblodzenie"); return `Zmiana pogody${at}: ${b.join(", ") || "?"}. Wpływa na skuteczność zespołów, drona i śmigłowca.`; }
    case "status": return `Status: ${ev.team ? short(ev.team.name) : "zespół"} - ${ev.available ? "gotowy / w drodze" : "niedostępny"}${ev.weather ? `, wiatr ${ev.weather.windMs} m/s` : ""}${at}.`;
    case "dispatch": return `Wyślę ${ev.team ? short(ev.team.name) : "zespół"} do ${(ev.segs || []).join(", ") || "?"}.`;
  }
  return "";
}
const sanitize = (s) => String(s || "").replace(/odnalezion\w*|znalezion\w*|znalez\w*/gi, "jest").replace(/\s+/g, " ").trim().slice(0, 190);
function noteOf(ev) {
  const P = ev.place, bits = [];
  if (ev.item) bits.push(ev.item); if (P) bits.push(P.name.replace(/^punkt GPS z tekstu$/, "GPS")); if (ev.seenAt) bits.push("widziany " + ev.seenAt); if (ev.dir) bits.push("kierunek " + ev.dir.name);
  bits.push("[czat]");
  return ev.kind === "found" ? ("ZNALEZIONO: " + bits.join(", ")).slice(0, 190) : sanitize(bits.join(", "));
}
// scenario events (Historia what-if, Studio): same providers and fields as scenarios/*.json
function scenarioEvents(ev, at, n, ctx) {
  const P = ev.place, title = (k) => `Czat ${n}: ${k}`, out = [];
  if (ev.kind === "sighting" && P) {
    out.push({ provider: "Clue", at, title: title(`świadek - ${P.name}${ev.seenAt ? " o " + ev.seenAt : ""}`), detail: "Czat: " + ev.text, point: P.p, radiusM: P.r, clueKind: "sighting", ...(ev.seenAt ? { seenAt: ev.seenAt } : {}) });
    if (ev.dir) out.push({ provider: "TripPlan", at, title: title(`kierunek marszu: ${ev.dir.name}`), detail: "Czat: " + ev.text, points: route(P.p, ev.dir.p, ctx), radiusM: 300 });
  }
  if (ev.kind === "clue" && P) out.push({ provider: "Clue", at, title: title(`${CLUE_TYPES.find((c) => c[0] === ev.clueType)?.[1] || "Ślad"}${ev.item ? " (" + ev.item + ")" : ""} - ${P.name}`), detail: "Czat: " + ev.text, point: P.p, radiusM: P.r, clueKind: "trace", ...(ev.seenAt ? { seenAt: ev.seenAt } : {}) });
  if (ev.kind === "found" && P) out.push({ provider: "Found", at, title: title(`ZNALEZIONO - ${P.name}`), detail: "Czat: " + ev.text, point: P.p, radiusM: 30 });
  if (ev.kind === "search" && ev.segs && ev.segs.length) out.push({ provider: ev.drone ? "DronePassEmpty" : "SegmentSearched", at, title: title(`${ev.team ? short(ev.team.name) + ": " : ""}${ev.segs.join(", ")} przeszukane, nic`), detail: "Czat: " + ev.text, segments: ev.segs, pod: ev.pod || 0.6 });
  if ((ev.kind === "weather" || ev.kind === "status") && ev.weather) {
    const w = ev.weather; out.push({ provider: "WeatherConditions", at, title: title(summary({ ...ev, kind: "weather", t: null }).replace(/\. Wpływa.*$/, "")), detail: "Czat: " + ev.text, visibilityM: w.visibilityM, windMs: w.windMs, tempC: w.tempC, precip: w.precip, dark: w.dark, ice: w.ice });
    if ((w.given || []).includes("visibilityM") && w.visibilityM < 200) out.push({ provider: "Weather", at, title: title("mgła - osoba trzyma się szlaku"), detail: "Czat: " + ev.text, factor: 1.2 });
  }
  return out;
}
// a direction "szedł w stronę Zawratu": along the scenario trail that passes both points, else a straight line
function route(a, b, ctx) {
  let best = null;
  for (const t of (ctx.scn && ctx.scn.terrain && ctx.scn.terrain.trails) || []) {
    const P = t.points || []; if (P.length < 2) continue;
    const near = (p) => { let k = -1, d = 1e9; P.forEach((q, i) => { const x = dist(p, q); if (x < d) { d = x; k = i; } }); return [k, d]; };
    const [i, di] = near(a), [j, dj] = near(b);
    if (di < 900 && dj < 600 && i !== j && (!best || di + dj < best.d)) best = { d: di + dj, pts: i < j ? P.slice(i, j + 1) : P.slice(j, i + 1).reverse() };
  }
  const pts = best ? best.pts : [a, b];
  return [a, ...pts.filter((p) => dist(p, a) > 30), b].map((p) => [+p[0].toFixed(5), +p[1].toFixed(5)]);
}

// ---------------------------------------------------------------- rankings
function ranking(run, at, start) {
  if (!run || !run.steps || !run.steps.length) return [];
  let S = run.steps[run.steps.length - 1];
  if (at != null) { const m = rel(at, start); S = run.steps[0]; for (const s of run.steps) { const sm = rel(s.t, start); if (sm <= m && s.kind !== "found") S = s; } }
  return [...S.segments].sort((a, b) => b.poa - a.poa);
}
function diffHTML(before, after, ev) {
  const rb = new Map(before.map((s, i) => [s.id, i + 1])), ra = new Map(after.map((s, i) => [s.id, i + 1]));
  const top = after.slice(0, 3).map((s, i) => { const was = rb.get(s.id), mv = was == null ? "" : was > i + 1 ? `<span class="up">▲ było ${was}.</span>` : was < i + 1 ? `<span class="down">▼ było ${was}.</span>` : `<span class="same">bez zmian</span>`;
    return `<li data-seg="${esc(s.id)}"><b>${i + 1}. ${esc(s.id)} ${esc(s.name)}</b> <span class="area">${pl1(+s.areaPct || 0)}% obszaru</span> ${mv}</li>`; }).join("");
  const moves = [];
  for (const s of before.slice(0, 3)) { const a = ra.get(s.id), b = rb.get(s.id); if (a > 3) moves.push(`${s.id} spadł z ${b}. na ${a}. miejsce`); }
  for (const s of after.slice(0, 3)) { const a = ra.get(s.id), b = rb.get(s.id); if (b > 3) moves.push(`${s.id} awansował z ${b}. na ${a}. miejsce`); }
  for (const id of (ev.segs || [])) { const a = ra.get(id), b = rb.get(id); if (a && b && a !== b && !moves.some((m) => m.startsWith(id + " "))) moves.push(`${id} ${a > b ? "spadł" : "awansował"} z ${b}. na ${a}. miejsce`); }
  const same = after.slice(0, 3).every((s, i) => rb.get(s.id) === i + 1), a0 = after[0];
  const head = !a0 ? "" : rb.get(a0.id) !== 1 ? `<div class="ch-head1">Nowy nr 1: <b>${esc(a0.id)} ${esc(a0.name)}</b>${rb.get(a0.id) ? ` (było ${rb.get(a0.id)}.)` : ""}</div>` : `<div class="ch-head1 same">Nr 1 bez zmian: <b>${esc(a0.id)} ${esc(a0.name)}</b></div>`;
  return `<div class="ch-top">${head}<div class="ch-h">Gdzie szukać najpierw - teraz</div><ol>${top}</ol>${moves.length ? `<div class="ch-moves">${moves.map(esc).join(" · ")}</div>` : same ? `<div class="ch-moves">Kolejność top 3 bez zmian - wskazówka wzmocniła obecny plan.</div>` : ""}</div>`;
}

// ---------------------------------------------------------------- mini map (SVG, no tiles): sectors, trails, lakes, the point
function miniMap(ctx, ev) {
  const segs = ctx.segs.filter((s) => s.poly), W = 300, H = 170;
  if (!segs.length) return "";
  let w = 180, e = -180, s = 90, n = -90;
  const ext = (lat, lon) => { w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); n = Math.max(n, lat); };
  for (const g of segs) for (const [x, y] of g.poly) ext(y, x);
  const k = Math.cos((s + n) / 2 * Math.PI / 180), sc = Math.min(W / ((e - w) * k), H / (n - s)) * 0.96, ox = (W - (e - w) * k * sc) / 2, oy = (H - (n - s) * sc) / 2;
  const X = (lon) => (ox + (lon - w) * k * sc).toFixed(1), Y = (lat) => (oy + (n - lat) * sc).toFixed(1), mpp = 111320 / sc;
  const hot = new Set([...(ev.segs || []), ev.place && ev.place.seg].filter(Boolean));
  let g = segs.map((x) => `<path d="M${x.poly.map(([lo, la]) => X(lo) + "," + Y(la)).join("L")}Z" class="${hot.has(x.id) ? "hot" : ""}"><title>${esc(x.id + " " + x.name)}</title></path>`).join("");
  for (const t of (ctx.scn && ctx.scn.terrain && ctx.scn.terrain.trails) || []) g += `<polyline class="tr" points="${(t.points || []).map(([la, lo]) => X(lo) + "," + Y(la)).join(" ")}"/>`;
  for (const x of segs) if (hot.has(x.id) && x.c) g += `<text class="lb" x="${X(x.c[1])}" y="${Y(x.c[0])}">${esc(x.id)}</text>`;
  if (ev.place) {
    const P = ev.place.p, r = Math.max(3, ev.place.r / mpp);
    if (ev.dir) { const D = route(P, ev.dir.p, ctx); g += `<polyline class="dir" points="${D.map(([la, lo]) => X(lo) + "," + Y(la)).join(" ")}" marker-end="url(#chArr)"/>`; }
    g += `<circle class="${ev.kind === "found" ? "fd" : "pt"}" cx="${X(P[1])}" cy="${Y(P[0])}" r="${r.toFixed(1)}"/><circle class="pc" cx="${X(P[1])}" cy="${Y(P[0])}" r="3"/>`;
  }
  return `<svg class="ch-mini" viewBox="0 0 ${W} ${H}" role="img" aria-label="Podgląd miejsca na mapie"><defs><marker id="chArr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" class="ah"/></marker></defs>${g}</svg>`;
}

// ---------------------------------------------------------------- the chat UI (shared by both hosts)
export const EXAMPLES = {
  zawrat: [
    "Turystka widziała go o 14:20 przy Czarnym Stawie, szedł w stronę Zawratu",
    "Zespół B przeszukał S3, nic",
    "Znaleziono plecak 200 m na północ od schroniska",
    "Mgła od 16:00, widoczność 50 m",
    "Zespół z psem przeszukał Zmarzły Staw i Kozią Dolinkę, nic",
    "Czerwona czapka w żlebie pod Zawratem, o 19:10",
    "Śmigłowiec uziemiony, wiatr 18 m/s",
    "Chyba widziałem kogoś z czołówką na grani Orlej Perci 20 min temu",
  ],
};
const EX_GENERIC = ["Widziałem kogoś przy schronisku 30 min temu", "Zespół A przeszukał S1, nic", "Mgła, widoczność 50 m"];

export function createChat(root, host, opts = {}) {
  let ctx = null, ctxKey = "", n = 0, draft = null;
  const done = [];   // added: [{n, ev, how: live|sim|studio, undo: async fn, label}]
  root.innerHTML = `<div class="ch-log" aria-live="polite"></div>
    <div class="ch-chips" aria-label="Przykłady"></div>
    <form class="ch-in"><textarea rows="2" placeholder="${esc(opts.placeholder || "Napisz, co się stało, np. „widziałem go o 14:20 przy Czarnym Stawie”")}" aria-label="Wiadomość"></textarea><button class="ch-send" type="submit" aria-label="Wyślij">➤</button></form>`;
  const log = root.querySelector(".ch-log"), ta = root.querySelector("textarea"), chips = root.querySelector(".ch-chips");
  const scroll = () => { log.scrollTop = log.scrollHeight; };
  const say = (html, who = "bot", cls = "") => { const d = document.createElement("div"); d.className = `ch-msg ${who} ${cls}`; d.innerHTML = html; log.appendChild(d); scroll(); return d; };
  root.querySelector("form").onsubmit = (e) => { e.preventDefault(); const t = ta.value.trim(); ta.value = ""; onText(t); };
  ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); root.querySelector("form").requestSubmit(); } };
  function renderChips() {
    const ex = EXAMPLES[host.scenario()] || EX_GENERIC;
    chips.innerHTML = ex.map((t) => `<button type="button" class="ch-chip">${esc(t)}</button>`).join("");
    chips.querySelectorAll("button").forEach((b) => b.onclick = () => onText(b.textContent));
  }
  async function ensureCtx() {
    const sc = host.scenario(), run = host.run(), key = sc + "|" + (run && run.steps ? run.steps.length : 0);
    if (ctx && ctxKey === key) return ctx;
    let scn = ctx && ctx.sc === sc ? ctx.scn : null;
    if (!scn) { try { scn = await (await fetch(`/scenarios/${encodeURIComponent(sc)}.json`, { cache: "no-cache" })).json(); } catch (e) { scn = null; } }
    const { G, segs } = gazetteer(scn, run);
    const S = run && run.steps && run.steps[run.steps.length - 1];
    ctx = { sc, scn, G, segs, resources: (S && S.resources) || (scn && scn.resources) || [], start: (scn && scn.startClock) || (run && run.steps && run.steps[0] && run.steps[0].t) || "00:00" };
    ctxKey = key; renderChips(); return ctx;
  }
  function lastWeather(at) {
    let L = null; for (const e of (ctx.scn && ctx.scn.events) || []) if (e.provider === "WeatherConditions" && rel(e.at, ctx.start) <= rel(at, ctx.start)) L = e;
    for (const d of done) for (const e of d.events || []) if (e.provider === "WeatherConditions") L = e;
    return L || {};
  }
  // safe failure: whatever the parser or the card does with a message, the run and the action view stay as they were
  async function onText(t) {
    t = String(t ?? "").trim();
    if (!t) { say(`Napisz, co się stało - np. „widziałem go o 15:10 przy Wielkim Stawie” albo kliknij przykład poniżej.`, "bot", "empty"); return; }
    try { await onText1(t.slice(0, 500)); }
    catch (e) { draft = null; console.warn("czat:", e); say(`Nie udało się odczytać tej wiadomości - mapa i akcja bez zmian. Spróbuj prościej: <i>co</i>, <i>gdzie</i>, <i>kiedy</i>.`, "bot", "fail"); }
  }
  async function onText1(t) {
    say(esc(t), "me");
    await ensureCtx();
    const c = { ...ctx, clock: host.clock() }; c.lastWeather = lastWeather(c.clock);
    let ev = parse(t, c);
    // a follow-up answer fills what the last card was missing ("przy Wielkim Stawie", "o 15:10", "S4")
    if (draft && draft.ev.missing.length && (!ev.kind || ev.kind === draft.ev.kind)) {
      const d = draft.ev;
      if (!d.place && ev.place) d.place = ev.place; if (!d.dir && ev.dir) d.dir = ev.dir; if (!d.t && ev.t) { d.t = ev.t; if (["sighting", "clue"].includes(d.kind)) d.seenAt = ev.t; }
      if ((d.kind === "search" || d.kind === "dispatch") && ev.segs && ev.segs.length) d.segs = ev.segs; else if ((d.kind === "search" || d.kind === "dispatch") && ev.place && ev.place.seg) d.segs = [ev.place.seg];
      if (d.place && !d.place.seg) { const s = segAt(ctx.segs, d.place.p); if (s) d.place.seg = s.id; }
      d.text += " / " + t; d.missing = d.missing.filter((m) => !(m === "place" && d.place) && !(m === "time" && d.t) && !(m === "segs" && d.segs && d.segs.length));
      ev = d;
    }
    if (!ev.kind) {
      draft = null;
      say(`Nie rozpoznałem, co się stało. Napisz jednym zdaniem: <i>kto / co</i>, <i>gdzie</i> (nazwa z mapy albo sektor S1-S20), <i>kiedy</i>. Np. „widziałem go o 15:10 przy Wielkim Stawie”, „S4 przeszukany, nic”, „znalazłem rękawiczkę przy schronisku”.${host.mode() === "live" ? ` <button class="ch-lnk" data-raw>Wyślij jako meldunek tekstowy</button> - serwer przeczyta go swoimi regułami i modelem językowym.` : ""}`).querySelector("[data-raw]")?.addEventListener("click", () => sendRaw(t));
      return;
    }
    card(ev);
  }
  function placeOptions(ev) {
    const seen = new Set(), o = [];
    for (const g of [...ctx.G].sort((a, b) => b.prio - a.prio || a.name.localeCompare(b.name, "pl"))) { if (seen.has(g.name) || g.name === "IPP") continue; seen.add(g.name); o.push(g); }
    return o;
  }
  function card(ev, into) {
    const k = KINDS[ev.kind], live = host.mode() === "live";
    const ask = ev.missing.includes("place") ? "Gdzie to było? Napisz nazwę (np. „przy Wielkim Stawie”) albo wybierz poniżej." : ev.missing.includes("segs") ? "Który sektor? Napisz np. „S4” albo nazwę miejsca." : ev.missing.includes("time") ? "O której? (np. „o 15:10”, „20 min temu”) - albo dodaj bez godziny." : "";
    const html = (`<div class="ch-card k-${ev.kind}"><div class="ch-kind"><span class="ico">${k.ico}</span>${esc(k.label)} <span class="conf c-${fold(ev.conf)}">pewność: ${esc(ev.conf)}</span></div>
      <div class="ch-sum">${esc(summary(ev))}</div>${miniMap(ctx, ev)}
      ${ask ? `<div class="ch-ask">${esc(ask)}</div>` : ""}
      <details class="ch-edit" ${ask ? "open" : ""}><summary>Popraw szczegóły</summary>${fieldsHTML(ev)}</details>
      <div class="ch-acts"><button class="ch-add primary" ${ev.missing.includes("place") || ev.missing.includes("segs") ? "disabled" : ""}>Dodaj${live ? " (na żywo)" : host.mode() === "hist" ? " (symulacja)" : ""}</button><button class="ch-no">Anuluj</button></div>
      <div class="ch-foot">${live ? "Na żywo: zobaczą to wszyscy w akcji. Możesz cofnąć." : host.mode() === "hist" ? "Historia: zmiana tylko na Twoim ekranie (symulacja), nagranie zostaje nietknięte." : ""}</div></div>`);
    let el = into; if (el) el.innerHTML = html; else el = say(html);
    draft = { ev, el };
    wireFields(el, ev);
    el.querySelector(".ch-no").onclick = () => { el.querySelector(".ch-card").classList.add("off"); el.querySelector(".ch-acts").innerHTML = `<span class="mute">Anulowano.</span>`; draft = null; };
    el.querySelector(".ch-add").onclick = () => commit(ev, el);
  }
  function fieldsHTML(ev) {
    const segOpts = (sel) => ctx.segs.map((s) => `<option value="${esc(s.id)}" ${sel.includes(s.id) ? "selected" : ""}>${esc(s.id)} ${esc(s.name)}</option>`).join("");
    let h = `<label>Rodzaj <select name="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${k === ev.kind ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</select></label>`;
    h += `<label>Godzina <input name="t" type="time" value="${esc(ev.t || "")}"></label>`;
    if (["sighting", "clue", "found"].includes(ev.kind)) {
      h += `<label>Miejsce <select name="place"><option value="">${ev.place ? esc(ev.place.name) : "- wybierz -"}</option>${placeOptions(ev).map((g) => `<option value="${esc(g.name)}">${esc(g.name)} (${esc(g.kind)})</option>`).join("")}</select></label>`;
      if (ev.kind !== "found") h += `<label>Promień m <input name="r" inputmode="numeric" value="${ev.place ? ev.place.r : 400}"></label>`;
      if (ev.kind === "clue") h += `<label>Typ <select name="clueType">${CLUE_TYPES.map(([k, l]) => `<option value="${k}" ${k === ev.clueType ? "selected" : ""}>${l}</option>`).join("")}</select></label>`;
      if (ev.kind === "sighting") h += `<label>Kierunek <select name="dir"><option value="">${ev.dir ? esc(ev.dir.name) : "- brak -"}</option><option value="-">- brak -</option>${placeOptions(ev).map((g) => `<option value="${esc(g.name)}">${esc(g.name)}</option>`).join("")}</select></label>`;
    }
    if (ev.kind === "search" || ev.kind === "dispatch") h += `<label>Sektory <select name="segs" ${ev.kind === "search" ? "multiple size=4" : ""}>${segOpts(ev.segs || [])}</select></label>`;
    if (ev.kind === "search") h += `<label>Skuteczność (POD) <input name="pod" inputmode="decimal" value="${ev.pod || 0.6}"></label>`;
    if (ev.kind === "status" || ev.kind === "dispatch" || ev.kind === "search") h += `<label>Zespół <select name="team"><option value="">-</option>${(ctx.resources || []).map((r) => `<option value="${esc(r.id)}" ${ev.team && ev.team.id === r.id ? "selected" : ""}>${esc(short(r.name))}</option>`).join("")}</select></label>`;
    if (ev.kind === "weather" && ev.weather) h += `<label>Widoczność m <input name="visibilityM" inputmode="numeric" value="${ev.weather.visibilityM}"></label><label>Wiatr m/s <input name="windMs" inputmode="numeric" value="${ev.weather.windMs}"></label>`;
    return `<div class="ch-fields">${h}</div>`;
  }
  function wireFields(el, ev) {
    const F = el.querySelector(".ch-fields"); if (!F) return;
    F.onchange = (e) => {
      const t = e.target, v = t.value;
      if (t.name === "kind") { ev.kind = v; ev.missing = []; if (["sighting", "clue", "found"].includes(v) && !ev.place) ev.missing.push("place"); if ((v === "search" || v === "dispatch") && !(ev.segs && ev.segs.length)) { ev.segs = ev.place && ev.place.seg ? [ev.place.seg] : []; if (!ev.segs.length) ev.missing.push("segs"); } if (v === "clue" && !ev.clueType) ev.clueType = "znalezisko"; if ((v === "weather") && !ev.weather) ev.weather = { visibilityM: 80, windMs: 8, tempC: 2, precip: "none", dark: false, ice: false, given: ["visibilityM"] }; if (v === "found" && ev.place) ev.place.r = 30; }
      if (t.name === "t") { ev.t = v || null; if (["sighting", "clue"].includes(ev.kind)) ev.seenAt = ev.t; }
      if (t.name === "place" && v) { const g = ctx.G.find((x) => x.name === v); if (g) { ev.place = { name: g.name, p: g.p.slice(), r: ev.kind === "found" ? 30 : Math.max(ev.kind === "sighting" ? 400 : 200, g.r), how: "wybrane" }; const s = segAt(ctx.segs, g.p); if (s) ev.place.seg = s.id; ev.missing = ev.missing.filter((m) => m !== "place"); } }
      if (t.name === "r" && ev.place && +v > 0) ev.place.r = Math.min(5000, Math.max(20, +v));
      if (t.name === "clueType") ev.clueType = v;
      if (t.name === "dir") { const g = ctx.G.find((x) => x.name === v); ev.dir = g ? { name: g.name, p: g.p.slice() } : null; }
      if (t.name === "segs") { ev.segs = [...t.selectedOptions].map((o) => o.value); ev.missing = ev.missing.filter((m) => m !== "segs"); }
      if (t.name === "pod" && +v > 0 && +v <= 1) ev.pod = +String(v).replace(",", ".");
      if (t.name === "team") { const r = ctx.resources.find((x) => x.id === v); ev.team = r ? { id: r.id, name: r.name } : null; }
      if ((t.name === "visibilityM" || t.name === "windMs") && ev.weather && +v >= 0) { ev.weather[t.name] = +v; ev.weather.given = [...new Set([...(ev.weather.given || []), t.name])]; }
      // redraw the card in place, keep the editor open
      card(ev, el); el.querySelector(".ch-edit").open = true;
    };
  }
  async function commit(ev, el) {
    const acts = el.querySelector(".ch-acts"); acts.innerHTML = `<span class="spin"></span> Dodaję i przeliczam mapę…`; draft = null;
    const mode = host.mode(); n++;
    try {
      let r;
      if (mode === "live") r = await commitLive(ev, n);
      else if (mode === "studio") r = await commitStudio(ev, n);
      else r = await commitSim(ev, n);
      if (!r) { acts.innerHTML = `<span class="mute">Nie dodano.</span>`; return; }
      acts.innerHTML = `<span class="ok">✓ Dodano${r.how === "sim" ? " do symulacji" : r.how === "live" ? " na żywo" : ""}</span>`;
      const focusSeg = (ev.place && ev.place.seg) || (ev.segs && ev.segs[0]) || (r.after[0] && r.after[0].id);
      const m = say(`${r.note ? `<div class="ch-note">${r.note}</div>` : ""}${r.after.length ? diffHTML(r.before, r.after, ev) : ""}
        <div class="ch-acts"><button class="ch-lnk" data-focus="${esc(focusSeg || "")}">Pokaż na mapie</button>${r.undo ? `<button class="ch-lnk" data-undo>Cofnij</button>` : ""}</div>`, "bot", "res");
      const entry = { n, ev, how: r.how, undo: r.undo, events: r.events, el: m }; done.push(entry);
      m.querySelector("[data-focus]").onclick = () => host.focus({ segId: focusSeg, place: ev.place });
      m.querySelectorAll("li[data-seg]").forEach((li) => li.onclick = () => host.focus({ segId: li.dataset.seg }));
      const u = m.querySelector("[data-undo]"); if (u) u.onclick = () => undo(entry, u);
      if (opts.onAdded) opts.onAdded(entry);
    } catch (e) {
      if (e.code === 401 && mode === "live") {
        acts.innerHTML = `<span class="mute">${esc(e.message)}</span> <button class="ch-lnk" data-sim>Pokaż jako symulację</button>`;
        acts.querySelector("[data-sim]").onclick = async () => { acts.innerHTML = `<span class="spin"></span> Liczę symulację…`; host.forceSim = true; try { await commit(ev, el); } finally { host.forceSim = false; } };
      } else acts.innerHTML = `<span class="err">Nie udało się: ${esc(e.message || e)}</span>`;
    }
  }
  async function undo(entry, btn) {
    btn.disabled = true; btn.textContent = "Cofam…";
    try { const r = await entry.undo(); btn.replaceWith(Object.assign(document.createElement("span"), { className: "ok", textContent: "✓ Cofnięto" })); entry.el.classList.add("undone"); if (r && r.after && r.after.length) say(`<div class="ch-note">Po cofnięciu:</div>${diffHTML(r.before, r.after, {})}`, "bot", "res"); }
    catch (e) { btn.disabled = false; btn.textContent = "Cofnij"; say(`<span class="err">Nie cofnięto: ${esc(e.message || e)}</span>`); }
  }
  // ---- Na żywo: the existing live routes
  async function commitLive(ev, k) {
    const sc = host.scenario(), run0 = host.run(), start = ctx.start, liveAt = host.clock();
    const at = ev.t && rel(ev.t, start) >= 0 && rel(ev.t, start) <= rel(liveAt, start) ? ev.t : liveAt;
    const id = `chat-${Date.now()}-${k}`, before = ranking(run0);
    let note = "", undo = null, match = null;
    if (["sighting", "clue", "found"].includes(ev.kind)) {
      if (ev.kind === "found" && !confirm("ZNALEZIONO zamyka akcję dla wszystkich (zespoły zwolnione, wszyscy dostają informację). Dodać?")) return null;
      const type = ev.kind === "sighting" ? "swiadek" : ev.kind === "found" ? "znaleziono" : ev.clueType || "znalezisko", txt = noteOf(ev);
      await api("/api/clue", { type, lat: +ev.place.p[0].toFixed(5), lon: +ev.place.p[1].toFixed(5), ...(ev.place.seg ? { segmentId: ev.place.seg } : {}), note: txt, by: "operator", sc, at, id });
      match = (c) => c.live && String(c.title || "").includes(txt.slice(0, 40));
      if (ev.dir) note = `Kierunek „${esc(ev.dir.name)}” zapisany w opisie śladu (mapa na żywo liczy punkt i czas; korytarz kierunku pokazuje symulacja w Historii).`;
      if (ev.seenAt && ev.seenAt !== at) note += `${note ? " " : ""}Obserwacja z ${esc(ev.seenAt)} - na osi czasu akcji zapisana o ${esc(at)}.`;
    } else if (ev.kind === "search") {
      const names = ev.segs.map((id) => ctx.segs.find((s) => s.id === id)?.name).filter(Boolean);
      await api("/report", { text: `${ev.team ? short(ev.team.name) : ev.drone ? "dron" : "Zespół"}: przeszukano ${names.join(", ")}, nic`, sc, at, id });
      match = (c) => c.live && ev.segs.some((s) => String(c.title || "").includes(s + " przeszukany"));
    } else if (ev.kind === "weather" || ev.kind === "status") {
      const w = ev.weather || {}, g = new Set(w.given || []), b = [];
      if (g.has("visibilityM")) b.push(`widoczność ${w.visibilityM} m`); if (g.has("windMs")) b.push(`wiatr ${w.windMs} m/s`); if (g.has("precip")) b.push(w.precip === "snow" ? "śnieg" : "deszcz"); if (g.has("tempC")) b.push(`temperatura ${w.tempC} stopni`); if (g.has("dark")) b.push("zmrok");
      const who = ev.kind === "status" ? (ev.team && /heli|smig/.test(fold(ev.team.id + ev.team.name)) ? "śmigłowiec" : ev.team && /dron/.test(fold(ev.team.id + ev.team.name)) ? "dron" : ev.team && /dog|pies/.test(fold(ev.team.id + ev.team.name)) ? "pies" : "patrol") : "Pogoda";
      const st = ev.kind === "status" ? (ev.available ? " gotowy, w drodze" : " niedostępny, " + (/(uziemion)/.test(fold(ev.text)) ? "uziemiony" : "wraca")) : "";
      await api("/report", { text: `${who}:${st}${b.length ? (st ? ", " : " ") + b.join(", ") : ""}`, sc, at, id });
      note = "Zmiana pogody / statusu nie ma pojedynczego „Cofnij” na żywo - poprawkę wyślij kolejną wiadomością (np. „widoczność 500 m”).";
    } else if (ev.kind === "dispatch") {
      const seg = ev.segs[0], s = ctx.segs.find((x) => x.id === seg);
      await api("/story/assign", { resourceId: ev.team.id, segmentId: seg, at, scenario: sc, segmentName: s && s.name });
      note = `${esc(short(ev.team.name))} → ${esc(seg)} ${esc(s ? s.name : "")}. Telefon zespołu dostanie zadanie.`;
      undo = async () => { await api("/story/assign", { resourceId: ev.team.id, segmentId: null, at, scenario: sc }); await host.refreshLive(); return null; };
    }
    const run1 = await host.refreshLive();
    if (match && run1 && run1.clueWeights) {
      const cw = [...run1.clueWeights].reverse().find(match);
      if (cw) undo = async () => { const b = ranking(host.run()); await api("/api/clue/weight", { sc, clueId: cw.id, weight: 0, by: "operator", title: "czat: cofnięte" }); const r2 = await host.refreshLive(); return { before: b, after: ranking(r2) }; };
    }
    return { how: "live", before, after: ranking(run1), note, undo };
  }
  // ---- Historia: private what-if through the stateless POST /api/run
  const sim = { events: [], base: null };
  async function simRun(extra) {
    const scn = ctx.scn; if (!scn) throw new Error("brak pliku scenariusza");
    const doc = JSON.parse(JSON.stringify(scn));
    const cut = host.simCut && host.simCut();   // standalone "teraz": only the events up to the live moment
    if (cut) doc.events = doc.events.filter((e) => !(e.provider === "Found" || e.found || e.epilogue) && rel(e.at, ctx.start) <= rel(cut, ctx.start));
    doc.events = [...doc.events, ...extra].sort((a, b) => rel(a.at, ctx.start) - rel(b.at, ctx.start));
    const r = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(doc) });
    if (!r.ok) throw new Error("serwer nie policzył symulacji (" + r.status + ")");
    const run = await r.json(); if (run.error) throw new Error(run.error); return run;
  }
  async function commitSim(ev, k) {
    if (ev.kind === "dispatch") throw new Error("wysłanie zespołu działa tylko na żywo");
    const at0 = host.clock(), lo = rel(ctx.start, ctx.start);
    let at = ev.t || at0; if (rel(at, ctx.start) < lo) at = ev.kind === "weather" && ev.tFrom ? ctx.start : at0;   // a sighting at 14:20 (before the call) is noted at the current moment, seen at 14:20
    const mx = host.maxClock ? host.maxClock() : null; if (mx && rel(at, ctx.start) > rel(mx, ctx.start)) at = mx;   // never after the recording's find
    const evs = scenarioEvents(ev, at, k, ctx);
    if (!evs.length) { if (ev.kind === "status") throw new Error("status zespołu bez zmiany pogody nie zmienia mapy w historii - dodaj go na żywo"); throw new Error("za mało danych (miejsce / sektor)"); }
    // "teraz" = the later of the event and the clock: an old observation still changes where to search NOW
    const cmp = rel(at, ctx.start) > rel(at0, ctx.start) ? at : at0;
    if (!sim.base) sim.base = await simRun([]);
    const prev = sim.events.length ? sim.last : sim.base, before = ranking(prev, cmp, ctx.start);
    sim.events.push(...evs);
    const run = await simRun(sim.events); sim.last = run;
    await host.apply(run, { at: cmp });
    const undo = async () => {
      sim.events = sim.events.filter((e) => !evs.includes(e));
      const b = ranking(sim.last, cmp, ctx.start);
      if (!sim.events.length) { sim.last = null; await host.restore(); return { before: b, after: ranking(sim.base, cmp, ctx.start) }; }
      const r2 = await simRun(sim.events); sim.last = r2; await host.apply(r2, { at: cmp }); return { before: b, after: ranking(r2, cmp, ctx.start) };
    };
    const note = at !== ev.t && ev.t ? `${ev.kind === "weather" ? "Zmiana" : "Obserwacja"} z ${esc(ev.t)} - na osi czasu akcji zapisana o ${esc(at)}${rel(ev.t, ctx.start) < 0 ? " (przed zgłoszeniem)" : ""}.` : ev.dir ? `Kierunek „${esc(ev.dir.name)}”: korytarz wzdłuż szlaku (±300 m).` : "";
    return { how: "sim", before, after: ranking(run, cmp, ctx.start), note, undo, events: evs };
  }
  // ---- Studio (Plan): the existing /story/event + /story/edit undo
  async function commitStudio(ev, k) {
    const at = ev.t || host.clock(), evs = scenarioEvents(ev, at, k, ctx), before = ranking(host.run());
    if (!evs.length) throw new Error("za mało danych");
    let n0 = 0;
    for (const e of evs) { const inp = { provider: e.provider, at: e.at, title: e.title }; if (e.point) { inp.lat = e.point[0]; inp.lon = e.point[1]; } if (e.radiusM) inp.radiusM = e.radiusM; if (e.segments) { inp.segments = e.segments; inp.pod = e.pod; } if (e.provider === "WeatherConditions") Object.assign(inp, { visibilityM: e.visibilityM, windMs: e.windMs, tempC: e.tempC, precip: e.precip, dark: e.dark, ice: e.ice }); if (e.provider === "TripPlan") { inp.text = e.title; inp.radiusM = 300; } if (e.factor) inp.factor = e.factor; await host.addInput(inp); n0++; }
    return { how: "studio", before, after: ranking(host.run()), undo: async () => { const b = ranking(host.run()); for (let i = 0; i < n0; i++) await host.undoInput(); return { before: b, after: ranking(host.run()) }; } };
  }
  async function sendRaw(t) {
    try { await api("/report", { text: t, sc: host.scenario(), at: host.clock(), id: "chat-raw-" + Date.now() }); const run = await host.refreshLive(); say(`Wysłane jako meldunek. Serwer go przeczytał - mapa przeliczona.${run ? diffHTML(ranking(host.run()), ranking(run), {}) : ""}`); }
    catch (e) { say(`<span class="err">${esc(e.message)}</span>`); }
  }
  function hello() {
    const m = host.mode();
    say(`Opisz zwykłym zdaniem, co się stało - zrozumiem i pokażę na mapie przed dodaniem. ${m === "live" ? "<b>Na żywo</b>: zmiany zobaczą wszyscy w akcji." : m === "hist" ? "<b>Historia</b>: dodaję do osi czasu jako symulację tylko u Ciebie." : ""}<br><span class="mute">Kliknij przykład poniżej albo napisz własny.</span>`);
  }
  ensureCtx().then(renderChips).catch(() => renderChips());
  hello();
  return { say, onText, ensureCtx, resetSim: () => { sim.events = []; sim.last = null; sim.base = null; }, get simActive() { return sim.events.length > 0; }, renderChips, hello };
}

// Historia "teraz": the shown step, but never at or past the scripted find (an event added after ZNALEZIONO changes nothing)
function beforeFind(R, i) { const f = R.steps.findIndex((s) => s.kind === "found"); let k = Math.max(0, Math.min(i, R.steps.length - 1)); if (f >= 0 && k >= f) k = Math.max(0, f - 1); return R.steps[k]; }
// ---------------------------------------------------------------- host 1: the /app shell (drawer + floating button)
export function mountAppChat() {
  const A = () => window.rescueApp, st = () => window.rescueStore;
  if (!A() || !A().applyRun || !st()) { setTimeout(mountAppChat, 250); return; }
  const btn = document.createElement("button"); btn.id = "chBtn"; btn.type = "button"; btn.innerHTML = `<span aria-hidden="true">💬</span> Czat`; btn.title = "Dodaj zdarzenie zwykłym zdaniem";
  const dr = document.createElement("aside"); dr.id = "chDrawer"; dr.setAttribute("aria-label", "Czat - dodaj zdarzenie");
  dr.innerHTML = `<div class="ch-head"><b>Czat</b><span class="ch-mode"></span><button class="ch-x" type="button" aria-label="Zamknij">✕</button></div><div class="ch-sim" hidden>Symulacja: mapa pokazuje Twoje dodane zdarzenia. <button type="button" class="ch-lnk" data-back>Wróć do nagrania</button></div><div class="ch-body"></div>`;
  document.body.append(btn, dr);
  let simRun = null, restoring = false, blob = null;
  const S = () => st();
  const live = () => S().time === "live" && S().backend === "api" && S().mode !== "edycja";
  const host = {
    scenario: () => S().backend === "studio" ? "zawrat" : S().scenario,
    run: () => S().run,
    mode: () => S().backend === "studio" ? "studio" : live() && !host.forceSim ? "live" : "hist",
    maxClock: () => { const R = S().run; return R && R.steps && !live() ? beforeFind(R, R.steps.length - 1).t : null; },
    clock: () => { const R = S().run; if (!R || !R.steps) return "12:00"; if (live()) return (R.liveCursor && R.liveCursor.at) || R.steps[R.steps.length - 1].t; return beforeFind(R, S().step - 1).t; },
    async refreshLive() { if (!S().runUrl) return S().run; const r = await (await fetch(S().runUrl, { cache: "no-cache" })).json(); if (r && r.steps) A().applyRun(r, {}, "run"); return r; },
    async apply(run, info) {
      if (blob) URL.revokeObjectURL(blob);
      const text = JSON.stringify(run); blob = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      window.__rescueRunText = { url: blob, text };   // runInline: the 2D view parses this copy instead of fetching the blob
      simRun = run; if (S().mode !== "akcja") A().setMode("akcja");
      A().applyRun(run, { runUrl: blob, assessUrl: null }, "edit");
      if (info && info.at) { let k = 0; const st = run.steps[0].t; run.steps.forEach((s, i) => { if (rel(s.t, st) <= rel(info.at, st) && s.kind !== "found") k = i; }); A().setStep(k + 1); }
      dr.querySelector(".ch-sim").hidden = false;
    },
    async restore() { restoring = true; simRun = null; dr.querySelector(".ch-sim").hidden = true; try { await A().loadScenario(S().scenario); } finally { restoring = false; } },
    focus({ segId }) { if (S().mode !== "akcja") A().setMode("akcja"); if (segId && S().selSeg !== segId) A().selectSeg(segId); else if (segId) { A().selectSeg(segId); A().selectSeg(segId); } },
    addInput: (inp) => A().addInput(inp), undoInput: () => A().undo(),
  };
  const chat = createChat(dr.querySelector(".ch-body"), host);
  const mode = () => { const m = host.mode(); dr.querySelector(".ch-mode").textContent = m === "live" ? "NA ŻYWO" : m === "studio" ? "PLAN" : "HISTORIA"; dr.querySelector(".ch-mode").className = "ch-mode m-" + m; };
  const open = (on) => { dr.classList.toggle("open", on); btn.classList.toggle("on", on); mode(); if (on) { chat.ensureCtx(); setTimeout(() => dr.querySelector("textarea").focus(), 200); } try { sessionStorage.setItem("rescue-chat-open", on ? "1" : ""); } catch (e) {} };
  btn.onclick = () => open(!dr.classList.contains("open"));
  dr.querySelector(".ch-x").onclick = () => open(false);
  dr.querySelector("[data-back]").onclick = () => { chat.resetSim(); host.restore(); chat.say("Wróciłem do nagrania - symulacja wyczyszczona."); };
  A().onStore && A().onStore((why) => {
    mode();
    // the shell loaded something else (scenario switch, Historia / Na żywo): a running simulation is gone
    if (why === "load" && simRun && !restoring) { simRun = null; dr.querySelector(".ch-sim").hidden = true; chat.resetSim(); chat.say("Symulacja zakończona: wczytano inne dane (scenariusz albo tryb czasu)."); }
  });
  try { if (sessionStorage.getItem("rescue-chat-open") || new URLSearchParams(location.search).get("chat")) open(true); } catch (e) {}
  window.rescueChat = { open, chat, host };
}

// ---------------------------------------------------------------- host 2: czat.html (full screen chat + small 2D map)
export async function mountStandalone() {
  const q = new URLSearchParams(location.search), sc = q.get("sc") || "zawrat";
  const frame = document.getElementById("czMap"), body = document.getElementById("czChat");
  let run = null, ready = false, pending = [], blob = null, liveWanted = false;
  const post = (m) => { if (ready) frame.contentWindow.postMessage({ source: "rescue-app", ...m }, location.origin); else pending.push(m); };
  addEventListener("message", (e) => {
    if (e.source !== frame.contentWindow || e.origin !== location.origin || !e.data || e.data.source !== "rescue2d") return;
    if (e.data.type === "ready") { ready = true; const p = pending; pending = []; p.forEach(post); }
  });
  try { run = await api(`/api/run/${encodeURIComponent(sc)}`); } catch (e) { run = null; }
  const startRun = run;
  frame.src = `../web/index.html?embed=scene&sc=${encodeURIComponent(sc)}&parentOrigin=${encodeURIComponent(location.origin)}&run=${encodeURIComponent(`/api/run/${sc}`)}&scenario=${encodeURIComponent(`/scenarios/${sc}.json`)}`;
  const liveAt = () => (run && run.liveCursor && run.liveCursor.at) || (startRun && startRun.steps && beforeFind(startRun, startRun.steps.length - 1).t) || "12:00";
  const host = {
    scenario: () => sc, run: () => run,
    mode: () => liveWanted && hasKey() && !host.forceSim ? "live" : "hist",
    clock: liveAt, maxClock: liveAt,
    simCut: () => (startRun && startRun.liveCursor && startRun.liveCursor.at) || null,
    async refreshLive() { const r = await api(`/api/run/${encodeURIComponent(sc)}`); run = r; ready = false; frame.src = frame.src.replace(/([?&])v=\d+/, "") + "&v=" + Date.now(); return r; },
    async apply(r) { run = r; if (blob) URL.revokeObjectURL(blob); blob = URL.createObjectURL(new Blob([JSON.stringify(r)], { type: "application/json" })); post({ type: "run", url: blob }); ready = false; },
    async restore() { run = startRun; post({ type: "run", url: `/api/run/${sc}` }); ready = false; },
    focus({ segId }) { if (segId) post({ type: "select", segmentId: segId }); document.body.classList.add("cz-map-big"); setTimeout(() => document.getElementById("czMapBox").scrollIntoView({ behavior: "smooth", block: "nearest" }), 50); },
  };
  const chat = createChat(body, host, { placeholder: "Co widziałeś? Np. „widziałem kogoś przy Wielkim Stawie 20 min temu”" });
  // big quick starts for casual users: they start a short guided dialog (the parser asks for what is missing)
  document.querySelectorAll("[data-quick]").forEach((b) => b.onclick = () => chat.onText(b.dataset.quick));
  const tg = document.getElementById("czLive");
  if (tg) { tg.hidden = !hasKey(); tg.onchange = () => { liveWanted = tg.checked; chat.say(liveWanted ? "Tryb: <b>zgłoszenie do akcji na żywo</b> - zobaczy je kierownik akcji." : "Tryb: <b>podgląd</b> - zmiany tylko na Twoim ekranie."); }; }
  window.rescueChat = { chat, host };
}
