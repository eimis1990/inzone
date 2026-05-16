/**
 * Inline browser preview surface (v1.21+).
 *
 * Replaces the centered `PreviewModal` overlay with a card that
 * lives in `.pane-preview-stack` next to the pane-host. Toolbar
 * across the top (back / forward / reload / URL input / mobile-
 * viewport toggle / zoom / devtools / open-in-default-browser /
 * close) and an Electron `<webview>` filling the rest.
 *
 * Sizing — the `<webview>` element has its own intrinsic-sizing
 * logic that doesn't cooperate with nested flex containers; the
 * page would render at its natural height and leave a white slab
 * below. We sidestep this by observing the body's box and writing
 * explicit pixel `width` + `height` onto the webview every time
 * its container resizes. Robust against window resize, sidebar
 * collapse, and the slide-cross swap animation.
 *
 * Features added in this revision:
 *   - Devtools toggle (`webview.openDevTools()`)
 *   - Mobile viewport simulation (frames the webview at 375px
 *     centred in the body)
 *   - Zoom controls + ⌘+/⌘−/⌘0 hotkeys
 *   - Reload-on-save (chokidar watcher in main; toggle in the
 *     toolbar)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { detectLocalhostUrls, useStore } from '../store';
import { CloseIcon } from './icons';

interface WebviewElement extends HTMLElement {
  src?: string;
  reload(): void;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  setZoomLevel(level: number): void;
  getZoomLevel(): number;
  openDevTools(): void;
  closeDevTools(): void;
  isDevToolsOpened(): boolean;
}

/**
 * Electron's <webview> ships with a stripped-down type in
 * @types/react. We render via React.createElement so the props
 * pass through without fighting React's built-in JSX type.
 */
function Webview(props: {
  src: string;
  partition?: string;
  allowpopups?: boolean;
  className?: string;
  style?: React.CSSProperties;
  refCallback: (el: WebviewElement | null) => void;
}) {
  const { src, partition, allowpopups, className, style, refCallback } = props;
  return React.createElement('webview', {
    src,
    partition,
    allowpopups: allowpopups ? '' : undefined,
    className,
    style,
    ref: refCallback,
  });
}

/** Zoom level → percent label. Electron's `setZoomLevel` takes a
 *  number where 0 = 100%, each step ≈ 1.2x scale. We use these
 *  discrete steps so ⌘+/⌘- have a predictable cadence. */
const ZOOM_STEPS = [-3, -2, -1, 0, 1, 2, 3] as const;
type ZoomLevel = (typeof ZOOM_STEPS)[number];
function zoomLabel(level: ZoomLevel): string {
  // Approx Math.round(Math.pow(1.2, level) * 100) but with rounded
  // nice numbers so the toolbar reads cleanly.
  switch (level) {
    case -3:
      return '58%';
    case -2:
      return '69%';
    case -1:
      return '83%';
    case 0:
      return '100%';
    case 1:
      return '120%';
    case 2:
      return '144%';
    case 3:
      return '173%';
  }
}

