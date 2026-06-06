import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TopBar } from "@/components/workspace/TopBar";
import { TicketQueue, type SortKey } from "@/components/workspace/TicketQueue";
import { IncidentPane } from "@/components/workspace/IncidentPane";
import { ActivityLog } from "@/components/workspace/ActivityLog";
import { ActivitySubmitModal } from "@/components/workspace/ActivitySubmitModal";
import {
  TICKETS as INITIAL_TICKETS,
  buildAgentScript,
  buildFollowupSafer,
  simulatedOutput,
  verifyText,
} from "@/lib/workspace/mockData";
import { checkGuardrail, maskSecrets } from "@/lib/workspace/guardrails";
import type {
  ActivityDraft,
  AgentAction,
  AgentItem,
  LogEntry,
  SshStatus,
  Ticket,
} from "@/lib/workspace/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Technician Workspace — Phoenix ERP AI-assisted Linux IR" },
      {
        name: "description",
        content:
          "Operator console for human-approved, AI-assisted Linux incident resolution over SSH, wired to Phoenix ERP.",
      },
      { property: "og:title", content: "Technician Workspace" },
      {
        property: "og:description",
        content:
          "Operator console for human-approved, AI-assisted Linux incident resolution.",
      },
    ],
  }),
  component: Index,
});

let logSeq = 0;
const makeLog = (e: Omit<LogEntry, "id" | "at">): LogEntry => ({
  id: `log-${Date.now()}-${++logSeq}`,
  at: Date.now(),
  ...e,
});

