const WIDTH = 1440;
const HEIGHT = 900;

/**
 * A product screenshot in both colour schemes (`public/screens/<name>-light.png` and `-dark.png`, made by
 * `pnpm --filter @cadabracraft/desktop screenshots:website`). The visible one follows the theme, including the
 * manual override from the theme menu, see `.shot-light` and `.shot-dark` in globals.css.
 */
export function Screenshot({
  name,
  alt,
  className = "",
  eager = false,
}: {
  name: string;
  alt: string;
  className?: string;
  eager?: boolean;
}) {
  const common = {
    width: WIDTH,
    height: HEIGHT,
    loading: eager ? ("eager" as const) : ("lazy" as const),
    className: `h-auto w-full ${className}`,
  };
  return (
    <>
      <img src={`/screens/${name}-light.png`} alt={alt} {...common} className={`shot-light ${common.className}`} />
      <img src={`/screens/${name}-dark.png`} alt={alt} {...common} className={`shot-dark ${common.className}`} />
    </>
  );
}
