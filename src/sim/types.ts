import type { JobGroup, Materials } from "./buildings";
import type { Levers } from "./levers";
import type { DomainId } from "./domains";
import type { Land } from "../world/landcover";
import type { WeatherState } from "./weather";
import type { OrchardYear } from "./weatherEffects";
import type { Attraction } from "./attraction";

export interface City {
  name: string;
  lat: number;
  lng: number;
  foundedAt: number; // epoch ms
}

export type RoadKind = "path" | "dirt" | "footbridge" | "bridge" | "stone" | "stonebridge";

// Coordinates are local meters (src/world/frame.ts), x east, y north.
export interface RoadNode {
  id: number;
  x: number;
  y: number;
}

export interface RoadEdge {
  id: number;
  a: number; // node ids
  b: number;
  kind: RoadKind;
  length: number; // m
  labor: number; // person-hours to build
  done: number; // person-hours spent; built when done >= labor
  stone?: number; // t of stone still owed to the stock; taken when work starts, then gone
  upgrade?: RoadUpgrade; // a built edge being rebuilt as a better kind; it serves as it is until that is done
}

// The rebuilding of a built edge as `kind` (sim/roads.ts upgradeRoads): its own person-hours and stone.
export interface RoadUpgrade {
  kind: RoadKind;
  labor: number;
  done: number;
  stone?: number; // t still owed; taken when the work starts
}

export interface RoadGraph {
  nodes: Record<number, RoadNode>;
  edges: Record<number, RoadEdge>;
  nextId: number; // shared id counter for nodes and edges
}

export type ZoneType = "res" | "craft" | "trade";
export type ZoneBlock = "road" | "overlap" | "field" | "water" | "steep" | "pending";

// One 8 x 8 m lot beside a road edge (see sim/zones.ts for the geometry).
export interface ZoneCell {
  key: string; // `${edge}:${side}:${i}:${depth}`
  edge: number;
  side: 1 | -1; // +1 left of a -> b, -1 right
  i: number;
  depth: number; // 0..3
  cx: number;
  cy: number;
  angle: number; // direction of the road, radians
  zone: "none" | ZoneType;
  block: ZoneBlock | null;
}

export interface Field {
  id: number;
  pts: [number, number][]; // counter-clockwise
  area: number; // m2
}

// Forest being cleared by the artel; its land becomes meadow once `done` reaches `labor`.
export interface Clearing {
  id: number;
  pts: [number, number][]; // counter-clockwise
  area: number; // m2
  forest: number; // share 0..1 of the area that was forest when it was marked
  labor: number; // person-hours
  done: number;
}

export interface TerrainInfo {
  land: Land;
  slope: number; // degrees
}

export interface ZoneState {
  cells: ZoneCell[];
  fields: Field[];
  terrain: Record<string, TerrainInfo>; // keyed by qkey (4 m grid)
  rev: number; // bumped on every change of cells, fields or terrain
}

export type BuildingState = "planned" | "building" | "active";

export interface Building {
  id: number;
  template: string; // key of BUILDINGS
  zone: ZoneType | "placed"; // "placed": put down by the player, not grown on a zone
  // Local meters; centre of the lot rectangle, angle = road direction.
  lot: { cx: number; cy: number; angle: number; w: number; d: number };
  side: 1 | -1; // side of the road, as in ZoneCell
  footprint: [number, number][]; // 4 corners, counter-clockwise
  height: number; // m
  state: BuildingState;
  labor: number; // person-hours
  done: number;
  created: number; // gameMinutes
  paid: boolean; // materials taken from the stock (done when construction starts)
  site?: Site; // terrain shares measured when a placed building was put down
  level: number; // a house's families (its level); on an old foundation the floors built
  streak: number; // days in a row a house met the upgrade conditions
  upgrade?: Upgrade; // the next level (or floor) in progress; the building stays active meanwhile
  radius?: number; // dig site: revealed radius in m (PLAN.md section 12)
  staff?: number; // hiring limit of a workplace, 0..jobs; absent = all jobs
  hand?: number; // person-hours of hand-made materials added to the labor when it was paid
  haul?: number; // person-hours of carting its materials from the stores, added to the labor when it was paid
  ripe?: number; // orchard: gameMinutes from which the trees bear (a year after it was finished)
  door?: [number, number]; // point of the ring nearest to the road: where services, jobs and walks reach the building
  materials?: Materials; // cost by area, instead of the template's
  // A building on an old foundation (sim/foundationLots.ts, docs/PLAN-restoration.md section 2): the footprint is the
  // simplified ring (3..64 points), the lot its oriented box.
  foundationId?: string;
  scale?: number; // the ring's area against the template's footprint; times the floors built it is the floor area
  floors?: number; // floors the old building had (from the tile height); `level` counts those built so far
  asItWas?: true; // the purpose matches the foundation's known old kind: a restoration in full (sim/restore.ts)
  landmark?: true; // a unique old building restored as it was: it works as a monument too
  restoreWeight?: number; // what it added to progress.restored when it was finished; taken back on demolition
  exhibits?: (string | null)[]; // a museum: the theme each hall shows (sim/museum.ts)
}

