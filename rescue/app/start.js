// Start page: one honest status line from the action server (GET /api/incidents on the same origin). The page works without it.
(function () {
  "use strict";
  const el = document.getElementById("srv");
  if (!el) return;
  fetch("/api/incidents", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((list) => {
      const n = Array.isArray(list) ? list.length : 0;
      const live = Array.isArray(list) ? list.filter((x) => x.live && !x.found).length : 0;
      el.innerHTML = "<i></i>Serwer akcji działa · " + n + (n === 1 ? " scenariusz" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? " scenariusze" : " scenariuszy") + (live ? " · " + live + " na żywo" : "");
    })
    .catch(() => {
      el.classList.add("off");
      el.innerHTML = "<i></i>Serwer akcji nie odpowiada - aplikacja potrzebuje go do map";
    });
})();
