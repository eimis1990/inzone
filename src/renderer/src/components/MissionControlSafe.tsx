import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useStore } from '../store';
import { MissionControl } from './MissionControl';

interface State {
  error: Error | null;
}

/**
 * Error boundary around Mission Control. Same shape as
 * ReviewViewSafe / PipelineBoardSafe — Mission Control mounts at the
 * App root regardless of whether it's open, so any render crash
 * inside it would take down the entire window. The boundary catches
 * those, surfaces a small recovery panel, and lets the user keep
 * working.
 *
 * The infinite-loop class of bugs (fresh-closure Zustand selectors)
 * is the most likely failure mode based on past experience — having
 * the boundary here means a future regression is recoverable instead
 * of a black-screen disaster.
 */
export class MissionControlSafe extends Component<
  { children?: ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[MissionControl] crashed:', error, info);
  }

  render() {
    if (this.state.error) {
      return <MissionControlCrashFallback error={this.state.error} />;
    }
    return <MissionControl />;
  }
}

function MissionControlCrashFallback({ error }: { error: Error }) {
  const open = useStore((s) => s.missionControlOpen);
  const setOpen = useStore((s) => s.setMissionControlOpen);
  if (!open) return null;
  return (
    <div className="mission-control-root" onMouseDown={() => setOpen(false)}>
      <div
        className="mission-control"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ maxWidth: 560 }}
      >
        <header className="mission-control-header">
          <div className="mission-control-title">
            <h2>Mission Control hit an error</h2>
            <p>Close this and your panes will be unaffected.</p>
          </div>
          <button
            type="button"
            className="mission-control-close"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="mission-control-body" style={{ display: 'block' }}>
          <pre className="pipeline-crash-detail">{error.message}</pre>
        </div>
      </div>
    </div>
  );
}
