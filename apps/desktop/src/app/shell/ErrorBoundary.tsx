import { Component, createRef, type ErrorInfo, type ReactNode } from "react";
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
  private alert = createRef<HTMLDivElement>();

  static getDerivedStateFromError(e: unknown): State {
    return { error: errText(e) };
  }

  componentDidUpdate() {
    // The crash replaced whatever had focus: move it to the message so a screen reader reads it.
    if (this.state.error !== null) this.alert.current?.focus();
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
        ref={this.alert}
        tabIndex={-1}
        role="alert"
        className="flex h-dvh flex-col outline-none items-center justify-center gap-3 bg-bg p-6 text-center"
      >
        <span className="flex size-16 items-center justify-center rounded-full bg-danger-soft text-danger">
          <TriangleAlert size={28} aria-hidden />
        </span>
        <h1 className="font-book text-heading font-semibold text-ink">
          <Trans>Something went wrong</Trans>
        </h1>
        <p className="text-sm text-ink">
          <Trans>
            Your last changes were saved if possible. Choose Reload to open the app again. If this
            keeps happening, restart CadabraCraft; your books are in their folders, and earlier
            versions are in History.
          </Trans>
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
