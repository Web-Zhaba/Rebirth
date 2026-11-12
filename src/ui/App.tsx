import { computed } from "@preact/signals";
import type { View } from "../view/view";
import { useEffect } from "preact/hooks";
import { city, state } from "../simClient";
import { AboutDialog } from "./AboutDialog";
import { AdminPanel } from "./AdminPanel";
import { BuildBar } from "./BuildBar";
import { BuildingPanel } from "./BuildingPanel";
import { CentreColumn } from "./CentreColumn";
import { ClearingPanel } from "./ClearingPanel";
import { FoundCity } from "./FoundCity";
import { FpsCounter } from "./FpsCounter";
import { FollowCamera } from "./FollowCamera";
import { HeritagePanel } from "./HeritagePanel";
import { HotkeysDialog } from "./HotkeysDialog";
import { MuseumPanel } from "./MuseumPanel";
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
import { installScreenshotMode } from "./screenshotMode";
import { RoadDemolishConfirm } from "./RoadDemolishConfirm";

export function App({ view }: { view: View }) {
  const c = city.value;
  useEffect(() => (c ? trackLayout() : undefined), [!!c]);
  useEffect(installClickSound, []);
  useEffect(installScreenshotMode, []);
  useEffect(() => attachWeatherSound(computed(() => state.value?.weather ?? null)), []);
  return (
    <>
      {c ? <Hud city={c} view={view} /> : <FoundCity view={view} />}
      {c && <TerrainInspector view={view} />}
      {c && <CentreColumn view={view} />}
      {c && <FollowCamera view={view} />}
      {c && <BuildingPanel />}
      {c && <ClearingPanel />}
      {c && <TownPanel city={c} view={view} />}
      {c && <TechPanel />}
      {c && <MuseumPanel view={view} />}
      {c && <HeritagePanel />}
      {c && <NotebookHost view={view} />}
      {c && <BuildBar />}
      {/* Cheats are a development tool: production builds drop the panel entirely. */}
      {import.meta.env.DEV && c && <AdminPanel />}
      {/* A readout for a running town: on the first-launch screen it would sit on the founding sheet. */}
      {c && <FpsCounter />}
      <AboutDialog />
      <HotkeysDialog />
      <SettingsDialog />
      <RoadDemolishConfirm />
    </>
  );
}
