The tldraw canvases linked to your work, beside the conversation.

## What you get

- A **Canvases** side-panel tab on every thread.
- **Thread | Project | All**: the canvases this thread's agent linked (default), the ones linked from any thread
  of the same git project, or every link. Project and All include the other Macs' links from the central log on
  shared-server when it is reachable.
- Each row shows the canvas name, its folder (or the machine it is on), when it was last edited, and a green dot
  when it is open in tldraw now. In Project and All, chips name the threads that linked it; click one to go there.
- **Search** over names, folders and sessions (`/` focuses it).
- **Link focused canvas** records the canvas focused in tldraw offline against this thread.
- Click a row to open the canvas in tldraw offline on the machine that holds it.

## Where links come from

Agents run `canvas-link add <file>` after creating or editing a board (the tldraw-conventions skill asks them
to). The CLI keeps the log; the panel reads it with `canvas-link ls --json` on the thread's machine.

## What it cannot do yet

Open a canvas that lives on another machine: the row says which machine holds it.
