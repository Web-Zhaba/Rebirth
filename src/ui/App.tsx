import type maplibregl from "maplibre-gl";
import { city } from "../simClient";
import { AwayNotice } from "./AwayNotice";
import { FoundCity } from "./FoundCity";
import { Hud } from "./Hud";
import { NightTint } from "./NightTint";
import { TerrainInspector } from "./TerrainInspector";

export function App({ map }: { map: maplibregl.Map }) {
  const c = city.value;
  return (
    <>
      {c ? <Hud city={c} /> : <FoundCity map={map} />}
      {c && <NightTint />}
      {c && <TerrainInspector map={map} />}
      <AwayNotice />
    </>
  );
}
