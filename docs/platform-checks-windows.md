# Windows: NVDA + WebView2 on the packaged app

Part of the [docs index](README.md). This is the Windows pass of the accessibility checks in [platform-checks.md](platform-checks.md), "Accessibility passes", with the extra steps the packaged Tauri window needs. **Nothing here has been run.** It was written on a Mac with no Windows machine, no NVDA and no WebView2. Every expected result below is a prediction from the existing checklist, not an observation.

The target is in [accessibility.md](accessibility.md). Do not change `tauri.conf.json` while running this: test the build as shipped.

Step ids here use the prefix `WIN-` (for example `WIN-3`). The ids `W1` to `W14` in platform-checks.md are the contrast-theme rows and are reused by reference below, so these steps do not take that prefix.

## Setup

1. Windows 11 22H2 or later on a real machine or a full VM (not a remote session: NVDA and contrast themes behave differently over RDP). Note the build number.
2. An installed build from a release dry run ([release-checklist.md](release-checklist.md)), not `pnpm tauri:automate`. There is no Windows entry in the release matrix yet, so a Windows build may first have to be made by hand. Record how the build was made.
3. Note the WebView2 Runtime version (Settings, Apps, Installed apps, "Microsoft Edge WebView2 Runtime"). Also note whether the machine had it before the install: the installer is configured to embed the bootstrapper.
4. Install the current stable NVDA and note its version. Then set it up:
   - Tools, Speech Viewer on. Paste the lines you rely on into the notes.
   - NVDA key: Insert (or CapsLock).
   - Settings, Browse mode: "Automatically set focus mode for focus changes" on (the default). "Use screen layout" and "Automatic say all on page load" at their defaults.
   - Settings, Speech: default synthesizer, verbosity at the default.
   - Settings, Document formatting: defaults.
5. Build the test book exactly as in platform-checks.md, "Test book and setup (all platforms)". Close the app afterwards, and start every pass below from a fresh launch.
6. Keep your hands off the mouse except where a step says to click. Write down every mouse use.

## Checklist ids reused by reference

Run these as written in platform-checks.md. Do not copy them here. Say what NVDA speaks for each, and use "Windows 11: NVDA with WebView2" in that file for the NVDA specifics.

| Pass                        | Ids in platform-checks.md | When                                       |
| --------------------------- | ------------------------- | ------------------------------------------ |
| Screen reader checklist     | A to M (A1 to M1)         | Once, after WIN-1 to WIN-6 pass            |
| Keyboard only               | KB-1 to KB-10             | Once, with NVDA off                        |
| Forced colors, per theme    | W1 to W14                 | Four times, see "Contrast themes" below    |
| NVDA under a contrast theme | K1 to K3 and W1 to W6     | Once, see "Contrast themes" below          |
| 200% zoom and 400% reflow   | Items 1 to 5              | Combined with "200% display scaling" below |
| Reduced motion              | Items 1 to 5              | Once, with Animation effects off           |

Where A to M says "dialog" and "landmark list", use the NVDA elements list (NVDA+F7) and D, as in the NVDA setup in that file.

## Activation

