Run a team of agents as ordinary bb threads: one coordinator over every project, a project chief
per project, and a task architect per bb Task. Each one is a thread you can open and talk to.

## What you get

- A **Chief** page beside the thread list. It shows the live tree: coordinator, then each project's
  chief, then its tasks (key, title, status) and their architects. Click any row to open the thread.
  A box at the top messages the coordinator.
- Agents in the hierarchy get tools for their role. They can stand up project chiefs, hand a task
  to an architect, read the roster and report up.
- Handing off a task creates the architect thread, attaches it to the task on the bb Tasks board,
  and moves the task to In progress.
- When an architect or chief finishes a turn, its last message goes to the thread above it on its
  own.
- `bb chief-mode` does the same from a terminal: `roster`, `adopt`, `drop`, `handoff`, `report`,
  `status`.

## How it works

A role is a small piece of this plugin's metadata on a thread. Nothing else about the thread
changes: it is not hidden, it has no parent link, and it runs your project's normal provider. So
every other plugin sees it as a plain thread. Any thread can join the hierarchy by adopting a role,
and leave it with `drop`. The hierarchy can always be rebuilt from those roles alone.
