import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useStore } from '../store';
import { ReviewView } from './ReviewView';

interface State {
  error: Error | null;
}

/**
 * Error boundary around the diff Review view. Same shape as
 * PipelineBoardSafe — if anything in ReviewView throws (a Zustand
 * selector misbehaving, a stale paneId reference, a malformed diff
 * payload, etc.), we surface a real fallback with an escape hatch
 * back to the panes view instead of leaving the user staring at a
 * grey screen.
 */
export class ReviewViewSafe extends Component<{ children?: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ReviewView] crashed:', error, info);
  }

  render() {
    if (this.state.error) {
      return <ReviewCrashFallback error={this.state.error} />;
    }
    return <ReviewView />;
  }
}

function ReviewCrashFallback({ error }: { error: Error }) {
  const setView = useStore((s) => s.setPipelineView);
  return (
    <div className="pipeline-crash">
      <h3>Review view hit an error.</h3>
      <p>
        Something went wrong rendering the diff. You can drop back to
        the panes view and try again — the working tree itself is
        unchanged.
      </p>
      <pre className="pipeline-crash-detail">{error.message}</pre>
      <div className="pipeline-crash-actions">
        <button
          type="button"
          className="primary"
          onClick={() => setView('panes')}
        >
          ← Back to panes
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => window.location.reload()}
        >
          Reload app
        </button>
      </div>
    </div>
  );
}
