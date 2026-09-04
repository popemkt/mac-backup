import { Component, type ErrorInfo, type ReactNode } from "react";
import { logError } from "@/lib/log";

interface GraphCanvasErrorBoundaryProps {
  children: ReactNode;
  /** Reset when renderer / perspective changes. */
  resetKey?: string;
}

interface GraphCanvasErrorBoundaryState {
  error: Error | null;
  /** Last `resetKey` folded into state, so a change to it clears the error. */
  resetKey: string | undefined;
}

/**
 * In-canvas error state (r10 §2 row 10 / task 16c): a thrown renderer draws a
 * message *inside* the canvas frame and leaves page chrome interactive.
 */
export class GraphCanvasErrorBoundary extends Component<
  GraphCanvasErrorBoundaryProps,
  GraphCanvasErrorBoundaryState
> {
  override state: GraphCanvasErrorBoundaryState = { error: null, resetKey: undefined };

  static getDerivedStateFromError(error: Error): Pick<GraphCanvasErrorBoundaryState, "error"> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: GraphCanvasErrorBoundaryProps,
    state: GraphCanvasErrorBoundaryState,
  ): GraphCanvasErrorBoundaryState | null {
    if (props.resetKey === state.resetKey) return null;
    return { error: null, resetKey: props.resetKey };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    logError("GraphCanvasErrorBoundary caught", error, info.componentStack);
  }

  private retry = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <GraphCanvasError
          message={this.state.error.message || "Unknown renderer error"}
          onRetry={this.retry}
        />
      );
    }
    return this.props.children;
  }
}

export function GraphCanvasError({
  message,
  onRetry,
  title = "Graph rendering error",
}: {
  message: string;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <div
      role="alert"
      data-testid="graph-canvas-error"
      className="flex h-full min-h-0 flex-col items-start justify-center gap-3 p-6"
    >
      <h2 className="text-[13px] font-medium text-foreground/80">{title}</h2>
      <p className="max-w-md whitespace-pre-wrap text-[13px] text-foreground/50">{message}</p>
      {onRetry ? (
        <button
          type="button"
          data-testid="graph-canvas-error-retry"
          onClick={onRetry}
          className="rounded-md border border-foreground/10 bg-foreground/[0.04] px-3 py-1.5 text-[12px] text-foreground/70 transition-colors hover:bg-foreground/[0.08] hover:text-foreground/85"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
