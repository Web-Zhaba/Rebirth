import { signal } from "@preact/signals";
import { useState } from "preact/hooks";
import type { View } from "../view/view";
import { atLeastAsClose, CLOSE_UP_MPP } from "../view/scale";
import { flash } from "../map/tools";
import { frame, sendCmd, state } from "../simClient";
import { num } from "./InspectorParts";
import { Button, Confirm, IconButton, ProgressBar, Segmented } from "./kit";
import { KIND_NAME, museumView, pullPct, researchPct, type HallRow, type MuseumRow, type MuseumView, type ShowcaseItem, type ThemeRow } from "./museumModel";
import { inFrame, mapFrame, museumPlan, toMap } from "./museumPlan";
import { closePanel, openPanel, rightPanel } from "./panels";
import { centroid } from "../sim/excavation";
import { MUSEUM } from "../sim/museum";
import type { Cmd } from "../sim/protocol";
import type { ClientState } from "../sim/types";
import { L } from "../i18n";
import "./tech.css";
import "./museum.css";

// The museum window. The museum is drawn as its own plan: the old ring it stands
// on, cut into its halls. A hall opened shows its exhibition as museum labels, or where its finds lie on a small map.
// Under the plan, the storeroom: the themes not on show, as crates to put into a hall (a click, or a drag onto a room).

type HallKey = { museum: number; index: number };
type Pt = [number, number];

const selMuseum = signal<number | null>(null);
const selHall = signal<HallKey | null>(null);
const selTheme = signal<string | null>(null); // a crate taken from the storeroom; null: the theme of the hall
const mode = signal<"case" | "map">("case");

// Opens the museum window on a hall of this museum: its first empty one, or the first.
export function openMuseum(building: number, firstEmpty: number | null): void {
  selMuseum.value = building;
  selHall.value = { museum: building, index: firstEmpty ?? 0 };
  selTheme.value = null;
  openPanel("museum");
}

const send = async (cmd: Cmd): Promise<boolean> => {
  const r = await sendCmd(cmd);
  if (!r.ok) flash(r.reason ?? L("Не вышло", "That didn't work"));
  return r.ok;
};

// Shows a theme in a hall; a theme on show elsewhere leaves its old hall first.
async function putTheme(t: ThemeRow, hall: HallKey): Promise<void> {
  if (t.hall && t.hall.museum === hall.museum && t.hall.index === hall.index) return;
  if (t.hall && !(await send({ type: "setExhibition", building: t.hall.museum, hall: t.hall.index, theme: null }))) return;
  if (await send({ type: "setExhibition", building: hall.museum, hall: hall.index, theme: t.key })) selTheme.value = null;
}

const takeOut = (h: HallRow) => send({ type: "setExhibition", building: h.museum, hall: h.index, theme: null });

const sameHall = (h: HallRow | null, k: HallKey | null): boolean => !!h && !!k && h.museum === k.museum && h.index === k.index;
const ratio = (shown: number, showable: number): string => `${shown}/${showable}`;
const DRAG = "application/x-rebirth-theme";

function Seal({ small }: { small?: boolean }) {
  return (
    <span class={`mu-seal${small ? " is-small" : ""}`} aria-label={L("полная выставка", "complete exhibition")}>
      {L("ПОЛНАЯ", "FULL")}
    </span>
  );
}

// ---------- the plan ----------

