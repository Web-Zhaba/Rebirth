import { clamp, GATE, PATTERN } from "../../map/modelGeometry";
import { type Ctx, pick, range, body, splitLot, part, inRect, fence, haystack, rebuildPosts, type TownModel } from "../../map/townKit";
import { TOWN_COLORS } from "../../ui/palette";

// The farm's 3D model (map/townKit.ts has the shared parts).

// Farm: a long barn with low walls under a steep thatched roof, haystacks in a fenced yard in front of its gate.
function farm(c: Ctx): void {
  const { house, yard, street } = splitLot(c, 0.6);
  const h = part(c, house);
  const eaves = clamp(c.height * 0.32, 1.7, 2.2);
  const rise = clamp(Math.min(h.hw, h.hl) * 2 * range(c, 0.6, 0.72), 3, 5.5);
  const logs = c.r() < 0.4;
  const pat = logs ? PATTERN.logs : PATTERN.boards;
  body(h, { eaves, roof: c.r() < 0.6 ? "gable" : "halfhip", rise, overhang: 0.5, wall: pick(c, logs ? TOWN_COLORS.logs : TOWN_COLORS.planks), roofC: pick(c, TOWN_COLORS.thatch), pat, doorPat: pat + GATE, plinth: false });
  const rr = Math.min(yard[2] - yard[0], yard[3] - yard[1]) * 0.22;
  haystack(c, inRect(yard, 0.27, 0.55), rr);
  haystack(c, inRect(yard, 0.73, 0.45), rr * 0.85);
  fence(c, yard, street);
  if (c.opts.upgrading) rebuildPosts(c, h.uv, eaves, pick(c, TOWN_COLORS.planks));
}

export const gumnoModel: TownModel = { build: farm };
