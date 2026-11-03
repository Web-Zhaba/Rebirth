import { decimal, L } from "../i18n";
// Mass of food for display: kilograms below a tonne, tonnes (one decimal) from it.
export const massText = (kg: number): string =>
  kg < 1000 ? `${Math.round(kg)} ${L("кг", "kg")}` : `${decimal((Math.round(kg / 100) / 10).toString())} ${L("т", "t")}`;
