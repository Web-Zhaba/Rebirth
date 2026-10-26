import { DAYS_PER_SEASON, DAY_MIN, START_MINUTE_OF_DAY, YEAR_MIN, YEAR_SCALE, dayOf } from "./time";
import type { SimState } from "./types";

// Deterministic climate model (design: PLAN-weather.md). Pure: the same inputs give the same outputs.

export interface Weather {
  temp: number; // °C at the site
  cloud: number; // 0..1
  precip: number; // mm/h
  snow: boolean;
  wind: number; // m/s
}

export interface WeatherSite {
  lat: number;
  lng: number;
  elev: number; // m
  seed: number; // uint32
  phase: number; // year epoch shift: 0 north, 0.5 south
}

export interface DayStats {
  min: number;
  max: number;
  rain: number; // mm over the day
}

export interface WeatherState {
  site: WeatherSite | null; // null: calm (tests, saves without it)
  now: Weather;
  soil: number; // 0..1
  snowpack: number; // m
  frozen: number; // 0..1
  ice: number; // 0..1
  gdd: number; // growing degree-days (base 5 °C, real-year scale) since the first day of the year
  stress: number; // summed daily drought stress while the crop grows
  stressDays: number;
  frost: number; // 1 = untouched; lowered by applyFrost
  crop: number; // yield potential 0..1.2; follows the season until the harvest window opens, then stays
  day: DayStats;
  yesterday: DayStats;
}

// Every constant of the model in one place.
export const TUNING = {
  seaTemp: 27, // °C annual mean at the equator
  tempSin2: 22, // mean drops by this * sin^2(lat) ...
  tempSin4: 14, // ... plus this * sin^4(lat)
  ampMax: 15, // seasonal half-amplitude at the pole (* |sin lat|^1.2)
  seasonLag: 0.08, // year fraction after the solstice
  lapse: 6.5, // °C per km
  swingBase: 3,
  swingDry: 5,
  anomaly: 3.6, // °C sigma of the front anomaly in mid-latitudes
  windDeg: 14, // westerlies, degrees of longitude per game day
  tradeDeg: -6,
  layerDays: 6, // advected noise layers are cross-faded with this period (bounds the shear)
  layers: 3, // number of staggered layers
  windFrom: 0, // |lat| where the trade easterlies start to give way to the westerlies ...
  windTo: 65, // ... and where the westerlies are complete
  noiseStd: 0.16, // std of the raw fbm
  cloudBias: 3, // wetness pushes the cloud noise
  polarCloud: 0.3, // extra wetness-equivalent of the cloud push at the poles
  cloudRef: 0.52, // wetness at which the push is zero
  precipMax: 1.3, // mm/h scale
  soilPerMm: 0.005,
  evap: 0.00016, // soil per °C-hour on a clear sky, scaled by (0.25 + 0.75 soil)
  drain: 0.01, // per hour of the excess above drainFrom
  drainFrom: 0.7,
  snowPerMm: 0.0060, // m of settled snow per mm of water: fresh snow is 0.01, but a winter of 8 game days has no time to pile up like 90 real ones (compression of accumulation, melt stays real-time)
  melt: 0.004, // m per °C-hour
  freezeRate: 0.0025,
  iceRate: 0.0015,
  iceMelt: 0.003,
  gddBase: 5,
  gddRef: 1600,
  waterLoss: 0.85,
  stressSoil: 0.35,
  warmDay: 10, // °C day mean from which drought stress counts
  spinUpDays: 24,
  spinUpStepMin: 30,
  tickMin: 10, // BASE_TICK of clock.ts
};

const RAD = Math.PI / 180;
const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const sstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mod = (a: number, n: number) => ((a % n) + n) % n;

export const CALM: Weather = { temp: 12, cloud: 0, precip: 0, snow: false, wind: 2 };

export const emptyWeather = (): WeatherState => ({
  site: null,
  now: CALM,
  soil: 0.5,
  snowpack: 0,
  frozen: 0,
  ice: 0,
  gdd: 0,
  stress: 0,
  stressDays: 0,
  frost: 1,
  crop: 1,
  day: { min: CALM.temp, max: CALM.temp, rain: 0 },
  yesterday: { min: CALM.temp, max: CALM.temp, rain: 0 },
});

// Fraction of the year since the (local) spring equinox of the northern hemisphere shifted by `phase`.
export const yearFrac = (t: number, phase: number): number => mod((t + START_MINUTE_OF_DAY) / YEAR_MIN + phase, 1);

