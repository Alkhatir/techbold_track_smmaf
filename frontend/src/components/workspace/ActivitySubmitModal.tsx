import { useState } from "react";
import { Send, X } from "lucide-react";
import type { ActivityDraft, Ticket } from "@/lib/workspace/types";

export function ActivitySubmitModal({
  ticket,
  draft,
  onClose,
  onSubmit,
}: {
  ticket: Ticket;
  draft: ActivityDraft;
  onClose: () => void;
  onSubmit: (final: ActivityDraft, markDone: boolean) => void;
}) {
  const [d, setD] = useState<ActivityDraft>(draft);
  const [markDone, setMarkDone] = useState(true);

  const set = <K extends keyof ActivityDraft>(k: K, v: ActivityDraft[K]) =>
    setD((p) => ({ ...p, [k]: v }));

  const Field = ({
    label,
    field,
    rows = 2,
    placeholder,
  }: {
    label: string;
    field: keyof ActivityDraft;
    rows?: number;
    placeholder?: string;
  }) => (
    <label className="block">
      <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono text-[10px] text-muted-foreground/70">{String(field)}</span>
      </div>
      <textarea
        value={(d[field] as string) ?? ""}
        onChange={(e) => set(field, e.target.value as ActivityDraft[typeof field])}
        rows={rows}
        placeholder={placeholder}
        className="block w-full resize-y border border-border bg-background px-2 py-2 font-mono text-[13px] leading-relaxed text-foreground focus:outline-none focus:ring-1 focus:ring-info"
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              POST /api/v1/activities/create — review before submit
            </div>
            <div className="font-mono text-xs text-foreground">
              PHX-{ticket.id} · {ticket.customer_name}
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto px-4 py-3 sm:grid-cols-2">
          <div className="space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              ticket_id
            </div>
            <div className="border border-border bg-muted px-2 py-1.5 font-mono text-[12px]">{d.ticket_id}</div>
          </div>
          <div className="space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              window
            </div>
            <div className="border border-border bg-muted px-2 py-1.5 font-mono text-[11px] leading-snug">
              <div>start: {d.start_datetime}</div>
              <div>end:&nbsp;&nbsp;{d.end_datetime}</div>
            </div>
          </div>
          <div className="sm:col-span-2"><Field label="Summary (one sentence — what was restored)" field="summary" rows={3} placeholder="Restored …" /></div>
          <div className="sm:col-span-2"><Field label="Root cause (technical — not the symptom)" field="root_cause" rows={3} /></div>
          <div className="sm:col-span-2"><Field label="Actions taken (diagnosis + fix, in order)" field="actions_taken" rows={7} /></div>
          <div className="sm:col-span-2"><Field label="Commands summary (no secrets in output)" field="commands_summary" rows={6} /></div>
          <div className="sm:col-span-2"><Field label="Validation result (concrete proof the service works)" field="validation_result" rows={3} /></div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={markDone}
              onChange={(e) => setMarkDone(e.target.checked)}
              className="accent-info"
            />
            Also PATCH /tickets/{d.ticket_id}/status → <span className="font-mono text-success">DONE</span>
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={() => onSubmit(d, markDone)}
              className="flex items-center gap-1.5 border border-info/60 bg-info/15 px-3 py-1 text-xs font-medium text-info hover:bg-info/25"
            >
              <Send className="size-3.5" /> Submit activity
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}