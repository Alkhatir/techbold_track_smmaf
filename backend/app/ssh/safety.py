"""Deterministic command safety classifier.

The LLM never decides whether a command is safe — only this module does.
Context matters: targeted chown on /var/www/uploads is fine;
recursive chown on /var or / is not.
"""

import re

from ..models import RiskLevel, SafetyDecision

# ---------------------------------------------------------------------------
# Hard-block patterns — commands that must NEVER execute
# ---------------------------------------------------------------------------

_HARD_BLOCKS: list[tuple[re.Pattern, str]] = [
    # Broad recursive deletion
    (re.compile(r"\brm\b.*-[a-zA-Z]*r[a-zA-Z]*.*\s+(/\s*$|/\*|/etc|/home|/var(?:/lib)?|/srv|/usr|/bin|/sbin|/boot)"), "Broad recursive deletion of critical path"),
    (re.compile(r"\brm\s+-rf\s+[/~*]"), "Broad recursive deletion"),
    # Recursive chmod/chown on system roots — targeted operations (non-system paths) are allowed
    (re.compile(r"\bchmod\s+(?:-[a-zA-Z]*R[a-zA-Z]*\s+|--recursive\s+)(?:\d+|[ugo][+-=]\S+)\s+(/\s*$|/etc|/home|/var(?:\s|$)|/srv|/usr|/bin|\.|~\s*$)"), "Broad recursive chmod on system path"),
    (re.compile(r"\bchown\s+(?:-[a-zA-Z]*R[a-zA-Z]*\s+|--recursive\s+)\S+\s+(/\s*$|/etc|/home|/var(?:\s|$)|/srv|/usr|/bin)"), "Broad recursive chown on system path"),
    (re.compile(r"\bchmod\s+(?:-[a-zA-Z]*R[a-zA-Z]*\s+|--recursive\s+)777\s+"), "chmod -R 777 (blanket)"),
    # Disk destruction
    (re.compile(r"\bmkfs\b"), "Disk formatting"),
    (re.compile(r"\bdd\s+.*if=\S*(?:/dev/|zero|urandom|random)"), "Disk device write via dd"),
    # Fork bomb
    (re.compile(r":\(\)\s*\{.*[|&].*\}"), "Fork bomb"),
    # Audit/history tampering
    (re.compile(r"\bhistory\s+-c\b"), "Clearing shell history"),
    (re.compile(r"\bshred\b.*\.(bash_history|zsh_history|ash_history)"), "Shredding shell history"),
    # Reading secrets
    (re.compile(r"\bcat\s+(?:/etc/shadow|/etc/gshadow)"), "Reading /etc/shadow"),
    (re.compile(r"\bcat\s+.*\.pem\b"), "Reading private key file (.pem)"),
    (re.compile(r"\bcat\s+(?:~|/root|/home/\S+)/\.ssh/id_(?:rsa|ecdsa|ed25519|dsa)\b"), "Reading SSH private key"),
    (re.compile(r"\bcat\s+/root/\.ssh/id_"), "Reading root SSH private key"),
    # Firewall / security control disabling
    (re.compile(r"\bufw\s+disable\b"), "Disabling UFW firewall"),
    (re.compile(r"\biptables\s+-F\b"), "Flushing iptables"),
    (re.compile(r"\bnft\s+flush\s+ruleset\b"), "Flushing nftables"),
    (re.compile(r"\bsystemctl\s+(?:disable|stop)\s+(?:ufw|firewalld|auditd|apparmor|fail2ban)"), "Disabling security service"),
    # Killing init
    (re.compile(r"\bkill(?:\s+-9)?\s+1\b"), "Killing PID 1"),
    # Reading .env files directly
    (re.compile(r"\bcat\s+(?:\./)?\.env\b"), "Reading .env file"),
]

# ---------------------------------------------------------------------------
# Inner-command extractor — catches bash -c "rm -rf /" bypasses
# ---------------------------------------------------------------------------

_INNER_CMD_RE = re.compile(
    r"""(?:sudo\s+)?(?:bash|sh|zsh|dash)\s+(?:-[a-zA-Z]*c[a-zA-Z]*|-c)\s+["'](.+?)["']""",
    re.IGNORECASE,
)


def _extract_inner(command: str) -> str | None:
    m = _INNER_CMD_RE.search(command)
    return m.group(1) if m else None


# ---------------------------------------------------------------------------
# Risk classification — ordered most-specific first
# ---------------------------------------------------------------------------

