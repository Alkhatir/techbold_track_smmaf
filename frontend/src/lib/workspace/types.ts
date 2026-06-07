// Data shapes mirror Phoenix ERP. Snake_case fields = wire format.

export type Priority = "low" | "medium" | "high" | "critical";
export type TicketStatus = "OPEN" | "PENDING" | "DONE";
export type SshStatus = "Disconnected" | "Connecting" | "Connected";
export type GuardrailLevel = "safe" | "caution" | "blocked";

// Phoenix `SystemInfo` schema.
export interface SystemInfo {
  ip: string;
  port: number;
  username: string;
  os: string;
  notes?: string;
}

// Phoenix `Ticket` schema — matches GET /api/v1/me/tickets exactly.
// `system` is loaded separately from GET /api/v1/tickets/{id}/customer-system,
// and colocated here for UI convenience only.
export interface Ticket {
  id: number;
  title: string;
  description: string;
  priority: Priority;
  status: TicketStatus;
  customer_id: number;
  customer_name: string;
  tags?: string[];
  sla_due_at: string | null;
  created_at: string | null;
  notes?: string;
  system: SystemInfo;
}

export type QueueLoadState = "ok" | "loading" | "empty" | "auth_error";

export interface AgentMessage {
  id: string;
  kind: "message";
  text: string;
  at: number;
}

export interface TechnicianMessage {
  id: string;
  kind: "technician_message";
  text: string;
  at: number;
}

// A single hypothesis the agent is weighing during initial analysis.
export interface AnalysisHypothesis {
  title: string;
  description: string;
  confidence?: string;
  supporting_evidence?: string[];
  next_check?: string;
}

// The agent's initial, background analysis of the incident and environment,
// shown in the diagnosis feed before any command is proposed. While `pending`
// is true the agent is still working; the structured fields fill in on arrival.
export interface AgentAnalysisItem {
  id: string;
  kind: "analysis";
  pending: boolean;
  ticket_summary?: string;
  affected_component?: string;
  hypotheses: AnalysisHypothesis[];
  at: number;
}

export interface Guardrail {
  level: GuardrailLevel;
  reason?: string;
}

export type ActionStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "running"
  | "succeeded"
  | "failed"
  | "aborted"
  | "verified_ok"
  | "verified_regressed";

export interface AgentAction {
  id: string;
  kind: "action";
  command: string;          // current (possibly edited) command
  original_command: string; // as proposed by the agent
  edited: boolean;
  explanation: string;
  expected: string;
  guardrail: Guardrail;
  status: ActionStatus;
  output: string[];
  verify_text?: string;
  breakpoint?: boolean;
  at: number;
}

export type AgentItem = AgentMessage | TechnicianMessage | AgentAction | AgentAnalysisItem;

export interface LogEntry {
  id: string;
  at: number;
  ticket_id?: number;
  level: "info" | "warn" | "danger" | "success";
  text: string;
}

// Activity draft — fields mirror POST /api/v1/activities/create body.
export interface ActivityDraft {
  ticket_id: number;
  start_datetime: string;
  end_datetime: string;
  summary: string;
  root_cause: string;
  actions_taken: string;
  commands_summary: string;
  validation_result: string;
}