function Index() {
  const [tickets, setTickets] = useState<Ticket[]>(INITIAL_TICKETS);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [itemsByTicket, setItemsByTicket] = useState<Record<number, AgentItem[]>>({});
  const [terminalByTicket, setTerminalByTicket] = useState<Record<number, string[]>>({});
  const [sshByTicket, setSshByTicket] = useState<Record<number, SshStatus>>({});
  const [ticketStartedAt, setTicketStartedAt] = useState<Record<number, number>>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  const [submitOpen, setSubmitOpen] = useState(false);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const pushLog = useCallback((e: Omit<LogEntry, "id" | "at">) => {
    setLog((prev) => [...prev, makeLog(e)]);
  }, []);

  const schedule = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timersRef.current.delete(t);
      fn();
    }, ms);
    timersRef.current.add(t);
  };

  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current.clear();
    };
  }, []);

  // ─────────── ticket select / agent kickoff ───────────
  const selectTicket = (id: number) => {
    setSelectedId(id);
    const ticket = tickets.find((t) => t.id === id);
    if (!ticket) return;

    if (!ticketStartedAt[id]) {
      setTicketStartedAt((m) => ({ ...m, [id]: Date.now() }));
    }
    pushLog({ ticket_id: id, level: "info", text: `Ticket loaded: ${ticket.title}` });

    if (!sshByTicket[id]) {
      setSshByTicket((s) => ({ ...s, [id]: "Connecting" }));
      pushLog({
        ticket_id: id,
        level: "info",
        text: `SSH connecting to ${ticket.system.username}@${ticket.system.ip}:${ticket.system.port}…`,
      });
      schedule(() => {
        setSshByTicket((s) => ({ ...s, [id]: "Connected" }));
        pushLog({
          ticket_id: id,
          level: "success",
          text: `SSH connected as ${ticket.system.username}@${ticket.customer_name}`,
        });
      }, 900);
    }

    if (!itemsByTicket[id]) {
      const script = buildAgentScript(id);
      script.forEach((item, idx) => {
        schedule(() => {
          setItemsByTicket((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), item] }));
          if (item.kind === "message") {
            pushLog({
              ticket_id: id,
              level: "info",
              text: `Agent: ${item.text.slice(0, 90)}${item.text.length > 90 ? "…" : ""}`,
            });
          } else {
            pushLog({
              ticket_id: id,
              level:
                item.guardrail.level === "blocked"
                  ? "danger"
                  : item.guardrail.level === "caution"
                    ? "warn"
                    : "info",
              text: `Action proposed — guardrail:${item.guardrail.level}${item.guardrail.reason ? ` (${item.guardrail.reason})` : ""}: ${item.command}`,
            });
            pushLog({
              ticket_id: id,
              level: "info",
              text: `Agent paused — awaiting human approval`,
            });
          }
        }, 1400 + idx * 1100);
      });
    }
  };

  // ─────────── action helpers ───────────
  const updateAction = (
    ticketId: number,
    actionId: string,
    patch: (a: AgentAction) => AgentAction,
  ) => {
    setItemsByTicket((prev) => ({
      ...prev,
      [ticketId]: (prev[ticketId] ?? []).map((it) =>
        it.kind === "action" && it.id === actionId ? patch(it) : it,
      ),
    }));
  };

  const appendItem = (ticketId: number, item: AgentItem) => {
    setItemsByTicket((prev) => ({ ...prev, [ticketId]: [...(prev[ticketId] ?? []), item] }));
  };

  const runAction = (ticketId: number, actionId: string) => {
    const items = itemsByTicket[ticketId] ?? [];
    const action = items.find((i) => i.kind === "action" && i.id === actionId) as
      | AgentAction
      | undefined;
    if (!action) return;

    updateAction(ticketId, actionId, (a) => ({ ...a, status: "running", output: [] }));
    pushLog({ ticket_id: ticketId, level: "info", text: `Executing over SSH: ${action.command}` });

    const lines = simulatedOutput(action.command).map(maskSecrets);
    lines.forEach((line, idx) => {
      schedule(() => {
        setTerminalByTicket((prev) => ({
          ...prev,
          [ticketId]: [...(prev[ticketId] ?? []), line],
        }));
        updateAction(ticketId, actionId, (a) => ({ ...a, output: [...a.output, line] }));
        if (idx === lines.length - 1) {
          schedule(() => {
            // Verify step
            const vText = verifyText(ticketId);
            const regressed = /not yet resolved|regress/i.test(vText);
            updateAction(ticketId, actionId, (a) => ({
              ...a,
              status: regressed ? "verified_regressed" : "verified_ok",
              verify_text: vText,
            }));
            pushLog({
              ticket_id: ticketId,
              level: regressed ? "warn" : "success",
              text: `Verify: ${regressed ? "fault not yet resolved — agent looping back to diagnose" : "fix confirmed working"}`,
            });
            if (regressed) {
              const next = buildFollowupSafer(ticketId);
              if (next) {
                schedule(() => {
                  appendItem(ticketId, {
                    id: `m-${Date.now()}`,
                    kind: "message",
                    text: "Looping back to diagnose. Proposing a narrower action.",
                    at: Date.now(),
                  });
                }, 600);
                schedule(() => appendItem(ticketId, next), 1200);
              }
            }
          }, 400);
        }
      }, 280 * (idx + 1));
    });
  };

  // ─────────── approve / edit / reject / abort ───────────
  const handleApprove = (actionId: string, overrideBlocked: boolean) => {
    if (!selectedId) return;
    const items = itemsByTicket[selectedId] ?? [];
    const action = items.find((i) => i.kind === "action" && i.id === actionId) as
      | AgentAction
      | undefined;
    if (!action) return;

    if (action.guardrail.level === "blocked" && !overrideBlocked) {
      pushLog({
        ticket_id: selectedId,
        level: "danger",
        text: `Blocked action approval requires explicit override (refused)`,
      });
      return;
    }
    updateAction(selectedId, actionId, (a) => ({ ...a, status: "approved" }));
    pushLog({
      ticket_id: selectedId,
      level: overrideBlocked ? "danger" : "success",
      text: overrideBlocked
        ? `⚠ Technician OVERRODE guardrail block and approved: ${action.command}`
        : `Action approved by technician${action.edited ? " (edited from original)" : ""}`,
    });
    schedule(() => runAction(selectedId, actionId), 250);
  };

  const handleEdit = (actionId: string, newCommand: string) => {
    if (!selectedId) return;
    const newGuardrail = checkGuardrail(newCommand);
    updateAction(selectedId, actionId, (a) => ({
      ...a,
      command: newCommand,
      edited: newCommand !== a.original_command,
      guardrail: newGuardrail,
    }));
    pushLog({
      ticket_id: selectedId,
      level: newGuardrail.level === "blocked" ? "danger" : "warn",
      text: `Action edited by technician → guardrail:${newGuardrail.level}: ${newCommand}`,
    });
  };

  const handleReject = (actionId: string) => {
    if (!selectedId) return;
    const action = (itemsByTicket[selectedId] ?? []).find(
      (i) => i.kind === "action" && i.id === actionId,
    ) as AgentAction | undefined;
    updateAction(selectedId, actionId, (a) => ({ ...a, status: "rejected" }));
    pushLog({
      ticket_id: selectedId,
      level: "warn",
      text: `Action rejected by technician: ${action?.command ?? actionId}`,
    });
  };

  const handleRetry = (actionId: string) => {
    if (!selectedId) return;
    pushLog({ ticket_id: selectedId, level: "info", text: `Retrying action` });
    setTerminalByTicket((prev) => ({ ...prev, [selectedId]: [] }));
    runAction(selectedId, actionId);
  };

  const handleAbort = (actionId: string) => {
    if (!selectedId) return;
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current.clear();
    updateAction(selectedId, actionId, (a) => ({ ...a, status: "aborted" }));
    pushLog({ ticket_id: selectedId, level: "danger", text: `Action aborted by technician` });
  };

  const handleAbortAll = () => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current.clear();
    setItemsByTicket((prev) => {
      const next: Record<number, AgentItem[]> = {};
      for (const [tid, items] of Object.entries(prev)) {
        next[Number(tid)] = items.map((i) =>
          i.kind === "action" &&
          (i.status === "running" || i.status === "proposed" || i.status === "approved")
            ? { ...i, status: "aborted" as const }
            : i,
        );
      }
      return next;
    });
    pushLog({ level: "danger", text: `GLOBAL ABORT — all agent activity halted` });
  };

  // ─────────── activity draft from running log ───────────
  const selectedTicket = tickets.find((t) => t.id === selectedId) ?? null;
  const items = selectedId ? (itemsByTicket[selectedId] ?? []) : [];
  const terminalLines = selectedId ? (terminalByTicket[selectedId] ?? []) : [];
  const ssh = selectedId ? (sshByTicket[selectedId] ?? "Disconnected") : "Disconnected";

  const draft = useMemo<ActivityDraft | null>(() => {
    if (!selectedTicket) return null;
    return buildDraft(selectedTicket, items, log, ticketStartedAt[selectedTicket.id]);
  }, [selectedTicket, items, log, ticketStartedAt]);

  const handleSubmitActivity = (final: ActivityDraft, markDone: boolean) => {
    if (!selectedTicket) return;
    pushLog({
      ticket_id: selectedTicket.id,
      level: "success",
      text: `POST /api/v1/activities/create → 201 Created (mock)`,
    });
    if (markDone) {
      setTickets((prev) =>
        prev.map((t) => (t.id === selectedTicket.id ? { ...t, status: "DONE" as const } : t)),
      );
      pushLog({
        ticket_id: selectedTicket.id,
        level: "success",
        text: `PATCH /tickets/${selectedTicket.id}/status → DONE (mock)`,
      });
    }
    setSubmitOpen(false);
    // (final draft is what would be POSTed; not persisted in mock)
    void final;
  };

  return (
    <div className="dark flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      <TopBar technician="m.alvarez" onAbortAll={handleAbortAll} />
      <div className="flex min-h-0 flex-1">
        <TicketQueue
          tickets={tickets}
          selectedId={selectedId}
          onSelect={selectTicket}
          loadState="ok"
          sortKey={sortKey}
          onSortChange={setSortKey}
        />
        <IncidentPane
          ticket={selectedTicket}
          items={items}
          ssh={ssh}
          terminalLines={terminalLines}
          onApprove={handleApprove}
          onReject={handleReject}
          onEdit={handleEdit}
          onRetry={handleRetry}
          onAbort={handleAbort}
        />
        <ActivityLog
          entries={log}
          onReview={() => setSubmitOpen(true)}
          canReview={Boolean(selectedTicket)}
        />
      </div>
      {submitOpen && selectedTicket && draft && (
        <ActivitySubmitModal
          ticket={selectedTicket}
          draft={draft}
          onClose={() => setSubmitOpen(false)}
          onSubmit={handleSubmitActivity}
        />
      )}
    </div>
  );
}

