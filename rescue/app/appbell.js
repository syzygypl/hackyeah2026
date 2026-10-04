// Symulacja 24/7 in /app (AI Mateusza #1): the livefeed.js bell + toasts in the header, next to Centrum. Same schedule, ACK store
// and switch (rescue-sim247) as Centrum; operator only (the rescuer phone has its own screen). "Otwórz" switches the scenario in
// place (rescueApp.openAt: Historia at the incident's clock, pushState, no reload) and falls back to a page load without the shell.
const lf = await import("./livefeed.js");
const host = document.createElement("span"); host.id = "lfHost"; host.className = "lfhost";
const anchor = document.getElementById("centrumLink");
if (anchor) anchor.before(host); else document.querySelector("header")?.appendChild(host);
let entries = [];
try { entries = (await lf.loadSchedule()).entries; } catch (e) { console.warn("[appbell] schedule", e); }
const bell = lf.mountBell(host, {
  toastSince: lf.nowMs() - 60000,   // QA #3: on a fresh load the backlog (up to 3 toasts) covered the right panel; it stays in the bell list
  onOpen(i, clock, ev) {
    const app = window.rescueApp;
    if (!app || !app.openAt) return true;   // shell not up: openURL (page load)
    document.body.classList.remove("lfopen"); host.querySelector(".lfpanel").hidden = true; host.querySelector(".lfbell").setAttribute("aria-expanded", "false");
    const t = ev && ev.target.closest(".lftoast"); if (t) t.remove();
    app.openAt(i.sc, clock);
    return false;
  },
});
function tick() {
  const on = lf.simEnabled();
  host.hidden = !on;
  bell.update(on ? lf.instancesAt(entries, lf.nowMs(), { pastMin: 120 }) : []);
}
tick();
setInterval(tick, 5000);
setInterval(() => lf.acks.sync(), 15000); lf.acks.sync();
addEventListener("storage", (e) => { if (e.key === "rescue-sim247") tick(); });   // the Centrum switch in another tab
window.rescueBell = { lf, bell, tick, get entries() { return entries; } };   // tests
