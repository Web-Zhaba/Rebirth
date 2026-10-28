import * as maplibregl from "maplibre-gl";
import { effect } from "@preact/signals";
import { h, render } from "preact";
import { articles } from "../simClient";
import { Icon } from "../ui/Icon";
import { articleMapTarget } from "../ui/articleMapModel";

interface MarkerEntry {
  marker: maplibregl.Marker;
  el: HTMLButtonElement;
  title: string;
}

// One compact notebook marker per saved Wikipedia entry. Articles already store their source coordinates,
// so this layer is entirely local and also works after reloading a save.
export function attachArticleMarkers(map: maplibregl.Map): void {
  const shown = new Map<string, MarkerEntry>();

  const drop = (id: string) => {
    shown.get(id)?.marker.remove();
    shown.delete(id);
  };

  effect(() => {
    const all = articles.value;
    const wanted = new Set<string>();
    for (const article of all) {
      const target = articleMapTarget(article);
      if (!target) continue;
      wanted.add(article.id);
      let entry = shown.get(article.id);
      if (!entry) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "maplibregl-marker wiki-map-marker";
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          map.easeTo({ center: target, zoom: Math.max(map.getZoom(), 16.5), duration: 350 });
        });
        render(h(Icon, { name: "scroll", size: 14 }), el);
        entry = { marker: new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(target).addTo(map), el, title: "" };
        shown.set(article.id, entry);
      } else {
        entry.marker.setLngLat(target);
      }
      if (entry.title !== article.title) {
        entry.title = article.title;
        entry.el.title = `Статья: ${article.title}`;
        entry.el.setAttribute("aria-label", `Статья на карте: ${article.title}`);
      }
    }
    for (const id of [...shown.keys()]) if (!wanted.has(id)) drop(id);
  });
}
