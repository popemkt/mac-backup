# bb-lively "wobbly": a Zenless Zone Zero motion style

Date: 2026-10-24. Status: research and design only. The repo was not edited and nothing was installed.

Demo: `/tmp/zzz-wobble-demo.html` is standalone. It has clean/wobbly × subtle/lively/bold toggles and every effect below. It uses the same tokens and keyframes this doc specifies, and was smoke-tested in headless Chromium.

What bb-lively code was read:
- On `main` at `.claude/worktrees/agent-a05f…` (`8a3721e7`): `adapter/selectors.ts`, `core/src/domain/effects.ts`, `core/src/dom/stylesheet.ts`, the README and `docs/research/2026-10-24-bb-theming-feasibility.md`.
- The intensity work in progress in `.claude/worktrees/agent-a4ea869eb255177a1`: the new `core/src/domain/motion.ts`, plus the diffs to `stylesheet.ts`, `policy.ts` and `settings.ts`.
- `bb-lively` is not on this clone's `main` checkout yet.

---

## 0. Short version

- **ZZZ's UI is not jelly everywhere.** Measured frame by frame, its menus are mostly **hard snaps** with these accents:
  - a **delayed swell** (about +5% scale, peaking about 200 ms after the snap);
  - **slanted wipe panels**;
  - **skewed, parallelogram shapes**;
  - **staggered sticker-like tile pop-ins with a flash**;
  - **thick black outlines and hard offset shadows**, in lime and yellow on near-black.
- The "wobbly" feel people remember mostly comes from the **characters** (exaggerated squash and stretch, overlap and bouncy physics) and the Bangboo and gacha CRT sequences. bb has no characters, so "as wobbly as ZZZ" for bb has to mean:
  1. a fast attack with an under-damped multi-bounce settle (2–3 visible wobbles);
  2. squash on press and jelly on release;
  3. skew-in on arrival;
  4. sticker shadows;
  5. a short glitch or brightness flash.
- **Recommendation: make it a separate `style` axis (`clean | wobbly`) × the existing `intensity`, not a fourth intensity.**
  - Intensity is volume: how far and how strong.
  - Style is shape: which curve family, and whether squash, skew, tilt, sticker and flash exist at all.
  - Wobbly at `subtle` is a meaningful setting (a small wobble), and `clean` keeps today's tokens unchanged.
- **Cheap path:**
  - All of it fits in `scale` / `translate` / `rotate` (the individual properties), `opacity` and `filter` (`drop-shadow`, `brightness`).
  - Skew is the one exception. It needs `transform`, which is safe on host elements only with `animation-composition: add`.
  - Springs are generated once in TS as `linear()` strings. No runtime library.
  - **Reject** SVG turbulence and displacement filters and `clip-path` wipes for v1.

---

## 1. The ZZZ motion catalogue

### 1.1 Sources

**Primary**
- [S1] HoYoverse, *"Where does Zenless Zone Zero's unique feel come from? | Ridu Creator Notes Vol. 1"*, an interview with producer Zhenyu Li: https://zenless.hoyoverse.com/en-us/news/123577. The text was read through the site's content API (`sg-public-api-static.hoyoverse.com/content_v2_user/app/3e9196a4b9274bd7/getContent?iInfoId=123577`).

**Footage, downloaded and measured frame by frame with ffmpeg**
- [V1] "Miyabi Skin EVEN Changes the Menu?! Full UI (ZZZ 2.8)", https://www.youtube.com/watch?v=0MskmYBuKdc. 1280×720 at **60 fps**, so per-frame timing was measured.
- [V2] "ULTIMATE ZZZ 2026 NEW PLAYER GUIDE", https://www.youtube.com/watch?v=4Ga-I3ZKQ9U, 2:00–3:00: event calendar, menus and screen changes.
- [V3] "Zenless Zone Zero – NEW Gacha Bangboo Pull Animations", https://www.youtube.com/watch?v=_F6mPjZpml4: the results grid pop-in.

**Analysis and press**
- [A1] "The Overanimation of Zenless Zone Zero" (video essay; transcript read), https://www.youtube.com/watch?v=1yH4Qz23FqM.
- [A2] CoverStory.ph review, https://coverstory.ph/2024/07/28/zenless-zone-zero-is-right-up-an-amateur-gamers-alley/.
- [A3] TechRaptor interview with Zhenyu Li (logo built on a "snappy and neat" aesthetic): https://techraptor.net/gaming/features/zenless-zone-zero-interview-hoyoverse. Only the search summary was read.

**Techniques**
- [T1] Chrome for Developers, *CSS `linear()` easing*: https://developer.chrome.com/docs/css-ui/css-linear-easing-function
- [T2] Motion, *CSS springs and easings*: https://motion.dev/docs/ai-generate-css-springs-and-easings-llm, https://motion.dev/tutorials/react-css-spring
- [T3] Josh Comeau, *linear()*: https://joshwcomeau.com/animation/linear-timing-function
- [T4] npm `spring-easing`: https://npmjs.com/spring-easing

There is no published ZZZ UI-motion talk or breakdown (no GDC talk, no UI-artist portfolio). Several searches came back empty, so the catalogue rests mainly on measured footage.

### 1.2 Observed

The evidence for each observation is in brackets.

