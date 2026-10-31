Motion for bb on whatever theme you use: an intensity (subtle to bold) and a style (clean or
wobbly), each one setting. Or one **preset** that sets the whole look at once: motion, bb's
palette and an art layer.

## Presets

- **Calm**: subtle, clean motion, no sticker shadows, no page wipe; leaves bb's theme alone.
- **Lively**: clean motion at the lively volume on the Lively palette.
- **ZZZ**: wobbly at bold, skewing rows, sticker shadows, matched jelly, the page wipe, the
  Lively ZZZ palette, a halftone-and-slash backdrop behind the thread and hazard stripes
  under the sidebar, running behind the composer to the bottom edge.
- **Cloudbank** (after Transistor): a gliding clean spring, the Lively Cloudbank palette
  (blue-violet night, the sword's teal light along every seam, city-light gold; a
  warm-paper day mode), a dusk skyline behind the thread, functions written as calls
  (`Crash() Breach() Jaunt()…` down the sidebar), the Process whitewashing the thread into
  cells as you `Jaunt()` to another, and **Turn()**: while an agent waits for you (an
  approval, a question, a plan to review), the thread freezes into a dim cyan plan and the
  request lights up as its segmented Turn() bar fills.
- **YoRHa** (after NieR:Automata): mechanical motion (snappy, never past its target), the
  Lively YoRHa palette (parchment grey, umber ink, square corners; a night mode), a
  technical grid with a corner bracket, a soft scan-bar wipe, a send that scans the words
  out and prints the message in, a send button that locks on with corner brackets, and a
  **glitch** when a thread fails.
- **Control** (after Remedy's Control): precise motion (no overshoot, no tilt), the Lively
  Control palette (concrete greys at night, the Astral Plane's white by day, Hiss red only
  for what waits on you), coffered concrete, two monoliths under the Board's prism, a
  **redaction** wipe that blacks out every line, bb's own controls dressed as the Bureau's
  forms and signage (a bracketed composer with a Hiss-red tab, numbered directives, the
  title as a sign, case-file menus, the Astral Plane behind a new thread), and effects of
  its own: **shifting architecture** on a thread switch, **the Board's prism** sweeping the
  composer and **a send the Hiss takes** (the words come apart into soft, dark, prismatic
  dust drifting up and the message condenses out of it), and **the Hiss** while an agent
  waits for you. When bb runs with HTML-in-Canvas
  (`--enable-blink-features=CanvasDrawElement`), the thread switch breaks the thread's real
  pixels, the dust is made of them, and the Hiss resonates in red echoes; without it the
  dust is drawn from the text's glyphs, and CSS draws the rest.
  Text is never covered at rest.
- **Custom**: no preset.

Every setting below starts on **From preset**. Set one yourself and it stays as you set it
whatever preset you pick; the settings page's **Preset** section shows each setting's value
now and whether you, the preset or the default set it. Picking a preset with a palette
switches bb's theme to it (and picking one without puts your own back); **Keep my bb
theme** stops that. Add your own picture with **Art image** (a link, or a file on the
machine bb runs on): the preset places it and fades it so text stays readable.

## What you get

- **Press.** Buttons sink while you hold them and spring back when you let go.
- **New messages rise in.** A row that arrives at the end of a thread fades in and rises;
  at lively and bold it also comes into focus from a slight blur, and a burst of rows staggers. Rows you scroll back to, and a thread you switch to, never animate.
- **Menus and dialogs** open on a quick spring from where you opened them, and close faster.
- **Send burst.** Sending ripples the send button, with a ring of particles at lively and
  bold; the Send/Stop icon pops as it swaps.
- **Thread status pulse.** A thread in the sidebar that just finished, failed, or started
  waiting for you rings twice in a gradient of green, red, or yellow.
- **Thread transitions.** Opening a thread, or one in a split pane, fades and rises in.
- **Working glow.** The "Working..." line under a running agent breathes with a soft glow.
- **Composer focus glow** (breathing at lively and bold), **toast slide and settle**,
  **switch and checkbox** motion, and a **hover lift** on cards, with a soft shadow at
  lively and bold.
- Optional: an **accent caret** in the composer, and **calm bb's own motion** under reduced
  motion (bb has no reduced-motion setting of its own).

- Optional: a **page wipe**, ZZZ's slanted, dotted panel sweeping across a thread as you
  switch to it (off by default: it covers the thread for a moment).

### Wobbly

The **Wobbly** style, after Zenless Zone Zero's UI, changes the shape of every effect rather
than its volume: things snap in fast, then settle in two or three bounces.
- Buttons squash while held and wobble back like jelly.
- New messages slap in from the lower right with a bright flash, skewing in and straightening
  as they land; the last of a batch splits into color for a frame.
- Menus spring open from a tilt and snap shut.
- The send button throws a halftone comic burst, and its icon pops in like a sticker.
- A status change lands its ring hard, splits into color and swells; a failed thread shudders.
- The focused composer gets a solid accent ring that snaps in and swells once.
- Hovered cards tilt, and **sticker shadows** (hard offset shadows) snap in under them and sit
  under menus and toasts.
- The working line breathes in scale, like a character idling.

Clean presses stay under 100 ms and everything else under 400 ms. Wobbly lands within 120 ms
and settles within 560 ms: the feel is the attack, not the tail. Everything moves only
position, scale, rotation, opacity and filters; the one skew is composited onto bb's own
positioning and never touches toasts. Nothing moves while bbim's hints are up.

## Settings

- **Preset:** Custom (the default), Calm, Lively, ZZZ, Cloudbank, YoRHa or Control. Every other setting can be left on
  From preset (the default) or set to a value of its own.
- **Motion:** System (follows your OS "reduce motion"), Full, Reduced (short fades only, no
  movement), or Off.
- **Intensity:** Subtle (the quiet original), Lively, or Bold (the default): more
  overshoot, travel, glow and particles, with every effect scaled together.
  Reduced motion turns any intensity into the same short fades.
- **Style:** Clean (the default) or Wobbly. Any intensity works with either; Lively suits
  wobbly for all-day use. Reduced motion turns both into the same short fades.
- **Skew** (wobbly): arriving messages skew in. On by default.
- **Sticker shadows:** with wobbly (the default), always (clean too), or off.
- **Jelly decay** (wobbly): Shared (one jelly shape, the default) or Matched (each intensity
  wobbles like its own spring, so Bold wobbles longer).
- **Speed:** Snappy, Normal, Relaxed.
- One switch per effect: From preset, On or Off.
- **Palette:** From preset, or Keep my bb theme.
- **Art:** the preset's backdrop, fonts and your image, on or off.
- **Art image:** your own picture, a link or a file on the bb machine; never stored in a repository.

The settings page also lists any of bb's own markup lively relies on that has not shown up
in this window, so a bb update that breaks an effect is visible instead of silent.

## Themes

Optional palettes in Settings → Appearance: **Lively** (warm neutrals, a soft violet
accent) and **Lively Dracula** (bb's Dracula with Lively's rounder corners and springier
transitions), each with a **Bold** variant that carries the accent further (tinted
selection, accent focus ring, glowing elevation, rounder corners) to pair with Bold
intensity. **Lively ZZZ** is near-black with lime and yellow accents and hard offset
shadows, to pair with Wobbly. **Lively Cloudbank**, **Lively YoRHa** and **Lively Control** are the
Cloudbank, YoRHa and Control presets' palettes, each with a light and a dark mode. The motion works without
any of them.
