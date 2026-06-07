import type { AgentAction, AgentItem, Guardrail, LogEntry } from "@/lib/workspace/types";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8000";

// ─── backend wire types ────────────────────────────────────────────────────

export interface BackendTicket {
  id: number;
  title: string;
  description: string;
  priority: string;
  status: "OPEN" | "PENDING" | "DONE";
  customer_id: number;
  customer_name: string;
  tags: string[];
  sla_due_at: string | null;
  created_at: string | null;
}

export interface BackendSystemInfo {
  ip: string;
  port: number;
  username: string;
  os: string;
  notes?: string;
  key_path?: string;
}

export interface BackendCustomerSystem {
  ticket_id: number;
  customer_id: number;
  system: BackendSystemInfo;
}

export type RiskLevel =
  | "read_only"
  | "service_restart"
  | "low_change"
  | "package_change"
  | "needs_manual_review"
  | "blocked";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "blocked";

export type SessionState =
  | "created"
  | "system_loaded"
  | "connection_pending_approval"
  | "connected"
  | "diagnosing"
  | "fix_pending_approval"
  | "fixing"
  | "validating"
  | "activity_ready"
  | "submitted"
  | "aborted"
  | "error";

export interface BackendProposedCommand {
  id: string;
  command: string;
  reason: string;
  risk: RiskLevel;
  expected_result: string;
  requires_approval: boolean;
  blocked: boolean;
  block_reason: string | null;
  approval_status: ApprovalStatus;
  technician_note: string | null;
}

export interface BackendCommandResult {
  id: string;
  command: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
  duration_seconds: number;
  timestamp: string;
  risk: RiskLevel;
  redacted: boolean;
}

export interface BackendHypothesis {
  title: string;
  description: string;
  confidence: string;
  supporting_evidence: string[];
  next_check: string;
}

export interface BackendAgentAnalysis {
  ticket_summary: string;
  affected_component?: string;
  hypotheses: BackendHypothesis[];
  proposed_commands: object[];
}

export interface BackendFixPlan {
  root_cause: string;
  evidence: string[];
  needs_more_diagnostics: boolean;
  additional_diagnostic_commands: object[];
  fix_commands: object[];
  validation_commands: object[];
}

export interface BackendActivityDraft {
  ticket_id: number;
  start_datetime: string;
  end_datetime: string;
  summary: string;
  root_cause: string;
  actions_taken: string;
  commands_summary: string;
  validation_result: string;
  description?: string;
}

export interface BackendAuditEvent {
  id: string;
  ticket_id: string;
  session_id: string;
  actor: string;
  event_type: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

export interface BackendTicketSession {
  id: string;
  ticket_id: number;
  ticket?: BackendTicket;
  customer_system?: BackendCustomerSystem;
  state: SessionState;
  connection_approved: boolean;
  pending_commands: BackendProposedCommand[];
  executed_commands: BackendCommandResult[];
  analysis?: BackendAgentAnalysis;
  fix_plan?: BackendFixPlan;
  activity_draft?: BackendActivityDraft;
  created_at: string;
  started_at?: string;
  error_message?: string;
}

// ─── type converters ──────────────────────────────────────────────────────────

export function riskToGuardrail(risk: RiskLevel, blocked: boolean): Guardrail {
  if (blocked) return { level: "blocked" };
  switch (risk) {
    case "read_only":
    case "low_change":
      return { level: "safe" };
    case "service_restart":
    case "package_change":
    case "needs_manual_review":
      return { level: "caution" };
    case "blocked":
      return { level: "blocked" };
    default:
      return { level: "caution" };
  }
}

export function proposedCommandToAction(cmd: BackendProposedCommand): AgentAction {
  return {
    id: cmd.id,
    kind: "action",
    command: cmd.command,
    original_command: cmd.command,
    edited: false,
    explanation: cmd.reason,
    expected: cmd.expected_result,
    guardrail: riskToGuardrail(cmd.risk, cmd.blocked),
    status: "proposed",
    output: [],
    at: Date.now(),
  };
}

export function analysisToItems(analysis: BackendAgentAnalysis): AgentItem[] {
  const items: AgentItem[] = [];
  let seq = Date.now();

  if (analysis.ticket_summary) {
    items.push({ id: `m-sum-${seq++}`, kind: "message", text: analysis.ticket_summary, at: seq });
  }

  for (const h of analysis.hypotheses) {
    const conf = h.confidence ? `[${h.confidence}] ` : "";
    const next = h.next_check ? ` → ${h.next_check}` : "";
    items.push({
      id: `m-hyp-${seq++}`,
      kind: "message",
      text: `${conf}${h.title}: ${h.description}${next}`,
      at: seq,
    });
  }

  return items;
}

export function fixPlanToItems(plan: BackendFixPlan): AgentItem[] {
  const ev = plan.evidence.length ? `\nEvidence: ${plan.evidence.join("; ")}` : "";
  return [
    {
      id: `m-fix-${Date.now()}`,
      kind: "message",
      text: `Fix plan — Root cause: ${plan.root_cause}${ev}`,
      at: Date.now(),
    },
  ];
}

export function auditEventToLogEntry(evt: BackendAuditEvent): Omit<LogEntry, "id" | "at"> & { id: string; at: number } {
  return {
    id: evt.id,
    at: new Date(evt.timestamp).getTime(),
    ticket_id: Number(evt.ticket_id) || undefined,
    level: _auditLevel(evt.event_type),
    text: `[${evt.actor}] ${evt.message}`,
  };
}

function _auditLevel(eventType: string): LogEntry["level"] {
  if (/error|blocked|failed/.test(eventType)) return "danger";
  if (/rejected/.test(eventType)) return "warn";
  if (/connected|approved|submitted|finished/.test(eventType)) return "success";
  return "info";
}

export function commandResultToLines(result: BackendCommandResult): string[] {
  const lines: string[] = [`$ ${result.command}`];
  if (result.stdout) lines.push(...result.stdout.split("\n").filter(Boolean));
  if (result.stderr) lines.push(...result.stderr.split("\n").filter(Boolean).map((l) => `[stderr] ${l}`));
  lines.push(`[exit ${result.exit_code}${result.timed_out ? ", timed_out" : ""}]`);
  return lines;
}

// ─── fetch helper ─────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const data = (await res.json()) as T;
  if (!res.ok) {
    const err = (data as { error?: { message?: string } }).error;
    throw new Error(err?.message ?? `HTTP ${res.status}`);
  }
  return data;
}

