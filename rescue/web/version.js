/* Version stamp, bottom-right corner, the same in 2D (web/), 3D (web/3d/) and the app shell (app/).
   Reads rescue/version.json ({commit, date, subject}, written by tools/version-json.sh after a pull);
   without it falls back to the Last-Modified time of this file. Not shown inside an iframe with ?embed=,
   so the shell shows one stamp, not one per view. Adds body.has-version so a page can keep its bottom bar clear. Classic script: <script src=".../web/version.js" defer></script>. */
(function () {
  'use strict';
  if (new URLSearchParams(location.search).has('embed')) return;
  const me = document.currentScript && document.currentScript.src;
  if (!me) return;
  const fmt = (d) => d.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '');
  function show(text, title) {
    const el = document.createElement('div');
    el.id = 'rl-version';
    el.textContent = text;
    if (title) el.title = title;
    el.style.cssText = 'position:fixed;right:6px;bottom:2px;z-index:60;pointer-events:none;font:10.5px/1.3 ui-monospace,Menlo,Consolas,monospace;' +
      'color:var(--rl-mute,var(--mute,#8797a4));opacity:.85;text-shadow:0 0 3px rgba(0,0,0,.35);white-space:nowrap';
    document.body.appendChild(el);
    document.body.classList.add('has-version'); // pages reserve a 14px strip at the bottom: body.has-version <bottom bar> { padding-bottom: 14px }
  }
  fetch(new URL('../version.json', me), { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no version.json'))))
    .then((v) => show(`v ${v.commit} · ${fmt(new Date(v.date))}`, v.subject || ''))
    .catch(() => fetch(me, { method: 'HEAD', cache: 'no-store' })
      .then((r) => { const lm = r.headers.get('Last-Modified'); if (lm) show(`wersja z ${fmt(new Date(lm))}`); })
      .catch(() => {}));
})();
