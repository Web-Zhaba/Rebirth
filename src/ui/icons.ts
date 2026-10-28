// Icon registry: every icon the UI uses, imported once so only these ship.
// game-icons (CC BY 3.0, Lorc, Delapouite and contributors) for world things, Phosphor (MIT) for the interface.
import type { JSX } from "preact";
import Abacus from "~icons/game-icons/abacus";
import AncientColumns from "~icons/game-icons/ancient-columns";
import AxeInLog from "~icons/game-icons/axe-in-log";
import Barn from "~icons/game-icons/barn";
import Beehive from "~icons/game-icons/beehive";
import CellarBarrels from "~icons/game-icons/cellar-barrels";
import FruitTree from "~icons/game-icons/fruit-tree";
import Mushrooms from "~icons/game-icons/mushrooms";
import Bulldozer from "~icons/game-icons/bulldozer";
import Church from "~icons/game-icons/church";
import DigHole from "~icons/game-icons/dig-hole";
import FishingPole from "~icons/game-icons/fishing-pole";
import Carrot from "~icons/game-icons/carrot";
import Deer from "~icons/game-icons/deer";
import GrainBundle from "~icons/game-icons/grain-bundle";
import HammerNails from "~icons/game-icons/hammer-nails";
import HandSaw from "~icons/game-icons/hand-saw";
import HerbsBundle from "~icons/game-icons/herbs-bundle";
import House from "~icons/game-icons/house";
import MagnifyingGlass from "~icons/game-icons/magnifying-glass";
import PathTile from "~icons/game-icons/path-tile";
import RopeBridge from "~icons/game-icons/rope-bridge";
import StoneBridge from "~icons/game-icons/stone-bridge";
import Road from "~icons/game-icons/road";
import Shop from "~icons/game-icons/shop";
import StonePile from "~icons/game-icons/stone-pile";
import Trade from "~icons/game-icons/trade";
import Wheat from "~icons/game-icons/wheat";
import Coins from "~icons/game-icons/coins";
import Jug from "~icons/game-icons/jug";
import Log from "~icons/game-icons/log";
import CampingTent from "~icons/game-icons/camping-tent";
import QuillInk from "~icons/game-icons/quill-ink";
import ScrollUnfurled from "~icons/game-icons/scroll-unfurled";
import Moon from "~icons/game-icons/moon";
import Person from "~icons/game-icons/person";
import Planks from "~icons/game-icons/planks";
import Sun from "~icons/game-icons/sun";
import SunCloud from "~icons/game-icons/sun-cloud";
import Raining from "~icons/game-icons/raining";
import Snowing from "~icons/game-icons/snowing";
import LightningStorm from "~icons/game-icons/lightning-storm";
import WindSlap from "~icons/game-icons/wind-slap";
import Tornado from "~icons/game-icons/tornado";
import Sunrise from "~icons/game-icons/sunrise";
import Sunset from "~icons/game-icons/sunset";
import StoneBlock from "~icons/game-icons/stone-block";
import Village from "~icons/game-icons/village";
import Well from "~icons/game-icons/well";
import WoodAxe from "~icons/game-icons/wood-axe";
import PhBookOpen from "~icons/ph/book-open";
import PhCloud from "~icons/ph/cloud";
import PhCaretDown from "~icons/ph/caret-down-bold";
import PhCamera from "~icons/ph/camera";
import PhCaretUp from "~icons/ph/caret-up-bold";
import PhHammer from "~icons/ph/hammer";
import PhMinus from "~icons/ph/minus-bold";
import PhPlus from "~icons/ph/plus-bold";
import PhCheck from "~icons/ph/check-bold";
import PhEraser from "~icons/ph/eraser";
import PhGear from "~icons/ph/gear";
import PhInfo from "~icons/ph/info-bold";
import PhFlag from "~icons/ph/flag-bold";
import PhLock from "~icons/ph/lock-simple-fill";
import PhFootprints from "~icons/ph/footprints";
import PhHourglass from "~icons/ph/hourglass-bold";
import PhUsers from "~icons/ph/users-three-bold";
import PhPause from "~icons/ph/pause-fill";
import PhPlay from "~icons/ph/play-fill";
import PhQuestion from "~icons/ph/question";
import PhProhibit from "~icons/ph/prohibit";
import PhSmiley from "~icons/ph/smiley";
import PhStack from "~icons/ph/stack";
import PhTrash from "~icons/ph/trash";
import PhWarning from "~icons/ph/warning";
import PhX from "~icons/ph/x-bold";
import PhSearch from "~icons/ph/magnifying-glass-bold";
import PhGpsFix from "~icons/ph/gps-fix-bold";
import PhSignpost from "~icons/ph/signpost-bold";

export type IconComponent = (props: JSX.IntrinsicElements["svg"]) => JSX.Element;

export const ICONS = {
  // Interface (Phosphor)
  close: PhX,
  check: PhCheck,
  caretDown: PhCaretDown,
  caretUp: PhCaretUp,
  warning: PhWarning,
  notebook: PhBookOpen,
  layers: PhStack,
  pause: PhPause,
  play: PhPlay,
  help: PhQuestion,
  camera: PhCamera,
  trash: PhTrash,
  eraser: PhEraser,
  layerNone: PhProhibit,
  lock: PhLock,
  traffic: PhFootprints,
  mood: PhSmiley,
  info: PhInfo,
  settings: PhGear,
  // Finding a place before founding: search, own location, old place names
  search: PhSearch,
  locate: PhGpsFix,
  placeNames: PhSignpost,
  clouds: PhCloud,
  // Inspector and town panel: priority, volunteers, waiting, the town button
  flag: PhFlag,
  build: PhHammer,
  minus: PhMinus,
  plus: PhPlus,
  crowd: PhUsers,
  hourglass: PhHourglass,
  town: Village,
  // Journal (game-icons): chronicle entry, article, founding
  quill: QuillInk,
  scroll: ScrollUnfurled,
  tent: CampingTent,
  // Top bar (game-icons): people, goods, day phases
  person: Person,
  food: Wheat,
  log: Log,
  planks: Planks,
  stone: StoneBlock,
  wares: Jug,
  value: Coins,
  morning: Sunrise,
  day: Sun,
  evening: Sunset,
  night: Moon,
  // Weather chip (game-icons)
  weatherClear: Sun,
  weatherPartly: SunCloud,
  weatherOvercast: PhCloud,
  weatherRain: Raining,
  weatherDownpour: LightningStorm,
  weatherSnow: Snowing,
  weatherBlizzard: WindSlap,
  weatherHurricane: Tornado,
  // Notebook entries (game-icons): point of interest, street, foundations
  find: MagnifyingGlass,
  street: Road,
  foundations: AncientColumns,
  // Tools (game-icons)
  path: PathTile,
  dirt: Road,
  footbridge: RopeBridge,
  bridge: StoneBridge,
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
  garden: Carrot,
  hunter: Deer,
  forager: Mushrooms,
  orchard: FruitTree,
  apiary: Beehive,
  cellar: CellarBarrels,
  barn: Barn,
  well: Well,
  market: Shop,
  chapel: Church,
  school: Abacus,
  healer: HerbsBundle,
  dig: DigHole,
} satisfies Record<string, IconComponent>;

export type IconName = keyof typeof ICONS;
