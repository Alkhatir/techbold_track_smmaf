import { useState } from "react";
import { Cpu, Globe, Server } from "lucide-react";
import type { AgentItem, SshStatus, Ticket } from "@/lib/workspace/types";
import { ActionCard } from "./ActionCard";
import { Terminal } from "./Terminal";
import { TicketInfo } from "./TicketInfo";

const sshCls: Record<SshStatus, string> = {
  Disconnected: "bg-muted-foreground/20 text-muted-foreground",
  Connecting: "bg-warning/15 text-warning",
  Connected: "bg-success/15 text-success",
};

export function IncidentPane({
  ticket,
  items,
  ssh,
  terminalLines,
  onApprove,
  onReject,
  onEdit,
  onRetry,
  onAbort,
}: {
  ticket: Ticket | null;
  items: AgentItem[];
  ssh: SshStatus;
  terminalLines: string[];
  onApprove: (id: string, overrideBlocked: boolean) => void;
  onReject: (id: string) => void;
  onEdit: (id: string, newCommand: string) => void;
  onRetry: (id: string) => void;
  onAbort: (id: string) => void;
}) {
  const [tab, setTab] = useState<"diagnosis" | "terminal" | "info">("diagnosis");

  if (!ticket) {
    return (
      <main className="flex flex-1 items-center justify-center bg-background text-sm text-muted-foreground">
        Select a ticket from the queue to begin.
      </main>
    );
  }

  const sys = ticket.system;
  const hostLabel = `host-${ticket.id}`;
  const awaiting = items.some((i) => i.kind === "action" && i.status === "proposed");

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-background">
      <div className="border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-muted-foreground">PHX-{ticket.id}</span>
          <h2 className="truncate text-sm font-semibold text-foreground">{ticket.title}</h2>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><Server className="size-3" /> <span className="font-mono">{hostLabel}</span></span>
          <span className="flex items-center gap-1.5"><Cpu className="size-3" /> {sys.os}</span>
          <span className="flex items-center gap-1.5"><Globe className="size-3" /> <span className="font-mono">{sys.ip}:{sys.port}</span></span>
          <span className="ml-auto flex items-center gap-1.5">
            <span className={`flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-medium uppercase ${sshCls[ssh]}`}>
              <span className={`size-1.5 rounded-full ${ssh === "Connected" ? "bg-success" : ssh === "Connecting" ? "bg-warning animate-pulse" : "bg-muted-foreground"}`} />
              ssh: {ssh}
            </span>
          </span>
        </div>
      </div>

      <div className="flex h-9 shrink-0 items-center border-b border-border bg-card">
        <TabBtn active={tab === "diagnosis"} onClick={() => setTab("diagnosis")}>Diagnosis</TabBtn>
        <TabBtn active={tab === "terminal"} onClick={() => setTab("terminal")}>Terminal</TabBtn>
        <TabBtn active={tab === "info"} onClick={() => setTab("info")}>Ticket info</TabBtn>
        {awaiting && (
          <span className="ml-auto mr-3 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-warning">
            <span className="size-1.5 animate-pulse rounded-full bg-warning" />
            agent paused — awaiting approval
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {tab === "diagnosis" ? (
          <div className="h-full overflow-y-auto px-4 py-4">
            <div className="mx-auto flex max-w-3xl flex-col gap-3">
              {items.length === 0 && (
                <div className="text-xs text-muted-foreground">Agent idle.</div>
              )}
              {items.map((item) =>
                item.kind === "message" ? (
                  <div key={item.id} className="flex gap-3">
                    <div className="flex size-6 shrink-0 items-center justify-center border border-info/40 bg-info/10 font-mono text-[10px] text-info">
                      AI
                    </div>
                    <div className="flex-1 border-l border-border pl-3 text-sm leading-relaxed text-foreground/90">
                      {item.text}
                    </div>
                  </div>
                ) : (
                  <ActionCard
                    key={item.id}
                    action={item}
                    onApprove={(override) => onApprove(item.id, override)}
                    onReject={() => onReject(item.id)}
                    onEdit={(cmd) => onEdit(item.id, cmd)}
                    onRetry={() => onRetry(item.id)}
                    onAbort={() => onAbort(item.id)}
                  />
                ),
              )}
            </div>
          </div>
        ) : tab === "terminal" ? (
          <Terminal lines={terminalLines} host={hostLabel} />
        ) : (
          <TicketInfo ticket={ticket} />
        )}
      </div>
    </main>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`relative h-full px-4 text-xs font-medium uppercase tracking-wider transition ${
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
      {active && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-info" />}
    </button>
  );
}