import { useState } from "preact/hooks";
import { L } from "../i18n";
import { DEFAULT_FLAG, FLAG_PATTERNS, FLAG_SYMBOLS, MAX_FLAG_LAYERS, type FlagDesign, type FlagLayer, type FlagPattern, type FlagSymbol } from "../sim/heraldry";
import type { City } from "../sim/types";
import { sendCmd } from "../simClient";
import { Button, IconButton } from "./kit";
import { SettlementFlag } from "./SettlementFlag";
import { play } from "./sound";
import "./heraldry.css";

const patterns: Record<FlagPattern, string> = {
  plain: L("Без деления", "Undivided"), pale: L("По вертикали", "Vertical halves"), fess: L("По горизонтали", "Horizontal halves"),
  bend: L("Перевязь", "Bend"), chevron: L("Стропило", "Chevron"), quarterly: L("Четверти", "Quartered"), cross: L("Крест", "Cross"),
};
const symbols: Record<FlagSymbol, string> = {
  pine: L("Сосна", "Pine"), wheat: L("Колос", "Wheat"), sun: L("Солнце", "Sun"), star: L("Звезда", "Star"),
  mountain: L("Гора", "Mountain"), tower: L("Башня", "Tower"), fish: L("Рыба", "Fish"), diamond: L("Ромб", "Lozenge"),
};

function Color({ label, value, change }: { label: string; value: string; change: (v: string) => void }) {
  return <label class="hr-color"><input type="color" value={value} onInput={(e) => change(e.currentTarget.value)} />{label}</label>;
}

function Range({ label, value, min, max, change }: { label: string; value: number; min: number; max: number; change: (v: number) => void }) {
  return (
    <label class="hr-range">
      <span>{label}</span><input type="range" min={min} max={max} value={value} onInput={(e) => change(e.currentTarget.valueAsNumber)} />
      <span aria-hidden="true">{value}</span>
    </label>
  );
}

const sample: FlagDesign = { field: "#e7d5ad", division: "#413b2d", pattern: "plain", layers: [] };
const newLayer = (symbol: FlagSymbol, color: string): FlagLayer => ({ symbol, color, x: 75, y: 50, size: 46 });

