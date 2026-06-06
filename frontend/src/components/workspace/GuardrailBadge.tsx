import { AlertTriangle, ShieldAlert, ShieldCheck } from "lucide-react";
import type { Guardrail } from "@/lib/workspace/types";

const map = {
  safe: {
    cls: "bg-success/15 text-success border-success/40",
    icon: ShieldCheck,
    label: "Guardrail: safe",
  },
  caution: {
    cls: "bg-warning/15 text-warning border-warning/40",
    icon: ShieldAlert,
    label: "Guardrail: caution",
  },
  blocked: {
    cls: "bg-danger/15 text-danger border-danger/50",
    icon: AlertTriangle,
    label: "Guardrail: blocked",
  },
} as const;

export function GuardrailBadge({ guardrail }: { guardrail: Guardrail }) {
  const m = map[guardrail.level];
  const Icon = m.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 border px-1.5 py-px text-[10px] font-medium uppercase ${m.cls}`}
      title={guardrail.reason}
    >
      <Icon className="size-3" />
      {m.label}
    </span>
  );
}