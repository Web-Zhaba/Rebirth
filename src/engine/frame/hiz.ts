import { createShader } from "../gpu/wgsl";
import hizWgsl from "./hiz.wgsl?raw";

// Hi-Z pyramid for occlusion culling (docs/PLAN-engine.md N6, hiz.wgsl). The engine draws the occluders first (terrain,
// buildings), builds this from their depth, then the GPU culling passes (the forest's scatter) test bounding spheres
// against it before the rest of the frame is drawn: occluders and the culled are different things, so one phase on this
// frame's depth is exact, with no reprojection and no pop-in when the camera moves.

export class HiZ {
  texture: GPUTexture | null = null;
  version = 0; // bumped when the texture is recreated (bind groups that hold it are stale)
  private readonly first: GPUComputePipeline;
  private readonly down: GPUComputePipeline;
  private groups: GPUBindGroup[] = [];
  private depth: GPUTexture | null = null;

  constructor(private readonly device: GPUDevice) {
    const module = createShader(device, "hiz", hizWgsl);
    this.first = device.createComputePipeline({ label: "hiz first", layout: "auto", compute: { module, entryPoint: "first" } });
    this.down = device.createComputePipeline({ label: "hiz down", layout: "auto", compute: { module, entryPoint: "down" } });
  }

  get levels(): number {
    return this.texture?.mipLevelCount ?? 0;
  }

  // Build from this frame's multisampled depth.
  build(encoder: GPUCommandEncoder, depth: GPUTexture): void {
    this.fit(depth);
    const t = this.texture!;
    const pass = encoder.beginComputePass({ label: "hiz" });
    for (let k = 0; k < t.mipLevelCount; k++) {
      pass.setPipeline(k ? this.down : this.first);
      pass.setBindGroup(0, this.groups[k]);
      pass.dispatchWorkgroups(Math.ceil(Math.max(1, t.width >> k) / 8), Math.ceil(Math.max(1, t.height >> k) / 8));
    }
    pass.end();
  }

  // Sizes the pyramid for a (new) depth texture. The engine calls it as soon as it recreates the depth, so the culling
  // passes' uniforms, written before the build, already see the size and levels the build will make.
  fit(depth: GPUTexture): void {
    if (depth === this.depth) return;
    this.depth = depth;
    this.texture?.destroy();
    const w = Math.max(1, Math.ceil(depth.width / 2));
    const h = Math.max(1, Math.ceil(depth.height / 2));
    const mips = Math.floor(Math.log2(Math.max(w, h))) + 1;
    const t = (this.texture = this.device.createTexture({
      label: "hiz",
      size: [w, h],
      format: "r32float",
      mipLevelCount: mips,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC, // copy: read-backs in tests
    }));
    const level = (k: number) => t.createView({ baseMipLevel: k, mipLevelCount: 1 });
    this.groups = [];
    for (let k = 0; k < mips; k++)
      this.groups.push(
        this.device.createBindGroup({
          layout: (k ? this.down : this.first).getBindGroupLayout(0),
          entries: k
            ? [
                { binding: 1, resource: level(k - 1) },
                { binding: 2, resource: level(k) },
              ]
            : [
                { binding: 0, resource: depth.createView() },
                { binding: 2, resource: level(0) },
              ],
        }),
      );
    this.version++;
  }
}