// ─── API wrappers ─────────────────────────────────────────────────────────────

export const api = {
  tickets: {
    list: (params?: { status?: string; priority?: string; sort?: string }) => {
      const q = new URLSearchParams();
      if (params?.status) q.set("status", params.status);
      if (params?.priority) q.set("priority", params.priority);
      if (params?.sort) q.set("sort", params.sort);
      const qs = q.toString();
      return apiFetch<BackendTicket[]>(`/tickets${qs ? `?${qs}` : ""}`);
    },
  },

  sessions: {
    create: (ticketId: number) =>
      apiFetch<BackendTicketSession>("/sessions", {
        method: "POST",
        body: JSON.stringify({ ticket_id: ticketId }),
      }),
    get: (sessionId: string) => apiFetch<BackendTicketSession>(`/sessions/${sessionId}`),
    approveConnection: (sessionId: string, approved: boolean) =>
      apiFetch<{ status: string; session?: BackendTicketSession }>(
        `/sessions/${sessionId}/approve-connection`,
        { method: "POST", body: JSON.stringify({ approved }) },
      ),
    approveCommand: (
      sessionId: string,
      commandId: string,
      body: { approved: boolean; edited_command?: string; technician_note?: string },
    ) =>
      apiFetch<BackendCommandResult | { status: string; command_id: string }>(
        `/sessions/${sessionId}/commands/${commandId}/approve`,
        { method: "POST", body: JSON.stringify(body) },
      ),
    abort: (sessionId: string) =>
      apiFetch<{ status: string }>(`/sessions/${sessionId}/abort`, { method: "POST" }),
  },

  agent: {
    analyze: (sessionId: string) =>
      apiFetch<{ analysis: BackendAgentAnalysis; pending_commands: BackendProposedCommand[] }>(
        `/sessions/${sessionId}/analyze`,
        { method: "POST" },
      ),
    proposeFix: (sessionId: string) =>
      apiFetch<{ fix_plan: BackendFixPlan; pending_commands: BackendProposedCommand[] }>(
        `/sessions/${sessionId}/propose-fix`,
        { method: "POST" },
      ),
    generateActivity: (sessionId: string) =>
      apiFetch<BackendActivityDraft>(`/sessions/${sessionId}/generate-activity`, { method: "POST" }),
    submitActivity: (sessionId: string) =>
      apiFetch<{ status: string; activity: object }>(`/sessions/${sessionId}/submit-activity`, {
        method: "POST",
      }),
    chat: (sessionId: string, message: string) =>
      apiFetch<{ message: string }>(`/sessions/${sessionId}/chat`, {
        method: "POST",
        body: JSON.stringify({ message }),
      }),
  },
};

// ─── WebSocket ────────────────────────────────────────────────────────────────

export type WsHandlers = {
  onSessionUpdate?: (s: BackendTicketSession) => void;
  onAuditEvent?: (e: BackendAuditEvent) => void;
  onCommandResult?: (r: BackendCommandResult) => void;
  onPendingCommand?: (c: BackendProposedCommand) => void;
  onActivityDraft?: (d: BackendActivityDraft) => void;
};

export function connectSessionWs(sessionId: string, handlers: WsHandlers): WebSocket {
  const wsBase = API_BASE.replace(/^https?/, (p) => (p === "https" ? "wss" : "ws"));
  const ws = new WebSocket(`${wsBase}/ws/sessions/${sessionId}`);
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data as string) as { type: string; data: unknown };
      switch (msg.type) {
        case "session_update":
          handlers.onSessionUpdate?.(msg.data as BackendTicketSession);
          break;
        case "audit_event":
          handlers.onAuditEvent?.(msg.data as BackendAuditEvent);
          break;
        case "command_result":
          handlers.onCommandResult?.(msg.data as BackendCommandResult);
          break;
        case "pending_command":
          handlers.onPendingCommand?.(msg.data as BackendProposedCommand);
          break;
        case "activity_draft":
          handlers.onActivityDraft?.(msg.data as BackendActivityDraft);
          break;
      }
    } catch {
      // ignore malformed frames
    }
  };
  ws.onerror = () => console.warn(`WS error for session ${sessionId}`);
  return ws;
}