// ---------- noise ----------

function hash(ix: number, iy: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 0x1f1f1f1f) ^ Math.imul(iy, 0x2c9277b5) ^ Math.imul(iz, 0x6b43a9b5) ^ seed) | 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = sstep(0, 1, x - ix);
  const fy = sstep(0, 1, y - iy);
  const fz = sstep(0, 1, z - iz);
  const h = (dx: number, dy: number, dz: number) => hash(ix + dx, iy + dy, iz + dz, seed);
  const x00 = h(0, 0, 0) * (1 - fx) + h(1, 0, 0) * fx;
  const x10 = h(0, 1, 0) * (1 - fx) + h(1, 1, 0) * fx;
  const x01 = h(0, 0, 1) * (1 - fx) + h(1, 0, 1) * fx;
  const x11 = h(0, 1, 1) * (1 - fx) + h(1, 1, 1) * fx;
  return (x00 * (1 - fy) + x10 * fy) * (1 - fz) + (x01 * (1 - fy) + x11 * fy) * fz;
}

// Two big octaves (about 3000 km) and one small (about 800 km) on the unit sphere, 0..1.
function fbm(lng: number, lat: number, seed: number): number {
  const cl = Math.cos(lat * RAD);
  const x = cl * Math.cos(lng * RAD);
  const y = cl * Math.sin(lng * RAD);
  const z = Math.sin(lat * RAD);
  const a = valueNoise(x * 2.2, y * 2.2, z * 2.2, seed);
  const b = valueNoise(x * 4.4, y * 4.4, z * 4.4, seed ^ 0x51ed27);
  const c = valueNoise(x * 8, y * 8, z * 8, seed ^ 0x2545f49);
  return (a + 0.5 * b + 0.4 * c) / 1.9;
}

// Zonal wind, degrees of longitude per game day (eastward positive).
const zonal = (lat: number) => TUNING.tradeDeg + (TUNING.windDeg - TUNING.tradeDeg) * sstep(TUNING.windFrom, TUNING.windTo, Math.abs(lat));

// Standardised (about unit sigma) noise advected by the wind. Several staggered layers with different seeds are
// cross-faded so that the shear between latitude bands never builds up beyond `layerDays`.
function field(lng: number, lat: number, days: number, seed: number, ch: number): number {
  const P = TUNING.layerDays;
  const u = zonal(lat);
  let sum = 0;
  let norm = 0;
  for (let k = 0; k < TUNING.layers; k++) {
    const shifted = days + (k * P) / TUNING.layers;
    const epoch = Math.floor(shifted / P);
    const tau = shifted - epoch * P;
    const w = Math.sin((Math.PI * tau) / P);
    const s = (seed + Math.imul(ch + 1, 7919) + Math.imul(k, 104729) + Math.imul(epoch, 15485863)) | 0;
    sum += w * (fbm(lng - u * tau, lat, s) - 0.5);
    norm += w * w;
  }
  return sum / Math.sqrt(norm) / TUNING.noiseStd;
}

// ---------- climate ----------

export interface Climate {
  mean: number; // °C, daily mean at the elevation, no weather
  wet: number; // 0..1
  swing: number; // °C half-amplitude of the daily cycle on a dry clear day
}

export function climate(lat: number, elev: number, frac: number): Climate {
  const sl = Math.sin(lat * RAD);
  const s2 = sl * sl;
  const T = TUNING;
  const t0 = T.seaTemp - T.tempSin2 * s2 - T.tempSin4 * s2 * s2;
  const amp = T.ampMax * Math.abs(sl) ** 1.2 * Math.sign(sl);
  const wet = wetness(lat, frac);
  return {
    mean: t0 + amp * Math.sin(TAU * (frac - T.seasonLag)) - (T.lapse * elev) / 1000,
    wet,
    swing: T.swingBase + T.swingDry * (1 - wet),
  };
}

function wetness(lat: number, frac: number): number {
  const itcz = Math.exp(-(((lat - 8 * Math.sin(TAU * frac)) / 12) ** 2));
  const mid = Math.exp(-(((Math.abs(lat) - 50) / 16) ** 2));
  return clamp(0.12 + 0.75 * itcz + 0.55 * mid, 0, 1);
}

// ---------- weather ----------

const DAY_H = 24;

