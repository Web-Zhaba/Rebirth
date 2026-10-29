import type maplibregl from "maplibre-gl";

type Tune = { farScale?: number; densityScale?: number };
type Cam = { center:[number,number]; zoom:number; pitch:number; bearing:number };
interface Run { id:string; label:string; mapFps:number; p95Ms:number; p99Ms:number; maxMs:number; count:number; tuning:Tune; treeStats?:unknown; }

const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
const round=(n:number)=>Math.round(n*100)/100;
const percentile=(a:number[],p:number)=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.min(s.length-1,Math.floor((s.length-1)*p))]:0;};
const cam=(map:maplibregl.Map):Cam=>{const c=map.getCenter();return{center:[c.lng,c.lat],zoom:map.getZoom(),pitch:map.getPitch(),bearing:map.getBearing()};};
const tune=(opts:Tune)=>{const fn=(window as unknown as {treePerfTune?:(o?:Tune)=>unknown}).treePerfTune;if(fn)fn(opts);};
const resetTreePerf=()=>{const fn=(window as unknown as {treePerfReset?:()=>void}).treePerfReset;if(fn)fn();};
const readTreeStats=()=>{const fn=(window as unknown as {treeStats?:()=>unknown}).treeStats;return fn?fn():undefined;};

function ease(map:maplibregl.Map,c:Cam,d:number):Promise<void>{
  return new Promise(resolve=>{
    let done=false; const finish=()=>{if(done)return;done=true;map.off("moveend",finish);resolve();};
    map.once("moveend",finish);
    map.easeTo({center:c.center,zoom:c.zoom,pitch:c.pitch,bearing:c.bearing,duration:d,easing:t=>t});
    setTimeout(finish,d+500);
  });
}

async function route(map:maplibregl.Map,start:Cam,totalMs:number){
  const d=Math.max(500,Math.floor(totalMs/4));
  await ease(map,{...start,bearing:start.bearing+35,pitch:Math.min(65,start.pitch+10),zoom:start.zoom+0.35},d);
  await ease(map,{...start,center:[start.center[0]+0.0025,start.center[1]+0.0015],bearing:start.bearing-25,pitch:Math.max(30,start.pitch-8),zoom:start.zoom-0.25},d);
  await ease(map,{...start,center:[start.center[0]-0.002,start.center[1]-0.001],bearing:start.bearing+15,pitch:Math.min(62,start.pitch+5),zoom:start.zoom+0.45},d);
  await ease(map,start,d);
}

async function capture(map:maplibregl.Map,start:Cam,routeMs:number){
  const times:number[]=[];let prev=0;
  const onRender=()=>{const t=performance.now();if(prev)times.push(t-prev);prev=t;};
  map.on("render",onRender); await route(map,start,routeMs); map.off("render",onRender);
  const total=times.reduce((a,b)=>a+b,0);
  return {mapFps:total?round(times.length*1000/total):0,p95Ms:round(percentile(times,.95)),p99Ms:round(percentile(times,.99)),maxMs:round(Math.max(0,...times)),count:times.length+1};
}

export async function runForestFocus(map:maplibregl.Map,onProgress?:(text:string,index:number,total:number)=>void,cfg:{settleMs?:number;routeMs?:number}={}){
  const settleMs=cfg.settleMs??1400,routeMs=cfg.routeMs??6500,start=cam(map);
  const variants=[
    {id:"baseline",label:"Forest 100%",tuning:{farScale:1,densityScale:1}},
    {id:"far-75",label:"Forest reach 75%",tuning:{farScale:.75,densityScale:1}},
    {id:"far-50",label:"Forest reach 50%",tuning:{farScale:.5,densityScale:1}},
    {id:"density-75",label:"Forest density 75%",tuning:{farScale:1,densityScale:.75}},
    {id:"density-50",label:"Forest density 50%",tuning:{farScale:1,densityScale:.5}},
    {id:"balanced",label:"Forest reach 75% + density 75%",tuning:{farScale:.75,densityScale:.75}},
  ] as const;
  const runs:Run[]=[];
  try{
    for(let i=0;i<variants.length;i++){
      const v=variants[i]; onProgress?.(v.label,i,variants.length);
      map.stop();map.jumpTo({center:start.center,zoom:start.zoom,pitch:start.pitch,bearing:start.bearing});
      tune(v.tuning);map.triggerRepaint();await sleep(settleMs);
      resetTreePerf();
      const data=await capture(map,start,routeMs);
      runs.push({id:v.id,label:v.label,tuning:v.tuning,...data,treeStats:readTreeStats()});
    }
  }finally{
    tune({farScale:1,densityScale:1});map.stop();map.jumpTo({center:start.center,zoom:start.zoom,pitch:start.pitch,bearing:start.bearing});map.triggerRepaint();
  }
  const b=runs[0];
  const ranked=runs.slice(1).map(r=>({id:r.id,label:r.label,fpsGain:round(r.mapFps-b.mapFps),p95GainMs:round(b.p95Ms-r.p95Ms)})).sort((a,b)=>b.p95GainMs-a.p95GainMs||b.fpsGain-a.fpsGain);
  return {capturedAt:new Date().toISOString(),startCamera:start,runs,ranked};
}
