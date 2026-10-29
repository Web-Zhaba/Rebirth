import type maplibregl from "maplibre-gl";
import { perfProfiler, type PerfSummary } from "./profiler";
import { reliefOn } from "../map/relief";
import { forest3dOn, water3dOn, fields3dOn, smoke3dOn, motionOn } from "../map/graphicsSettings";
import { cloudsOn } from "../map/clouds/settings";

type Switches = {
  relief: boolean;
  forest: boolean;
  water: boolean;
  fields: boolean;
  smoke: boolean;
  motion: boolean;
  clouds: boolean;
  models: boolean;
};

export interface StressRun {
  id: string;
  label: string;
  repeat: number;
  metrics: PerfSummary;
  mapRender: { count: number; fps: number; p50Ms: number; p95Ms: number; p99Ms: number; maxMs: number };
  diagnosticsBefore: Record<string, unknown>;
  diagnosticsAfter: Record<string, unknown>;
  diagnosticDelta: Record<string, unknown>;
}

export interface StressAggregate {
  id: string;
  label: string;
  runs: number;
  median: { browserFps: number; mapFps: number; p95Ms: number; p99Ms: number; over33: number };
  versusBaseline: { mapFpsGain: number; p95GainMs: number; p99GainMs: number; over33Reduction: number };
}

export interface CameraStressResult {
  capturedAt: string;
  userAgent: string;
  startCamera: { center: [number, number]; zoom: number; pitch: number; bearing: number };
  config: { repeats: number; settleMs: number; routeMs: number };
  runs: StressRun[];
  aggregates: StressAggregate[];
  ranking: StressAggregate[];
}

const MODEL_LAYERS = ["building-models", "building-lamps"] as const;
const sleep = (ms:number) => new Promise<void>(r=>setTimeout(r,ms));
const round=(n:number)=>Math.round(n*100)/100;
const median=(a:number[])=>{const s=[...a].sort((x,y)=>x-y);return s.length ? s[Math.floor(s.length/2)] : 0;};
const percentile=(a:number[],p:number)=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.min(s.length-1,Math.floor((s.length-1)*p))]:0;};

function diagnosticSnapshot():Record<string,unknown>{
  const w=window as unknown as Record<string,unknown>;
  const out:Record<string,unknown>={};
  for(const name of ["treeStats","modelStats","waterStats","fieldStats","cloudStats","shadowStats","landscapeStats"]){
    const fn=w[name];
    if(typeof fn==="function"){try{out[name]=(fn as()=>unknown)();}catch{/* dev only */}}
  }
  return out;
}

function numericDelta(a:unknown,b:unknown):unknown{
  if(typeof a==="number"&&typeof b==="number") return round(b-a);
  if(a&&b&&typeof a==="object"&&typeof b==="object"&&!Array.isArray(a)&&!Array.isArray(b)){
    const out:Record<string,unknown>={};
    for(const k of new Set([...Object.keys(a as object),...Object.keys(b as object)])){
      const d=numericDelta((a as Record<string,unknown>)[k],(b as Record<string,unknown>)[k]);
      if(d!==undefined) out[k]=d;
    }
    return out;
  }
  return undefined;
}

function setModels(map:maplibregl.Map,on:boolean){
  for(const id of MODEL_LAYERS) if(map.getLayer(id)) map.setLayoutProperty(id,"visibility",on?"visible":"none");
}
function apply(map:maplibregl.Map,s:Switches){
  reliefOn.value=s.relief;
  forest3dOn.value=s.forest;
  water3dOn.value=s.water;
  fields3dOn.value=s.fields;
  smoke3dOn.value=s.smoke;
  motionOn.value=s.motion;
  cloudsOn.value=s.clouds;
  setModels(map,s.models);
  map.triggerRepaint();
}

function cameraOf(map:maplibregl.Map){
  const c=map.getCenter();
  return {center:[c.lng,c.lat] as [number,number],zoom:map.getZoom(),pitch:map.getPitch(),bearing:map.getBearing()};
}

function ease(map:maplibregl.Map, camera:ReturnType<typeof cameraOf>, duration:number):Promise<void>{
  return new Promise(resolve=>{
    let done=false;
    const finish=()=>{if(done)return;done=true;map.off("moveend",finish);resolve();};
    map.once("moveend",finish);
    map.easeTo({center:camera.center,zoom:camera.zoom,pitch:camera.pitch,bearing:camera.bearing,duration,easing:t=>t});
    setTimeout(finish,duration+600);
  });
}

async function route(map:maplibregl.Map,start:ReturnType<typeof cameraOf>,totalMs:number){
  const d=Math.max(450,Math.floor(totalMs/5));
  const z=start.zoom;
  await ease(map,{...start,bearing:start.bearing+35,pitch:Math.min(65,start.pitch+10),zoom:z+0.35},d);
  await ease(map,{...start,center:[start.center[0]+0.0025,start.center[1]+0.0015],bearing:start.bearing-25,pitch:Math.max(30,start.pitch-8),zoom:z-0.25},d);
  await ease(map,{...start,center:[start.center[0]-0.002,start.center[1]-0.001],bearing:start.bearing+15,pitch:Math.min(62,start.pitch+5),zoom:z+0.55},d);
  await ease(map,{...start,bearing:start.bearing-15,pitch:start.pitch,zoom:z-0.1},d);
  await ease(map,start,d);
}

