/**
 * Pictures onto the canvas. Image files — pasted, dropped, or chosen with the
 * image tool — are stored as assets through the host's one upload
 * (`asset.upload`, the way markdown media is stored) and placed as image
 * items (`imageItem`): a file item whose `file` is the `assets/…` path, so a
 * picture on a canvas and a picture in a note are the same asset. Every
 * picture of one gesture is one history step, and is selected.
 */
import { ulid } from "ulid";
import { imageItem, placeItems, type CanvasDoc, type CanvasFileNode } from "@kb/canvas";
import type { CanvasSelection } from "./canvas-selection";

/** The image files among `files`; anything else is not a picture. */
export function imageFilesOf(files: Iterable<File>): File[] {
  return [...files].filter((file) => file.type.startsWith("image/"));
}

/** A file's pixel size, or undefined where this browser cannot decode it. */
async function naturalSize(file: File): Promise<{ width: number; height: number } | undefined> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return undefined;
  }
}

/** Each picture of one gesture lands this far on from the one before, canvas units. */
const STAGGER = 24;

/** Where pictures go: the one upload, and the page's write path and selection. */
export interface PictureWrite {
  /** Store a file as an asset; its `assets/…` path, or null when it could not be. */
  readonly upload: (file: File) => Promise<string | null>;
  readonly doc: () => CanvasDoc;
  readonly persist: (doc: CanvasDoc) => void;
  readonly select: (selection: CanvasSelection) => void;
}

/**
 * Upload `files` and place each as an image centred on `at` (the next ones
 * staggered), all in one write, selected; the items placed. A file that
 * could not be stored is left out (the upload has said why).
 */
export async function placePictures(
  files: readonly File[],
  at: { readonly x: number; readonly y: number },
  write: PictureWrite,
): Promise<readonly CanvasFileNode[]> {
  const placed = await Promise.all(
    files.map(async (file, i) => {
      const path = await write.upload(file);
      if (path === null) return null;
      const centre = { x: at.x + i * STAGGER, y: at.y + i * STAGGER };
      return imageItem(path, centre, ulid(), await naturalSize(file));
    }),
  );
  const items = placed.filter((item) => item !== null);
  if (items.length === 0) return items;
  write.persist(placeItems(write.doc(), items));
  write.select({ nodeIds: new Set(items.map((item) => item.id)), edgeIds: new Set() });
  return items;
}