export function HeraldryEditor({ city }: { city: City }) {
  const saved = city.flag ?? DEFAULT_FLAG;
  const [name, setName] = useState(city.name);
  const [flag, setFlag] = useState<FlagDesign>(saved);
  const [index, setIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const layer = flag.layers[index];
  const dirty = name.trim() !== city.name || JSON.stringify(flag) !== JSON.stringify(saved);
  const validName = Boolean(name.trim()) && name.trim().length <= 40;

  function update(change: Partial<FlagDesign>) {
    setFlag({ ...flag, ...change });
    setMessage("");
  }
  function updateLayer(change: Partial<FlagLayer>) {
    update({ layers: flag.layers.map((l, i) => i === index ? { ...l, ...change } : l) });
  }
  function move(offset: number) {
    const next = index + offset;
    const layers = [...flag.layers];
    [layers[next], layers[index]] = [layers[index], layers[next]];
    update({ layers });
    setIndex(next);
  }
  function discard() {
    setName(city.name);
    setFlag(saved);
    setIndex(0);
    setMessage("");
  }
  async function save() {
    if (pending || !dirty || !validName) return;
    setPending(true);
    setMessage("");
    const failed = L("Не удалось сохранить изменения. Попробуйте ещё раз.", "Could not save the changes. Try again.");
    try {
      const result = await sendCmd({ type: "setCityIdentity", name: name.trim(), flag });
      if (result.ok) {
        setName(name.trim());
        setMessage(L("Изменения применены", "Changes applied"));
        play("stamp");
      } else {
        setMessage(result.reason ?? failed);
        play("error");
      }
    } catch {
      setMessage(failed);
      play("error");
    } finally {
      setPending(false);
    }
  }

  return (
    <form class="hr-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <fieldset class="hr-grid" disabled={pending} aria-label={L("Символика поселения", "Settlement heraldry")}>
        <div class="hr-preview">
          <figure class="hr-cloth" role="img" aria-label={L("Предпросмотр флага", "Flag preview")}>
            <div class="hr-hanging"><SettlementFlag flag={flag} /></div>
          </figure>
          <label class="hr-name">
            <span class="mk-cap">{L("Название поселения", "Settlement name")}</span>
            <input value={name} type="text" maxLength={40} required onInput={(e) => { setName(e.currentTarget.value); setMessage(""); }} />
          </label>
        </div>
        <div class="hr-tools">
          <section class="hr-section">
            <h3 class="th-h">{L("Полотнище", "Flag field")}</h3>
            <div class="hr-options" role="group" aria-label={L("Деление поля", "Field division")}>
              {FLAG_PATTERNS.map((pattern) => (
                <button type="button" key={pattern} title={patterns[pattern]} aria-label={patterns[pattern]} aria-pressed={flag.pattern === pattern} onClick={() => update({ pattern })}>
                  <SettlementFlag flag={{ ...sample, pattern }} />
                </button>
              ))}
            </div>
            <div class="hr-colors">
              <Color label={L("Основной цвет", "Field colour")} value={flag.field} change={(field) => update({ field })} />
              {flag.pattern !== "plain" && <Color label={L("Цвет деления", "Division colour")} value={flag.division} change={(division) => update({ division })} />}
            </div>
          </section>
          <section class="hr-section">
            <div class="hr-layer-heading">
              <h3 class="th-h">{L("Фигуры", "Charges")}</h3>
              <Button icon="plus" disabled={flag.layers.length >= MAX_FLAG_LAYERS} onClick={() => {
                setIndex(flag.layers.length);
                update({ layers: [...flag.layers, newLayer("star", "#f3dfa9")] });
              }}>{L("Добавить фигуру", "Add charge")}</Button>
            </div>
            {flag.layers.length > 0 && (
              <div class="hr-layers" role="group" aria-label={L("Слои фигур", "Charge layers")}>
                {flag.layers.map((l, i) => (
                  <button type="button" key={i} aria-pressed={i === index} onClick={() => setIndex(i)}>
                    <span>{i + 1}</span>{symbols[l.symbol]}
                  </button>
                ))}
              </div>
            )}
            {layer && (
              <>
                <div class="hr-options hr-symbols" role="group" aria-label={L("Вид фигуры", "Charge shape")}>
                  {FLAG_SYMBOLS.map((symbol) => (
                    <button type="button" key={symbol} title={symbols[symbol]} aria-label={symbols[symbol]} aria-pressed={layer.symbol === symbol} onClick={() => updateLayer({ symbol })}>
                      <SettlementFlag flag={{ ...sample, layers: [newLayer(symbol, sample.division)] }} />
                    </button>
                  ))}
                </div>
                <div class="hr-layer-tools">
                  <Color label={L("Цвет фигуры", "Charge colour")} value={layer.color} change={(color) => updateLayer({ color })} />
                  <IconButton icon="caretUp" label={L("Поднять слой", "Raise layer")} disabled={index === flag.layers.length - 1} onClick={() => move(1)} />
                  <IconButton icon="caretDown" label={L("Опустить слой", "Lower layer")} disabled={index === 0} onClick={() => move(-1)} />
                  <IconButton icon="trash" label={L("Удалить фигуру", "Remove charge")} onClick={() => {
                    update({ layers: flag.layers.filter((_, i) => i !== index) });
                    setIndex(Math.max(0, index - 1));
                  }} />
                </div>
                <div class="hr-ranges">
                  <Range label={L("Размер", "Size")} value={layer.size} min={12} max={50} change={(size) => updateLayer({ size })} />
                  <Range label={L("По горизонтали", "Horizontal position")} value={layer.x} min={20} max={130} change={(x) => updateLayer({ x })} />
                  <Range label={L("По вертикали", "Vertical position")} value={layer.y} min={20} max={80} change={(y) => updateLayer({ y })} />
                </div>
              </>
            )}
          </section>
        </div>
      </fieldset>
      <footer class="hr-actions">
        <span role="status">{message || (!validName && L("Введите название поселения", "Enter a settlement name"))}</span>
        <Button disabled={!dirty || pending} onClick={discard}>{L("Отменить изменения", "Discard changes")}</Button>
        <Button type="submit" variant="primary" disabled={!validName || !dirty || pending}>{pending ? L("Сохраняем…", "Saving…") : L("Сохранить", "Save")}</Button>
      </footer>
    </form>
  );
}
