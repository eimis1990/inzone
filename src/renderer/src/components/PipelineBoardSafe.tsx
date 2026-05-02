import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useStore } from '../store';
import { PipelineBoard } from './PipelineBoard';

interface State {
  error: Error | null;
}

/**
 * Error boundary around the pipeline board. The board reads several
 * derived bits of state (panes map, tree, agents) — if any of them
 * desync briefly during a project switch the renderer can throw, and
 * without a boundary the user sees a blank screen with no escape hatch
 * (the toolbar is inside the board, so they can't get back to panes).
 *
 * On error we surface a friendly message + a "Back to panes" button
 * that flips the view back, plus a Reload button as a last resort.
 */
export class PipelineBoardSafe extends Component<{ children?: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[PipelineBoard] crashed:', error, info);
  }

  render() {
    if (this.state.error) {
      return <PipelineCrashFallback error={this.state.error} />;
    }
    return <PipelineBoard />;
  }
}

function PipelineCrashFallback({ error }: { error: Error }) {
  const setView = useStore((s) => s.setPipelineView);
  return (
    <div className="pipeline-crash">
      <h3>Pipeline view hit an error.</h3>
      <p>
        Something went wrong rendering the board. You can drop back to
        the panes view and try again — the panes themselves are fine.
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
