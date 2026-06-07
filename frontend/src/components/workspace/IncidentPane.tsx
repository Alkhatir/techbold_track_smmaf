import { useEffect, useRef, useState } from "react";
import { Cpu, Globe, Send, Server } from "lucide-react";
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
  onToggleBreakpoint,
  onSendChat,
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
  onToggleBreakpoint?: (id: string) => void;
  onSendChat?: (message: string) => void;
}) {
  const [tab, setTab] = useState<"diagnosis" | "terminal" | "info">("diagnosis");
  const [chatDraft, setChatDraft] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const feedEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items]);

  const handleSendChat = async () => {
    const text = chatDraft.trim();
    if (!text || chatSending) return;
    setChatDraft("");
    setChatSending(true);
    try {
      await Promise.resolve(onSendChat?.(text));
    } finally {
      setChatSending(false);
    }
  };

  if (!ticket) {
    return (
      <main className="flex flex-1 items-center justify-center bg-background text-sm text-muted-foreground">
        Select a ticket from the queue to begin.
      </main>
    );
  }

  const sys = ticket.system ?? { ip: "—", port: 22, username: "—", os: "—" };
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

      <div className="min-h-0 flex-1 flex flex-col">
        {tab === "diagnosis" ? (
          <>
            <div className="flex-1 overflow-y-auto px-4 py-4">
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
                  ) : item.kind === "technician_message" ? (
                    <div key={item.id} className="flex gap-3 justify-end">
                      <div className="max-w-[75%] border-r border-info/30 pr-3 text-sm leading-relaxed text-foreground/70 italic text-right">
                        {item.text}
                      </div>
                      <div className="flex size-6 shrink-0 items-center justify-center border border-info/30 bg-info/5 font-mono text-[10px] text-info/70">
                        TC
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
                      onToggleBreakpoint={onToggleBreakpoint ? () => onToggleBreakpoint(item.id) : undefined}
                    />
                  ),
                )}
                <div ref={feedEndRef} />
              </div>
            </div>
            {onSendChat && (
              <div className="shrink-0 border-t border-border bg-card px-4 py-2.5">
                <div className="mx-auto flex max-w-3xl items-center gap-2">
                  <input
                    type="text"
                    value={chatDraft}
                    onChange={(e) => setChatDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSendChat(); } }}
                    placeholder="Ask the agent…"
                    disabled={chatSending}
                    className="flex-1 bg-background border border-border px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-info/60 disabled:opacity-50"
                  />
                  <button
                    onClick={() => void handleSendChat()}
                    disabled={!chatDraft.trim() || chatSending}
                    className="flex items-center gap-1.5 border border-info/60 bg-info/10 px-3 py-1.5 text-xs font-medium text-info hover:bg-info/20 disabled:opacity-40"
                  >
                    <Send className="size-3.5" />
                    {chatSending ? "Sending…" : "Send"}
                  </button>
                </div>
              </div>
            )}
          </>
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