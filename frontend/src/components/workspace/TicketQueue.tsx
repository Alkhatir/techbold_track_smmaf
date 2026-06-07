import { useState } from "react";
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

type StatusFilter = "all" | TicketStatus;
type PriorityFilter = "all" | Priority;
type DateFilter = "all" | "24h" | "7d" | "30d";

// Max age in ms for each window; null = no date constraint.
const dateWindowMs: Record<DateFilter, number | null> = {
  all: null,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const selectCls =
  "flex-1 border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-info";

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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");

  const filtersActive = statusFilter !== "all" || priorityFilter !== "all" || dateFilter !== "all";
  const clearFilters = () => {
    setStatusFilter("all");
    setPriorityFilter("all");
    setDateFilter("all");
  };

  const dateCutoff = dateWindowMs[dateFilter] === null ? null : Date.now() - dateWindowMs[dateFilter]!;

  const filtered = tickets.filter((t) => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
    if (dateCutoff !== null) {
      const created = t.created_at ? new Date(t.created_at).getTime() : 0;
      if (created < dateCutoff) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
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
        <span className="font-mono text-[10px] text-muted-foreground">
          {filtersActive ? `${sorted.length}/${tickets.length}` : "phoenix-erp"}
        </span>
      </div>
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Sort</span>
        <select
          value={sortKey}
          onChange={(e) => onSortChange(e.target.value as SortKey)}
          className={selectCls}
        >
          <option value="date">date (newest)</option>
          <option value="priority">priority</option>
          <option value="status">status</option>
        </select>
      </div>

      <div className="space-y-1.5 border-b border-border px-3 py-1.5">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>Filter</span>
          {filtersActive && (
            <button
              onClick={clearFilters}
              className="font-mono text-[10px] normal-case text-info hover:underline"
            >
              clear
            </button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className={selectCls}
            aria-label="Filter by status"
          >
            <option value="all">status: all</option>
            <option value="OPEN">OPEN</option>
            <option value="PENDING">PENDING</option>
            <option value="DONE">DONE</option>
          </select>
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as PriorityFilter)}
            className={selectCls}
            aria-label="Filter by priority"
          >
            <option value="all">prio: all</option>
            <option value="critical">critical</option>
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as DateFilter)}
            className={selectCls}
            aria-label="Filter by date"
          >
            <option value="all">date: all</option>
            <option value="24h">last 24h</option>
            <option value="7d">last 7d</option>
            <option value="30d">last 30d</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loadState === "auth_error" ? (
          <div className="space-y-1.5 px-3 py-4 text-xs">
            <div className="font-semibold text-danger">⚠ Token invalid</div>
            <p className="text-muted-foreground">
              Phoenix ERP refused the bearer token. Re-authenticate the workspace to load tickets.
            </p>
          </div>
        ) : sorted.length === 0 && filtersActive ? (
          <div className="space-y-2 px-3 py-4 text-xs text-muted-foreground">
            <p>No tickets match the current filters.</p>
            <button onClick={clearFilters} className="text-info hover:underline">
              Clear filters
            </button>
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