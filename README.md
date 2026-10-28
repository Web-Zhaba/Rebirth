**English** | [Русский](README.ru.md)

<div align="center">

<img src="public/rebirth-icon.svg" width="88" alt="Rebirth icon" />

# REBIRTH

### Civilization is gone. The coordinates survived.

**Rebuild anywhere on Earth. In real metres. Over the buried remains of the world that came before.**

<p>
  <strong>Real Earth</strong> ·
  <strong>Metric-scale simulation</strong> ·
  <strong>Living households</strong> ·
  <strong>Seasons</strong> ·
  <strong>Archaeology</strong>
</p>

<p>
  <a href="#build-from-source">Build from source</a> ·
  <a href="#under-the-map">Architecture</a> ·
  <a href="CREDITS.md">Open data & credits</a>
</p>

<table>
<tr>
<td align="center">
<code>GAMEPLAY PREVIEW // CAPTURE PENDING</code><br><br>
<sub>Earth → founding → settlement → winter → excavation</sub>
</td>
</tr>
</table>

</div>

---

Rebirth turns the real Earth into a city-building simulation.

Choose any point on the planet. The game projects that place into a **local metric world** and gives you a handful of families, primitive infrastructure and a simple problem:

**make this place survive.**

Roads consume labour. Houses need materials. People need jobs they can actually reach. Fields obey the seasons. Winter does not care whether your granary is ready.

And underneath the new settlement lies another city.

The one that used to be there.

## Show, don't tell

The map is not a decorative background. Geography enters the rules of the game.

<table>
<tr>
<td width="66%"><strong>🌍 Found anywhere on Earth</strong><br><br>Start from real latitude and longitude instead of choosing from handcrafted maps. Open geographic data becomes the raw material of the world.</td>
<td align="center"><code>PREVIEW PENDING</code><br><sub>globe → location → settlement</sub></td>
</tr>
<tr>
<td><strong>📐 Build in metres, not tiles</strong><br><br>Road lengths, building footprints, zoning cells, fields, walking distances and service reach live in a local metric coordinate system.</td>
<td align="center"><code>PREVIEW PENDING</code><br><sub>road → lots → buildings</sub></td>
</tr>
<tr>
<td><strong>👥 Simulate households, not population points</strong><br><br>Residents belong to families, occupy homes, take jobs, commute through the road graph, learn, age, arrive and leave.</td>
<td align="center"><code>PREVIEW PENDING</code><br><sub>home → commute → workplace</sub></td>
</tr>
<tr>
<td><strong>🌾 Race the calendar</strong><br><br>Sowing and harvest windows exist because the simulation has seasons. Agriculture competes for the same labour your settlement needs for construction and production.</td>
<td align="center"><code>PREVIEW PENDING</code><br><sub>field → harvest → winter</sub></td>
</tr>
<tr>
<td><strong>❄️ Let geography fight back</strong><br><br>Terrain, forest, water, elevation, slope and weather shape where the settlement can grow and how expensive that growth becomes.</td>
<td align="center"><code>PREVIEW PENDING</code><br><sub>terrain → weather → survival</sub></td>
</tr>
<tr>
<td><strong>⛏️ Dig through the map beneath the map</strong><br><br>Excavation uncovers foundations, streets and named places derived from the real-world geography buried beneath your new settlement.</td>
<td align="center"><code>PREVIEW PENDING</code><br><sub>dig radius → old foundations</sub></td>
</tr>
</table>

> The most important Rebirth screenshot is the one where a village built by the player and a city that once existed occupy the same coordinates.

## The world remembers

At the beginning, the old civilization is invisible.

Forest has reclaimed the ground. Modern buildings are gone. Roads have disappeared.

But the data is still there.

Build an excavation site and the settlement begins to uncover traces of the world beneath it: foundations, streets, named places and historically meaningful structures.

A discovery is not just a collectible.

Restore an old building as a monument and it becomes part of your settlement's memory. Return it to use and the past becomes infrastructure again. Heritage feeds research, and research pushes a primitive settlement toward another era.

**Progress comes partly from learning what was already here.**

## A city is a graph

Rebirth deliberately avoids several city-builder shortcuts.

A worker does not teleport to a workshop because it lies inside a circle.

A service does not reach a house because the straight-line distance is small.

