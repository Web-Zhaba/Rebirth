import { computed } from "@preact/signals";
import type { View } from "../view/view";
import { useEffect } from "preact/hooks";
import { city, downloadUnreadableSave, loaded, loadFailure, state } from "../simClient";
import { L } from "../i18n";
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
import { MarketPanel } from "./MarketPanel";
import { TownhallPanel } from "./TownhallPanel";
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
import { Button } from "./kit";

const LOAD_ERRORS = {
  locked: L("Игра уже открыта в другой вкладке. Закройте её и повторите попытку здесь.", "The game is open in another tab. Close that tab and retry here."),
  unavailable: L("Не удалось загрузить поселение. Проверьте, разрешено ли сайту сохранять данные, и повторите попытку.", "Could not load the settlement. Check that the site can store data and retry."),
  invalid: L("Не удалось прочитать сохранение. Вы можете скачать его копию.", "Could not read the save. You can download a copy."),
};

export function App({ view }: { view: View }) {
  const c = city.value;
  useEffect(() => (c ? trackLayout() : undefined), [!!c]);
  useEffect(installClickSound, []);
  useEffect(installScreenshotMode, []);
  useEffect(() => attachWeatherSound(computed(() => state.value?.weather ?? null)), []);
  const failure = loadFailure.value;
  if (failure) {
    return (
      <section class="found" aria-labelledby="save-load-title">
        <div class="found-sheet">
          <h2 id="save-load-title">{L("Поселение недоступно", "Settlement unavailable")}</h2>
          <p role="alert">{LOAD_ERRORS[failure]}</p>
          {failure === "invalid" && <Button onClick={downloadUnreadableSave}>{L("Скачать сохранение", "Download save")}</Button>}
          <Button variant="primary" onClick={() => location.reload()}>{L("Повторить", "Retry")}</Button>
        </div>
      </section>
    );
  }
  if (!loaded.value) return <div class="found-task" role="status">{L("Загружаем поселение…", "Loading the settlement…")}</div>;
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
      {c && <MarketPanel />}
      {c && <TownhallPanel />}
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