// ────────────── draft synthesis ──────────────
function iso(ts: number) {
  return new Date(ts).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function buildDraft(
  ticket: Ticket,
  items: AgentItem[],
  log: LogEntry[],
  startedAt?: number,
): ActivityDraft {
  const ticketLog = log.filter((e) => e.ticket_id === ticket.id);
  const start = startedAt ?? (ticketLog[0]?.at ?? Date.now());
  const end = ticketLog[ticketLog.length - 1]?.at ?? Date.now();

  const actions = items.filter((i): i is AgentAction => i.kind === "action");
  const ranActions = actions.filter(
    (a) => a.status === "succeeded" || a.status === "verified_ok" || a.status === "verified_regressed",
  );
  const messages = items.filter((i) => i.kind === "message").map((m) => (m as { text: string }).text);

  const rootCauseGuess =
    messages.find((t) => /port|conflict|disk|cron|config|permission|inactive|exited/i.test(t)) ??
    "Diagnosed via agent reasoning; see actions taken.";

  const stepsTaken: string[] = [];
  let n = 1;
  for (const item of items) {
    if (item.kind === "message") {
      stepsTaken.push(`${n++}. Diagnosis: ${item.text}`);
    } else if (
      item.status === "succeeded" ||
      item.status === "verified_ok" ||
      item.status === "verified_regressed"
    ) {
      stepsTaken.push(`${n++}. Approved & ran: ${item.command}${item.edited ? " (technician-edited)" : ""}`);
    } else if (item.status === "rejected") {
      stepsTaken.push(`${n++}. Rejected proposal: ${item.command}`);
    } else if (item.status === "aborted") {
      stepsTaken.push(`${n++}. Aborted mid-run: ${item.command}`);
    }
  }

  const commandsSummary = ranActions
    .map((a) => `$ ${a.command}   [guardrail: ${a.guardrail.level}]`)
    .join("\n");

  const verified = actions.find((a) => a.status === "verified_ok");
  const validation = verified?.verify_text ?? "Pending — no successful run yet.";

  const summary = verified
    ? `Restored service on ${ticket.customer_name} for ${ticket.customer_name} (PHX-${ticket.id}).`
    : `Investigation in progress for ${ticket.customer_name} (PHX-${ticket.id}).`;

  return {
    ticket_id: ticket.id,
    start_datetime: iso(start),
    end_datetime: iso(end),
    summary,
    root_cause: rootCauseGuess,
    actions_taken: stepsTaken.join("\n"),
    commands_summary: commandsSummary || "(no commands executed)",
    validation_result: validation,
  };
}