Background: [tauri-apps/tauri#15624](https://github.com/tauri-apps/tauri/issues/15624) reports that WebView2 content becomes unreadable to a screen reader after the window's activation state changes. It is **one report**. We have not reproduced it, and we do not know which Tauri, WebView2 or NVDA versions it affects. This block exists to find out whether the packaged app is affected.

Do this block with the Home screen open, then again with a book open in the editor with the cursor in **Page text**. Before each action, check once that NVDA reads the page (NVDA+Down) so that a failure is caused by the action and not by an earlier one.

"Still works" means all four of these, after the action:

1. NVDA reads the page (NVDA+Down reads the heading and controls, not silence and not only the window title).
2. Tab moves focus to the next control and NVDA speaks its name and role.
3. NVDA+Space switches between browse mode and focus mode, and NVDA speaks the change.
4. In the editor, typing a letter in **Page text** is echoed and the line can be read (NVDA+Up).

| Id    | Do                                                                                                | Expected                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| WIN-1 | Alt-Tab to another app (Notepad), wait five seconds, Alt-Tab back.                                | The window title is spoken. Still works.                                                                   |
| WIN-2 | Minimise with the window button (or Win+Down), then restore from the taskbar.                     | The window title is spoken. Still works.                                                                   |
| WIN-3 | Click another app's window, then click the CadabraCraft taskbar button.                           | The window title is spoken. Still works. (This is a mouse step; write it down.)                            |
| WIN-4 | Open a native file dialog (**New project**, **Choose…**) and cancel it with Escape.               | Focus returns to **Choose…** or **New project**, and NVDA speaks its name. Still works.                    |
| WIN-5 | Open the same dialog and pick a folder, then return to the app.                                   | The dialog closes, focus lands on a sensible control and NVDA speaks it. Still works.                      |
| WIN-6 | Lock the screen (Win+L), unlock, and return to the window. Then switch virtual desktops and back. | Still works.                                                                                               |
| WIN-7 | Repeat WIN-1 five times in a row without touching anything else.                                  | Still works every time. A failure that shows only after several switches counts as a fail: note the count. |

How to tell a fail apart from a slow update: wait ten seconds and press NVDA+Tab (read focus). If NVDA still says nothing about the page, it is a fail. Record the exact symptom: silent, reads only "CadabraCraft window", reads stale content, or Tab moves with no speech.

### If WIN-1 to WIN-7 fail: a fallback to try, not before

Do **not** apply this pre-emptively, and do not ship it on the strength of one report. It is a workaround from the reporter of issue 15624, not something we have confirmed. Only if an Activation step fails:

1. Write down the failure and the versions (Windows build, WebView2, NVDA, the app build).
2. Make a second build that adds UiaProvider to WebView2's disabled features, for example by setting `additionalBrowserArgs` to `--disable-features=UiaProvider` on the window in `app.windows` in `apps/desktop/src-tauri/tauri.conf.json`. Check the exact syntax against the issue and the Tauri window configuration docs first, because the reporter's flag list may differ, and a second `--disable-features` flag replaces the first one rather than adding to it.
3. Run WIN-1 to WIN-7 again on that build.
4. Then run A to M on it too. Turning off UIA support may change what NVDA can read in other ways, so the workaround must be judged on the whole checklist, not only on activation.
5. Record both results. If it fixes activation and breaks nothing, propose the change in [roadmap.md](roadmap.md) and record the decision with its rejected alternatives in [architecture.md](architecture.md).

If the steps pass on the unmodified build, record that, and leave the config alone.

## Contrast themes

Settings, Accessibility, Contrast themes. Do **Aquatic**, **Desert**, **Dusk** and **Night sky**. Left Alt + Left Shift + Print Screen turns a theme on and off.

| Id     | Do                                                                                   | Expected                                                                                           |
| ------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| WIN-8  | Start the app with no theme, turn a theme on while it is open. Do not restart.       | Record whether the app follows the theme live. It should, but this is unconfirmed.                 |
| WIN-9  | Restart the app under the theme and run W1 to W14 from platform-checks.md.           | Each row passes as written there.                                                                  |
| WIN-10 | With the theme on, turn NVDA on and run K1 to K3 and W1 to W6.                       | NVDA's highlight rectangle and the app's focus ring are both visible, and neither hides the other. |
| WIN-11 | Turn the theme off while the app is open.                                            | The app returns to its own light or dark theme without a restart, or you record that it does not.  |
| WIN-12 | With a theme on, open a native file dialog and the window's system menu (Alt+Space). | Native parts follow the theme. Record any part that does not.                                      |

Do WIN-8 to WIN-12 for the first theme only; for the other three run WIN-9 and WIN-10.

## 200% display scaling

Settings, System, Display, Scale. This is the Windows setting, not the web zoom. Sign out and in if Windows asks.

| Id     | Do                                                                                                                               | Expected                                                                                                          |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| WIN-13 | Set the scale to 200% on a 1920 x 1080 screen (a 960 x 540 layout) and start the app.                                            | The window fits the screen; no control is cut off. Text is sharp (no blurry bitmap scaling).                      |
| WIN-14 | On Home, New book, the editor, Export, History, Settings and Read mode, look for cut-off text, overlap and unreachable controls. | As in platform-checks.md, "200% zoom and 400% reflow", item 1.                                                    |
| WIN-15 | Run A1 to A4, D3 to D5 and E1 to E3 with NVDA.                                                                                   | Same speech as at 100%.                                                                                           |
| WIN-16 | Drag the window to a second monitor at a different scale, if you have one, and back.                                             | The layout redraws without a restart, and NVDA still works (also an Activation check: use WIN-1's "still works"). |
| WIN-17 | Set Accessibility, Text size to 225% and restart the app.                                                                        | Record whether the web view follows it, as in item 2 of platform-checks.md.                                       |

## Narrator smoke pass

Narrator is a second reader, not a second full pass. Turn it on with Win+Ctrl+Enter and turn NVDA off first (two readers at once is not a test). Use Caps Lock as the Narrator key; Caps Lock+Space toggles scan mode.

| Id     | Do                                                      | Expected                                                                                        |
| ------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| WIN-18 | Launch the app. Run A1 to A4.                           | Title, **Write your first book** or **Your books**, **Skip to main content**, then the buttons. |
| WIN-19 | Run B1 to B4 (New book dialog, Escape).                 | Dialog named **New book**; focus stays inside; Escape returns to **New project**.               |
| WIN-20 | Open a book. Run C1, C2 and D1 to D5.                   | Landmarks, the header, **Page text** as an edit area and **Bold** as a pressed toggle.          |
| WIN-21 | Run the Activation steps WIN-1 and WIN-2 with Narrator. | Still works. A fail here that NVDA does not show is a UIA issue, so record it.                  |
| WIN-22 | Run G1 to G3 (Export dialog).                           | **Format** group, one selected, **PDF/UA (accessible)** with its state.                         |

Record anything Narrator says differently from NVDA, but do not file wording differences as bugs. A silent control, a missing name or a lost focus is a bug.

## Magnifier

Win and Plus turns Magnifier on, Win and Esc turns it off. Use the Lens view at 300% first, then Full screen at 200%. Settings, Accessibility, Magnifier, "Follow the keyboard focus" and "Follow the text insertion point" on.

| Id     | Do                                                                              | Expected                                                                                            |
| ------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| WIN-23 | Tab through Home, then through the New book dialog.                             | The view follows focus; the focus ring is never behind the Magnifier lens edge.                     |
| WIN-24 | Type a paragraph in **Page text**.                                              | The view follows the caret, and the caret stays visible. This depends on the web view reporting it. |
| WIN-25 | Open a menu (**Actions for …**) and the command palette (Ctrl+K).               | The view moves to the menu or the palette.                                                          |
| WIN-26 | Turn on a contrast theme and Magnifier's "Invert colors" (Ctrl+Alt+I) together. | Everything stays readable; record anything that vanishes.                                           |

## Native pieces

These are outside the web view, so the web-based checks do not cover them.

| Id     | Do                                                                                                                                           | Expected                                                                                                                       |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| WIN-27 | Launch the app and listen to the first thing NVDA says. Check the title in the title bar, the taskbar and Alt-Tab.                           | The title is **CadabraCraft** (from `tauri.conf.json`) everywhere. Record any difference, for example an empty or stale title. |
| WIN-28 | Open a book, then another. Check the title again.                                                                                            | Record whether the title changes with the book (the config sets a fixed title, so it may not). That is a note, not a fail.     |
| WIN-29 | Open the native pickers: New project **Choose…**, Add cover, Import. Tab through each dialog and read it with NVDA.                          | The dialog title and its first control are spoken; Escape cancels; focus returns to the button that opened it (see WIN-4).     |
| WIN-30 | Use the window's own controls with the keyboard: Alt+Space opens the system menu with Restore, Move, Size, Minimize, Maximize, Close.        | NVDA speaks the items. Close from it does not lose unsaved work (the **Saved** badge was shown first).                         |
| WIN-31 | Trigger anything that may raise a notification or a message box: an update check with a newer version, an export finishing, a failed export. | Search the app for native notifications first. If there are none, write "none" and skip. Otherwise NVDA speaks each one.       |
| WIN-32 | Close the app with Alt+F4 while NVDA is on.                                                                                                  | NVDA does not stay stuck on a dead window; the next app is read.                                                               |

## Optional: Guidepup NVDA against the packaged window

**Unproven, and it needs approval before anything is downloaded.** The macOS suite drives VoiceOver on the web build in WebKit ([accessibility.md](accessibility.md), "Real VoiceOver"). Guidepup also has an NVDA driver for Windows. Whether it can drive the WebView2 window of the packaged Tauri app is not known, and no code for it exists in this repository.

What would be needed, none of it done:

1. Approval from the repository owner to download NVDA (a portable copy or the installer) and the Guidepup Windows packages (`@guidepup/guidepup` and `@guidepup/nvda`, with `@guidepup/setup`), per the rule in CLAUDE.md to ask before downloading tools or binaries. State the filenames, sources and sizes when asking.
2. A Windows machine where the setup may change NVDA settings and register a speech capture.
3. A way to attach to the packaged window: Guidepup's NVDA driver speaks to NVDA, not to the web view, so a test would start the installed app, wait for the window title with NVDA and then step with NVDA's own keys. It could not use Playwright's page locators, and Tauri has no WebDriver in this project (see "Not planned for 1.0" in platform-checks.md).
4. A first experiment limited to WIN-1 to WIN-7: launch the app, read the Home heading, Alt-Tab away and back, read it again, and fail if NVDA's last phrase is empty. If that cannot be made reliable in an afternoon, drop it and keep this pass manual.

Do not add this to `pnpm a11y` or to CI. Like the VoiceOver suite it would take over the keyboard and the speaker.

## Record

Blank. One row per step and tester. Use the ids above in the notes, plus the ids from platform-checks.md for the reused passes.

| Date | Tester | Windows build | WebView2 | NVDA | App build | Step id | Pass or fail | Spoken or seen (exact words, symptom) |
| ---- | ------ | ------------- | -------- | ---- | --------- | ------- | ------------ | ------------------------------------- |
|      |        |               |          |      |           |         |              |                                       |
|      |        |               |          |      |           |         |              |                                       |
|      |        |               |          |      |           |         |              |                                       |
|      |        |               |          |      |           |         |              |                                       |

Summary by area (fill in when the area is done):

| Area                                     | Steps                      | Result | Notes |
| ---------------------------------------- | -------------------------- | ------ | ----- |
| Activation                               | WIN-1 to WIN-7             |        |       |
| Activation with the fallback (if needed) | WIN-1 to WIN-7 and A to M  |        |       |
| Contrast themes                          | WIN-8 to WIN-12, W1 to W14 |        |       |
| 200% display scaling                     | WIN-13 to WIN-17           |        |       |
| Narrator                                 | WIN-18 to WIN-22           |        |       |
| Magnifier                                | WIN-23 to WIN-26           |        |       |
| Native pieces                            | WIN-27 to WIN-32           |        |       |
| NVDA screen reader checklist             | A to M                     |        |       |
| Guidepup NVDA (optional)                 | WIN-1 to WIN-7             |        |       |

File each failure in [roadmap.md](roadmap.md) with the step id, the reader and its version, what was spoken and what should have been. When an area is complete, update the "Manual testing" line in [accessibility.md](accessibility.md) and the Record table in [platform-checks.md](platform-checks.md).
