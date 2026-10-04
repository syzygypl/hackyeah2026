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
// sens-funkcji #2: the commander of one incident hears only that incident (its report and calls); "Nowa akcja" elsewhere in
// Poland is the dispatcher's, in Centrum. ?bell=all keeps the whole country here (a dispatcher on /app, tests). sc follows the
// in-place switch (pushState), read on every tick
const ALL = new URLSearchParams(location.search).get("bell") === "all";
const curSc = () => new URLSearchParams(location.search).get("sc") || (window.rescueApp && window.rescueApp.scenario) || "";
function tick() {
  const on = lf.simEnabled();
  host.hidden = !on;
  const all = on ? lf.instancesAt(entries, lf.nowMs(), { pastMin: 120 }) : [], sc = curSc();
  bell.update(ALL || !sc ? all : all.filter((i) => i.sc === sc));
}
tick();
setInterval(tick, 5000);
setInterval(() => lf.acks.sync(), 15000); lf.acks.sync();
addEventListener("storage", (e) => { if (e.key === "rescue-sim247") tick(); });
addEventListener("popstate", () => setTimeout(tick, 0));   // Back / Forward between incidents   // the Centrum switch in another tab
window.rescueBell = { lf, bell, tick, get entries() { return entries; } };   // tests