export function cloudField(lng: number, lat: number, t: number, seed: number, phase: number): { cloud: number; precip: number } {
  const days = t / DAY_MIN;
  const wet = wetness(lat, yearFrac(t, phase));
  // the polar caps are dry but not clear: a floor of cloud keeps them between the highs and the storm tracks
  const polar = TUNING.polarCloud * sstep(55, 80, Math.abs(lat));
  const cloud = sstep(-1.1, 1.1, field(lng, lat, days, seed, 1) + TUNING.cloudBias * (wet + polar - TUNING.cloudRef));
  if (cloud <= 0.6 || wet <= 0.3) return { cloud, precip: 0 };
  const core = (cloud - 0.6) / 0.4;
  const burst = sstep(-1.2, 1.4, field(lng, lat, days, seed, 2));
  return { cloud, precip: TUNING.precipMax * core ** 1.3 * burst * (0.4 + wet) };
}

// Daily shape -1..1: minimum at 05:00, maximum at 15:00.
function dailyShape(hour: number): number {
  if (hour >= 5 && hour < 15) return -Math.cos(((hour - 5) / 10) * Math.PI);
  const x = hour >= 15 ? hour - 15 : hour + 9;
  return Math.cos((x / 14) * Math.PI);
}

export function weatherAt(site: WeatherSite, t: number): Weather {
  const frac = yearFrac(t, site.phase);
  const days = t / DAY_MIN;
  const cl = climate(site.lat, site.elev, frac);
  const { cloud, precip } = cloudField(site.lng, site.lat, t, site.seed, site.phase);
  const a = Math.abs(site.lat);
  const mid = 0.25 + 0.75 * Math.exp(-(((a - 50) / 30) ** 2));
  const anomaly = TUNING.anomaly * mid * field(site.lng, site.lat, days, site.seed, 3);
  const hour = mod(t + START_MINUTE_OF_DAY, DAY_MIN) / 60;
  const swing = cl.swing * (1 - 0.6 * cloud) * (1 - 0.3 * Math.min(1, precip));
  const temp = cl.mean + anomaly + swing * dailyShape(hour);
  const base = 3 + 4 * Math.exp(-(((a - 50) / 25) ** 2));
  const wind = Math.max(0, base * (1 + 0.55 * field(site.lng, site.lat, days, site.seed, 4)) + 10 * Math.max(0, cloud - 0.6));
  return { temp, cloud, precip, snow: precip > 0 && temp < 0.5, wind };
}

// Unit vector from the Earth's centre to the subsolar point: x to (0°E, 0°N), y to 90°E, z north.
// At game 12:00 the sun is over longitude 0 and moves west 15° per hour.
export function sunDirection(t: number, phase: number): [number, number, number] {
  const dec = 23.44 * RAD * Math.sin(TAU * yearFrac(t, phase));
  const hour = mod(t + START_MINUTE_OF_DAY, DAY_MIN) / 60;
  const lng = -(hour - 12) * 15 * RAD;
  return [Math.cos(dec) * Math.cos(lng), Math.cos(dec) * Math.sin(lng), Math.sin(dec)];
}

// ---------- state ----------

const heatOf = (gdd: number) => (gdd <= TUNING.gddRef ? gdd / TUNING.gddRef : Math.min(1.1, 1 + (gdd - TUNING.gddRef) / 8000));
const gddOfMean = (mean: number) => (Math.max(0, mean - TUNING.gddBase) / YEAR_SCALE);
const HARVEST_START_DAY = 2 * DAYS_PER_SEASON; // 0-based day of the year on which the harvest window opens

// Yield potential: the degree-days so far plus the normal ones to the harvest, water stress, frost.
function cropOf(ws: WeatherState, dayOfYear0: number): number {
  const site = ws.site!;
  let proj = ws.gdd;
  for (let d = dayOfYear0 + 1; d < HARVEST_START_DAY; d++) proj += gddOfMean(climate(site.lat, site.elev, mod(d / (4 * DAYS_PER_SEASON) + site.phase, 1)).mean);
  const water = 1 - TUNING.waterLoss * (ws.stress / Math.max(1, ws.stressDays));
  return clamp(heatOf(proj) * water * ws.frost, 0, 1.2);
}

const dayOfYear0 = (t: number) => mod(dayOf(t), 4 * DAYS_PER_SEASON);

