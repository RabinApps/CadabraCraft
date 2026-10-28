# SEO plan for cadabracraft.com

Status: proposed 2026-10-27; the "Before announcing" work in section 8 was implemented the same day (new pages, social card, structured data, sitemap dates, copy). Section 2 describes the site before that work. What is left is in [roadmap.md](roadmap.md), "Website (marketing and SEO pass)". The page designs this plan relies on are in the pen as `Website / ...` frames (see [design.md](design.md), "Website").

## 1. Goals and rules

**Audience.** Self-publishing authors and small publishers who want to write and format a book without paying for a formatter, without an account, and with their files on their own computer.

**Goal.** Be found by people searching for a free, offline alternative to paid book formatters, and by people looking for how-to help with EPUB, print PDF and manuscript import. The measure of success is organic visits to Download, Compare and Guides pages, plus GitHub Releases downloads once a release exists.

**Rules (from CLAUDE.md).** No analytics, tag managers, cookies or third-party requests on the site. No paid ads. No claims we cannot source: competitor facts stay dated and marked "Not verified" when unsure. Structured data describes only what exists today.

## 2. What the site does today

Checked against `apps/website/src` on 2026-10-27.

| Area                | State                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Routes              | `/`, `/features/`, `/compare/`, `/compare/<slug>/` (4), `/support/`, `/download/`, 404                                                  |
| Metadata            | `pageMetadata()` in `lib/seo.ts`: title, description, canonical, OpenGraph, Twitter `summary`. No image                                 |
| Sitemap and robots  | `sitemap.ts` lists every route without `lastModified`; `robots.ts` allows all and names the sitemap                                    |
| Structured data     | One `WebSite` object in `layout.tsx`. No `FAQPage`, `BreadcrumbList`, `SoftwareApplication` or `Article`                               |
| Hosting             | GitHub Pages, custom domain via `public/CNAME`, `output: "export"`, `trailingSlash: true`, fonts self-hosted by `next/font`            |
| Images              | None. The home page uses an HTML mockup; `images.unoptimized` is set because of the static export                                      |
| Copy gap            | FAQ and Features say "EPUB3 and print-ready PDF". The app also exports Word, Markdown and audiobooks, imports HTML, and has editions   |

## 3. Keyword map

One primary intent per URL. Volume and difficulty are not measured here (no tracking, no paid tools); validate with Search Console impressions after launch and revise.

| URL                     | Primary query                                  | Also                                                     | Title draft (50 to 60 chars)                       |
| ----------------------- | ---------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------- |
| `/`                     | free book formatting software                  | book writing software, offline book editor               | CadabraCraft: free book writing and formatting app |
| `/features/`            | book writing and formatting features           | local-first writing app, audiobook from manuscript       | Book writing and formatting features               |
| `/formats/` (new)       | EPUB and print PDF from one manuscript         | export epub, export docx, import markdown                | EPUB, PDF, Word and Markdown for your book         |
| `/compare/`             | book formatting software comparison            | vellum alternatives                                      | Compare book formatting software                   |
| `/compare/vellum/`      | Vellum alternative for Windows and Linux       | free vellum alternative                                  | CadabraCraft vs Vellum: a free alternative         |
| `/compare/atticus/`     | Atticus vs Vellum alternatives                 | atticus alternative                                      | CadabraCraft vs Atticus                            |
| `/compare/scrivener/`   | Scrivener alternative for formatting           | scrivener epub export                                    | CadabraCraft vs Scrivener                          |
| `/compare/reedsy-studio/` | Reedsy Studio alternative offline            | offline book editor                                      | CadabraCraft vs Reedsy Studio                      |
| `/download/`            | CadabraCraft download                          | book formatter for mac, windows, linux                   | Download CadabraCraft                              |
| `/guides/<slug>/` (new) | see section 5                                  |                                                          | per guide                                          |
| `/support/`, `/changelog/` | brand queries only                          |                                                          | keep short; no keyword targeting                   |

Rules: the title carries the primary query once; the H1 is a readable variant of it, not a duplicate; descriptions (140 to 160 chars) state the benefit and "free" and "no account" where true; no two pages target the same query.

## 4. Technical work

Ordered by value. Each item maps to a file.

1. **Social image and `summary_large_image`.** Export the 1200x630 OG image from the pen into `public/og/cadabracraft-og.png`; set `openGraph.images` and `twitter.card: "summary_large_image"` in `lib/seo.ts`; allow a per-page image override. (Already a roadmap item.)
2. **Sitemap `lastModified`.** Add a date per route (from a `data` constant, not `new Date()`, so builds stay deterministic). Compare pages use `checkedOn`.
3. **Structured data**, each only when the page shows the content:
   - `FAQPage` on `/` and `/formats/` from `data/content.ts` `faq`.
   - `BreadcrumbList` on compare and guide pages (the designs show visible breadcrumbs).
   - `Article` on guides with `author` RabinApps, `datePublished`, `dateModified`.
   - `SoftwareApplication` (free, `offers` price 0, `operatingSystem`) **only after a release exists**; architecture.md already defers it.
