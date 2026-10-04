// Czat (AI Mateusza #2): add events by chatting in plain Polish. Rules first (time, scenario gazetteer, sector ids, roster,
// keywords), then a confirmation card (what was understood + mini map + editable fields), then the EXISTING API:
//   Na żywo: POST /api/clue (sightings, items, traces, find), POST /report (searched-empty, weather, team status: the
//            server's rules + optional LLM read it), POST /story/assign (dispatch); "Cofnij" = POST /api/clue/weight 0.
//   Historia: a private what-if - the scenario file + the chat events -> POST /api/run (stateless, nobody else sees it);
//            the shell shows that run until "Wróć do nagrania" / "Cofnij". Studio: POST /story/event, undo /story/edit.
// Reply: new top 3 (rank + sector + "% obszaru", never POA %), moves vs before, "pokaż na mapie" (2D select = zoom).
// Two hosts: the /app shell (drawer, mountAppChat) and czat.html (full screen, mountStandalone). Docs: docs/rescue-locator/czat.md

import { evGroups } from "./dock.js";   // the same event groups as the dock's timeline markers
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
const stem = (w) => /^\d/.test(w) ? w : w.length <= 2 ? w : w.length === 3 ? w.slice(0, 2) : w.length <= 5 ? w.slice(0, w.length - 1) : w.slice(0, Math.max(4, w.length - 2));
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
  // long names ("Las przy wyplywie potoku", "Czarny Staw pod Rysami", "Toń - zatoka przy Nowych Gutach"): any two neighbouring
  // words name the place too ("przy wypływie potoku", "Czarnego Stawu", "przy Nowych Gutach"); huts also by their first word
  for (const g of [...G]) {
    if (g.st.length >= 3) for (let i = 0; i + 1 < g.st.length; i++) G.push({ ...g, st: [g.st[i], g.st[i + 1]], prio: 0 });
    if (g.kind === "schronisko" && g.st.length > 1) G.push({ ...g, st: [g.st[0]], prio: 0 });
  }
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
  item: /(kapelusz|kamizelk|laska\b|laske\b|plecak|kurtk|czapk|rekawic|rekawiczk|\bbut\b|\bbuty\b|\bbuta\b|kijek|kijki|\bkij\b|latark|butelk|portfel|okular|\bmap[aeęy]\b|polar|szalik|chust|kask|czolowk|ubrani|odziez|sweter|bluz|termos|kurtke|telefon\w* (lezal|znalez)|dokument)/,
  cloth: /(kurtk|czapk|rekawic|\bbut\b|\bbuty\b|\bbuta\b|polar|szalik|chust|ubrani|odziez|sweter|bluz)/,
  trace: /(placz|slad|odcisk|trop|krzyk|wolani|wolal|glos|gwizd|swiatl|swiecil|swiecila|blysk|zapach)/,
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
  else if (isSight && (!isItem || /\b(go|ja|jego|kogos|ktos|osob\w*|mezczyzn\w*|kobiet\w*|turyst\w*|czlowiek\w*|chlopak\w*|starsz\w*|zeglarz\w*|plywak\w*|dzieck\w*|dziewczyn\w*|chlop\w*|senior\w*|dziad\w*|babci\w*|staruszk\w*|pan\b|pani\b|x)\b/.test(f))) ev.kind = "sighting";
  else if (isItem || isTrace || (RX.phone.test(f) && !RX.status.test(f))) ev.kind = "clue";
  else if (res && RX.status.test(f)) ev.kind = "status";
  else if (RX.weather.test(f)) ev.kind = "weather";
  else if (/(kogos|ktos|osob|turyst|mezczyzn|kobiet|\bgo\b|\bja\b|\bbyl\b|\bbyla\b)/.test(f) && (RX.move.test(f) || /\b(byl|byla|stal|stala|siedzial|siedziala|lezal|lezala|odpoczywal|czekal)\b/.test(f))) ev.kind = "sighting";
  if (ev.kind === "clue") {
    ev.clueType = /(swiecil|swiecila|blysk|swiatl)/.test(f) ? "slad" : RX.cloth.test(f) ? "odziez" : isItem ? "znalezisko" : RX.phone.test(f) && !isTrace ? "telefon" : "slad";
    const it = f.match(/(kapelusz|kamizelk\w*|plecak|kurtk\w*|czapk\w*|rekawiczk\w*|rekawic\w*|\bbut\w*|kij\w*|latark\w*|butelk\w*|portfel|okular\w*|map[aey]|polar|szalik|chust\w*|kask|czolowk\w*|termos|telefon|sweter|bluz\w*|slad\w*|trop|krzyk|wolanie|glos|gwizd\w*|swiatl\w*|odcisk\w*)/);
    ev.item = it ? text.slice(f.indexOf(it[0]), f.indexOf(it[0]) + it[0].length) : null;
  }
  if (ev.kind === "status" || ev.kind === "dispatch" || ev.kind === "search") ev.team = res;
  if (ev.kind === "search") { ev.drone = /dron|przelot|przelecial|przelecie|termowiz/.test(f); ev.pod = ev.drone ? 0.6 : /(pies|psem|psa\b)/.test(f) ? 0.8 : /(pobiezn|szybko|mgl|ciemn)/.test(f) ? 0.4 : /(dokladn|szczegol|tyralier)/.test(f) ? 0.8 : 0.6; const p = f.match(/pod\s*(\d{2})\s*%/); if (p) ev.pod = +p[1] / 100; }
  // confidence
  if (RX.unsure.test(f)) { ev.conf = "niska"; ev.why.push("„chyba / może” - większy promień"); }
  else if (RX.sure.test(f)) { ev.conf = "wysoka"; ev.why.push("pewna obserwacja - mniejszy promień"); }
  // sectors by id ("S3", "s 12")
  // sector ids of any scenario: S3, M7, W12, N9, R10, B4 (letters + number, as the scenario names them)
  const ids = [...new Set([...f.matchAll(/\b([a-z]{1,2})\s?(\d{1,2})\b/g)].map((m) => ctx.segs.find((s) => s.id.toLowerCase() === m[1] + +m[2])).filter(Boolean).map((s) => s.id))];
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

