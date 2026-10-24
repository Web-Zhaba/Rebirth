import { useEffect, useState } from "preact/hooks";
import "./notebook.css";
import { formatDate, newestFirst, unseenCount, type Article, type ChronicleEntry, type Find } from "./notebookLogic";

export type { Article, ChronicleEntry, Find } from "./notebookLogic";

export interface NotebookProps {
  finds: Find[];
  articles: Article[];
  chronicle: ChronicleEntry[];
  seen: number;
  onSeen: (count: number) => void;
}

type Tab = "finds" | "history" | "chronicle";

const TABS: [Tab, string][] = [
  ["finds", "Находки"],
  ["history", "История"],
  ["chronicle", "Летопись"],
];
const KIND_ICON: Record<Find["kind"], string> = { poi: "◉", street: "≡", foundations: "▫" };

export function Notebook({ finds, articles, chronicle, seen, onSeen }: NotebookProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("finds");
  const total = finds.length + articles.length;
  const unseen = unseenCount(finds, articles, seen);

  // While the book is open everything that arrives counts as seen.
  useEffect(() => {
    if (open && total !== seen) onSeen(total);
  }, [open, total, seen, onSeen]);

  return (
    <div class="notebook">
      <button
        class="notebook-toggle panel"
        title="Записная книжка"
        aria-label="Записная книжка"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span class="notebook-icon">📖</span>
        {unseen > 0 && !open && <span class="notebook-badge">{unseen > 99 ? "99+" : unseen}</span>}
      </button>
      {open && (
        <div class="notebook-panel panel">
          <div class="notebook-title">Записная книжка</div>
          <div class="notebook-tabs" role="tablist">
            {TABS.map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                class={tab === id ? "notebook-tab active" : "notebook-tab"}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div class="notebook-body">
            {tab === "finds" &&
              (finds.length === 0 ? (
                <div class="notebook-empty">Пока ничего не найдено. Осмотрите землю вокруг лагеря.</div>
              ) : (
                newestFirst(finds).map((f) => (
                  <div class="notebook-entry" key={f.id}>
                    <div class="notebook-entry-title">
                      <span class="notebook-kind">{KIND_ICON[f.kind]}</span> {f.title}
                    </div>
                    {f.detail && <div class="notebook-text">{f.detail}</div>}
                    <div class="notebook-date">{formatDate(f.at)}</div>
                  </div>
                ))
              ))}
            {tab === "history" &&
              (articles.length === 0 ? (
                <div class="notebook-empty">Статей об этом месте пока нет.</div>
              ) : (
                newestFirst(articles).map((a) => (
                  <div class="notebook-entry" key={a.id}>
                    <div class="notebook-entry-title">{a.title}</div>
                    <div class="notebook-text">{a.extract}</div>
                    <div class="notebook-date">
                      {formatDate(a.at)} ·{" "}
                      <a href={a.url} target="_blank" rel="noopener" lang={a.lang}>
                        Википедия, CC BY-SA 4.0
                      </a>
                    </div>
                  </div>
                ))
              ))}
            {tab === "chronicle" &&
              (chronicle.length === 0 ? (
                <div class="notebook-empty">Летопись пуста: история города только начинается.</div>
              ) : (
                newestFirst(chronicle).map((c, i) => (
                  <div class="notebook-entry" key={`${c.at}-${i}`}>
                    <div class="notebook-date">{formatDate(c.at)}</div>
                    <div class="notebook-text">{c.text}</div>
                  </div>
                ))
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
