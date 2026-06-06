import { OctagonAlert } from "lucide-react";

export function TopBar({
  technician,
  onAbortAll,
}: {
  technician: string;
  onAbortAll: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-4">
      <div className="flex items-center gap-3">
        <div className="size-2 rounded-full bg-success shadow-[0_0_8px_var(--success)]" />
        <h1 className="text-sm font-semibold tracking-tight text-foreground">
          Technician Workspace
        </h1>
        <span className="text-xs text-muted-foreground">/ AI-assisted Linux IR</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">tech</span>
          <span className="font-mono text-foreground">{technician}</span>
        </div>
        <button
          onClick={onAbortAll}
          className="flex items-center gap-1.5 border border-danger/60 bg-danger/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-danger transition hover:bg-danger/20"
        >
          <OctagonAlert className="size-3.5" />
          Abort all agent activity
        </button>
      </div>
    </header>
  );
}