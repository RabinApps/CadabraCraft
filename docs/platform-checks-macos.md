# macOS checks that need a person

Part of the WCAG 2.2 AA target in [accessibility.md](accessibility.md). This file adds the macOS-only checks that [platform-checks.md](platform-checks.md) does not cover. **Nothing below has been run.** It was written without a Mac in front of the author, no packaged build was opened with VoiceOver, and no step has an observed result yet.

## macOS: VoiceOver on the packaged app

### What the Guidepup suite already covers (do not repeat it)

`pnpm --filter @cadabracraft/desktop test:voiceover` (see [accessibility.md](accessibility.md), "Real VoiceOver") drives the real VoiceOver through Guidepup. Its 48 areas walk Home, the editor landmarks and toolbar, typing, all the dialogs, the chapter menu, Find, Read mode, Settings, the other export panels, snapshots, trash, references, editions and focus mode, and check the names, roles and states VoiceOver speaks. So a tester does not need to walk the checklist in [platform-checks.md](platform-checks.md) (A to L) line by line just to see whether a name or a role is present on the web build.

It cannot drive the Tauri window, for these reasons:

- Guidepup starts VoiceOver and then talks to a browser that Playwright launched. The suite runs against the web build in Playwright's WebKit, which is a separate browser process, not the app's WKWebView inside a `.app` bundle.
- Playwright has no driver for a Tauri window (Tauri has no WebDriver for macOS because there is no WKWebView driver, see [Tauri WebDriver docs](https://tauri.app/develop/tests/webdriver)). The suite therefore cannot launch the packaged app, click in it or read its DOM.
- Guidepup's helper that moves VoiceOver into web content (`navigateToWebContent`) expects a browser window. It hangs when a modal dialog is open, and a second call in one run stalled, so even in WebKit the suite works around it.
- It reads only what Guidepup records (`lastSpokenPhrase`). Arrow keys and `readNextLine` record no phrase, and live-region speech is not reliably observable. It does not hear how speech sounds, and it does not see the menu bar, the window chrome, the native dialogs or the system display settings.

What stays with a person is below. Everything in A to L of [platform-checks.md](platform-checks.md) still needs one pass on the packaged app, because the suite ran on a different engine host; here that pass is only a spot check (MAC-3).

### Setup

1. Build the packaged app (a release dry run, or `pnpm tauri build` and open the `.app`; not `pnpm tauri:automate`, not the dev server in Safari). Write down the build, the macOS version, and the Mac (Apple silicon or Intel).
2. Create the test book "SR Book" with the steps in "Test book and setup" in [platform-checks.md](platform-checks.md). For MAC-8 the chapter must also hold a scene break with a paragraph and a definition list or task list after it.
3. VoiceOver on with Cmd+F5. Turn it off between sections where a step says so.
4. Keep the mouse alone, except where a step says to use it.
5. The ids here are `MAC-1` to `MAC-25`, so they do not clash with the step ids in [platform-checks.md](platform-checks.md) (for example M1 in "M. Right-to-left interface").

"Expected" is what must be true for the step to pass. Wording differs with the verbosity setting. Write what you heard in the Record table, word for word.

### 1. Focus and the web content

Two WebKit bugs are the reason for this section: [bug 182752](https://bugs.webkit.org/show_bug.cgi?id=182752) and [bug 60661](https://bugs.webkit.org/show_bug.cgi?id=60661). They may no longer occur on the current macOS; they are listed because a WKWebView that does not take VoiceOver focus is the first thing that would break the app for a blind user. Do not assume either is still open. If the step passes, say so in the table.

| Id    | Do                                                                                                                          | Expected                                                                                                                                                                                                                 |
| ----- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MAC-1 | With VoiceOver on, quit the app, then launch it. Do nothing else. Listen, then press VO+Right once.                         | VoiceOver reads the window title and lands on the web content (A1 in [platform-checks.md](platform-checks.md): the heading "Write your first book" or "Your books"). It must not stay on the window frame or on nothing. |
| MAC-2 | Press VO+Shift+Down (interact with the web area) if MAC-1 stopped on the window. Note it as a fail for MAC-1 and continue.  | Recorded only; a fail here means VoiceOver needs a manual step to enter the page.                                                                                                                                        |
| MAC-3 | Run A1 to A4 and C1 to C2 from [platform-checks.md](platform-checks.md) once, as a spot check on the packaged app.          | The same names, roles and states as in that file. Record any difference from what the Guidepup run reports for the web build.                                                                                            |
| MAC-4 | In the editor, put the VO cursor in **Page text**. Press Cmd+Tab to another app, wait three seconds, press Cmd+Tab back.    | The app window is announced. The VO cursor returns to the web content (ideally the text you left), not to the window frame. Typing a letter goes into the text.                                                          |
| MAC-5 | Repeat MAC-4 from an open dialog (**Add link**).                                                                            | After Cmd+Tab back, VoiceOver is still inside the dialog and Escape closes it with focus on the **Link** button.                                                                                                         |
| MAC-6 | Click on another app's window, then click on this app's window title bar (mouse allowed), then press VO+Right.              | VoiceOver reads from the web content, not from the window frame; the VO cursor is not lost.                                                                                                                              |
| MAC-7 | Open the app with a book open from a previous run (the last project reopens), and with VoiceOver on from before the launch. | As MAC-1; the editor's first spoken item is the book title (heading level 1) or **Page text**. Record which.                                                                                                             |

### 2. The three open human checks from the Guidepup suite

These are the things the suite could not confirm. Do them in the packaged app, in the "SR Book" chapter.

| Id     | Do                                                                                                                                                                                                                                                                 | Expected                                                                                                                                                                                                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MAC-8  | **Text after a scene break.** Insert a **Scene break** (toolbar). Type two paragraphs after it, then a task list or a definition list. VO+Right and the arrow keys through the break and beyond it.                                                                | You can reach and hear the paragraphs and the list after the break with VO+Right, VO+Left and the arrow keys; VoiceOver does not jump out of the text to the status bar. The break itself is spoken as a separator or similar. Record the exact words and where it stopped, if it did. |
| MAC-9  | Re-enter **Page text** from outside (Tab from the sidebar) after the break exists, and press VO+A (read all).                                                                                                                                                      | Reading continues past the scene break to the end of the chapter. If it reads only up to the caret line, record it: that matches the limit the automation found.                                                                                                                       |
| MAC-10 | **Inserted image description.** Insert an image with the description "A red door" (D7 and D8 in [platform-checks.md](platform-checks.md)). Move the VO cursor onto the picture in the editor itself.                                                               | VoiceOver says "image" and the description, plus the caption as figure text. It is not the file name and not silence. Do it with the picture selected and not selected; record both.                                                                                                   |
| MAC-11 | Insert a second image marked **This image is decorative** and move onto it.                                                                                                                                                                                        | Skipped, or "image" with no description. Never the file name. This is D11 on the packaged app; the Guidepup run checks only the dialog.                                                                                                                                                |
| MAC-12 | **Spoken live-region messages.** With VoiceOver on, do each action and listen without moving the VO cursor: type a word and wait for **Saved**; **Undo book change** after adding a chapter; run **Export** to EPUB 3; type a find word that occurs twice (Cmd+F). | Each is spoken once, in the words from the checklist ("Saved"; "Undid: …"; "Reading your chapters…", "Building EPUB…", "Exported …"; the match count). Nothing is spoken twice, nothing interrupts typing, and the VO cursor stays where it was. A failed export is an alert.          |
| MAC-13 | Trigger an alert: **Add link** with the address `ftp://x`, and **Insert** an image with no description.                                                                                                                                                            | The alert text ("That address can't be used as a link.", the image message) is spoken at once, and focus stays in the field.                                                                                                                                                           |

If MAC-12 is silent for one of them, record which message and whether the VO verbosity for live regions (VoiceOver Utility, Verbosity, Announcements) was set to speak them.

### 3. Display settings

Run each with VoiceOver off. System Settings, Accessibility, Display. Change one setting at a time, look at Home, the editor, Export and Settings, then put it back. These are the system's settings, so the author changes them by hand; none of these steps is automated, and the app must follow each without a restart (note it if it does not).

| Id     | Do                                                                                                                                      | Expected                                                                                                                                                                                                             |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MAC-14 | Turn **Increase contrast** on.                                                                                                          | Borders and the selected chapter row, pressed toolbar toggle, **Write**/**Read** switch, badges and the focus ring stay distinguishable. This matches the `prefers-contrast: more` emulation; record any difference. |
| MAC-15 | Turn **Reduce motion** on, then run the "Reduced motion" list in [platform-checks.md](platform-checks.md).                              | Dialogs and the command palette appear at once; the Settings jump does not glide; the audiobook spinner does not rotate (skip that item if no voice is installed). Turn it off: the animations come back.            |
| MAC-16 | Turn **Reduce transparency** on.                                                                                                        | Menus, dialogs and the Find bar stay readable and keep their edges; nothing relied on a blurred or see-through backdrop for contrast.                                                                                |
| MAC-17 | System Settings, Displays: pick the largest **More Space** and the largest **Larger Text** resolution available, then the opposite end. | The window still fits; no clipped text or hidden control; Tab still reaches everything. Compare with 200% zoom and 400% reflow in [platform-checks.md](platform-checks.md).                                          |
| MAC-18 | Raise Safari or system text size if the build follows it (System Settings, Accessibility, Display, **Text size**, where offered).       | Note whether the web view follows it. The app need not follow it, but the record should say what happened.                                                                                                           |
| MAC-19 | Turn on **Differentiate without color** (if listed) and look at **Saved**/**Unsaved**, the history comparison and the Image checks.     | Meaning comes through words or shapes, not only color. The app does not read this setting; this only confirms the design.                                                                                            |

### 4. Accessibility Inspector pass

Accessibility Inspector comes with Xcode (Xcode, Open Developer Tool, Accessibility Inspector). It is already installed by Xcode if the author builds the app; the pass does not ask to download anything. Point it at the app with the target picker, in the packaged build.

| Id     | Do                                                                                                                                      | Expected                                                                                                                                                                                                                         |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MAC-20 | **Window.** Select the window in the Inspector and read its Basic and Advanced sections.                                                | Title is the app name (and the book while one is open), role is Window, and it has a close, minimize and zoom button with names. Record the title on Home and in the editor.                                                     |
| MAC-21 | **Menu bar.** Select the app menu, File, Edit, Format, View, Window, Help; open each with the Inspector pointer or VO+M.                | Every menu item has a title; disabled items say so; every shortcut shown is the one that works (Cmd+K, Cmd+F, Cmd+, and so on). No item is an unnamed "menu item". Keyboard: VO+M opens the menu bar and arrows move through it. |
| MAC-22 | **Web area.** Select the page text and the toolbar in the Inspector.                                                                    | A web area, **Page text** with role text area (multi-line), and a toolbar named **Formatting** with named buttons. This is a spot check of the same tree the Guidepup suite reads.                                               |
| MAC-23 | Run **Audit** in the Inspector on Home, the editor and one dialog.                                                                      | Record every finding. Audit results for web content may be noisy; copy the exact message and the element. Findings about the window chrome or menu bar are the most interesting.                                                 |
| MAC-24 | **Native open and save dialogs.** Use **Open folder**, **Choose…** (New book), Import, Add cover and an Export save. With VoiceOver on. | The sheet is announced; its fields (Save As, Where, file list, Cancel, Open/Save) are named; the Tags/format popup is reachable; Cmd+Shift+G and Escape work; focus returns to the button that opened it.                        |
| MAC-25 | In the same native dialogs, Tab and Shift+Tab with the Inspector pointing at the focused control.                                       | The focus order is the system's own and has no trap. Record if the app does not take focus back after the dialog closes (compare with the Linux file chooser note in [platform-checks.md](platform-checks.md)).                  |

### Record

One row per step or range, per tester and per build. Write the macOS version, the build, and what was spoken.

| Step   | Tester | macOS version | Build | Pass or fail | What was spoken or seen (words) | Notes |
| ------ | ------ | ------------- | ----- | ------------ | ------------------------------- | ----- |
| MAC-1  |        |               |       |              |                                 |       |
| MAC-2  |        |               |       |              |                                 |       |
| MAC-3  |        |               |       |              |                                 |       |
| MAC-4  |        |               |       |              |                                 |       |
| MAC-5  |        |               |       |              |                                 |       |
| MAC-6  |        |               |       |              |                                 |       |
| MAC-7  |        |               |       |              |                                 |       |
| MAC-8  |        |               |       |              |                                 |       |
| MAC-9  |        |               |       |              |                                 |       |
| MAC-10 |        |               |       |              |                                 |       |
| MAC-11 |        |               |       |              |                                 |       |
| MAC-12 |        |               |       |              |                                 |       |
| MAC-13 |        |               |       |              |                                 |       |
| MAC-14 |        |               |       |              |                                 |       |
| MAC-15 |        |               |       |              |                                 |       |
| MAC-16 |        |               |       |              |                                 |       |
| MAC-17 |        |               |       |              |                                 |       |
| MAC-18 |        |               |       |              |                                 |       |
| MAC-19 |        |               |       |              |                                 |       |
| MAC-20 |        |               |       |              |                                 |       |
| MAC-21 |        |               |       |              |                                 |       |
| MAC-22 |        |               |       |              |                                 |       |
| MAC-23 |        |               |       |              |                                 |       |
| MAC-24 |        |               |       |              |                                 |       |
| MAC-25 |        |               |       |              |                                 |       |

File each failure in [roadmap.md](roadmap.md) with the step id, the macOS version, the build, what was spoken and what should have been. When a row is complete, update the "Manual testing" line in [accessibility.md](accessibility.md) and add a row to the Record table in [platform-checks.md](platform-checks.md).