| # | Element | What happens | Timing (measured) |
|---|---|---|---|
| O1 | **Tab pill** (Base Stats → Skills) [V1, 60 fps, pixel-measured] | The highlight **cuts** to the new tab at full size, with no slide or fade. About 100 ms later it **swells**: width 179 → 189 px (+5.6%), symmetric about its centre, then settles back. Over about 600 ms its colour also drifts from yellow `#f7da00` to lime `#92bb00` (pressed, then selected). | Snap ≤ 1 frame after input lands. Swell starts at about +130 ms, peaks at about +230–250 ms and is at rest by about +330 ms. **One overshoot, no visible undershoot.** |
| O2 | **Tab content** [V1] | The panel content swaps with a **hard cut**. No crossfade was visible between consecutive 60 fps frames. | 0 ms |
| O3 | **Screen wipe** (character list → agent detail) [V1] | A thin black strip with letter-spaced `A G E N T  S E L E C T` slides in first. A large **khaki, slanted (parallelogram, about 15–20°) panel with a fine dot texture** sweeps from right to left over the screen. It holds, then the new screen is revealed from behind it. Hard edges, no blur, no easing tail. | Strip leads by about 80 ms. Cover goes 0 → 70% of the frame in **about 150 ms**, close to linear. Hold about 130 ms. Reveal is a cut. Total about 400 ms. |
| O4 | **Shapes** [V1, V2] | Tab pills are **parallelograms with rounded corners**. The agent grid is a **sheared column** of portrait tiles. Selection is a **thick lime outline**. Panels are dark grey with a **thick (about 3 px) lighter bezel**, like a CRT. Event rows are saturated orange/red pills with black icon chips. | – |
| O5 | **Results grid** [V3, sampled at 20 fps] | Placeholder tiles **pop in one per frame** (about a 50 ms stagger). Each fills with a **bright cyan flash or iris** before the item shows. The rank letter ("B") **scales up from small**. The big italic title shows a **horizontal slice and smear glitch** as it arrives. | 50 ms stagger. Each tile about 150–250 ms. |
| O6 | **Screen changes** in the open world [V2] | Mostly a cut or a short dip to black. Event pages appear at rest. | about 100–300 ms |
| O7 | **Typography** [V1, V2, V3] | Heavy (black weight) **italic** grotesque for titles and labels. Letter-spaced small caps for section strips. Numbers in italic. | – |
| O8 | **Colour** [V1, V2] | Near-black base. **Lime and yellow** for "active". Orange and red for events. Cyan glow for reveals. Black text on accent fills. | – |

### 1.3 From sources, not observed directly

- **The developer's intent** [S1]. Li specialises in "packaging and graphic design". The team prioritised "signs and advertisements"; "attention to detail in UI design was also essential". With about ten people early on, they chose "**high-quality visual packaging with minimal animated transitions**" for the most-used character interface.
  - This matches O1–O3: **few, short motions, carried by strong graphics**, not long animations.
- **Persona 5 comparison** [A2]. The UI is "artfully and maximally stylized but is fairly easy to navigate, with some likeness to the UI in Persona 5 minus the extreme red/black/white colour contrasts". Also: "city pop and mecha-anime synthesis", storylines in "an interactive comic format", and a "90s to 2000s aesthetic".
- **Where the wobble comes from** [A1]. The essay describes the character animation as "big exaggerated anticipation and **squash and stretch and overlap everywhere**", amplified by "real-time physics causing every movement to cascade down every loose or bouncy extremity". This is the source of the "wobbly" reputation: **characters, not widgets.**
- **"Snappy and neat"** [A3] is the stated aesthetic behind the logo and name.

### 1.4 Inferred

These go beyond the evidence above.

- **Squash and stretch on buttons:** not seen in UI widgets at the sampled rates. ZZZ's UI "jelly" is the **O1 swell**: a single pulse, not a multi-bounce.
- **The wobbly version therefore borrows from the characters.** It adds a 2–3 bounce settle and press squash so the result reads as ZZZ in a desktop app.
- **Skewed and tilted panels:** strongly present as **static shapes** (O3, O4). In motion they appear as **diagonal travel** (the wipe) rather than an animated skew. A skew-in that settles to 0 is a fair translation of "diagonal energy" for elements whose rest shape we cannot change.
- **Snap-in with a hard stop:** yes. O1 and O2 are the clearest evidence.
- **Comic and halftone accents:** the dot texture on the wipe panel (O3) was observed. Comic panels in story scenes are from [A2] and were not checked frame by frame.
- **Chromatic and glitch flashes:** the slice and smear on titles (O5) and the CRT and VHS motifs ([A2], the CRT bezel in O4) were observed. RGB-split specifically was **not** confirmed. It is an inference from the VHS and CRT theme.
- **Sticker-like pop-ins:** the tile pop with flash (O5) was observed. Rotation on pop was not seen. A small tilt is added as an inference.
- **Rubber-band drags:** no evidence in ZZZ's UI. Not proposed; see §3.4.
- **Idle "breathing":** in ZZZ this belongs to the characters (idle loops) and the background marquees. UI widgets were not seen to breathe. A tiny breathe on bb's working indicator is a reasonable bridge.
- **Timing feel:** attack is very fast (≤ 1–3 frames to full presence), followed by a short secondary motion (swell, flash, settle). No slow ease-ins anywhere. Exits are cuts or very fast.

---

## 2. Web techniques compared

bb runs on Chromium/Electron, so all of these are available:
- `linear()` easing: Chromium 113+.
- Individual `translate` / `rotate` / `scale` properties: Chromium 104+.
- `animation-composition`: Chromium 112+.
- `@property`: Chromium 85+.

Before shipping, confirm that bb Desktop's Electron is 25 or newer. 0.47 almost certainly is, and the existing sheet already relies on `linear()`.