export async function runCameraStressSuite(
  map:maplibregl.Map,
  onProgress?:(text:string,index:number,total:number)=>void,
  cfg:{repeats?:number;settleMs?:number;routeMs?:number}={}
):Promise<CameraStressResult>{
  const repeats=cfg.repeats??3, settleMs=cfg.settleMs??1400, routeMs=cfg.routeMs??6000;
  const start=cameraOf(map);
  const original:Switches={
    relief:reliefOn.peek(),forest:forest3dOn.peek(),water:water3dOn.peek(),fields:fields3dOn.peek(),
    smoke:smoke3dOn.peek(),motion:motionOn.peek(),clouds:cloudsOn.peek(),
    models:MODEL_LAYERS.every(id=>!map.getLayer(id)||map.getLayoutProperty(id,"visibility")!=="none"),
  };
  const modelVis=Object.fromEntries(MODEL_LAYERS.map(id=>[id,map.getLayer(id)?map.getLayoutProperty(id,"visibility"):undefined]));
  const variants=[
    {id:"baseline",label:"Baseline",switches:{...original}},
    {id:"no-relief",label:"Relief off",switches:{...original,relief:false}},
    {id:"no-forest",label:"3D forest off",switches:{...original,forest:false}},
    {id:"no-water",label:"3D water off",switches:{...original,water:false}},
    {id:"no-clouds",label:"Clouds + shadows off",switches:{...original,clouds:false}},
    {id:"no-models",label:"3D models off",switches:{...original,models:false}},
    {id:"no-motion",label:"Decorative motion off",switches:{...original,motion:false}},
    {id:"terrain-only-ish",label:"Relief with extras off",switches:{...original,forest:false,water:false,fields:false,smoke:false,clouds:false,models:false,motion:false}},
    {id:"flat-minimal",label:"Flat minimal",switches:{...original,relief:false,forest:false,water:false,fields:false,smoke:false,clouds:false,models:false,motion:false}},
  ];
  // Interleave a baseline before every variant. This compensates for warm-up, caches and thermal drift.
  const plan:{id:string;label:string;switches:Switches;repeat:number}[]=[];
  for(let r=1;r<=repeats;r++) for(const v of variants.slice(1)){plan.push({id:"baseline",label:"Baseline",switches:{...original},repeat:r}, {...v,repeat:r});}
  const runs:StressRun[]=[];
  try{
    for(let i=0;i<plan.length;i++){
      const p=plan[i];
      onProgress?.(`Stress settle: ${p.label} r${p.repeat}`,i,plan.length);
      map.stop();
      map.jumpTo({center:start.center,zoom:start.zoom,pitch:start.pitch,bearing:start.bearing});
      apply(map,p.switches);
      await sleep(settleMs);
      const before=diagnosticSnapshot();
      const times:number[]=[]; let prev=0;
      const onRender=()=>{const t=performance.now();if(prev)times.push(t-prev);prev=t;};
      map.on("render",onRender);
      perfProfiler.reset();perfProfiler.startCapture();
      onProgress?.(`Stress route: ${p.label} r${p.repeat}`,i,plan.length);
      await route(map,start,routeMs);
      const metrics=perfProfiler.stopCapture();
      map.off("render",onRender);
      const after=diagnosticSnapshot();
      const dur=times.reduce((a,b)=>a+b,0);
      runs.push({
        id:p.id,label:p.label,repeat:p.repeat,metrics,
        mapRender:{count:times.length+1,fps:dur?round(times.length*1000/dur):0,p50Ms:round(percentile(times,.5)),p95Ms:round(percentile(times,.95)),p99Ms:round(percentile(times,.99)),maxMs:round(Math.max(0,...times))},
        diagnosticsBefore:before,diagnosticsAfter:after,diagnosticDelta:(numericDelta(before,after) as Record<string,unknown>)??{},
      });
    }
  }finally{
    reliefOn.value=original.relief;forest3dOn.value=original.forest;water3dOn.value=original.water;fields3dOn.value=original.fields;
    smoke3dOn.value=original.smoke;motionOn.value=original.motion;cloudsOn.value=original.clouds;
    for(const [id,v] of Object.entries(modelVis)) if(map.getLayer(id)) map.setLayoutProperty(id,"visibility",(v as string|undefined)??"visible");
    map.stop();map.jumpTo({center:start.center,zoom:start.zoom,pitch:start.pitch,bearing:start.bearing});map.triggerRepaint();
  }

  const ids=[...new Set(runs.map(r=>r.id))];
  const baselineRuns=runs.filter(r=>r.id==="baseline");
  const base={
    mapFps:median(baselineRuns.map(r=>r.mapRender.fps)),
    p95:median(baselineRuns.map(r=>r.mapRender.p95Ms)),
    p99:median(baselineRuns.map(r=>r.mapRender.p99Ms)),
    over33:median(baselineRuns.map(r=>r.metrics.longFrames.over33)),
  };
  const aggregates:StressAggregate[]=ids.map(id=>{
    const rr=runs.filter(r=>r.id===id), label=rr[0]?.label??id;
    const med={browserFps:round(median(rr.map(r=>r.metrics.fps))),mapFps:round(median(rr.map(r=>r.mapRender.fps))),p95Ms:round(median(rr.map(r=>r.mapRender.p95Ms))),p99Ms:round(median(rr.map(r=>r.mapRender.p99Ms))),over33:round(median(rr.map(r=>r.metrics.longFrames.over33)))};
    return {id,label,runs:rr.length,median:med,versusBaseline:{mapFpsGain:round(med.mapFps-base.mapFps),p95GainMs:round(base.p95-med.p95Ms),p99GainMs:round(base.p99-med.p99Ms),over33Reduction:round(base.over33-med.over33)}};
  });
  return {
    capturedAt:new Date().toISOString(),userAgent:navigator.userAgent,startCamera:start,config:{repeats,settleMs,routeMs},runs,aggregates,
    ranking:aggregates.filter(a=>a.id!=="baseline").sort((a,b)=>b.versusBaseline.p95GainMs-a.versusBaseline.p95GainMs||b.versusBaseline.mapFpsGain-a.versusBaseline.mapFpsGain),
  };
}
