// Mass of food for display: kilograms below a tonne, tonnes (one decimal) from it.
export const massText = (kg: number): string =>
  kg < 1000 ? `${Math.round(kg)} кг` : `${(Math.round(kg / 100) / 10).toString().replace(".", ",")} т`;
