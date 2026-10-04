import type { RefObject } from "react";
import type { CanvasDoc } from "@kb/canvas";
import { browserHost, logError } from "@/sdk";
import { screenToPlane, type CanvasPoint } from "./canvas-camera";
import { imageFilesOf, placePictures, type PictureWrite } from "./canvas-media";
import type { CanvasSelection } from "./canvas-selection";
import type { TransformCamera } from "./canvas-transform-input";

interface PicturesContext {
  readonly docRef: RefObject<CanvasDoc>;
  readonly schedulePersist: (doc: CanvasDoc) => void;
  readonly setSelection: (selection: CanvasSelection) => void;
  /** The showing camera and its viewport: where a viewport point is on the floor. */
  readonly camera: () => TransformCamera;
  /** Where the pointer last was over the canvas, as a viewport point. */
  readonly pointerAt: () => CanvasPoint;
  /** Where a picture chosen with the image tool lands: the header's placement point. */
  readonly placementPoint: () => CanvasPoint;
  /** The element both projections are stacked in, which a drop lands on. */
  readonly stage: RefObject<HTMLElement | null>;
}

/**
 * The canvas page's ways in for pictures (`canvas-media`): a paste lands at
 * the pointer, a drop where it is let go, and the image tool's file chooser
 * at the placement point, each through whichever projection is showing.
 */
export function useCanvasPictures(context: PicturesContext) {
  const write: PictureWrite = {
    upload: (file) => browserHost().uploadAsset(file),
    doc: () => context.docRef.current,
    persist: context.schedulePersist,
    select: context.setSelection,
  };
  /** The floor point under viewport point `local`, or the placement point when it is edge-on. */
  const floorAt = (local: CanvasPoint): CanvasPoint => {
    const { view, size } = context.camera();
    return screenToPlane(view, size, local, 0) ?? context.placementPoint();
  };
  const place = (files: readonly File[], at: CanvasPoint) => {
    placePictures(files, at, write).catch((error: unknown) => {
      logError("[kb/canvas] placing pictures failed:", error);
    });
  };
  return {
    /** The clipboard's pictures, placed at the pointer; whether it held any. */
    paste: (files: Iterable<File>): boolean => {
      const pictures = imageFilesOf(files);
      if (pictures.length > 0) place(pictures, floorAt(context.pointerAt()));
      return pictures.length > 0;
    },
    /** The image tool's chooser: the files picked are placed at the placement point. */
    choose: (): void => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.multiple = true;
      input.addEventListener("change", () => {
        const pictures = imageFilesOf(input.files ?? []);
        if (pictures.length > 0) place(pictures, context.placementPoint());
      });
      input.click();
    },
    /** A drag of files over the canvas may drop them. */
    onDragOver: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    /** Pictures dropped on the canvas land where they were let go. */
    onDrop: (event: React.DragEvent) => {
      const pictures = imageFilesOf(event.dataTransfer.files);
      const rect = context.stage.current?.getBoundingClientRect();
      if (pictures.length === 0 || rect === undefined) return;
      event.preventDefault();
      place(pictures, floorAt({ x: event.clientX - rect.left, y: event.clientY - rect.top }));
    },
  };
}
