export interface ArticleMapLike {
  lat: number;
  lng: number;
}

export function articleMapTarget(a: ArticleMapLike): [number, number] | null {
  if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng)) return null;
  if (a.lat < -90 || a.lat > 90 || a.lng < -180 || a.lng > 180) return null;
  return [a.lng, a.lat];
}

export function articleMapZoom(current: number): number {
  return Math.max(16.5, Math.min(18, current < 16.5 ? 16.5 : current));
}
