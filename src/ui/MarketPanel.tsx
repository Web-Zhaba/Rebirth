import { signal } from "@preact/signals";
import { BUILDINGS } from "../sim/buildings";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { city, state, stock } from "../simClient";
import { byGood, zeroStock } from "../sim/goods";
import { orderKeep, STALL_NAME_MAX, TRADE, TRADE_GOODS, tradeCapacity, tradeRate, type TradeGood, type TradeOrder } from "../sim/trade";
import type { Stock } from "../sim/types";
import { Icon } from "./Icon";
import { act, num } from "./InspectorParts";
import { OUTPUT } from "./inspectorModel";
import { Button, IconButton, ProgressBar, Segmented } from "./kit";
import { firstStall, generatedStallName, marketView, stallName, type MarketView, type Stall } from "./marketModel";
import { closePanel, openPanel, rightPanel } from "./panels";
import { selectedTech } from "./techState";
import { L } from "../i18n";
import "./market.css";

// The market window. The market is drawn as its row of stalls, each one trade order and each built its own way (a
// striped awning, a peaked tent, a plank shed): the counter shows the crate given and the crate got; a stall the research
// has not opened yet stands shut with a plaque naming the tech. Under the row hang the scales of the opened stall: what
// it gives against what it gets. Beside them (under them on a phone) lies the stall's ledger: its name, the goods, the
// rate, the reserve and the cap. The ledger keeps one shape whatever is chosen, so the window never jumps.

const selStall = signal(0);

// Opens the market window on its first free stall.
export function openMarket(): void {
  const st = state.peek();
  selStall.value = st ? firstStall(marketView(st.progress, st.levers.trade, st.economy.trade, st.economy.traders)) : 0;
  openPanel("market");
}

const EMPTY_STOCK: Stock = zeroStock();
export const TRADE_LABEL: Record<TradeGood, string> = byGood((g) => g.label);
const pairOf = (o: Pick<TradeOrder, "give" | "get">) => `${o.give}>${o.get}`;
const unit = (g: TradeGood) => OUTPUT[g].unit;
const pct = (n: number) => `${Math.round(n * 100)} %`;
const STYLES = ["awning", "tent", "shed"] as const; // how each stall is built, by its place in the row

// The town's seed for the generated stall names, and a stall's name.
const seed = () => city.value?.foundedAt ?? 0;
export const nameOfStall = (i: number) => stallName(i, seed(), state.value?.levers.stallNames);

// ---------- the row of stalls ----------

// The roof of a stall, drawn in a fixed box and stretched to the stall's width, so the stripes always come out whole.
// `a` parts take the stall's colour, `b` parts the bark (market.css colours them, grey for a shut stall).
function Roof({ style, id }: { style: (typeof STYLES)[number]; id: string }) {
  if (style === "awning") {
    // seven stripes, each ending in its own scallop
    return (
      <svg class="mk-roof" viewBox="0 0 140 44" preserveAspectRatio="none" aria-hidden="true">
        {Array.from({ length: 7 }, (_, i) => (
          <g key={i} class={i % 2 === 0 ? "rf-a" : "rf-b"}>
            <rect x={i * 20} y={0} width={20} height={34} />
            <path d={`M${i * 20} 33.5 a10 10 0 0 0 20 0 z`} />
          </g>
        ))}
      </svg>
    );
  }
  if (style === "tent") {
    // a peak of fourteen narrow stripes with a knob on top
    return (
      <svg class="mk-roof" viewBox="0 0 140 54" preserveAspectRatio="none" aria-hidden="true">
        <clipPath id={id}>
          <polygon points="70,4 140,54 0,54" />
        </clipPath>
        <g clip-path={`url(#${id})`}>
          {Array.from({ length: 14 }, (_, i) => (
            <rect key={i} class={i % 2 === 0 ? "rf-a" : "rf-b"} x={i * 10} y={0} width={10} height={54} />
          ))}
        </g>
        <rect class="rf-post" x={69} y={0} width={2} height={6} />
      </svg>
    );
  }
  // a lean-to of planks with a trim along its eave
  return (
    <svg class="mk-roof" viewBox="0 0 140 46" preserveAspectRatio="none" aria-hidden="true">
      <clipPath id={id}>
        <polygon points="0,16 140,0 140,46 0,46" />
      </clipPath>
      <g clip-path={`url(#${id})`}>
        <rect class="rf-plank" x={0} y={0} width={140} height={46} />
        {[8, 16, 24, 32].map((y) => (
          <rect key={y} class="rf-seam" x={0} y={y} width={140} height={1} />
        ))}
        <rect class="rf-a" x={0} y={39} width={140} height={7} />
      </g>
    </svg>
  );
}

