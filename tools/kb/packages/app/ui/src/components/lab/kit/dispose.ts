/**
 * Give back every GPU resource a scene graph holds (Lab principle P3): each
 * object's geometry and material(s), whatever kind of object carries them —
 * meshes, sprites, lines, points — then empty the scene.
 *
 * A sprite's geometry is the one quad three shares between every sprite, so
 * it is never disposed here: freeing it left every sprite still drawing
 * (the Sky's stars, dust, sun and moon) submitting a destroyed buffer.
 */
import { Sprite, type BufferGeometry, type Material, type Object3D } from "three/webgpu";

interface Drawable {
  readonly geometry?: BufferGeometry;
  readonly material?: Material | Material[];
}

export function disposeGraph(root: Object3D): void {
  root.traverse((object: Object3D & Drawable) => {
    if (!(object instanceof Sprite)) object.geometry?.dispose();
    const material = object.material;
    if (material === undefined) return;
    for (const one of Array.isArray(material) ? material : [material]) one.dispose();
  });
  root.clear();
}
