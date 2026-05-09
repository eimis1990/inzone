/**
 * Settings → Shortcuts.
 *
 * Reference page listing every keyboard shortcut wired into INZONE.
 * Grouped by surface (workspace / panes / modals / etc.) for quick
 * scanning. Modifier glyphs use ⌘ on macOS and "Ctrl" on Windows /
 * Linux based on the runtime platform — same key combo, different
 * label, so each user sees what their keyboard actually says.
 *
 * The list lives in code rather than reading from a registry: the
 * shortcuts themselves are scattered across components (App.tsx for
 * Tab / Cmd+F / Cmd+Shift+M, PreviewButton for Cmd+P, TerminalPanel
 * for Cmd+T, etc.), and reading them at runtime would require a
 * runtime registry we don't currently maintain. When you add a new
 * shortcut anywhere in the app, ALSO add a row here.
 */

import { useMemo } from 'react';

interface Shortcut {
  /** Mac modifiers: 'cmd', 'shift', 'opt'. The component swaps to
   *  Ctrl on Win/Linux automatically. */
  mods?: Array<'cmd' | 'shift' | 'opt'>;
  /** Display string for the key itself (e.g. 'F', 'Enter', 'Esc',
   *  'Tab'). Special-cased to render glyphs (⏎, ⎋) where natural. */
  key: string;
  /** What the shortcut does, in user-facing language. */
  action: string;
  /** Optional context — when does this shortcut work? e.g. "active
   *  pane", "in the composer", "in any modal". */
  context?: string;
}

interface ShortcutGroup {
  title: string;
  shortcuts: Shortcut[];
}

const GROUPS: ShortcutGroup[] = [
  {
    title: 'Workspace',
    shortcuts: [
      { key: 'Tab', action: 'Show / hide the sidebar' },
      {
        mods: ['cmd'],
        key: 'F',
        action: 'Toggle fullscreen on the active pane',
        context: 'Returns to All view on second press',
      },
      {
        mods: ['cmd'],
        key: 'P',
        action: 'Open the Preview window for the active session',
      },
      {
        mods: ['cmd'],
        key: 'B',
        action: 'Open the Preview multi-URL picker',
        context: 'When multiple localhost servers are detected',
      },
      {
        mods: ['cmd'],
        key: 'T',
        action: 'Toggle the terminal panel',
      },
      {
        mods: ['cmd', 'shift'],
        key: 'M',
        action: 'Toggle Mission Control',
      },
    ],
  },
  {
    title: 'Composer',
    shortcuts: [
      {
        mods: ['cmd'],
        key: 'Enter',
        action: 'Send the message to the agent',
        context: 'In any pane composer',
      },
    ],
  },
  {
    title: 'Editor & modals',
    shortcuts: [
      {
        mods: ['cmd'],
        key: 'Enter',
        action: 'Save changes',
        context: 'Agent / skill editor',
      },
      {
        mods: ['cmd'],
        key: 'S',
        action: 'Save the edited wiki page',
        context: 'Wiki page editor',
      },
      {
        key: 'Esc',
        action: 'Close the topmost modal',
        context:
          'Settings drawer stays open if a modal was on top — press Esc again to close it',
      },
    ],
  },
];

export function ShortcutsSection() {
  // Detect platform once. INZONE runs in Electron — process.platform
  // exposed via the preload's `system.platform()` is the
  // authoritative source. Falls back to 'darwin' if the bridge
  // isn't ready yet (renderer first paint).
  const isMac = useMemo(() => {
    try {
      return window.cowork.system.platform() === 'darwin';
    } catch {
      return true;
    }
  }, []);

  return (
    <div className="settings-pane">
      <div className="settings-pane-header">
        <h2>Shortcuts</h2>
        <p className="settings-pane-sub">
          Keyboard shortcuts wired into INZONE — press, don&rsquo;t click.
        </p>
      </div>
      <div className="settings-pane-body">
        {GROUPS.map((group) => (
          <section className="shortcuts-group" key={group.title}>
            <div className="shortcuts-group-title">{group.title}</div>
            <ul className="shortcuts-list">
              {group.shortcuts.map((s, i) => (
                <li className="shortcut-row" key={i}>
                  <div className="shortcut-keys" aria-label={describe(s, isMac)}>
                    {renderShortcut(s, isMac)}
                  </div>
                  <div className="shortcut-text">
                    <div className="shortcut-action">{s.action}</div>
                    {s.context && (
                      <div className="shortcut-context">{s.context}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function renderShortcut(s: Shortcut, isMac: boolean): JSX.Element[] {
  const parts: JSX.Element[] = [];
  const pushKey = (label: string, key: string) =>
    parts.push(
      <kbd className="shortcut-key" key={key}>
        {label}
      </kbd>,
    );

  if (s.mods?.includes('cmd')) pushKey(isMac ? '⌘' : 'Ctrl', 'mod');
  if (s.mods?.includes('shift')) pushKey(isMac ? '⇧' : 'Shift', 'shift');
  if (s.mods?.includes('opt')) pushKey(isMac ? '⌥' : 'Alt', 'opt');
  pushKey(prettifyKey(s.key, isMac), 'main');
  return parts;
}

/** Prettify special-cased key names for display. */
function prettifyKey(key: string, isMac: boolean): string {
  switch (key.toLowerCase()) {
    case 'enter':
    case 'return':
      return isMac ? '⏎' : 'Enter';
    case 'esc':
    case 'escape':
      return isMac ? '⎋' : 'Esc';
    case 'tab':
      return 'Tab';
    case 'space':
      return '␣';
    default:
      return key.toUpperCase();
  }
}

/** Build an accessibility-friendly description of the shortcut. */
function describe(s: Shortcut, isMac: boolean): string {
  const parts: string[] = [];
  if (s.mods?.includes('cmd')) parts.push(isMac ? 'Command' : 'Control');
  if (s.mods?.includes('shift')) parts.push('Shift');
  if (s.mods?.includes('opt')) parts.push(isMac ? 'Option' : 'Alt');
  parts.push(s.key);
  return parts.join(' + ');
}
