import logoDarkUrl from '../assets/in-zone-logo.png';
import logoLightUrl from '../assets/inzone-logo-light-theme.png';

interface AppLogoProps {
  size?: number;
}

/**
 * Brand mark rendered from the bundled PNGs.
 *
 * Two variants ship — the dark-theme logo (default) and a
 * light-theme variant tuned for the warm-paper palette. Both `<img>`
 * elements are always in the DOM; CSS toggles `display` based on
 * the `:root.theme-light` class. That keeps the swap fully reactive
 * to live theme changes without any React state or theme context
 * subscription — and the bundled image weight is negligible.
 */
export function AppLogo({ size = 32 }: AppLogoProps) {
  return (
    <>
      <img
        className="app-logo-img app-logo-dark"
        src={logoDarkUrl}
        width={size}
        height={size}
        alt="INzone"
      />
      <img
        className="app-logo-img app-logo-light"
        src={logoLightUrl}
        width={size}
        height={size}
        alt=""
        aria-hidden
      />
    </>
  );
}
