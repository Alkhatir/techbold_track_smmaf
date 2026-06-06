"""Curated safe diagnostic commands the agent should prefer over inventing new ones."""

BASELINE_DIAGNOSTICS = [
    "hostname",
    "uptime",
    "whoami",
    "systemctl list-units --failed --no-pager",
    'journalctl -p err --since "1 hour ago" --no-pager | tail -50',
    "df -h",
    "free -m",
    "ss -tlnp",
    "ps aux --sort=-%cpu | head -10",
    "tail -20 /var/log/syslog",
]

SERVICE_DIAGNOSTICS_TEMPLATE = [
    "systemctl status {service} --no-pager",
    "journalctl -u {service} -n 100 --no-pager",
    "systemctl cat {service}",
    "systemctl is-active {service}",
    "systemctl is-enabled {service}",
]

WEB_DIAGNOSTICS = [
    "curl -I http://localhost",
    "curl -sS http://localhost/health",
    "ss -tlnp | grep -E ':80|:443|:3000|:5000|:8000|:8080'",
]

CONFIG_CHECKS = [
    "nginx -t",
    "apachectl configtest",
    "python3 --version",
    "node --version",
    "php -v",
]

DISK_DIAGNOSTICS = [
    "df -h",
    "du -sh /var/log/* 2>/dev/null | sort -h | tail -20",
    "du -sh /var/lib/* 2>/dev/null | sort -h | tail -10",
]

PERMISSION_DIAGNOSTICS = [
    "ls -la {path}",
    "stat {path}",
    "namei -l {path}",
]

DATABASE_DIAGNOSTICS = [
    "systemctl status postgresql --no-pager",
    "systemctl status mysql --no-pager",
    "ss -tlnp | grep -E ':5432|:3306|:27017'",
]

# DNS, routing and reachability — for "cannot reach partner/external service" tickets
NETWORK_DIAGNOSTICS = [
    "cat /etc/hosts",
    "cat /etc/resolv.conf",
    "resolvectl status",
    "dig {hostname}",
    "nslookup {hostname}",
    "ping -c 3 {hostname}",
    "curl -sS --max-time 5 {url}",
    "ip route show",
    "ss -tlnp | grep {port}",
]

# PostgreSQL table/role privilege checks — for "can read but not write" tickets
DATABASE_PERMISSION_DIAGNOSTICS = [
    "sudo -u postgres psql -c '\\l'",
    "sudo -u postgres psql -d {database} -c '\\dp'",
    "sudo -u postgres psql -d {database} -c '\\du'",
    "sudo -u postgres psql -c 'SELECT usename, usesuper, usecreatedb FROM pg_user;'",
    "sudo -u postgres psql -d {database} -c 'SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name=\\'{table}\\';'",
]
