export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mb-5 h-6 w-48 rounded bg-muted" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-lg bg-muted/60" />
        ))}
      </div>
      <div className="mt-5 h-64 rounded-lg bg-muted/40" />
    </div>
  );
}
