// Icon registry: every icon the UI uses, imported once so only these ship.
// game-icons (CC BY 3.0, Lorc, Delapouite and contributors) for world things, Phosphor (MIT) for the interface.
import type { JSX } from "preact";
import Abacus from "~icons/game-icons/abacus";
import AncientColumns from "~icons/game-icons/ancient-columns";
import AxeInLog from "~icons/game-icons/axe-in-log";
import Barn from "~icons/game-icons/barn";
import Bulldozer from "~icons/game-icons/bulldozer";
import Church from "~icons/game-icons/church";
import DigHole from "~icons/game-icons/dig-hole";
import FishingPole from "~icons/game-icons/fishing-pole";
import GrainBundle from "~icons/game-icons/grain-bundle";
import HammerNails from "~icons/game-icons/hammer-nails";
import HandSaw from "~icons/game-icons/hand-saw";
import HerbsBundle from "~icons/game-icons/herbs-bundle";
import House from "~icons/game-icons/house";
import MagnifyingGlass from "~icons/game-icons/magnifying-glass";
import PathTile from "~icons/game-icons/path-tile";
import Road from "~icons/game-icons/road";
import Shop from "~icons/game-icons/shop";
import StonePile from "~icons/game-icons/stone-pile";
import Trade from "~icons/game-icons/trade";
import Wheat from "~icons/game-icons/wheat";
import Well from "~icons/game-icons/well";
import WoodAxe from "~icons/game-icons/wood-axe";
import PhBookOpen from "~icons/ph/book-open";
import PhCheck from "~icons/ph/check-bold";
import PhEraser from "~icons/ph/eraser";
import PhMoonStars from "~icons/ph/moon-stars";
import PhPause from "~icons/ph/pause-fill";
import PhStack from "~icons/ph/stack";
import PhTrash from "~icons/ph/trash";
import PhWarning from "~icons/ph/warning";
import PhX from "~icons/ph/x-bold";

export type IconComponent = (props: JSX.IntrinsicElements["svg"]) => JSX.Element;

export const ICONS = {
  // Interface (Phosphor)
  close: PhX,
  check: PhCheck,
  warning: PhWarning,
  notebook: PhBookOpen,
  layers: PhStack,
  pause: PhPause,
  trash: PhTrash,
  eraser: PhEraser,
  night: PhMoonStars,
  // Notebook entries (game-icons): point of interest, street, foundations
  find: MagnifyingGlass,
  street: Road,
  foundations: AncientColumns,
  // Tools (game-icons)
  path: PathTile,
  dirt: Road,
  bulldoze: Bulldozer,
  res: House,
  craft: HammerNails,
  trade: Trade,
  field: Wheat,
  clearing: WoodAxe,
  gumno: GrainBundle,
  woodcutter: AxeInLog,
  sawpit: HandSaw,
  quarry: StonePile,
  fisher: FishingPole,
  barn: Barn,
  well: Well,
  market: Shop,
  chapel: Church,
  school: Abacus,
  healer: HerbsBundle,
  dig: DigHole,
} satisfies Record<string, IconComponent>;

export type IconName = keyof typeof ICONS;
