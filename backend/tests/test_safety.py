"""Tests for the command safety classifier."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.ssh.safety import classify_command
from app.models import RiskLevel


# ---------------------------------------------------------------------------
# Commands that must be hard-blocked
# ---------------------------------------------------------------------------

BLOCKED_COMMANDS = [
    "rm -rf /",
    "rm -rf /*",
    "rm -rf /etc",
    "rm -rf /home",
    "rm -rf /var",
    "rm -rf /var/lib",
    "rm -rf /var/lib/postgresql",
    "chmod -R 777 /var",
    "chmod -R 777 /etc",
    "chmod -R 777 /",
    "chown -R root:root /var",
    "chown -R root:root /",
    "cat /etc/shadow",
    "cat ~/.ssh/id_rsa",
    "cat /root/.ssh/id_rsa",
    "cat /etc/secrets.pem",
    "ufw disable",
    "iptables -F",
    "nft flush ruleset",
    "systemctl disable ufw",
    "systemctl stop auditd",
    "history -c",
    "dd if=/dev/zero of=/dev/sda",
    "mkfs.ext4 /dev/sda1",
    ":(){ :|:& };:",
    # Shell wrapping bypass attempts
    'bash -c "rm -rf /"',
    'sudo sh -c "cat /etc/shadow"',
    'bash -c "ufw disable"',
]

# ---------------------------------------------------------------------------
# Commands that must be allowed
# ---------------------------------------------------------------------------

ALLOWED_COMMANDS = [
    "systemctl status nginx --no-pager",
    "systemctl is-active nginx",
    "systemctl is-enabled nginx",
    "journalctl -u nginx -n 100 --no-pager",
    "journalctl -p err -n 50 --no-pager",
    "df -h",
    "free -m",
    "ss -tlnp",
    "ps aux --sort=-%cpu | head -10",
    "curl -I http://localhost",
    "curl -sS http://localhost/health",
    "hostname",
    "uptime",
    "whoami",
    "ls -la /var/www",
    "cat /etc/nginx/nginx.conf",
    "nginx -t",
    "python3 --version",
    "tail -50 /var/log/syslog",
]

# ---------------------------------------------------------------------------
# Service restart classification
# ---------------------------------------------------------------------------

SERVICE_RESTART_COMMANDS = [
    "sudo systemctl restart nginx",
    "systemctl restart postgresql",
    "systemctl reload nginx",
]

# ---------------------------------------------------------------------------
# Targeted low-change commands (should NOT be blocked)
# ---------------------------------------------------------------------------

TARGETED_CHANGE_COMMANDS = [
    "mkdir -p /var/www/uploads",
    "chown www-data:www-data /var/www/uploads",
    "chmod 755 /var/www/uploads",
    "systemctl enable nginx",
]


def test_blocked_commands():
    for cmd in BLOCKED_COMMANDS:
        decision = classify_command(cmd)
        assert not decision.allowed, f"Expected BLOCKED but got allowed=True for: {cmd!r}"
        assert decision.risk == RiskLevel.BLOCKED, f"Expected BLOCKED risk for: {cmd!r}"


def test_allowed_commands():
    for cmd in ALLOWED_COMMANDS:
        decision = classify_command(cmd)
        assert decision.allowed, f"Expected allowed=True but got BLOCKED for: {cmd!r} — reason: {decision.reason}"


def test_service_restart_classification():
    for cmd in SERVICE_RESTART_COMMANDS:
        decision = classify_command(cmd)
        assert decision.allowed, f"Service restart should be allowed: {cmd!r}"
        assert decision.risk == RiskLevel.SERVICE_RESTART, f"Expected SERVICE_RESTART risk for: {cmd!r}, got {decision.risk}"


def test_targeted_changes_not_blocked():
    for cmd in TARGETED_CHANGE_COMMANDS:
        decision = classify_command(cmd)
        assert decision.allowed, f"Targeted change should be allowed: {cmd!r} — reason: {decision.reason}"


def test_read_only_classification():
    decision = classify_command("df -h")
    assert decision.allowed
    assert decision.risk == RiskLevel.READ_ONLY

    decision = classify_command("systemctl status nginx --no-pager")
    assert decision.allowed
    assert decision.risk == RiskLevel.READ_ONLY


def test_normalized_command_preserved():
    cmd = "  systemctl status nginx --no-pager  "
    decision = classify_command(cmd)
    assert decision.normalized_command == cmd.strip()