// Work on a finished house: labor and materials are taken like those of a new building.
export interface Upgrade {
  labor: number; // person-hours
  done: number;
  paid: boolean;
}

// Shares 0..1 of forest, water and rock/sand around a placed building.
export interface Site {
  forest: number;
  water: number;
  rock: number;
}

// Personal needs, 0..100 each (src/sim/needs.ts): a satisfied need is 100, an empty one 0.
export interface Needs {
  food: number; // satiety: falls when the barns cannot feed the town
  rest: number; // sleep and recovery: falls with long work, tents and cold
  social: number; // company: family, evenings, a tavern or a chapel, the market
  warmth: number; // a heated home: falls when the household has no firewood
}

export interface Resident {
  id: number;
  first: string;
  last: string; // personal form (feminine for women)
  sex: "m" | "f";
  born: number; // gameMinutes, may be negative
  household: number;
  spouse: number | null;
  job: number | null; // building id of the workplace
  commute: number | null; // minutes one way
  idleDays: number; // days in a row without any work
  literate: boolean; // learned in full (school reached 100)
  school: number; // literacy progress 0..100: grows on school days, see learnPerDay
  inClass?: boolean; // in class today: children 7-14 and, when ordered, illiterate grown-ups; they do no work
  needs?: Needs; // absent in saves from before the needs system: treated as full
}

export interface Household {
  id: number;
  last: string; // masculine form of the family name
  home: number | null; // building id; null = tents at the founding point
  members: number[];
  arrived: number; // gameMinutes
  founder: boolean; // came with the founding party: never emigrates
  mood: number; // 0..100
  cold?: true; // no firewood at the last midnight: mood target down, death rate up (weather only)
  served?: number; // share of its goods the household got at the last midnight, 0..1 (none yet: not counted)
}

export type EventKind = "birth" | "death" | "marriage" | "arrival" | "departure" | "movein" | "farm" | "food" | "clearing" | "built" | "shortage" | "order" | "goal" | "unlock" | "tech" | "era" | "heritage" | "discovery"; // goal and unlock are no longer made: old saves still carry them

export interface TownEvent {
  at: number; // gameMinutes
  kind: EventKind;
  text: string;
  pos?: [number, number]; // local meters; the HUD flies the map here
  site?: string; // a discovery: the foundation whose panel opens
}

// Notable moments kept forever (PLAN.md section 11); `kind` is a machine key, `text` the Russian line.
export interface ChronicleEntry {
  at: number; // gameMinutes
  kind: string;
  text: string;
}

// Excavation finds (PLAN.md section 12); coordinates are local meters.
export interface FoundFoundation {
  id: string;
  ring: [number, number][];
  area: number; // m2
  digId: number;
  at: number; // gameMinutes
  cls?: string; // kind of a notable old building (heritage.ts), from a POI inside the ring
  name?: string;
  height?: number; // m
  state?: FoundState; // absent = untouched; set once a building "as it was" is ordered on it
  ghost?: true; // surveyed, not dug yet: only its outline is known (sim/digging.ts); saves before the survey have none
}

// "lost": the restored building was demolished; the site can never be restored again.
export type FoundState = "restoring" | "restored" | "lost";

// A named place (kind = OSM class) or street (kind "street", no position) found by a dig.
export interface FoundPlace {
  id: string;
  name: string;
  kind: string;
  digId: number;
  at: number;
  x?: number;
  y?: number;
  lines?: [number, number][][]; // a street: its pieces in the revealed area (local metres)
  restored?: number; // a street: gameMinutes when it was restored in full and got its name back (sim/streets.ts)
}

// A Wikipedia article unlocked by a dig (PLAN.md section 13). Text is CC BY-SA 4.0.
export interface StoredArticle {
  id: string; // "<lang>:<pageid>"
  title: string;
  extract: string; // up to 800 chars
  url: string;
  lang: "ru" | "en";
  lat: number;
  lng: number;
  at: number; // gameMinutes
}

