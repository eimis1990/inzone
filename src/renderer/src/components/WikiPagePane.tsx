import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import { vim } from '@replit/codemirror-vim';
import { useEditorPreferences } from '../hooks/useEditorPreferences';
import { useStore } from '../store';

interface WikiPagePaneProps {
  /** Wiki-relative path of the page to render (e.g. "architecture.md"
   *  or "decisions/api-versioning.md"). */
  relPath: string;
  /** Close the pane (clears `wikiPagePath` in the store, returning
   *  the user to whatever was forward before — panes or preview). */
  onClose: () => void;
  /** Navigate to a different wiki page — fired when the user clicks
   *  a [[wikilink]] inside the rendered markdown. The parent flips
   *  the store's `wikiPagePath` so this component re-fetches. */
  onNavigate: (relPath: string) => void;
  /** Called after a successful save so the parent (WikiSection) can
   *  refresh status — pageCount / lastUpdatedAt / recentEntries all
   *  shift after an edit. Optional; the pane works fine without it. */
  onSaved?: () => void;
}

/**
 * In-pane markdown viewer + editor for one wiki page.
 *
 * This is the inline counterpart of the old `WikiPageModal` — same
 * read/edit behaviour, but rendered inside the pane area (sibling of
 * pane-host + preview-host) rather than as a portaled full-screen
 * overlay. The user picks pages from the Wiki tab in the sidebar; the
 * selection flips `store.wikiPagePath` which mounts this component
 * inside `.pane-preview-stack`.
 *
 * Header chrome: page path on the left, Edit / Save / Cancel + a
 * close (×) button on the right. No Back button — there's nothing
 * to go back to since the surrounding workspace stays visible.
 *
 *   - [[wikilink]]  → resolved to a clickable internal nav link.
 *     Two flavors:
 *       [[architecture]]              → architecture.md
 *       [[decisions/api-versioning]]  → decisions/api-versioning.md
 *   - http(s) links → open in the user's default browser.
 *   - GFM tables, code highlighting, lists — same renderer the
 *     chat transcript uses, so styling stays consistent.
 */
