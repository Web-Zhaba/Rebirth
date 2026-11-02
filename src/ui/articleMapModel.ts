import { mppAtZoom } from "../view/view";

export interface ArticleMapLike {
  lat: number;
  lng: number;
}

export function articleMapTarget(a: ArticleMapLike): [number, number] | null {
  if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng)) return null;
  if (a.lat < -90 || a.lat > 90 || a.lng < -180 || a.lng > 180) return null;
  return [a.lng, a.lat];
}

// Articles are brought to a useful scale: at least as close as old zoom 16.5, never closer than old zoom 18.
const ARTICLE_MAX_MPP = mppAtZoom(16.5);
const ARTICLE_MIN_MPP = mppAtZoom(18);

export function articleMapMpp(currentMpp: number): number {
  return Math.max(ARTICLE_MIN_MPP, Math.min(ARTICLE_MAX_MPP, currentMpp));
}
