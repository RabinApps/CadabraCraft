export type ChangeKind = "New" | "Improved" | "Info";

export type ChangelogEntry = {
  version: string;
  label: string;
  changes: readonly { kind: ChangeKind; text: string }[];
};

// Release notes live on GitHub Releases once a release exists; this page mirrors them.
export const changelog: readonly ChangelogEntry[] = [
  {
    version: "Unreleased",
    label: "Next release",
    changes: [
      {
        kind: "New",
        text: "Language editions: keep one book in several languages and export each one.",
      },
      { kind: "New", text: "M4B audiobook export with chapters." },
      {
        kind: "Improved",
        text: "Chapter history, backups and a recovery offer when a newer copy is found.",
      },
    ],
  },
  {
    version: "Early development",
    label: "No packaged release yet",
    changes: [
      {
        kind: "Info",
        text: "Build from source today. Installers will be published on GitHub Releases.",
      },
    ],
  },
];
