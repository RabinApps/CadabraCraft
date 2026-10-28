# Testing with real sync clients (manual)

The sync rules are covered by automated tests with simulated clients (a stale base hash keeps a `.conflict-` copy, an iCloud placeholder reads as an error, the watcher ignores our own writes). What those tests cannot show is how a real client behaves: when it renames, rewrites modification times, delays downloads or creates its own conflict files. Run this by hand before calling sync supported, one client at a time, on two computers (or one computer plus the client's web or phone app).

Use a throwaway book with three chapters, an image, a cover and a title page. Keep the project folder inside the client's synced folder. Never test with the only copy of a manuscript.

## Checks (repeat for iCloud Drive, Google Drive, Dropbox)

1. **Open and edit.** Open the folder on computer A, type in chapter 1, wait for autosave (2 s) and for the client to finish syncing. Open the same book on computer B: the text is there, and the app shows no conflict notice on either side.
2. **Edit elsewhere while open.** Keep the book open on A with no unsaved typing. Change chapter 2 on B. A reloads chapter 2 on its own (the chapter changes without the cursor jumping to another chapter).
3. **Edit elsewhere with unsaved typing.** On A, type in chapter 1 and do not wait. Change chapter 1 on B and let it sync. On A, the notice says the chapter changed outside the app. Save on A: the other version is kept as `manuscript/001-....conflict-YYYYMMDD-HHMM.json` next to the chapter, and nothing is lost. Check both files.
4. **Manifest conflict.** Rename a chapter on A and a different chapter on B before either syncs. After both sync, `cadabra.json` is valid JSON with one rename, and a `cadabra.conflict-....json` holds the other. If the client made its own "conflicted copy" file instead, note its name: the app never reads it.
5. **Not downloaded yet.** Where the client supports it (iCloud "Remove Download", Google Drive and Dropbox online-only files), make a chapter online-only and open the book. The chapter shows the "still downloading" error and is not shown as empty. After it downloads, opening it works. Saving a different chapter must not touch it.
6. **Cover and assets.** Pick a cover on A. On B, the cover preview and an EPUB export use it. Delete `assets/<cover>` on B before it syncs back: exporting says the cover could not be read and does not leave it out.
7. **Exports and local state.** `exports/` and `.cadabra/` sync like any folder; confirm that exporting on A does not make B reload any chapter (the watcher ignores them), and note whether the client should exclude `.cadabra/` (backups, trash) in its settings.
8. **Quit during sync.** Type, then close the window within a second (the close waits for the save) and confirm the text reached the other computer.

## Record

For each client note the version, the result of every check, any file the client created that the app does not know about, and anything surprising. File problems in `docs/roadmap.md` with the client and the check number.
