/**
 * Preview modal — centered card at 16:10 with an Electron <webview>
 * filling the body. Shows when store.previewOpen is true.
 *
 * Toolbar: URL input (editable, with detected-URL dropdown), back,
 * forward, reload, open-in-default-browser, close. Esc / click-outside
 * to dismiss.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { detectLocalhostUrls, useStore } from '../store';
import { CloseIcon } from './icons';

interface WebviewElement extends HTMLElement {
  src?: string;
  reload(): void;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
}

/**
 * Electron's <webview> ships with a stripped-down type in @types/react
 * (WebViewHTMLAttributes — no `partition`, no `allowpopups`). Rather
 * than augment the global JSX namespace (which fights React's built-in)
 * we render via React.createElement so the props object is typed as
 * `any` and Electron's webview-specific attributes still hit the DOM.
 */
function Webview(props: {
  src: string;
  partition?: string;
  allowpopups?: boolean;
  className?: string;
  refCallback: (el: WebviewElement | null) => void;
}) {
  const { src, partition, allowpopups, className, refCallback } = props;
  return React.createElement('webview', {
    src,
    partition,
    allowpopups: allowpopups ? '' : undefined,
    className,
    ref: refCallback,
  });
}

export function PreviewModal() {
  const open = useStore((s) => s.previewOpen);
  const closePreview = useStore((s) => s.closePreview);
  const previewUrl = useStore((s) => s.previewUrl);
  const setPreviewUrl = useStore((s) => s.setPreviewUrl);
  const tree = useStore((s) => s.tree);
  const leadPaneId = useStore((s) => s.leadPaneId);
  const panes = useStore((s) => s.panes);
  const terminalLocalhostUrls = useStore((s) => s.terminalLocalhostUrls);

  const activePaneIds = useMemo(() => {
    const ids = new Set<string>();
    walkLeaves(tree, (id) => ids.add(id));
    if (leadPaneId) ids.add(leadPaneId);
    return ids;
  }, [tree, leadPaneId]);
  // Combined detection list: terminal URLs (most likely the user's
  // current dev server) come before agent-mined URLs (often older /
  // historical). Deduped while preserving priority.
  const detectedUrls = useMemo(() => {
    const out: string[] = [];
    for (const u of terminalLocalhostUrls) {
      if (!out.includes(u)) out.push(u);
    }
    for (const u of detectLocalhostUrls(activePaneIds, panes)) {
      if (!out.includes(u)) out.push(u);
    }
    return out;
  }, [terminalLocalhostUrls, activePaneIds, panes]);

  // Effective URL: persisted manual choice wins, otherwise the most
  // recent detection. Tracked in local state so the user can edit the
  // input without yet committing — only Enter / dropdown-select writes
  // it back through setPreviewUrl.
  const effectiveUrl = previewUrl ?? detectedUrls[0] ?? '';
  const [draft, setDraft] = useState(effectiveUrl);
  const [showDropdown, setShowDropdown] = useState(false);
  useEffect(() => {
    setDraft(effectiveUrl);
  }, [effectiveUrl, open]);

  const webviewRef = useRef<WebviewElement | null>(null);

  // Esc closes; ⌘R reloads while focus is in the modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePreview();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        webviewRef.current?.reload();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closePreview]);

  if (!open) return null;

  const commitUrl = (next: string) => {
    const trimmed = next.trim();
    setPreviewUrl(trimmed.length > 0 ? trimmed : null);
    setDraft(trimmed);
    setShowDropdown(false);
  };

  return (
    <div className="preview-backdrop" onMouseDown={() => closePreview()}>
      <div
        className="preview-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label="Preview"
      >
        <div className="preview-toolbar">
          <button
            type="button"
            className="preview-tool-btn"
            onClick={() => webviewRef.current?.goBack()}
            title="Back"
          >
            ‹
          </button>
          <button
            type="button"
            className="preview-tool-btn"
            onClick={() => webviewRef.current?.goForward()}
            title="Forward"
          >
            ›
          </button>
          <button
            type="button"
            className="preview-tool-btn"
            onClick={() => webviewRef.current?.reload()}
            title="Reload (⌘R)"
          >
            ↻
          </button>

          <div className="preview-url-wrap">
            <input
              className="preview-url-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitUrl(draft);
                }
              }}
              onFocus={() =>
                detectedUrls.length > 1 && setShowDropdown(true)
              }
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              placeholder="http://localhost:5173"
              spellCheck={false}
              autoComplete="off"
            />
            {showDropdown && detectedUrls.length > 0 && (
              <div className="preview-url-dropdown">
                {detectedUrls.map((u) => (
                  <button
                    type="button"
                    key={u}
                    className={
                      'preview-url-option' + (u === effectiveUrl ? ' active' : '')
                    }
                    onMouseDown={(e) => {
                      e.preventDefault();
                      commitUrl(u);
                    }}
                  >
                    {u}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            className="preview-tool-btn"
            onClick={() => effectiveUrl && void openExternal(effectiveUrl)}
            title="Open in default browser"
            disabled={!effectiveUrl}
          >
            ↗
          </button>
          <button
            type="button"
            className="preview-tool-btn"
            onClick={() => closePreview()}
            title="Close (Esc)"
            aria-label="Close"
          >
            <CloseIcon size={14} />
          </button>
        </div>

        <div className="preview-body">
          {effectiveUrl ? (
            <Webview
              src={effectiveUrl}
              partition="persist:inzone-preview"
              allowpopups
              className="preview-webview"
              refCallback={(el) => {
                webviewRef.current = el;
              }}
            />
          ) : (
            <div className="preview-empty">
              <div className="preview-empty-title">No URL yet</div>
              <div className="preview-empty-sub">
                Paste a localhost URL above, or run an agent that prints
                one (e.g. <code>pnpm dev</code>).
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function openExternal(url: string): void {
  // Electron exposes shell.openExternal via the preload — but we don't
  // have it wired yet. Fall back to window.open which Electron routes
  // through the BrowserWindow's setWindowOpenHandler back to shell.
  window.open(url, '_blank');
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
