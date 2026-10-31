Keep your kb open beside the conversation, and let the agent work in it.

## What you get

- A **kb** tab in a thread's side panel (the header's network button, or the panel's Actions list) showing
  your kb page. A dot in its bar says whether the agent works in this tab. Each thread keeps its own kb tab
  alive while you switch between threads (the three most recent), so coming back is instant and kb is
  where you left it.
- Agent tools that act in that tab while it is open:
  - `kb_call` invokes any kb action. Inputs kb fills from the tab may be left out: "rename this" renames the
    node you have focused, a canvas verb acts on the canvas you have open and the items you selected. The
    answer says what "this" was. `ui.navigate` and `ui.select` move the tab to show you the result.
  - `kb_screen` says what the tab shows: route, panes, focus, selection, canvas camera.
  - `kb_manifest` lists kb's actions, and what each can take from the tab.
- With no kb tab open, the same tools still work, with every input given: the agent gets the work done
  without depending on your screen.
- A **kb canvases** tab: the kb canvases this thread, its project, or any thread wrote (through `kb_call`, or
  the thread's own kb CLI or kb MCP) or linked. Search every kb canvas, linked or not; select rows, then
  **Link to this thread**, **Unlink** (this thread's own links), or **Open** one in the kb tab. A green dot
  marks the canvas the kb tab shows now. It works like the Canvases tab for tldraw, on purpose: it is the same
  panel.
- **Open with each thread** (on by default) opens the tab beside every thread you open; closing the tab keeps it closed until the window reloads.

## Requirements

A kb server whose page allows bb to frame it: `kb ui --embed-origin <bb's origin>`. Set the page URL (and,
on the same machine, kb ui's socket) in the plugin's settings unless the server provides `KB_URL` and
`KB_SOCKET`.