// ---------------------------------------------------------------- the LLM's reading (POST /api/parse) -> the same event shape as parse()
const DIRS = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
export function fromLLM(o, text, ctx) {
  const f = fold(text), ev = { text, kind: o && o.kind && o.kind !== "none" && KINDS[o.kind] ? o.kind : null, conf: ["niska", "średnia", "wysoka"].includes(o.confidence) ? o.confidence : "średnia", why: ["odczytane przez AI"], ai: true };
  if (!ev.kind) return ev;
  const byName = (n) => { if (!n) return null; const k = fold(n), c = ctx.G.filter((g) => fold(g.name) === k).sort((a, b) => b.prio - a.prio); if (c.length) return c[0]; const h = findPlaces(words(n), ctx.G); return h.length ? h[0].g : null; };
  if (typeof o.time === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(o.time)) ev.t = o.time.padStart(5, "0");
  else if (o.minutesAgo != null && isFinite(o.minutesAgo) && o.minutesAgo >= 0) ev.t = hm(minOf(ctx.clock || "12:00") - o.minutesAgo);
  const pg = byName(o.place), dg = byName(o.towards);
  const ids = [...new Set((o.segments || []).map((id) => ctx.segs.find((s) => s.id.toLowerCase() === String(id).toLowerCase())).filter(Boolean).map((s) => s.id))];
  const c = text.match(/(4[89]|5[0-5])[.,](\d{3,6})[,;\s]+(1[4-9]|2[0-4])[.,](\d{3,6})/);
  if (c) { ev.place = { name: "punkt GPS z tekstu", p: [+(c[1] + "." + c[2]), +(c[3] + "." + c[4])], r: 100, how: "gps" }; ev.conf = "wysoka"; }
  else if (pg) ev.place = { name: pg.name, p: pg.p.slice(), r: pg.r, kind: pg.kind, how: "nazwa" };
  else if (ids.length && ev.kind !== "search" && ev.kind !== "dispatch") { const s = ctx.segs.find((x) => x.id === ids[0]); if (s && s.c) ev.place = { name: `${s.id} ${s.name}`, p: s.c.slice(), r: 500, how: "sektor" }; }
  if (ev.place && ev.place.how === "nazwa" && o.offsetM > 0 && o.offsetM < 20000 && DIRS[o.offsetDir] != null) {
    const m = +o.offsetM, b = DIRS[o.offsetDir];
    ev.place.p = offset(ev.place.p, m, b); ev.place.name = `${Math.round(m)} m na ${["północ", "pn-wsch", "wschód", "pd-wsch", "południe", "pd-zach", "zachód", "pn-zach"][Math.round(b / 45) % 8]} od: ${ev.place.name}`; ev.place.r = Math.max(150, m * 0.35); ev.place.how = "odległość od nazwy";
  }
  if (dg && ev.kind === "sighting" && (!pg || dg.name !== pg.name)) ev.dir = { name: dg.name, p: dg.p.slice() };
  if (ev.place) {
    let r = ev.place.r;
    if (ev.kind === "sighting") r = Math.max(r, 400); if (ev.kind === "found") r = 30;
    if (ev.kind === "clue" && ev.place.how === "nazwa") r = Math.max(200, Math.min(r, 400));
    if (ev.conf === "niska" && ev.kind !== "found") r *= 1.6; if (ev.conf === "wysoka" && ev.kind !== "found" && ev.place.how !== "gps") r *= 0.7;
    ev.place.r = Math.round(r / 10) * 10;
    const s = segAt(ctx.segs, ev.place.p); if (s) ev.place.seg = s.id;
  }
  const R = ctx.resources || [], tm = R.find((x) => x.id === o.team);
  if (["status", "dispatch", "search"].includes(ev.kind)) ev.team = tm ? { id: tm.id, name: tm.name } : findResource(f, R);
  if (ev.kind === "clue") { ev.clueType = ["odziez", "znalezisko", "slad", "telefon"].includes(o.clueType) ? o.clueType : "znalezisko"; ev.item = o.item ? String(o.item).slice(0, 40) : null; }
  if (ev.kind === "search") {
    const tr = ev.team && R.find((x) => x.id === ev.team.id);
    ev.drone = !!o.drone || !!(tr && tr.type === "drone");
    ev.pod = ev.drone ? 0.6 : /(pies|psem|psa\b)/.test(f) || (tr && tr.type === "dog") ? 0.8 : /(pobiezn|szybko|mgl|ciemn)/.test(f) ? 0.4 : /(dokladn|szczegol|tyralier)/.test(f) ? 0.8 : 0.6; const p = f.match(/pod\s*(\d{2})\s*%/); if (p) ev.pod = +p[1] / 100;
    ev.segs = ids.length ? ids : ev.place && ev.place.seg ? [ev.place.seg] : [];
  }
  if (ev.kind === "dispatch") ev.segs = ids.length ? ids.slice(0, 1) : ev.place && ev.place.seg ? [ev.place.seg] : [];
  if (ev.kind === "weather" || ev.kind === "status") {
    const L = ctx.lastWeather || {}, w = {};
    for (const k of ["visibilityM", "windMs", "tempC"]) if (o[k] != null && isFinite(o[k])) w[k] = Math.round(+o[k]);
    if (o.precip && o.precip !== "none") w.precip = o.precip; if (o.dark) w.dark = true; if (o.ice) w.ice = true;
    if (Object.keys(w).length) ev.weather = { visibilityM: L.visibilityM ?? 1000, windMs: L.windMs ?? 5, tempC: L.tempC ?? 5, precip: L.precip || "none", dark: !!L.dark, ice: !!L.ice, ...w, given: Object.keys(w) };
    if (ev.kind === "status") ev.available = typeof o.available === "boolean" ? o.available : /(gotow|dostepn|startuje|w drodze|wylecial|wystartowal)/.test(f) && !/(nie |niedostep)/.test(f);
  }
  if (ev.kind === "sighting" || ev.kind === "clue") ev.seenAt = ev.t || null;
  ev.missing = [];
  if (["sighting", "clue", "found"].includes(ev.kind) && !ev.place) ev.missing.push("place");
  if ((ev.kind === "search" || ev.kind === "dispatch") && !(ev.segs && ev.segs.length)) ev.missing.push("segs");
  if (ev.kind === "dispatch" && !ev.team) ev.kind = null;   // nobody to send: let the rules / the user say it again
  return ev;
}

