import { useEffect, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import { vim } from '@replit/codemirror-vim';
import type { MemoryScope } from '@shared/types';
import { useEditorPreferences } from '../../hooks/useEditorPreferences';
import { useStore } from '../../store';

const SCOPE_OPTIONS: Array<{ value: MemoryScope; label: string; sub: string }> = [
  {
    value: 'project',
    label: 'Project only',
    sub: './CLAUDE.md inside the workspace folder.',
  },
  {
    value: 'global',
    label: 'Global only',
    sub: '~/.claude/CLAUDE.md, shared across every project.',
  },
  {
    value: 'both',
    label: 'Both (project then global)',
    sub: 'Concatenate both files into the agent context.',
  },
  {
    value: 'none',
    label: 'None',
    sub: 'Skip CLAUDE.md entirely for this workspace.',
  },
];

interface FileState {
  filePath: string;
  content: string;
  loaded: boolean;
}

export function MemorySection() {
  const cwd = useStore((s) => s.cwd);
  const memoryScope = useStore((s) => s.memoryScope);
  const setMemoryScope = useStore((s) => s.setMemoryScope);
  const windowMode = useStore((s) => s.windowMode);
  const { vimMode } = useEditorPreferences();

  const [project, setProject] = useState<FileState>({
    filePath: '',
    content: '',
    loaded: false,
  });
  const [global, setGlobal] = useState<FileState>({
    filePath: '',
    content: '',
    loaded: false,
  });
  const [savingProject, setSavingProject] = useState(false);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [status, setStatus] = useState<string | undefined>();

  useEffect(() => {
    if (!cwd) {
      setProject({ filePath: '', content: '', loaded: true });
      return;
    }
    void window.cowork.memory.read({ scope: 'project', cwd }).then((r) =>
      setProject({ ...r, loaded: true }),
    );
  }, [cwd]);
  useEffect(() => {
    void window.cowork.memory
      .read({ scope: 'global' })
      .then((r) => setGlobal({ ...r, loaded: true }));
  }, []);

  const saveProject = async () => {
    if (!cwd) return;
    setSavingProject(true);
    setStatus(undefined);
    try {
      await window.cowork.memory.write({
        scope: 'project',
        cwd,
        content: project.content,
      });
      setStatus('Project memory saved.');
      setTimeout(() => setStatus(undefined), 1500);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingProject(false);
    }
  };

  const saveGlobal = async () => {
    setSavingGlobal(true);
    setStatus(undefined);
    try {
      await window.cowork.memory.write({
        scope: 'global',
        content: global.content,
      });
      setStatus('Global memory saved.');
      setTimeout(() => setStatus(undefined), 1500);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingGlobal(false);
    }
  };

  return (
    <div className="settings-pane">
      <div className="settings-pane-header">
        <h2>CLAUDE.md</h2>
        <p className="settings-pane-sub">
          Project memory injected into every agent's system prompt before a
          turn starts. Use it for project conventions, do/don'ts, and
          anything you'd otherwise paste into the chat.
          {windowMode === 'lead' && (
            <>
              {' '}
              <strong>In Lead Agent mode only the Lead receives the memory</strong>
              ; sub-agents stay focused on the specific task the Lead delegates.
            </>
          )}
        </p>
      </div>

      <div className="settings-pane-body">
        <section className="settings-section">
          <h3>Scope for this workspace</h3>
          <div className="memory-scope-grid">
            {SCOPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={
                  'memory-scope-card' +
                  (memoryScope === opt.value ? ' active' : '')
                }
                onClick={() => setMemoryScope(opt.value)}
              >
                <span className="memory-scope-label">{opt.label}</span>
                <span className="memory-scope-sub">{opt.sub}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <div className="memory-editor-head">
            <h3>Project file</h3>
            <code className="memory-path">
              {project.filePath || (cwd ? `${cwd}/CLAUDE.md` : '(no folder)')}
            </code>
          </div>
          {!cwd ? (
            <div className="settings-empty">
              Pick a project folder first so the file path resolves.
            </div>
          ) : (
            <>
              <div className="memory-editor-wrap">
                <CodeMirror
                  value={project.content}
                  onChange={(v) => setProject((p) => ({ ...p, content: v }))}
                  theme={oneDark}
                  extensions={[
                    ...(vimMode ? [vim()] : []),
                    markdown({
                      base: markdownLanguage,
                      codeLanguages: languages,
                    }),
                  ]}
                  basicSetup={{
                    lineNumbers: true,
                    highlightActiveLine: true,
                    foldGutter: true,
                  }}
                  minHeight="220px"
                  maxHeight="44vh"
                />
              </div>
              <div className="memory-editor-actions">
                <button
                  className="primary small"
                  onClick={() => void saveProject()}
                  disabled={savingProject || !project.loaded}
                >
                  {savingProject ? 'Saving…' : 'Save project memory'}
                </button>
              </div>
            </>
          )}
        </section>

        <section className="settings-section">
          <div className="memory-editor-head">
            <h3>Global file</h3>
            <code className="memory-path">{global.filePath || '~/.claude/CLAUDE.md'}</code>
          </div>
          <div className="memory-editor-wrap">
            <CodeMirror
              value={global.content}
              onChange={(v) => setGlobal((g) => ({ ...g, content: v }))}
              theme={oneDark}
              extensions={[
                ...(vimMode ? [vim()] : []),
                markdown({
                  base: markdownLanguage,
                  codeLanguages: languages,
                }),
              ]}
              basicSetup={{
                lineNumbers: true,
                highlightActiveLine: true,
                foldGutter: true,
              }}
              minHeight="180px"
              maxHeight="36vh"
            />
          </div>
          <div className="memory-editor-actions">
            <button
              className="primary small"
              onClick={() => void saveGlobal()}
              disabled={savingGlobal || !global.loaded}
            >
              {savingGlobal ? 'Saving…' : 'Save global memory'}
            </button>
          </div>
        </section>

        {status && <div className="settings-status">{status}</div>}
      </div>
    </div>
  );
}
