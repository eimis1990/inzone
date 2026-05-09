import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
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

interface WikiPageModalProps {
  /** Wiki-relative path of the page to render (e.g. "architecture.md"
   *  or "decisions/api-versioning.md"). */
  relPath: string;
  /** Close the modal entirely (back to the sidebar). */
  onClose: () => void;
  /** Navigate to a different wiki page — fired when the user clicks
   *  a [[wikilink]] inside the rendered markdown. The parent
   *  WikiSection swaps `viewingPath` so the modal re-fetches. */
  onNavigate: (relPath: string) => void;
  /** Called after a successful save so the parent (WikiSection) can
   *  refresh status — pageCount / lastUpdatedAt / recentEntries all
   *  shift after an edit, and the dashboard strip wants the new
   *  numbers. Optional; the modal works fine without it. */
  onSaved?: () => void;
}

/**
 * Full-screen markdown viewer for one wiki page. Backdrop matches
 * the Settings / PR drawer pattern. Esc closes. Inside the rendered
 * page:
 *
 *   - [[wikilink]]  → resolved to a clickable internal nav link.
 *     Two flavors:
 *       [[architecture]]              → architecture.md
 *       [[decisions/api-versioning]]  → decisions/api-versioning.md
 *   - http(s) links → open in the user's default browser.
 *   - GFM tables, code highlighting, lists — same renderer the
 *     chat transcript uses, so styling stays consistent.
 *
 * Phase 2 is read-only. Editing is done via the filesystem (Obsidian,
 * VS Code, the agents themselves). A small "Open in Finder" footer
 * action gives the user a one-click escape hatch when they want to
 * edit a page directly.
 */
export function WikiPageModal({
  relPath,
  onClose,
  onNavigate,
  onSaved,
}: WikiPageModalProps) {
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
  // (after a confirm in the back/close handlers; here it just clears
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
   *
   * After a successful save we update the local content baseline and
   * exit edit mode (so the now-saved draft becomes the new "view"
   * version), and call onSaved so the parent can refresh the
   * dashboard strip with the new mtime / edit count.
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
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [cwd, relPath, draft, dirty, saving, onSaved]);

  /** Discard mid-edit changes after confirming, or just exit edit
   *  mode when the draft is clean. Used by the Cancel button and the
   *  Esc handler so they share one path. */
  const handleCancelEdit = useCallback(() => {
    if (dirty) {
      const ok = confirm('Discard unsaved changes?');
      if (!ok) return;
    }
    setEditing(false);
    setDraft('');
    setSaveError(null);
  }, [dirty]);

  /** Close-the-whole-modal path. Same dirty-check as cancel, but on
   *  confirm we hand off to onClose so the parent unmounts the modal
   *  entirely (rather than just leaving edit mode). */
  const handleClose = useCallback(() => {
    if (dirty) {
      const ok = confirm('Discard unsaved changes and close?');
      if (!ok) return;
    }
    onClose();
  }, [dirty, onClose]);

  // Esc closes (with dirty-check). Cmd/Ctrl+S saves while editing.
  // Both shortcuts swallow the default so the host browser doesn't
  // intercept them.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editing) {
          e.preventDefault();
          handleCancelEdit();
          return;
        }
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
  // modal rather than opening an external URL.
  const processedContent = useMemo(
    () => transformWikilinks(content),
    [content],
  );

  // Portal to <body> so the overlay escapes the sidebar's stacking
  // context. The modal is mounted from inside WikiSection (which sits
  // under .sidebar-inner with `z-index: 1` — that creates a stacking
  // context, and our z-index: 90 on .wiki-overlay was being clamped
  // inside it, leaving the terminal-dock (z-index 25, but in a
  // sibling stacking context that paints later) visible at the
  // bottom of the screen). Rendering to document.body sidesteps the
  // whole comparison: the overlay becomes a top-level layer and
  // covers everything beneath it, terminal bar included.
  return createPortal(
    <div className="wiki-overlay" role="dialog" aria-modal aria-label="Wiki page">
      <div className="wiki-overlay-backdrop" onClick={handleClose} aria-hidden />
      <div className="wiki-overlay-card">
        <div className="wiki-page-header">
          <button type="button" className="wiki-back-btn" onClick={handleClose}>
            ← Back
          </button>
          <span className="wiki-page-path" title={relPath}>
            {relPath}
            {dirty && (
              <span className="wiki-page-dirty" aria-label="Unsaved changes">
                {' '}•
              </span>
            )}
          </span>
          {/* Edit-mode actions — pushed to the right of the path via
              the .wiki-page-spacer flex grow. We hide all of them
              while the file is loading so the header isn't actionable
              before we know what's there to edit. */}
          {!loading && !error && (
            <div className="wiki-page-actions">
              {editing ? (
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
              )}
            </div>
          )}
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
                /* Editor needs a real height inside the flex column —
                   without an explicit min-height the CM container
                   collapses to its natural line height. We let it
                   stretch to fill the modal body via height: 100%
                   on the wrapper class below. */
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
                    // Internal wikilink — navigate inside the modal.
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
    </div>,
    document.body,
  );
}

// ── Wikilink resolution ────────────────────────────────────────────

/**
 * Convert `[[target]]` and `[[target|label]]` syntax into standard
 * markdown links with a `wiki://` scheme so we can recognise them
 * in the link-component override and intercept the click.
 *
 * Two source forms supported:
 *   [[architecture]]
 *   [[architecture|the architecture page]]
 *
 * Both render as `[label](wiki://target)`. We resolve `target` to a
 * real path (with .md extension) when the click fires.
 */
function transformWikilinks(content: string): string {
  return content.replace(
    /\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g,
    (_, target: string, label?: string) => {
      const display = label ?? target;
      // Encode the target so spaces / unicode don't break the URI.
      const encoded = encodeURIComponent(target.trim());
      return `[${display}](wiki://${encoded})`;
    },
  );
}

/**
 * Resolve a wikilink target to a wiki-relative path with .md
 * extension. Wikilinks in this codebase are always rooted at the
 * wiki root (matching Karpathy's conventions in the schema), so we
 * ignore the current page's location — `[[architecture]]` always
 * means `architecture.md` at the root, not relative to the current
 * page's folder.
 */
function resolveWikilink(target: string, _currentRelPath: string): string {
  const decoded = decodeURIComponent(target).trim();
  // Strip leading slash if present, drop any trailing .md.
  const noSlash = decoded.replace(/^\/+/, '');
  const noExt = noSlash.replace(/\.md$/i, '');
  return `${noExt}.md`;
}
