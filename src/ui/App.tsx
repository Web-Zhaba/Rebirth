import type maplibregl from "maplibre-gl";
import { city } from "../simClient";
import { AboutDialog } from "./AboutDialog";
import { AwayNotice } from "./AwayNotice";
import { BuildBar } from "./BuildBar";
import { BuildingPanel } from "./BuildingPanel";
import { CentreColumn } from "./CentreColumn";
import { ClearingPanel } from "./ClearingPanel";
import { FoundCity } from "./FoundCity";
import { HotkeysDialog } from "./HotkeysDialog";
import { Hud } from "./Hud";
import { NotebookHost } from "./NotebookHost";
import { TerrainInspector } from "./TerrainInspector";
import { TownPanel } from "./TownPanel";

export function App({ map }: { map: maplibregl.Map }) {
  const c = city.value;
  return (
    <>
      {c ? <Hud city={c} map={map} /> : <FoundCity map={map} />}
      {c && <TerrainInspector map={map} />}
      {c && <BuildBar />}
      {c && <BuildingPanel />}
      {c && <ClearingPanel />}
      {c && <TownPanel city={c} map={map} />}
      {c && <CentreColumn map={map} />}
      {c && <NotebookHost />}
      <AwayNotice />
      <AboutDialog />
      <HotkeysDialog />
    </>
  );
}
