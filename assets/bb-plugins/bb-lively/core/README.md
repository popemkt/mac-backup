# @popemkt/bb-lively-core

A motion layer for any web app: presses, list arrivals, overlay springs, send and status
pulses, a focus glow, page entrances, a working-state glow, at three intensities. It knows no host: the host passes a `Targets` object (one CSS
selector per role, plus the attributes that pause it). The bb plugin next door
(`../adapter`) is one host.

## Layers

| Layer | Path | What it is |
|---|---|---|
| Domain | `src/domain/` (`effect` only, no DOM types) | the effects table, settings and their decoder, the motion policy (`resolveMotion(settings, systemReduced)` → level, source, speed, running effects), the motion tokens per intensity and the spring easing family (`motion.ts`), the budget constants |
| DOM | `src/dom/` | `createLively`, the stylesheet builder, the row watcher, the one-shot pulser, the selector canary |

## Use

```ts
import { createLively } from "@popemkt/bb-lively-core";

const controller = new AbortController();
const lively = createLively({ signal: controller.signal, targets, settings: { motion: "system" } });
lively.sent();                          // a local send happened
lively.pulseStatus(rowElement, "success");
// later: controller.abort()  (removes the stylesheet, attributes and classes)
```

## Tests

`npm test`: the policy and decoder (`domain.test.ts`), the budget gate on the generated sheet
(`stylesheet.test.ts`), and the engine over happy-dom (`lively.test.ts`): attributes,
cleanup, the live reduced-motion change, arrivals vs. scroll-ins vs. swapped lists, the
4-row cap, the scroll quiet period, pausing, pulses.
