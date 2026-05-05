import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  /** The hover-explanation text shown in the bubble. Wraps automatically
   *  via CSS max-width — pass plain prose, no manual line breaks needed. */
  text: string;
  /** The trigger element. Wrapped in a span so we can attach hover /
   *  focus listeners + measure its bounding box for positioning. */
  children: ReactNode;
  /**
   * Where the bubble sits relative to the trigger. 'top' is the
   * default — most discoverable in tight UI like sidebars where the
   * trigger usually has empty space above it (and parent containers
   * may have right/left overflow clipping). 'bottom' for triggers
   * near the top of the viewport where 'top' would clip.
   */
  placement?: 'top' | 'bottom';
}

/**
 * Hover/focus tooltip rendered via React Portal into `document.body`,
 * so it can escape any `overflow: hidden` ancestor (like
 * `.sidebar-host`, where pseudo-element tooltips were getting their
 * left side clipped). Works on both mouse hover and keyboard focus.
 *
 * Why a real component (not just `title="..."` or a CSS pseudo-element):
 *
 *   - Native `title` attributes have a ~500ms delay and unstyled
 *     OS chrome, easy to miss entirely.
 *   - CSS pseudo-element tooltips can't render outside the trigger's
 *     ancestor stacking / overflow box.
 *   - This component appears immediately on hover, has consistent
 *     dark-theme styling, and renders in document.body so it can
 *     extend past the sidebar's right edge into the pane area when
 *     the trigger is near the sidebar's right edge.
 *
 * Bubble position is recomputed from the trigger's bounding rect on
 * every show (so layout shifts between hovers don't strand it). A
 * single ResizeObserver could keep it in sync during animation but
 * the bubble is `pointer-events: none` and short-lived, so a static
 * snapshot is fine.
 */
export function Tooltip({
  text,
  children,
  placement = 'top',
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{
    top: number;
    centerX: number;
    placement: 'top' | 'bottom';
  } | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);

  const show = useCallback(() => {
    const node = wrapRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    // For 'top' placement, anchor the bubble to the trigger's TOP
    // edge — CSS then translates it up by 100% + an 8px gap, so the
    // bubble sits above the trigger. 'bottom' is the mirror.
    const top = placement === 'top' ? rect.top : rect.bottom;
    const centerX = rect.left + rect.width / 2;
    setPos({ top, centerX, placement });
    setVisible(true);
  }, [placement]);

  const hide = useCallback(() => {
    setVisible(false);
  }, []);

  // Hide if the user scrolls or resizes — the cached position would
  // become stale otherwise. We don't try to live-track; just dismiss
  // and let the next hover re-measure.
  useEffect(() => {
    if (!visible) return;
    const onChange = () => setVisible(false);
    window.addEventListener('scroll', onChange, true);
    window.addEventListener('resize', onChange);
    return () => {
      window.removeEventListener('scroll', onChange, true);
      window.removeEventListener('resize', onChange);
    };
  }, [visible]);

  return (
    <>
      <span
        ref={wrapRef}
        className="ui-tooltip-wrap"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {visible &&
        pos &&
        createPortal(
          <div
            className={
              'ui-tooltip ui-tooltip-' + pos.placement
            }
            style={{
              top: `${pos.top}px`,
              left: `${pos.centerX}px`,
            }}
            role="tooltip"
          >
            {text}
            <span className="ui-tooltip-arrow" aria-hidden />
          </div>,
          document.body,
        )}
    </>
  );
}
