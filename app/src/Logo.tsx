import mark from "./logo.png";

/**
 * The mark, cut out of icons/scrivano-1024.png and shipped as an alpha mask
 * rather than a picture, so the topbar paints it in the theme's own accent
 * instead of the one blue that works on a light tile and disappears on a dark
 * one. Regenerate both together, see the icon note in README.
 */
export default function Logo({ size = 20 }: { size?: number }) {
  return (
    <span
      className="logo"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        WebkitMaskImage: `url(${mark})`,
        maskImage: `url(${mark})`,
      }}
    />
  );
}
