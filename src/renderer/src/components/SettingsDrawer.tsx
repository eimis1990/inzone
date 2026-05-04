import { useEffect, useState } from 'react';
import { AgentsSection } from './settings/AgentsSection';
import { McpServersSection } from './settings/McpServersSection';
import { MemorySection } from './settings/MemorySection';
import { ProfileSection } from './settings/ProfileSection';
import { SkillsSection } from './settings/SkillsSection';
import { UsageSection } from './settings/UsageSection';
import { TerminalShortcutsSection } from './settings/TerminalShortcutsSection';
import { VoiceSettingsSection } from './settings/VoiceSettingsSection';
import { WorkspacesSection } from './settings/WorkspacesSection';
import type { SettingsSection } from './settings/types';
import { CloseIcon, LayoutsIcon, WorkspacesIcon } from './icons';

interface SettingsDrawerProps {
  open: boolean;
  initialSection?: SettingsSection;
  onClose: () => void;
}

interface SectionEntry {
  id: SettingsSection;
  label: string;
  hint?: string;
  icon: () => JSX.Element;
}

const SECTIONS: SectionEntry[] = [
  {
    id: 'profile',
    label: 'Profile',
    hint: 'Account',
    icon: () => <PersonIcon />,
  },
  {
    id: 'agents',
    label: 'Agents',
    hint: 'Library',
    icon: () => <CommitIcon />,
  },
  {
    id: 'skills',
    label: 'Skills',
    hint: 'Library',
    icon: () => <BookIcon />,
  },
  {
    id: 'mcp',
    label: 'MCP servers',
    hint: 'Connectors',
    icon: () => <PlugIcon />,
  },
  {
    id: 'voice',
    label: 'Voice',
    hint: 'ElevenLabs',
    icon: () => <MicIcon />,
  },
  {
    id: 'terminal',
    label: 'Terminal',
    hint: 'Shortcuts',
    icon: () => <TerminalIcon />,
  },
  {
    id: 'memory',
    label: 'CLAUDE.md',
    hint: 'Project memory',
    icon: () => <MemoryIcon />,
  },
  {
    id: 'usage',
    label: 'Usage & cost',
    icon: () => <ChartIcon />,
  },
  {
    id: 'workspaces',
    label: 'Workspaces',
    icon: () => <WorkspacesIcon size={16} />,
  },
];

export function SettingsDrawer({
  open,
  initialSection,
  onClose,
}: SettingsDrawerProps) {
  const [section, setSection] = useState<SettingsSection>(
    initialSection ?? 'agents',
  );

  // Bring focus to whichever section the caller asked for when opened.
  useEffect(() => {
    if (open && initialSection) setSection(initialSection);
  }, [open, initialSection]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div
      className={'settings-drawer-root' + (open ? ' open' : '')}
      // `inert` is the modern replacement for `aria-hidden` on
      // containers that hold focusable children: it hides the
      // subtree from AT *and* removes focus from anything inside,
      // so we don't get a "Blocked aria-hidden on a focused
      // descendant" warning when the close button still has focus
      // at the moment the drawer closes. We spread it conditionally
      // because React (≤18.x) renders `inert={false}` as the
      // attribute literal "false", which still activates inert.
      {...(!open ? { inert: '' } : {})}
    >
      <div
        className="settings-drawer-backdrop"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="settings-drawer"
        role="dialog"
        aria-modal
        aria-label="Settings"
      >
        <nav className="settings-nav">
          <div className="settings-nav-title">
            <LayoutsIcon size={14} /> Settings
          </div>
          <div className="settings-nav-list">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={
                  'settings-nav-item' + (section === s.id ? ' active' : '')
                }
                onClick={() => setSection(s.id)}
              >
                <span className="settings-nav-icon">{s.icon()}</span>
                <span className="settings-nav-label">{s.label}</span>
                {s.hint && (
                  <span className="settings-nav-hint">{s.hint}</span>
                )}
              </button>
            ))}
          </div>
          <div className="settings-nav-footer">
            <button
              className="settings-nav-close"
              onClick={onClose}
              title="Close (esc)"
            >
              <CloseIcon size={14} /> Close
            </button>
          </div>
        </nav>
        <main className="settings-content">
          {section === 'profile' && <ProfileSection />}
          {section === 'agents' && <AgentsSection />}
          {section === 'skills' && <SkillsSection />}
          {section === 'mcp' && <McpServersSection />}
          {section === 'voice' && <VoiceSettingsSection />}
          {section === 'terminal' && <TerminalShortcutsSection />}
          {section === 'memory' && <MemorySection />}
          {section === 'usage' && <UsageSection />}
          {section === 'workspaces' && <WorkspacesSection />}
        </main>
      </aside>
    </div>
  );
}

/* tiny custom icons used only inside the drawer nav */
function CommitIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <line x1="12" y1="1.5" x2="12" y2="9" />
      <line x1="12" y1="15" x2="12" y2="22.5" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a8 8 0 0 1 16 0v1" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="4 7 9 12 4 17" />
      <line x1="12" y1="17" x2="20" y2="17" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}

function PlugIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 2v6" />
      <path d="M15 2v6" />
      <path d="M6 8h12v4a6 6 0 0 1-12 0z" />
      <path d="M12 18v4" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </svg>
  );
}

function MemoryIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="3" y1="20" x2="21" y2="20" />
      <rect x="6" y="10" width="3" height="10" />
      <rect x="11" y="6" width="3" height="14" />
      <rect x="16" y="13" width="3" height="7" />
    </svg>
  );
}
