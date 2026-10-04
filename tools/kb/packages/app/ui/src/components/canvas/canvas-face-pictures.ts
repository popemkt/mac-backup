import { mediaKindFromHref } from "@/sdk";

/**
 * The pictures image faces are painted with in 3D, decoded once per source
 * and shared by every face that shows it. A picture is asked for by its
 * source (`assetSrcUrl` of the item's file, the same route the 2D canvas's
 * `<img>` loads), loads in the background, and tells its owner when it is
 * ready or proves missing, so the faces showing it repaint. Sources no face
 * shows any more are let go (`keep`), and every load is cancelled on
 * `dispose`.
 */

/**
 * Whether a file item's file is a picture: an image, by its extension, as
 * markdown media is told apart. Any other file shows its path.
 */
export function isPicture(file: string): boolean {
  return mediaKindFromHref(file) === "image";
}

/** A picture as a face can paint it: still loading, missing, or decoded. */
export type FacePicture =
  | { readonly state: "loading" | "missing" }
  | { readonly state: "ready"; readonly image: HTMLImageElement };

const LOADING: FacePicture = { state: "loading" };
const MISSING: FacePicture = { state: "missing" };

interface Entry {
  readonly element: HTMLImageElement;
  /** Ends the load's handlers. */
  readonly loading: AbortController;
  picture: FacePicture;
}

export class FacePictures {
  private readonly entries = new Map<string, Entry>();
  private readonly settled: (src: string) => void;

  /** `settled` hears each source that finished loading, either way. */
  constructor(settled: (src: string) => void) {
    this.settled = settled;
  }

  /** The picture at `src`, starting its load the first time it is asked for. */
  get(src: string): FacePicture {
    const known = this.entries.get(src);
    if (known !== undefined) return known.picture;
    if (typeof Image === "undefined") return MISSING;
    const element = new Image();
    const entry: Entry = { element, loading: new AbortController(), picture: LOADING };
    const { signal } = entry.loading;
    element.decoding = "async";
    const settle = (picture: FacePicture) => {
      entry.picture = picture;
      this.settled(src);
    };
    element.addEventListener("load", () => settle({ state: "ready", image: element }), { signal });
    element.addEventListener("error", () => settle(MISSING), { signal });
    element.src = src;
    this.entries.set(src, entry);
    return LOADING;
  }

  /** Let go of every source not in `shown`. */
  keep(shown: ReadonlySet<string>): void {
    for (const [src, entry] of this.entries) {
      if (shown.has(src)) continue;
      release(entry);
      this.entries.delete(src);
    }
  }

  dispose(): void {
    this.keep(new Set());
  }
}

/** Stop a load and drop the decoded picture: its handlers go, and so does its source. */
function release(entry: Entry): void {
  entry.loading.abort();
  entry.element.removeAttribute("src");
}
