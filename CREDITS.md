# Credits

The in-game «Об игре» dialog (the info button at the right end of the top bar, `src/ui/AboutDialog.tsx`) shows these attributions; keep both in step.

## Icons

- World things (`@iconify-json/game-icons`): icons from [game-icons.net](https://game-icons.net) by Lorc, Delapouite and contributors, licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
- Interface (`@iconify-json/ph`): [Phosphor Icons](https://phosphoricons.com), MIT license.
- Compiled at build time by `unplugin-icons` (MIT); the used set is listed in `src/ui/icons.ts`.

## Fonts

- PT Serif and PT Sans, by ParaType, SIL Open Font License 1.1, self-hosted through `@fontsource/pt-serif` and `@fontsource/pt-sans` (weights 400 and 700).

## Sound

- UI sounds are synthesized in the browser with the Web Audio API (`src/ui/sound.ts`): no audio files, no third-party assets. Off by default; switched on and the volume set in «Настройки».

## Map and text data

- Map data: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL), served as vector tiles by [OpenFreeMap](https://openfreemap.org) in the [OpenMapTiles](https://www.openmaptiles.org/) schema (© OpenMapTiles).
- Terrain: Mapzen / [AWS Open Data](https://registry.opendata.aws/terrain-tiles/) Terrain Tiles (Terrarium encoding). The map attribution strings are in `src/map/style.ts`.
- Map rendering: [MapLibre GL JS](https://maplibre.org), BSD-3-Clause.
- Place search before founding: [Photon](https://photon.komoot.io) by komoot, over OpenStreetMap data (© OpenStreetMap contributors, ODbL).
- Article extracts in the notebook: Wikipedia, CC BY-SA 4.0, each with a link to its article.