// The disc of a dig site that is gone (demolished or finished): its finds stay revealed.
export interface RevealedSite {
  digId: number;
  x: number;
  y: number;
  r: number; // m
}

export interface Finds {
  foundations: FoundFoundation[];
  pois: FoundPlace[];
  streets: FoundPlace[];
  revealed: RevealedSite[];
  features: FoundFeature[]; // real features that give finds (sim/items.ts); saves before them have none
  fates: Record<string, FindFate>; // find id -> what the player did with it
}

// A real feature of the tile data that gives one find (docs/PLAN-restoration.md section 6): a garden (seeds), an
// industrial ground (machine parts), a railway (rails), a well (bucket), a house number (counted per street, no item), or
// a named place beyond the revealed discs (a sign that points to it).
export type FeatureKind = "seeds" | "parts" | "rails" | "bucket" | "number" | "sign";
export interface FoundFeature {
  id: string;
  kind: FeatureKind;
  x: number; // local metres
  y: number;
  digId: number;
  name?: string; // a sign's place name, a house number
  cls?: string; // a sign's POI class
}
export type FindFate = "returned" | "used";

// A finished dig site as the snapshot shows it.
export interface DigInfo {
  id: number;
  x: number;
  y: number;
  r: number; // revealed radius, m
  foundations: number;
  pois: number;
  streets: number;
}

export interface PeopleState {
  residents: Record<number, Resident>;
  households: Record<number, Household>;
  nextPersonId: number;
  nextHouseholdId: number;
  events: TownEvent[]; // ring buffer, last 50
}

export interface Stock {
  food: number; // kg of grain equivalent
  logs: number; // m3
  planks: number; // m3
  stone: number; // t
  // goods, pieces (sim/goods.ts)
  clothes: number;
  dishes: number;
  furniture: number;
  tools: number;
}

// A field's progress in one year (rye is sown in spring and reaped in autumn of the same year).
export interface FieldWork {
  year: number;
  sowH: number; // person-hours of sowing done
  harvH: number; // person-hours of harvest done
  reaped: number; // kg
}

export interface ProdFlags {
  year: number; // year the four event flags below belong to
  sowing: boolean; // "sowing started" was announced
  harvest: boolean;
  done: boolean;
  closed: boolean; // harvest window already settled (lost grain announced)
  hungry: boolean; // food ran out and no recovery since
  starving?: boolean; // at least one resident reached the starvation line since the last recovery
  rot: number; // kg of food lost to full barns since the last announcement
}

export interface ProdState {
  fields: Record<number, FieldWork>;
  flags: ProdFlags;
  today: Record<number, number>; // building id -> units made since 00:00 (kg of grain for a gumno)
  yesterday: Record<number, number>;
  orchard: OrchardYear; // what this year has done to the fruit trees (frost at the blossom, drought, heat)
  trade?: { give: keyof Stock; get: keyof Stock; gave: number; got: number }; // what the markets swapped in the day that ended; absent when nothing moved
  haul?: Record<number, number>; // producer id -> share of its work hours that went to carting at the last work tick (sim/storage.ts)
}

// Research and eras (PLAN-research.ru.md section 4; sim/tech.ts holds the tree, sim/research.ts the rules).
export interface ProgressState {
  era: number; // 1..2
  techs: string[]; // researched, in the order they finished
  research: { active: { techId: string; done: number } | null; queue: string[] }; // done: days of work so far; queue holds at most 3
  insights: string[]; // received and not yet used up (a tech insight goes when its tech is researched)
  restored: Partial<Record<DomainId, number>>; // weighted sum of restored old buildings per domain
  seeds?: number; // old seeds put to use: each raises field yield (sim/items.ts)
  exhibits?: Partial<Record<DomainId, number>>; // research weight of the complete museum exhibitions, set daily (sim/museum.ts)
  museumPull?: number; // attraction share the complete exhibitions add, set daily
  recognised?: Record<number, number>; // dig id -> recognisability steps granted, 1..4 (sim/recognition.ts)
}

// The research as the main thread shows it.
export interface ResearchView {
  active: { techId: string; share: number; etaMinutes: number } | null; // share 0..1 of the work, eta in game minutes at the current speed
  queue: string[];
  speeds: Record<DomainId, number>; // research speed per domain, 1..2
  era: number;
  eraTwoMet: boolean; // the conditions of era II hold
}

// A family that decided to come: the house is promised to them; the family itself is made on arrival.
export interface Incoming {
  house: number; // building id of the promised house
  arrive: number; // gameMinutes
}

