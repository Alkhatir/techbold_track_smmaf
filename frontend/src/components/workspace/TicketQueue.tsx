import type { Priority, QueueLoadState, Ticket, TicketStatus } from "@/lib/workspace/types";

const priorityCls: Record<Priority, string> = {
  low: "bg-muted text-muted-foreground border-border",
  medium: "bg-info/15 text-info border-info/40",
  high: "bg-warning/15 text-warning border-warning/40",
  critical: "bg-danger/15 text-danger border-danger/50",
};
const priorityRank: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const statusRank: Record<TicketStatus, number> = { OPEN: 0, PENDING: 1, DONE: 2 };

const statusCls: Record<TicketStatus, string> = {
  OPEN: "text-warning",
  PENDING: "text-info",
  DONE: "text-success",
};

export type SortKey = "date" | "priority" | "status";

export function TicketQueue({
  tickets,
  selectedId,
  onSelect,
  loadState,
  sortKey,
  onSortChange,
}: {
  tickets: Ticket[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  loadState: QueueLoadState;
  sortKey: SortKey;
  onSortChange: (k: SortKey) => void;
}) {
  const sorted = [...tickets].sort((a, b) => {
    if (sortKey === "priority") return priorityRank[a.priority] - priorityRank[b.priority];
    if (sortKey === "status") return statusRank[a.status] - statusRank[b.status];
    return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
  });

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex h-9 items-center justify-between border-b border-border px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Ticket Queue
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">phoenix-erp</span>
      </div>
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Sort</span>
        <select
          value={sortKey}
          onChange={(e) => onSortChange(e.target.value as SortKey)}
          className="flex-1 border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-info"
        >
          <option value="date">date (newest)</option>
          <option value="priority">priority</option>
          <option value="status">status</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loadState === "auth_error" ? (
          <div className="space-y-1.5 px-3 py-4 text-xs">
            <div className="font-semibold text-danger">⚠ Token invalid</div>
            <p className="text-muted-foreground">
              Phoenix ERP refused the bearer token. Re-authenticate the workspace to load tickets.
            </p>
          </div>
        ) : loadState === "empty" || sorted.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">No tickets assigned.</div>
        ) : (
          sorted.map((t) => {
            const active = t.id === selectedId;
            return (
              <button
                key={t.id}
                onClick={() => onSelect(t.id)}
                className={`block w-full border-b border-border px-3 py-2.5 text-left transition ${
                  active ? "bg-accent" : "hover:bg-accent/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-muted-foreground">PHX-{t.id}</span>
                  <span className={`border px-1.5 py-px text-[10px] font-medium uppercase ${priorityCls[t.priority]}`}>
                    {t.priority}
                  </span>
                </div>
                <div className="mt-1 line-clamp-2 text-sm leading-snug text-foreground">{t.title}</div>
                <div className="mt-1.5 flex items-center justify-between text-[11px]">
                  <span className="truncate text-muted-foreground">{t.customer_name}</span>
                  <span className={`font-mono ${statusCls[t.status]}`}>● {t.status}</span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}