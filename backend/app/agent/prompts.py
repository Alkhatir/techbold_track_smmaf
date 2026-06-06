from ..models import CustomerSystem, Ticket

SYSTEM_PROMPT = """\
You are a cautious Linux service desk diagnostic assistant.

You help a human technician troubleshoot Ubuntu customer VMs over SSH.

Rules:
- The technician is always in control.
- You must never assume you are allowed to run commands.
- You only propose commands with a reason and expected result.
- Prefer read-only diagnostics first. Diagnose before fixing.
- Fix the root cause, not only the symptom.
- Prefer minimal targeted changes.
- Avoid unnecessary installs.
- Avoid broad filesystem changes.
- Avoid blanket chmod/chown/rm.
- Avoid deleting data.
- Avoid disabling firewall, audit, or security controls.
- Avoid reading or exposing secrets.
- Do not include secrets, passwords, keys, or tokens in summaries.
- Every command must be safe, specific, and justifiable.
- Only propose commands that ship with base Ubuntu.
- Do not assume htop, ncdu, jq, or other non-default tools are installed.
"""


def build_analysis_prompt(
    ticket: Ticket,
    customer_system: CustomerSystem,
    audit_summary: str,
    command_results: str,
) -> str:
    return f"""\
Analyze this Linux service desk ticket and propose safe read-only diagnostic commands.

## Ticket
ID: {ticket.id}
Title: {ticket.title}
Description: {ticket.description}
Priority: {ticket.priority}
Customer: {ticket.customer_name}

## Customer system
OS: {customer_system.system.os}
Notes: {customer_system.system.notes or "none"}

## Audit so far
{audit_summary or "No actions taken yet."}

## Command results so far
{command_results or "No commands run yet."}

## Instructions
Start with broad evidence gathering. Suggested baseline:
  systemctl list-units --failed --no-pager
  journalctl -p err --since "1 hour ago" --no-pager | tail -50
  df -h
  ss -tlnp
  ps aux --sort=-%cpu | head -10

Then propose targeted checks based on what the ticket suggests:

- Service not reachable / intermittent → check systemctl status, journalctl for the service, ss -tlnp for the port, curl to the health endpoint
- Permission denied on uploads/writes → ls -la and stat on the target path, namei -l to trace the full path, id of the process owner
- Cannot reach external/partner service → check /etc/hosts, /etc/resolv.conf, resolvectl status, dig/nslookup/ping for the hostname, curl to the URL
- Database reads work but writes fail → check PostgreSQL with sudo -u postgres psql to inspect table grants (\\dp) and roles (\\du)
- Monitoring data stops → check the metrics agent service status, its logs, and connectivity to the monitoring backend

Return:
- ticket_summary: brief summary of what the customer reported
- affected_component: service or component likely affected (if inferable)
- hypotheses: ranked list of likely causes with confidence
- proposed_commands: safe read-only diagnostic commands (5-8 maximum)
"""


def build_fix_prompt(
    ticket: Ticket,
    customer_system: CustomerSystem,
    command_results: str,
    audit_summary: str,
) -> str:
    return f"""\
Based on the diagnostic evidence, propose a minimal fix for this ticket.

## Ticket
ID: {ticket.id}
Title: {ticket.title}
Description: {ticket.description}

## System
OS: {customer_system.system.os}
Notes: {customer_system.system.notes or "none"}

## Evidence from diagnostics
{command_results or "No diagnostic results yet."}

## Audit
{audit_summary or "No actions taken yet."}

## Instructions
- Only propose fix commands if there is enough evidence.
- If evidence is insufficient, set needs_more_diagnostics=true and propose more diagnostics instead.
- Use minimal, targeted commands. No broad chmod/chown/rm.
- Always include validation commands, including a service restart and re-check.
- Root cause must be the technical cause, not the symptom.
"""


def build_activity_prompt(
    ticket: Ticket,
    audit_events: str,
    command_results: str,
    validation_results: str,
) -> str:
    # Truncate long command results to avoid exceeding context
    if len(command_results) > 4000:
        command_results = command_results[:4000] + "\n[TRUNCATED]"

    return f"""\
Generate a structured ERP activity log for this resolved ticket.

## Ticket
ID: {ticket.id}
Title: {ticket.title}
Description: {ticket.description}
Customer: {ticket.customer_name}

## Audit log
{audit_events}

## Command results
{command_results}

## Validation results
{validation_results or "No explicit validation recorded."}

## Instructions
Generate an activity with:
- summary: one sentence describing what was restored
- root_cause: the TECHNICAL root cause (not the symptom)
- actions_taken: diagnosis and fix steps in order
- commands_summary: relevant commands/command classes — NO secrets, NO passwords, NO tokens, NO raw output
- validation_result: concrete proof the customer benefit is restored

Be technically precise. Mention validation proof. Root cause must be technical.
"""