export interface SimState extends PeopleState {
  stock: Stock; // the town's total; what lies where is in `stores`
  stores: Record<number, Partial<Stock>>; // store id (0 = the camp, else a finished barn, cellar, yard or warehouse) -> its contents (sim/storage.ts)
  prod: ProdState;
  realTime: number; // epoch ms simulated up to
  gameMinutes: number; // since founding
  roads: RoadGraph;
  zones: ZoneState;
  chronicle: ChronicleEntry[]; // oldest first, capped at 1000
  finds: Finds;
  articles: StoredArticle[]; // oldest first, capped at 500
  buildings: Record<number, Building>;
  clearings: Clearing[]; // finished ones stay as cleared land
  nextBuildingId: number;
  rng: number; // uint32 state of the growth generator
  lastSpawn: Record<ZoneType, number>; // gameMinutes of the last new building per zone
  incoming: Incoming[]; // families on their way, by arrival time
  attraction: Attraction; // how attractive the town is to newcomers and why (sim/attraction.ts); set at 00:00
  // Derived once per game day (and on load): bit i of coverage[house] is set when service i covers it.
  coverage: Record<number, number>;
  landValue: Record<number, number>; // house id -> 0..100
  summary: DaySummary | null; // «Итоги дня» of the last 22:00
  levers: Levers; // player levers (P5)
  progress: ProgressState; // researched techs, the research under way, eras
  weather: WeatherState; // climate at the town (PLAN-weather.md)
}

// One line of the day summary; `pos` (local meters) is where the HUD flies the map when it is clicked.
export interface SummaryLine {
  kind: "built" | "arrived" | "born" | "made" | "problem";
  text: string;
  pos?: [number, number];
}

export interface DaySummary {
  at: number; // gameMinutes of the 22:00 it was assembled
  lines: SummaryLine[];
}

export type Window = "sowing" | "harvest" | null;

export interface EconomyStats {
  foodCap: number;
  foodPerDay: number;
  foodDays: number; // Infinity is sent as 999
  yesterday: Stock; // production per good (food includes the harvest)
  fields: { count: number; ha: number; assignedHa: number; sown: number; reaped: number; expected: number; window: Window };
  avgMood: number;
  forage: number; // kg of food a day the idle adults gather
  brushwood: number; // m3 of firewood a day the idle adults gather (only while the town is short of fuel)
  outlook: number; // 0..1, can the food last to the end of the next harvest window
  eveningWares: number; // pieces of clothing an hour the adults at home make at 19-22 (doubles in winter)
  trade?: ProdState["trade"]; // what the markets swapped yesterday
  fieldWork: number; // share of the field work the weather allows right now (1 = calm)
  buildFactor: number; // share of the artel's hours the weather allows right now
  firewood: number; // m3 a day the households burn at today's cold
  unheated: { households: number; people: number }; // without firewood since the last midnight
  admin: { pop: number; capacity: number; factor: number }; // residents, what the offices manage, the work rate it leaves (sim/governance.ts)
}

export type ServiceId = "well" | "market" | "chapel" | "school" | "healer";

export interface ServiceStats {
  houses: number; // finished houses
  covered: Record<ServiceId, number>; // houses covered per service
  pupils: number; // residents in class today (children 7-14, and grown-ups if ordered), within the seats
  seats: number; // seats of the active schools, all of them together
  literate: number; // share 0..1 of adults
  avgLandValue: number;
  level2: number; // houses of level 2
}

// Aggregated condition of the residents, as the town panel and the top bar show it.
export interface NeedsStats {
  avg: Needs;
  starving: number; // residents with food below the warning line
  tired: number;
  lonely: number;
  freezing: number;
  work: number; // 0..1, average productivity from needs and mood
}

export interface PeopleStats {
  pop: number;
  adults: number; // 16-59
  children: number; // under 16
  employed: number; // adults with a regular job
  builders: number; // adults without a job while construction work exists
  unemployed: number; // adults without a job and without construction work
  inClass: number; // adults sent to school: no work at all
  tents: number; // households living in tents
  avgCommute: number; // minutes, over the employed
  households: number;
  needs: NeedsStats; // hunger, rest, company and warmth of the residents
}

// One job group in the work report: places are the capacity left by priority and staff limits.
export interface JobGroupRow {
  key: JobGroup;
  workers: number;
  places: number; // hiring capacity now
  open: number; // places without a worker
  closedByPriority: number; // jobs lost to priority «нет»
  closedByStaff: number; // jobs lost to staff limits
}

export interface JobReport {
  groups: JobGroupRow[];
  adults: number;
  jobless: number; // adults with no regular job
  tentAdults: number; // adults of households in tents (they get no jobs)
  construction: boolean; // is there construction work
  floor: number; // builders the construction priority guarantees
  drafted: number; // of them, taken from jobs
}

