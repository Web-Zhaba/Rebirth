import { effect, signal } from "@preact/signals";
import { h, render } from "preact";
import { articles } from "../../simClient";
import { Icon } from "../../ui/Icon";
import { articleMapTarget } from "../../ui/articleMapModel";
import { notebookArticleFocus } from "../../ui/notebookFocus";
import { openPanel } from "../../ui/panels";
import type { View, ViewMarker } from "../view";
import { BADGE_MAX_MPP } from "./badges";
import { L } from "../../i18n";

interface MarkerEntry {
  marker: ViewMarker;
  el: HTMLButtonElement;
  title: string;
}

// One map badge (.map-badge, feedback.css) per saved Wikipedia entry, opening its page in the notebook. Articles already
// store their source coordinates, so this layer is entirely local and also works after reloading a save.
export function attachArticleMarkers(view: View): void {
  const shown = new Map<string, MarkerEntry>();

  // Like the other map badges, gone when zoomed out past BADGE_MAX_MPP (removed, so they cost nothing per frame there).
  const far = signal(view.metersPerPixel() > BADGE_MAX_MPP);
  view.on("moveend", () => (far.value = view.metersPerPixel() > BADGE_MAX_MPP));

  const drop = (id: string) => {
    shown.get(id)?.marker.remove();
    shown.delete(id);
  };

  effect(() => {
    const all = far.value ? [] : articles.value;
    const wanted = new Set<string>();
    for (const article of all) {
      const target = articleMapTarget(article);
      if (!target) continue;
      wanted.add(article.id);
      let entry = shown.get(article.id);
      if (!entry) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "map-badge map-badge-article";
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          notebookArticleFocus.value = article.id;
          openPanel("notebook");
        });
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
        entry.el.title = `${article.title}. ${L("Открыть в тетради", "Open in the notebook")}`;
        render(h("span", { class: "map-badge-in" }, h(Icon, { name: "scroll", size: 12 }), h("span", { class: "map-badge-text" }, article.title)), entry.el);
      }
    }
    for (const id of [...shown.keys()]) if (!wanted.has(id)) drop(id);
  });
}
