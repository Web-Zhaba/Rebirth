import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedBufferGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoBlending,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from "three";
import type { TreeModel } from "./treeModels";

// Impostors of the far trees (treeLayer.ts level 1): the full tree baked once into a strip of views from the side
// up to IMPOSTOR_STEP * (IMPOSTOR_VIEWS - 1) degrees above, which the layer draws as quads facing the camera. Two
// textures per tree: `color` the unlit vertex colours with the coverage in alpha, `data` the normal in the view
// (xy, z toward the camera), the height in the tree and the crown flag, so the layer lights, recolours and snows a
// baked tree as it does a real one. Baked at twice the size it is ever drawn: the mipmaps smooth the edges.

export const IMPOSTOR_VIEWS = 4;
export const IMPOSTOR_STEP = 25; // degrees of elevation between the views
const CELL = 256; // px per view
const MID = 0.5; // the trees are 1 high; the views turn about their middle

export interface Impostor {
  color: Texture;
  data: Texture;
  radius: number; // half the side of a view, in tree heights
  dispose(): void;
}

// The half side of a view: the farthest vertex from the middle, with a margin so the mipmaps of the views do not touch.
export function impostorRadius(t: Pick<TreeModel, "positions">): number {
  let r = 0;
  for (let i = 0; i < t.positions.length; i += 3) r = Math.max(r, Math.hypot(t.positions[i], t.positions[i + 1], t.positions[i + 2] - MID));
  return r * 1.06;
}

const BAKE_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aCrown;
varying vec3 vC;
varying vec3 vN;
varying float vH;
varying float vCrown;
void main() {
  vC = aColor;
  vN = normalMatrix * normal;
  vH = position.z;
  vCrown = aCrown;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const BAKE_COLOR = /* glsl */ `
varying vec3 vC;
void main() { gl_FragColor = vec4(vC, 1.0); }`;
const BAKE_DATA = /* glsl */ `
varying vec3 vN;
varying float vH;
varying float vCrown;
void main() {
  vec3 n = normalize(vN);
  if (n.z < 0.0) n = -n; // the inside of an open crown, seen through its rim
  gl_FragColor = vec4(n.xy * 0.5 + 0.5, vH, vCrown);
}`;

// A tree model as a geometry (positions, normals, colours, the crown flag).
export function treeGeometry<G extends BufferGeometry>(t: TreeModel, geo: G): G {
  geo.setAttribute("position", new BufferAttribute(Float32Array.from(t.positions), 3));
  geo.setAttribute("normal", new BufferAttribute(Float32Array.from(t.normals), 3));
  geo.setAttribute("aColor", new BufferAttribute(Float32Array.from(t.colors), 3));
  geo.setAttribute("aCrown", new BufferAttribute(Float32Array.from(t.crown), 1));
  geo.setIndex(new BufferAttribute(Uint32Array.from(t.indices), 1));
  return geo;
}

// Bakes one tree; run inside ThreeHost.draw (it leaves the render target bound). The empty texels get the colour of
// the crown, so the mipmaps at its edge keep it.
export function bakeImpostor(renderer: WebGLRenderer, t: TreeModel): Impostor {
  const geo = treeGeometry(t, new BufferGeometry());
  const leafAt = Math.max(0, t.crown.indexOf(1)) * 3;
  const leaf = [t.colors[leafAt], t.colors[leafAt + 1], t.colors[leafAt + 2]] as const;
  const mat = (fragmentShader: string) => new ShaderMaterial({ vertexShader: BAKE_VERT, fragmentShader, side: DoubleSide, blending: NoBlending });
  const mats = [mat(BAKE_COLOR), mat(BAKE_DATA)];
  const mesh = new Mesh(geo, mats[0]);
  const scene = new Scene().add(mesh);
  const radius = impostorRadius(t);
  const cam = new OrthographicCamera(-radius, radius, radius, -radius, 0.01, 4);
  const mid = new Vector3(0, 0, MID);
  const clear = new Color(), clearWas = new Color();
  renderer.getClearColor(clearWas);
  const alphaWas = renderer.getClearAlpha();
  const targets = mats.map((m, k) => {
    const target = new WebGLRenderTarget(CELL * IMPOSTOR_VIEWS, CELL, { minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, generateMipmaps: true });
    mesh.material = m;
    renderer.setRenderTarget(target);
    if (k === 0) renderer.setClearColor(clear.setRGB(...leaf), 0);
    else renderer.setClearColor(clear.setRGB(0.5, 0.5, 0.5), 1); // facing the camera, mid height, crown
    renderer.clear();
    for (let v = 0; v < IMPOSTOR_VIEWS; v++) {
      // from the south (-y), so the right of a view is east (+x) and its up the tree's up tilted toward the camera
      const e = (v * IMPOSTOR_STEP * Math.PI) / 180;
      cam.position.set(0, -2 * Math.cos(e), MID + 2 * Math.sin(e));
      cam.up.set(0, 0, 1);
      cam.lookAt(mid);
      cam.updateMatrixWorld();
      target.viewport.set(v * CELL, 0, CELL, CELL);
      renderer.setRenderTarget(target);
      renderer.render(scene, cam);
    }
    return target;
  });
  renderer.setClearColor(clearWas, alphaWas);
  geo.dispose();
  mats.forEach((m) => m.dispose());
  return {
    color: targets[0].texture,
    data: targets[1].texture,
    radius,
    dispose: () => targets.forEach((tg) => tg.dispose()),
  };
}

// The quad of an impostor: corners -1..1 in the view's right and up.
export function impostorQuad(): InstancedBufferGeometry {
  const geo = new InstancedBufferGeometry();
  geo.setAttribute("position", new BufferAttribute(Float32Array.from([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  return geo;
}
