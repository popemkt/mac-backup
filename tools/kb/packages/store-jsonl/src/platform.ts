import { type Layer } from "effect";
import { type FileSystem } from "effect/FileSystem";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";

/** Bun-backed FileSystem Layer — composition boundary for persistence + assets. */
export const bunFileSystemLayer: Layer.Layer<FileSystem> = BunFileSystem.layer;
