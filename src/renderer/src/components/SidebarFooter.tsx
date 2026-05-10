/**
 * Tiny status strip at the bottom of the sidebar showing the active
 * project's git branch when it has one. On non-git folders we instead
 * render a "No git · Initialize" pill that calls gitInit on click —
 * a low-friction onboarding step so worktrees, diff review, and the
 * commit/PR flow can all become available without leaving the app.
 *
 * Refresh strategy: re-read on cwd change + every 5 seconds while
 * mounted. Reading `.git/HEAD` via the system IPC is cheap (no shell
 * spawn) so polling is fine.
 */

import { useEffect, useState } from 'react';
import { useStore } from '../store';

type GitState =
  | { status: 'unknown' }
  | { status: 'no-git' }
  | { status: 'on-branch'; branch: string }
  | { status: 'detached' };

export function SidebarFooter() {
  const cwd = useStore((s) => s.cwd);
  const [git, setGit] = useState<GitState>({ status: 'unknown' });
  const [initializing, setInitializing] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    if (!cwd) {
      setGit({ status: 'unknown' });
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        // Two probes: branch (cheap) + worktreeStatus (also cheap, but
        // the only source of truth on whether .git exists at all). We
        // need worktreeStatus to differentiate "no git" from "detached
        // HEAD" — gitBranch returns null for both.
        const [branch, wt] = await Promise.all([
          window.cowork.system.gitBranch({ cwd }),
          window.cowork.system.worktreeStatus({ cwd }),
        ]);
        if (cancelled) return;
        if (branch) {
          setGit({ status: 'on-branch', branch });
        } else if (wt.isWorktree || wt.branch) {
          // .git exists but no branch — detached HEAD or similar.
          setGit({ status: 'detached' });
        } else {
          setGit({ status: 'no-git' });
        }
      } catch {
        if (!cancelled) setGit({ status: 'unknown' });
      }
    };
    void poll();
    // Pause polling while the window is unfocused — the branch only
    // changes via human action (checkout, switch in another app), and
    // we re-poll on focus return below. Halves idle CPU for this
    // strip when the user has the app in the background.
    let id: number | null = null;
    const start = () => {
      if (id != null) return;
      id = window.setInterval(() => void poll(), 5000);
    };
    const stop = () => {
      if (id == null) return;
      window.clearInterval(id);
      id = null;
    };
    const onFocus = () => {
      void poll(); // catch up immediately on focus return
      start();
    };
    if (document.hasFocus()) start();
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', stop);
    return () => {
      cancelled = true;
      stop();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', stop);
    };
  }, [cwd]);

  const handleInit = async () => {
    if (!cwd) return;
    setInitializing(true);
    setInitError(null);
    try {
      await window.cowork.system.gitInit({ cwd });
      // Force-refresh by setting unknown — the polling effect won't
      // run again until the next 5s tick, but unknown drives a
      // visual loading-ish state until we re-poll manually.
      const branch = await window.cowork.system.gitBranch({ cwd });
      setGit(branch ? { status: 'on-branch', branch } : { status: 'detached' });
    } catch (err) {
      setInitError(err instanceof Error ? err.message : String(err));
    } finally {
      setInitializing(false);
    }
  };

  if (git.status === 'unknown') return null;

  if (git.status === 'no-git') {
    return (
      <div
        className="sidebar-footer sidebar-footer-no-git"
        title={
          initError ??
          'This folder isn\'t a git repo. Click to initialize and unlock worktrees + review.'
        }
      >
        <span className="sidebar-footer-icon" aria-hidden>
          <BranchIcon />
        </span>
        <button
          type="button"
          className="sidebar-footer-init-btn"
          onClick={() => void handleInit()}
          disabled={initializing}
        >
          {initializing ? 'Initializing...' : 'No git · Initialize'}
        </button>
      </div>
    );
  }

  if (git.status === 'detached') {
    return (
      <div className="sidebar-footer" title="HEAD is detached">
        <span className="sidebar-footer-icon" aria-hidden>
          <BranchIcon />
        </span>
        <span className="sidebar-footer-branch">(detached)</span>
      </div>
    );
  }

  return (
    <div className="sidebar-footer" title={`On branch ${git.branch}`}>
      <span className="sidebar-footer-icon" aria-hidden>
        <BranchIcon />
      </span>
      <span className="sidebar-footer-branch">{git.branch}</span>
    </div>
  );
}

function BranchIcon() {
  return (
    <svg
      width={11}
      height={11}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* Stylised git-branch glyph: two columns connected by a curve. */}
      <circle cx="4" cy="3" r="1.5" />
      <circle cx="4" cy="13" r="1.5" />
      <circle cx="12" cy="6" r="1.5" />
      <path d="M4 4.5v7" />
      <path d="M12 7.5c0 3-3.5 3-3.5 5" />
    </svg>
  );
}
