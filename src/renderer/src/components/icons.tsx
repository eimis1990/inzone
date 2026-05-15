import type { ReactNode } from 'react';

/**
 * Minimal stroke-based icon set used by the workspace bar.
 * All icons share a 24-unit viewBox and render in `currentColor`,
 * so their color is controlled entirely by CSS.
 */
interface IconProps {
  size?: number;
  stroke?: number;
  className?: string;
}

function Svg({
  children,
  size = 16,
  stroke = 1.75,
  className,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h3.9l2 2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </Svg>
  );
}

export function SplitHIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="7.5" height="16" rx="1.5" />
      <rect x="13.5" y="4" width="7.5" height="16" rx="1.5" />
    </Svg>
  );
}

export function SplitVIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="3" width="16" height="7.5" rx="1.5" />
      <rect x="4" y="13.5" width="16" height="7.5" rx="1.5" />
    </Svg>
  );
}

export function LayoutsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </Svg>
  );
}

export function WorkspacesIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 7l9-4 9 4-9 4-9-4Z" />
      <path d="M3 12l9 4 9-4" />
      <path d="M3 17l9 4 9-4" />
    </Svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </Svg>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9Z" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </Svg>
  );
}

export function BellOffIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      <path d="M18.63 13A17.89 17.89 0 0 1 18 8" />
      <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
      <path d="M18 8a6 6 0 0 0-9.33-5" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </Svg>
  );
}

/**
 * Sidebar panel glyph. When `closed` is true the chevron points right
 * (tap to expand); otherwise it points left (tap to collapse).
 */
export function PanelLeftIcon({ closed, ...props }: IconProps & { closed?: boolean }) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="10" y1="4" x2="10" y2="20" />
      {closed ? (
        <polyline points="14 9 17 12 14 15" />
      ) : (
        <polyline points="17 9 14 12 17 15" />
      )}
    </Svg>
  );
}

export function MultiAgentsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="6" cy="16" r="2.5" fill="currentColor" />
      <circle cx="18" cy="16" r="2.5" fill="currentColor" />
      <circle cx="12" cy="7" r="2.5" fill="currentColor" />
    </Svg>
  );
}

export function BotIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M12 4v4" />
      <circle cx="12" cy="3" r="1" />
      <circle cx="9" cy="13" r="0.8" fill="currentColor" />
      <circle cx="15" cy="13" r="0.8" fill="currentColor" />
      <path d="M9 17h6" />
      <line x1="2" y1="13" x2="4" y2="13" />
      <line x1="20" y1="13" x2="22" y2="13" />
    </Svg>
  );
}

export function MicIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </Svg>
  );
}

export function FileTextIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </Svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <polyline points="6 9 12 15 18 9" />
    </Svg>
  );
}

export function PaperclipIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21.44 11.05L12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.49" />
    </Svg>
  );
}

/**
 * Slash glyph used on the composer's "/" command-picker button.
 * A bold forward-slash inside a rounded square so it reads as a
 * "press to open a list of commands" affordance, not as a divider.
 */
export function SlashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <line x1="17" y1="4" x2="7" y2="20" />
    </Svg>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </Svg>
  );
}

/**
 * Bold, horizontal filled paper-plane glyph used in the composer
 * Send button. Renders as a solid shape (not stroked) so the icon
 * reads as a chunky press target rather than a fine outline. The
 * left-side V notch is drawn via a sub-path on the same fill, the
 * tip points right.
 */
export function SendFilledIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      className={className}
      aria-hidden
    >
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </Svg>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />
    </Svg>
  );
}

/** Diagonal four-arrow "expand" / "open in larger view" glyph.
 *  Used on the composer to pop the message field into a fullscreen-ish
 *  modal for long messages. */
export function ExpandIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </Svg>
  );
}

export function SparkleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6L12 3z" />
      <path d="M19 3v4" />
      <path d="M21 5h-4" />
      <path d="M5 17v4" />
      <path d="M7 19H3" />
    </Svg>
  );
}

/**
 * Mission Control glyph — a 2x3 grid of cards with a small pulse dot
 * in the top-right tile, suggesting "live overview of many projects".
 * Distinct from LayoutsIcon (2x2 even grid) so the two read as
 * different tools at a glance.
 */
export function MissionControlIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="7" height="6" rx="1.2" />
      <rect x="14" y="3" width="7" height="6" rx="1.2" />
      <rect x="3" y="11" width="7" height="6" rx="1.2" />
      <rect x="14" y="11" width="7" height="6" rx="1.2" />
      <rect x="3" y="19" width="7" height="2" rx="1" />
      <rect x="14" y="19" width="7" height="2" rx="1" />
      <circle cx="18.6" cy="5.6" r="1.1" fill="currentColor" />
    </Svg>
  );
}
