import type { Guardrail } from "./types";

// Patterns the spec calls hard-fail. Broad / recursive / destructive only —
// targeted single-file ops are intentionally allowed.
const BLOCK_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\b(drop|truncate)\s+(database|table)\b/i, reason: "destroys database or customer data" },
  { re: /\brm\s+-rf?\s+\/(?:\s|$|\*)/i, reason: "recursive delete from filesystem root" },
  { re: /\brm\s+-rf?\s+\/(etc|home|var\/lib\/postgresql|srv)(\b|\/|\s)/i, reason: "deletes a critical system directory" },
  { re: /\bdd\s+if=\S+\s+of=\/dev\//i, reason: "raw disk overwrite via dd" },
  { re: /\bmkfs\.\w+/i, reason: "reformats a filesystem" },
  { re: /\bchmod\s+-R\s+[0-7]?777\s+(\/|\/var|\/etc|\/srv|\/home)(\b|\/|\s)/i, reason: "broad recursive world-writable permissions on a critical path" },
  { re: /\bchmod\s+777\s+(\/|\/var|\/etc|\/srv|\/home)(\b|\/|\s)/i, reason: "world-writable on a critical path" },
  { re: /\b(ufw\s+disable|iptables\s+-F)\b/i, reason: "disables host firewall" },
  { re: /\bsystemctl\s+(stop|disable|mask)\s+(ufw|firewalld|auditd|apparmor)\b/i, reason: "disables a security control (firewall / audit / MAC)" },
  { re: /\bsetenforce\s+0\b/i, reason: "disables SELinux enforcement" },
  { re: /\b(cat|less|more|tail|head|cp|scp|curl\s+-T)\s+[^|]*?(id_rsa|id_ed25519|\.pem|\.key|\/etc\/shadow|secrets?\b|\.env\b)/i, reason: "reads or exfiltrates secrets" },
  { re: /\becho\s+.+>>?\s*.*(\.env|secret)/i, reason: "writes secret material to a file" },
  { re: /\b(rm|truncate)\s+(-rf?\s+)?\/var\/log(\b|\/)/i, reason: "deletes system logs (audit loss)" },
  { re: /\b(rm|truncate|>\s*)\s*~?\/?\.(bash|zsh|sh)_history\b/i, reason: "deletes shell history" },
  { re: /\bUser\s*=\s*root\b/i, reason: "reconfigures the app to run as root" },
  { re: /\busermod\s+.*-G\s+sudo\b/i, reason: "grants sudo group to an app user" },
];

const CAUTION_PATTERNS: RegExp[] = [
  /\bsudo\s+systemctl\s+(restart|stop|start)\b/i,
  /\bsudo\s+chown\b/i,
  /\bsudo\s+chmod\b/i,
  /\bkill\s+-9\b/i,
  /\bapt(-get)?\s+(install|remove|purge)\b/i,
];

export function checkGuardrail(command: string): Guardrail {
  for (const { re, reason } of BLOCK_PATTERNS) {
    if (re.test(command)) return { level: "blocked", reason };
  }
  for (const re of CAUTION_PATTERNS) {
    if (re.test(command)) return { level: "caution" };
  }
  return { level: "safe" };
}

// Mask anything that looks like a secret in mock output so the UI never
// renders a real-looking key, token, or password.
export function maskSecrets(line: string): string {
  return line
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1****")
    .replace(/((?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*)\S+/gi, "$1****")
    .replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, "****[redacted private key]****");
}