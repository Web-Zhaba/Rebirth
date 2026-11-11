import { signal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { pickTool, lockOf } from "../map/toolPick";
import { recentTools } from "../map/tools";
import { categoryOf, toolLabel, TOOL_ICON } from "./buildMenu";
import { Icon } from "./Icon";
import { searchTools, type SearchHit } from "./toolSearchModel";
import { L } from "../i18n";

// The search line over the build bar (docs/PLAN-build.md section 3.2): «/» or the dock's button opens it; typing
// filters the tools and their kinds, Enter picks, Esc closes. Empty, it lists the recent tools of Alt+1–4.
export const searchOpen = signal(false);

const LIST_ID = "tool-search-list";

export function ToolSearch() {
  const open = searchOpen.value;
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setAt(0);
    input.current?.focus();
  }, [open]);
  if (!open) return null;
  const recent = !query.trim();
  const hits: SearchHit[] = recent ? recentTools.value.map((t) => ({ tool: t, label: toolLabel(t), sub: categoryOf(t).label })) : searchTools(query);
  const close = () => (searchOpen.value = false);
  const choose = (h: SearchHit) => {
    if (pickTool(h.tool, h.kind)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault(); // the tool in hand stays
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (hits.length > 0) setAt((at + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hits[at]) choose(hits[at]);
    }
  };
  return (
    <div class="bb-search" role="search">
      <input
        ref={input}
        class="bb-search-input"
        type="search"
        value={query}
        placeholder={L("Найти здание или инструмент", "Find a building or a tool")}
        aria-label={L("Поиск инструмента", "Tool search")}
        aria-controls={LIST_ID}
        aria-activedescendant={hits[at] ? `${LIST_ID}-${at}` : undefined}
        onInput={(e) => {
          setQuery((e.target as HTMLInputElement).value);
          setAt(0);
        }}
        onKeyDown={onKey}
        onBlur={close}
      />
      {hits.length > 0 ? (
        <ul class="bb-search-list" id={LIST_ID} role="listbox" aria-label={recent ? L("Недавние", "Recent") : L("Найдено", "Found")}>
          {hits.map((h, i) => {
            const lock = lockOf(h.tool, h.kind);
            return (
              <li
                key={`${h.tool}:${h.kind ?? ""}`}
                id={`${LIST_ID}-${i}`}
                role="option"
                aria-selected={i === at}
                aria-disabled={lock ? true : undefined}
                class={`bb-search-hit${i === at ? " on" : ""}${lock ? " locked" : ""}`}
                title={lock ?? undefined}
                onMouseDown={(e) => {
                  e.preventDefault(); // the line keeps focus until the pick closes it
                  choose(h);
                }}
                onMouseEnter={() => setAt(i)}
              >
                <Icon name={TOOL_ICON[h.tool]} size={16} />
                <span class="bb-search-name">{h.label}</span>
                <span class="bb-search-sub">{recent ? `Alt+${i + 1}` : h.sub}</span>
                {lock && <Icon name="lock" size={12} />}
              </li>
            );
          })}
        </ul>
      ) : (
        <div class="bb-search-none">{recent ? L("Здесь будут недавние инструменты (Alt+1–4)", "Recent tools show here (Alt+1–4)") : L("Ничего не нашлось", "Nothing found")}</div>
      )}
    </div>
  );
}
