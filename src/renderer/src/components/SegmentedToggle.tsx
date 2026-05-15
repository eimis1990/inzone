/**
 * Reusable two-state toggle with a sliding pill thumb.
 *
 * Port of an Uiverse.io toggle (cbolson) — a label + hidden checkbox +
 * two grid-cell `<span>`s for the left/right content. The thumb is a
 * `::before` pseudo-element on the label that slides between the two
 * halves by animating its `inset` (left/right offsets) on input check.
 *
 * # API
 *
 * ```tsx
 * <SegmentedToggle
 *   value={mode}                       // 'lead' | 'multi'
 *   leftValue="lead"
 *   rightValue="multi"
 *   onChange={setMode}
 *   leftAriaLabel="Lead Agent mode"
 *   rightAriaLabel="Multi Agents mode"
 *   leftIcon={<BotIcon size={18} />}   // any React node
 *   rightIcon={<MultiAgentsIcon size={18} />}
 * />
 * ```
 *
 * The component is "left = unchecked", "right = checked", matching the
 * underlying `<input type="checkbox">`. When `value === rightValue`,
 * the toggle is in its checked state and the thumb sits on the right.
 *
 * Icons (or any other content) are rendered into two equal grid
 * columns. Their colour and opacity are driven entirely by CSS — the
 * side currently covered by the thumb reads at full opacity in
 * `--accent-on`; the other side fades to `var(--text-dim)`.
 */

import type { ReactNode } from 'react';

interface SegmentedToggleProps<T extends string> {
  value: T;
  /** Value when the toggle is in its left/unchecked position. */
  leftValue: T;
  /** Value when the toggle is in its right/checked position. */
  rightValue: T;
  onChange: (next: T) => void;

  /** Content shown in the LEFT cell (icon or text). */
  leftIcon: ReactNode;
  /** Content shown in the RIGHT cell (icon or text). */
  rightIcon: ReactNode;

  /** Aria label + tooltip used for each state. */
  leftAriaLabel: string;
  rightAriaLabel: string;

  /** Optional className for outer container styling overrides. */
  className?: string;
  /** Title rendered on the container — falls back to the active label. */
  title?: string;
}

export function SegmentedToggle<T extends string>({
  value,
  leftValue,
  rightValue,
  onChange,
  leftIcon,
  rightIcon,
  leftAriaLabel,
  rightAriaLabel,
  className,
  title,
}: SegmentedToggleProps<T>): JSX.Element {
  const isRight = value === rightValue;
  const ariaLabel = isRight ? rightAriaLabel : leftAriaLabel;

  return (
    <label
      className={'segmented-toggle' + (className ? ` ${className}` : '')}
      title={title ?? ariaLabel}
    >
      <input
        type="checkbox"
        checked={isRight}
        onChange={(e) => onChange(e.target.checked ? rightValue : leftValue)}
        aria-label={ariaLabel}
        role="switch"
        aria-checked={isRight}
      />
      <span className="segmented-toggle-side left" aria-hidden>
        {leftIcon}
      </span>
      <span className="segmented-toggle-side right" aria-hidden>
        {rightIcon}
      </span>
    </label>
  );
}
