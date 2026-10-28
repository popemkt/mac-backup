The tldraw canvases linked to your work, beside the conversation.

## What you get

- A **Canvases** side-panel tab on every thread.
- **Thread | Project | All**: the canvases this thread's agent linked (default), the ones linked from any thread
  of the same git project, or every link. Project and All include the other Macs' links from the central log on
  shared-server when it is reachable.
- Each row shows the canvas name, its folder (or the machine it is on), when it was last edited, and a green dot
  when it is open in tldraw now. In Project and All, chips name the threads that linked it; click one to go there.
- **Search** (`/` focuses it) looks through every canvas, not only the linked ones: the scope's matches first,
  then every other canvas anyone linked or tldraw on the thread's machine knows (its recent files).
- **Select** rows (click, or Enter / Space; Escape clears), then act on them:
  - **Link to this thread** records them against this thread (and so its project).
  - **Unlink** ends this thread's own links to them; other threads' links stay.
  - **Open** opens each in tldraw offline on the machine that holds it.

## Where links come from

Agents run `canvas-link add <file>` after creating or editing a board (the tldraw-conventions skill asks them
to). The CLI keeps the log; the panel reads it with `canvas-link ls --json` on the thread's machine, and links
and unlinks with `canvas-link add|rm <key>` as the thread.

## What it cannot do yet

Open a canvas that lives on another machine: the row says which machine holds it.
