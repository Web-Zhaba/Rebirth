import { effect } from "@preact/signals";
import { h, render } from "preact";
import { articles } from "../../simClient";
import { Icon } from "../../ui/Icon";
import { articleMapTarget } from "../../ui/articleMapModel";
import { notebookArticleFocus } from "../../ui/notebookFocus";
import { openPanel } from "../../ui/panels";
import type { View, ViewMarker } from "../view";

interface MarkerEntry {
  marker: ViewMarker;
  el: HTMLButtonElement;
  title: string;
}

// One compact notebook marker per saved Wikipedia entry. Articles already store their source coordinates,
// so this layer is entirely local and also works after reloading a save.
export function attachArticleMarkers(view: View): void {
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
        el.className = "wiki-map-marker";
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          notebookArticleFocus.value = article.id;
          openPanel("notebook");
        });
        render(h(Icon, { name: "scroll", size: 14 }), el);
        // The renderer positions the holder; the button keeps its own classes.
        const holder = document.createElement("div");
        holder.append(el);
        entry = { marker: view.addMarker({ element: holder, anchor: "bottom" }, target), el, title: "" };
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