// A crate on the counter: the good's mark, its name and what it is for.
function Crate({ good, role }: { good: TradeGood; role: string }) {
  return (
    <span class="mk-crate">
      <Icon name={OUTPUT[good].icon} size={22} />
      <span class="mk-crate-name">{TRADE_LABEL[good]}</span>
      <span class="mk-crate-role">{role}</span>
    </span>
  );
}

function StallButton({ s, sel, onPick }: { s: Stall; sel: boolean; onPick: () => void }) {
  const name = nameOfStall(s.index);
  const what = s.order ? `${TRADE_LABEL[s.order.give]} ${L("на", "for")} ${TRADE_LABEL[s.order.get]}` : s.state === "free" ? L("свободен", "free") : L("закрыт", "shut");
  return (
    <button type="button" class={`mk-stall is-${s.state} st-${STYLES[s.index % STYLES.length]}${sel ? " sel" : ""}`} style={{ "--i": s.index }} aria-pressed={sel} aria-label={`${name}: ${what}`} onClick={onPick}>
      <Roof style={STYLES[s.index % STYLES.length]} id={`mk-roof-${s.index}`} />
      <span class="mk-sign" title={name}>
        {name}
      </span>
      <span class="mk-booth">
        {s.state === "order" && s.order && (
          <span class="mk-counter" key={pairOf(s.order)}>
            <Crate good={s.order.give} role={L("отдаём", "we give")} />
            <Icon name="arrowRight" size={14} class="mk-way" />
            <Crate good={s.order.get} role={L("получаем", "we get")} />
          </span>
        )}
        {s.state === "free" && (
          <span class="mk-counter is-bare">
            <span class="mk-chalk">{L("Свободно", "Free")}</span>
          </span>
        )}
        {s.state === "locked" && (
          <span class="mk-counter is-shut">
            <Icon name="lock" size={14} />
            <span class="mk-plaque">{s.tech ? s.tech.name : L("Закрыт", "Shut")}</span>
          </span>
        )}
      </span>
      <span class="mk-tally">
        {s.swap ? `−${num(s.swap.gave)} ${unit(s.swap.give)} · +${num(s.swap.got)} ${unit(s.swap.get)}` : s.state === "order" ? L("вчера обмена не было", "no trade yesterday") : s.researching ? L("изучается", "being researched") : ""}
      </span>
    </button>
  );
}

// ---------- the scales of the opened stall ----------

// The beam tips by the neighbours' share: the pan of what we give always weighs more than what comes back.
const TILT = TRADE.margin * 24; // degrees
const PIVOT: [number, number] = [180, 44];
const ARM = 118;