export function WikiPagePane({
  relPath,
  onClose,
  onNavigate,
  onSaved,
}: WikiPagePaneProps) {
  const cwd = useStore((s) => s.cwd);
  const { vimMode } = useEditorPreferences();
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Edit-mode state. `editing` toggles between the rendered preview
  // and the CodeMirror editor; `draft` holds the in-progress edit;
  // `saving` disables the Save button + Cmd-S handler during the
  // round trip; `saveError` surfaces write failures inline so the
  // user knows their change didn't persist.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dirty = editing && draft !== content;

  // Re-fetch whenever the displayed page changes. Also resets edit
  // state — navigating to another page mid-edit cancels the edit
  // (after a confirm in the close handler; here it just clears
  // because the user already committed to the navigation by clicking
  // the wikilink).
  useEffect(() => {
    if (!cwd) return;
    setLoading(true);
    setError(null);
    setContent('');
    setEditing(false);
    setDraft('');
    setSaveError(null);
    let alive = true;
    window.cowork.wiki
      .readPage(cwd, relPath)
      .then((text) => {
        if (alive) setContent(text);
      })
      .catch((err) => {
        if (alive)
          setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [cwd, relPath]);

  /**
   * Save the draft back to disk + append a `## [date] edit | <path>`
   * entry to log.md. Both writes go through the same wiki preload
   * bridge that agents and the renderer already use, so path-escape
   * safety + atomic-ish appends are inherited.
   */
  const handleSave = useCallback(async () => {
    if (!cwd || saving || !dirty) return;
    setSaving(true);
    setSaveError(null);
    try {
      await window.cowork.wiki.writePage(cwd, relPath, draft);
      const date = new Date().toISOString().slice(0, 10);
      await window.cowork.wiki.appendLog(
        cwd,
        `## [${date}] edit | ${relPath}\n\nManually edited via INZONE.\n\n`,
      );
      setContent(draft);
      setEditing(false);
      onSaved?.();
      // Cross-component nudge so the sidebar's WikiSection refreshes
      // its dashboard (last-updated / page count / recent entries)
      // without us threading a callback through the App.tsx mount.
      window.dispatchEvent(new CustomEvent('inzone:wiki-page-saved'));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [cwd, relPath, draft, dirty, saving, onSaved]);

  /** Discard mid-edit changes after confirming, or just exit edit
   *  mode when the draft is clean. */
  const handleCancelEdit = useCallback(() => {
    if (dirty) {
      const ok = confirm('Discard unsaved changes?');
      if (!ok) return;
    }
    setEditing(false);
    setDraft('');
    setSaveError(null);
  }, [dirty]);

  /** Close the whole pane (clears `wikiPagePath` in the store).
   *  Same dirty-check as cancel. */
  const handleClose = useCallback(() => {
    if (dirty) {
      const ok = confirm('Discard unsaved changes and close?');
      if (!ok) return;
    }
    onClose();
  }, [dirty, onClose]);

  // Esc closes the wiki pane when not editing (cancels the edit
  // when editing). Cmd/Ctrl+S saves while editing. Both shortcuts
  // swallow the default so the host browser doesn't intercept them.
  // We only fire when the wiki pane is what's forward (its parent
  // only renders this component when wikiPagePath is set), so we
  // don't need to gate on additional state here.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Don't fight CodeMirror's own Esc behaviour while a text
        // input is focused inside the editor.
        const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea') return;
        if (editing) {
          e.preventDefault();
          handleCancelEdit();
          return;
        }
        e.preventDefault();
        handleClose();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        if (!editing) return;
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editing, handleClose, handleCancelEdit, handleSave]);

  // Pre-process the markdown: convert [[wikilink]] to a markdown link
  // with a `wiki://` scheme. We then intercept those scheme'd links
  // in the `a` component below so clicking them navigates inside the
  // pane rather than opening an external URL.
  const processedContent = useMemo(
    () => transformWikilinks(content),
    [content],
  );

  return (
    <div className="wiki-pane-root" role="region" aria-label="Wiki page">
      <div className="wiki-page-header">
        <span className="wiki-page-path" title={relPath}>
          {relPath}
          {dirty && (
            <span className="wiki-page-dirty" aria-label="Unsaved changes">
              {' '}•
            </span>
          )}
        </span>
        {/* Edit-mode actions + close button — pushed to the right
            of the path. We hide the edit/save controls while the
            file is loading so the header isn't actionable before we
            know what's there to edit. Close button is always present
            so the user can bail out even on a failed load. */}
        <div className="wiki-page-actions">
          {!loading && !error && (editing ? (
            <>
              {saveError && (
                <span className="wiki-page-save-error" title={saveError}>
                  Save failed
                </span>
              )}
              <button
                type="button"
                className="wiki-page-action-btn"
                onClick={handleCancelEdit}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="wiki-page-action-btn primary"
                onClick={() => void handleSave()}
                disabled={!dirty || saving}
                title="Save (⌘S)"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="wiki-page-action-btn"
              onClick={() => {
                setDraft(content);
                setEditing(true);
                setSaveError(null);
              }}
              title="Edit this page in INZONE"
            >
              Edit
            </button>
          ))}
          <button
            type="button"
            className="wiki-pane-close-btn"
            onClick={handleClose}
            title="Close (Esc)"
            aria-label="Close wiki page"
          >
            ×
          </button>
        </div>
      </div>

      <div className="wiki-page-body md-body">
        {loading ? (
          <div className="wiki-loading">Loading…</div>
        ) : error ? (
          <div className="wiki-error">{error}</div>
        ) : editing ? (
          <div className="wiki-page-editor">
            <CodeMirror
              value={draft}
              onChange={(value) => setDraft(value)}
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
                bracketMatching: true,
              }}
              height="100%"
            />
          </div>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              a({ href, children, ...rest }) {
                if (typeof href === 'string' && href.startsWith('wiki://')) {
                  // Internal wikilink — navigate inside the pane.
                  const target = resolveWikilink(href.slice(7), relPath);
                  return (
                    <a
                      {...rest}
                      href="#"
                      className="wiki-link"
                      onClick={(e) => {
                        e.preventDefault();
                        onNavigate(target);
                      }}
                    >
                      {children}
                    </a>
                  );
                }
                return (
                  <a
                    {...rest}
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {children}
                  </a>
                );
              },
            }}
          >
            {processedContent}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}

// ── Wikilink resolution ────────────────────────────────────────────

/**
 * Convert `[[target]]` and `[[target|label]]` syntax into standard
 * markdown links with a `wiki://` scheme so we can recognise them
 * in the link-component override and intercept the click.
 */
function transformWikilinks(content: string): string {
  return content.replace(
    /\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g,
    (_, target: string, label?: string) => {
      const display = label ?? target;
      const encoded = encodeURIComponent(target.trim());
      return `[${display}](wiki://${encoded})`;
    },
  );
}

/**
 * Resolve a wikilink target to a wiki-relative path with .md
 * extension. Wikilinks are always rooted at the wiki root.
 */
function resolveWikilink(target: string, _currentRelPath: string): string {
  const decoded = decodeURIComponent(target).trim();
  const noSlash = decoded.replace(/^\/+/, '');
  const noExt = noSlash.replace(/\.md$/i, '');
  return `${noExt}.md`;
}
