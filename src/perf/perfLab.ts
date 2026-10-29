import type maplibregl from "maplibre-gl";
import { perfProfiler, type PerfSummary } from "./profiler";
import { runBenchmarkSuite } from "./benchmark";
import { runCameraStressSuite } from "./cameraStress";
import { runTerrainFocus } from "./terrainFocus";

const fmt = (n:number) => Number.isFinite(n) ? n.toFixed(1) : "-";

export function attachPerfLab(map: maplibregl.Map): void {
  if (!import.meta.env.DEV) return;
  const el = document.createElement("aside");
  el.id = "perf-lab";
  Object.assign(el.style, { position:"fixed", right:"10px", bottom:"10px", zIndex:"10000", width:"300px", maxHeight:"70vh", overflow:"auto", padding:"10px", background:"rgba(20,20,20,.88)", color:"#eee", font:"12px/1.35 monospace", borderRadius:"6px", boxShadow:"0 2px 12px #0008" });
  el.innerHTML = '<b>Rebirth Performance Lab</b><div data-live>idle</div><button data-start>Start 15s</button> <button data-suite>Auto benchmark</button> <button data-stress>Camera stress</button> <button data-terrain>Terrain focus</button> <button data-stop>Stop</button> <button data-copy>Copy JSON</button><pre data-out></pre>';
  document.body.appendChild(el);
  const live=el.querySelector("[data-live]") as HTMLElement, out=el.querySelector("[data-out]") as HTMLElement;
  let timer=0, last:PerfSummary|null=null;
  const render=(s:PerfSummary) => {
    const c=map.getCenter();
    live.textContent = `z ${map.getZoom().toFixed(2)} | ${c.lat.toFixed(3)}, ${c.lng.toFixed(3)} | FPS ${fmt(s.fps)} | p95 ${fmt(s.frameMs.p95)} ms`;
  };
  const interval=window.setInterval(()=>render(perfProfiler.summary()),500);
  const stop=()=>{
    if(timer) clearTimeout(timer);
    timer=0;
    last=perfProfiler.stopCapture();
    const c=map.getCenter();
    const report={ capturedAt:new Date().toISOString(), userAgent:navigator.userAgent, location:{lat:c.lat,lng:c.lng,zoom:map.getZoom(),pitch:map.getPitch()}, metrics:last, measures:performance.getEntriesByType("measure").map(e=>({name:e.name,durationMs:Math.round(e.duration*100)/100})) };
    out.textContent=JSON.stringify(report,null,2);
    return report;
  };
  (el.querySelector("[data-start]") as HTMLButtonElement).onclick=()=>{ performance.clearMeasures(); perfProfiler.reset(); perfProfiler.startCapture(); out.textContent="capturing 15 seconds…"; timer=window.setTimeout(stop,15000); };
  (el.querySelector("[data-stop]") as HTMLButtonElement).onclick=()=>{ stop(); };
  (el.querySelector("[data-suite]") as HTMLButtonElement).onclick=async()=>{
    const btn=el.querySelector("[data-suite]") as HTMLButtonElement;
    btn.disabled=true;
    out.textContent="Starting automatic benchmark…";
    try {
      const report=await runBenchmarkSuite(map,(message,index,total)=>{
        live.textContent=`${message} [${Math.min(index+1,total)}/${total}]`;
      });
      last=report.cases[0]?.metrics ?? null;
      const rows=report.cases.map(r=>({
        case:r.label,
        fps:r.metrics.fps,
        p95:r.metrics.frameMs.p95,
        p99:r.metrics.frameMs.p99,
        over33:r.metrics.longFrames.over33,
        longTasks:r.metrics.longTasks.count,
        fpsDelta:r.delta.fps,
        p95Gain:r.delta.p95Ms,
        mapRenders:r.mapRender.count,
        mapP95:r.mapRender.p95IntervalMs,
      }));
      console.table(rows);
      out.textContent=JSON.stringify(report,null,2);
      live.textContent=`Suite complete — best p95 gain: ${report.ranking[0]?.label ?? "n/a"}`;
    } catch (e) {
      out.textContent=`benchmark failed: ${String(e)}`;
    } finally {
      btn.disabled=false;
    }
  };
  (el.querySelector("[data-stress]") as HTMLButtonElement).onclick=async()=>{
    const btn=el.querySelector("[data-stress]") as HTMLButtonElement;
    btn.disabled=true;
    out.textContent="Starting camera stress benchmark…";
    try {
      const report=await runCameraStressSuite(map,(message,index,total)=>{
        live.textContent=`${message} [${index+1}/${total}]`;
      });
      console.table(report.aggregates.map(a=>({
        case:a.label,
        runs:a.runs,
        mapFps:a.median.mapFps,
        mapP95:a.median.p95Ms,
        mapP99:a.median.p99Ms,
        fpsGain:a.versusBaseline.mapFpsGain,
        p95Gain:a.versusBaseline.p95GainMs,
        p99Gain:a.versusBaseline.p99GainMs,
      })));
      out.textContent=JSON.stringify(report,null,2);
      live.textContent=`Stress complete — best p95 gain: ${report.ranking[0]?.label ?? "n/a"}`;
    } catch(e) {
      out.textContent=`camera stress failed: ${String(e)}`;
    } finally {
      btn.disabled=false;
    }
  };
  (el.querySelector("[data-terrain]") as HTMLButtonElement).onclick=async()=>{
    const btn=el.querySelector("[data-terrain]") as HTMLButtonElement;
    btn.disabled=true;
    out.textContent="Starting terrain-focused benchmark…";
    try{
      const report=await runTerrainFocus(map,(message,index,total)=>{
        live.textContent=`${message} [${index+1}/${total}]`;
      });
      console.table(report.runs.map(r=>({case:r.label,mapFps:r.mapFps,p95:r.p95Ms,p99:r.p99Ms,max:r.maxMs})));
      console.table(report.paired);
      out.textContent=JSON.stringify(report,null,2);
      live.textContent="Terrain focus complete";
    }catch(e){
      out.textContent=`terrain focus failed: ${String(e)}`;
    }finally{
      btn.disabled=false;
    }
  };
  (el.querySelector("[data-copy]") as HTMLButtonElement).onclick=async()=>{ const r=out.textContent; if(r) await navigator.clipboard.writeText(r); };
  addEventListener("beforeunload",()=>clearInterval(interval),{once:true});
  Object.assign(window,{ perfLab:{ start:()=>perfProfiler.startCapture(), stop, summary:()=>perfProfiler.summary(), clear:()=>{performance.clearMeasures();perfProfiler.reset();}, suite:()=>runBenchmarkSuite(map), stress:()=>runCameraStressSuite(map), terrain:()=>runTerrainFocus(map) } });
}
