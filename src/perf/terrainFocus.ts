import type maplibregl from "maplibre-gl";
import { runCameraStressSuite, type CameraStressResult } from "./cameraStress";
import { reliefOn } from "../map/relief";
import { forest3dOn } from "../map/graphicsSettings";

type Cam = { center:[number,number]; zoom:number; pitch:number; bearing:number };

const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));

function terrainSource(map:maplibregl.Map):string {
  return map.getSource("terrain-dem") ? "terrain-dem" : "terrain";
}

function cameraOf(map:maplibregl.Map):Cam {
  const c=map.getCenter();
  return {center:[c.lng,c.lat],zoom:map.getZoom(),pitch:map.getPitch(),bearing:map.getBearing()};
}

function ease(map:maplibregl.Map,c:Cam,d:number):Promise<void>{
  return new Promise(resolve=>{
    let done=false;
    const finish=()=>{if(done)return;done=true;map.off("moveend",finish);resolve();};
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

interface FocusRun {
  id:string;
  label:string;
  mapFps:number;
  p95Ms:number;
  p99Ms:number;
  maxMs:number;
  count:number;
}

export interface TerrainFocusResult {
  capturedAt:string;
  startCamera:Cam;
  runs:FocusRun[];
  paired:[
    {id:"relief-off"; fpsGain:number; p95GainMs:number},
    {id:"hillshade-off"; fpsGain:number; p95GainMs:number},
    {id:"terrain-flat"; fpsGain:number; p95GainMs:number},
    {id:"forest-off"; fpsGain:number; p95GainMs:number},
  ];
}

const percentile=(a:number[],p:number)=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.min(s.length-1,Math.floor((s.length-1)*p))]:0;};
const round=(n:number)=>Math.round(n*100)/100;

async function captureRoute(map:maplibregl.Map,start:Cam,routeMs:number):Promise<Omit<FocusRun,"id"|"label">>{
  const times:number[]=[]; let prev=0;
  const onRender=()=>{const t=performance.now();if(prev)times.push(t-prev);prev=t;};
  map.on("render",onRender);
  await route(map,start,routeMs);
  map.off("render",onRender);
  const total=times.reduce((a,b)=>a+b,0);
  return {
    mapFps:total?round(times.length*1000/total):0,
    p95Ms:round(percentile(times,.95)),
    p99Ms:round(percentile(times,.99)),
    maxMs:round(Math.max(0,...times)),
    count:times.length+1,
  };
}

export async function runTerrainFocus(
  map:maplibregl.Map,
  onProgress?:(text:string,index:number,total:number)=>void,
  cfg:{settleMs?:number;routeMs?:number}={}
):Promise<TerrainFocusResult>{
  const settleMs=cfg.settleMs??1600, routeMs=cfg.routeMs??6500;
  const start=cameraOf(map);
  const originalRelief=reliefOn.peek();
  const originalForest=forest3dOn.peek();
  const hillshadeVisible=!map.getLayer("hillshade") || map.getLayoutProperty("hillshade","visibility")!=="none";
  const source=terrainSource(map);
  const normal=()=>{reliefOn.value=true;forest3dOn.value=originalForest;if(map.getLayer("hillshade"))map.setLayoutProperty("hillshade","visibility",hillshadeVisible?"visible":"none");map.setTerrain({source,exaggeration:1.6});};
  const variants=[
    {id:"relief-off",label:"Relief off",apply:()=>{reliefOn.value=false;forest3dOn.value=originalForest;}},
    {id:"hillshade-off",label:"Hillshade off",apply:()=>{normal();if(map.getLayer("hillshade"))map.setLayoutProperty("hillshade","visibility","none");}},
    {id:"terrain-flat",label:"Terrain pipeline, near-zero exaggeration",apply:()=>{normal();map.setTerrain({source,exaggeration:0.001});}},
    {id:"forest-off",label:"3D forest off",apply:()=>{normal();forest3dOn.value=false;}},
  ] as const;
  const runs:FocusRun[]=[];
  try{
    for(let i=0;i<variants.length;i++){
      const v=variants[i];
      for(const [kind,apply,label] of [["baseline",normal,"Baseline"],[v.id,v.apply,v.label]] as const){
        onProgress?.(`${label}`,runs.length,variants.length*2);
        map.stop();map.jumpTo({center:start.center,zoom:start.zoom,pitch:start.pitch,bearing:start.bearing});
        apply();map.triggerRepaint();
        await sleep(settleMs);
        const data=await captureRoute(map,start,routeMs);
        runs.push({id:kind,label,...data});
      }
    }
  } finally {
    reliefOn.value=originalRelief;
    forest3dOn.value=originalForest;
    if(map.getLayer("hillshade")) map.setLayoutProperty("hillshade","visibility",hillshadeVisible?"visible":"none");
    if(originalRelief) map.setTerrain({source,exaggeration:1.6}); else map.setTerrain(null);
    map.stop();map.jumpTo({center:start.center,zoom:start.zoom,pitch:start.pitch,bearing:start.bearing});
    map.triggerRepaint();
  }
  const paired=variants.map((v,i)=>{
    const b=runs[i*2], x=runs[i*2+1];
    return {id:v.id,fpsGain:round(x.mapFps-b.mapFps),p95GainMs:round(b.p95Ms-x.p95Ms)};
  }) as TerrainFocusResult["paired"];
  return {capturedAt:new Date().toISOString(),startCamera:start,runs,paired};
}
