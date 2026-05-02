/**
 * Preview button rendered in the WorkspaceBar header (right of the
 * Workspaces pill).
 *
 * Behaviour:
 *  - Hidden when there's nothing to preview (no manual URL set, no
 *    localhost URLs detected in the active session's transcripts).
 *  - One URL: click opens the Preview modal at that URL directly.
 *  - Multiple URLs: click opens a dropdown menu; pick which one to
 *    open. Useful when an agent runs `npm run dev` (5173) and `npx
 *    serve` (3000) at the same time — both get listed.
 *  - ⌘B (or Ctrl+B on non-mac) opens the same dropdown when multiple
 *    URLs exist, or jumps straight in when there's only one.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { detectLocalhostUrls, useStore } from '../store';

export function PreviewButton() {
  const previewUrl = useStore((s) => s.previewUrl);
  const setPreviewUrl = useStore((s) => s.setPreviewUrl);
  const openPreview = useStore((s) => s.openPreview);
  const tree = useStore((s) => s.tree);
  const leadPaneId = useStore((s) => s.leadPaneId);
  const panes = useStore((s) => s.panes);
  const terminalLocalhostUrls = useStore((s) => s.terminalLocalhostUrls);
  const forgetLocalhostUrl = useStore((s) => s.forgetLocalhostUrl);
  const [killing, setKilling] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const activePaneIds = useMemo(() => {
    const ids = new Set<string>();
    walkLeaves(tree, (id) => ids.add(id));
    if (leadPaneId) ids.add(leadPaneId);
    return ids;
  }, [tree, leadPaneId]);

  const detectedUrls = useMemo(
    () => detectLocalhostUrls(activePaneIds, panes),
    [activePaneIds, panes],
  );

  // Combined list, in priority order:
  //   1. The user's manually-set previewUrl (if any) — first so the
  //      pill defaults to it.
  //   2. Localhost URLs surfaced by the in-app terminal (npx serve,
  //      pnpm dev, etc.) — most relevant when the user is iterating.
  //   3. URLs mined from agent transcripts (older sessions, agents
  //      that printed a URL while doing setup).
  // Deduped while preserving priority.
  const urls = useMemo(() => {
    const out: string[] = [];
    const push = (u: string) => {
      if (!out.includes(u)) out.push(u);
    };
    if (previewUrl) push(previewUrl);
    for (const u of terminalLocalhostUrls) push(u);
    for (const u of detectedUrls) push(u);
    return out;
  }, [previewUrl, terminalLocalhostUrls, detectedUrls]);

  const handleActivate = () => {
    if (urls.length === 0) {
      // Nothing detected — still open the modal so the user can paste
      // a URL by hand. The modal's empty state explains what to do.
      openPreview();
      return;
    }
    if (urls.length === 1) {
      // Commit the detected URL into store so PreviewModal's
      // `effectiveUrl` resolves to it. Without this the modal opens but
      // shows "No URL yet" because previewUrl is null and the modal's
      // own pane-only fallback finds nothing.
      const only = urls[0];
      if (previewUrl !== only) setPreviewUrl(only);
      openPreview();
    } else {
      setShowMenu((v) => !v);
    }
  };

  const pick = (url: string) => {
    setPreviewUrl(url);
    setShowMenu(false);
    openPreview();
  };

  /**
   * Kill the process listening on this URL's port. Confirms first
   * because dev servers often hold unsaved state. Drops the URL from
   * the detected list optimistically — if the kill fails (e.g. system
   * lsof hiccup) the URL will reappear next time it prints anything.
   */
  const killOne = async (url: string) => {
    const ok = confirm(
      `Kill the process listening on ${url}?\n\nINZONE will SIGTERM the listener (then SIGKILL after a moment if it doesn't exit). Make sure unsaved work is committed.`,
    );
    if (!ok) return;
    setKilling(url);
    try {
      const result = await window.cowork.system.killPort({ url });
      if (result.killed.length === 0 && result.errors.length === 0) {
        alert(`Nothing was listening on that port.`);
      } else if (result.errors.length > 0) {
        alert(
          `Killed ${result.killed.length} process(es), but had errors:\n` +
            result.errors.map((e) => `  PID ${e.pid}: ${e.message}`).join('\n'),
        );
      }
      forgetLocalhostUrl(url);
      // Close the menu if there's nothing left to show.
      if (urls.length <= 1) setShowMenu(false);
    } catch (err) {
      alert(
        `Couldn't kill that port: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setKilling(null);
    }
  };

  // ⌘P / Ctrl+P opens the preview (or the picker when multiple URLs).
  // P maps directly to the button label "Preview" so the muscle memory
  // is obvious. Skips when focus is in a text input so the user can
  // still type a literal "p".
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === 'p'
      ) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) {
          return;
        }
        e.preventDefault();
        handleActivate();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls.length]);

  // Close the picker on click outside.
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (
        wrapRef.current &&
        !wrapRef.current.contains(e.target as Node)
      ) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  /**
   * Liveness sweep — without this the pill keeps showing `:49391` long
   * after the user closed the terminal that was serving it (we only
   * append URLs as they appear in stdout; dev servers never tell us
   * when they exit). Polls `lsof` per detected URL on a slow interval
   * and drops ones that no longer have a listener. Runs immediately on
   * mount and on every cwd change so a fresh project doesn't inherit
   * stale URLs.
   */
  useEffect(() => {
    let cancelled = false;
    const sweep = async () => {
      const list = useStore.getState().terminalLocalhostUrls;
      if (cancelled || list.length === 0) return;
      const checks = await Promise.all(
        list.map(async (url) => {
          try {
            const listeners =
              await window.cowork.system.portListeners({ url });
            return { url, alive: listeners.length > 0 };
          } catch {
            // If lsof failed, leave the URL alone — better to keep a
            // possibly-dead entry than to drop a healthy one mid-server-restart.
            return { url, alive: true };
          }
        }),
      );
      if (cancelled) return;
      const forget = useStore.getState().forgetLocalhostUrl;
      for (const { url, alive } of checks) {
        if (!alive) forget(url);
      }
    };
    // Tiny delay so we don't stampede lsof at startup with everything
    // else electron is doing.
    const initial = setTimeout(() => {
      void sweep();
    }, 1500);
    const id = setInterval(() => {
      void sweep();
    }, 12000);
    return () => {
      cancelled = true;
      clearTimeout(initial);
      clearInterval(id);
    };
  }, []);

  const hasUrls = urls.length > 0;
  const displayed = urls[0];
  const tooltip = !hasUrls
    ? 'No localhost servers detected — click to open the preview window and paste a URL (⌘P)'
    : urls.length > 1
      ? `${urls.length} localhost URLs detected — click to choose (⌘P)`
      : `${displayed} (⌘P)`;
  return (
    <div className="preview-pill-wrap" ref={wrapRef}>
      <button
        type="button"
        className={'wb-pill preview-pill' + (!hasUrls ? ' preview-pill-empty' : '')}
        onClick={handleActivate}
        title={tooltip}
      >
        <PreviewIcon />
        <span className="wb-pill-label">Preview</span>
        {hasUrls && (
          <span className="preview-pill-meta">
            {urls.length > 1 ? `${urls.length}` : shortPort(displayed)}
          </span>
        )}
      </button>
      {showMenu && urls.length > 1 && (
        <div className="dropdown preview-pill-menu">
          <div className="dropdown-row dropdown-header">
            <span>Running localhost servers</span>
          </div>
          <div className="dropdown-list">
            {urls.map((u) => {
              const selected = u === previewUrl;
              const isKilling = killing === u;
              return (
                <div
                  key={u}
                  className={
                    'preview-menu-row' + (selected ? ' selected' : '')
                  }
                >
                  <button
                    type="button"
                    className="preview-menu-item"
                    onClick={() => pick(u)}
                    title={`Open ${u} in the preview window`}
                    disabled={isKilling}
                  >
                    <span className="preview-menu-port">{shortPort(u)}</span>
                    <span className="preview-menu-url">{u}</span>
                  </button>
                  <button
                    type="button"
                    className="preview-menu-kill"
                    onClick={() => void killOne(u)}
                    disabled={isKilling}
                    title={`Kill the process listening on ${u}`}
                    aria-label="Kill"
                  >
                    {isKilling ? '…' : '✕'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <circle cx="7" cy="6.5" r="0.5" fill="currentColor" />
      <circle cx="9.5" cy="6.5" r="0.5" fill="currentColor" />
    </svg>
  );
}

function shortPort(url: string): string {
  try {
    const u = new URL(url);
    return u.port ? `:${u.port}` : u.hostname;
  } catch {
    return url;
  }
}

function walkLeaves(
  node: { kind: string; id?: string; children?: unknown[] },
  cb: (id: string) => void,
): void {
  if (node.kind === 'leaf' && node.id) cb(node.id);
  else if (node.kind === 'split' && Array.isArray(node.children)) {
    for (const c of node.children) {
      walkLeaves(c as { kind: string; id?: string; children?: unknown[] }, cb);
    }
  }
}
