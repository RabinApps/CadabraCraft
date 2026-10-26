# CadabraCraft website

Marketing site for [cadabracraft.com](https://cadabracraft.com). Next.js (App Router), static export, Tailwind v4. Tokens come from [docs/design.md](../../docs/design.md). The site makes no runtime network calls and has no analytics.

## Develop
```bash
pnpm --filter @cadabracraft/website dev        # http://localhost:3000
pnpm --filter @cadabracraft/website build      # static output in apps/website/out
pnpm --filter @cadabracraft/website typecheck
```

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
- Replace the HTML/CSS `EditorMockup` with real screenshots exported from `cadabracraft.pen` (put them in `public/screens/`), light and dark.
- Confirm the repo URL in `src/app/page.tsx` (`REPO`) and the three funding links (GitHub Sponsors, Buy Me a Coffee, PayPal; same values as `.github/FUNDING.yml`).
- Add a real download link once a GitHub Release exists; the hero currently says downloads are not available yet.
- Check the page at phone, tablet and desktop widths in both themes.
- Add a LICENSE once the licensing question in the root README is settled, and link it from the site.
