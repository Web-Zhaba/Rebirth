import { CLICK_TOLERANCE, isClick } from "./scale";

// Tracks one-pointer taps independently of the camera controller. A second active pointer
// invalidates the whole gesture, so a pinch/tilt can never become a placement or field click.
export class PointerClickTracker {
  private readonly active = new Set<number>();
  private readonly starts = new Map<number, readonly [number, number]>();
  private multiPointer = false;
  private suppressClickUntilNextPointerDown = false;

  pointerDown(pointerId: number, point: readonly [number, number]): void {
    if (this.active.size === 0) {
      // A previous drag may not have generated a click. Drop its stale start before pointer-id reuse.
      this.starts.clear();
      this.multiPointer = false;
      this.suppressClickUntilNextPointerDown = false;
    } else {
      this.multiPointer = true;
    }
    this.active.add(pointerId);
    this.starts.set(pointerId, point);
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
    if (this.active.size === 0) {
      this.suppressClickUntilNextPointerDown = true;
      this.reset();
    }
  }

  isClick(pointerId: number | null, point: readonly [number, number], tolerance = CLICK_TOLERANCE): boolean {
    if (this.multiPointer || this.suppressClickUntilNextPointerDown) return false;

    if (pointerId === null) {
      // Some browsers expose Pointer Events for down/up but still deliver click as MouseEvent.
      // Older browsers expose no Pointer Events at all: with no recorded start, preserve native clicks.
      const start = this.starts.size === 1
        ? this.starts.values().next().value as readonly [number, number] | undefined
        : undefined;
      this.starts.clear();
      return start === undefined || isClick(start, point, tolerance);
    }

    const start = this.starts.get(pointerId);
    this.starts.delete(pointerId);
    return start !== undefined && isClick(start, point, tolerance);
  }

  private reset(): void {
    this.starts.clear();
    this.multiPointer = false;
  }
}
