/** The self-hosted Unicorn Studio runtime, shared by every header scene. */
export interface UnicornScene {
  paused: boolean;
  destroy: () => void;
}

interface UnicornRuntime {
  addScene: (options: {
    element: HTMLElement;
    filePath: string;
    fps: number;
    dpi: number;
    scale: number;
    lazyLoad: boolean;
  }) => Promise<UnicornScene>;
}

declare global {
  interface Window {
    UnicornStudio?: UnicornRuntime;
  }
}

let runtime: Promise<UnicornRuntime> | null = null;

function loadRuntime(): Promise<UnicornRuntime> {
  if (window.UnicornStudio) return Promise.resolve(window.UnicornStudio);
  runtime ??= new Promise<UnicornRuntime>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/vendor/unicorn/unicornStudio-2.1.12.umd.js";
    script.async = true;
    script.addEventListener(
      "load",
      () => {
        const loaded = window.UnicornStudio;
        if (loaded) resolve(loaded);
        else reject(new Error("Unicorn Studio runtime did not initialize"));
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => {
        script.remove();
        reject(new Error("Unicorn Studio runtime could not be loaded"));
      },
      { once: true },
    );
    document.head.append(script);
  }).catch((error: unknown) => {
    runtime = null;
    throw error;
  });
  return runtime;
}

export async function createUnicornScene(
  element: HTMLElement,
  signal: AbortSignal,
): Promise<UnicornScene> {
  const loaded = await loadRuntime();
  signal.throwIfAborted();
  return loaded.addScene({
    element,
    filePath: "/vendor/unicorn/scene.json",
    fps: 60,
    dpi: 1.5,
    scale: 1,
    lazyLoad: false,
  });
}