export interface Demand {
  res: number;
  craft: number;
  trade: number;
}

// Why a zone type is (not) growing, see growthAdvice in growth.ts.
export type GrowthWhy = "ok" | "nozone" | "demand" | "lots" | "hands" | "materials";
export type GrowthAdvice = Record<ZoneType, GrowthWhy>;

// What the worker streams every tick: no individual residents, only aggregates.
// Zones, the chronicle, finds and articles travel separately, only when they changed.
export type SimSnapshot = Omit<SimState, "zones" | "chronicle" | "residents" | "households" | "nextPersonId" | "nextHouseholdId" | "prod" | "finds" | "articles"> & {
  digs: DigInfo[]; // finished dig sites with their discs and find counts
  people: PeopleStats & { demand: Demand; growth: GrowthAdvice; jobs: JobReport };
  economy: EconomyStats;
  services: ServiceStats;
  houseMood: Record<number, number>; // house id -> mood of its household, for the overlay
  houseGoods: Record<number, number>; // house id -> least share of its goods a family got at the last midnight (houses served at least once)
  houseResidents: Record<number, number>; // house id -> residents, compact input for service placement previews
  research: ResearchView;
  fieldProgress: Record<number, { sown: number; harv: number }>; // field id -> share of its area sown / harvested this year (steps of 0.02), for the 3D fields
  heritageMul: number; // scarcity multiplier of the next restoration, 1..3
  callBlock: string | null; // why a call for settlers cannot be made now, or null
  inflow: { free: number; perDay: number }; // free homes and the families a day the town draws now (sim/attraction.ts)
};

// What the main thread keeps.
export type ClientState = SimSnapshot & { zones: ZoneState; chronicle: ChronicleEntry[]; finds: Finds; articles: StoredArticle[] };

export interface ClientSave {
  version: 4;
  city: City;
  sim: ClientState;
}

export interface PersonInfo {
  id: number;
  name: string;
  age: number;
  sex: "m" | "f";
  role: string; // occupation text
  literate: boolean;
  learn: number; // literacy progress 0..100
  needs?: Needs; // absent only for residents of old saves before their first day
  problems?: string[]; // what is short today: "голод", "усталость", "одиночество", "холод"
  mood?: number; // mood of the household, 0..100
  work?: number; // 0..1, personal productivity from needs and household mood
}

export interface WorkerInfo {
  id: number;
  name: string;
  age: number;
  commute: number | null;
  idle: boolean; // counted with the construction artel (no work for them at the moment)
  needs?: Needs;
  problems?: string[];
  mood?: number;
  work?: number; // 0..1, personal productivity
}

// One resident, fetched for the follow mode (the map camera can stay on a person).
export interface ResidentQuery {
  kind: "resident";
  id: number;
  name: string;
  age: number;
  sex: "m" | "f";
  role: string;
  home: number | null;
  job: number | null;
  commute: number | null;
  idle: boolean; // their workplace is idle and they are with the construction artel
  needs?: Needs;
  problems?: string[];
  mood?: number; // mood of the household
  work?: number; // 0..1, personal productivity
}

export interface ProductionInfo {
  good: keyof Stock | null; // what the building makes; null for a barn
  yesterday: number; // units made yesterday (kg of grain for a gumno)
  site?: Site;
  missing?: string; // input the workshop lacks
  storage?: number; // kg of food a barn or cellar holds
  store?: { held: Partial<Stock>; room: Partial<Record<"food" | "wood" | "stone" | "goods", number>> }; // a store: what it holds and its room per group
  haul?: { metres: number; share: number }; // a producer: road metres to the store it carts to, share of its hours the carting takes
  full?: boolean; // a producer: no store has room for its output
  orchard?: { ripeDays: number; quality: number }; // days until the trees bear (0 = they do); share of the full yield this year allows
  fields?: { count: number; ha: number; sown: number; reaped: number; expected: number };
}

export type BuildingQuery =
  | {
      kind: "house";
      households: { id: number; last: string; mood: number; people: PersonInfo[] }[];
      level: number;
      landValue: number;
      services: ServiceId[]; // covering this house
      upgrading: boolean;
    }
  | {
      kind: "workplace";
      capacity: number;
      workers: WorkerInfo[];
      production?: ProductionInfo;
      service?: { id: ServiceId; reach: number; covered: number; houses: number; pupils: number; seats: number; working: boolean };
    };

export interface SaveV4 {
  version: 4;
  city: City;
  sim: SimState;
}
