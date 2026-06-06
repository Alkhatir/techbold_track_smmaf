import { ClipboardCheck } from "lucide-react";
import type { LogEntry } from "@/lib/workspace/types";

const lvlCls = {
  info: "text-info",
  warn: "text-warning",
  danger: "text-danger",
  success: "text-success",
} as const;

function fmt(at: number) {
  return new Date(at).toTimeString().slice(0, 8);
}

export function ActivityLog({
  entries,
  onReview,
  canReview,
}: {
  entries: LogEntry[];
  onReview: () => void;
  canReview: boolean;
}) {
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-card">
      <div className="flex h-9 items-center justify-between border-b border-border px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Audit Trail
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">{entries.length} events</span>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {entries.length === 0 ? (
          <div className="text-xs text-muted-foreground">No activity yet.</div>
        ) : (
          <ol className="space-y-1.5">
            {entries.map((e) => (
              <li key={e.id} className="font-mono text-[11.5px] leading-snug">
                <span className="text-muted-foreground">{fmt(e.at)}</span>{" "}
                <span className={lvlCls[e.level]}>●</span>{" "}
                {typeof e.ticket_id === "number" && (
                  <span className="text-muted-foreground">[PHX-{e.ticket_id}]</span>
                )}{" "}
                <span className="text-foreground/90">{e.text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="border-t border-border p-2">
        <button
          onClick={onReview}
          disabled={!canReview}
          className="flex w-full items-center justify-center gap-1.5 border border-info/60 bg-info/10 px-2.5 py-1.5 text-xs font-medium text-info hover:bg-info/20 disabled:opacity-40"
        >
          <ClipboardCheck className="size-3.5" />
          Review &amp; submit activity
        </button>
      </div>
    </aside>
  );
}