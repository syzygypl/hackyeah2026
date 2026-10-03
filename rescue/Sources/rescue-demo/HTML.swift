import Foundation
import RescueKit

func r3(_ x: Double) -> Double { Double(String(format: "%.3g", x)) ?? 0 }
func ll(_ c: Coord) -> [Double] { [c.lat, c.lon] }

func hintJSON(_ h: LocationHint, _ f: [Double]) -> [String: Any] {
    let mx = f.max() ?? 1
    var d: [String: Any] = [
        "id": h.id, "source": h.source, "clock": h.clock, "minute": h.minute,
        "title": h.title, "detail": h.detail, "kind": h.kind,
        "layer": f.map { r3($0 / mx) },
    ]
    var g: [String: Any] = [:]
    switch h.evidence {
    case let .rings(c, q): g = ["center": ll(c), "q": q]
    case let .route(p, s): g = ["points": p.map(ll), "sigma": s]
    case let .sector(c, r): g = ["center": ll(c), "radius": r]
    case let .point(c, a): g = ["center": ll(c), "radius": a]
    case let .searched(ids, pod): g = ["segments": ids, "pod": pod]
    case let .containment(p, r, f): g = ["points": p.map(ll), "radius": r, "factor": f]
    case let .weather(b): g = ["boost": b]
    case .terrainFeatures, .terrainCost: break
    }
    if let m = h.marker { g["marker"] = ll(m) }
    d["geo"] = g
    return d
}

func renderHTML(scenario s: Scenario, grid: ProbabilityGrid, hints: [LocationHint], summary: [String: Any]) -> String {
    let data: [String: Any] = [
        "incident": s.incident, "date": s.date,
        "subject": ["name": s.subject.name, "age": s.subject.age, "category": s.subject.category, "note": s.subject.note],
        "bbox": [s.bbox.south, s.bbox.west, s.bbox.north, s.bbox.east],
        "rows": grid.rows, "cols": grid.cols, "cellM": s.cellM,
        "ipp": ["name": s.ipp.name, "at": s.ipp.at],
        "segments": s.segments.map { ["id": $0.id, "name": $0.name] },
        "segOf": grid.segmentOf,
        "trails": s.terrain.trails.map { ["name": $0.name, "points": $0.points] },
        "streams": s.terrain.streams.map { ["name": $0.name, "points": $0.points] },
        "huts": s.terrain.huts.map { ["name": $0.name, "at": $0.at] },
        "hints": zip(hints, grid.layers).map { hintJSON($0, $1.factor) },
        "summary": summary,
    ]
    let json = String(data: try! JSONSerialization.data(withJSONObject: data), encoding: .utf8)!
    return template.replacingOccurrences(of: "__DATA__", with: json)
}