// Advances the state to time `t` (the end of a step of `dtMin` minutes).
function advance(ws: WeatherState, t: number, dtMin: number): WeatherState {
  const site = ws.site!;
  const T = TUNING;
  const now = weatherAt(site, t);
  const h = dtMin / 60;
  let { soil, snowpack, frozen, ice, gdd, stress, stressDays, frost, crop, day, yesterday } = ws;

  if (dayOf(t) !== dayOf(t - dtMin)) {
    yesterday = day;
    day = { min: now.temp, max: now.temp, rain: 0 };
    const doy = dayOfYear0(t);
    if ((yesterday.min + yesterday.max) / 2 > T.warmDay && doy < HARVEST_START_DAY + DAYS_PER_SEASON / 2) {
      stress += Math.max(0, 1 - soil / T.stressSoil);
      stressDays++;
    }
    if (doy === 0) {
      gdd = 0;
      stress = 0;
      stressDays = 0;
      frost = 1;
    }
    if (doy < HARVEST_START_DAY) crop = cropOf({ ...ws, gdd, stress, stressDays, frost, soil }, doy);
  } else day = { min: Math.min(day.min, now.temp), max: Math.max(day.max, now.temp), rain: day.rain };

  const rain = now.snow ? 0 : now.precip;
  day = { ...day, rain: day.rain + now.precip * h };
  const fall = now.snow ? now.precip * h * T.snowPerMm : 0;
  const melt = now.temp > 0 ? Math.min(snowpack + fall, T.melt * now.temp * h) : 0;
  snowpack = Math.max(0, snowpack + fall - melt);
  soil += (rain * h + melt / T.snowPerMm) * T.soilPerMm * (frozen > 0.5 ? 0.5 : 1);
  if (now.temp > 0 && frozen < 0.5) soil -= T.evap * Math.min(now.temp, 30) * (1 - 0.6 * now.cloud) * (0.25 + 0.75 * soil) * (snowpack > 0.02 ? 0.2 : 1) * h;
  if (soil > T.drainFrom) soil -= T.drain * (soil - T.drainFrom) * h;
  soil = clamp(soil, 0, 1);
  if (now.temp < -2) frozen += T.freezeRate * (-2 - now.temp) * h * (snowpack > 0.1 ? 0.4 : 1);
  else if (now.temp > 2) frozen -= T.freezeRate * (now.temp - 2) * h;
  frozen = clamp(frozen, 0, 1);
  if (now.temp < -3) ice += T.iceRate * (-3 - now.temp) * h;
  else if (now.temp > 0) ice -= T.iceMelt * now.temp * h;
  ice = clamp(ice, 0, 1);
  gdd += (Math.max(0, now.temp - T.gddBase) * h) / DAY_H / YEAR_SCALE;

  return { site, now, soil, snowpack, frozen, ice, gdd, stress, stressDays, frost, crop, day, yesterday };
}

// A night frost of `min` °C hits the unreaped crop: the yield potential falls (once per night, the caller decides).
export function applyFrost(w: WeatherState, min: number): WeatherState {
  if (!w.site || min >= -2) return w;
  const frost = w.frost * (1 - Math.min(0.6, 0.15 * (-2 - min)));
  return { ...w, frost, crop: clamp(w.crop * (frost / w.frost), 0, 1.2) };
}

// Founding (or enriching an old save) at game minute `t`: soil, snow, frost and ice come from a spin-up over the days before.
export function startWeather(site: WeatherSite, t = 0): WeatherState {
  const dt = TUNING.spinUpStepMin;
  let ws: WeatherState = { ...emptyWeather(), site, now: weatherAt(site, t - TUNING.spinUpDays * DAY_MIN) };
  ws = { ...ws, day: { min: ws.now.temp, max: ws.now.temp, rain: 0 }, yesterday: { min: ws.now.temp, max: ws.now.temp, rain: 0 } };
  const t0 = t - TUNING.spinUpDays * DAY_MIN;
  const n = Math.round((TUNING.spinUpDays * DAY_MIN) / dt);
  for (let i = 1; i <= n; i++) ws = advance(ws, t0 + i * dt, dt);
  return { ...ws, crop: dayOfYear0(t) < HARVEST_START_DAY ? cropOf(ws, dayOfYear0(t)) : ws.crop };
}

// Called every tick after the clock moved: refreshes `now` and the slow state. Calm (no site): unchanged.
export function weatherStep(s: SimState): SimState {
  if (!s.weather.site) return s;
  return { ...s, weather: advance(s.weather, s.gameMinutes, TUNING.tickMin) };
}
