// Ktoś zaginął - co robić (rodzina.html): the family fills what they know, the page builds a plain text report to read out on 112
// or send when the rescuers ask. Nothing is sent anywhere; the draft stays in this browser (localStorage) until "Wyczyść".
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id), f = $("f"), KEY = "rescue-rodzina-draft";
  const val = (n) => (f.elements[n] && f.elements[n].value || "").trim();
  const save = () => { try { const d = {}; for (const el of f.elements) if (el.name) d[el.name + (el.type === "checkbox" ? ":" + el.value : "")] = el.type === "checkbox" ? el.checked : el.value; localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} };
  const load = () => { try { const d = JSON.parse(localStorage.getItem(KEY) || "{}"); for (const el of f.elements) if (el.name) { const k = el.name + (el.type === "checkbox" ? ":" + el.value : ""); if (k in d) el.type === "checkbox" ? (el.checked = d[k]) : (el.value = d[k]); } } catch (e) {} };

  function text() {
    const L = [], add = (label, v) => { if (v) L.push(`${label}: ${v}`); };
    const who = [val("kto"), val("wiek") ? val("wiek") + " lat" : ""].filter(Boolean).join(", ");
    L.push("ZGŁOSZENIE ZAGINIĘCIA");
    add("Kto", who);
    add("Wygląd", val("wyglad"));
    add("Zdrowie, leki", val("zdrowie"));
    add("Doświadczenie", val("dosw"));
    add("Ostatnio widziany", [val("gdzie"), val("kiedy") ? "o " + val("kiedy") : ""].filter(Boolean).join(", "));
    add("Ostatni kontakt", val("kontakt") ? "o " + val("kontakt") : "");
    add("Planowana trasa", val("trasa").replace(/\s+/g, " "));
    add("Auto / rower", val("auto"));
    add("Ubiór", val("ubior"));
    const eq = [...f.querySelectorAll('input[name="sprzet"]:checked')].map((x) => x.value);
    add("Ma ze sobą", eq.join(", "));
    add("Telefon", [val("tel"), val("bat") ? "bateria " + val("bat") : ""].filter(Boolean).join(", "));
    add("Aplikacja Ratunek", val("ratunek"));
    add("Zgłasza", [val("zglasza"), val("ztel")].filter(Boolean).join(", tel. "));
    L.push(`Tekst przygotowany: ${new Date().toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" })}`);
    return L.length > 2 ? L.join("\n") : "";
  }

  f.addEventListener("input", save);
  f.addEventListener("submit", (e) => {
    e.preventDefault(); save();
    const t = text();
    $("out").hidden = false;
    $("txt").textContent = t || "Nic jeszcze nie wpisano. Najważniejsze: gdzie i kiedy ostatnio widziany, planowana trasa, ubiór, telefon.";
    $("share").hidden = !(t && navigator.share);
    $("copied").textContent = "";
    $("out").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion:reduce)").matches ? "auto" : "smooth", block: "start" });
  });
  $("copy").onclick = async () => {
    try { await navigator.clipboard.writeText($("txt").textContent); $("copied").textContent = "Skopiowano. Wklej w SMS lub wiadomość, gdy ratownicy o to poproszą."; }
    catch (e) { const r = document.createRange(); r.selectNodeContents($("txt")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); $("copied").textContent = "Tekst zaznaczony - skopiuj go z menu telefonu."; }
  };
  $("share").onclick = () => navigator.share({ title: "Zgłoszenie zaginięcia", text: $("txt").textContent }).catch(() => {});
  $("clear").onclick = () => { if (!confirm("Wyczyścić wszystkie pola?")) return; f.reset(); try { localStorage.removeItem(KEY); } catch (e) {} $("out").hidden = true; };
  load();
})();
