import {
  AlertTriangle,
  Building2,
  Calendar,
  Clock,
  Cpu,
  Hash,
  Network,
  Tag,
  User,
} from "lucide-react";
import type { Priority, Ticket } from "@/lib/workspace/types";
import { Markdown } from "./Markdown";

const priorityCls: Record<Priority, string> = {
  low: "bg-muted text-muted-foreground border-border",
  medium: "bg-info/15 text-info border-info/40",
  high: "bg-warning/15 text-warning border-warning/40",
  critical: "bg-danger/15 text-danger border-danger/50",
};

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toUTCString().replace("GMT", "UTC") : "—";
}

export function TicketInfo({ ticket }: { ticket: Ticket }) {
  const sys = ticket.system;
  return (
    <div className="h-full overflow-y-auto bg-background px-4 py-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <section className="border border-border bg-card">
          <header className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Ticket
          </header>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 px-3 py-3 text-xs sm:grid-cols-2">
            <InfoRow icon={<Hash className="size-3.5" />} label="Ticket code" value={<span className="font-mono">PHX-{ticket.id}</span>} />
            <InfoRow
              icon={<AlertTriangle className="size-3.5" />}
              label="Priority"
              value={
                <span className={`border px-1.5 py-px text-[10px] font-medium uppercase ${priorityCls[ticket.priority]}`}>
                  {ticket.priority}
                </span>
              }
            />
            <InfoRow icon={<Building2 className="size-3.5" />} label="Customer" value={`${ticket.customer_name} (#${ticket.customer_id})`} />
            <InfoRow icon={<Hash className="size-3.5" />} label="Status" value={<span className="font-mono">{ticket.status}</span>} />
            <InfoRow icon={<Calendar className="size-3.5" />} label="Created" value={<span className="font-mono text-[11px]">{fmtDate(ticket.created_at)}</span>} />
            <InfoRow icon={<Clock className="size-3.5" />} label="SLA due" value={<span className="font-mono text-[11px]">{fmtDate(ticket.sla_due_at)}</span>} />
            {ticket.tags && ticket.tags.length > 0 && (
              <InfoRow
                icon={<Tag className="size-3.5" />}
                label="Tags"
                value={
                  <div className="flex flex-wrap gap-1">
                    {ticket.tags.map((t) => (
                      <span key={t} className="rounded bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground">{t}</span>
                    ))}
                  </div>
                }
              />
            )}
          </dl>
          <div className="border-t border-border px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Description</div>
            <Markdown className="mt-1 text-sm leading-relaxed text-foreground/90">{ticket.description}</Markdown>
            <p className="mt-1.5 text-[10px] italic text-muted-foreground">
              Customer-reported symptom only — the actual root cause is determined during diagnosis.
            </p>
          </div>
          {ticket.notes && (
            <div className="border-t border-border px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Notes</div>
              <Markdown className="mt-1 text-sm leading-relaxed text-foreground/90">{ticket.notes}</Markdown>
            </div>
          )}
        </section>

        <section className="border border-border bg-card">
          <header className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Customer System
          </header>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 px-3 py-3 text-xs sm:grid-cols-2">
            <InfoRow icon={<Network className="size-3.5" />} label="IP" value={<span className="font-mono">{sys.ip}</span>} />
            <InfoRow icon={<Network className="size-3.5" />} label="SSH port" value={<span className="font-mono">{sys.port}</span>} />
            <InfoRow icon={<User className="size-3.5" />} label="Username" value={<span className="font-mono">{sys.username}</span>} />
            <InfoRow icon={<Cpu className="size-3.5" />} label="OS" value={sys.os} />
          </dl>
          {sys.notes && (
            <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              <span className="text-[10px] font-semibold uppercase tracking-wider">Notes</span>
              <Markdown className="mt-0.5 text-foreground/90">{sys.notes}</Markdown>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 text-foreground">{value}</dd>
      </div>
    </div>
  );
}