// One pan hung from the beam end: the good's mark, its name and the amount.
function Pan({ at, good, amount, caption }: { at: [number, number]; good: TradeGood | null; amount: string; caption: string }) {
  return (
    <g class="mk-pan" style={{ transform: `translate(${at[0]}px, ${at[1]}px)` }}>
      <path class="mk-chain" d="M0 0 L-38 58 M0 0 L38 58" />
      <path class="mk-dish" d="M-48 58 Q0 84 48 58 Z" />
      {good && (
        <g transform="translate(-17 22)">
          <g class="mk-load" key={good}>
            <Icon name={OUTPUT[good].icon} size={34} />
          </g>
        </g>
      )}
      <text class="mk-pan-cap" x={0} y={102}>
        {caption}
      </text>
      <text class="mk-pan-name" x={0} y={122}>
        {good ? TRADE_LABEL[good] : "—"}
      </text>
      <text class="mk-pan-amount" x={0} y={142}>
        {amount}
      </text>
    </g>
  );
}

// The scales of the opened stall: what it gives on the left pan, what it gets on the right; yesterday's weights when it
// traded, else the rate. An empty or shut stall leaves the beam level and the pans bare.
function Scales({ s }: { s: Stall }) {
  const o = s.order;
  const tilt = o ? -TILT : 0;
  const rad = (tilt * Math.PI) / 180;
  const end = (side: -1 | 1): [number, number] => [PIVOT[0] + side * ARM * Math.cos(rad), PIVOT[1] + side * ARM * Math.sin(rad)];
  const give = !o ? "" : s.swap ? `${num(s.swap.gave)} ${unit(o.give)}` : `1 ${unit(o.give)}`;
  const get = !o ? "" : s.swap ? `${num(s.swap.got)} ${unit(o.get)}` : `${num(tradeRate(o))} ${unit(o.get)}`;
  const fee = L(``, ``);
  const note = !o
    ? s.state === "locked"
      ? L("Прилавок закрыт — весы пусты.", "The stall is shut: the scales are empty.")
      : L("Весы пусты: выберите, что прилавок отдаёт.", "The scales are empty: choose what the stall gives.")
    : s.swap
      ? L(`Вчерашний обмен. ${fee}`, `Yesterday's trade. ${fee}`)
      : L("Вчера обмена не было.", "No trade yesterday.");
  return (
    <figure class="mk-scales">
      <svg viewBox="0 0 360 236" role="img" aria-label={o ? `${TRADE_LABEL[o.give]} ${give} = ${TRADE_LABEL[o.get]} ${get}` : note}>
        <path class="mk-stand" d="M130 230 L230 230 L214 214 L146 214 Z" />
        <rect class="mk-stand" x={177} y={PIVOT[1]} width={6} height={172} />
        <g class="mk-beam" style={{ transform: `rotate(${tilt}deg)` }}>
          <rect class="mk-stand" x={PIVOT[0] - ARM} y={PIVOT[1] - 3} width={ARM * 2} height={6} />
          <circle class="mk-stand" cx={PIVOT[0] - ARM} cy={PIVOT[1]} r={4} />
          <circle class="mk-stand" cx={PIVOT[0] + ARM} cy={PIVOT[1]} r={4} />
        </g>
        <path class="mk-needle" d={`M180 ${PIVOT[1]} L180 ${PIVOT[1] - 26}`} style={{ transform: `rotate(${tilt}deg)` }} />
        <circle class="mk-pivot" cx={PIVOT[0]} cy={PIVOT[1]} r={7} />
        <Pan at={end(-1)} good={o?.give ?? null} amount={give} caption={L("отдаём", "we give")} />
        <Pan at={end(1)} good={o?.get ?? null} amount={get} caption={L("получаем", "we get")} />
      </svg>
      <figcaption class="mk-note">{note}</figcaption>
    </figure>
  );
}

// ---------- the ledger of the opened stall ----------

