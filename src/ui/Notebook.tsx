import { useEffect, useState } from "preact/hooks";
import "./notebook.css";
import { Icon } from "./Icon";
import { IconButton } from "./kit";
import type { IconName } from "./icons";
import { formatDate, newestFirst, unseenCount, type Article, type ChronicleEntry, type Find } from "./notebookLogic";

export type { Article, ChronicleEntry, Find } from "./notebookLogic";

export interface NotebookProps {
  finds: Find[];
  articles: Article[];
  chronicle: ChronicleEntry[];
  seen: number;
  onSeen: (count: number) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Tab = "finds" | "history" | "chronicle";

const TABS: [Tab, string][] = [
  ["finds", "Находки"],
  ["history", "История"],
  ["chronicle", "Летопись"],
];
const KIND_ICON: Record<Find["kind"], IconName> = { poi: "find", street: "street", foundations: "foundations" };

export function Notebook({ finds, articles, chronicle, seen, onSeen, open, onOpenChange }: NotebookProps) {
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
        onClick={() => onOpenChange(!open)}
      >
        <Icon name="notebook" size={22} />
        {unseen > 0 && !open && <span class="notebook-badge">{unseen > 99 ? "99+" : unseen}</span>}
      </button>
      {open && (
        <div class="notebook-panel panel">
          <div class="notebook-head">
            <Icon name="notebook" size={20} />
            <h2 class="notebook-title">Записная книжка</h2>
            <IconButton icon="close" size={16} label="Закрыть записную книжку" onClick={() => onOpenChange(false)} />
          </div>
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
                  <div class="notebook-entry" key={a.id}>
                    <span class="notebook-kind">
                      <Icon name="scroll" size={18} />
                    </span>
                    <div class="notebook-main">
                      <div class="notebook-entry-title">{a.title}</div>
                      <div class="notebook-text">{a.extract}</div>
                      <div class="notebook-date">
                        {formatDate(a.at)} ·{" "}
                        <a href={a.url} target="_blank" rel="noopener" lang={a.lang}>
                          Википедия, CC BY-SA 4.0
                        </a>
                      </div>
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
        </div>
      )}
    </div>
  );
}
