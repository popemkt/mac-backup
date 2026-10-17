import { extensionNodeId, SYSTEM_IDS } from "@kb/model";
import {
  chooseDesignSystem,
  cn,
  DesignSystemPoint,
  type EnumOption,
  EnumSelect,
  type ExtensionSwitch,
  isOutside,
  POPOVER_VALUE_CLASS,
  PopoverShell,
  PrefFieldRow,
  type PropValue,
  THEME_GLYPHS,
  type ThemePref,
  useContributions,
  useFieldEditor,
  useGraphRead,
  usePageBackdrop,
  type WidthPref,
} from "@kb/ui-sdk";
import { useEffect, useRef } from "react";
import { ArrowsHorizontalIcon, PuzzlePieceIcon, SwatchesIcon } from "@phosphor-icons/react";
import { mutations } from "@/actions/mutations";
import { useDesignSystemStore } from "@/stores/design-system.store";
import { usePrefsStore } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";

const THEME_OPTIONS: readonly EnumOption<ThemePref>[] = [
  { value: "system", label: "system" },
  { value: "light", label: "light" },
  { value: "dark", label: "dark" },
];
const WIDTH_OPTIONS: readonly EnumOption<WidthPref>[] = [
  { value: "centered", label: "centered" },
  { value: "full", label: "full" },
];

/** Off first: an optional extension is off until it is switched on. */
const PLUGIN_OPTIONS: readonly EnumOption<"off" | "on">[] = [
  { value: "off", label: "off" },
  { value: "on", label: "on" },
];

export function PreferencesPopover({
  switches,
  onSwitch,
}: {
  /** The optional extensions, one on/off row each; none, no section. */
  switches: readonly ExtensionSwitch[];
  /** Ask for one switched on or off; the row shows what the server then reports. */
  onSwitch: (name: string, on: boolean) => void;
}) {
  const open = useUiStore((s) => s.prefsOpen);
  const setOpen = useUiStore((s) => s.setPrefsOpen);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (isOutside(panelRef.current, e.target)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <PopoverShell panelRef={panelRef} title="Preferences" className="absolute right-4 top-11 mt-1">
      <ThemeRow />
      <DesignSystemRow />
      <WidthRow />
      <BackdropRows />
      {switches.length > 0 ? (
        <section aria-label="plugins">
          <h3 className="px-1.5 pb-1 pt-2 text-meta uppercase tracking-wide text-foreground/30">
            plugins
          </h3>
          {switches.map((entry) => (
            <PluginRow key={entry.name} entry={entry} onSwitch={onSwitch} />
          ))}
        </section>
      ) : null}
    </PopoverShell>
  );
}

function ThemeRow() {
  const theme = usePrefsStore((s) => s.theme);
  const setTheme = usePrefsStore((s) => s.setTheme);
  return (
    <PrefFieldRow icon={THEME_GLYPHS[theme]} label="theme">
      <EnumSelect
        className={POPOVER_VALUE_CLASS}
        value={theme}
        options={THEME_OPTIONS}
        onChange={setTheme}
      />
    </PrefFieldRow>
  );
}

/**
 * One swatch per contributed design system, in contribution order, the one
 * painting the page checked. Each sample is live, not a picture: it
 * carries `data-theme`, so that system's own stylesheet paints its ground,
 * ink, accent, face, radius and border, in the current light or dark. The
 * name under it stays in the popover's face, so it reads as a label.
 */
function DesignSystemRow() {
  const systems = useContributions(DesignSystemPoint);
  const current = useDesignSystemStore((s) => s.painted);
  return (
    <PrefFieldRow icon={SwatchesIcon} label="design">
      <div
        role="radiogroup"
        aria-label="design system"
        className="flex min-w-0 flex-1 gap-1.5 py-1"
      >
        {systems.map(({ value: { key: system } }) => {
          const checked = system.id === current;
          return (
            <button
              key={system.id}
              type="button"
              role="radio"
              aria-checked={checked}
              data-testid={`design-system-${system.id}`}
              onClick={() => void chooseDesignSystem(mutations, system.id)}
              className="group flex min-w-0 flex-1 flex-col items-stretch gap-1"
            >
              <span
                data-theme={system.id}
                className={cn(
                  "flex items-center justify-between gap-1 rounded-md border border-border bg-background px-1.5 py-1 font-sans text-ui leading-none text-foreground shadow-edge outline-offset-2",
                  checked ? "outline-2 outline-primary" : "group-hover:bg-accent",
                )}
              >
                Aa
                <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
              </span>
              <span
                className={cn(
                  "truncate text-caption leading-none",
                  checked ? "text-foreground/80" : "text-foreground/45",
                )}
              >
                {system.label}
              </span>
            </button>
          );
        })}
      </div>
    </PrefFieldRow>
  );
}

function WidthRow() {
  const width = usePrefsStore((s) => s.width);
  const setWidth = usePrefsStore((s) => s.setWidth);
  return (
    <PrefFieldRow icon={ArrowsHorizontalIcon} label="width">
      <EnumSelect
        className={POPOVER_VALUE_CLASS}
        value={width}
        options={WIDTH_OPTIONS}
        onChange={setWidth}
      />
    </PrefFieldRow>
  );
}

const CORE_NODE = extensionNodeId("core");
const NONE: PropValue[] = [];

/**
 * The page-head backdrop, as core's settings (DESIGN-UI.md → Page-head
 * backdrops): which one, how strong and which way, each an option field
 * drawn with the page's field editor, as any field is drawn. The backdrops
 * are the backdrop field's options, one per declared backdrop, so the
 * field's own picker is the one list of them. The direction is drawn only
 * where the backdrop shown faces a way.
 */
function BackdropRows() {
  const { backdrop } = usePageBackdrop();
  const graph = useGraphRead();
  const Field = useFieldEditor();
  const core = graph.outline.get(CORE_NODE);
  if (backdrop === null || core === undefined) return null;
  const setting = (fieldId: string, label: string) => (
    <Field
      nodeId={CORE_NODE}
      fieldId={fieldId}
      label={label}
      values={core.props[fieldId] ?? NONE}
      context={graph}
      depth={-1}
    />
  );
  return (
    <section aria-label="backdrop">
      {setting(SYSTEM_IDS.backdropField, "backdrop")}
      {setting(SYSTEM_IDS.backdropStrengthField, "strength")}
      {backdrop.value.presentation.directions.length > 0
        ? setting(SYSTEM_IDS.backdropDirectionField, "direction")
        : null}
    </section>
  );
}

function PluginRow({
  entry,
  onSwitch,
}: {
  entry: ExtensionSwitch;
  onSwitch: (name: string, on: boolean) => void;
}) {
  const { name } = entry;
  return (
    <PrefFieldRow icon={PuzzlePieceIcon} label={entry.label}>
      <EnumSelect
        className={POPOVER_VALUE_CLASS}
        value={entry.on ? "on" : "off"}
        options={PLUGIN_OPTIONS}
        testId={`plugin-${name}`}
        onChange={(next) => onSwitch(name, next === "on")}
      />
    </PrefFieldRow>
  );
}
