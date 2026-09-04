import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { KB_SDK_DTS, KB_SDK_VERSION } from "./sdk-dts.text.ts";

function sdkDtsPath(root: string): string {
  return join(root, ".kb", "sdk.d.ts");
}

/** Return the embedded SDK declaration text (matches this kb binary). */
export function readEmbeddedSdkDts(): string {
  return KB_SDK_DTS;
}

/**
 * Write `<root>/.kb/sdk.d.ts` from the embedded SDK string.
 * Creates `.kb/` when missing. Returns bytes written and kb version stamp.
 */
export async function writeSdkDts(
  root: string,
): Promise<{ path: string; bytes: number; version: string }> {
  const path = sdkDtsPath(root);
  await mkdir(join(root, ".kb"), { recursive: true });
  await writeFile(path, KB_SDK_DTS, "utf8");
  return { path, bytes: KB_SDK_DTS.length, version: KB_SDK_VERSION };
}
