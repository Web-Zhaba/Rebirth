# Roadmap

Open work carried over from the finished plans (their full text is in git history, `docs/PLAN-*.md` before
2026-11-12). Everything not listed here is built.

## Balance and pace

- **Finite resources.** Forest stands are felled and regrow over years; woodcutters work the forest within their
  radius and move or stop when it is cut. Quarries and fishing grounds deplete slowly and recover partly. Overlays
  show what is left.
- **Harness and tuning.** `npm run pace` plays to 2000 residents on strokes (not zones), reports what limits growth at
  each stage (time per growth-advice reason, idle hands, goods shortage days) and is calibrated against the measured
  pace; constants tuned to a target curve: fast to ~100 residents, slowing past ~1000. Reference: about 100 residents
  in 1.5 h of play at 4x (~75 game days). Today the harness stalls below ~120 residents on its 12 field slots.

## Needs (proposed, not built)

- **Clean water**: a well becomes a need, not only mood; dirty water raises illness and child mortality.
- **Meaning**: a slow need restored by heritage and by work that matches education; empty, people leave a rich town
  that feels pointless.
- **Safety**: night, wolves, a healer; restored by lamps, a healer and cleared forest; a raid empties it at once.
- **Crowding**: residents per room, house level and neighbours cap rest and social instead of a fifth bar.
- Young adults migrate on their own (not the whole family) when their own needs stay empty.

## Weather

- Real climate normals (Open-Meteo archive) as the base instead of the analytic latitude model.
- Fire as its own mechanic replacing the random `fire` event; lightning does not start fires until then.
- No forecast, by design.

## Graphics

- A second shadow cascade for close tilted views (shadows end ~100 m out today).
- Visual terrain detail beyond z11 that does not affect the rules.
- Not yet measured on an integrated GPU: the tree budget (120k) and the 1600 m shadow step are the things to watch.