export function PreviewPane(): JSX.Element {
  const previewUrl = useStore((s) => s.previewUrl);
  const setPreviewUrl = useStore((s) => s.setPreviewUrl);
  const setPaneViewMode = useStore((s) => s.setPaneViewMode);
  const paneViewMode = useStore((s) => s.paneViewMode);
  const cwd = useStore((s) => s.cwd);
  const tree = useStore((s) => s.tree);
  const leadPaneId = useStore((s) => s.leadPaneId);
  const panes = useStore((s) => s.panes);
  const terminalLocalhostUrls = useStore((s) => s.terminalLocalhostUrls);
  const hiddenLocalhostUrls = useStore((s) => s.hiddenLocalhostUrls);

  const activePaneIds = useMemo(() => {
    const ids = new Set<string>();
    walkLeaves(tree, (id) => ids.add(id));
    if (leadPaneId) ids.add(leadPaneId);
    return ids;
  }, [tree, leadPaneId]);

  const detectedUrls = useMemo(() => {
    const hidden = new Set(
      hiddenLocalhostUrls.map((u) => u.replace(/\/$/, '')),
    );
    const seen = new Set<string>();
    const push = (u: string, into: string[]) => {
      const norm = u.replace(/\/$/, '');
      if (hidden.has(norm)) return;
      if (seen.has(norm)) return;
      seen.add(norm);
      into.push(u);
    };
    const out: string[] = [];
    for (const u of terminalLocalhostUrls) push(u, out);
    for (const u of detectLocalhostUrls(activePaneIds, panes)) push(u, out);
    return out;
  }, [terminalLocalhostUrls, activePaneIds, panes, hiddenLocalhostUrls]);

  const effectiveUrl = previewUrl ?? detectedUrls[0] ?? '';
  const [draft, setDraft] = useState(effectiveUrl);
  const [showDropdown, setShowDropdown] = useState(false);
  useEffect(() => {
    setDraft(effectiveUrl);
  }, [effectiveUrl]);

  const webviewRef = useRef<WebviewElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  /** Mobile viewport simulator. When true, the webview is rendered
   *  at 375px width centred in the body — the rest of the body shows
   *  the dark frame so the user can see what their site looks like
   *  on iPhone-sized viewports. Pure CSS framing; the webview's
   *  reported viewport to the page is exactly 375×bodyHeight. */
  const [mobileViewport, setMobileViewport] = useState(false);

  /** Zoom level — feeds `webview.setZoomLevel()`. Re-applied every
   *  time the webview remounts (URL change, partition change) since
   *  Electron resets it on navigation. */
  const [zoom, setZoom] = useState<ZoomLevel>(0);

  /** Devtools state — track whether they're currently open so the
   *  toolbar button can read as a toggle, and so we can react if the
   *  user closes them via the devtools window's own close button. */
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);

  /** Reload-on-save toggle — when on, the main process watches the
   *  project cwd for source-file changes and pings us to reload.
   *  Off by default; the dev server's own HMR is usually faster
   *  for projects that have one. */
  const [autoReload, setAutoReload] = useState(false);

  // ─── Sizing is now handled entirely by CSS — flex column from
  // .preview-host → .preview-pane → .preview-body, with the webview
  // as `flex: 1; display: flex` filling the body. Earlier attempts
  // used a ResizeObserver writing inline pixel `width`/`height`,
  // but those conflicted with `position: absolute; inset: 0` and
  // left the webview stuck at its intrinsic short size. With the
  // recommended Electron flex pattern, the webview reflows
  // naturally on every body resize without any JS measurement.
  //
  // The mobile-viewport toggle is also pure CSS — overrides the
  // webview's flex-basis to a fixed 375px so it centres in the
  // body with the dark frame visible on either side.

  // ─── Devtools open/close
  // Wrapped in try/catch because webview's introspection methods
  // (`isDevToolsOpened`) only resolve after `dom-ready` fires.
  // Early clicks (before the page loads) would throw "Cannot read
  // properties of undefined" and crash the React tree.
  const toggleDevtools = useCallback(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    try {
      if (webview.isDevToolsOpened()) {
        webview.closeDevTools();
        setDevtoolsOpen(false);
      } else {
        webview.openDevTools();
        setDevtoolsOpen(true);
      }
    } catch {
      /* dom not ready — silently ignore */
    }
  }, []);

  // ─── Zoom — applied imperatively to the webview AND re-applied
  // after each navigation (so reload doesn't reset). `setZoomLevel`
  // isn't available before `dom-ready`; we listen for that event
  // before applying so the first zoom set always lands.
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    const apply = () => {
      try {
        webview.setZoomLevel(zoom);
      } catch {
        /* webview not yet attached — listener below catches it */
      }
    };
    // Try immediately in case dom-ready already fired
    apply();
    // And subscribe so the FIRST zoom application after page load
    // also fires.
    const onReady = () => apply();
    webview.addEventListener('dom-ready', onReady);
    return () => webview.removeEventListener('dom-ready', onReady);
  }, [zoom, effectiveUrl]);

  const zoomIn = useCallback(() => {
    setZoom((z) => {
      const i = ZOOM_STEPS.indexOf(z);
      const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, i + 1)];
      return next ?? z;
    });
  }, []);
  const zoomOut = useCallback(() => {
    setZoom((z) => {
      const i = ZOOM_STEPS.indexOf(z);
      const next = ZOOM_STEPS[Math.max(0, i - 1)];
      return next ?? z;
    });
  }, []);
  const zoomReset = useCallback(() => setZoom(0), []);

  // ─── Reload-on-save — main-process chokidar watcher fires
  // `preview:fileChanged` whenever any source file under cwd
  // changes. We debounce + reload.
  useEffect(() => {
    if (!autoReload || !cwd) return;
    let cancelled = false;
    void window.cowork.preview
      .watchStart({ cwd })
      .catch(() => {
        if (!cancelled) setAutoReload(false);
      });
    const off = window.cowork.preview.onFileChanged(() => {
      const webview = webviewRef.current;
      if (!webview) return;
      webview.reload();
    });
    return () => {
      cancelled = true;
      off();
      void window.cowork.preview.watchStop().catch(() => undefined);
    };
  }, [autoReload, cwd]);

  // ─── Esc swaps back to panes; ⌘R reloads; ⌘+/⌘−/⌘0 zoom.
  useEffect(() => {
    if (paneViewMode !== 'preview') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPaneViewMode('panes');
        return;
      }
      // Skip the ⌘-shortcuts when focus is in a text input so the
      // user can keep typing without us hijacking ⌘+ etc.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const inText =
        tag === 'input' ||
        tag === 'textarea' ||
        target?.isContentEditable;
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'r' && !inText) {
        e.preventDefault();
        webviewRef.current?.reload();
      } else if (k === '=' || k === '+') {
        // `=` is the unshifted key for `+` on US keyboards.
        e.preventDefault();
        zoomIn();
      } else if (k === '-') {
        e.preventDefault();
        zoomOut();
      } else if (k === '0') {
        e.preventDefault();
        zoomReset();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paneViewMode, setPaneViewMode, zoomIn, zoomOut, zoomReset]);

  const commitUrl = (next: string) => {
    const trimmed = next.trim();
    setPreviewUrl(trimmed.length > 0 ? trimmed : null);
    setDraft(trimmed);
    setShowDropdown(false);
  };

  return (
    <div className="preview-pane">
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
                    'preview-url-option' +
                    (u === effectiveUrl ? ' active' : '')
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

        {/* Zoom group — minus, percent readout, plus, reset. The
            readout doubles as the reset target (click 100% to
            snap back). */}
        <div className="preview-zoom-group">
          <button
            type="button"
            className="preview-tool-btn"
            onClick={zoomOut}
            disabled={zoom === ZOOM_STEPS[0]}
            title="Zoom out (⌘−)"
          >
            −
          </button>
          <button
            type="button"
            className="preview-zoom-label"
            onClick={zoomReset}
            title="Reset zoom to 100% (⌘0)"
          >
            {zoomLabel(zoom)}
          </button>
          <button
            type="button"
            className="preview-tool-btn"
            onClick={zoomIn}
            disabled={zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]}
            title="Zoom in (⌘+)"
          >
            +
          </button>
        </div>

        <button
          type="button"
          className={
            'preview-tool-btn' + (mobileViewport ? ' active' : '')
          }
          onClick={() => setMobileViewport((v) => !v)}
          title={
            mobileViewport
              ? 'Switch to desktop viewport'
              : 'Switch to mobile viewport (375px)'
          }
          aria-pressed={mobileViewport}
        >
          ▭
        </button>
        <button
          type="button"
          className={
            'preview-tool-btn' + (autoReload ? ' active' : '')
          }
          onClick={() => setAutoReload((v) => !v)}
          disabled={!cwd}
          title={
            autoReload
              ? 'Reload on file save: ON — disable to stop watching'
              : 'Reload on file save: OFF — enable to reload the preview every time you save a source file'
          }
          aria-pressed={autoReload}
        >
          ⟳
        </button>
        <button
          type="button"
          className={
            'preview-tool-btn' + (devtoolsOpen ? ' active' : '')
          }
          onClick={toggleDevtools}
          title={devtoolsOpen ? 'Close devtools' : 'Open devtools'}
          aria-pressed={devtoolsOpen}
        >
          {'</>'}
        </button>
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
          onClick={() => setPaneViewMode('panes')}
          title="Back to panes (Esc)"
          aria-label="Back to panes"
        >
          <CloseIcon size={14} />
        </button>
      </div>

      <div
        ref={bodyRef}
        className={
          'preview-body' +
          (mobileViewport ? ' preview-body-mobile' : '')
        }
      >
        {effectiveUrl ? (
          <Webview
            // The src as a key forces a full unmount when the URL
            // changes — webviews don't always re-navigate when you
            // change the `src` attribute live (Electron quirk).
            key={effectiveUrl}
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
  );
}

function openExternal(url: string): void {
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
