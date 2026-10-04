// Draft demo video recorder (docs/submission/hackathon/rescue-locator/video, see shotlist.md): Playwright + CDP Page.startScreencast -> JPEG frames with a virtual clock (loads are cut),
// captions burned in as a DOM overlay + an .srt. node rec.js <outDir>
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2] || 'out';
const BASE = 'https://rescue-locator.vercel.app';
const W = 1440, H = 900;
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT + '/f', { recursive: true });

let n = 0, rec = false, vt = 0, lastReal = 0;   // vt = virtual seconds of recorded video
const lines = [], subs = [], shots = [];
const now = () => Date.now() / 1000;
const vnow = () => (rec ? vt + (now() - lastReal) : vt);
function frame(buf) { if (!rec) return; const f = `f/${String(++n).padStart(6, '0')}.jpg`; fs.writeFileSync(`${OUT}/${f}`, buf); lines.push(`${f} ${vnow().toFixed(3)}`); }
let cdp, page;
async function startRec() { if (rec) return; lastReal = now(); rec = true; frame(await page.screenshot({ type: 'jpeg', quality: 85 })); }
function stopRec() { if (!rec) return; vt = vnow(); rec = false; }
const wait = (ms) => page.waitForTimeout(ms);
let capOpen = null;
function capEnd() { if (capOpen) { capOpen.end = vnow(); subs.push(capOpen); capOpen = null; } }
async function cap(text, top) {
  capEnd();
  if (text) capOpen = { start: vnow(), text };
  await page.evaluate(([t, top]) => {
    let el = document.getElementById('__cap');
    if (!el) { el = document.createElement('div'); el.id = '__cap'; document.documentElement.appendChild(el);
      el.style.cssText = 'position:fixed;left:50%;bottom:104px;transform:translateX(-50%);z-index:2147483647;max-width:1100px;padding:12px 22px;border-radius:12px;background:rgba(20,24,28,.86);color:#fff;font:600 25px/1.3 Barlow,system-ui,sans-serif;text-align:center;pointer-events:none;box-shadow:0 6px 24px rgba(0,0,0,.3)'; }
    el.textContent = t || ''; el.style.display = t ? 'block' : 'none';
    el.style.top = top ? '84px' : 'auto'; el.style.bottom = top ? 'auto' : '104px';
  }, [text || '', !!top]).catch(() => {});
}
async function scene(name, url, loadWait, fn) {
  capEnd(); stopRec();
  shots.push({ name, url, at: vt });
  console.log(`[${vt.toFixed(1)}s] ${name}`);
  await page.goto(url, { waitUntil: 'commit', timeout: 60000 }).catch((e) => console.log('goto', e.message));
  await wait(loadWait);
  await fn();
}
// DOM click (the 3D render loop starves Playwright's actionability checks); text = optional exact button label
const click = async (sel, text) => { const ok = await page.evaluate(([sel, text]) => { const el = [...document.querySelectorAll(sel)].find((e) => !text || e.textContent.trim() === text); if (!el) return false; el.scrollIntoView({ block: 'nearest' }); el.click(); return true; }, [sel, text || '']).catch(() => false); if (!ok) console.log('  click miss', sel, text || ''); return ok; };
const smoothScroll = (y, ms = 1200) => page.evaluate(async ([y, ms]) => { const y0 = scrollY, t0 = performance.now(); await new Promise((r) => { const f = (t) => { const k = Math.min(1, (t - t0) / ms), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; scrollTo(0, y0 + (y - y0) * e); k < 1 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); }); }, [y, ms]);
const card = (title, sub, small) => 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html><body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#ece8df;font-family:Barlow,system-ui,sans-serif;color:#23272a;text-align:center">
<svg width="120" height="84" viewBox="0 0 40 28"><path d="M1 26 13 8l6 8 5-6 15 16z" fill="#23272a"/><circle cx="31" cy="7" r="3" fill="#b8322a"/></svg>
<h1 style="font-size:64px;margin:18px 0 8px">${title}</h1><p style="font-size:30px;margin:0;color:#4a5054">${sub}</p><p style="font-size:22px;margin:26px 0 0;color:#5d6165">${small || ''}</p></body></html>`);
const phoneStage = (url) => 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;gap:60px;background:#ece8df;font-family:Barlow,system-ui,sans-serif">
<div style="width:390px;height:780px;border-radius:44px;border:14px solid #23272a;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.25);background:#fff"><iframe src="${url}" style="width:390px;height:780px;border:0" allow="geolocation"></iframe></div>
<div style="max-width:440px;color:#23272a"><h2 style="font-size:40px;margin:0 0 12px">Telefon ratownika</h2><p style="font-size:24px;line-height:1.4;color:#4a5054;margin:0">Jeden ekran: mój sektor na mapie, kierunek i odległość, meldunek jednym przyciskiem albo zwykłym zdaniem.</p></div></body></html>`);

