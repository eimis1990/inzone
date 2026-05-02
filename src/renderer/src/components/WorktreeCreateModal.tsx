import { useEffect, useMemo, useState } from 'react';
import type { WindowState } from '@shared/types';
import { useStore } from '../store';

interface WorktreeCreateModalProps {
  open: boolean;
  parent: WindowState | null;
  onClose: () => void;
}

/**
 * Modal for creating a git worktree off an existing project. Lets the
 * user pick a branch name (existing or new), a base branch, and whether
 * to copy common env files. Submits to `createWorktreeProject` in the
 * store, which runs the git command in main and registers the worktree
 * as a new project under the same workspace.
 */
export function WorktreeCreateModal({
  open,
  parent,
  onClose,
}: WorktreeCreateModalProps) {
  const createWorktreeProject = useStore((s) => s.createWorktreeProject);

  // Common branch-name prefixes most teams use. The empty option lets
  // users type a fully-custom name when none of these fit. We default
  // to "feature/" because that's by far the most common case for
  // parallel-agent work.
  const BRANCH_PREFIXES = [
    { value: 'feature/', label: 'feature/' },
    { value: 'bugfix/', label: 'bugfix/' },
    { value: 'hotfix/', label: 'hotfix/' },
    { value: 'chore/', label: 'chore/' },
    { value: 'refactor/', label: 'refactor/' },
    { value: 'docs/', label: 'docs/' },
    { value: 'experiment/', label: 'experiment/' },
    { value: '', label: '(no prefix)' },
  ];

  const [prefix, setPrefix] = useState<string>('feature/');
  const [branchName, setBranchName] = useState('');
  const [baseBranch, setBaseBranch] = useState<string | 'current'>('current');
  const [copyEnv, setCopyEnv] = useState(true);
  const [branches, setBranches] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Git-init flow: when the parent isn't a git repo yet, the create
  // path can't work — git worktree add needs a HEAD to branch from.
  // We detect this on open and surface a one-click "Initialize git
  // and continue" banner that runs gitInit + reloads branches.
  const [needsGitInit, setNeedsGitInit] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [initResult, setInitResult] = useState<{
    branch: string;
    filesCommitted: number;
  } | null>(null);

  /** Pull branches from the parent. Sets `needsGitInit` if the parent
   *  has no .git folder; otherwise populates the branches list. */
  const refreshBranches = async (cwd: string): Promise<void> => {
    try {
      const wt = await window.cowork.system.worktreeStatus({ cwd });
      // worktreeStatus returns isWorktree=false AND no branch when
      // .git is absent entirely. branch is set when it's a regular
      // repo or a worktree.
      if (!wt.isWorktree && !wt.branch) {
        setNeedsGitInit(true);
        setBranches([]);
        return;
      }
      setNeedsGitInit(false);
      const list = await window.cowork.system.gitBranches({ cwd });
      setBranches(list);
    } catch {
      // worktreeStatus shouldn't throw, but defensive: treat as a
      // generic empty-branches state.
      setBranches([]);
    }
  };

  // Reset every time the modal opens with a fresh parent.
  useEffect(() => {
    if (open && parent) {
      setPrefix('feature/');
      setBranchName('');
      setBaseBranch('current');
      setCopyEnv(true);
      setError(null);
      setNeedsGitInit(false);
      setInitResult(null);
      void refreshBranches(parent.cwd);
    }
  }, [open, parent]);

  /** Handler for the "Initialize git and continue" button. */
  const handleGitInit = async () => {
    if (!parent) return;
    setInitializing(true);
    setError(null);
    try {
      const result = await window.cowork.system.gitInit({ cwd: parent.cwd });
      setInitResult({
        branch: result.branch,
        filesCommitted: result.filesCommitted,
      });
      // Re-probe so the form lights up with the new repo's branch.
      await refreshBranches(parent.cwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInitializing(false);
    }
  };

  // The actual branch name we'll send to git: prefix + leaf. Strip a
  // leading slash from the leaf if the user typed one — keeps double
  // slashes out of the result.
  const fullBranchName = useMemo(() => {
    const leaf = branchName.trim().replace(/^\/+/, '');
    return prefix + leaf;
  }, [prefix, branchName]);

  // Folder preview — show where the worktree will land before the user
  // commits. Mirrors `pickWorktreeFolder` in src/main/system.ts so the
  // displayed path matches what actually gets created.
  const previewFolder = useMemo(() => {
    if (!parent) return '';
    const slug = fullBranchName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    if (!slug) return '';
    const lastSlash = parent.cwd.lastIndexOf('/');
    const dir = parent.cwd.slice(0, lastSlash);
    const base = parent.cwd.slice(lastSlash + 1);
    return `${dir}/${base}-${slug}`;
  }, [parent, fullBranchName]);

  const valid =
    parent != null &&
    branchName.trim().length > 0 &&
    !submitting &&
    !needsGitInit;

  const submit = async () => {
    if (!valid || !parent) return;
    setSubmitting(true);
    setError(null);
    try {
      await createWorktreeProject({
        parentProjectId: parent.id,
        branchName: fullBranchName,
        baseBranch,
        copyEnv,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  // Esc closes (matching the rest of the modals in the app).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, submitting]);

  if (!open || !parent) return null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal worktree-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Branch off in worktree</h2>
          <p className="modal-sub">
            Spawn a parallel checkout of <strong>{parent.name ?? parent.cwd}</strong>{' '}
            on its own branch. Both stay linked to the same repo, but
            they get separate folders so two agents can work without
            stepping on each other.
          </p>
        </div>

        <div className="modal-body">
          {/* Non-git parent — surface this BEFORE any of the form
              controls because filling them out is moot until git is
              initialized. The button kicks off gitInit + repopulates
              the branch dropdown so the rest of the form lights up. */}
          {needsGitInit && (
            <div className="git-init-banner">
              <div className="git-init-banner-body">
                <strong>This folder isn't tracked by git yet.</strong>
                <span>
                  Worktrees branch off an existing repo, so we'll need
                  to initialize one here first.
                </span>
              </div>
              <button
                type="button"
                className="primary"
                onClick={() => void handleGitInit()}
                disabled={initializing}
              >
                {initializing ? 'Initializing...' : 'Initialize git & continue'}
              </button>
            </div>
          )}
          {initResult && (
            <div className="git-init-success">
              <strong>✓ Git initialized.</strong>{' '}
              <span>
                Created <code>{initResult.branch}</code>
                {initResult.filesCommitted > 0 ? (
                  <>
                    {' '}
                    with an initial commit of {initResult.filesCommitted}{' '}
                    file{initResult.filesCommitted === 1 ? '' : 's'}.
                  </>
                ) : (
                  <> (no files to commit yet — go ahead and branch off).</>
                )}
              </span>
            </div>
          )}

          <label className="kv-row stacked">
            <span>Branch name</span>
            <div className="branch-name-row">
              <select
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                aria-label="Branch type prefix"
              >
                {BRANCH_PREFIXES.map((p) => (
                  <option key={p.value || 'none'} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              <input
                autoFocus
                type="text"
                placeholder="yacht-detail-fix"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && valid) void submit();
                }}
              />
            </div>
            <span className="kv-hint">
              {branchName.trim().length > 0 ? (
                <>
                  Full branch: <code>{fullBranchName}</code>
                  {' · '}
                </>
              ) : null}
              Existing branches attach; new names create a fresh branch.
            </span>
          </label>

          <label className="kv-row stacked">
            <span>Base branch</span>
            <select
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
            >
              <option value="current">Current HEAD</option>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <span className="kv-hint">
              Where the new branch starts from. Ignored when "Branch
              name" matches an existing branch.
            </span>
          </label>

          <label className="kv-row stacked">
            <span>Folder</span>
            <code className="worktree-folder-preview">
              {previewFolder || '—'}
            </code>
            <span className="kv-hint">
              Created next to the parent project. Auto-suffixed with
              "-2", "-3" if the path already exists.
            </span>
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={copyEnv}
              onChange={(e) => setCopyEnv(e.target.checked)}
            />
            <div>
              <div>Copy env files</div>
              <span className="kv-hint">
                Copies <code>.env</code>, <code>.env.local</code>, and
                similar files from the parent so the worktree can boot
                immediately. Future edits stay independent.
              </span>
            </div>
          </label>

          {error && <div className="modal-error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void submit()}
            disabled={!valid}
          >
            {submitting ? 'Creating…' : 'Create worktree'}
          </button>
        </div>
      </div>
    </div>
  );
}
