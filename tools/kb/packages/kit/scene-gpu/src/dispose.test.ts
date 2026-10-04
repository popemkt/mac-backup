import { describe, expect, it } from "vitest";
import {
  BufferGeometry,
  Group,
  LineBasicNodeMaterial,
  LineSegments,
  Mesh,
  MeshStandardNodeMaterial,
  Points,
  PointsNodeMaterial,
  Scene,
  Sprite,
  SpriteNodeMaterial,
  type EventDispatcher,
} from "three/webgpu";
import { disposeGraph } from "./dispose";

/** Every resource created here, and which of them have been disposed. */
function tracker() {
  const live = new Set<EventDispatcher<{ dispose: object }>>();
  const track = <T extends EventDispatcher<{ dispose: object }>>(resource: T): T => {
    live.add(resource);
    resource.addEventListener("dispose", () => live.delete(resource));
    return resource;
  };
  return { live, track };
}

describe("disposeGraph", () => {
  it("frees the geometry and material of every drawable, lines and points included", () => {
    const { live, track } = tracker();
    const scene = new Scene();
    const nested = new Group();
    nested.add(
      new LineSegments(track(new BufferGeometry()), track(new LineBasicNodeMaterial())),
      new Points(track(new BufferGeometry()), track(new PointsNodeMaterial())),
    );
    scene.add(
      new Mesh(track(new BufferGeometry()), [
        track(new MeshStandardNodeMaterial()),
        track(new MeshStandardNodeMaterial()),
      ]),
      new Sprite(track(new SpriteNodeMaterial())),
      nested,
    );
    expect(live.size).toBe(8);
    disposeGraph(scene);
    expect(live.size).toBe(0);
    expect(scene.children).toHaveLength(0);
  });

  it("leaves the quad three shares between sprites alone", () => {
    const shared = new Sprite(new SpriteNodeMaterial()).geometry;
    let freed = false;
    shared.addEventListener("dispose", () => {
      freed = true;
    });
    const scene = new Scene();
    scene.add(new Sprite(new SpriteNodeMaterial()));
    disposeGraph(scene);
    expect(freed).toBe(false);
    expect(scene.children).toHaveLength(0);
  });
});