(async () => {
  const b = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, locale: 'pl-PL', timezoneId: 'Europe/Warsaw' });
  page = await ctx.newPage();
  cdp = await ctx.newCDPSession(page);
  cdp.on('Page.screencastFrame', async (e) => { frame(Buffer.from(e.data, 'base64')); cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}); });
  const startCast = () => cdp.send('Page.startScreencast', { format: 'jpeg', quality: 82, maxWidth: W, maxHeight: H, everyNthFrame: 1 }).catch(() => {});
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) startCast(); });
  await startCast();

  // 0 title
  await scene('Tytuł', card('Rescue Locator', 'Gdzie szukać najpierw', 'HackYeah 2026 · wszystkie osoby i akcje w pokazie są fikcyjne'), 800, async () => {
    await startRec(); await wait(4500);
  });

  // 1 family
  await scene('Rodzina: Ktoś zaginął', BASE + '/app/rodzina.html', 2500, async () => {
    await startRec(); await cap('Rodzina: ktoś bliski nie wrócił z gór. Najpierw 112.'); await wait(4000);
    await cap('Potem lista: co powiedzieć dyżurnemu. Nic nie jest wysyłane.');
    await page.evaluate(() => document.getElementById('zgloszenie').scrollIntoView({ behavior: 'smooth' })); await wait(1500);
    const type = async (sel, t) => { await page.locator(sel).click(); await page.keyboard.type(t, { delay: 18 }); };
    await type('[name=kto]', 'Tomasz W.'); await type('[name=wiek]', '58');
    await page.evaluate(() => document.querySelector('[name=gdzie]').scrollIntoView({ behavior: 'smooth', block: 'center' })); await wait(700);
    await type('[name=gdzie]', 'schronisko w Dolinie Pięciu Stawów');
    await page.fill('[name=kiedy]', '12:10'); await page.fill('[name=kontakt]', '14:12');
    await type('[name=trasa]', 'na Zawrat i z powrotem, miał wrócić do 17:00');
    await page.evaluate(() => document.querySelector('[name=ubior]').scrollIntoView({ behavior: 'smooth', block: 'center' })); await wait(700);
    await type('[name=ubior]', 'czerwona kurtka, szary plecak');
    await page.check('input[value="czołówka"]');
    await cap('„Gotowy tekst” - do przeczytania przez telefon albo wysłania, gdy ratownicy poproszą.');
    await click('button[type=submit]'); await wait(4500);
  });

  // 2 commander
  const op = BASE + '/app/?sc=zawrat&role=operator&mode=akcja&time=hist&step=15&view=2d';
  await scene('Kierownik akcji: Akcja, top 3', op, 22000, async () => {
    await click('#firstRunOk');
    // warm the 3D view off camera (terrain + DEM load), so the on-camera 2D <-> 3D switch is the real crossfade
    await click('#views button', '3D'); await wait(30000); await click('#views button', '2D'); await wait(4000);
    await startRec(); await cap('Kierownik akcji. Zawrat, 19:45: mgła, zmrok, sektory przeszukane bez wyniku.'); await wait(4500);
    await cap('Gdzie szukać najpierw: trzy sektory to 7% obszaru. Każdy zespół ma sektor i czas dojścia.'); await wait(5000);
    await cap('Ta sama akcja na prawdziwym terenie w 3D.');
    await click('#views button', '3D'); await wait(7000);
    await click('#views button', '2D'); await wait(3500);
    await cap('Klik w zdarzenie na osi czasu: mapa pokazuje, co ono zmieniło.');
    await page.evaluate(() => { const t = [...document.querySelectorAll('.tk[data-step]')].find((e) => /Dron/.test(e.textContent)) || document.querySelector('.tk[data-step]'); if (t) t.click(); });
    await wait(5000);
    await cap('Nowa relacja? Wpisz ją zwykłym zdaniem w Czacie.');
    await click('#chBtn'); await wait(1500);
    await page.evaluate(() => document.querySelector('#chDrawer textarea').focus()); await page.keyboard.type('Turystka widziała go o 14:35 na zakosach niebieskiego szlaku pod Zawratem, szedł w górę', { delay: 22 });
    await click('#chDrawer .ch-send'); await wait(2500);
    await cap('Czat pokazuje, co zrozumiał. Dodaj - i mapa się przelicza (symulacja tylko na tym ekranie).');
    await click('#chDrawer .ch-add'); await wait(6500);
    await click('#chDrawer .ch-x'); await wait(4000);
  });

  // 3 porownanie
  await scene('Co zmienia jedna relacja', BASE + '/app/porownanie.html', 9000, async () => {
    await startRec(); await cap('Ta sama akcja policzona dwa razy: bez relacji turystki i z nią.'); await wait(5000);
    await cap('Inna kolejność sektorów, inne zespoły w drodze.'); await smoothScroll(520); await wait(4500);
    await cap('Epilog (fikcyjny): żleb pod Zawratem. Bez relacji pies, dojście 95 min. Z relacją dron, 12 min.');
    await page.evaluate(() => document.getElementById('why').scrollIntoView({ behavior: 'smooth', block: 'center' })); await wait(7000);
  });

  // 4 odprawa
  await scene('Odprawa (druk)', BASE + '/app/odprawa.html?sc=zawrat&t=19:45', 5000, async () => {
    await startRec(); await cap('Odprawa na jednej kartce A4: kogo szukamy, gdzie najpierw, kto dokąd idzie, pogoda i zmrok.'); await wait(4500);
    await smoothScroll(700, 2500); await wait(2500);
  });
  await scene('Karty zadań', BASE + '/app/odprawa.html?sc=zawrat&t=19:45&karty=1', 5000, async () => {
    await startRec(); await cap('Karty zadań: każdy zespół dostaje swoją połówkę kartki z sektorem i uwagami bezpieczeństwa.'); await wait(5500);
  });

  // 5 rescuer phone
  await scene('Telefon ratownika', phoneStage(BASE + '/app/?role=ratownik&sc=zawrat'), 16000, async () => {
    await startRec(); await cap('Ratownik w terenie widzi swój sektor i melduje jednym przyciskiem.', true); await wait(7000);
  });

  // 6 centrum
  await scene('Centrum', BASE + '/app/centrum.html', 14000, async () => {
    await startRec(); await cap('Centrum: wszystkie akcje w Polsce na jednej mapie i wspólna pula zespołów.', true); await wait(5500);
    await cap('Doradca łączy zgłoszenia z kilku akcji w jedną przyczynę - tu fala po awarii zapory na Sanie.', true); await wait(5000);
  });

  // 7 end
  await scene('Koniec', card('Rescue Locator', 'Gdzie szukać najpierw - dla ratowników i dla rodzin', 'rescue-locator.vercel.app · github.com/syzygypl/hackyeah2026<br>Prototyp. Wszystkie scenariusze i osoby są fikcyjne. Decyzję zawsze podejmuje kierownik akcji.'), 800, async () => {
    await startRec(); await wait(6000);
  });
  capEnd(); stopRec();
  lines.push(lines[lines.length - 1].split(' ')[0] + ' ' + (vt - 0.5).toFixed(3));   // hold the static end card (no screencast frames while nothing changes)
  await cdp.send('Page.stopScreencast').catch(() => {});
  fs.writeFileSync(`${OUT}/frames.txt`, lines.join('\n') + '\n');
  const ts = (s) => { const ms = Math.round(s * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
  fs.writeFileSync(`${OUT}/draft.srt`, subs.map((s, i) => `${i + 1}\n${ts(s.start)} --> ${ts(s.end)}\n${s.text}\n`).join('\n'));
  fs.writeFileSync(`${OUT}/scenes.json`, JSON.stringify({ shots, subs, total: vt }, null, 1));
  console.log('frames', n, 'video s', vt.toFixed(1));
  await b.close();
})();
