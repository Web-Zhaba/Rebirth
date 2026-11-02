import { createShader } from "../gpu/wgsl";
import treeAtlasWgsl from "./treeAtlas.wgsl?raw";

// The forest's models on the GPU (scene/forest.ts): every kind's tree, 1 m tall, in one vertex and index buffer, and
// their impostors for the distance: each kind baked once into a strip of IMPOSTOR_VIEWS views from the side up to
// IMPOSTOR_STEP * (IMPOSTOR_VIEWS - 1) degrees above (the old treeImpostor.ts on WebGPU), a layer per kind, with mips.
// Baked at about twice the size a far tree is ever drawn: the mipmaps smooth the edges.

export const TREE_VERTEX_FLOATS = 10; // position 3, normal 3, colour 3, crown 1
export const IMPOSTOR_VIEWS = 4;
export const IMPOSTOR_STEP = 25; // degrees of elevation between the views
const CELL = 128; // px per view
const MID = 0.5; // the trees are 1 high; the views turn about their middle

export interface TreeModelData {
  positions: readonly number[];
  normals: readonly number[];
  colors: readonly number[];
  indices: readonly number[];
  crown: readonly number[]; // per vertex: 1 foliage, 0 trunk
}

export interface TreeMeshes {
  vertices: GPUBuffer;
  indices: GPUBuffer;
  ranges: { firstIndex: number; count: number; baseVertex: number }[]; // per kind
}

