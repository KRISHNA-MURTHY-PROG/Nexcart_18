export default function Loading() {
  return (
    <div className="space-y-5 animate-pulse max-w-2xl">
      <div className="h-7 w-36 rounded-lg bg-muted" />
      <div className="rounded-xl border border-border/40 bg-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-muted" />
          <div className="space-y-2">
            <div className="h-5 w-32 rounded bg-muted" />
            <div className="h-3 w-20 rounded bg-muted/60" />
          </div>
        </div>
        <div className="h-px bg-border/40" />
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex justify-between">
            <div className="h-3.5 w-28 rounded bg-muted" />
            <div className="h-3.5 w-20 rounded bg-muted/60" />
          </div>
        ))}
        <div className="h-11 w-full rounded-xl bg-muted mt-2" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="rounded-xl border border-border/40 bg-card p-5 space-y-3">
            <div className="h-5 w-24 rounded bg-muted" />
            <div className="h-8 w-20 rounded bg-muted" />
            <div className="h-10 w-full rounded-xl bg-muted/60" />
          </div>
        ))}
      </div>
    </div>
  );
}
