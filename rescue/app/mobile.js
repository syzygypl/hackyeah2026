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
    const sh = document.createElement("button"); sh.id = "mSheetBtn"; sh.type = "button";
    const shLabel = () => { const on = document.body.classList.contains("m-sheet-open"); sh.innerHTML = `<span>${on ? "Pokaż mapę" : "Więcej zdarzeń"}</span>`; sh.setAttribute("aria-expanded", String(on)); };
    sh.onclick = () => { document.body.classList.toggle("m-sheet-open"); shLabel(); if (!document.body.classList.contains("m-sheet-open")) right.scrollTop = 0; };
    shLabel();
    right.prepend(sh);
    // a phone opens on Akcja (2D): Plan is drag and drop, Teren / Monitoring / Walidacja are wide desktop panels
    const fix = () => {
      if (!phone()) return;
      const b = document.body;
      if (!b.classList.contains("mode-akcja")) { const a = document.querySelector('#modes [data-mode="akcja"]'); if (a) a.click(); }
      if (b.classList.contains("view-split")) { const v = document.querySelector('#views [data-view="2d"]'); if (v) v.click(); }
    };
    new MutationObserver(fix).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    fix();
    // the 2D frame: compact legend, as in porównanie (web/ reads the same class from ?legend=compact)
    const f = $("frame2d");
    // plus: the base / layer panel and the timeline key go (they covered half of a phone map), the attribution starts collapsed
    const compact = () => {
      try {
        const d = f.contentDocument; if (!phone() || !d || !d.body) return;
        d.body.classList.add("legend-compact");
        if (!d.getElementById("mPhoneCss")) { const s = d.createElement("style"); s.id = "mPhoneCss"; s.textContent = "#mapctl,#tllegend{display:none!important}"; d.head.appendChild(s); }
        const a = d.querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show"); if (a) { a.classList.remove("maplibregl-compact-show"); a.removeAttribute("open"); }
      } catch (e) {}
    };
    if (f) { f.addEventListener("load", () => { for (const t of [0, 1500, 4000, 8000, 15000]) setTimeout(compact, t); }); compact(); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup); else setup();
  mq.addEventListener("change", setup);
})();
