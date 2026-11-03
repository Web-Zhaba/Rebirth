import { CLICK_TOLERANCE, isClick } from "./scale";

// Tracks one-pointer taps independently of the camera controller. A second active pointer
// invalidates the whole gesture, so a pinch/tilt can never become a placement or field click.
// Each press keeps the tolerance it started with (a finger gets more slack than a mouse).
export class PointerClickTracker {
  private readonly active = new Set<number>();
  private readonly starts = new Map<number, { point: readonly [number, number]; tolerance: number }>();
  private readonly dragged = new Set<number>();
  private multiPointer = false;
  private suppressClickUntilNextPointerDown = false;

  pointerDown(pointerId: number, point: readonly [number, number], tolerance = CLICK_TOLERANCE): void {
    if (this.active.size === 0) {
      // A previous drag may not have generated a click. Drop its stale start before pointer-id reuse.
      this.starts.clear();
      this.dragged.clear();
      this.multiPointer = false;
      this.suppressClickUntilNextPointerDown = false;
    } else {
      this.multiPointer = true;
    }
    this.active.add(pointerId);
    this.starts.set(pointerId, { point, tolerance });
  }

  pointerMove(pointerId: number, point: readonly [number, number]): void {
    const start = this.starts.get(pointerId);
    if (start && !isClick(start.point, point, start.tolerance)) this.dragged.add(pointerId);
  }

  pointerUp(pointerId: number): void {
    this.active.delete(pointerId);
    if (this.multiPointer && this.active.size === 0) {
      this.suppressClickUntilNextPointerDown = true;
      this.reset();
    }
  }

  pointerCancel(pointerId: number): void {
    this.active.delete(pointerId);
    this.starts.delete(pointerId);
    this.dragged.delete(pointerId);
    if (this.active.size === 0) {
      this.suppressClickUntilNextPointerDown = true;
      this.reset();
    }
  }

  isClick(pointerId: number | null, point: readonly [number, number]): boolean {
    if (this.multiPointer || this.suppressClickUntilNextPointerDown) return false;

    if (pointerId === null) {
      // Some browsers expose Pointer Events for down/up but still deliver click as MouseEvent.
      // Older browsers expose no Pointer Events at all: with no recorded start, preserve native clicks.
      const entry = this.starts.size === 1 ? [...this.starts.entries()][0] : undefined;
      const wasDragged = entry !== undefined && this.dragged.has(entry[0]);
      this.starts.clear();
      this.dragged.clear();
      return entry === undefined || (!wasDragged && isClick(entry[1].point, point, entry[1].tolerance));
    }

    const start = this.starts.get(pointerId);
    const wasDragged = this.dragged.has(pointerId);
    this.starts.delete(pointerId);
    this.dragged.delete(pointerId);
    return start !== undefined && !wasDragged && isClick(start.point, point, start.tolerance);
  }

  private reset(): void {
    this.starts.clear();
    this.dragged.clear();
    this.multiPointer = false;
  }
}
