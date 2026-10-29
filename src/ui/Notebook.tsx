import { useEffect, useState } from "preact/hooks";
import "./notebook.css";
import { Icon } from "./Icon";
import { IconButton } from "./kit";
import type { IconName } from "./icons";
import { formatDate, newestFirst, unseenCount, type Article, type ChronicleEntry, type Find } from "./notebookLogic";
import { articleDomId, notebookTabForArticle } from "./notebookFocusModel";
import { notebookArticleFocus } from "./notebookFocus";
import { tabId, tabPanelId } from "./tabSemantics";
import { SEMANTIC_IDS } from "./semanticIds";

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

type Tab = "finds" | "history" | "chronicle";

const TABS: [Tab, string][] = [
  ["finds", "Находки"],
  ["history", "История"],
  ["chronicle", "Хроника"],
];
const KIND_ICON: Record<Find["kind"], IconName> = { poi: "find", street: "street", foundations: "foundations" };

export function Notebook({ finds, articles, chronicle, seen, onSeen, open, onOpenChange, onArticleMap }: NotebookProps) {
  const [tab, setTab] = useState<Tab>("finds");
  const total = finds.length + articles.length;
  const unseen = unseenCount(finds, articles, seen);
  const focusedArticle = notebookArticleFocus.value;

  useEffect(() => {
    if (!open || !focusedArticle) return;
    const next = notebookTabForArticle(focusedArticle, tab);
    if (next !== tab) setTab(next);
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

  return (
    <aside class="notebook" aria-label="Записная книжка">
      <button
        class="notebook-toggle panel"
        title="Записная книжка"
        aria-label="Записная книжка"
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
            <h2 class="notebook-title" id={SEMANTIC_IDS.notebookTitle}>Записная книжка</h2>
            <IconButton icon="close" size={16} label="Закрыть записную книжку" onClick={() => onOpenChange(false)} />
          </div>
          <div class="notebook-tabs" role="tablist" aria-label="Разделы записной книжки">
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
              </button>
            ))}
          </div>
          <div class="notebook-body" role="tabpanel" id={tabPanelId("notebook", tab)} aria-labelledby={tabId("notebook", tab)}>
            {tab === "finds" &&
              (finds.length === 0 ? (
                <div class="notebook-empty">Пока ничего не найдено. Осмотрите землю вокруг лагеря.</div>
              ) : (
                newestFirst(finds).map((f) => (
                  <div class="notebook-entry" key={f.id}>
                    <span class="notebook-kind">
                      <Icon name={KIND_ICON[f.kind]} size={18} />
                    </span>
                    <div class="notebook-main">
                      <div class="notebook-entry-title">{f.title}</div>
                      {f.detail && <div class="notebook-text">{f.detail}</div>}
                      <div class="notebook-date">{formatDate(f.at)}</div>
                    </div>
                  </div>
                ))
              ))}
            {tab === "history" &&
              (articles.length === 0 ? (
                <div class="notebook-empty">Ведите раскопки — здесь появятся статьи о найденных местах</div>
              ) : (
                newestFirst(articles).map((a) => (
                  <div class="notebook-entry" id={articleDomId(a.id)} key={a.id}>
                    <span class="notebook-kind">
                      <Icon name="scroll" size={18} />
                    </span>
                    <div class="notebook-main">
                      <button type="button" class="link notebook-entry-title notebook-map-link" title="Показать место статьи на карте" onClick={() => onArticleMap(a)}>
                        {a.title}
                      </button>
                      <div class="notebook-text">
                        {a.extract}
                        <a class="wiki-full-link" href={a.url} target="_blank" rel="noopener" lang={a.lang} title="Открыть полную статью" aria-label={`Открыть полную статью «${a.title}»`}>
                          ^
                        </a>
                      </div>
                      <div class="notebook-date">{formatDate(a.at)} · Википедия, CC BY-SA 4.0</div>
                    </div>
                  </div>
                ))
              ))}
            {tab === "chronicle" &&
              (chronicle.length === 0 ? (
                <div class="notebook-empty">Хроника пуста: история города только начинается.</div>
              ) : (
                newestFirst(chronicle).map((c, i) => (
                  <div class="notebook-entry" key={`${c.at}-${i}`}>
                    <span class="notebook-kind notebook-pen">
                      <Icon name="quill" size={18} />
                    </span>
                    <div class="notebook-main">
                      <div class="notebook-date">{formatDate(c.at)}</div>
                      <div class="notebook-text notebook-ink">{c.text}</div>
                    </div>
                  </div>
                ))
              ))}
          </div>
        </section>
      )}
    </aside>
  );
}
