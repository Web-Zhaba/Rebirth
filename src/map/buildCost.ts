import { etaRealMs, formatReal } from "../sim/buildEta";
import type { Materials } from "../sim/buildings";
import { people, speed, state } from "../simClient";
import { decimal, L } from "../i18n";

const MAT: [keyof Materials, string, string][] = [
  ["logs", L("брёвна", "logs"), L("м³", "m³")],
  ["planks", L("доски", "planks"), L("м³", "m³")],
  ["stone", L("камень", "stone"), L("т", "t")],
];
const n1 = (v: number) => decimal(String(Math.round(v * 10) / 10));

// Hands the artel would have: those building now, or the idle adults who would start.
export const artelHands = (): number => {
  const p = people.value;
  return p ? p.builders + p.unemployed : 0;
};

// "~3 мин на 2× (6 строителей)": real time of `personHours` of work at the current artel and speed.
export function etaText(personHours: number): string {
  const hands = artelHands();
  const s = state.value;
  if (!s) return "";
  if (hands <= 0) return L("некому строить", "no one to build");
  if (speed.value === 0) return L(`${n1(personHours / hands)} ч работы, время стоит`, `${n1(personHours / hands)} h of work, time is stopped`);
  const ms = etaRealMs(personHours, hands, s.gameMinutes, speed.value, s.levers);
  return Number.isFinite(ms) ? `${formatReal(ms)} (${hands} ${L("стр.", "bld.")})` : L("очень долго", "very long");
}

// "100 чел.-ч · брёвна 25 м³ · доски 2 м³ · ~3 мин (6 стр.)"
export function costText(personHours: number, materials?: Materials): string {
  const parts = [`${Math.round(personHours)} ${L("чел.-ч", "person-h")}`];
  if (materials) for (const [k, name, unit] of MAT) if (materials[k] > 0) parts.push(`${name} ${n1(materials[k])} ${unit}`);
  const eta = etaText(personHours);
  if (eta) parts.push(eta);
  return parts.join(" · ");
}
