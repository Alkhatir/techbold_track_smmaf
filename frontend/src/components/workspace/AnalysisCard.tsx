import { Loader2, Microscope, Search } from "lucide-react";
import type { AgentAnalysisItem, AnalysisHypothesis } from "@/lib/workspace/types";
import { Markdown } from "./Markdown";

// Visually distinct card for the agent's initial, background analysis of the
// incident and environment — shown before any command is proposed. The violet
// accent sets it apart from chat messages (info/blue) and proposed actions.
export function AnalysisCard({ analysis }: { analysis: AgentAnalysisItem }) {
  const { pending, ticket_summary, affected_component, hypotheses } = analysis;

  return (
    <div className="border border-violet-500/40 bg-violet-500/[0.06]">
      <div className="flex items-center gap-2 border-b border-violet-500/30 bg-violet-500/10 px-3 py-1.5">
        {pending ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-violet-300" />
        ) : (
          <Microscope className="size-3.5 shrink-0 text-violet-300" />
        )}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-300">
          {pending ? "Agent analyzing…" : "Initial analysis"}
        </span>
        {pending && (
          <span className="ml-1 text-[11px] italic text-violet-200/70">
            inspecting the problem &amp; environment in the background
          </span>
        )}
      </div>

      {pending ? (
        <div className="space-y-2 px-3 py-3">
          <SkeletonLine className="w-3/4" />
          <SkeletonLine className="w-full" />
          <SkeletonLine className="w-2/3" />
        </div>
      ) : (
        <div className="space-y-3 px-3 py-3 text-xs leading-relaxed">
          {ticket_summary && (
            <Markdown className="text-sm leading-relaxed text-foreground/90">{ticket_summary}</Markdown>
          )}

          {affected_component && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Affected component
              </span>
              <span className="border border-violet-500/40 bg-violet-500/15 px-1.5 py-px font-mono text-[11px] text-violet-200">
                {affected_component}
              </span>
            </div>
          )}

          {hypotheses.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Hypotheses being weighed
              </div>
              <div className="space-y-2">
                {hypotheses.map((h, i) => (
                  <HypothesisRow key={i} hypothesis={h} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HypothesisRow({ hypothesis }: { hypothesis: AnalysisHypothesis }) {
  const { title, description, confidence, supporting_evidence, next_check } = hypothesis;
  return (
    <div className="border-l-2 border-violet-500/40 pl-3">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-medium text-foreground/90">{title}</span>
        {confidence && <ConfidenceBadge confidence={confidence} />}
      </div>
      {description && <Markdown className="mt-0.5 text-foreground/80">{description}</Markdown>}
      {supporting_evidence && supporting_evidence.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {supporting_evidence.map((ev, i) => (
            <li key={i} className="flex gap-1.5 text-[11px] text-muted-foreground">
              <span className="text-violet-400/70">•</span>
              <Markdown inline>{ev}</Markdown>
            </li>
          ))}
        </ul>
      )}
      {next_check && (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-violet-200/80">
          <Search className="size-3 shrink-0" />
          <span>Next check: <Markdown inline>{next_check}</Markdown></span>
        </div>
      )}
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const c = confidence.toLowerCase();
  const cls = /high/.test(c)
    ? "border-success/40 bg-success/15 text-success"
    : /low/.test(c)
      ? "border-muted-foreground/30 bg-muted-foreground/10 text-muted-foreground"
      : "border-warning/40 bg-warning/15 text-warning";
  return (
    <span className={`border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide ${cls}`}>
      {confidence}
    </span>
  );
}

function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={`h-3 animate-pulse rounded bg-violet-500/15 ${className}`} />;
}
