export function storedChoice<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

export function effectiveLayer<T extends string>(manual: T, automatic: T | null): T {
  return automatic ?? manual;
}
