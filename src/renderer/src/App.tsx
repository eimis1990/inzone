import { useEffect, useState } from 'react';
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels';
import { ConversationProvider } from '@elevenlabs/react';
import { detectLocalhostUrls, useStore } from './store';
import { AgentSidebar } from './components/AgentSidebar';
import { WorkspaceBar } from './components/WorkspaceBar';
import { PaneTree } from './components/PaneTree';
import { PaneTabs } from './components/PaneTabs';
import { Pane } from './components/Pane';
import { ConfirmDialog } from './components/ConfirmDialog';
import { EditorModal } from './components/EditorModal';
import { AppLogo } from './components/AppLogo';
import { PreviewPane } from './components/PreviewPane';
import { TerminalPanel } from './components/TerminalPanel';
import { PipelineBoardSafe } from './components/PipelineBoardSafe';
import { ReviewViewSafe } from './components/ReviewViewSafe';
import { MissionControlSafe } from './components/MissionControlSafe';
import { PrModal } from './components/PrModal';
import { WelcomeModal } from './components/WelcomeModal';
import { VoiceSetupWizard } from './components/VoiceSetupWizard';
import { PerfOverlay } from './perf/PerfOverlay';

export function App() {
  const init = useStore((s) => s.init);
  const cwd = useStore((s) => s.cwd);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = useStore((s) => s.toggleSidebarCollapsed);
  const windowMode = useStore((s) => s.windowMode);
  const leadPaneId = useStore((s) => s.leadPaneId);
  const focusedPaneId = useStore((s) => s.focusedPaneId);
  const paneViewMode = useStore((s) => s.paneViewMode);
  const setPaneViewMode = useStore((s) => s.setPaneViewMode);
  // The preview card mounts only when at least one localhost URL is
  // available — either a user-set previewUrl, a terminal-detected
  // URL, or an agent-transcript-mined URL that hasn't been hidden.
  // Without this gate the right-side peek would always show with an
  // empty webview, which reads as broken. The cheap derived check
  // avoids triggering re-renders for every transcript update —
  // `hasPreviewableUrl` is just a boolean.
  const hasPreviewableUrl = useStore((s) => {
    if (s.previewUrl) return true;
    const hidden = new Set(s.hiddenLocalhostUrls.map((u) => u.replace(/\/$/, '')));
    if (s.terminalLocalhostUrls.some((u) => !hidden.has(u.replace(/\/$/, '')))) {
      return true;
    }
    // Skip the expensive transcript scan unless we genuinely need
    // to — `detectLocalhostUrls` walks every pane's items. We only
    // run it when nothing in the cheaper buckets matched.
    return false;
  });
  // If the previously-forward card lost its URL while the user was
  // looking at the preview, fall back to 'panes' so they don't get
  // stuck on a useless empty webview. Effect, not a derived value,
  // because we want the swap animation to play on the transition.
  useEffect(() => {
    if (!hasPreviewableUrl && paneViewMode === 'preview') {
      setPaneViewMode('panes');
    }
  }, [hasPreviewableUrl, paneViewMode, setPaneViewMode]);
  // PreviewPane is heavy — its <webview> tag spawns a full Chromium
  // renderer process plus whatever the loaded page brings (JS, timers,
  // websockets, HMR). We only mount it while the user is actually on
  // the preview side; flipping back to panes unmounts it and kills
  // the renderer process so a long-running dev server SPA doesn't
  // sit in the background eating RAM. Unmount is delayed by the
  // slide-out animation duration (320ms + a small buffer) so the
  // card animates away with its contents visible instead of going
  // empty mid-swipe. The preview-host wrapper stays mounted whenever
  // a URL is available, so the next swap-in has a stationary
  // translateX(100%) element to animate from.
  const [previewMounted, setPreviewMounted] = useState(false);
  useEffect(() => {
    if (paneViewMode === 'preview' && hasPreviewableUrl && cwd) {
      setPreviewMounted(true);
      return;
    }
    const t = window.setTimeout(() => setPreviewMounted(false), 340);
    return () => window.clearTimeout(t);
  }, [paneViewMode, hasPreviewableUrl, cwd]);
  // The user can flip the project's main area between the regular
  // pane-tree view and the pipeline board (Multi mode only — pipelines
  // don't compose with Lead, where the orchestrator already routes work).
  const pipelineView = useStore((s) => s.pipelineView);
  const showPipelineBoard = pipelineView === 'board' && windowMode === 'multi';
  // The Review view is gated by the chip itself (only worktree
  // projects show the chip) so we don't need a windowMode check here
  // — review is meaningful in both Multi and Lead.
  const showReview = pipelineView === 'review';

  useEffect(() => {
    void init();
  }, [init]);

  /**
   * Tab toggles the sidebar. Tab normally moves DOM focus, so we only
   * intercept it when focus is *outside* a text input — i.e. nobody's
   * mid-edit. That preserves the standard tab-traversal in forms while
   * giving the user a one-key shortcut to hide/show the sidebar from
   * anywhere in the pane area.
   */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        target?.isContentEditable ||
        // CodeMirror cells get classed editor; opt out so code editing
        // (system prompt body, raw JSON) keeps Tab as indent.
        target?.closest('.cm-editor')
      ) {
        return;
      }
      e.preventDefault();
      toggleSidebarCollapsed();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleSidebarCollapsed]);

  /**
   * Cmd+F (Ctrl+F on Win/Linux) toggles fullscreen view of the
   * currently active pane via the PaneTabs strip. Pressing it once
   * zooms into the active pane; pressing it again returns to the
   * "All" multi-pane view. We intercept regardless of focus
   * (text inputs included) since INZONE has no in-app find feature
   * for Cmd+F to clash with — the trade-off is the user can't use
   * the OS find shortcut to search inside an agent transcript.
   * If that becomes a real complaint we can gate this on focus
   * being outside text inputs the way Tab does.
   */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'f') return;
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.altKey || e.shiftKey) return;
      const state = useStore.getState();
      // Don't fire if there's nothing to fullscreen (no active pane,
      // or only one pane in the workspace — toggling between "All"
      // and a single pane is meaningless).
      const activeId = state.activePaneId;
      if (!activeId) return;
      e.preventDefault();
      const isAlreadyFullscreen = state.focusedPaneId === activeId;
      state.setFocusedPane(isAlreadyFullscreen ? null : activeId);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ⌘⇧M / Ctrl+⇧M opens Mission Control. Toggle: same shortcut closes
  // it. Doesn't fight with text-input focus because we require both
  // meta and shift modifiers, neither of which trigger inside inputs
  // for normal typing.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || !e.shiftKey) return;
      if (e.key.toLowerCase() !== 'm') return;
      e.preventDefault();
      const open = useStore.getState().missionControlOpen;
      useStore.getState().setMissionControlOpen(!open);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // PR inbox auto-poll for the active project. Fires once on app
  // boot (so the pill has data when the user clicks), then every
  // 5 minutes while the window is focused. Blur pauses; focus
  // resumes (and refreshes immediately if it's been a while).
  useEffect(() => {
    if (!cwd) return;
    let timer: number | null = null;
    let lastFetchAt = 0;
    const POLL_MS = 5 * 60 * 1000;

    const tick = () => {
      void useStore.getState().refreshPrs();
      lastFetchAt = Date.now();
    };
    const start = () => {
      if (timer != null) return;
      timer = window.setInterval(tick, POLL_MS);
    };
    const stop = () => {
      if (timer == null) return;
      window.clearInterval(timer);
      timer = null;
    };
    const onFocus = () => {
      // If we've been blurred for a while, refresh immediately on
      // focus return — staring at stale data is the failure mode.
      if (Date.now() - lastFetchAt > POLL_MS) tick();
      start();
    };

    // Initial fetch on mount + on cwd change.
    tick();
    if (document.hasFocus()) start();
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', stop);
    return () => {
      stop();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', stop);
    };
  }, [cwd]);

  return (
    <ConversationProvider>
      <div className="app">
        <div className="title-bar" />
        {/* Dev-only — gated internally by import.meta.env.DEV so prod
            tree-shakes it. Toggle with ⌘⇧P. */}
        <PerfOverlay />
        <WorkspaceBar />
        <div className={'body' + (sidebarCollapsed ? ' sidebar-hidden' : '')}>
          <div
            className={'sidebar-host' + (sidebarCollapsed ? ' collapsed' : '')}
            aria-hidden={sidebarCollapsed}
          >
            <div className="sidebar-inner">
              <AgentSidebar />
            </div>
          </div>
          {/* Two cards share this stack — pane-host and the inline
              browser preview. One is forward at any time, the other
              slides fully off-screen. The Preview button in the
              workspace bar is the only swap trigger; clicking it
              flips `paneViewMode` and CSS does the slide-cross
              animation.
              The preview card only mounts when there's a URL to
              show — without that, the stack is just the pane-host
              filling the whole width (no preview card, no swap).
              The terminal dock sits below in the pane-host so its
              position doesn't move when the cards swap. */}
          <div
            className={
              'pane-preview-stack pane-preview-stack-mode-' +
              paneViewMode +
              (hasPreviewableUrl && cwd ? ' has-preview' : '')
            }
          >
            <div className="pane-host">
              {!cwd ? (
                <EmptyState />
              ) : showReview ? (
                <ReviewViewSafe />
              ) : showPipelineBoard ? (
                <PipelineBoardSafe />
              ) : (
                // The pane area is wrapped in a single flex-column
                // container so the PaneTabs strip on top and the
                // actual pane content below stack cleanly inside
                // the grid's 1fr row. Without this wrapper,
                // fragments would create multiple grid items and
                // the layout breaks (tabs would steal the 1fr
                // instead of the content). The Lead pane /
                // fullscreen / multi branches each render their
                // own content piece.
                <div className="pane-stack">
                  <PaneTabs />
                  {focusedPaneId ? (
                    // Fullscreen view: a single pane fills the
                    // rest of the column. Non-focused panes stay
                    // alive in the store (their sessions keep
                    // running), they're just not currently
                    // rendered.
                    <div className="pane-fullscreen-host">
                      <Pane id={focusedPaneId} />
                    </div>
                  ) : windowMode === 'lead' && leadPaneId ? (
                    <PanelGroup direction="vertical">
                      <Panel
                        defaultSize={38}
                        minSize={20}
                        id="lead-panel"
                        order={0}
                        className="lead-panel"
                      >
                        <div className="lead-slot">
                          <Pane id={leadPaneId} />
                        </div>
                      </Panel>
                      <PanelResizeHandle className="resize-handle" />
                      <Panel
                        defaultSize={62}
                        id="subagents-panel"
                        order={1}
                      >
                        <PaneTree />
                      </Panel>
                    </PanelGroup>
                  ) : (
                    <PaneTree />
                  )}
                </div>
              )}
              {cwd && <TerminalPanel />}
            </div>
            {hasPreviewableUrl && cwd && (
              <div className="preview-host" aria-hidden={paneViewMode !== 'preview'}>
                {previewMounted && <PreviewPane />}
              </div>
            )}
          </div>
        </div>
        <EditorModal />
        <MissionControlSafe />
        <PrModal />
        <WelcomeModal />
        <VoiceSetupWizard />
        {/* Single React-based confirm modal for the whole app —
            replaces native window.confirm() to avoid the Windows
            renderer focus bug. Mounted once, renders itself only
            when a request is in flight. */}
        <ConfirmDialog />
      </div>
    </ConversationProvider>
  );
}

function EmptyState() {
  const pickFolder = useStore((s) => s.pickFolder);
  return (
    <div className="empty-state">
      <div className="empty-card">
        <div className="empty-logo" aria-hidden>
          <AppLogo size={84} />
        </div>
        <h1 className="empty-wordmark">INZONE</h1>
        <p>Pick a project folder to start a session.</p>
        <button className="primary" onClick={() => void pickFolder()}>
          Choose folder…
        </button>
      </div>
    </div>
  );
}
