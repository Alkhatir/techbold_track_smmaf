import { checkGuardrail } from "./guardrails";
import type { AgentItem, Ticket } from "./types";

// Five hidden incidents per the brief: stopped service, full disk on /var,
// broken config, failed cron, port conflict. Plus one resolved ticket.
export const TICKETS: Ticket[] = [
  {
    id: 4821,
    title: "Website is down — nginx not responding",
    description:
      "Customer reports api.northwind.io returns a connection-refused error since this morning. Web app loads a blank page. No changes from our side.",
    priority: "critical",
    status: "OPEN",
    customer_id: 12,
    customer_name: "Northwind Logistics",
    tags: ["web", "nginx"],
    sla_due_at: "2026-06-06T12:00:00Z",
    created_at: "2026-06-06T08:14:00Z",
    notes: "Escalated to on-call. Customer is monitoring status page.",
    system: {
      ip: "10.42.8.21",
      port: 22,
      username: "deploy",
      os: "Ubuntu 22.04 LTS",
      notes: "Edge reverse proxy fronting two app servers on :8080.",
    },
  },
  {
    id: 4822,
    title: "Encoder jobs failing with 'no space left on device'",
    description:
      "Customer says video encoding jobs have been failing since last night. Some uploads return errors mid-process.",
    priority: "high",
    status: "OPEN",
    customer_id: 27,
    customer_name: "Helios Media",
    tags: ["disk", "logs"],
    sla_due_at: "2026-06-06T14:00:00Z",
    created_at: "2026-06-06T09:02:00Z",
    notes: "Previous incident #4756 was similar — rotated logs then.",
    system: {
      ip: "10.42.11.7",
      port: 22,
      username: "deploy",
      os: "Ubuntu 20.04 LTS",
      notes: "Encoder worker. Logs are shipped to central S3 hourly.",
    },
  },
  {
    id: 4823,
    title: "Broken sshd config — deploy user can't log in",
    description:
      "Our CI says it cannot reach ci-runner-02 anymore. The customer noticed deploys stopped after last night's maintenance window.",
    priority: "high",
    status: "OPEN",
    customer_id: 41,
    customer_name: "Atlas Robotics",
    tags: ["ssh", "config"],
    sla_due_at: "2026-06-06T13:00:00Z",
    created_at: "2026-06-06T07:31:00Z",
    system: {
      ip: "10.42.3.18",
      port: 22,
      username: "deploy",
      os: "Ubuntu 22.04 LTS",
      notes: "GitLab runner host. Maintenance window ran an Ansible hardening playbook.",
    },
  },
  {
    id: 4824,
    title: "Nightly ETL hasn't produced files since Tuesday",
    description:
      "Customer's overnight report is missing for three days running. Cron is supposed to fire at 02:00 UTC. They aren't seeing any error in their inbox.",
    priority: "medium",
    status: "PENDING",
    customer_id: 18,
    customer_name: "Brightline Retail",
    tags: ["cron", "etl"],
    sla_due_at: "2026-06-07T00:00:00Z",
    created_at: "2026-06-04T15:45:00Z",
    system: {
      ip: "10.42.5.44",
      port: 22,
      username: "deploy",
      os: "Ubuntu 22.04 LTS",
      notes: "Batch / ETL host. crontab is owned by 'batch'.",
    },
  },
  {
    id: 4825,
    title: "App service won't start — 'address already in use'",
    description:
      "After this morning's reboot the application service won't come up. Customer says the web app is offline. Replica DB is still serving reads.",
    priority: "critical",
    status: "OPEN",
    customer_id: 55,
    customer_name: "Quanta Health",
    tags: ["port-conflict", "service"],
    sla_due_at: "2026-06-06T11:00:00Z",
    created_at: "2026-06-06T06:12:00Z",
    system: {
      ip: "10.42.9.2",
      port: 22,
      username: "deploy",
      os: "Ubuntu 22.04 LTS",
      notes: "Primary app server. Listens on :8080 normally.",
    },
  },
  {
    id: 4820,
    title: "TLS certificate renewal warning",
    description:
      "Customer's monitoring sent a 14-day expiry warning for the edge-prod-02 certificate.",
    priority: "low",
    status: "DONE",
    customer_id: 12,
    customer_name: "Northwind Logistics",
    tags: ["tls"],
    sla_due_at: "2026-06-19T00:00:00Z",
    created_at: "2026-06-05T10:00:00Z",
    system: {
      ip: "10.42.8.22",
      port: 22,
      username: "deploy",
      os: "Ubuntu 22.04 LTS",
      notes: "Secondary edge host. Certbot manages renewals.",
    },
  },
];

let seq = 0;
const nid = (p: string) => `${p}-${Date.now()}-${++seq}`;

function action(partial: {
  command: string;
  explanation: string;
  expected: string;
}): AgentItem {
  return {
    id: nid("a"),
    kind: "action",
    at: Date.now(),
    command: partial.command,
    original_command: partial.command,
    edited: false,
    explanation: partial.explanation,
    expected: partial.expected,
    guardrail: checkGuardrail(partial.command),
    status: "proposed",
    output: [],
  };
}
function msg(text: string): AgentItem {
  return { id: nid("m"), kind: "message", text, at: Date.now() };
}

