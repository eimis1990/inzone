import logoUrl from '../assets/in-zone-logo.png';

interface AppLogoProps {
  size?: number;
}

/** Brand mark rendered from the bundled PNG. */
export function AppLogo({ size = 32 }: AppLogoProps) {
  return (
    <img
      className="app-logo-img"
      src={logoUrl}
      width={size}
      height={size}
      alt="INzone"
    />
  );
}
