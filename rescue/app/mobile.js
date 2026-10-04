// Phone layout helpers for the incident commander (/app) - see mobile.css. AI Mateusza #2, 2026-10-04.
// Only under 600 px and never for the rescuer phone. Adds the Menu button, the sheet handle, moves the 2D/3D switch into the
// menu, keeps a phone on Akcja (Plan / Teren / Monitoring / Walidacja are desktop only) and asks the 2D frame for its compact legend.
(function () {
  const mq = matchMedia("(max-width:600px)");
  const $ = (id) => document.getElementById(id);
  const phone = () => mq.matches && !document.body.classList.contains("role-ratownik");
  let done = false;
  function setup() {
    if (done || !mq.matches) return;
    const hdr = document.querySelector("#app > header"), right = $("right");
    if (!hdr || !right) return;
    done = true;
    const head = document.createElement("div"); head.id = "mMenuHead"; head.textContent = "Więcej";
    const btn = document.createElement("button"); btn.id = "mMenuBtn"; btn.type = "button";
    btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", "mMenuHead");
    const label = () => { const on = document.body.classList.contains("m-menu"); btn.textContent = on ? "✕ Zamknij" : "☰ Menu"; btn.setAttribute("aria-expanded", String(on)); };
    btn.onclick = () => { document.body.classList.toggle("m-menu"); label(); };
    label();
    hdr.appendChild(head); hdr.appendChild(btn);
    if ($("views")) hdr.appendChild($("views"));   // 2D / 3D in the menu (app.js finds it by id, wherever it is)
    // any choice in the menu closes it (selects and the key field stay open while used)
    hdr.addEventListener("click", (e) => {
      const b = e.target.closest("button,a");
      if (!b || b === btn || !document.body.classList.contains("m-menu") || b.closest("#tmode")) return;
      document.body.classList.remove("m-menu"); label();
    });
    // bottom sheet: peek (one bar) / half / full, remembered per session; a new unconfirmed message only bumps the badge
    const KEY = "rescue-m-sheet", STATES = ["peek", "half", "full"];
    let state = "peek"; try { const v = sessionStorage.getItem(KEY); if (STATES.includes(v)) state = v; } catch (e) {}
    const peek = document.createElement("button"); peek.id = "mPeek"; peek.type = "button";
    peek.innerHTML = '<span class="mp-rank">1</span><span class="mp-name">Gdzie szukać najpierw</span><span class="mp-badge" hidden></span><span class="mp-chev" aria-hidden="true">⌄</span>';
    const more = document.createElement("button"); more.id = "mMore"; more.type = "button";
    const setSheet = (s) => {
      state = s; const b = document.body;
      for (const x of STATES) b.classList.toggle("m-sheet-" + x, x === s);
      peek.setAttribute("aria-expanded", String(s !== "peek"));
      peek.setAttribute("aria-label", (s === "peek" ? "Rozwiń panel: " : "Zwiń panel: ") + peek.querySelector(".mp-name").textContent);
      more.textContent = s === "full" ? "Mniej zdarzeń" : "Więcej zdarzeń";
      if (s !== "full") right.scrollTop = 0;
      try { sessionStorage.setItem(KEY, s); } catch (e) {}
    };
    window.rlSheet = setSheet;
    peek.onclick = () => setSheet(state === "peek" ? "half" : "peek");
    more.onclick = () => setSheet(state === "full" ? "half" : "full");
    // swipe on the bar: up = one step up, down = back to the bar
    let y0 = null;
    peek.addEventListener("touchstart", (e) => { y0 = e.touches[0].clientY; }, { passive: true });
    peek.addEventListener("touchend", (e) => {
      if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; y0 = null;
      if (dy < -30) { e.preventDefault(); setSheet(state === "peek" ? "half" : "full"); }
      else if (dy > 30) { e.preventDefault(); setSheet("peek"); }
    });
    const sync = () => {
      const top = document.querySelector("#segs .seg");
      peek.querySelector(".mp-name").textContent = top ? (top.querySelector("b") || top).textContent.trim() : "Gdzie szukać najpierw";
      peek.querySelector(".mp-rank").hidden = !top;
      const m = ($("ackCount") && $("ackCount").textContent.match(/(\d+)/)) || null, n = m ? +m[1] : 0;
      const bd = peek.querySelector(".mp-badge"); bd.hidden = !n; bd.textContent = n + " niepotwierdzone";
    };
    right.prepend(peek);
    if ($("liveBox")) $("liveBox").after(more); else right.appendChild(more);
    for (const id of ["segs", "ackCount"]) if ($(id)) new MutationObserver(sync).observe($(id), { childList: true, subtree: true, characterData: true });
    sync(); setSheet(state);
    // a phone opens on Akcja (2D): Plan is drag and drop, Teren / Monitoring / Walidacja are wide desktop panels
    const fix = () => {
      if (!phone()) return;
      const b = document.body;
      if (!b.classList.contains("mode-akcja")) { const a = document.querySelector('#modes [data-mode="akcja"]'); if (a) a.click(); }
      if (b.classList.contains("view-split")) { const v = document.querySelector('#views [data-view="2d"]'); if (v) v.click(); }
    };
    new MutationObserver(fix).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    fix();
    // the 2D frame: web/style.css (max-width:600px) shows the legend as a small strip and hides the layer panel and timeline key;
    // a tap on the strip opens all of it (body.lg-tap-open) for 3 s or until a tap elsewhere. The attribution starts collapsed.
    const f = $("frame2d");
    const compact = () => {
      try {
        const d = f.contentDocument; if (!phone() || !d || !d.body) return;
        legendTap(d);
        // a tap on the map (not on its legend or panels) folds the sheet back to the bar: the map gets the whole screen
        if (!d.__mFold) { d.__mFold = true; d.addEventListener("click", (e) => { if (!(e.target.closest && e.target.closest("#legend,#mapctl,#tllegend,.maplibregl-ctrl")) && window.rlSheet && document.body.classList.contains("m-sheet-peek") === false) window.rlSheet("peek"); }, true); }
        const a = d.querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show"); if (a) { a.classList.remove("maplibregl-compact-show"); a.removeAttribute("open"); }
      } catch (e) {}
    };
    if (f) { f.addEventListener("load", () => { for (const t of [0, 1500, 4000, 8000, 15000]) setTimeout(compact, t); }); compact(); }
  }
  // same toggle in porownanie.js (copy): tap the legend strip = full legend + layer panel, 3 s, or until a tap outside
  function legendTap(d) {
    if (d.__lgTap) return; d.__lgTap = true;
    let t = 0;
    const close = () => { clearTimeout(t); d.body.classList.remove("lg-tap-open"); };
    const arm = () => { clearTimeout(t); t = setTimeout(close, 3000); };
    d.addEventListener("click", (e) => {
      const b = d.body, inLegend = e.target.closest && e.target.closest("#legend"), inPanel = e.target.closest && e.target.closest("#legend,#mapctl,#tllegend");
      if (!b.classList.contains("lg-tap-open")) { if (inLegend) { b.classList.add("lg-tap-open"); arm(); } }
      else if (inPanel) arm(); else close();
    }, true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup); else setup();
  mq.addEventListener("change", setup);
})();
