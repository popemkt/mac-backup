// The server ↔ host contract. host.ts runs on the machine a thread's workspace lives on (or the machine a canvas
// lives on, for `open`); server.ts calls it there. Every call is one `canvas-link` run.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const run = z.object({ exitCode: z.number().int(), stdout: z.string(), stderr: z.string() });
export type Run = z.infer<typeof run>;

export const hostContract = defineRpcContract({
  /**
   * `canvas-link <command> <args>` in `cwd`, as the thread's session (BB_THREAD_ID). Only the panel's four
   * commands. `exitCode` 127: no canvas-link on this machine.
   */
  canvasLink: {
    input: z
      .object({
        command: z.enum(["ls", "add", "rm", "open"]),
        args: z.array(z.string().max(4096)).max(3),
        cwd: z.string().min(1).nullable(),
        threadId: z.string().min(1).nullable(),
      })
      .strict(),
    output: run,
  },
  /** This machine's short hostname, as canvas-link records it. */
  hostname: {
    input: z.object({}).strict(),
    output: z.string(),
  },
});
