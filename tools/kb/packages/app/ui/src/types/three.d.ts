/** three ships no types (`@types/three` is not installed); declare the tiny
 * surface the force3d leaf (`components/graph/force3d-three.ts`) re-exports.
 * Keep this in step with that leaf. */
declare module "three" {
  /** three's mutable vector (scale / position). */
  export interface Vec3Like {
    set(x: number, y: number, z: number): number;
  }
  export class CanvasTexture {
    constructor(canvas: HTMLCanvasElement);
    /** Set to true to upload the canvas to the GPU. */
    needsUpdate: boolean;
  }
  export class SpriteMaterial {
    constructor(params?: {
      map?: CanvasTexture;
      transparent?: boolean;
      depthTest?: boolean;
      [key: string]: unknown;
    });
  }
  export class Sprite {
    constructor(material?: SpriteMaterial);
    scale: Vec3Like;
  }
  export class Object3D {
    constructor();
  }
}
