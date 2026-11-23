import { useMemo } from "preact/hooks";
import { signedArea } from "../map/modelGeometry";
import { flagShapes, type FlagDesign } from "../sim/heraldry";

export function SettlementFlag({ flag, class: className }: { flag: FlagDesign; class?: string }) {
  const paths = useMemo(() => {
    const runs: { color: string; d: string }[] = [];
    // Fill touching pieces of one colour together, so antialiasing leaves no seams through a charge.
    for (const { color, points } of flagShapes(flag)) {
      const ring = signedArea(points) < 0 ? points.slice().reverse() : points;
      const d = `M${ring.join(" ")}Z`;
      const last = runs.at(-1);
      if (last?.color === color) last.d += d;
      else runs.push({ color, d });
    }
    return runs;
  }, [flag]);
  return (
    <svg class={className} viewBox="0 0 150 100" aria-hidden="true" focusable="false">
      {paths.map(({ color, d }, i) => <path key={i} fill={color} d={d} />)}
    </svg>
  );
}