// several events in one message: split at sentence ends, ";", ", a / oraz / potem / natomiast"; a piece without its own kind
// ("nic", "widoczność 50 m") stays with the previous one. Only when 2+ pieces are events of their own.
export function splitEvents(text, ctx) {
  const raw = String(text || "").split(/\s*;\s*|(?<!\b(?:ok|godz|ul|np|m|n))\.\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ])|,\s*(?:a|oraz|potem|a potem|natomiast|i jeszcze|poza tym)\s+|\s+(?:a potem|a także|poza tym)\s+/u).map((x) => x.trim()).filter(Boolean);
  if (raw.length < 2) return [];
  const out = [];
  for (const piece of raw) {
    const ev = parse(piece, ctx);
    const prev = out.length && out[out.length - 1].ev, follow = prev && (ev.kind === "search" && !(ev.segs && ev.segs.length) && !ev.team || ev.kind === prev.kind && ev.missing.includes("place"));
    if (ev.kind && !follow) out.push({ text: piece, ev });
    else if (out.length) { out[out.length - 1].text += ", " + piece; out[out.length - 1].ev = parse(out[out.length - 1].text, ctx); }
    else out.push({ text: piece, ev });
  }
  const evs = out.map((o) => o.ev).filter((e) => e.kind);
  return evs.length > 1 ? evs : [];
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
EXAMPLES["morskie-oko"] = [
  "Turysta widział dziewczynkę o 14:20 przy wypływie potoku, szła w stronę schroniska",
  "Patrol GOPR A przeszukał brzeg wschodni jeziora, nic",
  "Znaleziono różową czapkę na brzegu zachodnim jeziora",
  "Słychać płacz koło M7 10 min temu",
  "Dron przeleciał nad M7 i M8, nic",
  "Pies podjął trop przy szlaku w stronę Czarnego Stawu",
];
EXAMPLES["rodzina-dziecko-las"] = [
  "Turystka widziała chłopca o 16:10 przy Jelenim Potoku",
  "Patrol GOPR A przeszukał Dziki Potok, nic",
  "Znaleziono czapkę przy Skałce",
  "Pies podjął trop przy Łomniczce",
  "Dron przeleciał nad R6, nic",
  "Zmierzch o 18:30, 8 stopni",
];
EXAMPLES.sniardwy = [
  "Rybak widział żeglarza w wodzie o 17:10 przy Nowych Gutach",
  "Łódź WOPR przeszukała toń na wschód od LKP, nic",
  "Znaleziono kamizelkę ratunkową w trzcinach przy brzegu SE",
  "Słychać wołanie z toni przy brzegu SE 15 min temu",
  "Dron WOPR przeleciał nad W3, nic",
  "Wiatr 14 m/s, widoczność 300 m",
];
EXAMPLES["krakow-nowa-huta"] = [
  "Sąsiadka widziała go o 15:40 przy Placu Centralnym, szedł w stronę Zalewu Nowohuckiego",
  "Patrol Policji A sprawdził Park Ratuszowy, nic",
  "Znaleziono kapelusz na ogródkach działkowych Mogiła",
  "Dron Policji przeleciał nad bulwarem Wisły, nic",
  "Pies tropiący przeszukał N9, bez śladów",
  "Upał 32 stopnie",
];
// other scenarios: chips built from the scenario itself (sector names, teams, water / city / forest / mountain)
export function autoExamples(ctx) {
  const scn = ctx.scn || {}, cat = String(scn.subject && scn.subject.category || ""), res = ctx.resources || [];
  const water = /boater|swimmer|water/.test(cat) || res.some((r) => /lod|łód|wopr|boat|nurk/i.test(r.name + " " + r.type));
  const places = [], seen = new Set();
  for (const g of ctx.G || []) if (g.kind !== "IPP" && !seen.has(g.name) && g.name.length <= 28 && !/\(/.test(g.name)) { seen.add(g.name); places.push(g); }
  const pick = (i) => places.length ? places[i % places.length].name : "";
  const seg = (i) => (ctx.segs[i % Math.max(1, ctx.segs.length)] || {}).id || "";
  const team = res.find((r) => r.type === "ground") || res[0], tName = team ? short(team.name) : "Zespół A";
  const out = [];
  if (pick(0)) out.push(`Widziałem kogoś przy ${pick(0)} 20 min temu`);
  if (seg(1)) out.push(`${tName} przeszukał ${seg(1)}, nic`);
  if (pick(2)) out.push(`Znaleziono ${water ? "kamizelkę" : "czapkę"} przy ${pick(2)}`);
  out.push(water ? "Wiatr 12 m/s, widoczność 300 m" : /dementia/.test(cat) ? "Upał 30 stopni" : "Mgła, widoczność 50 m");
  if (seg(3) && res.some((r) => r.type === "drone")) out.push(`Dron przeleciał nad ${seg(3)}, nic`);
  return out.length >= 3 ? out : EX_GENERIC;
}
const EX_GENERIC = ["Widziałem kogoś przy schronisku 30 min temu", "Zespół A przeszukał S1, nic", "Mgła, widoczność 50 m"];

export function createChat(root, host, opts = {}) {
  let ctx = null, ctxKey = "", n = 0, draft = null;
  const done = [];   // added: [{n, ev, how: live|sim|studio, undo: async fn, label}]
  root.innerHTML = `<div class="ch-log" aria-live="polite"></div>
    <div class="ch-chips" aria-label="Przykłady"></div>
    <form class="ch-in"><textarea rows="2" placeholder="${esc(opts.placeholder || "Napisz, co się stało: kto lub co, gdzie, kiedy")}" aria-label="Wiadomość"></textarea><button class="ch-send" type="submit" aria-label="Wyślij">➤</button></form>`;
  const log = root.querySelector(".ch-log"), ta = root.querySelector("textarea"), chips = root.querySelector(".ch-chips");
  const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (opts.voice && SR) {
    const mic = document.createElement("button"); mic.type = "button"; mic.className = "ch-mic"; mic.setAttribute("aria-label", "Powiedz zamiast pisać"); mic.title = "Powiedz zamiast pisać (po polsku)"; mic.textContent = "🎤";
    root.querySelector(".ch-send").before(mic);
    let rec = null;
    mic.onclick = () => {
      if (rec) { rec.stop(); return; }
      try {
        rec = new SR(); rec.lang = "pl-PL"; rec.interimResults = true; rec.maxAlternatives = 1;
        const base = ta.value ? ta.value.trim() + " " : ""; let fin = "";
        rec.onresult = (e) => { let tmp = ""; for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) fin += r[0].transcript; else tmp += r[0].transcript; } ta.value = base + fin + tmp; };
        rec.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") say("Brak dostępu do mikrofonu - napisz wiadomość albo zezwól na mikrofon w przeglądarce."); };
        rec.onend = () => { mic.classList.remove("on"); rec = null; const t = ta.value.trim(); if (fin.trim() && t) { ta.value = ""; onText(t); } };
        rec.start(); mic.classList.add("on");
      } catch (e) { rec = null; mic.classList.remove("on"); say("Rozpoznawanie mowy nie działa w tej przeglądarce - napisz wiadomość."); }
    };
  }
  const scroll = () => { log.scrollTop = log.scrollHeight; };
  const say = (html, who = "bot", cls = "") => { const d = document.createElement("div"); d.className = `ch-msg ${who} ${cls}`; d.innerHTML = html; log.appendChild(d); scroll(); return d; };
  root.querySelector("form").onsubmit = (e) => { e.preventDefault(); const t = ta.value.trim(); ta.value = ""; onText(t); };
  ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); root.querySelector("form").requestSubmit(); } };
  function renderChips() {
    const ex = EXAMPLES[host.scenario()] || (ctx ? autoExamples(ctx) : EX_GENERIC);
    chips.innerHTML = ex.map((t) => `<button type="button" class="ch-chip">${esc(t)}</button>`).join("");
    chips.querySelectorAll("button").forEach((b) => b.onclick = () => onText(b.textContent));
  }
  async function ensureCtx() {
    const sc = host.scenario(), run = host.run(), key = sc + "|" + (run && run.steps ? run.steps.length : 0);
    if (ctx && ctxKey === key) return ctx;
    let scn = ctx && ctx.sc === sc ? ctx.scn : null;
    if (!scn) { try { scn = await (await fetch(sc === "studio" ? "/story/scenario" : `/scenarios/${encodeURIComponent(sc)}.json`, { cache: "no-cache" })).json(); } catch (e) { scn = null; } }   // Studio has no scenarios/studio.json (404)
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
  // POST /api/parse: the model's events in parse() shape, or null (off, slow, error) - the rules take over then
  let llmDown = 0;
  async function llmParse(t, c, prev) {
    if (Date.now() < llmDown) return null;
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), 6000), t0 = performance.now();
    const note = (r) => { try { (window.__chatLLM = window.__chatLLM || []).push({ ms: Math.round(performance.now() - t0), r }); } catch (e) {} };
    try {
      const seen = new Set(), places = [];
      for (const g of c.G) if (g.prio > 0 && g.kind !== "IPP" && !seen.has(g.name)) { seen.add(g.name); places.push(g.name); }
      const r = await fetch("/api/parse", { method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal,
        body: JSON.stringify({ text: t, clock: c.clock, prev, places, segments: c.segs.map((s) => ({ id: s.id, name: s.name })), teams: (c.resources || []).map((x) => ({ id: x.id, name: x.name, type: x.type || "" })) }) });
      const o = r.ok ? await r.json() : null;
      // the model is off or failing (503, {error}): skip it for a minute; a slow answer or a lost request only costs this message
      if (!o || !Array.isArray(o.events)) { if (r.status === 503 || (o && o.error)) llmDown = Date.now() + 60000; note(o && o.error ? "error" : "http " + r.status); return null; }
      const evs = o.events.map((x) => fromLLM(x, t, c)).filter((e) => e.kind);
      note(evs.length ? "ok" : "none");
      return evs.length ? evs : null;
    } catch (e) { note(e.name === "AbortError" ? "timeout" : "net"); return null; }
    finally { clearTimeout(to); }
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
    // several events in one message ("S3 i S4 przeszukane, nic, a o 15:10 turystka widziała go przy Zawracie"): one card each
    // the LLM reads it first (POST /api/parse, ~1-3 s); the rules answer when the model is off, slow or unsure
    const prevDraft = draft && draft.ev.missing.length ? draft : null;
    const wait = say(`<span class="spin"></span> Czytam…`, "bot", "wait");
    const L = await llmParse(t, c, prevDraft ? prevDraft.ev.text : null); wait.remove();
    const rules = parse(t, c);
    let ev;
    if (L && L.length > 1) { draft = null; multi(L); return; }
    if (L && L.length === 1) {
      ev = L[0];
      if (rules.kind === ev.kind) {   // what the rules saw and the model missed (a GPS fix, a sector id, a time)
        if (!ev.place && rules.place) ev.place = rules.place; if (!ev.t && rules.t) { ev.t = rules.t; if (ev.kind === "sighting" || ev.kind === "clue") ev.seenAt = ev.t; }
        if ((ev.kind === "search" || ev.kind === "dispatch") && !(ev.segs && ev.segs.length) && rules.segs && rules.segs.length) ev.segs = rules.segs;
        ev.missing = ev.missing.filter((m) => !(m === "place" && ev.place) && !(m === "segs" && ev.segs && ev.segs.length));
      }
    } else {
      const parts = splitEvents(t, c);
      if (parts.length > 1) { draft = null; multi(parts); return; }
      ev = rules;
    }
    // a follow-up answer fills what the last card was missing ("przy Wielkim Stawie", "o 15:10", "S4")
    if (draft && draft.ev.missing.length && (!ev.kind || ev.kind === draft.ev.kind)) {
      const d = draft.ev;
      if (!d.place && ev.place) d.place = ev.place; if (!d.dir && ev.dir) d.dir = ev.dir; if (!d.t && ev.t) { d.t = ev.t; if (["sighting", "clue"].includes(d.kind)) d.seenAt = ev.t; }
      if ((d.kind === "search" || d.kind === "dispatch") && ev.segs && ev.segs.length) d.segs = ev.segs; else if ((d.kind === "search" || d.kind === "dispatch") && ev.place && ev.place.seg) d.segs = [ev.place.seg];
      if (d.place && !d.place.seg) { const s = segAt(ctx.segs, d.place.p); if (s) d.place.seg = s.id; }
      d.text += " / " + t; d.missing = d.missing.filter((m) => !(m === "place" && d.place) && !(m === "time" && d.t) && !(m === "segs" && d.segs && d.segs.length));
      const old = draft.el; old.querySelector(".ch-card")?.classList.add("off"); const oa = old.querySelector(".ch-acts"); if (oa) oa.innerHTML = `<span class="mute">Uzupełnione poniżej.</span>`;
      ev = d;
    }
    if (!ev.kind) {
      draft = null;
      say(`Nie rozpoznałem, co się stało. Napisz jednym zdaniem: <i>kto / co</i>, <i>gdzie</i> (nazwa z mapy albo sektor S1-S20), <i>kiedy</i>. Np. „widziałem go o 15:10 przy Wielkim Stawie”, „S4 przeszukany, nic”, „znalazłem rękawiczkę przy schronisku”.${host.mode() === "live" ? ` <button class="ch-lnk" data-raw>Wyślij jako meldunek tekstowy</button> - serwer przeczyta go swoimi regułami i modelem językowym.` : ""}`).querySelector("[data-raw]")?.addEventListener("click", () => sendRaw(t));
      return;
    }
    card(ev);
  }
  function multi(evs) {
    const els = evs.map((ev) => { ev._multi = true; card(ev); const el = draft.el; draft = null; return el; });
    const box = say(`<div class="ch-multi"><b>Rozpoznałem ${evs.length} zdarzenia.</b> Sprawdź karty powyżej (możesz je poprawić), potem dodaj wszystkie naraz.
      <div class="ch-acts"><button class="ch-addall primary">Dodaj wszystkie (${evs.length})${host.mode() === "live" ? " na żywo" : host.mode() === "hist" ? " - symulacja" : ""}</button><button class="ch-no">Anuluj</button></div></div>`);
    box.querySelector(".ch-no").onclick = () => { els.forEach((el) => el.querySelector(".ch-card")?.classList.add("off")); box.querySelector(".ch-acts").innerHTML = `<span class="mute">Anulowano.</span>`; };
    box.querySelector(".ch-addall").onclick = () => commitAll(evs, els, box);
  }
  function placeOptions(ev) {
    const seen = new Set(), o = [];
    for (const g of [...ctx.G].sort((a, b) => b.prio - a.prio || a.name.localeCompare(b.name, "pl"))) { if (seen.has(g.name) || g.name === "IPP") continue; seen.add(g.name); o.push(g); }
    return o;
  }
  function card(ev, into, keepPicks) {
    const k = KINDS[ev.kind], live = host.mode() === "live";
    // one tap, no forms: what is missing is picked from the top sectors (or typed as the next message); the editor stays folded
    const needPlace = ev.missing.includes("place"), needSegs = ev.missing.includes("segs") || (keepPicks && ev.kind === "search");
    const top = (ranking(host.run()).length ? ranking(host.run()) : ctx.segs).slice(0, 6), sel = new Set(ev.segs || []);
    const picks = needPlace || needSegs ? `<div class="ch-ask">${needPlace ? "Gdzie? Stuknij sektor albo napisz nazwę miejsca." : ev.kind === "search" ? "Które sektory? Stuknij (kilka naraz) albo napisz." : "Który sektor? Stuknij albo napisz."}</div>
      <div class="ch-picks">${[...top, ...ctx.segs.filter((s) => sel.has(s.id) && !top.some((x) => x.id === s.id))].map((s) => `<button type="button" data-pick="${esc(s.id)}" class="${sel.has(s.id) ? "on" : ""}"><b>${esc(s.id)}</b> ${esc(short(s.name))}</button>`).join("")}</div>` : "";
    const html = (`<div class="ch-card k-${ev.kind}"><div class="ch-kind"><span class="ico">${k.ico}</span>${esc(k.label)} <span class="conf c-${fold(ev.conf)}">${ev.ai ? "AI · " : ""}pewność: ${esc(ev.conf)}</span></div>
      <div class="ch-sum">${esc(summary(ev))}</div>${miniMap(ctx, ev)}
      ${picks}
      <div class="ch-acts"${ev._multi ? " hidden" : ""}><button class="ch-add primary big" ${ev.missing.includes("place") || ev.missing.includes("segs") ? "disabled" : ""}>Dodaj${live ? " (na żywo)" : host.mode() === "hist" ? " (symulacja)" : ""}</button><button class="ch-no">Anuluj</button></div>
      <details class="ch-edit"><summary>Popraw ręcznie</summary>${fieldsHTML(ev)}</details>
      <div class="ch-foot">${live ? "Na żywo: zobaczą to wszyscy w akcji. Możesz cofnąć." : host.mode() === "hist" ? "Historia: zmiana tylko na Twoim ekranie (symulacja), nagranie zostaje nietknięte." : ""}</div></div>`);
    let el = into; if (el) el.innerHTML = html; else el = say(html);
    if (!ev._multi || !into) draft = { ev, el };
    wireFields(el, ev);
    el.querySelectorAll("[data-pick]").forEach((b) => b.onclick = () => {
      const s = ctx.segs.find((x) => x.id === b.dataset.pick); if (!s) return;
      if (ev.kind === "search") { const set = new Set(ev.segs || []); set.has(s.id) ? set.delete(s.id) : set.add(s.id); ev.segs = [...set]; }
      else if (ev.kind === "dispatch") ev.segs = [s.id];
      else if (s.c) ev.place = { name: `${s.id} ${s.name}`, p: s.c.slice(), r: ev.kind === "found" ? 30 : 500, how: "sektor", seg: s.id };
      ev.missing = ev.missing.filter((m) => !(m === "place" && ev.place) && !(m === "segs" && ev.segs && ev.segs.length));
      if ((ev.kind === "search" || ev.kind === "dispatch") && !(ev.segs && ev.segs.length) && !ev.missing.includes("segs")) ev.missing.push("segs");
      card(ev, el, ev.kind === "search");
    });
    el.querySelector(".ch-no").onclick = () => { el.querySelectorAll(".ch-picks, .ch-ask").forEach((x) => x.remove()); el.querySelector(".ch-card").classList.add("off"); el.querySelector(".ch-acts").innerHTML = `<span class="mute">Anulowano.</span>`; draft = null; };
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
    el.querySelectorAll(".ch-picks, .ch-ask").forEach((x) => x.remove());
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
  async function commitAll(evs, els, box) {
    const ok = evs.filter((e) => !e.missing.includes("place") && !e.missing.includes("segs"));
    if (!ok.length) { say("Żadna karta nie ma jeszcze miejsca ani sektora - popraw je w „Popraw szczegóły”."); return; }
    const acts = box.querySelector(".ch-acts"); acts.innerHTML = `<span class="spin"></span> Dodaję ${ok.length} i przeliczam mapę…`;
    const mode = host.mode(), undos = [], notes = []; let before = null, after = null, how = "";
    try {
      if (mode === "hist") { const r = await commitSim(ok, ++n); before = r.before; after = r.after; how = r.how; undos.push(r.undo); if (r.note) notes.push(r.note); }
      else for (const ev of ok) {
        n++; const r = mode === "live" ? await commitLive(ev, n) : await commitStudio(ev, n); if (!r) continue;
        if (!before) before = r.before; after = r.after; how = r.how; if (r.undo) undos.push(r.undo); if (r.note) notes.push(r.note);
      }
      ok.forEach((ev) => { const el = els[evs.indexOf(ev)]; el.querySelector(".ch-edit")?.removeAttribute("open"); el.querySelectorAll(".ch-picks, .ch-ask").forEach((x) => x.remove()); el.querySelector(".ch-card")?.classList.add("added"); });
      acts.innerHTML = `<span class="ok">✓ Dodano ${ok.length}${how === "sim" ? " do symulacji" : how === "live" ? " na żywo" : ""}</span>${ok.length < evs.length ? ` <span class="mute">(pominięto ${evs.length - ok.length} bez miejsca)</span>` : ""}`;
      const all = { segs: ok.flatMap((e) => e.segs || []) }, focusSeg = (ok[0].place && ok[0].place.seg) || (ok[0].segs && ok[0].segs[0]);
      const m = say(`${notes.length ? `<div class="ch-note">${notes.join(" ")}</div>` : ""}${after && after.length ? diffHTML(before || [], after, all) : ""}
        <div class="ch-acts"><button class="ch-lnk" data-focus="${esc(focusSeg || "")}">Pokaż na mapie</button>${undos.length ? `<button class="ch-lnk" data-undo>Cofnij wszystkie</button>` : ""}</div>`, "bot", "res");
      const entry = { n, ev: ok[0], how, el: m, undo: async () => { let r = null; for (const u of undos.reverse()) r = await u() || r; return r; } }; done.push(entry);
      m.querySelector("[data-focus]").onclick = () => host.focus({ segId: focusSeg });
      m.querySelectorAll("li[data-seg]").forEach((li) => li.onclick = () => host.focus({ segId: li.dataset.seg }));
      const u = m.querySelector("[data-undo]"); if (u) u.onclick = () => undo(entry, u);
      if (opts.onAdded) opts.onAdded(entry);
    } catch (e) { acts.innerHTML = `<span class="err">Nie udało się: ${esc(e.message || e)}</span>`; }
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
  function baseRun() { if (!sim.baseP) { sim.baseP = simRun([]).then((r) => (sim.base = r)); sim.baseP.catch(() => { sim.baseP = null; }); } return sim.baseP; }
  async function prefetch() { try { await ensureCtx(); if (host.mode() === "hist" && ctx.scn) await baseRun(); } catch (e) { /* computed on the first Dodaj */ } }
  async function commitSim(evIn, k) {
    const list = Array.isArray(evIn) ? evIn : [evIn], ev = list[0];
    if (list.some((e) => e.kind === "dispatch")) throw new Error("wysłanie zespołu działa tylko na żywo");
    const at0 = host.clock(), lo = rel(ctx.start, ctx.start), mx = host.maxClock ? host.maxClock() : null;
    const atOf = (e) => { let a = e.t || at0; if (rel(a, ctx.start) < lo) a = e.kind === "weather" && e.tFrom ? ctx.start : at0; if (mx && rel(a, ctx.start) > rel(mx, ctx.start)) a = mx; return a; };   // a sighting at 14:20 (before the call) is noted at the current moment, seen at 14:20; never after the recording's find
    const at = atOf(ev), evs = list.flatMap((e, i) => scenarioEvents(e, atOf(e), list.length > 1 ? `${k}.${i + 1}` : k, ctx));
    if (!evs.length) { if (ev.kind === "status") throw new Error("status zespołu bez zmiany pogody nie zmienia mapy w historii - dodaj go na żywo"); throw new Error("za mało danych (miejsce / sektor)"); }
    // "teraz" = the latest of the events and the clock: an old observation still changes where to search NOW
    const cmp = list.map(atOf).reduce((a, b) => rel(b, ctx.start) > rel(a, ctx.start) ? b : a, at0);
    // the baseline (recording without chat events) is prefetched when the chat opens, else computed in parallel with the new run
    const prevLast = sim.events.length ? sim.last : null;
    sim.events.push(...evs);
    let run, base;
    try { [base, run] = await Promise.all([baseRun(), simRun(sim.events)]); } catch (e) { sim.events = sim.events.filter((x) => !evs.includes(x)); throw e; }
    const before = ranking(prevLast || base, cmp, ctx.start); sim.last = run;
    await host.apply(run, { at: cmp });
    const undo = async () => {
      sim.events = sim.events.filter((e) => !evs.includes(e));
      const b = ranking(sim.last, cmp, ctx.start);
      if (!sim.events.length) { sim.last = null; await host.restore(); return { before: b, after: ranking(sim.base, cmp, ctx.start) }; }
      const r2 = await simRun(sim.events); sim.last = r2; await host.apply(r2, { at: cmp }); return { before: b, after: ranking(r2, cmp, ctx.start) };
    };
    const note = list.length > 1 ? "" : at !== ev.t && ev.t ? `${ev.kind === "weather" ? "Zmiana" : "Obserwacja"} z ${esc(ev.t)} - na osi czasu akcji zapisana o ${esc(at)}${rel(ev.t, ctx.start) < 0 ? " (przed zgłoszeniem)" : ""}.` : ev.dir ? `Kierunek „${esc(ev.dir.name)}”: korytarz wzdłuż szlaku (±300 m).` : "";
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
  // before the shell has a run its scenario is still the store default ("studio"): no context fetch then (it asked /story/scenario on every
  // /app load, a /scenarios/studio.json 404 before de41e02); the first prefetch / message after the run loads builds it
  (host.run() && host.run().steps ? ensureCtx() : Promise.resolve()).then(renderChips).catch(() => renderChips());
  hello();
  // a short plain-text summary of what was added and where to search now (czat.html "Udostępnij podsumowanie")
  function summaryText() {
    const R = host.run(), top = ranking(R, host.clock(), ctx ? ctx.start : "00:00").slice(0, 3);
    const lines = done.filter((d) => !d.el.classList.contains("undone")).map((d) => "- " + summary(d.ev).replace(/^Na mapie zaznaczę: /, "").replace(/^Oznaczę jako /, ""));
    return `Rescue Locator - ${host.scenario()}: moje zgłoszenia\n${lines.join("\n") || "- (jeszcze nic)"}\nGdzie szukać najpierw: ${top.map((s, i) => `${i + 1}. ${s.id} ${s.name} (${pl1(+s.areaPct || 0)}% obszaru)`).join("; ")}`;
  }
  return { say, onText, ensureCtx, summaryText, resetSim: () => { sim.events = []; sim.last = null; sim.base = null; sim.baseP = null; }, prefetch, get simActive() { return sim.events.length > 0; }, renderChips, hello };
}

// the embedded 2D view (same origin, web/ untouched): a what-if run lives at a blob: URL, and the view's 5 s HEAD poll of its run
// URL fails on blob: (net::ERR_METHOD_NOT_SUPPORTED) - answer those HEADs locally; on phones shrink the legend, hide the map panel
export function tameFrame(f, narrow) {
  const go = () => {
    try {
      const w = f.contentWindow, d = f.contentDocument; if (!w || !d) return;
      if (!w.__chatFetch) { const of = w.fetch.bind(w); w.__chatFetch = of; w.fetch = (u, o) => (String(u && u.url || u).startsWith("blob:") && o && String(o.method).toUpperCase() === "HEAD") ? Promise.resolve(new w.Response(null, { status: 200 })) : of(u, o); }
      if (narrow && narrow() && !d.getElementById("chCompact") && d.head) {
        const st = d.createElement("style"); st.id = "chCompact";
        st.textContent = "#mapctl{display:none!important}#legend{padding:4px 7px!important;font-size:10px!important}#legend .lg-title{font-size:10.5px;margin-bottom:1px}#legend .lg-ramp,#legend .lg-stops{width:140px!important}#legend .lg-ramp{height:6px}#legend .lg-stops{font-size:9px}#legend .lg-keys{display:none}.maplibregl-ctrl-scale,#rl-version{display:none!important}";
        d.head.appendChild(st);
      }
    } catch (e) { /* not reachable: leave the frame as is */ }
  };
  f.addEventListener("load", go); go();
}
// Historia "teraz": the shown step, but never at or past the scripted find (an event added after ZNALEZIONO changes nothing)
function beforeFind(R, i) { const f = R.steps.findIndex((s) => s.kind === "found"); let k = Math.max(0, Math.min(i, R.steps.length - 1)); if (f >= 0 && k >= f) k = Math.max(0, f - 1); return R.steps[k]; }
// ---------------------------------------------------------------- host 1: the /app shell (drawer + floating button)
export function mountAppChat() {
  const A = () => window.rescueApp, st = () => window.rescueStore;
  if (!A() || !A().applyRun || !st()) { setTimeout(mountAppChat, 250); return; }
  const btn = document.createElement("button"); btn.id = "chBtn"; btn.type = "button"; btn.innerHTML = `<span aria-hidden="true">💬</span><span class="lbl">Czat</span>`; btn.setAttribute("aria-label", "Czat"); btn.title = "Dodaj zdarzenie zwykłym zdaniem";
  const dr = document.createElement("aside"); dr.id = "chDrawer"; dr.setAttribute("aria-label", "Czat - dodaj zdarzenie");
  dr.innerHTML = `<div class="ch-head"><b>Czat</b><span class="ch-mode"></span><button class="ch-x" type="button" aria-label="Zamknij">✕</button></div><div class="ch-sim" hidden>Symulacja: mapa pokazuje Twoje dodane zdarzenia. <button type="button" class="ch-lnk" data-back>Wróć do nagrania</button></div><div class="ch-body"></div>`;
  // the button sits in the top bar (before "Udostępnij"): a floating button covered "Wyślij zespół" / "Potwierdź wszystkie" in Na żywo
  const anchor = document.getElementById("shareBtn");
  if (anchor && anchor.parentNode) { btn.classList.add("inhdr"); anchor.before(btn); document.body.append(dr); } else document.body.append(btn, dr);
  // every 2D frame the shell creates (its double buffer swaps in a new <iframe>) gets the blob HEAD shim
  const f2 = document.getElementById("frame2d"); if (f2) { tameFrame(f2); new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.tagName === "IFRAME" && !n.__tamed) { n.__tamed = 1; tameFrame(n); } }))).observe(f2.parentNode, { childList: true }); }
  // no blank 2D after a chat change: the shell posts {type:"run", url} to its ready 2D view, which updates the run in place
  // (web/app.js runInPlace, same grid: ~30 ms, camera kept); another grid still reloads (shell double buffer)
  const buffered = (fn) => fn();
  let simRun = null, restoring = false, blob = null;
  const S = () => st();
  const live = () => S().time === "live" && S().backend === "api" && S().mode !== "edycja";
  const host = {
    scenario: () => S().backend === "studio" ? "zawrat" : S().scenario,
    run: () => S().run,
    mode: () => S().backend === "studio" ? "studio" : live() && !host.forceSim ? "live" : "hist",
    maxClock: () => { const R = S().run; return R && R.steps && !live() ? beforeFind(R, R.steps.length - 1).t : null; },
    clock: () => { const R = S().run; if (!R || !R.steps) return "12:00"; if (live()) return (R.liveCursor && R.liveCursor.at) || R.steps[R.steps.length - 1].t; return beforeFind(R, S().step - 1).t; },
    async refreshLive() {
      if (!S().runUrl) return S().run;
      // runInline (1f20792): the frames parse this copy instead of a second GET of the same run
      const u = new URL(S().runUrl, location.href).href, text = await (await fetch(S().runUrl, { cache: "no-cache" })).text(), r = JSON.parse(text);
      if (r && r.steps) { window.__rescueRunText = { url: u, text }; buffered(() => A().applyRun(r, {}, "run")); }
      return r;
    },
    async apply(run, info) {
      if (blob) { const o = blob; setTimeout(() => URL.revokeObjectURL(o), 30000); }
      const text = JSON.stringify(run); blob = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      window.__rescueRunText = { url: blob, text };   // runInline: the 2D view parses this copy instead of fetching the blob
      simRun = run; if (S().mode !== "akcja") A().setMode("akcja");
      buffered(() => A().applyRun(run, { runUrl: blob, assessUrl: null }, "edit"));
      if (info && info.at) { let k = 0; const st = run.steps[0].t; run.steps.forEach((s, i) => { if (rel(s.t, st) <= rel(info.at, st) && s.kind !== "found") k = i; }); A().setStep(k + 1); }
      dr.querySelector(".ch-sim").hidden = false;
    },
    async restore() { restoring = true; simRun = null; dr.querySelector(".ch-sim").hidden = true; try { await A().loadScenario(S().scenario); } finally { restoring = false; } },
    focus({ segId }) { if (S().mode !== "akcja") A().setMode("akcja"); if (segId && S().selSeg !== segId) A().selectSeg(segId); else if (segId) { A().selectSeg(segId); A().selectSeg(segId); } },
    addInput: (inp) => A().addInput(inp), undoInput: () => A().undo(),
  };
  const chat = createChat(dr.querySelector(".ch-body"), host);
  // dock: the timeline marker of every chat event (simulation steps titled "Czat N: ...") gets a ring, same groups as dock.js
  const markDock = () => {
    const tm = document.getElementById("tlMarks"), R = S().run; if (!tm || !R || !R.steps) return;
    evGroups(R).forEach((g, j) => { const el = tm.children[j]; if (!el) return; const c = g.ks.some((k) => /^Czat \d/.test(R.steps[k - 1].label || "")); el.classList.toggle("chat", c); if (c) el.title = "Zdarzenie z czatu"; });
  };
  { const tm = document.getElementById("tlMarks"); if (tm) new MutationObserver(markDock).observe(tm, { childList: true }); }
  const mode = () => { const m = host.mode(); dr.querySelector(".ch-mode").textContent = m === "live" ? "NA ŻYWO" : m === "studio" ? "PLAN" : "HISTORIA"; dr.querySelector(".ch-mode").className = "ch-mode m-" + m; };
  const open = (on) => { dr.classList.toggle("open", on); btn.classList.toggle("on", on); mode(); if (on) { chat.prefetch(); setTimeout(() => dr.querySelector("textarea").focus(), 200); } try { sessionStorage.setItem("rescue-chat-open", on ? "1" : ""); } catch (e) {} };
  btn.onclick = () => open(!dr.classList.contains("open"));
  dr.querySelector(".ch-x").onclick = () => open(false);
  dr.querySelector("[data-back]").onclick = () => { chat.resetSim(); host.restore(); chat.say("Wróciłem do nagrania - symulacja wyczyszczona."); };
  A().onStore && A().onStore((why) => {
    mode();
    if (why === "load") chat.ensureCtx().catch(() => {});   // another scenario: its own gazetteer and example chips
    // the shell loaded something else (scenario switch, Historia / Na żywo): a running simulation is gone
    if (why === "load" && simRun && !restoring) { simRun = null; dr.querySelector(".ch-sim").hidden = true; chat.resetSim(); chat.say("Symulacja zakończona: wczytano inne dane (scenariusz albo tryb czasu)."); }
  });
  try { if (sessionStorage.getItem("rescue-chat-open") || new URLSearchParams(location.search).get("chat")) open(true); } catch (e) {}
  window.rescueChat = { open, chat, host };
}

