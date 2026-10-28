import { flyOrJump } from "../map/motion";
import type * as maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "preact/hooks";
import { frame } from "../simClient";
import { Icon } from "./Icon";
import { IconButton } from "./kit";
import { dismissToast, toasts } from "./toastStore";
import { openPanel } from "./panels";
import { KIND_ICON, KIND_TONE, opensScience, showMs, type Toast } from "./toastModel";

// One toast: dismisses itself after its time, which stops while the pointer or the focus is on it.
function ToastItem({ t, map }: { t: Toast; map: maplibregl.Map }) {
  const [paused, setPaused] = useState(false);
  const left = useRef(showMs(t));
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const id = setTimeout(() => dismissToast(t.id), left.current);
    return () => {
      clearTimeout(id);
      left.current = Math.max(1000, left.current - (Date.now() - started));
    };
  }, [paused, t.id]);
  const fl = frame.value;
  const pos = t.pos;
  const fly = pos && fl ? () => flyOrJump(map, { center: fl.toLngLat(pos[0], pos[1]), zoom: Math.max(map.getZoom(), 17) }) : undefined;
  const body = (
    <>
      <Icon name={KIND_ICON[t.kind]} size={16} />
      <span class="toast-text">{t.text}</span>
    </>
  );
  return (
    <li
      class={`toast toast-${KIND_TONE[t.kind]}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusIn={() => setPaused(true)}
      onFocusOut={() => setPaused(false)}
    >
      {fly ? (
        <button class="toast-main" title="Показать на карте" onClick={fly}>
          {body}
        </button>
      ) : opensScience(t.kind) ? (
        <button class="toast-main" title="Открыть «Науку»" onClick={() => openPanel("tech")}>
          {body}
        </button>
      ) : (
        <div class="toast-main">{body}</div>
      )}
      <IconButton icon="close" label="Закрыть" size={14} onClick={() => dismissToast(t.id)} />
    </li>
  );
}

// The live region stays mounted even when empty so that screen readers announce what appears in it.
export function Toasts({ map }: { map: maplibregl.Map }) {
  return (
    <ul class="toasts" aria-live="polite" aria-label="Новости города">
      {toasts.value.map((t) => (
        <ToastItem key={t.id} t={t} map={map} />
      ))}
    </ul>
  );
}
