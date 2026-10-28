import { computed } from "@preact/signals";
import type * as maplibregl from "maplibre-gl";
import { useEffect } from "preact/hooks";
import { city, state } from "../simClient";
import { AboutDialog } from "./AboutDialog";
import { AdminPanel } from "./AdminPanel";
import { AwayNotice } from "./AwayNotice";
import { BuildBar } from "./BuildBar";
import { BuildingPanel } from "./BuildingPanel";
import { CentreColumn } from "./CentreColumn";
import { ClearingPanel } from "./ClearingPanel";
import { FoundCity } from "./FoundCity";
import { FpsCounter } from "./FpsCounter";
import { HeritagePanel } from "./HeritagePanel";
import { HotkeysDialog } from "./HotkeysDialog";
import { Hud } from "./Hud";
import { NotebookHost } from "./NotebookHost";
import { SettingsDialog } from "./SettingsDialog";
import { installClickSound } from "./sound";
import { attachWeatherSound } from "./weatherSound";
import { TerrainInspector } from "./TerrainInspector";
import { trackLayout } from "./layout";
import "./layout.css";
import { TechPanel } from "./TechPanel";
import { TownPanel } from "./TownPanel";

export function App({ map }: { map: maplibregl.Map }) {
  const c = city.value;
  useEffect(() => (c ? trackLayout() : undefined), [!!c]);
  useEffect(installClickSound, []);
  useEffect(() => attachWeatherSound(computed(() => state.value?.weather ?? null)), []);
  return (
    <>
      {c ? <Hud city={c} map={map} /> : <FoundCity map={map} />}
      {c && <TerrainInspector map={map} />}
      {c && <CentreColumn map={map} />}
      {c && <BuildingPanel />}
      {c && <ClearingPanel />}
      {c && <TownPanel city={c} map={map} />}
      {c && <TechPanel />}
      {c && <HeritagePanel />}
      {c && <NotebookHost />}
      {c && <BuildBar />}
      {c && <AdminPanel />}
      <FpsCounter />
      <AwayNotice />
      <AboutDialog />
      <HotkeysDialog />
      <SettingsDialog />
    </>
  );
}