_RISK_PATTERNS: list[tuple[re.Pattern, RiskLevel]] = [
    # Read-only queries
    (re.compile(r"^\s*(?:hostname|uptime|whoami|id|date|uname(?:\s+-a)?|pwd)\s*$"), RiskLevel.READ_ONLY),
    (re.compile(r"\bsystemctl\s+(?:status|is-active|is-enabled|list-units|cat|show)\b"), RiskLevel.READ_ONLY),
    (re.compile(r"\bjournalctl\b"), RiskLevel.READ_ONLY),
    (re.compile(r"\b(?:ss|netstat)\b"), RiskLevel.READ_ONLY),
    (re.compile(r"\b(?:df|du|free|lsblk|mount|ip\s+(?:addr|route|link|neigh)|ifconfig)\b"), RiskLevel.READ_ONLY),
    (re.compile(r"\b(?:ps|pstree|top|htop)\b"), RiskLevel.READ_ONLY),
    # Network connectivity and DNS — safe read-only probes
    (re.compile(r"\b(?:ping|ping6)\b"), RiskLevel.READ_ONLY),
    (re.compile(r"\b(?:dig|nslookup|host)\b"), RiskLevel.READ_ONLY),
    (re.compile(r"\b(?:traceroute|tracepath|mtr)\b"), RiskLevel.READ_ONLY),
    (re.compile(r"\b(?:resolvectl|systemd-resolve)\b"), RiskLevel.READ_ONLY),
    # curl: READ_ONLY unless sending data (-d/--data/-F/--form/-T/--upload-file)
    # or writing output to a filesystem path (-o /path)
    (re.compile(r"\bcurl\b(?!.*(?:\s(?:-d|--data|-F|--form|-T|--upload-file)\b|\s-o\s+/))"), RiskLevel.READ_ONLY),
    (re.compile(r"\bwget\b.*--spider\b"), RiskLevel.READ_ONLY),
    (re.compile(r"\b(?:cat|grep|ls|find|head|tail|less|more|wc|awk|cut|sort|uniq|file|stat|readlink|strings|namei|lsof)\b"), RiskLevel.READ_ONLY),
    (re.compile(r"\bnginx\s+-t\b"), RiskLevel.READ_ONLY),
    (re.compile(r"\bapache(?:ctl|2ctl)\s+(?:configtest|-t)\b"), RiskLevel.READ_ONLY),
    (re.compile(r"\b(?:python3?|node|php|ruby|java|perl)\s+(?:--version|-V)\b"), RiskLevel.READ_ONLY),
    (re.compile(r"\b(?:dpkg|rpm)\s+(?:-l|-q|--list|--query)\b"), RiskLevel.READ_ONLY),
    (re.compile(r"\bcrontab\s+-l\b"), RiskLevel.READ_ONLY),
    # Service restarts
    (re.compile(r"\bsystemctl\s+(?:restart|reload|start)\b"), RiskLevel.SERVICE_RESTART),
    # Low-impact targeted changes (NOT on system roots)
    (re.compile(r"\bmkdir\b"), RiskLevel.LOW_CHANGE),
    (re.compile(r"\btouch\b"), RiskLevel.LOW_CHANGE),
    (re.compile(r"\bln\s+-s\b"), RiskLevel.LOW_CHANGE),
    (re.compile(r"\bchown\b"), RiskLevel.LOW_CHANGE),
    (re.compile(r"\bchmod\b"), RiskLevel.LOW_CHANGE),
    (re.compile(r"\bsystemctl\s+enable\b"), RiskLevel.LOW_CHANGE),
    # Package changes
    (re.compile(r"\bapt(?:-get)?\s+(?:install|remove|purge|update|upgrade|autoremove)\b"), RiskLevel.PACKAGE_CHANGE),
    (re.compile(r"\bpip3?\s+install\b"), RiskLevel.PACKAGE_CHANGE),
    (re.compile(r"\bsnap\s+(?:install|remove)\b"), RiskLevel.PACKAGE_CHANGE),
    # Needs manual review — config edits, database, redirections into /etc
    (re.compile(r"\bsed\s+-i\b"), RiskLevel.NEEDS_MANUAL_REVIEW),
    (re.compile(r"\btee\s+"), RiskLevel.NEEDS_MANUAL_REVIEW),
    (re.compile(r"\b(?:mv|cp)\s+.*\s+/etc/"), RiskLevel.NEEDS_MANUAL_REVIEW),
    (re.compile(r">\s*/etc/"), RiskLevel.NEEDS_MANUAL_REVIEW),
    (re.compile(r"\b(?:mysql|psql|sqlite3|mongosh)\b"), RiskLevel.NEEDS_MANUAL_REVIEW),
    (re.compile(r"\bnano\b|\bvim?\b|\bemacs\b"), RiskLevel.NEEDS_MANUAL_REVIEW),
]


_SUDO_STRIP_RE = re.compile(r"^\s*sudo\s+(?:-[a-zA-Z]+\s+)*(?:-u\s+\S+\s+)?")


def classify_command(command: str) -> SafetyDecision:
    normalized = command.strip()

    # Build list of commands to check, including any shell-wrapped inner command
    # and the sudo-stripped form so classifiers see the real base command.
    commands_to_check = [normalized]
    inner = _extract_inner(normalized)
    if inner:
        commands_to_check.append(inner)
    stripped = _SUDO_STRIP_RE.sub("", normalized)
    if stripped != normalized:
        commands_to_check.append(stripped)

    for cmd in commands_to_check:
        for pattern, reason in _HARD_BLOCKS:
            if pattern.search(cmd):
                return SafetyDecision(
                    allowed=False,
                    risk=RiskLevel.BLOCKED,
                    reason=f"Blocked: {reason}",
                    normalized_command=normalized,
                )

    # Classify risk level (first match wins)
    for pattern, level in _RISK_PATTERNS:
        if pattern.search(normalized):
            return SafetyDecision(
                allowed=True,
                risk=level,
                reason=f"Classified as {level.value}",
                normalized_command=normalized,
            )

    return SafetyDecision(
        allowed=True,
        risk=RiskLevel.NEEDS_MANUAL_REVIEW,
        reason="Could not classify — requires manual review",
        normalized_command=normalized,
    )
