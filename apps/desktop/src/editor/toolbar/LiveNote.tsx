/** A plain live region for a message with no visible control. Not `role="status"`: the page already has one status (Saved) that specs and readers look for. */
export function LiveNote({ text }: { text: string }) {
  return (
    <div aria-live="polite" className="sr-only">
      {text}
    </div>
  );
}