let template = #"""
<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rescue Locator</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<style>
:root{--bg:#0f1418;--panel:#161d23;--line:#2a343d;--ink:#e8edf1;--mute:#93a1ad;--hot:#ff5a36;--ok:#3ec28f;--warn:#f2b134}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);font:14px/1.4 -apple-system,system-ui,Segoe UI,Roboto,sans-serif}
#app{display:grid;grid-template-columns:320px 1fr 340px;grid-template-rows:auto 1fr auto;height:100vh}
header{grid-column:1/4;padding:10px 16px;border-bottom:1px solid var(--line);display:flex;gap:16px;align-items:baseline;flex-wrap:wrap}
header h1{font-size:18px;margin:0}
header .sub{color:var(--mute)}
#left,#right{overflow:auto;padding:12px;background:var(--panel)}
#left{border-right:1px solid var(--line)}#right{border-left:1px solid var(--line)}
#map{min-height:300px}
h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--mute);margin:8px 0}
.card{border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-bottom:8px;opacity:.35;transition:opacity .3s,border-color .3s}
.card.on{opacity:1}.card.new{border-color:var(--warn)}
.card label{display:flex;gap:8px;align-items:flex-start;cursor:pointer}
.card .t{font-weight:600}.card .d{color:var(--mute);font-size:12px;margin-top:2px}
.card .src{font-size:11px;color:var(--mute);font-family:ui-monospace,Menlo,monospace}
.seg{border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:8px}
.seg .rank{display:inline-block;width:22px;height:22px;border-radius:50%;background:var(--hot);color:#fff;text-align:center;font-weight:700;margin-right:6px}
.seg .big{font-size:22px;font-weight:700}
.seg .task{color:var(--mute);font-size:12px;margin-top:4px}
.bar{height:6px;background:var(--line);border-radius:3px;margin-top:6px;overflow:hidden}.bar i{display:block;height:100%;background:var(--hot)}
.value{border:1px solid var(--ok);border-radius:8px;padding:10px;margin:8px 0}
.value .big{font-size:26px;font-weight:800;color:var(--ok)}
footer{grid-column:1/4;padding:10px 16px;border-top:1px solid var(--line);display:flex;gap:12px;align-items:center}
footer input[type=range]{flex:1}
button{background:var(--hot);color:#fff;border:0;border-radius:6px;padding:8px 14px;font-weight:600;cursor:pointer}
#clock{font-family:ui-monospace,Menlo,monospace;font-size:16px;min-width:56px}
#banner{position:fixed;bottom:64px;left:50%;transform:translateX(-50%);z-index:999;background:var(--warn);color:#000;padding:8px 14px;border-radius:8px;font-weight:700;display:none}
.lbl{background:rgba(15,20,24,.85);color:#fff;border:1px solid #fff;border-radius:4px;padding:1px 5px;font-size:11px;white-space:nowrap;font-weight:600}
.lbl.top{background:var(--hot);border-color:var(--hot)}
.lbl.empty{background:#334;color:#cde;border-color:#667}
small{color:var(--mute)}
@media (max-width:900px){#app{grid-template-columns:1fr;grid-template-rows:auto 50vh auto auto auto;height:auto}header,footer{grid-column:1}#map{height:50vh}}
</style>
</head>
<body>
<div id="app">
<header><h1>Rescue Locator</h1><span class="sub" id="inc"></span></header>
<div id="left"><h2>Strumień wskazówek (moduły)</h2><div id="cards"></div>
<small>Odznacz kartę, żeby zobaczyć, co wnosi dana warstwa. Wszystkie dane fikcyjne.</small></div>
<div id="map"></div>
<div id="right"><h2>Gdzie szukać najpierw</h2>
<div class="value"><div class="big" id="vbig"></div><div id="vsub"></div></div>
<div id="segs"></div>
<h2>Backtest (fikcyjne miejsce odnalezienia)</h2><div id="bt"></div>
<h2>Osoba</h2><div id="subj"></div></div>
<footer><button id="play">Odtwórz</button><span id="clock"></span><input type="range" id="slider" min="1" step="1"><span id="stepinfo"></span></footer>
</div>
<div id="banner"></div>
<script>
const D = __DATA__;
const N = D.rows*D.cols, H = D.hints;
const [S,W,Nn,E] = D.bbox;
const disabled = new Set();
let step = H.length;

document.getElementById('inc').textContent = D.incident + ' - ' + D.date;
document.getElementById('subj').innerHTML = `<b>${D.subject.name}</b>, ${D.subject.age} l., kategoria: ${D.subject.category}<br><small>${D.subject.note}</small>`;

const map = L.map('map',{zoomControl:true,zoomSnap:0.25}).fitBounds([[S,W],[Nn,E]]);
setTimeout(()=>{map.invalidateSize();map.fitBounds([[S+0.008,W+0.005],[Nn-0.012,E-0.02]]);},50);
const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'&copy; OpenStreetMap'});
const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{maxZoom:17,attribution:'&copy; OpenStreetMap, SRTM | OpenTopoMap (CC-BY-SA)'});
topo.addTo(map);
L.control.layers({'OpenTopoMap':topo,'OpenStreetMap':osm}).addTo(map);

// heatmap as a small canvas stretched over the bbox
const cv = document.createElement('canvas'); cv.width=D.cols; cv.height=D.rows;
const ctx = cv.getContext('2d');
const heat = L.imageOverlay(cv.toDataURL(), [[S,W],[Nn,E]], {opacity:0.75}).addTo(map);

// terrain lines
const terr = L.layerGroup().addTo(map);
D.trails.forEach(t=>L.polyline(t.points,{color:'#c0392b',weight:2,dashArray:'4 4',opacity:.8}).bindTooltip(t.name).addTo(terr));
D.streams.forEach(t=>L.polyline(t.points,{color:'#2e86de',weight:2,opacity:.8}).bindTooltip(t.name).addTo(terr));
D.huts.forEach(h=>L.circleMarker(h.at,{radius:4,color:'#fff',fillColor:'#555',fillOpacity:1,weight:1}).bindTooltip(h.name).addTo(terr));
L.marker(D.ipp.at,{icon:L.divIcon({className:'',html:'<div class="lbl">IPP</div>'})}).bindTooltip(D.ipp.name).addTo(map);

// segment boundaries from the cell -> segment map
const latOf = r => Nn - r*(Nn-S)/D.rows, lonOf = c => W + c*(E-W)/D.cols;
const segLines = [];
for (let r=0;r<D.rows;r++) for (let c=0;c<D.cols;c++){
  const s = D.segOf[r*D.cols+c];
  if (c+1<D.cols && D.segOf[r*D.cols+c+1]!==s) segLines.push([[latOf(r),lonOf(c+1)],[latOf(r+1),lonOf(c+1)]]);
  if (r+1<D.rows && D.segOf[(r+1)*D.cols+c]!==s) segLines.push([[latOf(r+1),lonOf(c)],[latOf(r+1),lonOf(c+1)]]);
}
L.polyline(segLines,{color:'#fff',weight:1,opacity:.45}).addTo(map);
const segCenter = D.segments.map(()=>[0,0,0]);
for (let i=0;i<N;i++){const r=Math.floor(i/D.cols),c=i%D.cols,s=D.segOf[i];segCenter[s][0]+=latOf(r+.5);segCenter[s][1]+=lonOf(c+.5);segCenter[s][2]++;}
const segLabels = L.layerGroup().addTo(map);

// evidence overlays
const ev = L.layerGroup().addTo(map);
function drawEvidence(h){
  const g=h.geo;
  if (h.kind==='rings') g.q.forEach((q,i)=>L.circle(g.center,{radius:q*1000,color:'#fff',weight:1,dashArray:'6 6',fill:false,opacity:.6}).bindTooltip(`Koester ${[25,50,75,95][i]}%: ${q} km`).addTo(ev));
  if (h.kind==='route') L.polyline(g.points,{color:'#f2b134',weight:4,opacity:.9}).bindTooltip(h.title).addTo(ev);
  if (h.kind==='sector') L.circle(g.center,{radius:g.radius,color:'#9b59b6',weight:2,fillOpacity:.05}).bindTooltip(h.title).addTo(ev);
  if (h.kind==='point'){L.circle(g.center,{radius:Math.max(g.radius,40),color:'#3ec28f',weight:3,fillOpacity:.3}).addTo(ev);
    L.marker(g.center,{icon:L.divIcon({className:'',html:'<div class="lbl" style="background:#3ec28f;border-color:#3ec28f">Ratunek</div>'})}).addTo(ev);}
  if (h.kind==='containment'){L.polyline(g.points,{color:'#888',weight:10,opacity:.35}).bindTooltip(h.title).addTo(ev);}
  if (g.marker) L.marker(g.marker,{icon:L.divIcon({className:'',html:'<div class="lbl">Auto</div>'})}).bindTooltip(h.title).addTo(ev);
}

// cards
const cards = document.getElementById('cards');
H.forEach((h,i)=>{
  const el=document.createElement('div'); el.className='card'; el.id='card'+i;
  el.innerHTML=`<label><input type="checkbox" checked data-id="${h.id}"><div><div class="src">${h.clock} · ${h.source}</div><div class="t">${h.title}</div><div class="d">${h.detail}</div></div></label>`;
  el.querySelector('input').onchange=e=>{e.target.checked?disabled.delete(h.id):disabled.add(h.id);render();};
  cards.appendChild(el);
});

const TASK = {rings:'',route:'patrol wzdłuż szlaku',};
function taskFor(segIdx){
  const name=D.segments[segIdx].name.toLowerCase();
  if (name.includes('szlak')||name.includes('droga')) return 'Zespół szybki: przejście szlakiem, nawoływanie, światło';
  if (name.includes('żleb')||name.includes('potok')||name.includes('roztok')) return 'Zespół + pies: zejście wzdłuż żlebu/cieku, sprawdzić progi';
  if (name.includes('staw')) return 'Dron termowizyjny + obejście brzegu';
  if (name.includes('grań')||name.includes('perć')) return 'Śmigłowiec / zespół wspinaczkowy: ściany pod granią';
  return 'Zespół przeszukania liniowego';
}

function compute(){
  const p=new Float64Array(N).fill(1);
  for (let k=0;k<step;k++){const h=H[k]; if(disabled.has(h.id)) continue; const f=h.layer; for(let i=0;i<N;i++) p[i]*=f[i];}
  let s=0; for(let i=0;i<N;i++) s+=p[i]; for(let i=0;i<N;i++) p[i]/=s;
  return p;
}
function ramp(t){ // transparent -> yellow -> orange -> red
  const a=Math.min(1,t*1.6);
  const r=255, g=Math.round(230*(1-Math.min(1,t*1.2))+40), b=Math.round(60*(1-t));
  return [r,g,b,Math.round(a*230)];
}
function render(){
  const p=compute();
  let mx=0; for(let i=0;i<N;i++) mx=Math.max(mx,p[i]);
  const img=ctx.createImageData(D.cols,D.rows);
  for(let i=0;i<N;i++){const [r,g,b,a]=ramp(Math.sqrt(p[i]/mx)); img.data.set([r,g,b,a],i*4);}
  ctx.putImageData(img,0,0); heat.setUrl(cv.toDataURL());
  // segments
  const sp=D.segments.map(()=>0), sa=D.segments.map(()=>0);
  for(let i=0;i<N;i++){sp[D.segOf[i]]+=p[i]; sa[D.segOf[i]]++;}
  const order=D.segments.map((_,i)=>i).sort((a,b)=>sp[b]-sp[a]);
  const top=order.slice(0,3);
  const tp=top.reduce((s,i)=>s+sp[i],0), ta=top.reduce((s,i)=>s+sa[i],0)/N;
  document.getElementById('vbig').textContent=`${Math.round(tp*100)}% prawdopodobieństwa w ${Math.round(ta*100)}% obszaru`;
  document.getElementById('vsub').innerHTML=`<small>Top 3 segmenty z ${D.segments.length}, obszar 6 x 6 km</small>`;
  document.getElementById('segs').innerHTML=top.map((i,k)=>`<div class="seg"><span class="rank">${k+1}</span><b>${D.segments[i].id} ${D.segments[i].name}</b>
    <div class="big">${(sp[i]*100).toFixed(0)}% <small>w ${(sa[i]/N*100).toFixed(1)}% obszaru</small></div>
    <div class="bar"><i style="width:${Math.min(100,sp[i]*100)}%"></i></div><div class="task">${taskFor(i)}</div></div>`).join('');
  // searched segments
  const searched={}; for(let k=0;k<step;k++){const h=H[k]; if(h.kind==='searched'&&!disabled.has(h.id)) h.geo.segments.forEach(id=>searched[id]=h.geo.pod);}
  segLabels.clearLayers();
  D.segments.forEach((s,i)=>{const c=segCenter[i]; if(!c[2])return; const rk=top.indexOf(i);
    if(rk<0 && searched[s.id]===undefined) return;
    const cls=rk>=0?'lbl top':(searched[s.id]!==undefined?'lbl empty':'lbl');
    const txt=rk>=0?`#${rk+1} ${s.id} ${(sp[i]*100).toFixed(0)}%`:(searched[s.id]!==undefined?`${s.id} pusty, POD ${Math.round(searched[s.id]*100)}%`:`${s.id} ${(sp[i]*100).toFixed(0)}%`);
    L.marker([c[0]/c[2],c[1]/c[2]],{icon:L.divIcon({className:'',html:`<div class="${cls}">${txt}</div>`})}).bindTooltip(s.name).addTo(segLabels);});
  ev.clearLayers(); for(let k=0;k<step;k++) if(!disabled.has(H[k].id)) drawEvidence(H[k]);
  H.forEach((h,i)=>{const el=document.getElementById('card'+i); el.classList.toggle('on',i<step); el.classList.toggle('new',i===step-1);});
  document.getElementById('clock').textContent=H[step-1].clock;
  document.getElementById('stepinfo').textContent=`${step}/${H.length}: ${H[step-1].title}`;
  const b=document.getElementById('banner');
  if(H[step-1].kind==='point'){b.textContent='Ratunek: pozycja GPS w segmencie, który mapa wskazała przed pingiem';b.style.display='block';}
  else if(H[step-1].kind==='searched'){b.textContent='Segment przeszukany, nic nie znaleziono: prawdopodobieństwo przepływa dalej';b.style.display='block';}
  else b.style.display='none';
}

// backtest
const sm=D.summary;
document.getElementById('bt').innerHTML=`Przed pingiem Ratunek (${H[sm.beforePing].clock}): segment z miejscem odnalezienia (${sm.truthSeg}) na pozycji <b>#${sm.rankFused}</b> po fuzji vs <b>#${sm.rankRings}</b> w samych pierścieniach Koestera.<br>Obszar do przeszukania do trafienia: <b>${(sm.areaFused*100).toFixed(1)}%</b> vs ${(sm.areaRings*100).toFixed(1)}%.`;

const slider=document.getElementById('slider'); slider.max=H.length; slider.value=step;
slider.oninput=()=>{step=+slider.value; render();};
let timer=null;
document.getElementById('play').onclick=()=>{
  if(timer){clearInterval(timer);timer=null;return;}
  step=1; slider.value=1; render();
  timer=setInterval(()=>{ if(step>=H.length){clearInterval(timer);timer=null;return;} step++; slider.value=step; render(); },1800);
};
render();
</script>
</body>
</html>
"""#
