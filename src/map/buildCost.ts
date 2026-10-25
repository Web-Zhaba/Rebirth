import { etaRealMs, formatReal } from "../sim/buildEta";
import type { Materials } from "../sim/buildings";
import { people, speed, state } from "../simClient";

const MAT: [keyof Materials, string, string][] = [
  ["logs", "брёвна", "м³"],
  ["planks", "доски", "м³"],
  ["stone", "камень", "т"],
];
const n1 = (v: number) => String(Math.round(v * 10) / 10).replace(".", ",");

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
  if (hands <= 0) return "некому строить";
  if (speed.value === 0) return `${n1(personHours / hands)} ч работы, время стоит`;
  const ms = etaRealMs(personHours, hands, s.gameMinutes, speed.value, s.levers);
  return Number.isFinite(ms) ? `${formatReal(ms)} (${hands} стр.)` : "очень долго";
}

// "100 чел.-ч · брёвна 25 м³ · доски 2 м³ · ~3 мин (6 стр.)"
export function costText(personHours: number, materials?: Materials): string {
  const parts = [`${Math.round(personHours)} чел.-ч`];
  if (materials) for (const [k, name, unit] of MAT) if (materials[k] > 0) parts.push(`${name} ${n1(materials[k])} ${unit}`);
  const eta = etaText(personHours);
  if (eta) parts.push(eta);
  return parts.join(" · ");
}
