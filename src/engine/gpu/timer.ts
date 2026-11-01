// GPU time of a render pass from timestamp queries. A frame's timestamps are resolved into a buffer and copied to one
// of a ring of mappable buffers; the result arrives a few frames later through mapAsync. When every ring slot is still
// waiting, the frame simply goes untimed rather than stalling. Browsers may quantise timestamps (Chrome: 100 us).

const RING = 8;

export class GpuTimer {
  private querySet: GPUQuerySet;
  private resolve: GPUBuffer;
  private ring: { buf: GPUBuffer; busy: boolean }[] = [];
  private current = -1;
  last = 0; // ms, latest result
  onSample: ((ms: number) => void) | null = null;

  constructor(private readonly device: GPUDevice) {
    this.querySet = device.createQuerySet({ type: "timestamp", count: 2 });
    this.resolve = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    for (let i = 0; i < RING; i++)
      this.ring.push({ buf: device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), busy: false });
  }

  // Timestamp writes for this frame's pass, or undefined when no ring slot is free.
  passWrites(): GPURenderPassTimestampWrites | undefined {
    this.current = this.ring.findIndex((r) => !r.busy);
    if (this.current < 0) return undefined;
    return { querySet: this.querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 };
  }

  // Record the resolve + copy after the pass, in the same encoder.
  resolveInto(encoder: GPUCommandEncoder): void {
    if (this.current < 0) return;
    encoder.resolveQuerySet(this.querySet, 0, 2, this.resolve, 0);
    encoder.copyBufferToBuffer(this.resolve, 0, this.ring[this.current].buf, 0, 16);
  }

  // After submit: start reading the slot back.
  afterSubmit(): void {
    if (this.current < 0) return;
    const slot = this.ring[this.current];
    slot.busy = true;
    this.current = -1;
    slot.buf
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const t = new BigInt64Array(slot.buf.getMappedRange());
        const ms = Number(t[1] - t[0]) / 1e6;
        slot.buf.unmap();
        slot.busy = false;
        if (ms >= 0 && ms < 1000) {
          this.last = ms;
          this.onSample?.(ms);
        }
      })
      .catch(() => {
        slot.busy = false;
      });
  }
}
