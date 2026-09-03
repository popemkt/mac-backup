import { Component, type ErrorInfo, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface ViewErrorProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

/** Recovery UI for a crashed lazy view — keeps surrounding chrome usable. */
export function ViewError({
  title = "This view crashed",
  message = "Something went wrong while rendering. The rest of kb is still available.",
  onRetry,
  className,
}: ViewErrorProps) {
  return (
    <div
      role="alert"
      data-testid="view-error"
      className={cn("flex h-full min-h-0 flex-col items-start justify-center gap-3 p-6", className)}
    >
      <h2 className="text-[13px] font-medium text-foreground/80">{title}</h2>
      <p className="max-w-md text-[13px] text-foreground/50">{message}</p>
      {onRetry ? (
        <button
          type="button"
          data-testid="view-error-retry"
          onClick={onRetry}
          className="rounded-md border border-foreground/10 bg-foreground/[0.04] px-3 py-1.5 text-[12px] text-foreground/70 transition-colors hover:bg-foreground/[0.08] hover:text-foreground/85"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

interface ViewErrorBoundaryProps {
  children: ReactNode;
  /** Reset error state when this key changes (e.g. route id). */
  resetKey?: string;
  title?: string;
  fallback?: ReactNode;
}

interface ViewErrorBoundaryState {
  error: Error | null;
}

/**
 * Localized boundary for lazy Graph / Canvas chunks.
 * Shell chrome (sidebar, header, palette) stays outside this tree.
 */
export class ViewErrorBoundary extends Component<ViewErrorBoundaryProps, ViewErrorBoundaryState> {
  override state: ViewErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ViewErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("ViewErrorBoundary caught", error, info.componentStack);
  }

  override componentDidUpdate(prevProps: ViewErrorBoundaryProps): void {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private retry = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <ViewError
          title={this.props.title}
          message={this.state.error.message || undefined}
          onRetry={this.retry}
        />
      );
    }
    return this.props.children;
  }
}
