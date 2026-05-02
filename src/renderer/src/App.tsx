import { useEffect } from 'react';
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels';
import { ConversationProvider } from '@elevenlabs/react';
import { useStore } from './store';
import { AgentSidebar } from './components/AgentSidebar';
import { WorkspaceBar } from './components/WorkspaceBar';
import { PaneTree } from './components/PaneTree';
import { Pane } from './components/Pane';
import { EditorModal } from './components/EditorModal';
import { AppLogo } from './components/AppLogo';
import { PreviewModal } from './components/PreviewModal';
import { TerminalPanel } from './components/TerminalPanel';
import { PipelineBoardSafe } from './components/PipelineBoardSafe';
import { ReviewViewSafe } from './components/ReviewViewSafe';
import { MissionControlSafe } from './components/MissionControlSafe';
import { WelcomeModal } from './components/WelcomeModal';
import { VoiceSetupWizard } from './components/VoiceSetupWizard';

export function App() {
  const init = useStore((s) => s.init);
  const cwd = useStore((s) => s.cwd);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = useStore((s) => s.toggleSidebarCollapsed);
  const windowMode = useStore((s) => s.windowMode);
  const leadPaneId = useStore((s) => s.leadPaneId);
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

  return (
    <ConversationProvider>
      <div className="app">
        <div className="title-bar" />
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
          <div className="pane-host">
            {!cwd ? (
              <EmptyState />
            ) : showReview ? (
              <ReviewViewSafe />
            ) : showPipelineBoard ? (
              <PipelineBoardSafe />
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
                <Panel defaultSize={62} id="subagents-panel" order={1}>
                  <PaneTree />
                </Panel>
              </PanelGroup>
            ) : (
              <PaneTree />
            )}
            {cwd && <TerminalPanel />}
          </div>
        </div>
        <EditorModal />
        <PreviewModal />
        <MissionControlSafe />
        <WelcomeModal />
        <VoiceSetupWizard />
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