4. **Redirects and host.** In DNS and Pages settings: `www` to apex, HTTPS enforced. Pages cannot do server redirects, so `www` relies on the CNAME and GitHub's redirect; check it after launch.
5. **Canonical hygiene.** Canonicals already end with `/`. Keep every internal link in the same form; 404 page gets `noindex`.
6. **Performance (Core Web Vitals).** Static export and self-hosted fonts already help. Replace the `EditorMockup` with exported screenshots using explicit `width` and `height` (no layout shift), `loading="lazy"` below the fold, `fetchPriority="high"` on the hero image, modern formats (AVIF or WebP) pre-generated at build because `images.unoptimized` is set. Budget: LCP under 2.5 s on a mid-range phone, CLS under 0.05, total JS under 150 kB gzipped on the home page. Verify with Lighthouse (the `web-perf` skill) before each launch milestone.
7. **Internal links.** Home links to Features, Formats, Compare, Download. Footer lists Features, Compare, Formats, Guides, Support (drawn in the pen). Every guide links to a feature or format page and to Download; every compare page links to the other comparisons and to the matching guide.
8. **Accessibility as SEO.** One H1 per page, meaningful heading order, descriptive link text ("Read the full comparison"), alt text on screenshots, visible focus. These are in the designs and in `docs/design.md`.
9. **i18n.** No `hreflang` until translated pages exist. When they do, use `/<lang>/` paths with reciprocal `hreflang`. The app supports language editions, but the site is English only for now.

## 5. Content plan

**Guides** (new `/guides/` index plus articles; template drawn as `Website / Guide article`). Backlog in priority order, each tied to a product capability so it can link to a real feature:

| Guide                                           | Primary query                          | Links to                  |
| ----------------------------------------------- | -------------------------------------- | ------------------------- |
| How to format an EPUB                           | how to format an epub                  | `/formats/`, `/download/` |
| Print-ready PDF: trim sizes, margins and fonts  | book trim sizes for print              | `/formats/`               |
| Convert a Word manuscript to EPUB               | convert docx to epub                   | `/formats/`               |
| Write a book in Markdown                        | write a book in markdown               | `/features/`              |
| Make an audiobook from your manuscript          | make an audiobook from text offline    | `/features/`              |
| Translate your book into another language       | translate a book edition               | `/features/`              |

Every guide: 800 to 1,500 words, written by a person who ran the steps in the app, screenshots from the app, "Updated" date, no filler. Do not publish a guide whose steps the current app cannot do.

**Compare pages.** They are the highest-intent pages and the riskiest. Keep every fact sourced and dated; finish the roadmap task to verify the "Not verified" fields; add a visible "Spot a mistake? Open an issue" link; never disparage, state who each tool is best for (already the pattern). Re-check all of them every 90 days and update `checkedOn`.

**FAQ.** Grow from 5 to about 10 questions on Home and Formats: Is it safe to sync with Dropbox? Can I get my files back out? Does it work offline? Which Word features import? Does the EPUB pass validation? Answers must match the app and the user guide.

**Copy fixes before launch.** Update Home, Features, FAQ and `metadata` descriptions to mention Word, Markdown, audiobook and editions, as the Features design does; today they undersell the app.

## 6. Off-site

- **GitHub.** Repository description, website field and topics (`epub`, `book-formatting`, `self-publishing`, `tauri`, `local-first`, `typst`), a README top section that mirrors the site's pitch, and release notes that name the formats and platforms. GitHub pages rank for brand and "source available" queries.
- **Listings** once a release exists: AlternativeTo (as an alternative to Vellum, Atticus, Scrivener), Product Hunt, the relevant self-publishing communities. Be open that it is the maker's own project. No purchased links, no link exchanges, no comment spam, no cloaking.
- **Search Console and Bing Webmaster Tools.** Verify by DNS TXT record so no script or meta tag ships (keeps the no-tracking promise). Submit `sitemap.xml`.
- **Reviews and mentions.** Ask early users for honest write-ups; offer nothing in return.

## 7. Measuring without tracking

- Search Console: impressions, clicks, queries, indexed pages, Core Web Vitals field data. Review monthly.
- GitHub: stars, traffic (Insights, visible to maintainers only), release download counts.
- Manual rank checks for the ten primary queries each quarter, logged in this file or an issue.
- Lighthouse runs on every launch milestone and after any layout change to a template.

## 8. Phases

| Phase                  | Work                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Before announcing**  | OG image and screenshots; copy fixes (section 5); sitemap dates; `FAQPage` and `BreadcrumbList`; DNS, HTTPS and `www`; Search Console and Bing verification; competitor facts verified; Lighthouse pass |
| **Launch (first release)** | `SoftwareApplication` data and real download buttons on `/download/`; release notes and `/changelog/`; GitHub topics and description; AlternativeTo listing                    |
| **+30 days**           | `/formats/` built; first two guides (EPUB, Word to EPUB); review Search Console queries and adjust titles and descriptions                                                      |
| **+90 days**           | Remaining guides; 90-day re-check of compare pages; quarterly rank check; decide on translated pages based on real demand                                                      |

## 9. Risks

- **Wrong competitor facts** harm trust and invite takedown requests. Mitigation: sources, dates, "Not verified", the 90-day re-check.
- **Thin or duplicated pages.** Do not ship a guide or format page without real steps and screenshots; do not template-generate near-duplicate pages.
- **Promising what is not released.** Download stays honest ("not available yet") until a release exists, and structured data follows it.
- **Performance regressions** from screenshots. Budgets in section 4 are checked before each launch milestone.
- **Single point of failure on Pages.** If GitHub Pages is unavailable the site is too; acceptable for a static, no-backend project.
