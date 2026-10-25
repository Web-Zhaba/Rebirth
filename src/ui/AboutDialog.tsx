import "./journal.css";
import { signal } from "@preact/signals";
import { Dialog } from "./kit";

export const aboutOpen = signal(false);

const LINKS: { name: string; href: string; what: string }[] = [
  { name: "game-icons.net", href: "https://game-icons.net", what: "значки построек, товаров и находок: Lorc, Delapouite и другие авторы, CC BY 3.0" },
  { name: "Phosphor Icons", href: "https://phosphoricons.com", what: "значки интерфейса, лицензия MIT" },
  { name: "PT Serif и PT Sans", href: "https://www.paratype.com/fonts/pt/pt-serif", what: "шрифты ParaType, лицензия SIL OFL 1.1" },
  { name: "\u00a9 участники OpenStreetMap", href: "https://www.openstreetmap.org/copyright", what: "данные карты, лицензия ODbL" },
  { name: "OpenFreeMap", href: "https://openfreemap.org", what: "векторные тайлы" },
  { name: "\u00a9 OpenMapTiles", href: "https://www.openmaptiles.org/", what: "схема векторных данных" },
  { name: "Mapzen / AWS Open Data", href: "https://registry.opendata.aws/terrain-tiles/", what: "высоты рельефа (Terrain Tiles)" },
  { name: "MapLibre GL JS", href: "https://maplibre.org", what: "отрисовка карты, лицензия BSD-3-Clause" },
  { name: "Звуки интерфейса", href: "https://developer.mozilla.org/docs/Web/API/Web_Audio_API", what: "синтезируются в игре средствами Web Audio API, без сторонних файлов" },
  { name: "Википедия", href: "https://ru.wikipedia.org", what: "статьи о найденных местах, CC BY-SA 4.0 (ссылка на каждую статью в записной книжке)" },
];

// «Об игре»: every attribution the licences ask for. The source list is CREDITS.md.
export function AboutDialog() {
  if (!aboutOpen.value) return null;
  return (
    <Dialog title="Об игре" class="about" onClose={() => (aboutOpen.value = false)}>
      <p class="about-lead">Rebirth — градостроительная игра на настоящей карте: основываешь поселение, ведёшь раскопки и смотришь, как оно растёт.</p>
      <h3 class="about-sub">Благодарности и лицензии</h3>
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
    </Dialog>
  );
}
