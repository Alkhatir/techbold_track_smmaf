import { OctagonAlert, LogOut } from "lucide-react";

import type { BackendEmployee } from "@/lib/api/client";

export function TopBar({
  technician,
  onAbortAll,
  onLogout,
}: {
  technician: BackendEmployee | null;
  onAbortAll: () => void;
  onLogout?: () => void;
}) {
  const fullName = technician
    ? `${technician.firstname} ${technician.lastname}`.trim()
    : "—";

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
          <span className="text-foreground">{fullName}</span>
          {technician && (
            <span className="font-mono text-muted-foreground">
              {technician.username} · {technician.teamname}
            </span>
          )}
        </div>
        <button
          onClick={onAbortAll}
          className="flex items-center gap-1.5 border border-danger/60 bg-danger/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-danger transition hover:bg-danger/20"
        >
          <OctagonAlert className="size-3.5" />
          Abort all agent activity
        </button>
        {onLogout && (
          <button
            onClick={onLogout}
            title="Sign out"
            className="flex items-center gap-1.5 border border-border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <LogOut className="size-3.5" />
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}
