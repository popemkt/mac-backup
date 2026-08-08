import { useToastStore } from "@/lib/toast";

export function ToastHost() {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-900 shadow"
          role="status"
        >
          <div className="flex items-start justify-between gap-2">
            <span>{t.message}</span>
            <button
              type="button"
              className="text-red-400 hover:text-red-700"
              onClick={() => dismiss(t.id)}
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
