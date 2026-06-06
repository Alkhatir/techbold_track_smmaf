import { useState } from "react";
import {
  AlertTriangle,
  Check,
  Pencil,
  RotateCcw,
  Square,
  Undo2,
  X,
} from "lucide-react";
import type { AgentAction } from "@/lib/workspace/types";
import { checkGuardrail } from "@/lib/workspace/guardrails";
import { GuardrailBadge } from "./GuardrailBadge";

export function ActionCard({
  action,
  onApprove,
  onReject,
  onEdit,
  onRetry,
  onAbort,
}: {
  action: AgentAction;
  onApprove: (overrideBlocked: boolean) => void;
  onReject: () => void;
  onEdit: (newCommand: string) => void;
  onRetry: () => void;
  onAbort: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(action.command);
  const [confirming, setConfirming] = useState(false);

  const liveGuardrail = editing ? checkGuardrail(draft) : action.guardrail;
  const blocked = liveGuardrail.level === "blocked";
  const pending = action.status === "proposed";
  const ran =
    action.status === "succeeded" ||
    action.status === "failed" ||
    action.status === "aborted" ||
    action.status === "verified_ok" ||
    action.status === "verified_regressed";
  const running = action.status === "running";

  const handleApprove = () => {
    if (blocked && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onApprove(blocked);
  };

  const handleSaveEdit = () => {
    if (draft.trim() && draft !== action.command) onEdit(draft.trim());
    setEditing(false);
    setConfirming(false);
  };

  const handleCancelEdit = () => {
    setDraft(action.command);
    setEditing(false);
  };

  return (
    <div className="border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Proposed Action
          </span>
          <GuardrailBadge guardrail={liveGuardrail} />
          {action.edited && (
            <span className="border border-info/40 bg-info/15 px-1.5 py-px text-[10px] font-medium uppercase text-info">
              Edited
            </span>
          )}
        </div>
        <StatusPill status={action.status} />
      </div>

      {blocked && pending && (
        <div className="flex items-start gap-2 border-b border-danger/60 bg-danger/15 px-3 py-2 text-xs text-danger">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <strong>⚠ Blocked: potential hard-fail — {liveGuardrail.reason ?? "unsafe command pattern"}.</strong>{" "}
            Edit to a scoped command, reject, or explicitly override (two clicks).
          </span>
        </div>
      )}

      {editing ? (
        <div className="bg-terminal-bg p-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            spellCheck={false}
            className="block w-full resize-y bg-transparent px-2 py-1.5 font-mono text-[12.5px] leading-relaxed text-success outline-none ring-1 ring-info/40 focus:ring-info"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              onClick={handleCancelEdit}
              className="flex items-center gap-1 border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Undo2 className="size-3.5" /> Cancel edit
            </button>
            <button
              onClick={handleSaveEdit}
              className="flex items-center gap-1 border border-info/60 bg-info/15 px-2 py-1 text-[11px] font-medium text-info hover:bg-info/25"
            >
              <Check className="size-3.5" /> Save command
            </button>
          </div>
        </div>
      ) : (
        <pre className="overflow-x-auto bg-terminal-bg px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-success">
          <span className="text-muted-foreground">$ </span>
          {action.command}
        </pre>
      )}

      <div className="space-y-2 border-t border-border px-3 py-2.5 text-xs leading-relaxed">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            What &amp; why
          </div>
          <p className="mt-0.5 text-foreground/90">{action.explanation}</p>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Expected outcome
          </div>
          <p className="mt-0.5 text-foreground/90">{action.expected}</p>
        </div>
        {action.verify_text && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Verify
            </div>
            <p
              className={`mt-0.5 ${
                action.status === "verified_regressed" ? "text-danger" : "text-success"
              }`}
            >
              {action.verify_text}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background/40 px-3 py-2">
        {pending && !editing && (
          <>
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1 border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Pencil className="size-3.5" /> Edit
            </button>
            <button
              onClick={onReject}
              className="flex items-center gap-1 border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" /> Reject
            </button>
            <button
              onClick={handleApprove}
              className={`flex items-center gap-1 border px-2.5 py-1 text-xs font-medium ${
                blocked
                  ? confirming
                    ? "border-danger bg-danger text-danger-foreground"
                    : "border-danger/60 bg-danger/15 text-danger hover:bg-danger/25"
                  : liveGuardrail.level === "caution"
                    ? "border-warning/60 bg-warning/15 text-warning hover:bg-warning/25"
                    : "border-success/60 bg-success/15 text-success hover:bg-success/25"
              }`}
            >
              {blocked && confirming ? (
                <>
                  <AlertTriangle className="size-3.5" /> Click again to override &amp; run
                </>
              ) : blocked ? (
                <>
                  <AlertTriangle className="size-3.5" /> Override &amp; run anyway
                </>
              ) : (
                <>
                  <Check className="size-3.5" /> Approve &amp; Run
                </>
              )}
            </button>
          </>
        )}
        {running && (
          <button
            onClick={onAbort}
            className="flex items-center gap-1 border border-danger/60 bg-danger/10 px-2.5 py-1 text-xs text-danger hover:bg-danger/20"
          >
            <Square className="size-3.5" /> Abort
          </button>
        )}
        {ran && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1 border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <RotateCcw className="size-3.5" /> Retry
          </button>
        )}
        {action.status === "rejected" && (
          <span className="text-[11px] text-muted-foreground">Rejected by technician.</span>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: AgentAction["status"] }) {
  const map: Record<AgentAction["status"], { cls: string; label: string }> = {
    proposed: { cls: "text-warning", label: "● awaiting approval" },
    approved: { cls: "text-info", label: "● approved" },
    rejected: { cls: "text-muted-foreground", label: "● rejected" },
    running: { cls: "text-info animate-pulse", label: "● running" },
    succeeded: { cls: "text-success", label: "● ran" },
    failed: { cls: "text-danger", label: "● failed" },
    aborted: { cls: "text-danger", label: "● aborted" },
    verified_ok: { cls: "text-success", label: "● verified" },
    verified_regressed: { cls: "text-danger", label: "● regressed" },
  };
  const s = map[status];
  return <span className={`font-mono text-[11px] ${s.cls}`}>{s.label}</span>;
}