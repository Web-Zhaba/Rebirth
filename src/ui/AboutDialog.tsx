import "./journal.css";
import { signal } from "@preact/signals";
import { Dialog } from "./kit";
import { L } from "../i18n";

export const aboutOpen = signal(false);

const LINKS: { name: string; href: string; what: string }[] = [
  { name: "game-icons.net", href: "https://game-icons.net", what: L("значки построек, товаров и находок: Lorc, Delapouite и другие авторы, CC BY 3.0", "icons for buildings, goods and finds: Lorc, Delapouite and other authors, CC BY 3.0") },
  { name: "Phosphor Icons", href: "https://phosphoricons.com", what: L("значки интерфейса, лицензия MIT", "interface icons, MIT license") },
  { name: L("PT Serif и PT Sans", "PT Serif and PT Sans"), href: "https://www.paratype.com/fonts/pt/pt-serif", what: L("шрифты ParaType, лицензия SIL OFL 1.1", "ParaType fonts, SIL OFL 1.1 license") },
  { name: L("\u00a9 участники OpenStreetMap", "\u00a9 OpenStreetMap contributors"), href: "https://www.openstreetmap.org/copyright", what: L("данные карты, лицензия ODbL", "map data, ODbL license") },
  { name: "OpenFreeMap", href: "https://openfreemap.org", what: L("векторные тайлы", "vector tiles") },
  { name: "\u00a9 OpenMapTiles", href: "https://www.openmaptiles.org/", what: L("схема векторных данных", "vector data schema") },
  { name: "Mapzen / AWS Open Data", href: "https://registry.opendata.aws/terrain-tiles/", what: L("высоты рельефа (Terrain Tiles)", "terrain elevation (Terrain Tiles)") },
  { name: "RESOLVE Ecoregions 2017", href: "https://ecoregions.appspot.com", what: L("карта биомов (Dinerstein и др., 2017), лицензия CC BY 4.0", "biome map (Dinerstein et al., 2017), CC BY 4.0 license") },
  { name: "MapLibre GL JS", href: "https://maplibre.org", what: L("образец поведения камеры, лицензия BSD-3-Clause", "reference for camera behaviour, BSD-3-Clause license") },
  { name: L("Звуки интерфейса", "Interface sounds"), href: "https://developer.mozilla.org/docs/Web/API/Web_Audio_API", what: L("синтезируются в игре средствами Web Audio API, без сторонних файлов", "synthesized in the game with the Web Audio API, no third-party files") },
  { name: "Photon (komoot)", href: "https://photon.komoot.io", what: L("поиск мест по названию перед основанием, данные OpenStreetMap", "place search by name before founding, OpenStreetMap data") },
  { name: L("Википедия", "Wikipedia"), href: L("https://ru.wikipedia.org", "https://en.wikipedia.org"), what: L("статьи о найденных местах, CC BY-SA 4.0 (ссылка на каждую статью в записной книжке)", "articles about places found, CC BY-SA 4.0 (each article is linked in the notebook)") },
];

// «Об игре»: every attribution the licences ask for. The source list is CREDITS.md.
export function AboutDialog() {
  if (!aboutOpen.value) return null;
  return (
    <Dialog title={L("Об игре", "About the game")} class="about" onClose={() => (aboutOpen.value = false)}>
      <p class="about-lead">{L("Rebirth — градостроительная игра на настоящей карте: основываешь поселение, ведёшь раскопки и смотришь, как оно растёт.", "Rebirth is a city-building game on the real map: you found a settlement, run digs and watch it grow.")}</p>
      <h3 class="about-sub">{L("Благодарности и лицензии", "Credits and licenses")}</h3>
      <ul class="about-list">
        {LINKS.map((l) => (
          <li key={l.name}>
            <a href={l.href} target="_blank" rel="noopener">
              {l.name}
            </a>
            {" — "}
            {l.what}
          </li>
        ))}
      </ul>
      <p class="about-version">{L("Версия", "Version")} {__APP_VERSION__}</p>
    </Dialog>
  );
}
