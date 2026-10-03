// Odprawa (druk): one A4 page for the incident commander's briefing. Reads GET /api/run/<sc> (live; with ?t=HH:MM the recording,
// ?live=0, at the last step not after t), the scenario file (subject) and GET /api/inventory (warnings, crews). No server changes.
// Map: a server-free canvas of the segments (heat from poaGrid, top 3 outlined, searched hatched); no basemap so it prints anywhere.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const Q = new URLSearchParams(location.search);
  const SC = Q.get("sc") || "zawrat", T = /^\d\d:\d\d$/.test(Q.get("t") || "") ? Q.get("t") : "";
  const toMin = (hm) => { const [h, m] = String(hm).split(":").map(Number); return h * 60 + m; };
  const hm = (min) => { min = ((Math.round(min) % 1440) + 1440) % 1440; return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0"); };
  const dur = (min) => { min = Math.max(0, Math.round(min)); const h = Math.floor(min / 60), m = min % 60; return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`; };
  const pct = (v) => (Math.round(v * 10) / 10).toFixed(1).replace(".", ",") + "%";
  const short = (n) => String(n || "").replace(/\s*\(.*\)\s*$/, "");
  async function getJSON(u) { const r = await fetch(u, { cache: "no-cache" }); if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }

  // sunrise / sunset / civil dusk (NOAA sunrise equation), returned as minutes of local Warsaw time
  function sun(dateStr, lat, lon) {
    const rad = Math.PI / 180, day = Date.parse(dateStr + "T12:00:00Z");
    const n = Math.round(day / 864e5 + 2440587.5 - 2451545.0 + 0.0008), Js = n - lon / 360;
    const M = (357.5291 + 0.98560028 * Js) % 360, C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
    const L = (M + C + 180 + 102.9372) % 360, Jt = 2451545 + Js + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
    const dec = Math.asin(Math.sin(L * rad) * Math.sin(23.44 * rad));
    const at = (alt) => { const w = Math.acos((Math.sin(alt * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec))) / rad; return [Jt - w / 360, Jt + w / 360]; };
    const local = (J) => { const d = new Date((J - 2440587.5) * 864e5); const p = new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d); return toMin(p); };
    const [r, s] = at(-0.833), [, c] = at(-6);
    return { rise: local(r), set: local(s), dusk: local(c) };
  }

  async function load() {
    const [run, scen, list] = await Promise.all([
      getJSON(`/api/run/${encodeURIComponent(SC)}${T ? "?live=0" : ""}`),
      getJSON(`/scenarios/${encodeURIComponent(SC)}.json`).catch(() => null),
      getJSON("/api/scenarios").catch(() => ({ scenarios: [] })),
    ]);
    const start = toMin((scen && scen.startClock) || run.steps[0].t);
    let st = run.steps[run.steps.length - 1];
    if (T) { const want = (toMin(T) - start + 1440) % 1440; st = run.steps.filter((s) => s.minute <= want).pop() || run.steps[0]; }
    let inv = null; try { inv = await getJSON(`/api/inventory?sc=${encodeURIComponent(SC)}&at=${encodeURIComponent(st.t)}`); } catch (e) { inv = null; }
    picker(list.scenarios || [], st.t);
    render(run, scen, st, inv, start);
  }

  function picker(scs, t) {
    $("sc").innerHTML = (scs.length ? scs : [{ name: SC }]).map((s) => `<option value="${esc(s.name)}"${s.name === SC ? " selected" : ""}>${esc(s.name)}</option>`).join("");
    $("t").value = T || t;
    // a new scenario opens live; a changed hour opens the recording at that hour (?t=)
    $("sc").onchange = () => { location.search = new URLSearchParams({ sc: $("sc").value }); };
    $("t").onchange = () => { const q = new URLSearchParams({ sc: SC }); if ($("t").value) q.set("t", $("t").value); location.search = q; };
    $("print").onclick = () => window.print();
  }

  function render(run, scen, st, inv, start) {
    const now = start + st.minute, live = !T && run.liveCursor;
    const title = String(run.incident || SC).replace(/\s*\(scenariusz fikcyjny\)\s*$/, "");
    document.title = `Odprawa ${st.t} - ${title}`;
    $("incident").textContent = title;
    $("meta").innerHTML = `<b>${esc(run.date || "")}, godz. ${esc(st.t)}</b> · ${live ? "akcja na żywo" : "nagranie (Historia)"} · ${esc(SC)} · stan po: ${esc(st.label)}`;

    const sub = (scen && scen.subject) || {};
    $("person").innerHTML = `<b>${esc(sub.name || "brak danych")}</b>${sub.age ? `, ${esc(sub.age)} lat` : ""}${sub.category ? ` <span class="mute">(${esc(catPL(sub.category))})</span>` : ""}<br>${esc(sub.note || "")}`;

    const ipp = run.ipp || {}, lc = sub.lastContact;
    $("lkp").innerHTML = `${esc(String(ipp.name || "").replace(/^IPP:\s*/, ""))}<br><span class="mono">${(+ipp.lat).toFixed(5)} N, ${(+ipp.lon).toFixed(5)} E</span>` +
      (lc ? `<br>Ostatni kontakt <b>${esc(lc)}</b>, <b>${dur((now - toMin(lc) + 1440) % 1440)}</b> temu` : "") +
      `<br><span class="mute">Zgłoszenie ${hm(start)}, od zgłoszenia ${dur(st.minute)}.</span>`;

    const w = st.weather || {}, s = sun(run.date, ipp.lat, ipp.lon), cur = now % 1440;
    const light = cur < s.rise ? `ciemno, wschód <b>${hm(s.rise)}</b> (za ${dur(s.rise - cur)})`
      : cur < s.set ? `do zachodu <b>${dur(s.set - cur)}</b> (zachód ${hm(s.set)}, zmrok ${hm(s.dusk)})`
      : `po zachodzie (${hm(s.set)}), ciemno do wschodu <b>${hm(s.rise)}</b> (${dur(s.rise + 1440 - cur)})`;
    const wx = [w.tempC != null ? `${w.tempC}°C` : "", w.windMs != null ? `wiatr ${w.windMs} m/s` : "", w.visibilityM != null ? `widzialność ${w.visibilityM} m` : "", w.precip && w.precip !== "none" ? precipPL(w.precip) : "", w.ice ? "oblodzenie" : ""].filter(Boolean).join(", ");
    $("weather").innerHTML = `${wx || "brak danych"}<br>Światło: ${light}` + (w.survival ? `<br><span class="warn ${w.survival.level === "wysoki" || w.survival.level === "krytyczny" ? "red" : ""}">${esc(w.survival.text)}</span>` : "") + (w.note ? `<br><span class="mute od-weather-note">${esc(w.note)}</span>` : "");

    const top = st.segments.slice(0, 3), area = top.reduce((a, x) => a + (+x.areaPct || 0), 0);
    $("topNote").textContent = `· top 3 to ${pct(area)} obszaru`;
    // who covers the sector: new assignments, plus teams already working there (busy, not re-planned)
    const asg = (id) => st.assignments.filter((a) => a.segmentId === id).map((a) => short(resName(st, a.resourceId)))
      .concat((st.resources || []).filter((r) => r.currentSegment === id && !r.available && /przeszuk/.test(r.reason || "") && !st.assignments.some((a) => a.resourceId === r.id)).map((r) => short(r.name) + " (już tam)"));
    $("top3").innerHTML = top.map((x, i) => `<li><span class="rk">${i + 1}</span><b>${esc(x.id)}</b> ${esc(x.name)}<span class="ar">${pct(+x.areaPct)} obszaru</span><span class="who">${asg(x.id).length ? "→ " + esc(asg(x.id).join(", ")) : "<i>bez zespołu</i>"}</span></li>`).join("");

    const warns = {}; for (const u of (inv && inv.units) || []) warns[u.id] = u.warnings || [];
    const rows = [], seen = new Set();
    for (const a of st.assignments) {
      seen.add(a.resourceId);
      const flags = (a.safety || []).map((x) => `<span class="flag red">${esc(x)}</span>`).concat((warns[a.resourceId] || []).map((x) => `<span class="flag ${x.level === "red" ? "red" : ""}">${esc(x.text)}</span>`));
      const pod = a.pod != null ? ` · POD ok. ${Math.round(a.pod * 100)}%` : "";
      rows.push(`<tr><td><b>${esc(short(resName(st, a.resourceId)))}</b></td><td><b>${esc(a.segmentId)}</b> ${esc(a.segmentName)}</td><td>przeszukać: dojście ${Math.round(a.travelMin ?? a.etaMin)} min · przeszukanie ${Math.max(1, Math.round(a.sweepMin || 0))} min${pod}</td><td>${flags.join(" ") || '<span class="mute">-</span>'}</td></tr>`);
    }
    for (const r of st.resources || []) {
      if (seen.has(r.id)) continue;
      const flags = (warns[r.id] || []).map((x) => `<span class="flag ${x.level === "red" ? "red" : ""}">${esc(x.text)}</span>`);
      rows.push(`<tr class="busy"><td><b>${esc(short(r.name))}</b></td><td>${r.currentSegment ? `<b>${esc(r.currentSegment)}</b>` : "-"}</td><td>${esc(r.reason || (r.available ? "w odwodzie" : "niedostępny"))}</td><td>${flags.join(" ") || '<span class="mute">-</span>'}</td></tr>`);
    }
    $("teams").innerHTML = rows.join("") || `<tr><td colspan="4" class="mute">Brak zespołów w tej akcji.</td></tr>`;

    const skip = new Set(["terrain", "cost", "difficulty"]);
    const ev = run.steps.filter((x) => x.minute <= st.minute && x.minute > st.minute - 60 && !skip.has(x.kind));
    const list = ev.length ? ev : run.steps.filter((x) => x.minute <= st.minute && !skip.has(x.kind)).slice(-3);
    $("events").innerHTML = (ev.length ? "" : `<li class="mute">Brak nowych zdarzeń w ostatniej godzinie. Ostatnie:</li>`) + list.map((x) => `<li><span class="mono">${esc(x.t)}</span> ${esc(x.label)}</li>`).join("");

    $("src").textContent = `Źródło: silnik Rescue Locator, ${live ? "GET /api/run (na żywo)" : "nagranie scenariusza"}, krok ${run.steps.indexOf(st) + 1}/${run.steps.length}, wydruk ${new Date().toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" })}.`;
    drawMap(run, st, top);
    fit();
  }
  // one A4 page: at sheet width (screen >= 821 px uses the print layout) step the density up until the content fits 297 mm
  function fit() {
    const s = $("sheet"); if (!matchMedia("(min-width:821px)").matches) return;
    s.classList.remove("dense", "dense2");
    const a4 = s.getBoundingClientRect().width * 297 / 210, need = () => { s.style.minHeight = "0"; const h = s.scrollHeight; s.style.minHeight = ""; return h; };
    if (need() > a4) s.classList.add("dense");
    if (need() > a4) s.classList.add("dense2");
  }
  const resName = (st, id) => ((st.resources || []).find((r) => r.id === id) || {}).name || id;
  const catPL = (c) => ({ hiker: "turysta pieszy", child: "dziecko", dementia: "osoba z demencją", hunter: "grzybiarz / myśliwy", water: "na wodzie", skier: "narciarz" })[c] || c;
  const precipPL = (p) => ({ rain: "deszcz", snow: "śnieg", drizzle: "mżawka" })[p] || p;

  function drawMap(run, st, top) {
    const cv = $("map"), bb = run.bbox, lat0 = (bb.north + bb.south) / 2;
    const kmW = (bb.east - bb.west) * 111.32 * Math.cos(lat0 * Math.PI / 180), kmH = (bb.north - bb.south) * 110.57;
    const W = 760, H = Math.round(W * kmH / kmW); cv.width = W * 2; cv.height = H * 2;
    const g = cv.getContext("2d"); g.scale(2, 2);
    const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    const X = (lon) => (lon - bb.west) / (bb.east - bb.west) * W, Y = (lat) => (bb.north - lat) / (bb.north - bb.south) * H;
    g.fillStyle = "#fbfaf6"; g.fillRect(0, 0, W, H);
    // heat: map weight per cell relative to the max, sqrt so the tail stays visible
    const P = st.poaGrid || [], max = Math.max(...P), cw = W / run.cols, ch = H / run.rows;
    for (let r = 0; r < run.rows; r++) for (let c = 0; c < run.cols; c++) {
      const v = Math.sqrt((P[r * run.cols + c] || 0) / max); if (v < 0.12) continue;
      g.fillStyle = `rgba(${Math.round(240 - 60 * v)},${Math.round(200 - 150 * v)},${Math.round(120 - 80 * v)},${0.15 + 0.55 * v})`;
      g.fillRect(c * cw, r * ch, cw + 0.5, ch + 0.5);
    }
    const hatch = document.createElement("canvas"); hatch.width = hatch.height = 8;
    const hg = hatch.getContext("2d"); hg.strokeStyle = "rgba(31,78,121,.45)"; hg.lineWidth = 1.2; hg.beginPath(); hg.moveTo(0, 8); hg.lineTo(8, 0); hg.stroke();
    const pat = g.createPattern(hatch, "repeat"), hist = st.segmentHistory || {};
    const path = (poly) => { g.beginPath(); poly.forEach(([lon, lat], i) => (i ? g.lineTo(X(lon), Y(lat)) : g.moveTo(X(lon), Y(lat)))); g.closePath(); };
    const cen = (poly) => { const p = poly.slice(0, -1); return [p.reduce((a, q) => a + X(q[0]), 0) / p.length, p.reduce((a, q) => a + Y(q[1]), 0) / p.length]; };
    const topIds = top.map((x) => x.id);
    for (const s of st.segments) {
      if (!s.polygon) continue;
      path(s.polygon);
      if (hist[s.id] && hist[s.id].cumPod >= 0.5) { g.fillStyle = pat; g.fill(); }
      g.strokeStyle = "rgba(35,39,42,.45)"; g.lineWidth = 1; g.setLineDash([]); g.stroke();
      if (!topIds.includes(s.id)) { const [x, y] = cen(s.polygon); g.fillStyle = "#4a5054"; g.font = "600 12px Barlow, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(s.id, x, y); }
    }
    const red = css("--rl-danger") || "#b8322a";
    top.forEach((s, i) => {
      if (!s.polygon) return;
      path(s.polygon); g.strokeStyle = red; g.lineWidth = i === 0 ? 4 : 3; g.stroke();
      const [x, y] = cen(s.polygon);
      g.beginPath(); g.arc(x, y, 13, 0, 7); g.fillStyle = i === 0 ? red : "#fff"; g.fill(); g.lineWidth = 2; g.strokeStyle = red; g.stroke();
      g.fillStyle = i === 0 ? "#fff" : red; g.font = "700 15px Barlow, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(i + 1), x, y + 0.5);
      g.font = "700 12px Barlow, sans-serif"; g.lineWidth = 3; g.strokeStyle = "#fff"; g.strokeText(s.id, x, y + 23); g.fillStyle = "#23272a"; g.fillText(s.id, x, y + 23);
    });
    // IPP / last known point
    const ix = X(run.ipp.lon), iy = Y(run.ipp.lat);
    g.beginPath(); g.moveTo(ix, iy - 9); g.lineTo(ix + 8, iy + 6); g.lineTo(ix - 8, iy + 6); g.closePath(); g.fillStyle = "#23272a"; g.fill();
    g.font = "700 12px Barlow, sans-serif"; g.textAlign = "left"; g.lineWidth = 3; g.strokeStyle = "#fff"; g.strokeText("IPP", ix + 10, iy); g.fillStyle = "#23272a"; g.fillText("IPP", ix + 10, iy);
    // scale bar (1 km) and north
    const px1 = W / kmW; g.fillStyle = "#23272a"; g.fillRect(14, H - 18, px1, 4); g.textAlign = "left"; g.font = "600 12px Barlow, sans-serif"; g.fillText("1 km", 14, H - 28);
    g.textAlign = "center"; g.font = "700 14px Barlow, sans-serif"; g.fillText("N", W - 20, 20); g.beginPath(); g.moveTo(W - 20, 26); g.lineTo(W - 25, 40); g.lineTo(W - 15, 40); g.closePath(); g.fill();
  }

  load().catch((e) => { $("incident").textContent = "Nie udało się wczytać akcji"; $("meta").textContent = e.message; console.error(e); });
})();