| Technique | What it gives | Cost | Fit | Verdict |
|---|---|---|---|---|
| **CSS `linear()` from a damped spring** [T1][T3] | Real spring and wobble curves (multi-bounce, values > 1 and < 1) on any `animation` or `transition`, including sonner's transitions and tw-animate's `--tw-ease`. | Zero runtime. A 40–48 point string is about 400 chars per curve. Retimes host transitions without touching them. | **Excellent.** `motion.ts` already has `springPoints(overshoot)`. It needs one more parameter (`peakAt`, see §3.2) to produce 2–3 bounces. | **Use.** Generate at sheet-build time. |
| **Keyframe squash/stretch with the `scale` property** (`scale: 1.09 0.91`) | Jelly on press and release, checkbox and thumb squash. Non-uniform `scale` needs no `transform`, so it composes with host transforms. | Compositor-only. | **Excellent.** Origin comes from `transform-origin` (bottom for a "landing" squash, centre for a press). | **Use.** Amplitude comes from a token through `calc(1 ± var(--lively-squash) * k)`. |
| **skewX jelly** | Diagonal "ZZZ energy" on rows, menus and toasts. | Compositor-only, **but** there is no individual `skew` property. It needs `transform`, which **replaces** host transforms (virtualizer rows, popper wrappers, sonner) unless `animation-composition: add` is used. | **Good, with care.** With `add`, the keyframe `from { transform: skewX(-8deg) }` composes after the host's transform and interpolates to the underlying value. | **Use, only with `animation-composition: add`.** Never on sonner toasts (sonner drives `transform` itself); use `rotate` there. |
| **WAAPI springs** (`el.animate(keyframes, { easing: 'linear(…)', composite: 'add' })`) | The same curves from JS. Per-element amplitude, cancellable, and `finished` promises remove the classes cleanly. | Compositor-only. Adds JS per trigger. | **Good for JS-triggered one-shots** (send, status rings, checkbox) if the class approach gets messy. Not needed for CSS-triggered effects (`:active`, `:hover`, `[data-state]`). | **Optional.** Keep the class plus CSS approach (one sheet, attributes only) unless a variant needs per-element math. |
| **SVG filters** (`feTurbulence` + `feDisplacementMap`) | A true "ink wobble" or glitch distortion of the element's pixels. | **High.** A reference filter takes the element off the compositor-only path. Animating `baseFrequency`, `seed` or `scale` repaints and re-filters every frame on the main thread, and cost scales with area × DPR. A timeline row at 2× DPR is several ms per frame, which blows a 4-row budget. | **Poor.** It is also a `filter: url()` on bb's DOM, needs an injected `<svg>`, and conflicts with any host `filter`. | **Reject for v1.** At most a one-shot on the 38 px send icon, if someone insists. |
| **`clip-path` wipes** (`polygon()` diagonal reveal) | The literal ZZZ wipe (O3) on panels and pages. | Not in the budget (only transform, opacity and filter). Recent Chromium composites some `clip-path` animations, but not reliably; otherwise it is a main-thread repaint each frame on large areas. | **Medium.** The same look comes from a **skewed slab pseudo-element moved with `translate`**, which is pure transform. | **Reject `clip-path`.** Use the slab pseudo (§3.4, optional `pageWipe`). |
| **Offset "sticker" shadow with `filter: drop-shadow(3px 3px 0 #000)`** | A hard, outline-following offset shadow (ZZZ and Persona look) on buttons, cards, menus and toasts. | Static `drop-shadow` is one extra filter pass at raster time. Chromium can animate `filter` on the compositor. Prefer to toggle it with `steps()` (it snaps in, matching the ZZZ "hard stop") rather than tween the offset. | **Excellent.** Works on any shape (pills, rounded rects, icons) without knowing `border-radius`. | **Use.** As a static theme token for rest state, and as a snapped hover state. |
| **Chromatic split with two coloured `drop-shadow`s, swapped with `steps(1)`** | RGB glitch on rows or rings for 2–3 frames. | Two filter passes for about 160 ms, on ≤ 4 elements. | **Good.** It reads as glitch even at 1–2 px. | **Use, sparingly** (status pulse and list-enter flash only, at full level). |
| **Brightness flash with `filter: brightness(1.45 → 1)`** | The O5 "reveal flash" on arriving rows. | One filter pass during the first 80 ms. | **Good.** | **Use** (with `listEnter` and the checkbox). |
| **Halftone with `radial-gradient` dots on a pseudo-element, plus a mask** | Comic accent: a dot burst ring on send, and optional theme texture. | Static paint. Only `opacity` and `scale` animate. | **Good.** | **Use** on the send pseudo. Texture belongs in the theme. |
| **Libraries:** motion.dev `spring()` [T2], popmotion, react-spring math, `spring-easing` [T4] | Validated spring solvers. Motion's emits `linear()` strings with a "visual duration". | 5–20 KB, a dependency to keep in step, and the content script would ship code that runs once. | **Unnecessary.** `motion.ts` already contains the closed-form damped oscillator. | **Hand-roll** (about 20 lines, already there). If anything, use motion.dev's visualiser to cross-check curves while tuning. |

---

## 3. The design for bb-lively

### 3.1 Style axis, not a fourth intensity

