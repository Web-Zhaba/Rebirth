import { useEffect, useState } from "preact/hooks";
import "./notebook.css";
import { Icon } from "./Icon";
import { IconButton } from "./kit";
import { calendar } from "../sim/clock";
import { formatDate, newestFirst, type Article, type ChronicleEntry, type Find } from "./notebookLogic";
import { articleDomId, notebookTabForArticle } from "./notebookFocusModel";
import { notebookArticleFocus } from "./notebookFocus";
import { tabId, tabPanelId } from "./tabSemantics";
import { SEMANTIC_IDS } from "./semanticIds";
import { L } from "../i18n";

export type { Article, ChronicleEntry, Find } from "./notebookLogic";

export interface NotebookProps {
  finds: Find[];
  articles: Article[];
  chronicle: ChronicleEntry[];
  seen: number;
  onSeen: (count: number) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onArticleMap: (article: Article) => void;
}

// Two sections only: what the place was, and what the town did. Dug foundations and streets are not listed —
// the player sees those on the map, so the book keeps only what cannot be read there.
type Tab = "history" | "chronicle";

const TABS: [Tab, string][] = [
  ["history", L("История", "History")],
  ["chronicle", L("Хроника", "Chronicle")],
];

const yearOf = (at: number): number => calendar(at).year;

// Entries split by game year, newest first, years newest first too; empty years never appear.
function byYear<T extends { at: number }>(list: readonly T[]): [number, T[]][] {
  const map = new Map<number, T[]>();
  for (const item of newestFirst(list)) {
    const y = yearOf(item.at);
    const bucket = map.get(y);
    if (bucket) bucket.push(item);
    else map.set(y, [item]);
  }
  return [...map.entries()].sort((a, b) => b[0] - a[0]);
}

const hit = (q: string, ...parts: string[]): boolean => {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return parts.some((p) => p.toLowerCase().includes(needle));
};

