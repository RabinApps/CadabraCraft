import { Component, type ErrorInfo, type ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import { TriangleAlert } from "lucide-react";
import { useProject } from "../../state/project/index";
import { Button } from "../../ui/Button";
import { errText } from "../../lib/projectError";

interface State {
  error: string | null;
}

/**
 * Last resort for a crash while rendering: instead of a blank window, unsaved typing is written first (it lives in the
 * store, not in the component that crashed) and the author is offered a reload.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(e: unknown): State {
    return { error: errText(e) };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    void useProject
      .getState()
      .actions.flush()
      .catch(() => {});
  }

  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div
        role="alert"
        className="flex h-dvh flex-col items-center justify-center gap-3 bg-bg p-6 text-center"
      >
        <span className="flex size-16 items-center justify-center rounded-full bg-danger-soft text-danger">
          <TriangleAlert size={28} aria-hidden />
        </span>
        <h1 className="font-book text-heading font-semibold text-ink">
          <Trans>Something went wrong</Trans>
        </h1>
        <p className="text-sm text-ink">
          <Trans>Your last changes were saved if possible.</Trans>
        </p>
        <p dir="ltr" className="max-w-xl break-words font-mono text-xs text-ink-muted">
          {this.state.error}
        </p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          <Trans>Reload</Trans>
        </Button>
      </div>
    );
  }
}
