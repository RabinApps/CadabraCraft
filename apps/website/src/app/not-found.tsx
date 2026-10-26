export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="font-book text-4xl">Page not found</h1>
      <a href="/" className="text-accent underline underline-offset-4">
        Back to CadabraCraft
      </a>
    </div>
  );
}