export function Notebook({ articles, chronicle, seen, onSeen, open, onOpenChange, onArticleMap }: NotebookProps) {
  const [tab, setTab] = useState<Tab>("history");
  const [q, setQ] = useState("");
  const total = articles.length;
  const unseen = Math.max(0, total - seen);
  const focusedArticle = notebookArticleFocus.value;
  const counts: Record<Tab, number> = { history: articles.length, chronicle: chronicle.length };

  useEffect(() => {
    if (!open || !focusedArticle) return;
    const next = notebookTabForArticle(focusedArticle, tab);
    if (next !== tab) setTab(next as Tab);
  }, [open, focusedArticle, tab]);

  useEffect(() => {
    if (!open || tab !== "history" || !focusedArticle) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(articleDomId(focusedArticle))?.scrollIntoView({ block: "nearest" });
      notebookArticleFocus.value = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [open, tab, focusedArticle]);

  // While the book is open everything that arrives counts as seen.
  useEffect(() => {
    if (open && total !== seen) onSeen(total);
  }, [open, total, seen, onSeen]);

  const matches = (a: Article): boolean => hit(q, a.title, a.extract, formatDate(a.at));
  const matchedArticles = articles.filter(matches);
  const matchedChronicle = chronicle.filter((c) => hit(q, c.text, formatDate(c.at)));
  const shown = tab === "history" ? matchedArticles.length : matchedChronicle.length;

  return (
    <aside class="notebook" aria-label={L("Записная книжка", "Notebook")}>
      <button
        class="notebook-toggle panel"
        title={L("Записная книжка", "Notebook")}
        aria-label={L("Записная книжка", "Notebook")}
        aria-expanded={open}
        aria-controls={SEMANTIC_IDS.notebookPanel}
        onClick={() => onOpenChange(!open)}
      >
        <Icon name="notebook" size={22} />
        {unseen > 0 && !open && <span class="notebook-badge">{unseen > 99 ? "99+" : unseen}</span>}
      </button>
      {open && (
        <section class="notebook-panel panel" id={SEMANTIC_IDS.notebookPanel} aria-labelledby={SEMANTIC_IDS.notebookTitle}>
          <div class="notebook-head">
            <Icon name="notebook" size={20} />
            <h2 class="notebook-title" id={SEMANTIC_IDS.notebookTitle}>
              {L("Записная книжка", "Notebook")}
            </h2>
            <IconButton icon="close" size={16} label={L("Закрыть записную книжку", "Close the notebook")} onClick={() => onOpenChange(false)} />
          </div>
          <div class="notebook-tabs" role="tablist" aria-label={L("Разделы записной книжки", "Notebook sections")}>
            {TABS.map(([id, label]) => (
              <button
                key={id}
                role="tab"
                id={tabId("notebook", id)}
                aria-controls={tabPanelId("notebook", id)}
                aria-selected={tab === id}
                tabIndex={tab === id ? 0 : -1}
                class={tab === id ? "notebook-tab active" : "notebook-tab"}
                onClick={() => setTab(id)}
              >
                {label}
                {counts[id] > 0 && <span class="notebook-tab-n">{counts[id]}</span>}
              </button>
            ))}
          </div>
          <div class="notebook-search">
            <Icon name="search" size={14} />
            <input
              type="search"
              aria-label={L("Поиск по записной книжке", "Search the notebook")}
              placeholder={L("Найти запись", "Find an entry")}
              value={q}
              onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            />
            {q && (
              <IconButton icon="close" size={12} label={L("Очистить поиск", "Clear search")} onClick={() => setQ("")} />
            )}
          </div>
          <div class="notebook-body" role="tabpanel" id={tabPanelId("notebook", tab)} aria-labelledby={tabId("notebook", tab)}>
            {shown === 0 && (
              <div class="notebook-empty">
                {q
                  ? L("Ничего не найдено.", "Nothing found.")
                  : tab === "history"
                    ? L("Ведите раскопки — здесь появятся статьи о том, что стояло на этом месте.", "Run digs — articles about what once stood here will appear.")
                    : L("Хроника пуста: история города только начинается.", "The chronicle is empty: the town’s story is just beginning.")}
              </div>
            )}
            {tab === "history" &&
              byYear(matchedArticles).map(([year, list]) => (
                <section class="notebook-year-group" key={year} aria-label={`${L("Год", "Year")} ${year}`}>
                  <div class="notebook-year">{L("Год", "Year")} {year}</div>
                  {list.map((a) => (
                    <div class="notebook-entry" id={articleDomId(a.id)} key={a.id}>
                      <span class="notebook-kind">
                        <Icon name="scroll" size={18} />
                      </span>
                      <div class="notebook-main">
                        <button
                          type="button"
                          class="link notebook-entry-title notebook-map-link"
                          title={L("Показать место статьи на карте", "Show the article’s place on the map")}
                          onClick={() => onArticleMap(a)}
                        >
                          {a.title}
                        </button>
                        <div class="notebook-text">
                          {a.extract}
                          <a
                            class="wiki-full-link"
                            href={a.url}
                            target="_blank"
                            rel="noopener"
                            lang={a.lang}
                            title={L("Открыть полную статью", "Open the full article")}
                            aria-label={L(`Открыть полную статью «${a.title}»`, `Open the full article “${a.title}”`)}
                          >
                            ^
                          </a>
                        </div>
                        <div class="notebook-date">{formatDate(a.at)} · {L("Википедия", "Wikipedia")}, CC BY-SA 4.0</div>
                      </div>
                    </div>
                  ))}
                </section>
              ))}
            {tab === "chronicle" &&
              byYear(matchedChronicle).map(([year, list]) => (
                <section class="notebook-year-group" key={year} aria-label={`${L("Год", "Year")} ${year}`}>
                  <div class="notebook-year">{L("Год", "Year")} {year}</div>
                  {list.map((c, i) => (
                    <div class="notebook-entry" key={`${c.at}-${i}`}>
                      <span class="notebook-kind notebook-pen">
                        <Icon name="quill" size={18} />
                      </span>
                      <div class="notebook-main">
                        <div class="notebook-date">{formatDate(c.at)}</div>
                        <div class="notebook-text notebook-ink">{c.text}</div>
                      </div>
                    </div>
                  ))}
                </section>
              ))}
          </div>
        </section>
      )}
    </aside>
  );
}
