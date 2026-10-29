import type maplibregl from "maplibre-gl";
import { RELIEF_EXAGGERATION, reliefOn } from "../map/relief";

type Cam={center:[number,number];zoom:number;pitch:number;bearing:number};
interface Run{id:string;label:string;mapFps:number;p95Ms:number;p99Ms:number;maxMs:number;count:number}

const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
const round=(n:number)=>Math.round(n*100)/100;
const percentile=(a:number[],p:number)=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.min(s.length-1,Math.floor((s.length-1)*p))]:0;};
const cameraOf=(map:maplibregl.Map):Cam=>{const c=map.getCenter();return{center:[c.lng,c.lat],zoom:map.getZoom(),pitch:map.getPitch(),bearing:map.getBearing()};};

function ease(map:maplibregl.Map,c:Cam,d:number):Promise<void>{
  return new Promise(resolve=>{
    let done=false;const finish=()=>{if(done)return;done=true;map.off("moveend",finish);resolve();};
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
  map.on("render",onRender);await route(map,start,routeMs);map.off("render",onRender);
  const total=times.reduce((a,b)=>a+b,0);
  return{mapFps:total?round(times.length*1000/total):0,p95Ms:round(percentile(times,.95)),p99Ms:round(percentile(times,.99)),maxMs:round(Math.max(0,...times)),count:times.length+1};
}

export async function runTerrainDemFocus(map:maplibregl.Map,onProgress?:(text:string,index:number,total:number)=>void,cfg:{settleMs?:number;routeMs?:number}={}){
  const settleMs=cfg.settleMs??1600,routeMs=cfg.routeMs??6500,start=cameraOf(map);
  const originalRelief=reliefOn.peek();
  const style=map.getStyle();
  const base=style?.sources?.["terrain"] as maplibregl.RasterDEMSourceSpecification|undefined;
  if(!base) throw new Error("terrain source not found");
  const ids={11:"terrain-dem",10:"terrain-dem-z10",9:"terrain-dem-z9"} as const;
  for(const z of [10,9] as const){
    const id=ids[z];
    if(!map.getSource(id)) map.addSource(id,{...base,maxzoom:z});
  }
  const cases=[
    {id:"z11",label:"Terrain DEM z11",apply:()=>{reliefOn.value=true;map.setTerrain({source:ids[11],exaggeration:RELIEF_EXAGGERATION});}},
    {id:"z10",label:"Terrain DEM z10",apply:()=>{reliefOn.value=true;map.setTerrain({source:ids[10],exaggeration:RELIEF_EXAGGERATION});}},
    {id:"z9",label:"Terrain DEM z9",apply:()=>{reliefOn.value=true;map.setTerrain({source:ids[9],exaggeration:RELIEF_EXAGGERATION});}},
    {id:"off",label:"Relief off ceiling",apply:()=>{reliefOn.value=false;map.setTerrain(null);}},
    {id:"z11-repeat",label:"Terrain DEM z11 repeat",apply:()=>{reliefOn.value=true;map.setTerrain({source:ids[11],exaggeration:RELIEF_EXAGGERATION});}},
  ] as const;
  const runs:Run[]=[];
  try{
    for(let i=0;i<cases.length;i++){
      const c=cases[i];onProgress?.(c.label,i,cases.length);
      map.stop();map.jumpTo({center:start.center,zoom:start.zoom,pitch:start.pitch,bearing:start.bearing});
      c.apply();map.triggerRepaint();await sleep(settleMs);
      runs.push({id:c.id,label:c.label,...await capture(map,start,routeMs)});
    }
  }finally{
    if(originalRelief)map.setTerrain({source:ids[11],exaggeration:RELIEF_EXAGGERATION});else map.setTerrain(null);
    reliefOn.value=originalRelief;
    for(const z of [10,9] as const){
      const id=ids[z];
      try{if(map.getSource(id))map.removeSource(id);}catch{/* style may still be settling */}
    }
    map.stop();map.jumpTo({center:start.center,zoom:start.zoom,pitch:start.pitch,bearing:start.bearing});map.triggerRepaint();
  }
  const b=runs[0];
  return{capturedAt:new Date().toISOString(),startCamera:start,runs,delta:runs.slice(1).map(r=>({id:r.id,fpsGain:round(r.mapFps-b.mapFps),p95GainMs:round(b.p95Ms-r.p95Ms)}))};
}
