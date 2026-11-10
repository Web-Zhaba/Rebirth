// Sim states are copy-on-write: the same object means the same content. One tick (and the snapshot after it) asks for
// the same aggregates many times, so they are kept by the identity of what they were made from. A kept result is
// shared between callers: never change it.

// One result per key object, for as long as the key lives.
export function makeIdentityCache<K extends object, V>(build: (key: K) => V): (key: K) => V {
  const cache = new WeakMap<K, V>();
  return (key: K) => {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const value = build(key);
    cache.set(key, value);
    return value;
  };
}

// The last result, for as long as every argument stays the same value.
export function memoLast<A extends readonly unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let last: A | null = null;
  let out!: R;
  return (...args: A): R => {
    if (last !== null) {
      let same = true;
      for (let i = 0; i < args.length && same; i++) same = Object.is(args[i], last[i]);
      if (same) return out;
    }
    out = fn(...args);
    last = args;
    return out;
  };
}
