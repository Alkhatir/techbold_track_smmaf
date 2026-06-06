"""Tests for the secret redactor."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.ssh.redactor import redact_text, redact_dict

REDACTED = "[REDACTED_SECRET]"


def test_authorization_bearer():
    text = "Authorization: Bearer abc123token"
    result = redact_text(text)
    assert "abc123token" not in result
    assert REDACTED in result


def test_password_assignment():
    for line in ["password=secret123", "PASSWORD=secret123", "password: secret123"]:
        result = redact_text(line)
        assert "secret123" not in result, f"Password not redacted in: {line!r}"
        assert REDACTED in result


def test_private_key_block():
    text = "-----BEGIN OPENSSH PRIVATE KEY-----\nABCDEFGHIJKLMNOP\n-----END OPENSSH PRIVATE KEY-----"
    result = redact_text(text)
    assert "ABCDEFGHIJKLMNOP" not in result
    assert REDACTED in result


def test_rsa_key_block():
    text = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----"
    result = redact_text(text)
    assert "MIIEowIBAAKCAQEA" not in result


def test_token_assignment():
    for line in ["token=mytoken123", "TOKEN=mytoken123"]:
        result = redact_text(line)
        assert "mytoken123" not in result, f"Token not redacted in: {line!r}"


def test_api_key_assignment():
    for line in ["api_key=sk-abc123", "API_KEY=sk-abc123"]:
        result = redact_text(line)
        assert "sk-abc123" not in result


def test_database_url():
    url = "postgres://admin:supersecret@db.internal:5432/mydb"
    result = redact_text(url)
    assert "supersecret" not in result
    assert REDACTED in result


def test_env_var_secrets():
    for line in ["ANTHROPIC_API_KEY=sk-ant-abc123", "OPENAI_API_KEY=sk-proj-abc"]:
        result = redact_text(line)
        assert "sk-ant-abc123" not in result or "sk-proj-abc" not in result


def test_clean_text_unchanged():
    text = "systemctl status nginx\nActive: active (running)\ndf -h shows 45% used"
    result = redact_text(text)
    assert result == text


def test_empty_string():
    assert redact_text("") == ""
    assert redact_text(None) is None  # type: ignore[arg-type]


def test_redact_dict_sensitive_key():
    data = {"username": "admin", "password": "secret", "host": "db.internal"}
    result = redact_dict(data)
    assert result["password"] == REDACTED
    assert result["username"] == "admin"
    assert result["host"] == "db.internal"


def test_redact_dict_nested():
    data = {
        "connection": {
            "host": "db.internal",
            "token": "bearer-abc123",
        }
    }
    result = redact_dict(data)
    assert result["connection"]["token"] == REDACTED
    assert result["connection"]["host"] == "db.internal"


def test_redact_dict_string_values():
    data = {"output": "Authorization: Bearer abc123\nsome other text"}
    result = redact_dict(data)
    assert "abc123" not in result["output"]
