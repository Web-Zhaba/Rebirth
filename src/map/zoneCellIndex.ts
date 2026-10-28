export interface KeyedCell {
  key: string;
}

export function indexCellsByKey<T extends KeyedCell>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.key, item]));
}

export function cellsForKeys<T extends KeyedCell>(index: ReadonlyMap<string, T>, keys: readonly string[]): T[] {
  const out: T[] = [];
  for (const key of keys) {
    const cell = index.get(key);
    if (cell) out.push(cell);
  }
  return out;
}