function Plan({ m, v, sel }: { m: MuseumRow; v: MuseumView; sel: HallKey | null }) {
  const p = museumPlan(m.footprint, m.halls.length);
  const pts = p.outline.map((q) => q.join(",")).join(" ");
  const clip = `mu-clip-${m.id}`;
  const hs = p.width / 48; // hatch pitch of an empty hall, in plan units
  const [over, setOver] = useState<number | null>(null); // a crate dragged over this room
  const [hover, setHover] = useState<number | null>(null);
  const drop = (h: HallRow, e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const key = e.dataTransfer?.getData(DRAG);
    const t = key ? v.themes.find((x) => x.key === key) : undefined;
    if (t) void putTheme(t, h);
  };
  return (
    <div class="mu-plan" style={{ aspectRatio: `${p.width} / ${p.height}` }}>
      <svg class="mu-plan-svg" viewBox={`0 0 ${p.width} ${p.height}`} aria-hidden="true">
        <defs>
          <clipPath id={clip}>
            <polygon points={pts} />
          </clipPath>
          <pattern id={`${clip}-hatch`} width={hs} height={hs} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={hs} height={hs} class="mu-room-fill" />
            <line x1="0" y1="0" x2="0" y2={hs} class="mu-hatch" stroke-width={hs * 0.12} />
          </pattern>
        </defs>
        <g clip-path={`url(#${clip})`}>
          {p.rooms.map((r) => {
            const h = m.halls[r.index];
            return <rect key={r.index} x={r.x} y={r.y} width={r.w} height={r.h} class={`mu-room-fill${h?.theme ? ` dom-${h.domain}` : ""}`} fill={h?.theme ? undefined : `url(#${clip}-hatch)`} />;
          })}
          {[hover, over].map((k, i) => {
            const r = k === null ? undefined : p.rooms[k];
            return r && <rect key={`h${i}`} x={r.x} y={r.y} width={r.w} height={r.h} class={i === 0 ? "mu-room-hot" : "mu-room-drop"} />;
          })}
          {p.rooms.map((r) => (
            <rect key={`w${r.index}`} x={r.x} y={r.y} width={r.w} height={r.h} class="mu-wall" />
          ))}
        </g>
        <polygon points={pts} class="mu-outline" />
      </svg>
      {p.rooms.map((r) => {
        const h = m.halls[r.index];
        if (!h) return null;
        const on = sameHall(h, sel);
        return (
          <button
            key={r.index}
            type="button"
            class={`mu-room${on ? " sel" : ""}${h.theme ? "" : " is-empty"}`}
            style={{ left: `${(r.x / p.width) * 100}%`, top: `${(r.y / p.height) * 100}%`, width: `${(r.w / p.width) * 100}%`, height: `${(r.h / p.height) * 100}%` }}
            aria-pressed={on}
            aria-label={`${L(`Зал ${h.index + 1}`, `Hall ${h.index + 1}`)}: ${h.themeName ?? L("пусто", "empty")}`}
            draggable={!!h.theme}
            onDragStart={(e) => h.theme && e.dataTransfer?.setData(DRAG, h.theme)}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(r.index);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => drop(h, e)}
            onMouseEnter={() => setHover(r.index)}
            onMouseLeave={() => setHover(null)}
            onClick={() => {
              selHall.value = { museum: h.museum, index: h.index };
              selTheme.value = null;
            }}
          >
            <span class="mu-room-no">{L(`Зал ${h.index + 1}`, `Hall ${h.index + 1}`)}</span>
            <span class="mu-room-theme">{h.themeName ?? L("пусто", "empty")}</span>
            {h.theme && (h.complete ? <Seal small /> : <span class="mu-room-count">{ratio(h.shown, h.showable)}</span>)}
          </button>
        );
      })}
    </div>
  );
}

// ---------- the opened hall ----------

const STATE_TEXT: Record<ShowcaseItem["state"], string> = {
  shown: L("в витрине", "on show"),
  returned: L("возвращена на место", "back in its place"),
  used: L("пущена в дело", "put to use"),
  unfound: L("ещё не найдена", "not found yet"),
};

const CASE_FIRST = 12; // labels shown before «show all»: a street theme can have dozens