export function uploadTreeMeshes(device: GPUDevice, models: readonly TreeModelData[]): TreeMeshes {
  const nv = models.reduce((a, m) => a + m.positions.length / 3, 0);
  const ni = models.reduce((a, m) => a + m.indices.length, 0);
  const v = new Float32Array(nv * TREE_VERTEX_FLOATS);
  const idx = new Uint32Array(ni);
  const ranges: TreeMeshes["ranges"] = [];
  let bv = 0;
  let fi = 0;
  for (const m of models) {
    const n = m.positions.length / 3;
    for (let k = 0; k < n; k++) {
      const o = (bv + k) * TREE_VERTEX_FLOATS;
      for (let c = 0; c < 3; c++) {
        v[o + c] = m.positions[k * 3 + c];
        v[o + 3 + c] = m.normals[k * 3 + c];
        v[o + 6 + c] = m.colors[k * 3 + c];
      }
      v[o + 9] = m.crown[k];
    }
    idx.set(m.indices, fi);
    ranges.push({ firstIndex: fi, count: m.indices.length, baseVertex: bv });
    bv += n;
    fi += m.indices.length;
  }
  const vertices = device.createBuffer({ label: "tree vertices", size: v.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const indices = device.createBuffer({ label: "tree indices", size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vertices, 0, v);
  device.queue.writeBuffer(indices, 0, idx);
  return { vertices, indices, ranges };
}

export const TREE_VERTEX_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: TREE_VERTEX_FLOATS * 4,
  attributes: [
    { shaderLocation: 0, offset: 0, format: "float32x3" },
    { shaderLocation: 1, offset: 12, format: "float32x3" },
    { shaderLocation: 2, offset: 24, format: "float32x3" },
    { shaderLocation: 3, offset: 36, format: "float32" },
  ],
};

// The half side of a view: the farthest vertex from the middle, with a margin so the mips of the views do not touch.
export function impostorRadius(m: Pick<TreeModelData, "positions">): number {
  let r = 0;
  for (let i = 0; i < m.positions.length; i += 3) r = Math.max(r, Math.hypot(m.positions[i], m.positions[i + 1], m.positions[i + 2] - MID));
  return r * 1.06;
}

export interface TreeAtlas {
  color: GPUTexture; // rgba8unorm array, a layer per kind
  data: GPUTexture;
  radius: number[]; // per kind, in tree heights
}

const FORMAT: GPUTextureFormat = "rgba8unorm";

// Bake every kind's impostor. `leaf` is the colour the empty texels get (per kind), so the mips at a crown's edge keep it.
export function bakeTreeAtlas(device: GPUDevice, meshes: TreeMeshes, models: readonly TreeModelData[], leaf: readonly [number, number, number][]): TreeAtlas {
  const kinds = models.length;
  const width = CELL * IMPOSTOR_VIEWS;
  const mips = Math.floor(Math.log2(width)) + 1;
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT;
  const color = device.createTexture({ label: "tree impostor colour", size: [width, CELL, kinds], format: FORMAT, mipLevelCount: mips, usage });
  const data = device.createTexture({ label: "tree impostor data", size: [width, CELL, kinds], format: FORMAT, mipLevelCount: mips, usage });
  const depth = device.createTexture({ size: [width, CELL], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT });
  const module = createShader(device, "tree atlas", treeAtlasWgsl);

  const bakePipe = device.createRenderPipeline({
    label: "tree bake",
    layout: "auto",
    vertex: { module, entryPoint: "vs", buffers: [TREE_VERTEX_LAYOUT] },
    fragment: { module, entryPoint: "fs", targets: [{ format: FORMAT }, { format: FORMAT }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
  });
  // One uniform slot per (kind, view), at the 256-byte offset alignment.
  const SLOT = 256;
  const uni = device.createBuffer({ label: "tree bake", size: SLOT * kinds * IMPOSTOR_VIEWS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const radius = models.map(impostorRadius);
  const block = new Float32Array((SLOT / 4) * kinds * IMPOSTOR_VIEWS);
  for (let k = 0; k < kinds; k++)
    for (let v = 0; v < IMPOSTOR_VIEWS; v++) {
      // from the south (-y): the right of a view is east (+x), its up the tree's up tilted away from the camera
      const e = (v * IMPOSTOR_STEP * Math.PI) / 180;
      const o = ((k * IMPOSTOR_VIEWS + v) * SLOT) / 4;
      block.set([1, 0, 0, 0, 0, Math.sin(e), Math.cos(e), 0, 0, Math.cos(e), -Math.sin(e), 0, 0, 0, MID, radius[k]], o);
    }
  device.queue.writeBuffer(uni, 0, block);
  const bakeGroup = (slot: number) => device.createBindGroup({ layout: bakePipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uni, offset: slot * SLOT, size: 64 } }] });

  const encoder = device.createCommandEncoder({ label: "tree bake" });
  const layerView = (t: GPUTexture, k: number, mip: number) => t.createView({ dimension: "2d", baseArrayLayer: k, arrayLayerCount: 1, baseMipLevel: mip, mipLevelCount: 1 });
  for (let k = 0; k < kinds; k++) {
    const pass = encoder.beginRenderPass({
      label: "tree bake",
      colorAttachments: [
        { view: layerView(color, k, 0), clearValue: [...leaf[k], 0], loadOp: "clear", storeOp: "store" },
        { view: layerView(data, k, 0), clearValue: [0.5, 0.5, 0.5, 1], loadOp: "clear", storeOp: "store" }, // facing the camera, mid height, crown
      ],
      depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "discard" },
    });
    pass.setPipeline(bakePipe);
    pass.setVertexBuffer(0, meshes.vertices);
    pass.setIndexBuffer(meshes.indices, "uint32");
    const r = meshes.ranges[k];
    for (let v = 0; v < IMPOSTOR_VIEWS; v++) {
      pass.setViewport(v * CELL, 0, CELL, CELL, 0, 1);
      pass.setBindGroup(0, bakeGroup(k * IMPOSTOR_VIEWS + v));
      pass.drawIndexed(r.count, 1, r.firstIndex, r.baseVertex);
    }
    pass.end();
  }

  // The mip chains.
  const mipPipe = device.createRenderPipeline({
    label: "tree mips",
    layout: "auto",
    vertex: { module, entryPoint: "mipVs" },
    fragment: { module, entryPoint: "mipFs", targets: [{ format: FORMAT }] },
    primitive: { topology: "triangle-list" },
  });
  const sampler = device.createSampler({ minFilter: "linear", magFilter: "linear" });
  for (const t of [color, data])
    for (let k = 0; k < kinds; k++)
      for (let m = 1; m < mips; m++) {
        const pass = encoder.beginRenderPass({ label: "tree mip", colorAttachments: [{ view: layerView(t, k, m), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
        pass.setPipeline(mipPipe);
        pass.setBindGroup(
          0,
          device.createBindGroup({
            layout: mipPipe.getBindGroupLayout(0),
            entries: [
              { binding: 1, resource: layerView(t, k, m - 1) },
              { binding: 2, resource: sampler },
            ],
          }),
        );
        pass.draw(3);
        pass.end();
      }
  device.queue.submit([encoder.finish()]);
  depth.destroy();
  uni.destroy();
  return { color, data, radius };
}
