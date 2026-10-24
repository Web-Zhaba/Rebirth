import { useEffect, useRef, useState } from "preact/hooks";
import maplibregl from "maplibre-gl";
import { latLngToCell } from "h3-js";
import { city, economy } from "../game/state";
import { initialEconomy } from "../game/sim";
import { saveNow, startLoop } from "../game/loop";

interface Point {
  lat: number;
  lng: number;
}

export function FoundCity({ map }: { map: maplibregl.Map }) {
  const [point, setPoint] = useState<Point | null>(null);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const marker = useRef<maplibregl.Marker | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (map.queryRenderedFeatures(e.point, { layers: ["water"] }).length > 0) {
        setMsg("Здесь вода — выберите сушу");
        return;
      }
      setMsg("");
      const { lat, lng } = e.lngLat;
      if (marker.current) marker.current.setLngLat(e.lngLat);
      else marker.current = new maplibregl.Marker({ color: "#e0a050" }).setLngLat(e.lngLat).addTo(map);
      map.flyTo({ center: e.lngLat, zoom: 14 });
      setPoint({ lat, lng });
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
      marker.current?.remove();
      marker.current = null;
    };
  }, [map]);

  const hasPoint = point !== null;
  useEffect(() => {
    if (hasPoint) input.current?.focus();
  }, [hasPoint]);

  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 40;

  const found = () => {
    if (!point || !valid) return;
    const c = {
      name: trimmed,
      lat: point.lat,
      lng: point.lng,
      cell: latLngToCell(point.lat, point.lng, 9),
      foundedAt: Date.now(),
    };
    marker.current?.remove();
    marker.current = null;
    economy.value = initialEconomy(c.cell, Date.now());
    city.value = c;
    saveNow();
    startLoop();
  };

  return (
    <>
      <div class="hint panel">{msg || "Выберите место для нового поселения"}</div>
      {point && (
        <form
          class="found panel"
          onSubmit={(e) => {
            e.preventDefault();
            found();
          }}
        >
          <div class="coords">
            {point.lat.toFixed(4)}, {point.lng.toFixed(4)}
          </div>
          <input
            ref={input}
            type="text"
            maxLength={40}
            placeholder="Название поселения"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
          <button type="submit" disabled={!valid}>
            Основать
          </button>
        </form>
      )}
    </>
  );
}
