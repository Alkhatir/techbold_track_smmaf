import re

_REDACTED = "[REDACTED_SECRET]"

# Ordered from most-specific to least-specific to avoid partial matches
_PATTERNS: list[tuple[re.Pattern, str]] = [
    # PEM private key blocks
    (re.compile(r"-----BEGIN[A-Z ]+ PRIVATE KEY-----.*?-----END[A-Z ]+ PRIVATE KEY-----", re.DOTALL), _REDACTED),
    # Authorization header values
    (re.compile(r"(Authorization:\s*Bearer\s+)\S+", re.IGNORECASE), rf"\1{_REDACTED}"),
    # ssh-rsa / ssh-ed25519 public key material (long base64)
    (re.compile(r"ssh-(?:rsa|ed25519|ecdsa-sha2-\S+)\s+[A-Za-z0-9+/=]{20,}"), _REDACTED),
    # password=value  PASSWORD=value
    (re.compile(r"(password\s*[=:]\s*)\S+", re.IGNORECASE), rf"\1{_REDACTED}"),
    # token=value  TOKEN=value
    (re.compile(r"\b(token\s*[=:]\s*)\S+", re.IGNORECASE), rf"\1{_REDACTED}"),
    # api_key=value  API_KEY=value
    (re.compile(r"(api[_-]?key\s*[=:]\s*)\S+", re.IGNORECASE), rf"\1{_REDACTED}"),
    # secret=value
    (re.compile(r"\b(secret\s*[=:]\s*)\S+", re.IGNORECASE), rf"\1{_REDACTED}"),
    # Database URLs with embedded credentials
    (re.compile(r"((?:postgres(?:ql)?|mysql|mongodb|redis)://)[^:@\s]+:[^@\s]+@", re.IGNORECASE), rf"\1{_REDACTED}@"),
    # .env-style assignments for sensitive env vars
    (re.compile(r"((?:OPENAI|ANTHROPIC|AWS|GCP|AZURE|SECRET|PRIVATE|KEY|TOKEN|PASSWORD|PASS)[_A-Z0-9]*\s*=\s*)\S+", re.IGNORECASE), rf"\1{_REDACTED}"),
]

_SENSITIVE_DICT_KEYS = frozenset({
    "password", "token", "secret", "api_key", "apikey", "key",
    "bearer", "authorization", "private_key", "access_token", "refresh_token",
})


def redact_text(text: str) -> str:
    if not text:
        return text
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def redact_dict(data: dict) -> dict:
    result: dict = {}
    for k, v in data.items():
        key_lower = k.lower()
        if any(s in key_lower for s in _SENSITIVE_DICT_KEYS):
            result[k] = _REDACTED
        elif isinstance(v, str):
            result[k] = redact_text(v)
        elif isinstance(v, dict):
            result[k] = redact_dict(v)
        elif isinstance(v, list):
            result[k] = [redact_dict(i) if isinstance(i, dict) else (redact_text(i) if isinstance(i, str) else i) for i in v]
        else:
            result[k] = v
    return result
