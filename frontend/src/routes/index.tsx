import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { TopBar } from "@/components/workspace/TopBar";
import { TicketQueue, type SortKey } from "@/components/workspace/TicketQueue";
import { IncidentPane } from "@/components/workspace/IncidentPane";
import { ActivityLog } from "@/components/workspace/ActivityLog";
import { ActivitySubmitModal } from "@/components/workspace/ActivitySubmitModal";
import {
  TICKETS as INITIAL_TICKETS,
  buildAgentScript,
  buildAnalysis,
  buildFollowupSafer,
  simulatedOutput,
  verifyText,
} from "@/lib/workspace/mockData";
import { checkGuardrail, maskSecrets } from "@/lib/workspace/guardrails";
import {
  api,
  analysisToItem,
  auditEventToLogEntry,
  commandResultToLines,
  connectSessionWs,
  fixPlanToItems,
  proposedCommandToAction,
  type BackendActivityDraft,
  type BackendAuditEvent,
  type BackendCommandResult,
  type BackendProposedCommand,
  type BackendTicketSession,
  type WsHandlers,
} from "@/lib/api/client";
import type {
  ActivityDraft,
  AgentAction,
  AgentItem,
  LogEntry,
  QueueLoadState,
  SshStatus,
  SystemInfo,
  Ticket,
  TechnicianMessage,
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

const PLACEHOLDER_SYSTEM: SystemInfo = { ip: "—", port: 22, username: "—", os: "Loading…" };

let logSeq = 0;
const makeLog = (e: Omit<LogEntry, "id" | "at">): LogEntry => ({
  id: `log-${Date.now()}-${++logSeq}`,
  at: Date.now(),
  ...e,
});

function Index() {
  const { technician, isAuthenticated, loading: authLoading, logout } = useAuth();
  const navigate = useNavigate();

  // Gate the workspace behind a (one-button) login.
  useEffect(() => {
    if (!authLoading && !isAuthenticated) void navigate({ to: "/login" });
  }, [authLoading, isAuthenticated, navigate]);

  const handleLogout = useCallback(() => {
    logout();
    void navigate({ to: "/login" });
  }, [logout, navigate]);

  const [tickets, setTickets] = useState<Ticket[]>(INITIAL_TICKETS);
  const [loadState, setLoadState] = useState<QueueLoadState>("loading");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [itemsByTicket, setItemsByTicket] = useState<Record<number, AgentItem[]>>({});
  const [terminalByTicket, setTerminalByTicket] = useState<Record<number, string[]>>({});
  const [sshByTicket, setSshByTicket] = useState<Record<number, SshStatus>>({});
  const [ticketStartedAt, setTicketStartedAt] = useState<Record<number, number>>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [sessionIdByTicket, setSessionIdByTicket] = useState<Record<number, string>>({});
  const [activityDraftByTicket, setActivityDraftByTicket] = useState<Record<number, BackendActivityDraft>>({});
  const [generatingActivity, setGeneratingActivity] = useState(false);

  // Track whether we're in real-backend mode per ticket
  const backendModeRef = useRef<Record<number, boolean>>({});
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const wsRef = useRef<Record<number, WebSocket>>({});

  // WebSocket handlers stored in a ref so closures in ws.onmessage always call latest version
  const wsHandlersRef = useRef<Record<number, WsHandlers>>({});

  // ─── push log helper ───────────────────────────────────────────────────────
  const pushLog = useCallback((e: Omit<LogEntry, "id" | "at">) => {
    setLog((prev) => [...prev, makeLog(e)]);
  }, []);

  // ─── action helpers ────────────────────────────────────────────────────────
  const updateAction = useCallback(
    (ticketId: number, actionId: string, patch: (a: AgentAction) => AgentAction) => {
      setItemsByTicket((prev) => ({
        ...prev,
        [ticketId]: (prev[ticketId] ?? []).map((it) =>
          it.kind === "action" && it.id === actionId ? patch(it) : it,
        ),
      }));
    },
    [],
  );

  const appendItem = useCallback((ticketId: number, item: AgentItem) => {
    setItemsByTicket((prev) => ({ ...prev, [ticketId]: [...(prev[ticketId] ?? []), item] }));
  }, []);

  const appendItems = useCallback((ticketId: number, items: AgentItem[]) => {
    setItemsByTicket((prev) => ({ ...prev, [ticketId]: [...(prev[ticketId] ?? []), ...items] }));
  }, []);

  // Append proposed-command actions, skipping any whose id is already present.
  // Both the HTTP analyze/propose-fix response and the WebSocket
  // `pending_command` broadcast deliver the same commands, so dedup by id keeps
  // them from showing up twice.
  const appendActions = useCallback((ticketId: number, actions: AgentAction[]) => {
    setItemsByTicket((prev) => {
      const existing = prev[ticketId] ?? [];
      const seen = new Set(existing.filter((i) => i.kind === "action").map((i) => i.id));
      const toAdd = actions.filter((a) => !seen.has(a.id));
      if (toAdd.length === 0) return prev;
      return { ...prev, [ticketId]: [...existing, ...toAdd] };
    });
  }, []);

  const replaceItem = useCallback((ticketId: number, itemId: string, next: AgentItem) => {
    setItemsByTicket((prev) => ({
      ...prev,
      [ticketId]: (prev[ticketId] ?? []).map((it) => (it.id === itemId ? next : it)),
    }));
  }, []);

  const removeItem = useCallback((ticketId: number, itemId: string) => {
    setItemsByTicket((prev) => ({
      ...prev,
      [ticketId]: (prev[ticketId] ?? []).filter((it) => it.id !== itemId),
    }));
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
      Object.values(wsRef.current).forEach((ws) => ws.close());
    };
  }, []);

  // ─── load tickets from backend once authenticated ─────────────────────────
  useEffect(() => {
    if (!isAuthenticated) return;
    setLoadState("loading");
    api.tickets
      .list()
      .then((backendTickets) => {
        if (backendTickets.length > 0) {
          setTickets(
            backendTickets.map((t) => ({
              ...t,
              priority: t.priority as Ticket["priority"],
              status: t.status as Ticket["status"],
              system: PLACEHOLDER_SYSTEM,
            })),
          );
          setLoadState("ok");
        } else {
          setLoadState("empty");
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (/401|403|unauthorized|forbidden/i.test(msg)) {
          setLoadState("auth_error");
        } else {
          // Backend unavailable — keep mock data, demo mode
          setLoadState("ok");
        }
      });
  }, [isAuthenticated]);

  // ─── WebSocket event handlers (updated via ref so they always see fresh state) ─
  useEffect(() => {
    for (const [tidStr, handlers] of Object.entries(wsHandlersRef.current)) {
      const tid = Number(tidStr);
      handlers.onSessionUpdate = (session: BackendTicketSession) => {
        const newSsh: SshStatus =
          session.state === "connected" ||
          session.state === "diagnosing" ||
          session.state === "fix_pending_approval" ||
          session.state === "fixing" ||
          session.state === "validating" ||
          session.state === "activity_ready"
            ? "Connected"
            : session.state === "connection_pending_approval"
              ? "Connecting"
              : "Disconnected";
        setSshByTicket((s) => ({ ...s, [tid]: newSsh }));
        if (session.error_message) {
          pushLog({ ticket_id: tid, level: "danger", text: `Session error: ${session.error_message}` });
        }
      };
      handlers.onAuditEvent = (evt: BackendAuditEvent) => {
        const entry = auditEventToLogEntry(evt);
        setLog((prev) => {
          // Avoid duplicate log entries (WebSocket may echo what we already logged)
          if (prev.some((e) => e.id === entry.id)) return prev;
          return [...prev, entry];
        });
      };
      handlers.onCommandResult = (result: BackendCommandResult) => {
        const lines = commandResultToLines(result);
        setTerminalByTicket((prev) => ({
          ...prev,
          [tid]: [...(prev[tid] ?? []), ...lines],
        }));
        updateAction(tid, result.id, (a) => ({
          ...a,
          status: result.exit_code === 0 ? "succeeded" : "failed",
          output: lines,
        }));
      };
      handlers.onPendingCommand = (cmd: BackendProposedCommand) => {
        const action = proposedCommandToAction(cmd);
        setItemsByTicket((prev) => {
          // Don't add duplicates if we already added it via HTTP response
          if ((prev[tid] ?? []).some((i) => i.kind === "action" && i.id === action.id)) return prev;
          return { ...prev, [tid]: [...(prev[tid] ?? []), action] };
        });
      };
      handlers.onActivityDraft = (draft: BackendActivityDraft) => {
        setActivityDraftByTicket((prev) => ({ ...prev, [tid]: draft }));
      };
    }
  }); // runs every render — keeps handlers current

  // ─── real session startup ─────────────────────────────────────────────────
  const startRealSession = async (id: number, ticket: Ticket) => {
    setSshByTicket((s) => ({ ...s, [id]: "Connecting" }));

    // Create session (ERP fetch happens in backend)
    const session = await api.sessions.create(id);
    const sessionId = session.id;
    setSessionIdByTicket((m) => ({ ...m, [id]: sessionId }));

    // Update ticket with real system info
    if (session.customer_system) {
      const sys = session.customer_system.system;
      const realSystem: SystemInfo = {
        ip: sys.ip,
        port: sys.port,
        username: sys.username,
        os: sys.os,
        notes: sys.notes,
      };
      setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, system: realSystem } : t)));
      pushLog({
        ticket_id: id,
        level: "info",
        text: `SSH connecting to ${sys.username}@${sys.ip}:${sys.port}…`,
      });
    }

    // Wire up WebSocket with a handler object we can update via ref
    const handlers: WsHandlers = {};
    wsHandlersRef.current[id] = handlers;
    const ws = connectSessionWs(sessionId, {
      onSessionUpdate: (s) => wsHandlersRef.current[id]?.onSessionUpdate?.(s),
      onAuditEvent: (e) => wsHandlersRef.current[id]?.onAuditEvent?.(e),
      onCommandResult: (r) => wsHandlersRef.current[id]?.onCommandResult?.(r),
      onPendingCommand: (c) => wsHandlersRef.current[id]?.onPendingCommand?.(c),
      onActivityDraft: (d) => wsHandlersRef.current[id]?.onActivityDraft?.(d),
    });
    wsRef.current[id] = ws;

    // Approve connection
    pushLog({ ticket_id: id, level: "info", text: "Requesting SSH connection approval…" });
    const connResult = await api.sessions.approveConnection(sessionId, true);
    if (connResult.status !== "connected") {
      setSshByTicket((s) => ({ ...s, [id]: "Disconnected" }));
      pushLog({ ticket_id: id, level: "danger", text: "SSH connection rejected or failed" });
      return;
    }

    const sys = session.customer_system?.system;
    setSshByTicket((s) => ({ ...s, [id]: "Connected" }));
    pushLog({
      ticket_id: id,
      level: "success",
      text: `SSH connected as ${sys?.username ?? "—"}@${ticket.customer_name}`,
    });

    // Kick off agent analysis. Show a live "analyzing" card immediately so the
    // technician can see the agent working in the background before any command.
    pushLog({ ticket_id: id, level: "info", text: "Starting AI analysis…" });
    const analyzingId = `analysis-${id}-${Date.now()}`;
    appendItem(id, { id: analyzingId, kind: "analysis", pending: true, hypotheses: [], at: Date.now() });

    let analysis, pending_commands;
    try {
      ({ analysis, pending_commands } = await api.agent.analyze(sessionId));
    } catch (err) {
      removeItem(id, analyzingId);
      throw err;
    }

    // Replace the placeholder with the structured initial analysis
    replaceItem(id, analyzingId, analysisToItem(analysis, analyzingId));

    // Show proposed commands (deduped against any WebSocket broadcast)
    if (pending_commands.length > 0) {
      appendActions(id, pending_commands.map(proposedCommandToAction));
      pushLog({
        ticket_id: id,
        level: "info",
        text: `Agent proposed ${pending_commands.length} command(s) — awaiting approval`,
      });
    } else {
      pushLog({ ticket_id: id, level: "info", text: "Analysis complete — no commands proposed" });
    }
  };

  // ─── ticket select / agent kickoff ────────────────────────────────────────
  const selectTicket = (id: number) => {
    setSelectedId(id);
    const ticket = tickets.find((t) => t.id === id);
    if (!ticket) return;

    if (!ticketStartedAt[id]) {
      setTicketStartedAt((m) => ({ ...m, [id]: Date.now() }));
    }
    pushLog({ ticket_id: id, level: "info", text: `Ticket loaded: ${ticket.title}` });

    // Don't recreate a session if we already started one for this ticket
    if (sessionIdByTicket[id] || itemsByTicket[id]) return;

    startRealSession(id, ticket).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      pushLog({ ticket_id: id, level: "danger", text: `Backend error (${msg}) — falling back to demo mode` });
      // Fall back to mock
      backendModeRef.current[id] = false;
      runMockSession(id, ticket);
    });
  };

  // ─── mock fallback session ────────────────────────────────────────────────
  const runMockSession = (id: number, ticket: Ticket) => {
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

    // Show the agent "analyzing" in the background, then reveal its findings —
    // before any command is proposed.
    const analyzingId = `analysis-${id}-${Date.now()}`;
    schedule(() => {
      appendItem(id, { id: analyzingId, kind: "analysis", pending: true, hypotheses: [], at: Date.now() });
      pushLog({ ticket_id: id, level: "info", text: "Agent analyzing the problem and environment…" });
    }, 1100);
    schedule(() => {
      replaceItem(id, analyzingId, buildAnalysis(id));
      pushLog({ ticket_id: id, level: "info", text: "Initial analysis ready" });
    }, 2600);

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
            text: `Action proposed — guardrail:${item.guardrail.level}: ${item.command}`,
          });
          pushLog({ ticket_id: id, level: "info", text: "Agent paused — awaiting human approval" });
        }
      }, 3200 + idx * 1100);
    });
  };

  // ─── mock command execution (fallback only) ───────────────────────────────
  const runMockAction = (ticketId: number, actionId: string) => {
    const items = itemsByTicket[ticketId] ?? [];
    const action = items.find((i) => i.kind === "action" && i.id === actionId) as AgentAction | undefined;
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
              text: `Verify: ${regressed ? "fault not yet resolved — looping back" : "fix confirmed working"}`,
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

  // ─── approve / reject / edit / abort ─────────────────────────────────────
  const handleApprove = async (actionId: string, overrideBlocked: boolean) => {
    if (!selectedId) return;
    const items = itemsByTicket[selectedId] ?? [];
    const action = items.find((i) => i.kind === "action" && i.id === actionId) as AgentAction | undefined;
    if (!action) return;

    if (action.guardrail.level === "blocked" && !overrideBlocked) {
      pushLog({
        ticket_id: selectedId,
        level: "danger",
        text: "Blocked action approval requires explicit override (refused)",
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

    const sessionId = sessionIdByTicket[selectedId];
    if (!sessionId) {
      schedule(() => runMockAction(selectedId, actionId), 250);
      return;
    }

    try {
      updateAction(selectedId, actionId, (a) => ({ ...a, status: "running", output: [] }));
      pushLog({ ticket_id: selectedId, level: "info", text: `Executing over SSH: ${action.command}` });

      const result = await api.sessions.approveCommand(sessionId, actionId, {
        approved: true,
        edited_command: action.edited ? action.command : undefined,
      });

      if ("exit_code" in result) {
        const cr = result as BackendCommandResult;
        const lines = commandResultToLines(cr);
        setTerminalByTicket((prev) => ({
          ...prev,
          [selectedId]: [...(prev[selectedId] ?? []), ...lines],
        }));
        updateAction(selectedId, actionId, (a) => ({
          ...a,
          status: cr.exit_code === 0 ? "succeeded" : "failed",
          output: lines,
        }));
        pushLog({
          ticket_id: selectedId,
          level: cr.exit_code === 0 ? "success" : "danger",
          text:
            cr.exit_code === 0
              ? `Command succeeded (${cr.duration_seconds.toFixed(1)}s)`
              : `Command failed — exit ${cr.exit_code}`,
        });
      }
    } catch (err: unknown) {
      updateAction(selectedId, actionId, (a) => ({ ...a, status: "failed" }));
      pushLog({
        ticket_id: selectedId,
        level: "danger",
        text: `Command execution failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
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

  const handleReject = async (actionId: string) => {
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

    const sessionId = sessionIdByTicket[selectedId];
    if (sessionId) {
      await api.sessions
        .approveCommand(sessionId, actionId, { approved: false })
        .catch(() => {/* already updated local state */});
    }
  };

  const handleRetry = (actionId: string) => {
    if (!selectedId) return;
    pushLog({ ticket_id: selectedId, level: "info", text: "Retrying action" });
    setTerminalByTicket((prev) => ({ ...prev, [selectedId]: [] }));
    void handleApprove(actionId, false);
  };

  const handleAbort = (actionId: string) => {
    if (!selectedId) return;
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current.clear();
    updateAction(selectedId, actionId, (a) => ({ ...a, status: "aborted" }));
    pushLog({ ticket_id: selectedId, level: "danger", text: "Action aborted by technician" });
  };

  const handleAbortAll = () => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current.clear();

    // Abort all real sessions
    for (const [tidStr, sessionId] of Object.entries(sessionIdByTicket)) {
      void api.sessions.abort(sessionId).catch(() => {});
      const ws = wsRef.current[Number(tidStr)];
      if (ws) {
        ws.close();
        delete wsRef.current[Number(tidStr)];
      }
    }

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
    pushLog({ level: "danger", text: "GLOBAL ABORT — all agent activity halted" });
  };

  // ─── breakpoint toggle ────────────────────────────────────────────────────
  const handleToggleBreakpoint = (actionId: string) => {
    if (!selectedId) return;
    updateAction(selectedId, actionId, (a) => ({ ...a, breakpoint: !a.breakpoint }));
  };

  // ─── chat with agent ──────────────────────────────────────────────────────
  const handleChat = async (message: string) => {
    if (!selectedId) return;
    const techMsg: TechnicianMessage = {
      id: `tc-${Date.now()}`,
      kind: "technician_message",
      text: message,
      at: Date.now(),
    };
    appendItem(selectedId, techMsg);
    const sessionId = sessionIdByTicket[selectedId];
    if (!sessionId) {
      schedule(() => {
        appendItem(selectedId, {
          id: `m-chat-${Date.now()}`,
          kind: "message",
          text: `(Demo) You asked: "${message}". Connect to a real session for AI responses.`,
          at: Date.now(),
        });
      }, 700);
      return;
    }
    try {
      const resp = await api.agent.chat(sessionId, message);
      appendItem(selectedId, {
        id: `m-chat-${Date.now()}`,
        kind: "message",
        text: resp.message,
        at: Date.now(),
      });
    } catch {
      appendItem(selectedId, {
        id: `m-chat-err-${Date.now()}`,
        kind: "message",
        text: "Chat is not yet available on this backend version.",
        at: Date.now(),
      });
    }
  };

  // ─── propose fix ──────────────────────────────────────────────────────────
  const handleProposeFix = async () => {
    if (!selectedId) return;
    const sessionId = sessionIdByTicket[selectedId];
    if (!sessionId) return;

    pushLog({ ticket_id: selectedId, level: "info", text: "Requesting fix proposal from agent…" });
    try {
      const { fix_plan, pending_commands } = await api.agent.proposeFix(sessionId);
      appendItems(selectedId, fixPlanToItems(fix_plan));
      if (pending_commands.length > 0) {
        appendActions(selectedId, pending_commands.map(proposedCommandToAction));
        pushLog({
          ticket_id: selectedId,
          level: "info",
          text: `Fix plan ready — ${pending_commands.length} command(s) proposed`,
        });
      }
    } catch (err: unknown) {
      pushLog({
        ticket_id: selectedId,
        level: "danger",
        text: `Fix proposal failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  // ─── activity draft / submit ──────────────────────────────────────────────
  const selectedTicket = tickets.find((t) => t.id === selectedId) ?? null;
  const items = selectedId ? (itemsByTicket[selectedId] ?? []) : [];
  const terminalLines = selectedId ? (terminalByTicket[selectedId] ?? []) : [];
  const ssh = selectedId ? (sshByTicket[selectedId] ?? "Disconnected") : "Disconnected";
  const sessionId = selectedId ? sessionIdByTicket[selectedId] : undefined;

  const mockDraft = useMemo<ActivityDraft | null>(() => {
    if (!selectedTicket) return null;
    return buildDraft(selectedTicket, items, log, ticketStartedAt[selectedTicket.id]);
  }, [selectedTicket, items, log, ticketStartedAt]);

  const draft: ActivityDraft | null =
    selectedId && activityDraftByTicket[selectedId]
      ? backendDraftToFrontend(activityDraftByTicket[selectedId])
      : mockDraft;

  const handleOpenReview = async () => {
    if (!selectedId || !sessionId) {
      setSubmitOpen(true);
      return;
    }
    // Generate activity from backend before opening modal
    setGeneratingActivity(true);
    try {
      const backendDraft = await api.agent.generateActivity(sessionId);
      setActivityDraftByTicket((prev) => ({ ...prev, [selectedId]: backendDraft }));
    } catch {
      // Fall back to client-side draft
    } finally {
      setGeneratingActivity(false);
    }
    setSubmitOpen(true);
  };

  const handleSubmitActivity = async (final: ActivityDraft, markDone: boolean) => {
    if (!selectedTicket) return;

    if (sessionId) {
      // If there's a backend session and a backend draft, submit via API
      if (activityDraftByTicket[selectedTicket.id]) {
        try {
          await api.agent.submitActivity(sessionId);
          pushLog({
            ticket_id: selectedTicket.id,
            level: "success",
            text: "Activity submitted to Phoenix ERP",
          });
        } catch (err: unknown) {
          pushLog({
            ticket_id: selectedTicket.id,
            level: "danger",
            text: `Activity submission failed: ${err instanceof Error ? err.message : String(err)}`,
          });
          setSubmitOpen(false);
          return;
        }
      }
    } else {
      pushLog({
        ticket_id: selectedTicket.id,
        level: "success",
        text: "POST /api/v1/activities/create → 201 Created (demo)",
      });
    }

    if (markDone) {
      setTickets((prev) =>
        prev.map((t) => (t.id === selectedTicket.id ? { ...t, status: "DONE" as const } : t)),
      );
      pushLog({
        ticket_id: selectedTicket.id,
        level: "success",
        text: `Ticket ${selectedTicket.id} marked DONE`,
      });
    }
    setSubmitOpen(false);
    void final;
  };

  // Determine whether "Propose Fix" is available: real session + some commands have been executed
  const canProposeFix =
    Boolean(sessionId) &&
    (itemsByTicket[selectedId ?? -1] ?? []).some(
      (i) => i.kind === "action" && (i.status === "succeeded" || i.status === "failed"),
    );

  // While auth is resolving or a redirect to /login is in flight, render nothing.
  if (authLoading || !isAuthenticated) return null;

  return (
    <div className="dark flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      <TopBar technician={technician} onAbortAll={handleAbortAll} onLogout={handleLogout} />
      <div className="flex min-h-0 flex-1">
        <TicketQueue
          tickets={tickets}
          selectedId={selectedId}
          onSelect={selectTicket}
          loadState={loadState}
          sortKey={sortKey}
          onSortChange={setSortKey}
        />
        <IncidentPane
          ticket={selectedTicket}
          items={items}
          ssh={ssh}
          terminalLines={terminalLines}
          onApprove={(id, override) => void handleApprove(id, override)}
          onReject={(id) => void handleReject(id)}
          onEdit={handleEdit}
          onRetry={handleRetry}
          onAbort={handleAbort}
          onToggleBreakpoint={handleToggleBreakpoint}
          onSendChat={(msg) => void handleChat(msg)}
        />
        <ActivityLog
          entries={log}
          onReview={() => void handleOpenReview()}
          canReview={Boolean(selectedTicket)}
          onProposeFix={canProposeFix ? () => void handleProposeFix() : undefined}
          generatingActivity={generatingActivity}
        />
      </div>
      {submitOpen && selectedTicket && draft && (
        <ActivitySubmitModal
          ticket={selectedTicket}
          draft={draft}
          onClose={() => setSubmitOpen(false)}
          onSubmit={(final, done) => void handleSubmitActivity(final, done)}
        />
      )}
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function backendDraftToFrontend(d: BackendActivityDraft): ActivityDraft {
  return {
    ticket_id: d.ticket_id,
    start_datetime: d.start_datetime,
    end_datetime: d.end_datetime,
    summary: d.summary,
    root_cause: d.root_cause,
    actions_taken: d.actions_taken,
    commands_summary: d.commands_summary,
    validation_result: d.validation_result,
  };
}

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
    (a) =>
      a.status === "succeeded" || a.status === "verified_ok" || a.status === "verified_regressed",
  );
  const messages = items.filter((i) => i.kind === "message").map((m) => (m as { text: string }).text);
  const analysisTexts = items
    .filter((i): i is Extract<AgentItem, { kind: "analysis" }> => i.kind === "analysis")
    .flatMap((a) => [
      a.ticket_summary,
      ...a.hypotheses.map((h) => `${h.title}: ${h.description}`),
    ])
    .filter((t): t is string => Boolean(t));

  const rootCauseGuess =
    [...analysisTexts, ...messages].find((t) =>
      /port|conflict|disk|cron|config|permission|inactive|exited/i.test(t),
    ) ?? "Diagnosed via agent reasoning; see actions taken.";

  const stepsTaken: string[] = [];
  let n = 1;
  for (const item of items) {
    if (item.kind === "analysis") {
      if (item.ticket_summary) stepsTaken.push(`${n++}. Initial analysis: ${item.ticket_summary}`);
      for (const h of item.hypotheses) {
        stepsTaken.push(`${n++}. Hypothesis: ${h.title} — ${h.description}`);
      }
    } else if (item.kind === "message") {
      stepsTaken.push(`${n++}. Diagnosis: ${item.text}`);
    } else if (
      item.status === "succeeded" ||
      item.status === "verified_ok" ||
      item.status === "verified_regressed"
    ) {
      stepsTaken.push(
        `${n++}. Approved & ran: ${item.command}${item.edited ? " (technician-edited)" : ""}`,
      );
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
