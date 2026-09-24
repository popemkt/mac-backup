import type { Layer } from "effect";
import type { FileSystem } from "effect/FileSystem";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";

/**
 * The Bun-backed `FileSystem` every kb surface provides. The platform is a
 * composition choice, so the composition root names it; no store adapter
 * does, which is why a surface that only selects a store need not depend on
 * one.
 */
export const bunFileSystemLayer: Layer.Layer<FileSystem> = BunFileSystem.layer;
