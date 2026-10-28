import { useEffect, useRef, useState } from "preact/hooks";
import type * as maplibregl from "maplibre-gl";
import { flyOrJump, prefersReducedMotion } from "../map/motion";
import { placeLabelsOn, togglePlaceLabels } from "../map/placeLabels";
import { MIN_QUERY, searchPlaces, type PlaceHit } from "../world/geocode";
import { IconButton } from "./kit";
import { Icon } from "./Icon";

const DEBOUNCE_MS = 400; // Photon fair use: no request per keystroke
const LOCATE_ZOOM = 13;

// Point zoom when the hit has no extent.
const pointZoom = (h: PlaceHit) => (h.kind === "город" ? 11 : h.kind === "страна" || h.kind === "регион" ? 6 : 14);

function flyTo(map: maplibregl.Map, h: PlaceHit) {
  if (h.bbox) {
    const [w, s, e, n] = h.bbox;
    map.fitBounds([w, s, e, n], { padding: 60, maxZoom: 14, ...(prefersReducedMotion() && { duration: 0 }) });
  } else flyOrJump(map, { center: [h.lng, h.lat], zoom: pointZoom(h) });
}

// Finding a spot before founding: search by name, the player's own location, old place names on the map.
export function PlaceSearch({ map }: { map: maplibregl.Map }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const text = q.trim();
    if (text.length < MIN_QUERY) {
      setHits([]);
      setMsg("");
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      const c = map.getCenter();
      setBusy(true);
      searchPlaces(text, { lng: c.lng, lat: c.lat }, ctl.signal).then(
        (h) => {
          setHits(h);
          setActive(0);
          setOpen(true);
          setMsg(h.length ? "" : "Ничего не нашлось");
          setBusy(false);
        },
        (e) => {
          if (ctl.signal.aborted) return;
          console.warn("place search", e);
          setHits([]);
          setMsg("Поиск недоступен, попробуйте позже");
          setBusy(false);
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, map]);

  const pick = (h: PlaceHit) => {
    flyTo(map, h);
    setQ(h.name);
    setOpen(false);
    input.current?.blur();
  };

  const locate = () => {
    if (!("geolocation" in navigator)) return setMsg("Браузер не умеет определять место");
    setMsg("Определяем, где вы…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setMsg("");
        flyOrJump(map, { center: [p.coords.longitude, p.coords.latitude], zoom: LOCATE_ZOOM });
      },
      (e) => setMsg(e.code === e.PERMISSION_DENIED ? "Нет доступа к местоположению" : "Не удалось определить место"),
      { timeout: 15000, maximumAge: 600000 },
    );
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!hits.length) return;
      setOpen(true);
      setActive((i) => (i + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hits[active]) pick(hits[active]);
    } else if (e.key === "Escape") {
      if (open) setOpen(false);
      else setQ("");
    }
  };

  const showList = open && hits.length > 0;
  return (
    <div class="panel place-search" role="search">
      <div class="place-search-row">
        <label class="place-search-field">
          <Icon name="search" size={16} />
          <input
            ref={input}
            type="search"
            role="combobox"
            list={undefined}
            aria-label="Найти место по названию"
            aria-expanded={showList}
            aria-controls="place-hits"
            aria-activedescendant={showList ? `place-hit-${active}` : undefined}
            aria-autocomplete="list"
            placeholder="Найти город или село"
            value={q}
            onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            onKeyDown={onKey}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
          />
        </label>
        <IconButton icon="locate" label="Где я" onClick={locate} />
        <IconButton
          icon="placeNames"
          label={placeLabelsOn.value ? "Скрыть названия на карте" : "Показать названия на карте"}
          aria-pressed={placeLabelsOn.value}
          onClick={togglePlaceLabels}
        />
      </div>
      {showList && (
        <ul class="place-hits" id="place-hits" role="listbox" aria-label="Найденные места">
          {hits.map((h, i) => (
            <li
              key={`${h.lng},${h.lat},${h.name}`}
              id={`place-hit-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()} // keep focus so blur does not close the list first
              onClick={() => pick(h)}
              onMouseEnter={() => setActive(i)}
            >
              <span class="place-hit-name">
                {h.name}
                {h.kind && <span class="place-hit-kind">, {h.kind}</span>}
              </span>
              {h.where && <span class="place-hit-where">{h.where}</span>}
            </li>
          ))}
        </ul>
      )}
      {(msg || busy) && (
        <div class="place-search-msg" aria-live="polite">
          {msg || "Ищем…"}
        </div>
      )}
      <div class="place-search-credit">
        Поиск: <a href="https://photon.komoot.io" target="_blank" rel="noopener">Photon</a>, {"\u00a9"} OpenStreetMap
      </div>
    </div>
  );
}