export function buildAgentScript(ticketId: number): AgentItem[] {
  switch (ticketId) {
    case 4821:
      return [
        msg("Connected. Checking the nginx service state and recent journal entries before proposing a fix."),
        msg("`systemctl is-active nginx` returns `inactive`. The journal shows the unit exited after a config reload at 07:50. Service is simply stopped, config parses fine."),
        action({
          command: "sudo systemctl restart nginx",
          explanation: "Restart the nginx service so it begins serving requests again. The config already parses (nginx -t was clean in the journal).",
          expected: "nginx.service enters active (running). curl https://api.northwind.io returns 200.",
        }),
      ];
    case 4822:
      return [
        msg("`df -h` shows /var at 98%. Largest consumer is /var/log/app/. Encoder writes are failing because /var is full."),
        msg("Proposing the brute-force option first so the technician can see how the guardrail handles it. A safer scoped fix is queued after."),
        action({
          command: "sudo rm -rf /var/log/*",
          explanation: "Recursively delete everything under /var/log to immediately free space. This wipes the audit trail across every service on the host.",
          expected: "Frees ~40 GB on /var.",
        }),
      ];
    case 4823:
      return [
        msg("auth.log shows `Authentication refused: bad ownership or modes for /home/deploy/.ssh/authorized_keys`. Last night's hardening playbook reset the mode to 0644."),
        action({
          command: "sudo chmod 600 /home/deploy/.ssh/authorized_keys",
          explanation: "Restore the strict permissions sshd requires on authorized_keys. Targeted at a single file — no recursion, no other accounts touched.",
          expected: "Subsequent ssh deploy@ci-runner-02 succeeds.",
        }),
      ];
    case 4824:
      return [
        msg("`systemctl status cron` is active, but syslog has no CRON entries since Tuesday 02:00. Likely a crontab parse error after the most recent edit."),
        action({
          command: "sudo -u batch crontab -l",
          explanation: "Read-only dump of the batch user's crontab so we can spot a malformed line. No state change.",
          expected: "Crontab contents printed; we identify the broken line.",
        }),
      ];
    case 4825:
      return [
        msg("`journalctl -u app` shows `bind: address already in use` on :8080. Something else grabbed the port between reboot and the app's start."),
        msg("`ss -tlnp 'sport = :8080'` shows a stale `python3 debug_server.py` (pid 1834) holding 8080 — leftover from yesterday's debugging session."),
        action({
          command: "sudo kill 1834 && sudo systemctl restart app",
          explanation: "Terminate the orphaned debug process holding port 8080, then start the app service so it can bind. Targeted SIGTERM, not -9.",
          expected: "app.service enters active (running); port 8080 owned by the app process.",
        }),
      ];
    default:
      return [msg("Ticket already resolved. No further agent actions proposed.")];
  }
}

// Followup safer action that the agent offers AFTER a blocked one is rejected
// (or the technician edits the dangerous version). Currently used for 4822.
export function buildFollowupSafer(ticketId: number): AgentItem | null {
  if (ticketId === 4822) {
    return action({
      command: "sudo journalctl --vacuum-size=500M",
      explanation: "Bound systemd-journal storage to 500 MB. Frees space immediately without touching /var/log/app/* or any other service's logs.",
      expected: "Journal vacuumed; /var drops below 80%. Encoder jobs resume.",
    });
  }
  return null;
}

export function simulatedOutput(command: string): string[] {
  if (/systemctl restart nginx/.test(command))
    return [
      "$ sudo systemctl restart nginx",
      "● nginx.service - A high performance web server",
      "   Active: active (running)",
      "[ok] curl -sI https://api.northwind.io → HTTP/2 200",
    ];
  if (/journalctl --vacuum-size/.test(command))
    return [
      "$ sudo journalctl --vacuum-size=500M",
      "Deleted archived journal /var/log/journal/.../system@00060...journal (1.0G).",
      "Vacuuming done, freed 38.4G of archived journals from /var/log/journal.",
      "[ok] /var now at 71% used (was 98%)",
    ];
  if (/authorized_keys/.test(command))
    return [
      "$ sudo chmod 600 /home/deploy/.ssh/authorized_keys",
      "[ok] mode now 0600 (was 0644)",
      "[verify] ssh deploy@ci-runner-02 'echo ok' → ok",
    ];
  if (/crontab -l/.test(command))
    return [
      "$ sudo -u batch crontab -l",
      "# m h dom mon dow command",
      "0 2 * * MON-FRI /opt/batch/run.sh >> /var/log/batch.log 2&>1",
      "                                                       ^ malformed redirect (should be 2>&1)",
    ];
  if (/kill 1834.*systemctl restart app/.test(command))
    return [
      "$ sudo kill 1834",
      "$ sudo systemctl restart app",
      "● app.service",
      "   Active: active (running)",
      "[ok] port 8080 now owned by pid 4412 (app)",
    ];
  return ["$ " + command, "[ok] exit 0"];
}

export function verifyText(ticketId: number): string {
  switch (ticketId) {
    case 4821: return "Verify: curl https://api.northwind.io → 200 OK. nginx active (running). Incident resolved.";
    case 4822: return "Verify: /var at 71% used. Encoder queue draining, last 3 jobs succeeded. Incident resolved.";
    case 4823: return "Verify: deploy@ci-runner-02 SSH login succeeds. CI pipeline resumed. Incident resolved.";
    case 4824: return "Verify: crontab parse error identified. Awaiting fix proposal — fault diagnosed, not yet resolved.";
    case 4825: return "Verify: app.service active (running), port 8080 owned by app process. Incident resolved.";
    default: return "Verify: change applied; service nominal.";
  }
}