// ---------------------------------------------------------------- host 2: czat.html (full screen chat + small 2D map)
export async function mountStandalone() {
  const q = new URLSearchParams(location.search), sc = q.get("sc") || "zawrat";
  let frame = document.getElementById("czMap"), next = null, nextSel = null;
  const body = document.getElementById("czChat");
  let run = null, ready = false, pending = [], blob = null, liveWanted = false, selSeg = null;
  const narrow = () => matchMedia("(max-width:760px)").matches;
  tameFrame(frame, narrow);
  const post = (m) => { if (m.type === "select") selSeg = m.segmentId; if (ready) frame.contentWindow.postMessage({ source: "rescue-app", ...m }, location.origin); else pending.push(m); };
  const frameURL = (run) => `../web/index.html?embed=scene&sc=${encodeURIComponent(sc)}&parentOrigin=${encodeURIComponent(location.origin)}&run=${encodeURIComponent(run)}&scenario=${encodeURIComponent(`/scenarios/${sc}.json`)}`;
  // double buffer: the new run boots in a hidden second frame; the old map stays until it says "ready", then a 200 ms crossfade
  const swapTo = (runUrl) => {
    if (!frame.getAttribute("src")) { frame.src = frameURL(runUrl); return; }
    // a ready view takes the new run in place (web/app.js runInPlace: no reload, camera kept; it answers "ready" with inplace)
    if (ready && !next) { window.__chatSwapT = performance.now(); ready = false; frame.contentWindow.postMessage({ source: "rescue-app", type: "run", url: runUrl }, location.origin); return; }
    if (next) next.remove();
    next = document.createElement("iframe"); next.title = frame.title; next.className = "cz-next";
    next.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;opacity:0;pointer-events:none;transition:opacity .2s";
    tameFrame(next, narrow); next.src = frameURL(runUrl); frame.after(next); window.__chatSwapT = performance.now();
  };
  addEventListener("message", (e) => {
    if (e.origin !== location.origin || !e.data || e.data.source !== "rescue2d") return;
    if (next && e.source === next.contentWindow && e.data.type === "ready") {
      const o = frame; frame = next; next = null; frame.id = "czMap"; o.removeAttribute("id"); frame.style.opacity = "1";
      window.__chatSwapMs = Math.round(performance.now() - (window.__chatSwapT || 0));
      setTimeout(() => { o.remove(); frame.style.cssText = ""; frame.style.pointerEvents = ""; }, 220);
      ready = true; const p = pending; pending = []; if (selSeg && !p.some((m) => m.type === "select")) p.push({ type: "select", segmentId: selSeg }); p.forEach(post); return;
    }
    if (e.source !== frame.contentWindow) return;
    if (e.data.type === "ready") { if (e.data.inplace) window.__chatSwapMs = Math.round(performance.now() - (window.__chatSwapT || 0)); ready = true; const p = pending; pending = []; if (e.data.inplace && selSeg && !p.some((m) => m.type === "select")) p.push({ type: "select", segmentId: selSeg }); p.forEach(post); }
  });
  // one GET of the run: the embedded 2D view parses the same text (runInline, window.__rescueRunText) instead of a second GET
  const runText = async () => { const r = await fetch(`/api/run/${encodeURIComponent(sc)}`, { cache: "no-cache" }); if (!r.ok) throw new Error(r.status); const text = await r.text(); window.__rescueRunText = { url: new URL(`/api/run/${sc}`, location.href).href, text }; return JSON.parse(text); };
  try { run = await runText(); } catch (e) { run = null; }
  const startRun = run;
  swapTo(`/api/run/${sc}`);
  const liveAt = () => (run && run.liveCursor && run.liveCursor.at) || (startRun && startRun.steps && beforeFind(startRun, startRun.steps.length - 1).t) || "12:00";
  const host = {
    scenario: () => sc, run: () => run,
    mode: () => liveWanted && hasKey() && !host.forceSim ? "live" : "hist",
    clock: liveAt, maxClock: liveAt,
    simCut: () => (startRun && startRun.liveCursor && startRun.liveCursor.at) || null,
    async refreshLive() { const r = await runText(); run = r; swapTo(`/api/run/${sc}`); return r; },
    async apply(r) { run = r; const old = blob; const text = JSON.stringify(r); blob = URL.createObjectURL(new Blob([text], { type: "application/json" })); window.__rescueRunText = { url: blob, text }; swapTo(blob); if (old) setTimeout(() => URL.revokeObjectURL(old), 30000); },
    async restore() { run = startRun; try { run = await runText(); } catch (e) {} swapTo(`/api/run/${sc}`); },
    focus({ segId }) { if (segId) post({ type: "select", segmentId: segId }); document.body.classList.add("cz-map-big"); setTimeout(() => document.getElementById("czMapBox").scrollIntoView({ behavior: "smooth", block: "nearest" }), 50); },
  };
  setTimeout(() => chat.prefetch(), 1500);
  const chat = createChat(body, host, { voice: true, placeholder: "Co widziałeś? Np. „widziałem kogoś przy Wielkim Stawie 20 min temu”" });
  const sh = document.getElementById("czShare");
  if (sh) sh.onclick = async () => {
    const text = chat.summaryText(), url = location.href.split("#")[0];
    try { if (navigator.share) { await navigator.share({ title: "Rescue Locator - zgłoszenie", text, url }); return; } } catch (e) { if (e && e.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(text + "\n" + url); chat.say("Podsumowanie skopiowane - wklej je w SMS-ie albo komunikatorze."); }
    catch (e) { chat.say(`<pre class="ch-pre">${esc(text)}</pre>Zaznacz i skopiuj powyższy tekst.`); }
  };
  // big quick starts for casual users: they start a short guided dialog (the parser asks for what is missing)
  document.querySelectorAll("[data-quick]").forEach((b) => b.onclick = () => chat.onText(b.dataset.quick));
  const tg = document.getElementById("czLive");
  if (tg) { tg.hidden = !hasKey(); tg.onchange = () => { liveWanted = tg.checked; chat.say(liveWanted ? "Tryb: <b>zgłoszenie do akcji na żywo</b> - zobaczy je kierownik akcji." : "Tryb: <b>podgląd</b> - zmiany tylko na Twoim ekranie."); }; }
  window.rescueChat = { chat, host };
}