function Labels({ t, onFly }: { t: ThemeRow; onFly: (at: Pt) => void }) {
  const [all, setAll] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ item: ShowcaseItem; action: "return" | "use" } | null>(null);
  const cmd = (item: ShowcaseItem, action: "return" | "use"): Cmd => (action === "return" ? { type: "returnFind", id: item.id } : { type: "useFind", id: item.id });
  const act = (item: ShowcaseItem, action: "return" | "use") => (item.breaks ? setAsk({ item, action }) : void send(cmd(item, action)));
  const list = all === t.key ? t.items : t.items.slice(0, CASE_FIRST);
  return (
    <>
      <ul class="mu-labels" aria-label={L("Этикетки", "Labels")}>
        {list.map((i) => (
          <li key={i.id} class={`mu-label is-${i.state}`}>
            <span class="mu-label-no">№ {i.no}</span>
            <span class="mu-label-name">{i.name ?? L("Место оставлено", "A place kept")}</span>
            <span class="mu-label-meta">{i.state === "unfound" ? (i.beyond ? L("за пределами разведки", "beyond the survey") : STATE_TEXT.unfound) : `${KIND_NAME[i.kind]} · ${i.source}`}</span>
            {i.state !== "shown" && i.state !== "unfound" && <span class="mu-label-meta">{STATE_TEXT[i.state]}</span>}
            {i.returnWhy && <span class="mu-label-why">{i.returnWhy}</span>}
            <span class="mu-label-acts">
              {i.canReturn && (
                <button type="button" class="link" onClick={() => act(i, "return")}>
                  {L("Вернуть на место", "Return")}
                </button>
              )}
              {i.canUse && (
                <button type="button" class="link" onClick={() => act(i, "use")}>
                  {L("Пустить в дело", "Put to use")}
                </button>
              )}
              <button type="button" class="link" onClick={() => onFly(i.at)}>
                {i.state === "unfound" ? L("Где искать", "Where to look") : L("На карте", "On the map")}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {t.items.length > CASE_FIRST && (
        <button type="button" class="link mu-more" onClick={() => setAll(all === t.key ? null : t.key)}>
          {all === t.key ? L("Свернуть", "Fold") : L(`Показать все ${t.items.length}`, `Show all ${t.items.length}`)}
        </button>
      )}
      {ask && (
        <Confirm
          title={ask.action === "return" ? L("Вернуть находку?", "Return the find?") : L("Пустить находку в дело?", "Put the find to use?")}
          okLabel={ask.action === "return" ? L("Вернуть", "Return") : L("Пустить в дело", "Put to use")}
          onCancel={() => setAsk(null)}
          onOk={() => {
            void send(cmd(ask.item, ask.action));
            setAsk(null);
          }}
        >
          {L(`В выставке «${t.name}» останется меньше ${MUSEUM.min} находок: зал перестанет давать науку и привлекательность.`, `The “${t.name}” exhibition will have fewer than ${MUSEUM.min} finds: its hall stops giving research and appeal.`)}
        </Confirm>
      )}
    </>
  );
}

// Where the theme's finds lie: the roads and dug foundations around them, the museum, each find a mark.
function ThemeMap({ t, m, st, onFly }: { t: ThemeRow; m: MuseumRow; st: ClientState; onFly: (at: Pt) => void }) {
  const f = mapFrame([...t.items.map((i) => i.at), m.at]);
  const roads = Object.values(st.roads.edges).flatMap((e) => {
    const a = st.roads.nodes[e.a];
    const b = st.roads.nodes[e.b];
    if (!a || !b || (!inFrame(f, [a.x, a.y]) && !inFrame(f, [b.x, b.y]))) return [];
    const [x1, y1] = toMap(f, [a.x, a.y]);
    const [x2, y2] = toMap(f, [b.x, b.y]);
    return [<line key={e.id} x1={x1} y1={y1} x2={x2} y2={y2} class="mu-map-road" />];
  });
  const rings = st.finds.foundations.flatMap((r) => {
    if (r.ghost || !inFrame(f, centroid(r.ring))) return [];
    return [<polygon key={r.id} points={r.ring.map((q) => toMap(f, q).join(",")).join(" ")} class="mu-map-ring" />];
  });
  const [mx, my] = toMap(f, m.at);
  const scale = Math.round(f.size / 5 / 10) * 10; // a fifth of the map, rounded to 10 m
  return (
    <figure class="mu-map">
      <svg viewBox="0 0 1000 1000" role="img" aria-label={L(`Где лежат находки темы «${t.name}»`, `Where the finds of “${t.name}” lie`)}>
        <rect width="1000" height="1000" class="mu-map-ground" />
        {roads}
        {rings}
        <rect x={mx - 14} y={my - 14} width="28" height="28" class="mu-map-museum" />
        {t.items.map((i) => {
          const [x, y] = toMap(f, i.at);
          const label = `${i.name ?? L("Ненайденная находка", "A find not found yet")}: ${STATE_TEXT[i.state]}`;
          return (
            <g key={i.id} class={`mu-map-find is-${i.state}`} role="button" tabIndex={0} aria-label={label} onClick={() => onFly(i.at)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onFly(i.at)}>
              <title>{label}</title>
              {i.state === "unfound" ? <circle cx={x} cy={y} r="13" /> : <rect x={x - 9} y={y - 9} width="18" height="18" />}
            </g>
          );
        })}
        <g class="mu-map-scale">
          <line x1="40" y1="960" x2={40 + (scale / f.size) * 1000} y2="960" />
          <text x="40" y="944">
            {scale} {L("м", "m")}
          </text>
        </g>
      </svg>
      <figcaption class="mu-map-legend">
        <span>
          <i class="lg-museum" />
          {L("музей", "museum")}
        </span>
        <span>
          <i class="lg-shown" />
          {L("найдена", "found")}
        </span>
        <span>
          <i class="lg-out" />
          {L("возвращена или в деле", "returned or used")}
        </span>
        <span>
          <i class="lg-unfound" />
          {L("где искать", "where to look")}
        </span>
      </figcaption>
    </figure>
  );
}

function Hall({ v, m, hall, t, st, onFly }: { v: MuseumView; m: MuseumRow; hall: HallRow; t: ThemeRow | null; st: ClientState; onFly: (at: Pt) => void }) {
  const fromStore = !!t && !sameHall(t.hall, hall);
  const value = t ? Math.round(t.quality * m.strength * 100) / 100 : 0;
  return (
    <section class={`mu-hall-card${t ? ` dom-${t.domain}` : ""}`} aria-label={L(`Зал ${hall.index + 1}`, `Hall ${hall.index + 1}`)}>
      <header class="mu-hall-head">
        <span class="mu-cap">
          {L(`Зал ${hall.index + 1}`, `Hall ${hall.index + 1}`)}
          {fromStore && L(" · из запасника", " · from the storeroom")}
        </span>
        {t ? (
          <h3 class="mu-hall-name">
            <i class="tl-sw" />
            {t.name}
          </h3>
        ) : (
          <h3 class="mu-hall-name is-empty">{L("Зал пуст", "The hall is empty")}</h3>
        )}
        {t?.complete && <Seal />}
      </header>
      {t ? (
        <>
          <dl class="tl-facts">
            <dt>{L("Область знаний", "Field")}</dt>
            <dd>{t.domainName}</dd>
            <dt>{L("Показано", "Shown")}</dt>
            <dd>
              {t.shown} {L("из", "of")} {t.showable}
            </dd>
            <dt>{L("Выставка", "Exhibition")}</dt>
            <dd>{t.complete ? L("полная", "complete") : t.quality > 0 ? L(`неполная, ${Math.round(t.quality * 100)} % силы`, `incomplete, ${Math.round(t.quality * 100)}% strength`) : L(`нужно не меньше ${MUSEUM.min} находок`, `needs ${MUSEUM.min} finds at least`)}</dd>
            <dt>{fromStore ? L("Здесь даст", "Would give here") : L("Даёт", "Gives")}</dt>
            <dd>{value > 0 ? L(`наука +${num(researchPct(value))} %, город +${num(pullPct(value))} %`, `research +${num(researchPct(value))}%, town +${num(pullPct(value))}%`) : L("ничего", "nothing")}</dd>
          </dl>
          {t.unfound > 0 && <p class="mu-note">{L(`До полной выставки не хватает ${t.unfound}: они найдутся при раскопках рядом с их местами.`, `${t.unfound} missing for a complete exhibition: they turn up when digging near their places.`)}</p>}
          <div class="mu-hall-acts">
            {fromStore && (
              <Button variant="primary" onClick={() => void putTheme(t, hall)}>
                {hall.theme ? L(`Заменить «${hall.themeName}»`, `Replace “${hall.themeName}”`) : L(`Поставить в зал ${hall.index + 1}`, `Show in hall ${hall.index + 1}`)}
              </Button>
            )}
            {fromStore ? (
              <Button onClick={() => (selTheme.value = null)}>{L("Вернуть в запасник", "Back to the storeroom")}</Button>
            ) : (
              <Button onClick={() => void takeOut(hall)}>{L("Убрать в запасник", "Into the storeroom")}</Button>
            )}
          </div>
          <Segmented
            label={L("Показать", "Show")}
            value={mode.value}
            onChange={(id) => (mode.value = id)}
            options={[
              { id: "case", label: L("Витрина", "Showcase"), title: L("Этикетки находок", "The finds' labels") },
              { id: "map", label: L("На карте", "On the map"), title: L("Где лежат находки", "Where the finds lie") },
            ]}
          />
          {mode.value === "case" ? <Labels t={t} onFly={onFly} /> : <ThemeMap t={t} m={m} st={st} onFly={onFly} />}
        </>
      ) : (
        <p class="mu-note">
          {v.themes.length === 0
            ? L("Находок для выставок пока нет: раскапывайте фундаменты.", "No finds to exhibit yet: dig foundations.")
            : L("Выберите ящик в запаснике внизу или перетащите его на зал плана.", "Pick a crate in the storeroom below, or drag it onto a hall of the plan.")}
        </p>
      )}
    </section>
  );
}

// ---------- the storeroom ----------

function Storeroom({ v, picked }: { v: MuseumView; picked: string | null }) {
  const crates = v.themes.filter((t) => !t.hall);
  const [over, setOver] = useState(false);
  return (
    <section
      class={`mu-store${over ? " is-over" : ""}`}
      aria-label={L("Запасник", "Storeroom")}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const t = v.themes.find((x) => x.key === e.dataTransfer?.getData(DRAG));
        if (t?.hall) void takeOut(t.hall);
      }}
    >
      <h2 class="mu-store-cap">
        {L("Запасник", "Storeroom")} <span>{crates.length}</span>
      </h2>
      {crates.length === 0 ? (
        <p class="mu-store-empty">{v.themes.length === 0 ? L("Пусто: находки появятся с раскопками.", "Empty: finds come with digging.") : L("Все темы в залах.", "Every theme is on show.")}</p>
      ) : (
        <ul class="mu-crates">
          {crates.map((t) => (
            <li key={t.key}>
              <button
                type="button"
                class={`mu-crate dom-${t.domain}${picked === t.key ? " sel" : ""}${t.quality > 0 ? "" : " is-thin"}`}
                aria-pressed={picked === t.key}
                draggable
                onDragStart={(e) => e.dataTransfer?.setData(DRAG, t.key)}
                onClick={() => (selTheme.value = picked === t.key ? null : t.key)}
              >
                <span class="mu-crate-name">
                  <i class="tl-sw" />
                  {t.name}
                </span>
                <span class="mu-crate-meta">
                  {ratio(t.shown, t.showable)} · {t.complete ? L("полная", "complete") : t.quality > 0 ? L(`часть ${Math.round(t.quality * 100)} %`, `part ${Math.round(t.quality * 100)}%`) : L(`меньше ${MUSEUM.min}`, `under ${MUSEUM.min}`)}
                </span>
                {t.complete && <Seal small />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Effects({ v }: { v: MuseumView }) {
  const e = v.effects;
  return (
    <footer class="mu-foot">
      <div class="mu-fx">
        <span class="mu-cap">{L("Наука", "Research")}</span>
        {e.research.length === 0 ? (
          <span class="mu-chip is-none">{L("пока ничего", "nothing yet")}</span>
        ) : (
          e.research.map((r) => (
            <span key={r.domain} class={`mu-chip dom-${r.domain}`}>
              <i class="tr-sw" />
              {r.name} +{num(r.pct)} %
            </span>
          ))
        )}
      </div>
      <div class="mu-fx mu-pull">
        <span class="mu-cap">{L("Привлекательность", "Appeal")}</span>
        <ProgressBar value={e.capPct > 0 ? e.pullPct / e.capPct : 0} label={L(`Привлекательность +${num(e.pullPct)} % из ${num(e.capPct)} %`, `Appeal +${num(e.pullPct)}% of ${num(e.capPct)}%`)} />
        <b>
          +{num(e.pullPct)} % {L("из", "of")} {num(e.capPct)} %
        </b>
        {e.pullRawPct > e.capPct && <span class="mu-note">{L("предел: дальше залы дают только науку", "the cap: more halls give research only")}</span>}
      </div>
      <Button class="mu-arrange" onClick={() => void send({ type: "arrangeExhibitions" })}>
        {L("Расставить лучшие", "Arrange the best")}
      </Button>
    </footer>
  );
}

export function MuseumPanel({ view }: { view: View }) {
  const st = state.value;
  if (rightPanel.value !== "museum" || !st) return null;
  const v = museumView({ finds: st.finds, buildings: st.buildings, articles: st.articles, museumStaff: st.museumStaff ?? {} });
  const m = v.museums.find((x) => x.id === selMuseum.value) ?? v.museums[0];
  if (!m) return null;
  const hall = m.halls.find((h) => sameHall(h, selHall.value)) ?? m.halls[0];
  const t = v.themes.find((x) => x.key === (selTheme.value ?? hall.theme)) ?? null;
  const onFly = (at: Pt) => {
    const fl = frame.peek();
    if (!fl) return;
    closePanel();
    view.flyTo({ center: fl.toLngLat(at[0], at[1]), mpp: atLeastAsClose(view.metersPerPixel(), CLOSE_UP_MPP) });
  };
  return (
    <div class="mu-screen" role="dialog" aria-modal="false" aria-label={L("Музей", "Museum")}>
      <div class="mu-sheet">
        <header class="mu-head">
          <div class="mu-title-block">
            <h2 class="mu-title">{m.name}</h2>
            <span class="mu-sub">
              {L(`залов ${m.halls.length} · работники ${Math.round(m.staff * 100)} %`, `${m.halls.length} halls · staff ${Math.round(m.staff * 100)}%`)}
              {m.asItWas && L(` · восстановлен как был, ×${num(MUSEUM.asItWas)}`, ` · restored as it was, ×${num(MUSEUM.asItWas)}`)}
              {v.complete > 0 && L(` · полных выставок в городе ${v.complete}`, ` · ${v.complete} complete in town`)}
            </span>
          </div>
          {v.museums.length > 1 && (
            <nav class="mu-tabs" aria-label={L("Музеи города", "The town's museums")}>
              {v.museums.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  class={`chip-btn${x.id === m.id ? " on" : ""}`}
                  aria-pressed={x.id === m.id}
                  onClick={() => {
                    selMuseum.value = x.id;
                    selHall.value = { museum: x.id, index: 0 };
                    selTheme.value = null;
                  }}
                >
                  {x.name}
                </button>
              ))}
            </nav>
          )}
          <IconButton icon="close" size={18} label={L("Закрыть", "Close")} onClick={closePanel} />
        </header>
        <div class="mu-main">
          <div class="mu-floor">
            <span class="mu-cap">{L("План здания", "Floor plan")}</span>
            <Plan m={m} v={v} sel={hall} />
            {m.staff < 1 && <p class="mu-warn">{L(`Работников ${Math.round(m.staff * 100)} % от мест: залы работают в той же доле.`, `Staff at ${Math.round(m.staff * 100)}% of the jobs: the halls work at that share.`)}</p>}
          </div>
          <Hall v={v} m={m} hall={hall} t={t} st={st} onFly={onFly} />
        </div>
        <Storeroom v={v} picked={selTheme.value} />
        <Effects v={v} />
      </div>
    </div>
  );
}
