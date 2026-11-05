# CadabraCraft docs

Back to the [project README](../README.md).

## Using CadabraCraft and its formats

| Doc                                                                        | What it covers                                                                                                      |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [user-guide.md](user-guide.md)                                             | For authors: getting started, writing, organising, importing, exporting, synced folders, shortcuts, troubleshooting |
| [file-format.md](file-format.md)                                           | The project folder: `cadabra.json`, chapter JSON, assets, conflicts, versioning                                     |
| [import.md](import.md)                                                     | Markdown and `.docx` import: mappings, warnings, limits                                                             |
| [mcp.md](mcp.md)                                                           | The headless MCP server: tools, safety model, error codes                                                           |
| [accessibility-statement.md](accessibility-statement.md)                   | What we aim for, where we are, known problems and how to report one                                                 |
| [accessibility-conformance-report.md](accessibility-conformance-report.md) | Criterion-by-criterion WCAG 2.2 report (VPAT format), a self-assessment                                             |

## Design and architecture

| Doc                                | What it covers                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [architecture.md](architecture.md) | Decisions with rejected alternatives, grouped by area (foundations, desktop app, export, platform, website)  |
| [design.md](design.md)             | Tokens, theming, breakpoints, screens. Mirrors `cadabracraft.pen`; run `/sync-design` after changing the pen |

## Development and testing

| Doc                                                      | What it covers                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| [testing.md](testing.md)                                 | Unit, e2e and coverage commands, thresholds and exclusions           |
| [agent-testing.md](agent-testing.md)                     | Driving the real app through the dev-only bridge                     |
| [sync-testing.md](sync-testing.md)                       | Manual checklist for iCloud Drive, Google Drive and Dropbox          |
| [release-checklist.md](release-checklist.md)             | Ordered steps for a release dry run and the updater round trip       |
| [platform-checks.md](platform-checks.md)                 | Checks that need Windows, Linux, sync clients or a word processor    |
| [platform-checks-windows.md](platform-checks-windows.md) | NVDA and WebView2 on the packaged app (WIN-1 to WIN-32)              |
| [platform-checks-macos.md](platform-checks-macos.md)     | VoiceOver and display settings on the packaged app (MAC-1 to MAC-25) |
| [platform-checks-linux.md](platform-checks-linux.md)     | Orca and AT-SPI on WebKitGTK (LIN-1 to LIN-11)                       |

## Planning

| Doc                                          | What it covers                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| [roadmap.md](roadmap.md)                     | Ideas and follow-ups outside the current milestone                                 |
| [plan-feature-gaps.md](plan-feature-gaps.md) | Sequenced plan for closing the competitor gaps: phases, sizes, dependencies, gates |
| [m1-ui-plan.md](m1-ui-plan.md)               | The M1 UI implementation plan (historical; M1 is done)                             |
| [seo-plan.md](seo-plan.md)                   | SEO plan for cadabracraft.com: keywords, technical work, content, measurement      |
