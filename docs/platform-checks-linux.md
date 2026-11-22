# Linux: Orca on WebKitGTK

Part of the [docs index](README.md). A longer version of the "Linux: Orca with WebKitGTK" section in [platform-checks.md](platform-checks.md), written so one person can run it start to finish. **Nothing here has been run.** The machine that prepared it is a Mac, and the research for it found no reports of Orca reading a Tauri window on WebKitGTK, good or bad: whether the web content shows up in the AT-SPI tree and how it is spoken is unknown. Every command and every "try" below comes from general knowledge of GNOME and AT-SPI, not from a run against this app; if one fails, write down what happened and do not assume the app is at fault.

The release bundle targets are `app`, `dmg` and `appimage` in `tauri.conf.json`, with `nsis` added for Windows by `tauri.windows.conf.json`, so on Linux the artifact to test is the **AppImage** from a release dry run ([release-checklist.md](release-checklist.md)). A dev build (`pnpm tauri:automate`) is a fallback, and a differing result between the two is worth a note.

Ids start with `L` so they do not clash with the checklist ids A to M, W and KB in platform-checks.md.

## Setup

### LIN-1. Machine and versions

1. A current GNOME session on a real or virtual machine with a display and sound. Note the distribution, the desktop version, the Orca version (`orca --version`) and the WebKitGTK version (`dpkg -l | grep webkit2gtk` on Debian and Ubuntu, or the distribution's equivalent). The AppImage normally uses the system WebKitGTK, so the version that matters is the installed one; confirm that on your build by looking at which `libwebkit2gtk` the process maps (`grep webkit /proc/<pid>/maps`).
2. Make the AppImage executable and start it once from a terminal so any warnings are visible: `chmod +x CadabraCraft*.AppImage && ./CadabraCraft*.AppImage`. An AppImage needs FUSE 2 (`libfuse2`) unless you run it with `--appimage-extract-and-run`.
3. Keep a second terminal open for the commands below, and run the app from the first.

Expected: the app window opens on Home with the heading "Write your first book". Record the versions.

### LIN-2. Turn the screen reader support on

1. Check the desktop setting: `gsettings get org.gnome.desktop.interface toolkit-accessibility` should print `true`. If it prints `false`, set it with `gsettings set org.gnome.desktop.interface toolkit-accessibility true` (or turn on Settings, Accessibility, Screen Reader, which also does it), then log out and in once.
2. Start Orca: Super+Alt+S on GNOME, or `orca &` from a terminal. Orca should say "Screen reader on".
3. Open Orca's preferences with Orca+Space. The Orca key is Insert on a desktop layout and CapsLock on some setups; the Orca preferences dialog lets you change it. Turn **Speech, Verbosity** to a level you can follow, and note it.
4. Useful keys: Orca+Z toggles speech, Orca+A toggles focus mode and browse mode where the toolkit allows it, D and Shift+D move between landmarks in browse mode, Orca+F7 and Orca+F5 open the lists of links and form fields where the version supports them (check Orca's own help, F1, if a key does nothing).

Expected: Orca speaks when you Tab around the GNOME panel. If it says nothing at all, fix that before blaming the app.

### LIN-3. Wayland and X11

1. Run LIN-4 to LIN-11 once in a Wayland session and once in an X11 session if the distribution still offers both (the choice is on the login screen, under the gear icon).
2. Note which one you are in: `echo $XDG_SESSION_TYPE`.
3. Things that may differ between the two and are worth a line in the record: whether the window gets keyboard focus when it opens, whether Orca's key echo and global shortcuts work, whether the GTK file chooser opens on top of the app window, and whether Super+Alt+S starts Orca. These are guesses about where the two sessions can differ, not known problems.

Expected: the same steps pass in both, or the differences are written down.

## Checking the AT-SPI tree

### LIN-4. Accerciser

Accerciser shows what the app exposes to assistive technology, before any screen reader interprets it. It is the quickest way to tell "WebKitGTK exposes nothing" apart from "Orca reads it badly".

1. Install it with the distribution's package manager (`accerciser`; it needs an ask first if this is a machine you do not own, as it is a download). Run it from a terminal in the same session as the app.
2. With the app open on Home, expand the tree: the desktop, then an application entry for the app (its name may be the binary name, `CadabraCraft`, or something generic such as a WebKit process name; note what it is), then its window.
3. Find the web content: a node with the role **document web** (or similar) below the window.
4. Below it look for the heading "Write your first book" (role **heading**, with a level in its attributes), the link "Skip to main content", and the buttons **New project**, **Open folder**, **Import…**, **Settings**.
5. Open the **New book** dialog and look for a node with the role **dialog** (or **alert**/**frame**, whichever WebKitGTK uses) named "New book", and the **Title** field with role **entry** and its label.
6. In the editor look for the toolbar (role **tool bar**, name "Formatting") and **Bold** as a **toggle button** with the **pressed** state when Bold is on. Look for **Page text** with role **entry** or **text**, with the **multi line** state.
7. Click a node and use the Interface Viewer plugin: check Name, Role, State set and Attributes.

Expected: the same names, roles and states that [a11y-tree.spec.ts](accessibility.md) snapshots in Chromium. Write down any role or state that differs, and any node that has no name.

If the window shows a **frame** with no children, or no web content node at all, that is the finding "WebKitGTK exposes nothing" mentioned in platform-checks.md: record it with the versions and go to "If nothing is exposed" below instead of running LIN-8 onward.

### LIN-5. Compare with the command line (optional)

If you have a Python with `pyatspi` or a `gdbus` that can reach the accessibility bus, a tree dump gives the same information as Accerciser in text that can be pasted into a record. The exact incantation depends on the distribution; the CI idea below sketches one.

Expected: a text dump matching what Accerciser showed.

## Window and focus

### LIN-6. Window activation and focus

1. Start the app from the launcher (not from the terminal that already has focus). Orca should announce the window title.
2. Press Tab once. Expected: Orca says **Skip to main content**, link (A2 in platform-checks.md). If focus lands on nothing, or on the GTK header bar, record it.
3. Switch to another window with Alt+Tab and back. Expected: Orca announces the app window again and focus returns to the control that had it, not to the top of the page.
4. Open the **New book** dialog (B1), press Escape. Expected: focus returns to **New project** (B4).
5. Activate **Choose…** to open the GTK file chooser. Expected: Orca announces the chooser; Escape closes it and focus returns to **Choose…**.
6. Start the app, then click away to another application before the window finishes drawing and come back. Expected: the window is still the active one for Orca. This is a try, not a known problem.

Expected overall: Orca always knows which window is active, and focus is never "nowhere".

## Reusing the checklist

### LIN-7. The screen reader checklist

Run steps A to M in [platform-checks.md](platform-checks.md) ("Checklist (run it with each screen reader)") with Orca, using the "Test book and setup (all platforms)" there. Do not copy the tables here; record each failure against the original step id. The notes under "Linux: Orca with WebKitGTK" in that file apply (dialog title spoken or only the first control, the exact words for a pressed toggle button, the toolbar arrows, native `<select>`, the GTK file chooser).

Expected: each step passes as defined there. Note that Orca's browse and focus modes decide how a dialog or the **Page text** edit field is read, so repeat D1 to D5 once in each mode and write down what changes.

### LIN-8. Orca specifics worth an extra line each

1. **Dialog announcement.** When **New book** opens, does Orca speak the title, the title and the first control, or only the control? (B1)
2. **Pressed state.** What does Orca say for **Bold** when on and off: "toggle button, pressed", "checked", something else? Write the exact words. (D5, J3)
3. **Live regions.** The notice after **Undo book change** (C4), the Find match count (J2) and export progress (G5) should be spoken without moving focus. If one is silent, note which.
4. **Menu buttons.** **Actions for <chapter>** opens a menu whose items Orca should read, and **Edition: English** should be spoken as a menu button. (E2, E3)
5. **Language.** With a book in a non-English language, does Orca switch voice for **Page text** (D1)? It depends on the speech synthesizer's voices and may legitimately not.

## Appearance checks

### LIN-9. High contrast GTK theme

There is no Windows-style forced colors mode on GNOME. The closest thing is the **High Contrast** GTK theme and the Settings, Accessibility, **High contrast** switch. WebKitGTK may or may not map either to the `forced-colors` or `prefers-contrast` media queries; the app only reacts to those, and its own Theme setting (System, Light, Dark) sets the page colors, not the GTK theme.

1. Turn on Settings, Accessibility, High contrast (or `gsettings set org.gnome.desktop.interface gtk-theme 'HighContrast'`; the theme name differs by distribution, so look at what `gsettings range org.gnome.desktop.interface gtk-theme` or the Appearance settings offer). Restart the app, and note whether it follows the change without a restart.
2. In the web view run `matchMedia('(forced-colors: active)').matches` and `matchMedia('(prefers-contrast: more)').matches` if you have developer tools (a dev build of the app). Record both values. If neither is true, the CSS that the [forced colors spec](accessibility.md) checks will not apply here, and the table in the next step tests what a user gets without it.
3. Go through the Windows contrast table W1 to W14 in platform-checks.md ("Windows forced colors"), judging by the same "Pass when" column. Many rows are about edges and outlines that exist only when forced colors apply; where they are absent, record which rows fail instead of calling them a bug straight away.
4. Repeat steps 1 to 3 with the app's own **Dark** theme under the High Contrast GTK theme, and with Adwaita-dark and the app on **System**.

Expected: text is readable, the focus ring is visible, and the selected, pressed and disabled states are not shown by color alone, with or without the media queries matching.

### LIN-10. Reduced motion

1. Settings, Accessibility, **Reduce animation** on (or `gsettings set org.gnome.desktop.interface enable-animations false`). Restart the app. Whether WebKitGTK passes this to `prefers-reduced-motion` is not known: check `matchMedia('(prefers-reduced-motion: reduce)').matches` as above and record it.
2. Run the "Reduced motion" steps in platform-checks.md (dialogs appear at once, the audiobook spinner does not rotate, the skeleton does not pulse, the Settings jump does not glide).
3. Turn the setting off and check that the same things animate gently.

Expected: if the media query matches, the steps pass; if it does not match, record that WebKitGTK ignored the setting.

### LIN-11. Text scaling

1. Settings, Accessibility, **Text scaling** (GNOME 2.0 is the maximum offered) or `gsettings set org.gnome.desktop.interface text-scaling-factor 2.0`. Restart the app.
2. Note whether the web view's text grew. Whether WebKitGTK follows the GNOME text scaling factor is not known; it may follow only the display scale, or neither.
3. If it follows, or if you zoom the web view in another way (Ctrl and +, if the build allows it), run "200% zoom and 400% reflow" in platform-checks.md on Home, New book, the editor, Export, History, Settings and Read mode.
4. Reset the factor to 1.0 afterwards (`gsettings reset org.gnome.desktop.interface text-scaling-factor`).

Expected: no text is cut off or overlaps and every control stays reachable by keyboard, or the record says the web view ignored the setting.

## Troubleshooting

These are things to try when LIN-4 or LIN-7 shows nothing or silence. Each is a guess from how AT-SPI generally works, and none has been tried with this app.

### If nothing is exposed

- **`NO_AT_BRIDGE`.** If the environment has `NO_AT_BRIDGE=1` (check with `env | grep AT_BRIDGE` in the terminal that starts the app), GTK applications do not connect to the accessibility bus. Start the app with `env -u NO_AT_BRIDGE ./CadabraCraft*.AppImage`, or with `NO_AT_BRIDGE=0`. Some sessions set it on purpose, so also check the launcher's `.desktop` file.
- **`GTK_A11Y`.** GTK 4 reads `GTK_A11Y` (values such as `atspi`, `none` and `test`); GTK 3 has no such variable, and WebKitGTK 4.1 and 6.0 link different GTK versions. Check which the build uses before setting anything. Try `GTK_A11Y=atspi` for a GTK 4 build, and make sure nothing sets it to `none`.
- **`GTK_MODULES` and old bridges.** Some older setups need `GTK_MODULES=gail:atk-bridge` for GTK 3 applications. A current GNOME should not need it; try it only when Accerciser shows the app with no children.
- **Missing `at-spi2-core`.** On a minimal install the accessibility bus launcher may be missing: look for `at-spi-bus-launcher` and `at-spi2-registryd` (`pgrep -a at-spi`; typical locations `/usr/libexec/at-spi-bus-launcher` or `/usr/lib/at-spi2-core/`), and install the distribution's `at-spi2-core` package if they are absent. Orca itself also needs `python3-pyatspi` or the distribution's equivalent, and a speech backend (`speech-dispatcher` with a synthesizer such as `espeak-ng`); if Orca starts but is silent, check that `spd-say hello` speaks.
- **A different session bus.** The accessibility bus address is stored on the session bus: `gdbus call --session --dest org.a11y.Bus --object-path /org/a11y/bus --method org.a11y.Bus.GetAddress` should print an address. If it fails, the session has no accessibility bus, or the terminal is not in the session (for example an `ssh` shell); run the commands from a terminal inside the desktop.
- **AT-SPI bus inside the AppImage.** An AppImage runs in the host session, so it should reach the host's accessibility bus like any other program. What may get in the way is the environment it sets up: `APPDIR`, `LD_LIBRARY_PATH` and a bundled `libatk-bridge` or `libatspi` that is older than the host's `at-spi2-core`, or a bundled `libwebkit2gtk` that does not match the host's GTK. Things to try: start the AppImage with `--appimage-extract` and look in `squashfs-root/usr/lib` for `libatspi*`, `libatk-bridge*` and `libwebkit2gtk*`; run the extracted `AppRun` and compare the tree in Accerciser with a dev build (`pnpm tauri:automate`) on the same machine. If only the AppImage shows nothing, the bundle is the suspect, so record the library list.
- **Sandboxed shells.** Running the app or Orca from a Flatpak, Snap or toolbox terminal can cut it off from the session's accessibility bus. Run both from a plain terminal in the desktop session. Flatpak and Snap packaging are not a release target.
- **Electron-style flags do not apply.** Chromium's `--force-renderer-accessibility` is not a WebKitGTK option, so do not expect it to help.
- **Browse and focus mode.** If Orca reads the page in an odd order, switch focus mode on with Orca+A and repeat the step; this tells apart "the tree is wrong" from "Orca's mode is wrong".

### If the tree is right but Orca is silent or wrong

- Check Orca's own debug output: run `orca --debug-file=/tmp/orca.out` (only if you may write to `/tmp`; otherwise give another path), reproduce the step, and look at which events arrive.
- Compare with the same page in Epiphany (GNOME Web) from the dev server. If Epiphany reads it right and the Tauri window does not, the difference is in how the app window embeds WebKitGTK; if both are wrong, it is the page or WebKitGTK.
- Compare with the web build on Playwright's WebKit with Orca as far as it is reachable; it is the same engine family but not the same build.
- Write down the exact words and the version table of LIN-1 and file it in [roadmap.md](roadmap.md) with the step id.

## CI idea (not built)

Nothing in this section exists in the repository and none of it has been tried. Both parts need tools that are not installed on the development machine or on the CI images as far as this doc knows, so building either needs approval before anything is downloaded (CLAUDE.md: ask before downloading tools or binaries). The existing `webdriver` job in `.github/workflows/ci.yml` and the `webkit-a11y` job already cover part of this ground: see [testing.md](testing.md).

### Idea 1: AT-SPI tree dump of the packaged app

Goal: prove that the packaged Linux app exposes a window, roles and names to AT-SPI, which is what Orca consumes, without a speech engine.

1. A Linux runner with `xvfb`, `dbus-x11` (or `dbus-daemon`), `at-spi2-core` and the packages the app already needs (`libwebkit2gtk-4.1`, `libfuse2` for the AppImage).
2. Run the steps under `xvfb-run` and `dbus-run-session`, so there is a display and a private session bus: `xvfb-run -a dbus-run-session -- bash ci/atspi-smoke.sh`.
3. The script starts the accessibility bus (`/usr/libexec/at-spi-bus-launcher --launch-immediately`, path depending on the distribution) and sets `GTK_MODULES` or `GNOME_ACCESSIBILITY=1` if the runner needs it, then launches the AppImage (with `--appimage-extract-and-run` so FUSE is not needed in a container) and waits for the window.
4. A small script walks the AT-SPI tree and prints it as JSON. Candidates: **dogtail** (a Python library built on `pyatspi`; `dogtail.tree.root.application(...)`), `pyatspi` directly, or plain `gdbus` calls against `org.a11y.atspi.Accessible`. Pick one when the idea is built; `gdbus` needs no Python packages but is more verbose.
5. Assert on the dump: the application and its window exist and the window has a name; a node with role document web exists; Home has a heading "Write your first book" and buttons named **New project**, **Open folder**, **Import…** and **Settings**; after clicking New project (through AT-SPI actions or `xdotool`) a dialog named "New book" with a **Title** entry exists; no node with a button role has an empty name.
6. Upload the dump as an artifact so a failure can be read, and keep the job `continue-on-error: true` until it has run green several times, as with `webdriver`.

Not known until it is tried: whether WebKitGTK exposes the web content to AT-SPI on a runner with no real session, whether Xvfb without a window manager gives the window focus, and whether the roles and names match Orca's expectations. A failure of idea 1 would be evidence for the "nothing is exposed" branch above and would need a person with Orca to confirm.

### Idea 2: tauri-driver and WebKitWebDriver with axe

Goal: run axe inside the real WebKitGTK web view of the built app.

1. Reuse the `webdriver` job set-up: `webkit2gtk-driver` (it provides `WebKitWebDriver`), `cargo install --locked tauri-driver@2.1.0`, `xvfb-run`, and `pnpm --filter @cadabracraft/desktop build:native`.
2. A new spec in `apps/desktop/e2e-native` starts a session through `tauri-driver`, injects `axe.min.js` (from the `axe-core` package already in the repo) with `driver.executeScript`, runs `axe.run` with the same WCAG 2.0 to 2.2 A and AA tags as `a11y.spec.ts` on Home, the New book dialog and the editor, and fails on any violation not listed with a reason.
3. Smoke only: this checks the web content in the native window, not Orca, and it does not replace the person's pass above. The color-contrast rule may need to be skipped if the Xvfb rendering differs.

Not known until it is tried: whether `executeScript` of a large script works through WebKitWebDriver, and whether the existing `e2e-native` specs run green at all (none has run against a real driver, see testing.md).

### Approval needed

Before either idea is built, ask the maintainer to approve downloading and installing: `dogtail` or `pyatspi` (pip or the distribution's package), `at-spi2-core`, `xvfb`, `dbus-x11` and `accerciser`/`orca` on the runner image, and, for idea 2, `webkit2gtk-driver` and `tauri-driver` if they are not already in the job. Record the decision in [architecture.md](architecture.md) with the rejected alternatives (for example the Linux dev machine, or testing only in Playwright's WebKit), using the `/record-decision` skill.

## Record

One row per run; use the ids above and the step ids from platform-checks.md in the notes. Add the line to the "Results" table in platform-checks.md and to the "Manual testing" line in [accessibility.md](accessibility.md) when a row is complete.

| Date | Tester | Distribution, desktop, session (Wayland or X11) | Orca, WebKitGTK and AppImage versions | Id or step | Expected | What was spoken or seen | Pass or fail |
| ---- | ------ | ----------------------------------------------- | ------------------------------------- | ---------- | -------- | ----------------------- | ------------ |
|      |        |                                                 |                                       | LIN-1      |          |                         |              |
|      |        |                                                 |                                       | LIN-2      |          |                         |              |
|      |        |                                                 |                                       | LIN-3      |          |                         |              |
|      |        |                                                 |                                       | LIN-4      |          |                         |              |
|      |        |                                                 |                                       | LIN-5      |          |                         |              |
|      |        |                                                 |                                       | LIN-6      |          |                         |              |
|      |        |                                                 |                                       | LIN-7      |          |                         |              |
|      |        |                                                 |                                       | LIN-8      |          |                         |              |
|      |        |                                                 |                                       | LIN-9      |          |                         |              |
|      |        |                                                 |                                       | LIN-10     |          |                         |              |
|      |        |                                                 |                                       | LIN-11     |          |                         |              |
