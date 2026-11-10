# CadabraCraft website

Marketing site and docs for [cadabracraft.com](https://cadabracraft.com). Next.js (App Router), static export, Tailwind v4, MDX for docs and guides, multi-language ready (English only for now). Tokens come from [docs/design.md](../../docs/design.md). The site makes no runtime network calls and has no analytics.

## Develop
```bash
pnpm --filter @cadabracraft/website dev        # http://localhost:3000
pnpm --filter @cadabracraft/website build      # static output in apps/website/out
pnpm --filter @cadabracraft/website typecheck
```

## Content and languages
- Every page is under `/<locale>/` (today `/en/`). Old unprefixed URLs are redirect stubs in `src/app/(legacy)/`.
- Docs are MDX files in `src/content/en/docs/` and guides in `src/content/en/guides/`. Each starts with frontmatter (`title`, `description`, `group`, `order`, `updated`; guides also `tag`, `summary`, `readMinutes`). Links to other docs pages use `/docs/<slug>/#heading` and are checked by `pnpm --filter @cadabracraft/website test`. Components available in MDX: `Callout` and `Kbd`.
- UI strings are in `src/i18n/messages/<locale>.ts`; marketing data in `src/content/<locale>/*.ts`.
- **Add a language:** add the code to `LOCALES` in `src/i18n/config.ts` (and its name in `components/LocaleSwitcher.tsx`), add `src/i18n/messages/<locale>.ts` and register it in `src/i18n/messages.ts`, add `src/content/<locale>/` with the data modules and register it in `src/content/index.ts`, then translate MDX files into `src/content/<locale>/docs/` and `guides/`. Untranslated pages fall back to English with a notice. The inline copy in the marketing page TSX needs moving into the content modules first (see `docs/roadmap.md`).

```bash
pnpm --filter @cadabracraft/website test   # locale paths, hreflang, MDX frontmatter and docs links
```

## Screenshots
Product screenshots are generated from the real UI (the app running in a browser against the in-memory fake backend used by the e2e specs, with the sample book "The Salt Orchard"), so they are reproducible and need no installed app:

```bash
pnpm --filter @cadabracraft/desktop screenshots:website                       # light and dark, into apps/website/public/screens
SHOTS=editor,export pnpm --filter @cadabracraft/desktop screenshots:website   # only some shots
SCREENSHOT_DIR=/tmp/shots SCALE=1 pnpm --filter @cadabracraft/desktop screenshots:website
```

Files are named `<shot>-<light|dark>.png` (1440x900 at 2x by default). The shots and the sample book are defined in `apps/desktop/e2e-screenshots/website.spec.ts`; add a shot by adding an entry to `SHOTS`. Reference them from `featureGroups[].shot` in `src/content/en/content.ts` and the Home hero, using a `<picture>` per colour scheme. Run it again whenever the UI changes; do not edit the PNGs by hand.

## Launch checklist (one-time)
The deploy workflow is `.github/workflows/pages.yml`. It publishes `apps/website/out` on pushes to `main` that touch `apps/website/**`, or manually via "Run workflow". `public/CNAME` holds `cadabracraft.com`, so the site is served from the root with no `basePath`.

1. **Merge to `main`** so the workflow can run.
2. **GitHub Pages settings** (repo Settings → Pages):
   - Source: **GitHub Actions**.
   - Custom domain: `cadabracraft.com`.
   - Turn on **Enforce HTTPS** once the certificate is issued (can take up to an hour after DNS resolves).
3. **DNS** at the domain provider:
   - Apex (`cadabracraft.com`) A records:
     - `185.199.108.153`
     - `185.199.109.153`
     - `185.199.110.153`
     - `185.199.111.153`
   - `www` CNAME to `rabinapps.github.io`.
   - Optional IPv6 AAAA records for the apex are listed in GitHub's custom-domain docs.
4. **Verify**: the workflow run is green, `https://cadabracraft.com` loads over HTTPS, and `www` redirects to the apex.

## Before announcing
- Regenerate the screenshots in `public/screens/` (see "Screenshots") after UI changes, and add more shots (import, audiobook, editions) and set `shot` on the matching entries in `featureGroups` (`src/content/en/content.ts`). The social card `public/og/cadabracraft-og.png` already exists; re-export it from the pen frame `Website / OG image` if the headline changes.
- Confirm the repo URL in `src/app/page.tsx` (`REPO`) and the three funding links (GitHub Sponsors, Buy Me a Coffee, PayPal; same values as `.github/FUNDING.yml`).
- Add a real download link once a GitHub Release exists; the hero currently says downloads are not available yet.
- Check the page at phone, tablet and desktop widths in both themes.
- Add a LICENSE once the licensing question in the root README is settled, and link it from the site.
