---
name: verifiable-results
description: Finish every task by handing over the easiest-to-check end result first (a link, a live trial, a screenshot, a one-line command and its real output), then explain only if needed — walkthrough, before/after page, tldraw board, kb canvas, diagram. Use at the end of any task that changes something a person will look at or rely on, when reporting work done by agents, or when the user asks "show me", "before/after", "walk me through it", "what changed", "how do I check this".
---

# Verifiable results

The owner judges work by what they can see and check themselves, fastest first.
A report that needs reading before it can be believed has failed. So every task
ends in two layers:

1. **The result**: one thing the person can open or run in seconds that shows the
   work done and working. Always.
2. **The explanation**: only when the result alone does not make the change
   understandable. Pick the lightest technique that does.

## Layer 1: the result (always)

Lead the final message with it, before any prose. Pick the first that fits:

| The work is… | Hand over |
|---|---|
| A UI change | A live URL (trial or deployed), opened at the exact page/state, plus one screenshot of that state |
| A backend / CLI change | The one command to run and its **real** output, trimmed |
| A fix | The reproduction that failed before and passes now (test name, or command + output) |
| A doc / research | A link to the rendered doc, plus a ≤5-line summary of its conclusion |
| A config / infra change | The status command that proves it is applied (`systemctl status`, `kb --version`, a health URL) and its output |
| A PR | The PR link, the CI state, and how to try it (trial URL or command) |

Rules:

- **Real, never fabricated.** Every screenshot, number and output comes from an
  actual run. If you could not capture something, say so in one line. Do not
  draw a mock-up and call it the result.
- **Verify the hand-over yourself first.** Open the URL (expect HTTP 200), run
  the command, and look at the screenshot before you send it. If an agent built
  the work, check its claimed result yourself and don't just relay it.
- **Clickable and stable.** Use Markdown links. In bb, put files in the thread
  storage (`$BB_THREAD_STORAGE`), which is web-served at
  `<bb-host>/api/v1/threads/<thread-id>/thread-storage/files/<path>`. Outside bb,
  give an absolute local path.
- **Say what is NOT verified**: untested platforms, a theme you didn't screenshot,
  CI still running. Keep it to one line each.
- **Safe to show.** No secrets, tokens or private data. No confidential (day-job)
  material or live third-party data in pictures. Capture from throwaway or
  synthetic stores.

## Layer 2: the explanation (when needed)

Add it when the change spans several steps, places or states, when the "why"
matters for a decision the person must make, or when they ask. Choose by shape:

| Shape of the change | Technique | Tool |
|---|---|---|
| Something looked or behaved wrong, and now it doesn't | **Before/after page** | HTML from `templates/before-after.html`, saved to thread storage |
| A flow the person will perform (setup, install, approval) | **Walkthrough**: numbered steps, one screenshot per step, the exact thing to click or type | The before/after template's `.item` cards, or a short Markdown doc with images |
| Several moving parts and where things live | **Map / board**: boxes, arrows, a legend | tldraw board (load `tldraw-conventions`; delegate to the `tldraw-offline` agent), or kb canvas (`kb_call` / the kb skill) |
| Status across many items (what's done, waiting, blocked) | **Status board**: colored columns plus a legend | tldraw page, or a kb canvas |
| Architecture or sequence | **Diagram** | `archify` skill, or a tldraw board |
| Motion or interaction (animations, live UI) | **Short screen capture**, or a frame strip | browser automation screenshots; `hyperframes` for a composed clip |
| A number got better | A **table**: measure, before, after, how it was measured | inline, or a `table.t` card on the before/after page |

### Before/after page

Copy `templates/before-after.html` into a fresh folder in thread storage, and
copy every image next to it, referenced by relative path. Then:

- Groups (`h2.gt`) by state: **Live**, **Waiting for you** (with trial links),
  **In progress** (one line each, no pictures).
- Each change is one `.item`:
  - a one-line `h3` saying what the person sees;
  - `.who` for where in the product, plus PR refs;
  - `.say` with a plain Before and After sentence;
  - pictures in `.pair` (`.one`, `.three`, `.tall`) or `<pre>` for terminal output.
- Pictures open full size on click. The page works in one column under 800px.
- Afterwards, fetch the page and every image and check each returns 200.

### Boards (tldraw / kb canvas)

- Keep one board per subject, and add a dated page instead of a new file when the
  subject's board exists.
- Use plain words on short cards, colours with a legend, and links on the cards
  (PRs, trials).
- Follow the board's ledger convention (the `tldraw-conventions` skill).

## The final message

```
<result: link / command+output / screenshot>; one line on what it shows
Not verified: …   (only if something isn't)
<explanation link(s)>, only if layer 2 was made
<decisions the person must make>, phrased as questions, if any
```

Keep prose short and plain. The result does the convincing; words only point at it.

## Works without any particular tool

This skill names tools the owner uses (bb thread storage, tldraw, kb, archify).
When one is missing, degrade:

- No bb: use local file paths.
- No tldraw or kb: use a Markdown doc with images, or an HTML page from the
  template.
- No browser: use command output.

The two layers and the "real, verified, clickable" rules never change.