**The axes**
- `intensity: subtle | lively | bold` (the other agent's work, `motion.ts`). It scales distance, scale, overshoot, duration, blur, glow and stagger together. The `overshoot` parameter keeps one curve **shape**: a single bump peaking at 40%.
- `style: clean | wobbly` (new) changes the **shape**:
  - the curve family (fast attack, then 2–3 bounces);
  - whether squash, skew, tilt, sticker shadows, flash and chroma exist at all.

**Why this beats `intensity: wobbly`**
1. **Orthogonal.** People will want "a little wobble" (wobbly × subtle) or "big but clean" (clean × bold). With a fourth intensity, wobbly is stuck at one volume and the subtle/lively/bold ladder means two different things.
2. **One contract.** It keeps the existing rule that "no effect has a number of its own". Wobbly is a second `MotionTokens`-shaped record per intensity, so effects still read only tokens. `clean` sets the new tokens to 0, so **clean output is identical to today's**: no regression risk, and tests stay valid.
3. **Reduced motion stays simple.** `REDUCED_TOKENS` already collapses everything. It just also zeroes the style tokens, so both styles reduce to the same 120 ms fades.
4. **Themes stay separate.** "Lively ZZZ" (§3.6) is a palette. It pairs well with wobbly but is not required by it, matching how `lively-dracula` works with any motion.

**Implementation**
- Add `STYLES = ["clean","wobbly"]` and a `style` setting in `domain/settings.ts` (default `clean`).
- Write it to the root as `data-lively-style`.
- In `stylesheet.ts`, emit one token block per (style, intensity) pair: 6 blocks instead of 3, about 1.5 KB more.
  - Generic form: `:root[data-lively-style="wobbly"][data-lively-intensity="bold"] { … }`.
  - The clean blocks need **no** selector change: the clean values are the defaults.
- Add the wobbly-only rules under `:root[data-lively-style="wobbly"]`.
- The policy (`tokensFor`) merges `INTENSITY_TOKENS[intensity]` with `STYLE_TOKENS[style][intensity]`.

### 3.2 Token additions

**New fields on `MotionTokens`** (all 0 in `clean` and in `REDUCED_TOKENS`)

| Token | CSS property | Meaning |
|---|---|---|
| `peakAt` | (curve) | Fraction of the duration where the spring first peaks. Lower values give a faster attack and more bounces. Clean keeps 0.4. |
| `squash` | `--lively-squash` | Peak non-uniform scale deformation, for example 0.09 → `scale: 1.09 0.91`. |
| `skew` | `--lively-skew` | Arrival skew in degrees (settles to 0). |
| `tilt` | `--lively-tilt` | Rotation in degrees for hover, pops and menus. |
| `sticker` | `--lively-sticker` | Hard offset-shadow distance in px. |
| `swell` | `--lively-swell` | The O1 delayed swell, as a scale fraction. |
| `flash` | `--lively-flash` | Extra brightness at arrival (0.45 → `brightness(1.45)`). |
| `chroma` | `--lively-chroma` | Chromatic split in px. |

**Generalised generator** (one family; `peakAt` was hard-coded to 0.4):

```ts
export function springPoints(overshoot: number, peakAt = 0.4, samples = 24): ReadonlyArray<number> {
  // unchanged closed form; zeta from overshoot, omegaD = PI / peakAt
}
export function springEasing(overshoot: number, peakAt = 0.4, samples = 24): string
// jelly coefficients: the extremes of the same oscillator, (-overshoot)^k
export const jellyCoefficients = (overshoot: number, halfCycles = 4) =>
  Array.from({ length: halfCycles + 1 }, (_, k) => (-overshoot) ** k);
```

The sample count rises to 32, 40 and 48 for wobbly subtle, lively and bold, because the extra bounces need more points.

**Wobbly token values** (fields not listed inherit the intensity's values)

| Token | wobbly × subtle | wobbly × lively | wobbly × bold |
|---|---|---|---|
| `overshoot` | 0.18 (ζ 0.48) | 0.30 (ζ 0.36) | 0.42 (ζ 0.27) |
| `peakAt` | 0.26 | 0.20 | 0.16 |
| visible bounces | about 1.5 | about 2.5 | about 3 |
| `pressMs` (attack) | 70 | 65 | 60 |
| `releaseMs` | 320 | 400 | 480 |
| `enterMs` | 340 | 420 | 500 |
| `overlayMs` | 300 | 360 | 420 |
| `exitMs` (snap out) | 80 | 80 | 90 |
| `pulseMs` | 320 | 360 | 400 |
| `rise` (px) | 8 | 14 | 20 |
| `pressScale` | 0.95 | 0.93 | 0.90 |
| `overlayScale` | 0.92 | 0.86 | 0.80 |
| `stagger` (ms) | 50 | 50 | 50 (observed O5) |
| `squash` | 0.05 | 0.09 | 0.14 |
| `skew` (deg) | −4 | −8 | −12 |
| `tilt` (deg) | −0.6 | −1.2 | −2 |
| `sticker` (px) | 2 | 3 | 4 |
| `swell` | 0.03 | 0.055 (≈ O1) | 0.08 |
| `flash` | 0.25 | 0.45 | 0.70 |
| `chroma` (px) | 1 | 2 | 3 |
| `blur` | 0 | 0 | 0 (ZZZ edges are hard; no blur-in) |
| `glow` | inherit | inherit | inherit |

**Generated `--lively-spring` values** (from the generator; also in the demo)

`wobbly × subtle` (0.18, 0.26, 32 samples):
```
linear(0, 0.08, 0.27, 0.505, 0.735, 0.926, 1.064, 1.146, 1.178, 1.173, 1.144, 1.103, 1.06, 1.023, 0.995, 0.977, 0.969, 0.968, 0.972, 0.979, 0.987, 0.994, 0.999, 1.003, 1.005, 1.006, 1.005, 1.004, 1.003, 1.001, 1, 1, 1)
```

`wobbly × lively` (0.30, 0.20, 40 samples):
```
linear(0, 0.079, 0.276, 0.531, 0.79, 1.013, 1.177, 1.271, 1.3, 1.276, 1.217, 1.141, 1.063, 0.996, 0.947, 0.919, 0.91, 0.917, 0.935, 0.958, 0.981, 1.001, 1.016, 1.024, 1.027, 1.025, 1.02, 1.013, 1.006, 1, 0.995, 0.993, 0.992, 0.993, 0.994, 0.996, 0.998, 1, 1.001, 1.002, 1)
```

`wobbly × bold` (0.42, 0.16, 48 samples):
```
linear(0, 0.082, 0.294, 0.575, 0.866, 1.12, 1.304, 1.402, 1.416, 1.362, 1.261, 1.139, 1.02, 0.921, 0.855, 0.826, 0.83, 0.86, 0.906, 0.958, 1.006, 1.044, 1.066, 1.074, 1.068, 1.053, 1.032, 1.011, 0.992, 0.978, 0.97, 0.969, 0.973, 0.98, 0.989, 0.998, 1.006, 1.011, 1.013, 1.013, 1.01, 1.007, 1.003, 1, 0.997, 0.995, 0.995, 0.995, 1)
```

**Two more fixed curves**
- `--lively-snap: linear(0, 0.62 12%, 0.94 24%, 1 34%, 1)`. A hard-stop arrival: about a third of the duration to land, then dead still (O1, O2).
- `--lively-jelly-ease: cubic-bezier(.3, 0, .4, 1)`. Used between the jelly keyframe stops.

**Budget change.** The intensity work sets `MAX_ONCE_MS = 400`, which wobbly exceeds at lively and bold because of its tail. ZZZ's feel comes from the **attack**, not the tail, so replace the single cap with two budgets:
- **time-to-target ≤ 120 ms**: the first time the curve crosses 1. That is `peakAt × duration × ~0.6`: about 50 ms for bold enter.
- **total ≤ 560 ms**, under the existing ≤ 4 concurrent rows rule.

Tests can assert the first crossing from `springPoints`.

### 3.3 Shared keyframes (wobbly)

Keyframes may only use `scale`, `translate`, `rotate`, `opacity`, `filter`, and `transform` with `animation-composition: add`. The stylesheet test needs that last allowance added.

```css
/* jelly: extremes of the lively oscillator (1, -r, r², -r³), amplitude from the token.
   The coefficients are generated from jellyCoefficients(overshoot of the active curve);
   lively shown (r = 0.30). */
@keyframes lively-jelly {
  0%   { scale: calc(1 + var(--lively-squash))         calc(1 - var(--lively-squash)); }
  22%  { scale: calc(1 - var(--lively-squash) * .3)    calc(1 + var(--lively-squash) * .3); }
  44%  { scale: calc(1 + var(--lively-squash) * .09)   calc(1 - var(--lively-squash) * .09); }
  66%  { scale: calc(1 - var(--lively-squash) * .027)  calc(1 + var(--lively-squash) * .027); }
  100% { scale: 1 1; }
}
/* Squash while held: wide and short. */
@keyframes lively-press-squash {
  to { scale: calc(var(--lively-press-scale) + var(--lively-squash) * .6)
              calc(var(--lively-press-scale) - var(--lively-squash) * .4); }
}
/* O1: snap, then a delayed swell. */
@keyframes lively-swell { 0%, 30% { scale: 1; } 62% { scale: calc(1 + var(--lively-swell)); } 100% { scale: 1; } }
/* Diagonal energy; composes after any host transform. */
@keyframes lively-skew-in { from { transform: skewX(var(--lively-skew)); } }
/* O5: reveal flash. */
@keyframes lively-flash { from { filter: brightness(calc(1 + var(--lively-flash))); } to { filter: brightness(1); } }
/* RGB split for 2–3 frames (run with steps(1, end)). */
@keyframes lively-chroma {
  0%, 100% { filter: none; }
  10% { filter: drop-shadow(var(--lively-chroma) 0 0 #3fd4ff) drop-shadow(calc(var(--lively-chroma) * -1) 0 0 #ff3dbb); }
  35% { filter: drop-shadow(calc(var(--lively-chroma) * -1) 0 0 #3fd4ff) drop-shadow(var(--lively-chroma) 0 0 #ff3dbb); }
  50% { filter: none; }
}
/* Sticker pop. */
@keyframes lively-sticker-pop {
  from { opacity: 0; scale: var(--lively-pop-from); rotate: calc(var(--lively-tilt) * 6); }
  to   { opacity: 1; scale: 1; rotate: 0deg; }
}
```

A note on `lively-jelly`: the decay ratio differs per wobbly intensity (r = 0.18, 0.30 and 0.42). There are two options:
- Emit three `@keyframes` (`lively-jelly-subtle|lively|bold`) and pick one through `animation-name: var(--lively-jelly)`.
- Keep **one** set at r = 0.3 and let `--lively-squash` carry the volume.

The decay difference is barely visible at these sizes. **Recommended: one set.**

### 3.4 Per-effect specification

`W` means "under `:root[data-lively-style="wobbly"]` plus the effect's `on()` scope". Selectors are the existing `targets.*` entries; no new bb selectors are needed except the optional `pageView` that the intensity work already adds.

**1. press** (`pressable`)
- **Clean (today):** scale 0.97 down, then the spring back.
- **Wobbly:**
  - While held: `animation: lively-press-squash var(--lively-press) var(--lively-ease-out) forwards;`. At lively that is `scale: .984 .894`, a visible squat.
  - On release (`.lively-press-out`): `animation: lively-jelly var(--lively-release) var(--lively-jelly-ease) backwards;` (400 ms at lively), with `transform-origin: 50% 60%` so it "lands".
- **No skew.** Buttons sit inside host transforms (Radix triggers).

**2. hoverLift** (`liftable`, under `@media (hover:hover)`)
- **Clean:** translate by the lift, plus a soft shadow.
- **Wobbly:** a hard sticker shadow snaps in, with the card nudged up-left by half the offset so it looks "picked up".
  - Rest: `filter: none`.
  - Hover:
    ```css
    translate: calc(var(--lively-sticker) * -.5) calc(var(--lively-sticker) * -.5);
    rotate: var(--lively-tilt);
    filter: drop-shadow(calc(var(--lively-sticker) * 1.5) calc(var(--lively-sticker) * 1.5) 0 var(--lively-accent));
    ```
  - Transition:
    ```css
    transition: translate var(--lively-overlay) var(--lively-spring),
                rotate var(--lively-overlay) var(--lively-spring),
                filter 60ms steps(2, end);
    ```
    `steps` gives the hard ZZZ snap and is not a smooth shadow tween.

**3. listEnter** (`.lively-enter`, ≤ 4 rows, stagger 50 ms)
- **Wobbly:** two animations, the second **added** onto the virtualizer's transform.
  ```css
  animation: lively-enter-w var(--lively-enter) var(--lively-spring) backwards,
             lively-skew-in var(--lively-enter) var(--lively-spring) backwards;
  animation-composition: replace, add;
  will-change: transform, opacity, filter;   /* already only on the one-shot class */
  ```
  - `lively-enter-w`:
    - from: `{ opacity: 0; translate: calc(var(--lively-rise) * 1.6) var(--lively-rise); filter: brightness(calc(1 + var(--lively-flash))); }` (it arrives from the lower right, the diagonal)
    - 30%: `{ opacity: 1 }`
    - to: `{ translate: 0 0; filter: brightness(1) }`
  - `transform-origin: 0 100%`, so the skew pivots from the bottom-left corner, like a card slapped down.
- **Optional, full level only:** `lively-chroma 160ms steps(1,end)` on the **last** row of the batch only.

**4. focusRing** (`focusBox:focus-within`)
- **Clean:** an accent glow pseudo whose opacity animates, breathing at full level.
- **Wobbly:**
  - The `::after` gets a **solid 2 px accent ring plus a sticker offset**: `box-shadow: 0 0 0 2px var(--lively-accent), var(--lively-sticker) var(--lively-sticker) 0 2px #000;`. This is static paint; only opacity changes.
  - It appears with `transition: opacity 60ms steps(2,end)`, which is the snap.
  - When focus arrives, the **pseudo**, not the composer, runs `lively-swell 330ms var(--lively-ease-out)`. This is O1 exactly: snap, then swell.
  - **Breathing:** keep the existing `lively-breathe` opacity loop at the full level. Add no scale loop on the composer; it holds text the user is typing.

**5. sendPulse** (`.lively-send`, `sendIcon`)
- **Clean:** ripple, burst and icon pop.
- **Wobbly:**
  - **Halftone burst ring on `::after`:**
    ```css
    background: radial-gradient(circle, var(--lively-accent) 1.4px, transparent 1.8px) 0 0 / 6px 6px;
    mask: radial-gradient(circle, transparent 38%, #000 40% 62%, transparent 70%);
    inset: -14px;
    animation: lively-burst var(--lively-pulse) var(--lively-ease-out);
    ```
    `lively-burst`: 0% `{opacity:0; scale:.3}`, 20% `{opacity:1}`, 100% `{opacity:0; scale:1.6}`. This replaces the box-shadow ripple: the comic impact.
  - **Icon:** `lively-sticker-pop var(--lively-overlay) var(--lively-spring) backwards`. At lively that is scale 0.35 → 1.3 → 0.91 → … → 1, with rotate −7.2° → 0.
  - The intensity work's particle `::before` stays as it is (its accents read as "sparks").

**6. statusPulse** (`.lively-pulse` on `statusRow`)
- **Clean:** two gradient rings plus a halo.
- **Wobbly:**
  - Keep the rings (pseudo, opacity and scale), but run them **once** with `steps`-free easing `var(--lively-snap)`, so they land hard.
  - Add on the row itself:
    ```css
    animation: lively-chroma 160ms steps(1, end) 1,
               lively-swell 360ms var(--lively-ease-out) 1;
    ```
    Both are host-safe: `filter` and `scale`, no transform. `statusRow` is already positioned.
  - For `tone="error"` only, add the jelly, with `--lively-squash` × 0.5. A failed thread "shudders".

**7. toastSpring** (sonner `toast`; sonner drives `transform`)
- **Wobbly:** **retime only**.
  - `transition-timing-function: var(--lively-spring), …` with the wobbly curve. Sonner's slide-in then bounces 2–3 times.
  - `transition-duration: var(--lively-enter)` for transform.
  - Static: `filter: drop-shadow(var(--lively-sticker) var(--lively-sticker) 0 #000);`, plus `rotate: var(--lively-tilt)` at rest? **No.** A permanently tilted toast hurts legibility. Instead use a one-shot `rotate` keyframe (`from { rotate: calc(var(--lively-tilt) * 3) }`), since `rotate` composes with sonner's `transform`.
- **Never** add transform keyframes or skew here.

**8. overlayEnter** (`overlayOpen` / `overlayClosed`; tw-animate variables)
- **Open:**
  ```css
  --tw-duration: var(--lively-overlay);
  --tw-ease: var(--lively-spring);      /* wobbly curve */
  --tw-enter-scale: var(--lively-overlay-scale);
  --tw-enter-rotate: calc(var(--lively-tilt) * 2);
  --tw-enter-blur: 0;
  transform-origin: var(--radix-popper-transform-origin, center);
  filter: drop-shadow(var(--lively-sticker) var(--lively-sticker) 0 var(--lively-accent));
  ```
  - Verify `--tw-enter-rotate` against bb's built CSS. tw-animate-css defines it, but bb's bundle must include it.
  - The static sticker filter is on the content element, not the popper wrapper.
- **Closed (snap out, O2):** `--tw-duration: var(--lively-exit)` (80 ms), `--tw-ease: var(--lively-ease-in)`, `--tw-exit-scale: .96`. No wobble on exit.
- **Dialogs** (`[role=dialog]`): halve `--tw-enter-rotate` and keep the sticker. Large surfaces wobbling is the point where it gets tiring, so `squash` does not apply.

**9. toggles**
- **Switch thumb:** Radix plus Tailwind v4 moves the thumb with the `translate` **property**, so `scale` is free.
  - Retime: `transition: translate var(--lively-release) var(--lively-spring)`. The wobbly curve gives a thumb that overshoots and bounces 2–3 times.
  - Add a one-shot jelly on state change. CSS can restart it without JS by alternating identical keyframes per state:
    - `[data-state=checked] > span { animation: lively-jelly-a … }`
    - `[data-state=unchecked] > span { animation: lively-jelly-b … }`
    - Delay 60 ms, so the squash happens as the thumb lands.
  - The drawback: it also plays when a Settings page mounts. Accept that (it is short), or gate it with a JS class as `lively-check` already does.
- **Checkbox** (`.lively-check`): `lively-sticker-pop` plus `lively-flash` (brightness) over `var(--lively-release)`.

**10. pageEnter** (from the intensity work; `pageView`)
- **Wobbly:** `lively-enter-w` with `rise / 2` and **no skew**: a whole thread window skewing is too much.
- **Optional, separate effect `pageWipe` (off by default):** the O3 slanted slab.
  - A `::before` on `pageView` with `position:absolute; inset:-10% -30%; background: var(--lively-accent) radial-gradient(#0003 1px, transparent 1.5px) 0 0/6px 6px; transform: skewX(-18deg); pointer-events:none; z-index: 1`.
  - Keyframes on `translate`: `0% {translate: 110% 0} 40% {translate: 0 0} 65% {translate: 0 0} 100% {translate: -130% 0}` over 400 ms `linear`.
  - Pure transform, one large layer for 400 ms on thread switch only.
  - It hides content for about 100 ms, and needs `overflow: clip` on `pageView` (check that bb doesn't already rely on overflow there).

**11. workingGlow** (idle breathing)
- **Wobbly:** besides the glow loop, add `scale: 1 → calc(1 + var(--lively-swell) * .25)` with `ease-in-out infinite alternate` at `--lively-breathe`. At lively that is about 1.4% "breathing", like a character idle.
- Full level only, and paused under `document.hidden` (existing rule).

**12. typingGlow and calmHost**
- Unchanged.

**Not proposed**
- **Rubber-band drags.** bb owns every drag (thread reorder, resizers, vaul drawers), and the press exclude list deliberately skips them. A drag wobble would need pointer-position reads per frame and would fight dnd-kit. macOS Chromium already rubber-bands overscroll.
- **Text glitch on headings.** There is no stable heading hook, and splitting text needs DOM edits.

### 3.5 Reduced motion

- `REDUCED_TOKENS` gains zeros for `squash`, `skew`, `tilt`, `swell`, `flash`, `chroma` and `peakAt`, so the spring falls back to `ease-out`.
- `sticker` is the exception. It **stays** as a **static** rest state (a shadow is not motion), but its hover snap becomes instant.
- Both styles therefore reduce to the identical 120 ms opacity fades.
- The `@media (prefers-reduced-motion: reduce)` system block already repeats the token block. Add `animation: none` for `lively-chroma`, `lively-swell` and the working breathe, because flicker and flashes matter most to vestibular- and photosensitive users.
- The chroma flash runs 2–3 frames, a single time, at ≤ 3 px. That is well under WCAG 2.3.1's three-flashes-per-second rule, but keep it off in reduced mode anyway.

### 3.6 Optional "Lively ZZZ" palette theme (`themes/lively-zzz.css`, tokens only)

Colours are taken from the measured frames (O1, O4, O8).

```css
.dark {
  --canvas: #0e0e10;  --ink: #f3f2ec;
  --card: #1a1b1e;    --popover: #121316;  --sidebar: #0b0b0d;
  --primary: #c8f031;  --primary-foreground: #0e0e10;  /* lime (selected) */
  --timeline-accent: #f7da00;                          /* yellow (pressed) → --lively-accent-2 */
  --warning: #ff8a1f;  --attention: #f7da00;  --destructive: #ff4b3e;  --success: #6bf06b;
  --border: #34363c;   --input: #34363c;               /* CRT bezel grey */
  --ring: #c8f031;
  --radius: .75rem;
  --shadow-lift: 4px 4px 0 0 #000;                     /* hard offset; elevation reads as stickers */
  --default-transition-duration: 120ms;
  --default-transition-timing-function: linear(0, .62 12%, .94 24%, 1 34%, 1);  /* snap */
}
:root, .light { /* a light variant is off-brand for ZZZ; ship the same palette with --canvas #f1efe6 and black outlines, or dark only */ }
```

- **Thick outlines.** bb has no global border-width token. Element-scoped blocks would raise `border-width` on `[data-slot=popover-content]` and `[data-sonner-toast]` to 2px, but that is a selector, rated M, and it belongs in the adapter, not the theme. Recommend **sticker shadows over thicker borders**: the same read, no layout change.
- **Typography.** ZZZ uses a heavy italic grotesque. Changing bb's `--font-sans` to an italic black weight would wreck readability in code-adjacent UI, and theme CSS should not fetch fonts. **Leave the fonts alone.** If anything, one optional rule could apply `font-style: italic; font-weight: 800` to `[data-slot=badge]`-like chips; that is out of scope.
- **Halftone texture.** A fixed `body::before` with a 7 px dot `radial-gradient` at 5–6% opacity. It is static paint on a fixed layer, cheap, but a pure-theme file can't guarantee the pseudo isn't used, so put it behind a lively effect (`texture`, off by default) rather than in the theme.
- **Validate** in Theme Preview: lime `#c8f031` on `#0e0e10` is about 14:1, and `#0e0e10` text on lime is fine. Yellow `#f7da00` on near-black is about 13:1.

---

## 4. Performance notes

- **Properties.**
  - Everything wobbly animates `scale`, `translate`, `rotate`, `opacity` or `filter`.
  - The only `transform` keyframe is `lively-skew-in`, always with `animation-composition: add`, only on `.lively-enter` rows (≤ 4) and optionally the `pageWipe` pseudo.
  - The stylesheet test's allow-list needs `transform` added **only when** the same rule sets `animation-composition` containing `add`. That is a precise check the gate can make.
- **Filters.**
  - `drop-shadow`, `brightness`, and chroma as two `drop-shadow`s are compositor-animatable in Chromium.
  - Static sticker shadows cost one extra raster pass when the element repaints, so keep them **off** large scrolling surfaces (timeline rows, sidebar). Use them on buttons, cards, menus, toasts and the composer only.
  - Never use `filter: url(#svg)`.
- **Curves.** The `linear()` strings are computed once at sheet build. There is zero runtime spring math.
  - A 48-point `linear()` costs nothing at runtime; Chromium samples it like any easing.
  - Six token blocks is about 3 KB of CSS total.
- **No layout reads.**
  - Triggers stay CSS (`:active`, `:hover`, `[data-state]`, `:focus-within`) or attribute and event driven (the existing row watcher, `onSubmitted`, sidebar indicators).
  - The demo's `once()` helper restarts animations with a double `requestAnimationFrame`, not with `offsetWidth`.
- **Concurrency.**
  - ≤ 4 entering rows, 50 ms stagger. The worst case is 4 rows × (enter + skew + flash) = 12 animations for about 500 ms, all composited.
  - Chroma runs only on the last row of a batch.
  - `will-change` stays limited to the one-shot class.
- **Loops.** Only the existing breathing glows plus the working-indicator scale breathe, at the full level and paused when hidden. The working indicator is small; `scale` on it is composited.

## 5. Risks

1. **Host-transform interplay.**
   - `animation-composition: add` relies on bb's virtualizer, popper and sonner keeping their own transform on the same element.
   - If the virtualizer rewrites the row's `transform` mid-animation (re-measure), Chromium must re-resolve the underlying value and may drop the animation to the main thread for that frame. Visually it is still correct.
   - Mitigation: skew is a separate token, so it can be set to 0 per effect if the canary or QA show jitter.
2. **Popper wrappers.** Radix puts `transform` on `[data-radix-popper-content-wrapper]`. The adapter targets `wrapper > *` for content. Never put `lively-skew-in` on the wrapper itself.
3. **Sonner.** Sonner animates `transform` and swipes with inline styles. Use only timing retimes and `rotate`/`filter` there. Expanded or stacked toasts already move; a 3-bounce spring on every restack could feel busy, so consider the wobbly curve for the entering toast only (`[data-mounted="true"][data-front="true"]`, an M-rated sonner attribute; verify).
4. **Fatigue.**
   - ZZZ itself keeps UI motion minimal ([S1]). Wobbly × bold on every button press in a tool used for hours may tire people.
   - Defaults: `style: clean`. If wobbly, recommend lively, not bold, in the settings description.
   - Note: the intensity work currently defaults `intensity` to `bold`. Revisit that default once wobbly exists.
5. **Duration budget.** Wobbly tails exceed `MAX_ONCE_MS = 400`. Changing the budget to time-to-target ≤ 120 ms plus total ≤ 560 ms has to be agreed with the intensity work, or the tests will reject wobbly.
6. **`--tw-enter-rotate` and `--tw-exit-scale`** exist in tw-animate-css, but bb's built CSS might have been tree-shaken. Verify with a grep of `index-*.css`. If they are missing, drop the menu tilt and keep scale only.
7. **The switch keyframe trick** (`lively-jelly-a/b` per state) plays on mount. That is acceptable but visible when opening Settings. The JS-class alternative costs a listener.
8. **Accessibility.** The chroma and brightness flash must stay single and short, and off in reduced mode. Tilted resting states are avoided on purpose (legibility).
9. **The "ZZZ" claim.** The catalogue shows ZZZ menus are snappier than jelly. If the owner expects Bangboo-level bounce on widgets, "wobbly" over-delivers relative to the game and under-delivers relative to the memory. The demo lets them judge.

## 6. Open questions

1. Should `style` live in bb-lively's settings as a select (`clean | wobbly`), or should a "Lively ZZZ" theme imply it? The recommendation is a separate setting, since themes and motion are independent today.
2. Do we want the `pageWipe` slab (the most ZZZ signature, and the most intrusive)? It would ship off by default and run on thread switch only.
3. Is the owner fine with per-intensity jelly coefficients collapsed to one set (r = 0.3), or do they want three `@keyframes`?
4. Default `intensity` is `bold` in the intensity work. With wobbly available, should the defaults become `clean × lively`?
5. Should `sticker` shadows apply in `clean` too (as a Lively ZZZ theme token through `--shadow-lift`), making them a palette concern rather than a motion one? The proposal does both: the theme sets hard `--shadow-lift`, and wobbly adds snapped sticker hovers.
6. Is `animation-composition: add` acceptable to the stylesheet budget test, or should skew be dropped entirely (losing about 20% of the "ZZZ" read on rows)?
