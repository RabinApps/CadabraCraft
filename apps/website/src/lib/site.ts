export const SITE_URL = "https://cadabracraft.com";
export const SITE_NAME = "CadabraCraft";
export const REPO = "https://github.com/RabinApps/cadabracraft";
export const RELEASES = `${REPO}/releases`;

// Keep in sync with .github/FUNDING.yml.
export const funding = [
  { label: "GitHub Sponsors", href: "https://github.com/sponsors/RabinApps", primary: true },
  { label: "Buy me a coffee", href: "https://www.buymeacoffee.com/rabinapps", primary: false },
  {
    label: "Donate with PayPal",
    href: "https://www.paypal.com/donate/?hosted_button_id=YEJ37WF4Q3HPC",
    primary: false,
  },
] as const;

/** Social card, 1200x630, exported from the pen frame "Website / OG image". */
export const OG_IMAGE = "/og/cadabracraft-og.png";

export const nav = [
  { label: "Features", href: "/features/" },
  { label: "Compare", href: "/compare/" },
  { label: "Formats", href: "/formats/" },
  { label: "Guides", href: "/guides/" },
  { label: "Support", href: "/support/" },
] as const;

export const btn =
  "inline-flex items-center justify-center rounded-md px-5 py-2.5 text-sm font-medium transition-colors";
export const btnPrimary = `${btn} bg-accent text-accent-ink hover:opacity-90`;
export const btnSecondary = `${btn} border border-border bg-surface text-ink hover:bg-sidebar`;
