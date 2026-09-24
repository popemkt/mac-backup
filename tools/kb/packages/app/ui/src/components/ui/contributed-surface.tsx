import { SurfacePoint, useContributions, type SurfaceParams } from "@/lib/plugins";

/**
 * Render another plugin's surface by id — how one view embeds another (an
 * ontology's outline is the outline) without importing it.
 */
export function ContributedSurface({
  id,
  params,
}: {
  readonly id: string;
  readonly params: SurfaceParams;
}) {
  const surfaces = useContributions(SurfacePoint);
  const Component = surfaces.find((surface) => surface.id === id)?.value.Component;
  return Component === undefined ? null : <Component params={params} />;
}
