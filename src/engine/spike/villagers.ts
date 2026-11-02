import { VillagerPreview, type Actor } from "../debug/villagers";
import { ACTIONS, buildRig, villagerLook, type Action, type Look, type Vec3 } from "../../map/villagerModel";
import { fitCanvas, initGpu, WebGpuUnavailable, type Gpu } from "../gpu/device";

// Villagers preview (dev page /villagers.html): a row of residents of different ages on a flat patch, each with a random
// look from its seed (sex, stature by age, hair, clothes); one action for all. Drag to orbit, wheel to zoom.

const AGES = [1, 3, 6, 10, 14, 18, 25, 33, 41, 52, 63, 74];
const SPACING = 0.9; // m between figures
const FOVY = 0.7;
const ROW_HALF = ((AGES.length - 1) * SPACING) / 2 + 1; // m: half the row and a margin
const TARGET: Vec3 = [0, 0.85, 0];
const UP: Vec3 = [0, 1, 0];
const LIGHT: Vec3 = [0.45, 0.8, 0.35];
const ACTION_NAMES: Record<Action, string> = { idle: "стоит", walk: "идёт", work: "работает", carry: "несёт", sleep: "спит" };
const HAIR_NAMES = { bald: "лысый", cap: "короткие волосы", long: "длинные волосы", bun: "пучок" } as const;

type M4 = Float32Array; // column-major, as WGSL reads a mat4x4f

function mul(a: M4, b: M4): M4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

// Depth range 0..1, as WebGPU clips it.
function perspective(fovy: number, aspect: number, near: number, far: number): M4 {
  const t = 1 / Math.tan(fovy / 2);
  const o = new Float32Array(16);
  o[0] = t / aspect;
  o[5] = t;
  o[10] = far / (near - far);
  o[11] = -1;
  o[14] = (far * near) / (near - far);
  return o;
}

function lookAt(eye: Vec3, centre: Vec3, up: Vec3): M4 {
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]);
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const z = norm(sub(eye, centre));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  const o = new Float32Array(16);
  o.set([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  return o;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", cls = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

const summary = (l: Look): string =>
  [`${l.age} л`, l.sex === "m" ? "м" : "ж", `${l.stature.toFixed(2).replace(".", ",")} м`, HAIR_NAMES[l.hairStyle] + (l.beard ? ", борода" : "")].join(" · ");

async function main(): Promise<void> {
  const canvas = document.getElementById("view") as HTMLCanvasElement;
  const ui = document.getElementById("ui") as HTMLElement;
  let gpu: Gpu;
  try {
    gpu = await initGpu(canvas);
  } catch (e) {
    const msg = e instanceof WebGpuUnavailable ? `WebGPU недоступен: ${e.message}` : String(e);
    document.body.append(el("div", msg, "fail"));
    throw e;
  }
  const preview = new VillagerPreview(gpu.device, gpu.context, gpu.format);
  fitCanvas(canvas);
  preview.resize(canvas.width, canvas.height);

  let action: Action = "idle";
  let looks: Look[] = [];
  const buttons = new Map<Action, HTMLButtonElement>();
  const list = el("ol", "", "list");

  const crowd = (): void => {
    const origin = (i: number): Vec3 => [(i - (AGES.length - 1) / 2) * SPACING, 0, 0];
    const actors: Actor[] = looks.map((look, i) => ({ rig: buildRig(look), origin: origin(i) }));
    preview.setActors(actors);
    list.replaceChildren(...looks.map((l) => el("li", summary(l))));
  };
  const reroll = (): void => {
    looks = AGES.map((age) => villagerLook(Math.floor(Math.random() * 2 ** 32), age));
    crowd();
  };

  const panel = el("div", "", "panel");
  panel.append(el("h1", "Жители: превью"), el("p", "Модели по возрасту, одежде и причёске; случайный набор при каждом перебросе.", "hint"));
  const row = el("div", "", "row");
  for (const a of ACTIONS) {
    const b = el("button", ACTION_NAMES[a]);
    b.onclick = () => {
      action = a;
      for (const [k, v] of buttons) v.classList.toggle("on", k === a);
    };
    buttons.set(a, b);
    row.append(b);
  }
  buttons.get(action)?.classList.add("on");
  const again = el("button", "Новые жители", "wide");
  again.onclick = reroll;
  const details = el("details");
  details.append(el("summary", "Жители по возрасту"), list);
  panel.append(row, again, details);
  ui.append(panel);
  reroll();

  // Orbit around the row: drag to turn and tilt, wheel to zoom. Figures face +z, the camera starts in front of them.
  let yaw = 0;
  let pitch = 0.18;
  let zoom = 1;
  let drag: { x: number; y: number } | null = null;
  canvas.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    yaw -= (e.clientX - drag.x) * 0.005;
    pitch = Math.min(1.2, Math.max(-0.1, pitch + (e.clientY - drag.y) * 0.005));
    drag = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener("pointerup", () => (drag = null));
  canvas.addEventListener(
    "wheel",
    (e) => {
      zoom = Math.min(2.5, Math.max(0.3, zoom * Math.exp(e.deltaY * 0.001)));
      e.preventDefault();
    },
    { passive: false },
  );

  const frame = (now: number): void => {
    if (fitCanvas(canvas)) preview.resize(canvas.width, canvas.height);
    const aspect = canvas.width / canvas.height;
    const dist = (ROW_HALF / (Math.tan(FOVY / 2) * aspect)) * zoom; // the row fills the width at zoom 1
    const eye: Vec3 = [
      TARGET[0] + dist * Math.cos(pitch) * Math.sin(yaw),
      TARGET[1] + dist * Math.sin(pitch),
      TARGET[2] + dist * Math.cos(pitch) * Math.cos(yaw),
    ];
    const view = lookAt(eye, TARGET, UP);
    const proj = perspective(FOVY, aspect, 0.1, 100);
    preview.draw(now / 1000, action, mul(proj, view), LIGHT);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void main();