// The stall's name as an editable title: typed and kept on Enter or leaving the field; Escape gives the old one back,
// a blank field the generated name.
function StallName({ index }: { index: number }) {
  const own = state.value?.levers.stallNames?.[index] ?? "";
  const generated = generatedStallName(index, seed());
  const [draft, setDraft] = useState(own);
  const commit = (v: string) => {
    if (v.trim() !== own) act({ type: "nameStall", index, name: v });
  };
  return (
    <div class="mk-name">
      <input
        class="mk-name-input"
        value={draft}
        placeholder={generated}
        maxLength={STALL_NAME_MAX}
        aria-label={L("Название прилавка", "Stall name")}
        enterKeyHint="done"
        onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
        onBlur={(e) => commit((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          e.stopPropagation(); // typing is not a hotkey
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            e.preventDefault();
            setDraft(own);
            (e.target as HTMLInputElement).value = own;
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <Icon name="pencil" size={14} class="mk-name-mark" />
      {own && (
        <IconButton
          icon="eraser"
          size={14}
          label={L("Вернуть название", "Give the name back")}
          onClick={() => {
            setDraft("");
            act({ type: "nameStall", index, name: "" });
          }}
        />
      )}
    </div>
  );
}

// A grid of the trade goods to pick one: icon, name and what the stores hold. `off` dims the whole grid while there is
// nothing to choose yet, keeping its place.
function GoodsPicker({ label, value, disabled, onPick, off }: { label: string; value: TradeGood | null; disabled: (g: TradeGood) => boolean; onPick: (g: TradeGood) => void; off?: boolean }) {
  const st = stock.value ?? EMPTY_STOCK;
  return (
    <div class={`goods-pick${off ? " is-off" : ""}`}>
      <span class="mk-cap">{label}</span>
      <div class="goods-grid" role="radiogroup" aria-label={label} aria-disabled={off || undefined}>
        {TRADE_GOODS.map((g) => (
          <button
            key={g}
            type="button"
            role="radio"
            aria-checked={value === g}
            aria-label={`${label}: ${OUTPUT[g].name}, ${L("на складе", "in store")} ${num(st[g])} ${unit(g)}`}
            title={`${TRADE_LABEL[g]}: ${num(st[g])} ${unit(g)}`}
            class={value === g ? "goods-btn on" : "goods-btn"}
            disabled={off || disabled(g)}
            onClick={() => onPick(g)}
          >
            <Icon name={OUTPUT[g].icon} size={18} />
            <span class="goods-name">{TRADE_LABEL[g]}</span>
            <span class="goods-amount">{num(st[g])}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// A − value + control for a trade reserve or cap, stepping by the good's TRADE.step.
function Stepper({ label, good, value, onSet }: { label: string; good: TradeGood; value: number; onSet: (v: number) => void }) {
  const step = TRADE.step[good];
  return (
    <div class="mk-step">
      <span>{label}</span>
      <span class="staff-ctl" role="group" aria-label={label}>
        <IconButton icon="minus" size={14} label={`${label}: ${L("меньше", "less")}`} disabled={value <= 0} onClick={() => onSet(Math.max(0, Math.ceil(value / step) * step - step))} />
        <b aria-live="polite">
          {num(value)} {unit(good)}
        </b>
        <IconButton icon="plus" size={14} label={`${label}: ${L("больше", "more")}`} disabled={value >= TRADE.limit} onClick={() => onSet(Math.min(TRADE.limit, Math.floor(value / step) * step + step))} />
      </span>
    </div>
  );
}

function Note({ tone, children }: { tone?: "warn"; children: ComponentChildren }) {
  return <p class={tone ? "mk-note is-warn" : "mk-note"}>{children}</p>;
}

// The ledger of an open stall: what it gives and gets, the rate, its reserve and cap. Every block is there from the
// start, empty or dimmed until there is something to show.
function Ledger({ s, v, orders, workers }: { s: Stall; v: MarketView; orders: TradeOrder[]; workers: number }) {
  const order = s.order;
  const st = stock.value ?? EMPTY_STOCK;
  const taken = new Set(orders.filter((_, i) => i !== s.index).map(pairOf));
  const free = (give: TradeGood, g: TradeGood) => g !== give && !taken.has(pairOf({ give, get: g }));
  const set = (next: TradeOrder[]) => act({ type: "setTrade", orders: next });
  const put = (o: TradeOrder | null) => set(o ? (order ? orders.map((x, i) => (i === s.index ? o : x)) : [...orders, o]) : orders.filter((_, i) => i !== s.index));
  const pickGive = (give: TradeGood) => {
    const get = order && free(give, order.get) ? order.get : (["food", "tools", ...TRADE_GOODS] as TradeGood[]).find((g) => free(give, g));
    if (get) put({ give, get, ...(order?.until !== undefined && get === order.get ? { until: order.until } : {}) });
  };
  const capAt = (g: TradeGood) => Math.max(TRADE.step[g], Math.ceil(st[g] / TRADE.step[g]) * TRADE.step[g]);
  const surplus = order ? st[order.give] - orderKeep(order) : 0;
  const capped = order?.until !== undefined && st[order.get] >= order.until;
  return (
    <>
      <GoodsPicker label={L("Отдаём", "We give")} value={order?.give ?? null} disabled={(g) => !TRADE_GOODS.some((h) => free(g, h))} onPick={pickGive} />
      <GoodsPicker label={L("Получаем", "We get")} value={order?.get ?? null} off={!order} disabled={(g) => !order || !free(order.give, g)} onPick={(g) => order && put({ give: order.give, get: g, ...(order.keep !== undefined ? { keep: order.keep } : {}) })} />
      <div class="mk-rate">
        <span class="mk-cap">{L("Курс обмена", "Rate")}</span>
        {order ? (
          <>
            <b>
              1 {unit(order.give)} {TRADE_LABEL[order.give].toLowerCase()} = {num(tradeRate(order))} {unit(order.get)} {TRADE_LABEL[order.get].toLowerCase()}
            </b>
            <span>
              {L("до", "up to")} {num(tradeCapacity(order, workers))} {unit(order.give)} {L("в день", "a day")}
              {s.index > 0 && L(", из того, что оставят прилавки до этого", ", of what the stalls before it leave")}
            </span>
          </>
        ) : (
          <span>{L("Выберите, что прилавок отдаёт соседям, затем — что берёт взамен.", "Choose what the stall gives the neighbours, then what it takes in return.")}</span>
        )}
      </div>
      <div class="mk-limits">
        <span class="mk-cap">{L("Запас и предел", "Reserve and cap")}</span>
        {!order ? (
          <span class="mk-dim">—</span>
        ) : v.limits ? (
          <>
            <Stepper label={L("Не отдаём ниже", "Keep at least")} good={order.give} value={orderKeep(order)} onSet={(keep) => put({ ...order, keep })} />
            <Segmented
              label={L("Предел получения", "Getting cap")}
              value={order.until === undefined ? "free" : "cap"}
              options={[
                { id: "free", label: L("Без предела", "No cap"), title: L("Получать без предела", "Get with no cap") },
                { id: "cap", label: L("До запаса", "Up to a stock"), title: L("Получать, пока на складе меньше предела", "Get while the store holds less than the cap") },
              ]}
              onChange={(id) => put(id === "cap" ? { ...order, until: order.until ?? capAt(order.get) } : { give: order.give, get: order.get, ...(order.keep !== undefined ? { keep: order.keep } : {}) })}
            />
            {order.until !== undefined && <Stepper label={L("Получаем, пока меньше", "Get while below")} good={order.get} value={order.until} onSet={(until) => put({ ...order, until })} />}
          </>
        ) : (
          <Note>{L(`Остаётся на складе ${num(orderKeep(order))} ${unit(order.give)}. Свой запас и предел — исследование «Учёт запасов».`, `${num(orderKeep(order))} ${unit(order.give)} stay in store. A reserve and a cap of its own: research “Stock keeping”.`)}</Note>
        )}
      </div>
      {order && workers > 0 && surplus <= 0 && <Note tone="warn">{L("Излишков нет: всё, что есть, остаётся на складе", "No surplus: everything stays in store")}</Note>}
      {order && workers > 0 && capped && <Note>{L("Предел достигнут: прилавок ждёт, пока запас не уменьшится", "Cap reached: the stall waits until the stock drops")}</Note>}
      {order && (
        <Button class="mk-clear" onClick={() => put(null)}>
          {L("Освободить прилавок", "Clear the stall")}
        </Button>
      )}
    </>
  );
}

// A shut stall: which tech opens it and the way to it.
function Shut({ s }: { s: Stall }) {
  if (!s.tech) return <Note>{L("Этот прилавок пока закрыт.", "This stall is shut for now.")}</Note>;
  const t = s.tech;
  return (
    <>
      <Note>
        {L(`Прилавок откроет исследование «${t.name}».`, `The research “${t.name}” opens this stall.`)} {t.description}
      </Note>
      {s.researching && <Note>{L("Уже изучается.", "Being researched now.")}</Note>}
      <Button
        variant="primary"
        class="mk-clear"
        onClick={() => {
          selectedTech.value = t.id;
          openPanel("tech");
        }}
      >
        {L("К исследованиям", "To research")}
      </Button>
    </>
  );
}

export function MarketPanel() {
  const st = state.value;
  if (rightPanel.value !== "market" || !st) return null;
  const orders = st.levers.trade;
  const workers = st.economy.traders;
  const v = marketView(st.progress, orders, st.economy.trade, workers);
  const s = v.stalls[Math.min(selStall.value, v.stalls.length - 1)];
  const markets = Object.values(st.buildings).filter((b) => BUILDINGS[b.template]?.trades && b.state === "active").length;
  return (
    <div class="mk-screen" role="dialog" aria-modal="false" aria-label={L("Рынок", "Market")}>
      <div class="mk-sheet">
        <header class="mk-head">
          <div class="mk-title-block">
            <h2 class="mk-title">{L("Рынок", "Market")}</h2>
            <span class="mk-sub">{L(`рынков ${markets} · торговцев ${num(workers)} · прилавков ${v.slots} из ${v.stalls.length}`, `${markets} markets · ${num(workers)} traders · ${v.slots} of ${v.stalls.length} stalls`)}</span>
          </div>
          <IconButton icon="close" size={18} label={L("Закрыть", "Close")} onClick={closePanel} />
        </header>
        <div class="mk-body">
          <div class="mk-square">
            <div class="mk-row" role="group" aria-label={L("Торговый ряд", "The market row")}>
              {v.stalls.map((x) => (
                // a free stall always opens as the next one in line: the orders are kept in order
                <StallButton key={x.index} s={x} sel={x.index === s.index} onPick={() => (selStall.value = x.state === "free" ? orders.length : x.index)} />
              ))}
            </div>
            {workers === 0 && <Note tone="warn">{L("Некому торговать: нужны работники рынка", "No one to trade: the market needs workers")}</Note>}
            <Scales s={s} />
          </div>
          <section class="mk-ledger" aria-label={nameOfStall(s.index)}>
            <div class="mk-ledger-body" key={s.index}>
              <StallName key={`${s.index}:${st.levers.stallNames?.[s.index] ?? ""}`} index={s.index} />
              {s.state === "locked" ? <Shut s={s} /> : <Ledger s={s} v={v} orders={orders} workers={workers} />}
            </div>
          </section>
        </div>
        <footer class="mk-foot">
          <span class="mk-cap">{L("Объём вчера", "Volume yesterday")}</span>
          <ProgressBar value={v.used} label={L(`Вчера занято ${pct(v.used)} объёма рынка`, `Yesterday ${pct(v.used)} of the market volume was used`)} />
          <b>{pct(v.used)}</b>
          <span class="mk-foot-note">{L("Прилавки делят объём по порядку; обмен общий для всех рынков города.", "The stalls share the volume in order; the trade is shared by all the town's markets.")}</span>
        </footer>
      </div>
    </div>
  );
}