The settlement has a road graph. Finished roads form traversable connections. Residents and services use that network to determine whether places are actually reachable.

That makes the shape of the city matter.

A badly connected settlement is not merely ugly.

It is badly connected.

## Time keeps moving

The simulation runs separately from the UI in a Web Worker.

Closing the tab does not reduce the city to a timestamp plus a few resource multipliers. Rebirth persists simulation state in IndexedDB and can advance the world when the player returns.

During catch-up it tracks what happened:

**births · deaths · arrivals · departures · construction · production · research · events**

Then it gives the player a summary of the time they missed.

---

## Under the map

The interesting part of Rebirth is not that it uses a map library and a 3D library.

It is the boundary between a planetary map and a local simulation.

```text
                         REAL EARTH

                  OpenStreetMap / OpenFreeMap
                             │
                        Terrarium DEM
                             │
                             ▼
                       MapLibre GL JS
                  planet / camera / terrain
                             │
                  local metric projection
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
         Three.js layers              Web Worker
      rendered settlement             simulation
              │                             │
      buildings / forest         roads / households
      water / fields             economy / farming
      ruins / weather            weather / research
              │                             │
              └──────────────┬──────────────┘
                             │
                          Preact UI
                             │
                          IndexedDB
```

### The simulation owns the rules

Game state lives outside the component tree.

The worker owns residents, households, roads, production, agriculture, weather, research, excavation, events and persistence.

The main thread receives snapshots and focused query responses.

That separation keeps the UI a view of the simulation instead of slowly turning the UI into the simulation.

### The renderer is hybrid on purpose

**MapLibre GL JS** solves planetary geography, vector maps and camera behaviour.

**Three.js** owns game-specific 3D layers: buildings, vegetation, water, fields, residents, ruins and custom effects.

Rebirth does not try to turn a cartographic engine into a game engine — or rebuild a globe renderer just to draw a village.

### Balance is executable

```bash
npm run pace
```

runs a headless settlement through the real simulation handler.

It records milestones such as the first house, first technology, first harvest, Era II and population growth.

The point is not merely test coverage.

It gives game balance something better than intuition:

**numbers.**

## Built with

| Area | Technology |
|---|---|
| **Simulation** | TypeScript · Web Worker · IndexedDB |
| **Interface** | Preact · @preact/signals |
| **Earth** | MapLibre GL JS · OpenFreeMap · OpenStreetMap |
| **3D world** | Three.js · Earcut |
| **Terrain** | Terrarium DEM / AWS Open Data |
| **Search** | Photon |
| **History** | Wikipedia / MediaWiki |
| **Audio** | Web Audio API |
| **Tooling** | Vite · Vitest |

## Build from source

Requires **Node.js 18+** and npm.

```bash
git clone https://github.com/Web-Zhaba/rebirth.git
cd rebirth
npm install
npm run dev
```

### Scripts

```bash
npm run dev       # development server
npm run build     # typecheck + production build
npm run preview   # preview production build
npm test          # test suite
npm run pace      # headless pacing simulation
```

## Controls

| Keys | Action |
|---|---|
| `Space` / `P` | Pause / resume |
| `1` `2` `3` | 1× / 2× / 4× speed |
| `H` / `Home` | Return to settlement |
| `N` | Research |
| `F1` – `F5` | Tool categories |
| `Q` – `Y` | Select tool |
| `B` | Demolition |
| `Esc` / Right click | Cancel / close |
| `Enter` | Safe event choice |
| `?` | Hotkey reference |

## Open data

Rebirth could not exist without open geographic and cultural data.

🌍 **Map data:** © OpenStreetMap contributors, ODbL  
🗺️ **Vector tiles:** OpenFreeMap / OpenMapTiles schema  
⛰️ **Terrain:** Mapzen / AWS Open Data Terrain Tiles  
🔎 **Place search:** Photon by komoot  
📚 **Article extracts:** Wikipedia, CC BY-SA 4.0  
🎨 **Icons:** game-icons.net and Phosphor Icons  
🔤 **Fonts:** PT Serif and PT Sans  
🧭 **Map renderer:** MapLibre GL JS

See [`CREDITS.md`](CREDITS.md) for the full attribution list.

## License

Rebirth is open source under the **Apache License 2.0**.

See [`LICENSE`](LICENSE).

---

<div align="center">

### Build on the Earth. Dig into what came before.

</div>
