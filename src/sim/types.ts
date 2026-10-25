import type { Levers } from "./levers";
import type { GoalView } from "./goals";
import type { Land } from "../world/landcover";

export interface City {
  name: string;
  lat: number;
  lng: number;
  foundedAt: number; // epoch ms
}

export type RoadKind = "path" | "dirt";

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
  level: number; // 1, or 2 for an izba rebuilt after the upgrade
  streak: number; // days in a row a house met the upgrade conditions
  upgrade?: Upgrade; // the rebuild into level 2 in progress; the house stays active meanwhile
  radius?: number; // dig site: revealed radius in m (PLAN.md section 12)
  onRuins?: boolean; // started on an old foundation: no stone, less labor
  hand?: number; // person-hours of hand-made materials added to the labor when it was paid
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
  literate: boolean;
  school: number; // days of school attended (children 7-14 in the reach of a staffed school)
}

export interface Household {
  id: number;
  last: string; // masculine form of the family name
  home: number | null; // building id; null = tents at the founding point
  members: number[];
  arrived: number; // gameMinutes
  founder: boolean; // came with the founding party: never emigrates
  mood: number; // 0..100
}

export type EventKind = "birth" | "death" | "marriage" | "arrival" | "departure" | "movein" | "farm" | "food" | "clearing" | "built" | "shortage" | "order" | "goal" | "unlock" | "event";

export interface TownEvent {
  at: number; // gameMinutes
  kind: EventKind;
  text: string;
  pos?: [number, number]; // local meters; the HUD flies the map here
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
}

// A named place (kind = OSM class) or street (kind "street", no position) found by a dig.
export interface FoundPlace {
  id: string;
  name: string;
  kind: string;
  digId: number;
  at: number;
  x?: number;
  y?: number;
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

export interface Finds {
  foundations: FoundFoundation[];
  pois: FoundPlace[];
  streets: FoundPlace[];
}

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
  wares: number; // pieces
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
  rot: number; // kg of food lost to full barns since the last announcement
}

export interface ProdState {
  fields: Record<number, FieldWork>;
  flags: ProdFlags;
  today: Record<number, number>; // building id -> units made since 00:00 (kg of grain for a gumno)
  yesterday: Record<number, number>;
}

// Goals and unlocks (PLAN-pace.md section 9; sim/goals.ts holds the table).
export interface GoalsState {
  done: string[]; // goal ids paid, in the order they finished
  unlocks: string[]; // unlock keys: template ids, "zone:craft", "zone:trade", "upgrade"
  families: number; // free families owed by goals that wait for a vacant house
  notebook: boolean; // the dig goal was paid: the notebook's first article prompt is out
  feast: boolean; // the harvest goal was paid: P7 turns this into the harvest feast event
}

// A family that decided to come: the house is promised to them; the family itself is made on arrival.
export interface Incoming {
  house: number; // building id of the promised house
  arrive: number; // gameMinutes
}

// One answer to an event; `effect` states what it does, in the card's words.
export interface ChoiceOption {
  label: string;
  effect: string;
}

// An event waiting for the player's answer (PLAN-pace.md section 10; sim/events.ts holds the table).
export interface TownChoice {
  id: string; // event kind
  at: number; // gameMinutes it was put
  until: number; // gameMinutes after which it resolves with the safe option
  title: string;
  text: string;
  options: [ChoiceOption, ChoiceOption];
  safe: 0 | 1; // the option an unanswered event resolves with
  arg: number; // event-specific parameter (a household id, a variant)
  pos?: [number, number]; // local meters; the card flies the map here
}

export interface SimState extends PeopleState {
  stock: Stock;
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
  attract: number; // 0..1, how attractive the town is to newcomers; set at 00:00
  // Derived once per game day (and on load): bit i of coverage[house] is set when service i covers it.
  coverage: Record<number, number>;
  landValue: Record<number, number>; // house id -> 0..100
  summary: DaySummary | null; // «Итоги дня» of the last 22:00
  levers: Levers; // player levers (P5)
  goals: GoalsState; // goals and unlocks (P6)
  pending: TownChoice | null; // the event waiting for an answer, one at a time (P7)
  nextEvent: number; // gameMinutes from which the next event may be drawn
  eventLast: Record<string, number>; // gameMinutes each event kind was last put
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
  outlook: number; // 0..1, can the food last to the end of the next harvest window
  eveningWares: number; // pieces an hour the adults at home make at 19-22 (doubles in winter)
}

export type ServiceId = "well" | "market" | "chapel" | "school" | "healer";

export interface ServiceStats {
  houses: number; // finished houses
  covered: Record<ServiceId, number>; // houses covered per service
  literate: number; // share 0..1 of adults
  avgLandValue: number;
  level2: number; // houses of level 2
}

export interface PeopleStats {
  pop: number;
  adults: number; // 16-59
  children: number; // under 16
  employed: number; // adults with a regular job
  builders: number; // adults without a job while construction work exists
  unemployed: number; // adults without a job and without construction work
  tents: number; // households living in tents
  avgCommute: number; // minutes, over the employed
  households: number;
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
  people: PeopleStats & { demand: Demand; growth: GrowthAdvice };
  economy: EconomyStats;
  services: ServiceStats;
  houseMood: Record<number, number>; // house id -> mood of its household, for the overlay
  goalViews: GoalView[]; // the active goals with progress
  callBlock: string | null; // why a call for settlers cannot be made now, or null
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
}

export interface WorkerInfo {
  id: number;
  name: string;
  age: number;
  commute: number | null;
  idle: boolean; // counted with the construction artel (no work for them at the moment)
}

export interface ProductionInfo {
  good: keyof Stock | null; // what the building makes; null for a barn
  yesterday: number; // units made yesterday (kg of grain for a gumno)
  site?: Site;
  missing?: string; // input the workshop lacks
  storage?: number; // kg of food a barn holds
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
      service?: { id: ServiceId; reach: number; covered: number; houses: number; working: boolean };
    };

export interface SaveV4 {
  version: 4;
  city: City;
  sim: SimState;
}
