/**
 * Give back every GPU resource a scene graph holds (Lab principle P3): each
 * object's geometry and material(s), whatever kind of object carries them —
 * meshes, sprites, lines, points — then empty the scene.
 */
import type { BufferGeometry, Material, Object3D } from "three/webgpu";

interface Drawable {
  readonly geometry?: BufferGeometry;
  readonly material?: Material | Material[];
}

export function disposeGraph(root: Object3D): void {
  root.traverse((object: Object3D & Drawable) => {
    object.geometry?.dispose();
    const material = object.material;
    if (material === undefined) return;
    for (const one of Array.isArray(material) ? material : [material]) one.dispose();
  });
  root.clear();
}
